-- =============================================================================
-- Modulo — 0034: galeria propria (saindo do Pixieset)
--
-- A 0022 deixou a galeria provedor-agnostica, guardando so o link de fora.
-- Esta migration faz 'storage' virar provedor de primeira classe: o arquivo
-- mora no nosso bucket, o cliente abre por um link sem conta, escolhe as
-- favoritas e baixa em alta — igual ao Pixieset, sem a mensalidade dele.
--
-- TRES DECISOES QUE MOLDAM O RESTO:
--
-- 1. As miniaturas sao feitas NO NAVEGADOR, na hora do envio, e sobem junto.
--    O navegador ja tem o arquivo na mao; mandar o original para o servidor
--    so para ele devolver um quadrado menor custa banda duas vezes e exige
--    processamento de midia no servidor — que e exatamente o que nao quero
--    manter. Vale tambem para o poster do video: primeiro quadro, desenhado
--    num canvas antes de subir.
--
-- 2. O original NUNCA passa por funcao. O download e uma URL assinada que
--    aponta direto para o storage. Streaming de 2 GB de video por Edge
--    Function e o caminho certo para estourar memoria e tempo.
--
-- 3. O link nao vence, como todo link desta plataforma. Ele morre quando
--    alguem revoga. Por isso revogar precisa existir de verdade — e existe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- galerias: vira entregavel de verdade, nao so um endereco
-- ---------------------------------------------------------------------------
alter table public.galerias add column if not exists titulo text;
alter table public.galerias add column if not exists recado text;
alter table public.galerias add column if not exists permite_download boolean not null default true;
alter table public.galerias add column if not exists publicada_em timestamptz;
alter table public.galerias add column if not exists arquivada_em timestamptz;
alter table public.galerias add column if not exists capa_item_id uuid;

-- A trava antiga exigia url ou externo_id. Galeria nossa nao tem nenhum dos
-- dois: o endereco dela e o proprio id.
alter table public.galerias drop constraint if exists galerias_tem_endereco;
alter table public.galerias add constraint galerias_tem_endereco check (
  provedor = 'storage' or url is not null or externo_id is not null
);

comment on column public.galerias.permite_download is
  'Falso = o cliente ve, mas nao baixa. Serve para previa antes do pagamento.';

-- ---------------------------------------------------------------------------
-- galeria_itens: o arquivo de verdade, com o que a tela precisa para montar
-- a grade sem baixar nada em tamanho cheio
-- ---------------------------------------------------------------------------
alter table public.galeria_itens add column if not exists tipo_mime text;
alter table public.galeria_itens add column if not exists tamanho_bytes bigint
  check (tamanho_bytes is null or tamanho_bytes >= 0);
alter table public.galeria_itens add column if not exists largura integer;
alter table public.galeria_itens add column if not exists altura integer;
alter table public.galeria_itens add column if not exists duracao_s numeric(8,2);
alter table public.galeria_itens add column if not exists miniatura_caminho text;
alter table public.galeria_itens add column if not exists poster_caminho text;
alter table public.galeria_itens add column if not exists ordem integer not null default 0;
alter table public.galeria_itens add column if not exists enviado_por uuid
  references public.perfis(user_id) on delete set null;
-- Enquanto o upload nao terminou o item existe mas nao aparece. Sem isto, o
-- cliente abre a galeria no meio do envio e ve metade das fotos quebradas.
alter table public.galeria_itens add column if not exists pronto boolean not null default false;

create index if not exists galeria_itens_ordem_idx
  on public.galeria_itens (galeria_id, ordem) where pronto;

alter table public.galerias
  drop constraint if exists galerias_capa_fk;
alter table public.galerias
  add constraint galerias_capa_fk foreign key (capa_item_id)
  references public.galeria_itens(id) on delete set null;

-- ---------------------------------------------------------------------------
-- links_galeria — o endereco que vai para o cliente, sem conta e sem validade
-- ---------------------------------------------------------------------------
create table if not exists public.links_galeria (
  id               uuid primary key default gen_random_uuid(),
  galeria_id       uuid not null references public.galerias(id) on delete cascade,
  -- Guardamos o HASH, nunca o token. Mesmo principio do link de aprovacao e
  -- do token da Meta: vazou o banco, nao vazou o acesso.
  token_hash       text not null unique,
  criado_por       uuid references public.perfis(user_id) on delete set null,
  criado_em        timestamptz not null default now(),
  revogado_em      timestamptz,
  ultimo_acesso_em timestamptz,
  acessos          integer not null default 0 check (acessos >= 0)
);

create index if not exists links_galeria_galeria_idx on public.links_galeria (galeria_id);

comment on table public.links_galeria is
  'Sem coluna de validade, de proposito. O link morre quando revogado_em for '
  'preenchido — e so assim.';

-- ---------------------------------------------------------------------------
-- galeria_favoritos — a selecao do cliente, que e metade do valor do Pixieset
--
-- `quem` e texto livre porque o cliente pode estar sem conta, vindo pelo link.
-- ---------------------------------------------------------------------------
create table if not exists public.galeria_favoritos (
  galeria_id uuid not null references public.galerias(id) on delete cascade,
  item_id    uuid not null references public.galeria_itens(id) on delete cascade,
  quem       text not null check (length(btrim(quem)) > 0),
  criado_em  timestamptz not null default now(),
  primary key (galeria_id, item_id, quem)
);

create index if not exists galeria_favoritos_galeria_idx on public.galeria_favoritos (galeria_id);

-- ---------------------------------------------------------------------------
-- galeria_downloads — saber que o cliente ja baixou vale uma ligacao a menos
-- ---------------------------------------------------------------------------
create table if not exists public.galeria_downloads (
  id         uuid primary key default gen_random_uuid(),
  galeria_id uuid not null references public.galerias(id) on delete cascade,
  -- Nulo = baixou a galeria inteira.
  item_id    uuid references public.galeria_itens(id) on delete set null,
  quem       text,
  criado_em  timestamptz not null default now()
);

create index if not exists galeria_downloads_galeria_idx
  on public.galeria_downloads (galeria_id, criado_em desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['links_galeria', 'galeria_favoritos', 'galeria_downloads'] loop
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

-- O cliente logado le os favoritos e os downloads da propria galeria.
drop policy if exists galeria_favoritos_cliente on public.galeria_favoritos;
create policy galeria_favoritos_cliente on public.galeria_favoritos
  for select to authenticated
  using (exists (
    select 1 from public.galerias g
      join public.sessoes_captacao s on s.id = g.sessao_id
     where g.id = galeria_id
       and s.cliente_id in (select public.clientes_do_usuario())));

-- ---------------------------------------------------------------------------
-- criar_galeria — nasce do trabalho (a sessao), nao do nada
-- ---------------------------------------------------------------------------
create or replace function public.criar_galeria(
  p_sessao uuid,
  p_titulo text default null,
  p_recado text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_sessao public.sessoes_captacao;
begin
  select * into v_sessao from public.sessoes_captacao where id = p_sessao;
  if v_sessao.id is null then
    raise exception 'Captacao nao encontrada.';
  end if;

  insert into public.galerias (sessao_id, provedor, titulo, recado)
  values (p_sessao, 'storage',
          coalesce(nullif(btrim(p_titulo), ''), v_sessao.titulo),
          nullif(btrim(coalesce(p_recado, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- registrar_item — o navegador avisa que terminou de subir
--
-- Chamada DEPOIS do upload, com os metadados que so o navegador tinha: as
-- dimensoes, a duracao e os caminhos das derivadas que ele mesmo gerou.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_item_galeria(
  p_galeria   uuid,
  p_nome      text,
  p_tipo      public.tipo_midia_captacao,
  p_caminho   text,
  p_mime      text,
  p_bytes     bigint,
  p_miniatura text default null,
  p_poster    text default null,
  p_largura   integer default null,
  p_altura    integer default null,
  p_duracao   numeric default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_ordem integer;
begin
  if length(btrim(coalesce(p_caminho, ''))) = 0 then
    raise exception 'O item precisa do caminho do arquivo.';
  end if;

  select coalesce(max(ordem), 0) + 1 into v_ordem
    from public.galeria_itens where galeria_id = p_galeria;

  insert into public.galeria_itens (
    galeria_id, tipo, nome, caminho, tipo_mime, tamanho_bytes,
    miniatura_caminho, poster_caminho, largura, altura, duracao_s,
    ordem, enviado_por, pronto)
  values (
    p_galeria, p_tipo, p_nome, p_caminho, p_mime, p_bytes,
    p_miniatura, p_poster, p_largura, p_altura, p_duracao,
    v_ordem, auth.uid(), true)
  returning id into v_id;

  -- A primeira foto vira capa sozinha. Trocar depois e um update.
  update public.galerias
     set capa_item_id = v_id
   where id = p_galeria and capa_item_id is null and p_tipo = 'foto';

  -- A contagem da sessao passa a sair dos arquivos, nao da mao.
  update public.sessoes_captacao s
     set qtd_fotos = (select count(*) from public.galeria_itens i
                        join public.galerias g on g.id = i.galeria_id
                       where g.sessao_id = s.id and i.tipo = 'foto' and i.pronto),
         qtd_videos = (select count(*) from public.galeria_itens i
                        join public.galerias g on g.id = i.galeria_id
                       where g.sessao_id = s.id and i.tipo = 'video' and i.pronto)
   where s.id = (select sessao_id from public.galerias where id = p_galeria);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- criar_link_galeria — o endereco que vai no WhatsApp do cliente
-- ---------------------------------------------------------------------------
create or replace function public.criar_link_galeria(p_galeria uuid)
returns table (link_id uuid, token text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text;
  v_id    uuid;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para criar link de galeria.';
  end if;
  if not exists (select 1 from public.galerias where id = p_galeria) then
    raise exception 'Galeria nao encontrada.';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.links_galeria (galeria_id, token_hash, criado_por)
  values (p_galeria, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;

  update public.galerias
     set publicada_em = coalesce(publicada_em, now())
   where id = p_galeria;

  -- O token sai UMA vez, aqui. Depois disto so existe o hash.
  return query select v_id, v_token;
end;
$$;

create or replace function public.revogar_link_galeria(p_link uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.links_galeria set revogado_em = now()
   where id = p_link and revogado_em is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- galeria_por_token — a pagina que o cliente abre, sem conta nenhuma
--
-- SECURITY DEFINER porque quem chama e anonimo: a chave aqui e o token, e so
-- ele. Devolve os CAMINHOS; quem troca caminho por URL assinada e a Edge
-- Function, que tem a service role. O banco nunca assina nada.
-- ---------------------------------------------------------------------------
create or replace function public.galeria_por_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_link    public.links_galeria;
  v_galeria public.galerias;
  v_hash    text;
begin
  if length(coalesce(p_token, '')) < 32 then
    return null;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_link from public.links_galeria where token_hash = v_hash;
  if v_link.id is null or v_link.revogado_em is not null then
    return null;
  end if;

  select * into v_galeria from public.galerias where id = v_link.galeria_id;
  if v_galeria.arquivada_em is not null then
    return null;
  end if;

  update public.links_galeria
     set acessos = acessos + 1, ultimo_acesso_em = now()
   where id = v_link.id;

  return jsonb_build_object(
    'galeriaId', v_galeria.id,
    'titulo', coalesce(v_galeria.titulo, 'Galeria'),
    'recado', v_galeria.recado,
    'permiteDownload', v_galeria.permite_download,
    'cliente', (select c.nome from public.clientes c
                  join public.sessoes_captacao s on s.cliente_id = c.id
                 where s.id = v_galeria.sessao_id),
    'quando', (select s.data from public.sessoes_captacao s where s.id = v_galeria.sessao_id),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'tipo', i.tipo,
        'nome', i.nome,
        'caminho', i.caminho,
        'miniatura', i.miniatura_caminho,
        'poster', i.poster_caminho,
        'largura', i.largura,
        'altura', i.altura,
        'duracao', i.duracao_s,
        'bytes', i.tamanho_bytes)
        order by i.ordem)
      from public.galeria_itens i
     where i.galeria_id = v_galeria.id and i.pronto), '[]'::jsonb),
    'favoritos', coalesce((
      select jsonb_agg(f.item_id) from public.galeria_favoritos f
       where f.galeria_id = v_galeria.id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- favoritar_por_token / registrar_download — as duas escritas do visitante
-- ---------------------------------------------------------------------------
create or replace function public.favoritar_por_token(
  p_token  text,
  p_item   uuid,
  p_quem   text,
  p_ligado boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_link public.links_galeria;
begin
  select * into v_link from public.links_galeria
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and revogado_em is null;
  if v_link.id is null then
    raise exception 'Link invalido ou revogado.';
  end if;
  if not exists (select 1 from public.galeria_itens
                  where id = p_item and galeria_id = v_link.galeria_id) then
    raise exception 'Este item nao e desta galeria.';
  end if;

  if p_ligado then
    insert into public.galeria_favoritos (galeria_id, item_id, quem)
    values (v_link.galeria_id, p_item, coalesce(nullif(btrim(p_quem), ''), 'cliente'))
    on conflict do nothing;
  else
    delete from public.galeria_favoritos
     where galeria_id = v_link.galeria_id and item_id = p_item
       and quem = coalesce(nullif(btrim(p_quem), ''), 'cliente');
  end if;
end;
$$;

create or replace function public.registrar_download_galeria(
  p_token text,
  p_item  uuid default null,
  p_quem  text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_link public.links_galeria;
begin
  select * into v_link from public.links_galeria
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and revogado_em is null;
  if v_link.id is null then
    return;  -- Log nao e motivo para derrubar download.
  end if;

  insert into public.galeria_downloads (galeria_id, item_id, quem)
  values (v_link.galeria_id, p_item, nullif(btrim(coalesce(p_quem, '')), ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- favoritar_item — a mesma escolha, para quem ESTA logado
--
-- O cliente com conta nao tem token nenhum: ele entrou pela porta da frente.
-- SECURITY DEFINER porque a tabela de favoritos nao e dele para escrever, e o
-- nome de quem escolheu sai do cadastro, nao de um campo que o front manda.
-- ---------------------------------------------------------------------------
create or replace function public.favoritar_item(p_item uuid, p_ligado boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_galeria uuid;
  v_cliente uuid;
  v_quem    text;
begin
  select g.id, s.cliente_id into v_galeria, v_cliente
    from public.galeria_itens i
    join public.galerias g on g.id = i.galeria_id
    join public.sessoes_captacao s on s.id = g.sessao_id
   where i.id = p_item;
  if v_galeria is null then
    raise exception 'Item nao encontrado.';
  end if;
  if not public.usuario_ve_cliente(v_cliente) then
    raise exception 'Sem permissao nesta galeria.';
  end if;

  select coalesce(cu.nome, pe.nome, 'cliente') into v_quem
    from (select 1) um
    left join public.clientes_usuarios cu
           on cu.user_id = auth.uid() and cu.cliente_id = v_cliente
    left join public.perfis pe on pe.user_id = auth.uid();

  if p_ligado then
    insert into public.galeria_favoritos (galeria_id, item_id, quem)
    values (v_galeria, p_item, v_quem)
    on conflict do nothing;
  else
    delete from public.galeria_favoritos
     where galeria_id = v_galeria and item_id = p_item and quem = v_quem;
  end if;
end;
$$;

revoke all on function public.favoritar_item(uuid, boolean) from public, anon;
grant execute on function public.favoritar_item(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- galerias_do_cliente — a aba Galeria do portal e a lista da ficha
-- ---------------------------------------------------------------------------
create or replace function public.galerias_do_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ve_cliente(p_cliente) then null::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'titulo', coalesce(g.titulo, s.titulo),
        'sessaoId', s.id,
        'quando', s.data,
        'local', s.local,
        'provedor', g.provedor,
        'url', g.url,
        'permiteDownload', g.permite_download,
        'publicadaEm', g.publicada_em,
        'capa', (select i.miniatura_caminho from public.galeria_itens i
                  where i.id = g.capa_item_id),
        'fotos', (select count(*) from public.galeria_itens i
                   where i.galeria_id = g.id and i.tipo = 'foto' and i.pronto),
        'videos', (select count(*) from public.galeria_itens i
                    where i.galeria_id = g.id and i.tipo = 'video' and i.pronto),
        'bytes', coalesce((select sum(i.tamanho_bytes) from public.galeria_itens i
                            where i.galeria_id = g.id and i.pronto), 0),
        'favoritos', (select count(*) from public.galeria_favoritos f where f.galeria_id = g.id),
        'baixou', exists (select 1 from public.galeria_downloads d where d.galeria_id = g.id),
        'links', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'criadoEm', l.criado_em, 'acessos', l.acessos,
            'ultimoAcessoEm', l.ultimo_acesso_em))
          from public.links_galeria l
         where l.galeria_id = g.id and l.revogado_em is null), '[]'::jsonb))
        order by s.data desc)
      from public.galerias g
      join public.sessoes_captacao s on s.id = g.sessao_id
     where s.cliente_id = p_cliente and g.arquivada_em is null), '[]'::jsonb)
  end;
$$;

revoke all on function public.criar_galeria(uuid, text, text) from public, anon;
revoke all on function public.registrar_item_galeria(uuid, text, public.tipo_midia_captacao, text, text, bigint, text, text, integer, integer, numeric) from public, anon;
revoke all on function public.criar_link_galeria(uuid) from public, anon;
revoke all on function public.revogar_link_galeria(uuid) from public, anon;
revoke all on function public.galerias_do_cliente(uuid) from public, anon;
revoke all on function public.galeria_por_token(text) from public;
revoke all on function public.favoritar_por_token(text, uuid, text, boolean) from public;
revoke all on function public.registrar_download_galeria(text, uuid, text) from public;

grant execute on function public.criar_galeria(uuid, text, text) to authenticated;
grant execute on function public.registrar_item_galeria(uuid, text, public.tipo_midia_captacao, text, text, bigint, text, text, integer, integer, numeric) to authenticated;
grant execute on function public.criar_link_galeria(uuid) to authenticated;
grant execute on function public.revogar_link_galeria(uuid) to authenticated;
grant execute on function public.galerias_do_cliente(uuid) to authenticated;

-- Estas tres sao do visitante sem conta: quem valida e o token, e a Edge
-- Function e quem as chama com a service role.
grant execute on function public.galeria_por_token(text) to service_role;
grant execute on function public.favoritar_por_token(text, uuid, text, boolean) to service_role;
grant execute on function public.registrar_download_galeria(text, uuid, text) to service_role;
