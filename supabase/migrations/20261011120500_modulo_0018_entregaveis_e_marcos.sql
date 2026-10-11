-- =============================================================================
-- Modulo — 0018: entregaveis, versoes e marcos (o lado projeto)
--
-- O entregavel NAO tem estado proprio de aprovacao: ele usa o item. Enquanto o
-- trabalho nao comecou nao existe item, e isso e o "a fazer". Dois lugares
-- guardando o mesmo estado e como o sistema comeca a mentir.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Modelo: o que o sistema cria sozinho quando o servico e contratado
-- ---------------------------------------------------------------------------
create table if not exists public.modelos_entregavel (
  id         uuid primary key default gen_random_uuid(),
  servico_id uuid not null references public.servicos(id) on delete cascade,
  fase       text not null check (length(btrim(fase)) > 0),
  titulo     text not null check (length(btrim(titulo)) > 0),
  ordem      smallint not null,
  unique (servico_id, ordem)
);

comment on table public.modelos_entregavel is
  'Ponto de partida, nao camisa de forca: se a proposta do cliente listar outro '
  'escopo, a proposta ganha e a equipe edita os entregaveis depois.';

-- ---------------------------------------------------------------------------
-- Entregaveis do contrato
-- ---------------------------------------------------------------------------
create table if not exists public.entregaveis (
  id                 uuid primary key default gen_random_uuid(),
  cliente_servico_id uuid not null references public.cliente_servicos(id) on delete cascade,
  -- Nulo = ainda nao comecou ("a fazer"). Nasce quando o trabalho comeca.
  item_id            uuid references public.itens_aprovacao(id) on delete set null,
  fase               text not null,
  titulo             text not null check (length(btrim(titulo)) > 0),
  ordem              smallint not null,
  responsavel_id     uuid references public.perfis(user_id) on delete set null,
  prazo              date,
  concluido_em       timestamptz,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  unique (cliente_servico_id, ordem)
);

create unique index if not exists entregaveis_item_key
  on public.entregaveis (item_id) where item_id is not null;

create index if not exists entregaveis_servico_idx
  on public.entregaveis (cliente_servico_id, ordem);

drop trigger if exists entregaveis_atualizado_em on public.entregaveis;
create trigger entregaveis_atualizado_em
  before update on public.entregaveis
  for each row execute function public.tg_set_atualizado_em();

-- O titulo mora no entregavel; o item recebe copia para a lista unica de
-- aprovacoes nao precisar saber de qual tabela filha veio.
create or replace function public.tg_entregavel_espelha_titulo()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.item_id is not null then
    update public.itens_aprovacao set titulo = new.titulo
     where id = new.item_id and titulo is distinct from new.titulo;
  end if;
  return new;
end;
$$;

drop trigger if exists entregaveis_espelha_titulo on public.entregaveis;
create trigger entregaveis_espelha_titulo
  after insert or update of titulo, item_id on public.entregaveis
  for each row execute function public.tg_entregavel_espelha_titulo();

-- ---------------------------------------------------------------------------
-- Versoes e arquivos. Entregavel tem versao; peca de conteudo tem troca de arte.
-- ---------------------------------------------------------------------------
create table if not exists public.entregavel_versoes (
  id            uuid primary key default gen_random_uuid(),
  entregavel_id uuid not null references public.entregaveis(id) on delete cascade,
  numero        smallint not null check (numero >= 1),
  nota          text,
  criado_por    uuid references public.perfis(user_id) on delete set null,
  criado_em     timestamptz not null default now(),
  unique (entregavel_id, numero)
);

create table if not exists public.entregavel_arquivos (
  id            uuid primary key default gen_random_uuid(),
  versao_id     uuid not null references public.entregavel_versoes(id) on delete cascade,
  nome          text not null check (length(btrim(nome)) > 0),
  -- Caminho no bucket privado, ou URL externa (Figma, por exemplo).
  caminho       text,
  url_externa   text,
  tamanho_bytes bigint check (tamanho_bytes is null or tamanho_bytes >= 0),
  criado_em     timestamptz not null default now(),
  constraint entregavel_arquivos_tem_destino check (
    (caminho is not null) <> (url_externa is not null)
  )
);

create index if not exists entregavel_arquivos_versao_idx
  on public.entregavel_arquivos (versao_id);

-- Proxima versao, sem corrida entre dois uploads simultaneos.
create or replace function public.nova_versao_entregavel(
  p_entregavel_id uuid,
  p_nota          text default null
)
returns public.entregavel_versoes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_num smallint;
  v_row public.entregavel_versoes;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para subir versao.';
  end if;

  perform 1 from public.entregaveis where id = p_entregavel_id for update;
  if not found then
    raise exception 'Entregavel nao encontrado.';
  end if;

  select coalesce(max(numero), 0) + 1 into v_num
    from public.entregavel_versoes where entregavel_id = p_entregavel_id;

  insert into public.entregavel_versoes (entregavel_id, numero, nota, criado_por)
  values (p_entregavel_id, v_num, p_nota, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.nova_versao_entregavel(uuid, text) from public, anon;
grant execute on function public.nova_versao_entregavel(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Marcos: as datas do projeto, que aparecem na Agenda junto das publicacoes
-- ---------------------------------------------------------------------------
create table if not exists public.marcos (
  id                 uuid primary key default gen_random_uuid(),
  cliente_servico_id uuid not null references public.cliente_servicos(id) on delete cascade,
  titulo             text not null check (length(btrim(titulo)) > 0),
  prazo              date not null,
  responsavel_id     uuid references public.perfis(user_id) on delete set null,
  concluido_em       timestamptz,
  ordem              smallint not null default 0,
  criado_em          timestamptz not null default now()
);

create index if not exists marcos_prazo_idx
  on public.marcos (prazo) where concluido_em is null;
create index if not exists marcos_servico_idx
  on public.marcos (cliente_servico_id, prazo);

-- ---------------------------------------------------------------------------
-- Criar os entregaveis a partir do modelo
-- ---------------------------------------------------------------------------
create or replace function public.criar_entregaveis_do_modelo(p_cliente_servico_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_servico uuid;
  v_qtd     integer;
begin
  select cs.servico_id into v_servico
    from public.cliente_servicos cs where cs.id = p_cliente_servico_id;
  if v_servico is null then
    raise exception 'Servico contratado nao encontrado.';
  end if;

  -- Nao sobrescreve o que ja existe: a proposta pode ter mandado outro escopo.
  if exists (select 1 from public.entregaveis
              where cliente_servico_id = p_cliente_servico_id) then
    return 0;
  end if;

  insert into public.entregaveis (cliente_servico_id, fase, titulo, ordem)
  select p_cliente_servico_id, m.fase, m.titulo, m.ordem
    from public.modelos_entregavel m
   where m.servico_id = v_servico
   order by m.ordem;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

revoke all on function public.criar_entregaveis_do_modelo(uuid) from public, anon;
grant execute on function public.criar_entregaveis_do_modelo(uuid) to authenticated, service_role;

create or replace function public.tg_contrato_cria_entregaveis()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform public.criar_entregaveis_do_modelo(new.id);
  return new;
end;
$$;

drop trigger if exists cliente_servicos_cria_entregaveis on public.cliente_servicos;
create trigger cliente_servicos_cria_entregaveis
  after insert on public.cliente_servicos
  for each row execute function public.tg_contrato_cria_entregaveis();

-- ---------------------------------------------------------------------------
-- Leitura pronta: o estado do entregavel vem do item, ou e "a fazer".
-- ---------------------------------------------------------------------------
create or replace view public.entregaveis_com_estado as
  select e.*,
         cs.cliente_id,
         s.chave as servico_chave,
         coalesce(i.estado::text, 'a_fazer') as estado,
         i.enviado_em,
         i.respondido_em,
         (select max(v.numero) from public.entregavel_versoes v
           where v.entregavel_id = e.id) as versao_atual
    from public.entregaveis e
    join public.cliente_servicos cs on cs.id = e.cliente_servico_id
    join public.servicos s          on s.id = cs.servico_id
    left join public.itens_aprovacao i on i.id = e.item_id;

comment on view public.entregaveis_com_estado is
  'Sem item = a fazer. O estado real vem sempre de itens_aprovacao.';

-- ---------------------------------------------------------------------------
-- Seed dos modelos
-- ---------------------------------------------------------------------------
insert into public.modelos_entregavel (servico_id, fase, titulo, ordem)
select s.id, x.fase, x.titulo, x.ordem
  from (values
    ('branding','Diagnóstico','Diagnóstico de marca',1),
    ('branding','Estratégia','Arquétipo, propósito e valores',2),
    ('branding','Estratégia','Posicionamento estratégico',3),
    ('branding','Estratégia','Proposta de valor',4),
    ('branding','Entrega','Tom de voz e direcionamento',5),
    ('branding','Entrega','Brandbook',6),

    ('identidade_visual','Conceito','Logo',1),
    ('identidade_visual','Sistema','Paleta de cores',2),
    ('identidade_visual','Sistema','Tipografia',3),
    ('identidade_visual','Sistema','Elementos gráficos e padrões',4),
    ('identidade_visual','Entrega','Manual de aplicação',5),
    ('identidade_visual','Entrega','Papelaria digital',6),

    ('audiovisual','Pré','Roteiro',1),
    ('audiovisual','Captação','Captação',2),
    ('audiovisual','Pós','Seleção de material',3),
    ('audiovisual','Pós','Edição e color grading',4),
    ('audiovisual','Entrega','Entrega final',5),

    ('website','Descoberta','Briefing e arquitetura',1),
    ('website','Descoberta','Wireframe',2),
    ('website','Design','Layout desktop',3),
    ('website','Design','Layout mobile',4),
    ('website','Desenvolvimento','Desenvolvimento responsivo',5),
    ('website','Desenvolvimento','Otimização SEO',6),
    ('website','Desenvolvimento','Velocidade e performance',7),
    ('website','Publicação','Domínio e hospedagem',8),
    ('website','Publicação','Certificado SSL',9),
    ('website','Publicação','Homologação',10),
    ('website','Publicação','Site no ar',11),

    ('sistemas','Descoberta','Mapeamento do processo',1),
    ('sistemas','Desenho','Fluxos e automações',2),
    ('sistemas','Construção','Integrações',3),
    ('sistemas','Entrega','Homologação',4),
    ('sistemas','Entrega','Treinamento de uso',5)
  ) as x(servico, fase, titulo, ordem)
  join public.servicos s on s.chave = x.servico
on conflict (servico_id, ordem) do update
   set fase = excluded.fase, titulo = excluded.titulo;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.modelos_entregavel enable row level security;
revoke all on public.modelos_entregavel from anon;
drop policy if exists modelos_entregavel_le on public.modelos_entregavel;
create policy modelos_entregavel_le on public.modelos_entregavel
  for select to authenticated using (public.usuario_ativo());
drop policy if exists modelos_entregavel_admin on public.modelos_entregavel;
create policy modelos_entregavel_admin on public.modelos_entregavel
  for all to authenticated
  using (public.usuario_admin()) with check (public.usuario_admin());

do $$
declare t text;
begin
  foreach t in array array['entregaveis','entregavel_versoes','entregavel_arquivos','marcos'] loop
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

-- Cliente le os proprios, e so se tiver o modulo.
drop policy if exists entregaveis_cliente_le on public.entregaveis;
create policy entregaveis_cliente_le on public.entregaveis
  for select to authenticated
  using (exists (
    select 1 from public.cliente_servicos cs
     where cs.id = cliente_servico_id
       and cs.cliente_id in (select public.clientes_do_usuario())
       and public.cliente_tem_modulo(cs.cliente_id, 'entregaveis')));

drop policy if exists marcos_cliente_le on public.marcos;
create policy marcos_cliente_le on public.marcos
  for select to authenticated
  using (exists (
    select 1 from public.cliente_servicos cs
     where cs.id = cliente_servico_id
       and cs.cliente_id in (select public.clientes_do_usuario())
       and public.cliente_tem_modulo(cs.cliente_id, 'marcos')));

drop policy if exists entregavel_versoes_cliente_le on public.entregavel_versoes;
create policy entregavel_versoes_cliente_le on public.entregavel_versoes
  for select to authenticated
  using (exists (
    select 1 from public.entregaveis e
      join public.cliente_servicos cs on cs.id = e.cliente_servico_id
     where e.id = entregavel_id
       and cs.cliente_id in (select public.clientes_do_usuario())
       and public.cliente_tem_modulo(cs.cliente_id, 'entregaveis')));

drop policy if exists entregavel_arquivos_cliente_le on public.entregavel_arquivos;
create policy entregavel_arquivos_cliente_le on public.entregavel_arquivos
  for select to authenticated
  using (exists (
    select 1 from public.entregavel_versoes v
      join public.entregaveis e        on e.id = v.entregavel_id
      join public.cliente_servicos cs  on cs.id = e.cliente_servico_id
     where v.id = versao_id
       and cs.cliente_id in (select public.clientes_do_usuario())
       and public.cliente_tem_modulo(cs.cliente_id, 'entregaveis')));

-- A view herda o RLS das tabelas de base (security_invoker).
alter view public.entregaveis_com_estado set (security_invoker = on);
revoke all on public.entregaveis_com_estado from anon;
