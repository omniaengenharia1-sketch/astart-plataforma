-- =============================================================================
-- Modulo — 0022: captacao e galeria
--
-- Google Drive e Pixieset ainda nao estao confirmados. Por isso a galeria e
-- provedor-agnostica: guarda o link e os metadados que SAO nossos. Se um dia
-- der para ler a pasta pela API, os itens entram em galeria_itens sem mexer
-- em nada do que ja existe.
-- =============================================================================

do $$ begin
  create type public.status_captacao as enum ('agendada', 'realizada', 'entregue', 'cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_midia_captacao as enum ('foto', 'video');
exception when duplicate_object then null; end $$;

create table if not exists public.sessoes_captacao (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references public.clientes(id) on delete cascade,
  cliente_servico_id uuid references public.cliente_servicos(id) on delete set null,
  titulo             text not null check (length(btrim(titulo)) > 0),
  data               date not null,
  hora               time,
  local              text,
  responsavel_id     uuid references public.perfis(user_id) on delete set null,
  status             public.status_captacao not null default 'agendada',
  entrega_ate        date,
  -- Contagem que a equipe mantem. Nao ha API confirmada que devolva isto.
  qtd_fotos          integer not null default 0 check (qtd_fotos  >= 0),
  qtd_videos         integer not null default 0 check (qtd_videos >= 0),
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint sessoes_captacao_entrega check (entrega_ate is null or entrega_ate >= data)
);

create index if not exists sessoes_captacao_cliente_idx
  on public.sessoes_captacao (cliente_id, data desc);
create index if not exists sessoes_captacao_agenda_idx
  on public.sessoes_captacao (data) where status = 'agendada';

drop trigger if exists sessoes_captacao_atualizado_em on public.sessoes_captacao;
create trigger sessoes_captacao_atualizado_em
  before update on public.sessoes_captacao
  for each row execute function public.tg_set_atualizado_em();

create table if not exists public.galerias (
  id         uuid primary key default gen_random_uuid(),
  sessao_id  uuid not null references public.sessoes_captacao(id) on delete cascade,
  provedor   text not null check (provedor in ('drive', 'pixieset', 'storage', 'outro')),
  url        text,
  -- Id da pasta ou da colecao do lado de la, quando houver.
  externo_id text,
  senha_dica text,
  criado_em  timestamptz not null default now(),
  constraint galerias_tem_endereco check (url is not null or externo_id is not null)
);

comment on column public.galerias.senha_dica is
  'Onde a senha esta, nunca a senha. Mesmo principio dos acessos do site.';

create index if not exists galerias_sessao_idx on public.galerias (sessao_id);

create table if not exists public.galeria_itens (
  id          uuid primary key default gen_random_uuid(),
  galeria_id  uuid not null references public.galerias(id) on delete cascade,
  tipo        public.tipo_midia_captacao not null,
  nome        text not null,
  caminho     text,
  url_externa text,
  criado_em   timestamptz not null default now(),
  constraint galeria_itens_tem_destino check (
    (caminho is not null) <> (url_externa is not null))
);

comment on table public.galeria_itens is
  'Fica vazia enquanto a integracao nao ler a pasta. A galeria funciona so '
  'com o link; esta tabela e o lugar pronto para quando der.';

create index if not exists galeria_itens_galeria_idx on public.galeria_itens (galeria_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sessoes_captacao','galerias','galeria_itens'] loop
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

drop policy if exists sessoes_captacao_cliente_le on public.sessoes_captacao;
create policy sessoes_captacao_cliente_le on public.sessoes_captacao
  for select to authenticated
  using (
    cliente_id in (select public.clientes_do_usuario())
    and public.cliente_tem_modulo(cliente_id, 'galeria')
  );

drop policy if exists galerias_cliente_le on public.galerias;
create policy galerias_cliente_le on public.galerias
  for select to authenticated
  using (exists (select 1 from public.sessoes_captacao s
                  where s.id = sessao_id
                    and s.cliente_id in (select public.clientes_do_usuario())
                    and public.cliente_tem_modulo(s.cliente_id, 'galeria')));

drop policy if exists galeria_itens_cliente_le on public.galeria_itens;
create policy galeria_itens_cliente_le on public.galeria_itens
  for select to authenticated
  using (exists (select 1 from public.galerias g
                   join public.sessoes_captacao s on s.id = g.sessao_id
                  where g.id = galeria_id
                    and s.cliente_id in (select public.clientes_do_usuario())
                    and public.cliente_tem_modulo(s.cliente_id, 'galeria')));
