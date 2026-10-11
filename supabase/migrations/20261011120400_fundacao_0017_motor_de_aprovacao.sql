-- =============================================================================
-- Fundacao — 0017: um motor de aprovacao, dois objetos
--
-- Peca de conteudo e entregavel de projeto passam pelo mesmo ciclo. As telas
-- "Aprovacoes" (equipe) e "Para aprovar" (cliente) mostram os dois na MESMA
-- lista, entao precisa existir uma tabela so que de para consultar.
--
-- Nada aqui expira. O link de aprovacao fecha por ESTADO — quando todos os
-- itens do envio forem respondidos — ou quando alguem revogar na mao.
-- =============================================================================

do $$ begin
  create type public.tipo_item_aprovacao as enum ('peca', 'entregavel');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_aprovacao as enum (
    'produzindo', 'em_aprovacao', 'com_ajustes', 'aprovado', 'declinado'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- itens_aprovacao — o supertipo
-- ---------------------------------------------------------------------------
create table if not exists public.itens_aprovacao (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  tipo           public.tipo_item_aprovacao not null,
  estado         public.estado_aprovacao not null default 'produzindo',
  -- Copia do titulo para a lista nao precisar de join com duas tabelas filhas.
  titulo         text not null check (length(btrim(titulo)) > 0),
  enviado_em     timestamptz,
  respondido_em  timestamptz,
  respondido_por text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  constraint itens_aprovacao_envio_datado check (
    estado = 'produzindo' or enviado_em is not null
  ),
  constraint itens_aprovacao_resposta_datada check (
    estado not in ('com_ajustes', 'aprovado', 'declinado')
    or (respondido_em is not null and respondido_por is not null)
  )
);

create index if not exists itens_aprovacao_espera_idx
  on public.itens_aprovacao (cliente_id, enviado_em)
  where estado = 'em_aprovacao';

create index if not exists itens_aprovacao_volta_idx
  on public.itens_aprovacao (cliente_id, respondido_em desc)
  where estado = 'com_ajustes';

drop trigger if exists itens_aprovacao_atualizado_em on public.itens_aprovacao;
create trigger itens_aprovacao_atualizado_em
  before update on public.itens_aprovacao
  for each row execute function public.tg_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- posts vira um subtipo. Um post, um item.
-- ---------------------------------------------------------------------------
alter table public.posts add column if not exists item_id uuid
  references public.itens_aprovacao(id) on delete set null;

create unique index if not exists posts_item_key
  on public.posts (item_id) where item_id is not null;

insert into public.itens_aprovacao (cliente_id, tipo, estado, titulo, enviado_em, criado_em)
select p.cliente_id, 'peca',
       case p.status when 'rascunho' then 'produzindo'::public.estado_aprovacao
                     when 'aguardando_aprovacao' then 'em_aprovacao'
                     when 'cancelado' then 'declinado'
                     else 'aprovado' end,
       p.titulo_interno,
       case when p.status = 'rascunho' then null else p.criado_em end,
       p.criado_em
  from public.posts p
 where p.item_id is null;

update public.posts p
   set item_id = i.id
  from public.itens_aprovacao i
 where p.item_id is null
   and i.tipo = 'peca'
   and i.cliente_id = p.cliente_id
   and i.titulo = p.titulo_interno
   and i.criado_em = p.criado_em;

comment on column public.posts.item_id is
  'O estado de APROVACAO mora em itens_aprovacao. posts.status cuida da '
  'PUBLICACAO (agendado, publicando, publicado, falhou) — sao dois eixos.';

-- Espelho de mao unica: o item manda, o post obedece. Existe para o worker
-- seguir funcionando sem alteracao. Nunca escreva o caminho inverso.
create or replace function public.tg_espelha_estado_no_post()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.tipo <> 'peca' or new.estado is not distinct from old.estado then
    return new;
  end if;

  update public.posts p
     set status = case new.estado
                    when 'produzindo'   then 'rascunho'::public.status_post
                    when 'em_aprovacao' then 'aguardando_aprovacao'
                    when 'com_ajustes'  then 'rascunho'
                    when 'aprovado'     then 'aprovado'
                    when 'declinado'    then 'cancelado'
                  end
   where p.item_id = new.id
     -- nao mexe em post que ja saiu do ciclo de aprovacao
     and p.status in ('rascunho', 'aguardando_aprovacao', 'aprovado', 'cancelado');
  return new;
end;
$$;

drop trigger if exists itens_aprovacao_espelha_post on public.itens_aprovacao;
create trigger itens_aprovacao_espelha_post
  after update of estado on public.itens_aprovacao
  for each row execute function public.tg_espelha_estado_no_post();

-- ---------------------------------------------------------------------------
-- envios — o lote que o cliente recebe de uma vez
-- ---------------------------------------------------------------------------
create table if not exists public.envios_aprovacao (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  criado_por uuid references public.perfis(user_id) on delete set null,
  mensagem   text,
  criado_em  timestamptz not null default now(),
  fechado_em timestamptz
);

comment on column public.envios_aprovacao.fechado_em is
  'Preenchido quando o ultimo item do lote foi respondido. E assim que o link '
  'morre: por estado, nunca por relogio.';

create table if not exists public.envio_itens (
  envio_id uuid not null references public.envios_aprovacao(id) on delete cascade,
  item_id  uuid not null references public.itens_aprovacao(id) on delete cascade,
  primary key (envio_id, item_id)
);

create index if not exists envio_itens_item_idx on public.envio_itens (item_id);

-- ---------------------------------------------------------------------------
-- comentarios: deixam de pertencer a um post e passam a pertencer a um item
-- ---------------------------------------------------------------------------
alter table public.aprovacao_comentarios add column if not exists item_id uuid
  references public.itens_aprovacao(id) on delete cascade;

update public.aprovacao_comentarios c
   set item_id = p.item_id
  from public.posts p
 where p.id = c.post_id and c.item_id is null;

alter table public.aprovacao_comentarios drop column if exists post_id;
alter table public.aprovacao_comentarios alter column item_id set not null;

drop index if exists public.aprovacao_comentarios_post_idx;
create index if not exists aprovacao_comentarios_item_idx
  on public.aprovacao_comentarios (item_id, criado_em);

-- ---------------------------------------------------------------------------
-- links_aprovacao: sem validade, amarrado a um envio
-- ---------------------------------------------------------------------------
alter table public.links_aprovacao add column if not exists envio_id uuid
  references public.envios_aprovacao(id) on delete cascade;
alter table public.links_aprovacao drop column if exists expira_em;

comment on table public.links_aprovacao is
  'Sem coluna de validade de proposito: o link nao vence. Ele vira leitura '
  'quando o envio fecha, ou quando revogado = true.';

drop function if exists public.criar_link_aprovacao(uuid, integer);

create or replace function public.criar_link_aprovacao(p_envio_id uuid)
returns table (link_id uuid, token text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token   text;
  v_cliente uuid;
  v_id      uuid;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para criar link de aprovacao.';
  end if;

  select e.cliente_id into v_cliente
    from public.envios_aprovacao e where e.id = p_envio_id;
  if v_cliente is null then
    raise exception 'Envio nao encontrado.';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.links_aprovacao (cliente_id, envio_id, token_hash, criado_por)
  values (v_cliente, p_envio_id,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;

  return query select v_id, v_token;
end;
$$;

revoke all on function public.criar_link_aprovacao(uuid) from public, anon;
grant execute on function public.criar_link_aprovacao(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- responder_item — a unica porta para o cliente responder
--
-- Pedir ajuste SEM comentario e recusado aqui, no banco. A tela tambem vai
-- barrar, mas quem garante e esta funcao.
-- ---------------------------------------------------------------------------
create or replace function public.responder_item(
  p_item_id    uuid,
  p_decisao    public.estado_aprovacao,
  p_autor_nome text,
  p_autor_tipo public.autor_tipo default 'cliente',
  p_comentario text default null
)
returns public.itens_aprovacao
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item   public.itens_aprovacao;
  v_restam integer;
begin
  if p_decisao not in ('aprovado', 'com_ajustes', 'declinado') then
    raise exception 'Decisao invalida: use aprovado, com_ajustes ou declinado.';
  end if;

  if p_decisao = 'com_ajustes' and length(btrim(coalesce(p_comentario, ''))) = 0 then
    raise exception 'Pedido de ajuste exige um comentario dizendo o que mudar.';
  end if;

  if length(btrim(coalesce(p_autor_nome, ''))) = 0 then
    raise exception 'A resposta precisa de um autor.';
  end if;

  select * into v_item from public.itens_aprovacao where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'Item nao encontrado.';
  end if;
  if v_item.estado <> 'em_aprovacao' then
    raise exception 'Este item nao esta em aprovacao (esta em %).', v_item.estado;
  end if;

  -- Quem esta logado so responde item de cliente que ele enxerga. Sem isso,
  -- qualquer autenticado aprovaria peca alheia adivinhando um uuid.
  -- auth.uid() nulo = chamada de service_role (Edge Function), que e o caminho
  -- do link sem conta: ali quem valida o token e a funcao, antes de chegar aqui.
  if auth.uid() is not null and not public.usuario_ve_cliente(v_item.cliente_id) then
    raise exception 'Sem permissao para responder este item.';
  end if;

  update public.itens_aprovacao
     set estado = p_decisao,
         respondido_em = now(),
         respondido_por = p_autor_nome
   where id = p_item_id
  returning * into v_item;

  if p_comentario is not null and length(btrim(p_comentario)) > 0 then
    insert into public.aprovacao_comentarios (item_id, autor_tipo, autor_nome, texto)
    values (p_item_id, p_autor_tipo, p_autor_nome, btrim(p_comentario));
  end if;

  -- Fecha todo envio deste item cujos itens ja foram todos respondidos.
  update public.envios_aprovacao e
     set fechado_em = now()
   where e.fechado_em is null
     and exists (select 1 from public.envio_itens ei
                  where ei.envio_id = e.id and ei.item_id = p_item_id)
     and not exists (
       select 1 from public.envio_itens ei
         join public.itens_aprovacao i on i.id = ei.item_id
        where ei.envio_id = e.id and i.estado = 'em_aprovacao');

  return v_item;
end;
$$;

revoke all on function public.responder_item(uuid, public.estado_aprovacao, text, public.autor_tipo, text)
  from public, anon;
grant execute on function public.responder_item(uuid, public.estado_aprovacao, text, public.autor_tipo, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['itens_aprovacao', 'envios_aprovacao', 'envio_itens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);

    execute format('drop policy if exists %I on public.%I', t || '_equipe_le', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.usuario_ativo())',
      t || '_equipe_le', t);

    execute format('drop policy if exists %I on public.%I', t || '_escreve', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.usuario_edita()) with check (public.usuario_edita())',
      t || '_escreve', t);
  end loop;
end $$;

drop policy if exists itens_aprovacao_cliente_le on public.itens_aprovacao;
create policy itens_aprovacao_cliente_le on public.itens_aprovacao
  for select to authenticated
  using (cliente_id in (select public.clientes_do_usuario()));

drop policy if exists envios_aprovacao_cliente_le on public.envios_aprovacao;
create policy envios_aprovacao_cliente_le on public.envios_aprovacao
  for select to authenticated
  using (cliente_id in (select public.clientes_do_usuario()));

drop policy if exists envio_itens_cliente_le on public.envio_itens;
create policy envio_itens_cliente_le on public.envio_itens
  for select to authenticated
  using (exists (select 1 from public.envios_aprovacao e
                  where e.id = envio_id
                    and e.cliente_id in (select public.clientes_do_usuario())));

drop policy if exists aprovacao_comentarios_cliente_le on public.aprovacao_comentarios;
create policy aprovacao_comentarios_cliente_le on public.aprovacao_comentarios
  for select to authenticated
  using (exists (select 1 from public.itens_aprovacao i
                  where i.id = item_id
                    and i.cliente_id in (select public.clientes_do_usuario())));

-- O cliente le as proprias pecas, e so se tiver o modulo.
drop policy if exists posts_cliente_le on public.posts;
create policy posts_cliente_le on public.posts
  for select to authenticated
  using (
    cliente_id in (select public.clientes_do_usuario())
    and public.cliente_tem_modulo(cliente_id, 'calendario')
  );

drop policy if exists post_midias_cliente_le on public.post_midias;
create policy post_midias_cliente_le on public.post_midias
  for select to authenticated
  using (exists (select 1 from public.posts p
                  where p.id = post_id
                    and p.cliente_id in (select public.clientes_do_usuario())
                    and public.cliente_tem_modulo(p.cliente_id, 'calendario')));
