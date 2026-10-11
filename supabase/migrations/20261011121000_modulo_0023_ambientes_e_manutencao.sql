-- =============================================================================
-- Modulo — 0023: ambientes, integracoes e manutencao (Website e Sistemas)
--
-- Nenhuma senha mora aqui. O que se guarda e ONDE a chave esta — mesma regra
-- do token da Meta, que vive no cofre e nunca encosta no navegador.
-- =============================================================================

do $$ begin
  create type public.prioridade_chamado as enum ('baixa', 'media', 'alta');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.status_chamado as enum ('aberto', 'em_analise', 'resolvido', 'descartado');
exception when duplicate_object then null; end $$;

create table if not exists public.ambientes (
  id                 uuid primary key default gen_random_uuid(),
  cliente_servico_id uuid not null references public.cliente_servicos(id) on delete cascade,
  nome               text not null check (length(btrim(nome)) > 0),
  url                text,
  hospedagem         text,
  ssl_renova_em      date,
  no_ar              boolean not null default false,
  criado_em          timestamptz not null default now(),
  unique (cliente_servico_id, nome)
);

create table if not exists public.dominios (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes(id) on delete cascade,
  dominio      text not null unique,
  registrador  text,
  titular      text,
  vence_em     date,
  criado_em    timestamptz not null default now()
);

create index if not exists dominios_vencimento_idx on public.dominios (vence_em);

create table if not exists public.acessos (
  id                 uuid primary key default gen_random_uuid(),
  cliente_servico_id uuid not null references public.cliente_servicos(id) on delete cascade,
  descricao          text not null check (length(btrim(descricao)) > 0),
  -- "cofre da Astart", "com o cliente", "1Password da equipe". Nunca a senha.
  onde               text not null check (length(btrim(onde)) > 0),
  criado_em          timestamptz not null default now()
);

comment on column public.acessos.onde is
  'Onde a credencial esta guardada. Se um dia aparecer senha nesta coluna, '
  'e bug de quem escreveu, nao do schema — mas o schema tambem nao convida.';

create table if not exists public.integracoes (
  id                 uuid primary key default gen_random_uuid(),
  cliente_servico_id uuid not null references public.cliente_servicos(id) on delete cascade,
  nome               text not null check (length(btrim(nome)) > 0),
  categoria          text,
  ativa              boolean not null default true,
  observacao         text,
  criado_em          timestamptz not null default now()
);

create table if not exists public.chamados (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references public.clientes(id) on delete cascade,
  cliente_servico_id uuid references public.cliente_servicos(id) on delete set null,
  titulo             text not null check (length(btrim(titulo)) > 0),
  descricao          text,
  prioridade         public.prioridade_chamado not null default 'media',
  status             public.status_chamado not null default 'aberto',
  aberto_por_tipo    public.autor_tipo not null default 'agencia',
  aberto_por_nome    text not null check (length(btrim(aberto_por_nome)) > 0),
  responsavel_id     uuid references public.perfis(user_id) on delete set null,
  resolvido_em       timestamptz,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint chamados_resolucao_datada check (
    (status = 'resolvido') = (resolvido_em is not null))
);

create index if not exists chamados_abertos_idx
  on public.chamados (cliente_id, criado_em desc)
  where status in ('aberto', 'em_analise');

drop trigger if exists chamados_atualizado_em on public.chamados;
create trigger chamados_atualizado_em
  before update on public.chamados
  for each row execute function public.tg_set_atualizado_em();

create table if not exists public.chamado_comentarios (
  id         uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.chamados(id) on delete cascade,
  autor_tipo public.autor_tipo not null,
  autor_nome text not null check (length(btrim(autor_nome)) > 0),
  texto      text not null check (length(btrim(texto)) > 0),
  criado_em  timestamptz not null default now()
);

create index if not exists chamado_comentarios_idx
  on public.chamado_comentarios (chamado_id, criado_em);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ambientes','dominios','acessos','integracoes',
                           'chamados','chamado_comentarios'] loop
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

drop policy if exists ambientes_cliente_le on public.ambientes;
create policy ambientes_cliente_le on public.ambientes
  for select to authenticated
  using (exists (select 1 from public.cliente_servicos cs
                  where cs.id = cliente_servico_id
                    and cs.cliente_id in (select public.clientes_do_usuario())
                    and public.cliente_tem_modulo(cs.cliente_id, 'ambientes')));

drop policy if exists dominios_cliente_le on public.dominios;
create policy dominios_cliente_le on public.dominios
  for select to authenticated
  using (
    cliente_id in (select public.clientes_do_usuario())
    and public.cliente_tem_modulo(cliente_id, 'ambientes')
  );

-- Acessos e integracoes sao trabalho interno: o cliente nao le, nem com modulo.

drop policy if exists chamados_cliente_le on public.chamados;
create policy chamados_cliente_le on public.chamados
  for select to authenticated
  using (
    cliente_id in (select public.clientes_do_usuario())
    and public.cliente_tem_modulo(cliente_id, 'manutencao')
  );

drop policy if exists chamados_cliente_abre on public.chamados;
create policy chamados_cliente_abre on public.chamados
  for insert to authenticated
  with check (
    cliente_id in (select public.clientes_do_usuario())
    and public.cliente_tem_modulo(cliente_id, 'manutencao')
    and aberto_por_tipo = 'cliente'
    and status = 'aberto'
  );

drop policy if exists chamado_comentarios_cliente_le on public.chamado_comentarios;
create policy chamado_comentarios_cliente_le on public.chamado_comentarios
  for select to authenticated
  using (exists (select 1 from public.chamados c
                  where c.id = chamado_id
                    and c.cliente_id in (select public.clientes_do_usuario())
                    and public.cliente_tem_modulo(c.cliente_id, 'manutencao')));
