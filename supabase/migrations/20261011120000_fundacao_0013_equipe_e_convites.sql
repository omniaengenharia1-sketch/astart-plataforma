-- =============================================================================
-- Fundacao — 0013: equipe e convites
--
-- Separa PAPEL (permissao, fechado, lido pelo RLS) de CARGO (o que a pessoa faz
-- na agencia, texto livre, so exibicao). Cargo novo nao pode custar migration.
--
-- Ninguem se cadastra sozinho: toda conta nasce de um convite. O convite NAO
-- expira — decisao do produto, nao esquecimento.
-- =============================================================================

do $$ begin
  create type public.papel_cliente as enum ('principal', 'financeiro', 'leitura');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.destino_convite as enum ('equipe', 'cliente');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- perfis: o time interno
-- ---------------------------------------------------------------------------
alter table public.perfis add column if not exists email         text;
alter table public.perfis add column if not exists cargo         text;
alter table public.perfis add column if not exists telefone      text;
alter table public.perfis add column if not exists avatar_url    text;
alter table public.perfis add column if not exists convidado_por uuid references public.perfis(user_id) on delete set null;
alter table public.perfis add column if not exists desativado_em timestamptz;

comment on column public.perfis.papel is
  'Permissao. Fechado, lido pelo RLS: admin, operacao, financeiro, leitura.';
comment on column public.perfis.cargo is
  'O que a pessoa faz (Social Media, Designer, Comercial). So exibicao.';

-- Espelho do e-mail de auth.users, para listar a equipe sem dar ao front
-- acesso ao schema auth.
update public.perfis p
   set email = u.email
  from auth.users u
 where u.id = p.user_id and p.email is null;

-- Perfil ativo sem e-mail nao tem como receber convite nem ser identificado.
-- Se o backfill acima deixou algum buraco, esta restricao falha alto.
alter table public.perfis drop constraint if exists perfis_email_quando_ativo;
alter table public.perfis add constraint perfis_email_quando_ativo
  check (not ativo or email is not null);

-- Desligado tem que ter data: o log continua apontando para a pessoa.
alter table public.perfis drop constraint if exists perfis_desligamento_datado;
alter table public.perfis add constraint perfis_desligamento_datado
  check (ativo or desativado_em is not null);

create unique index if not exists perfis_email_key
  on public.perfis (lower(email)) where email is not null;

create or replace function public.tg_perfil_desativado_em()
returns trigger
language plpgsql
as $$
begin
  if new.ativo and new.desativado_em is not null then
    new.desativado_em := null;
  elsif not new.ativo and new.desativado_em is null then
    new.desativado_em := now();
  end if;
  return new;
end;
$$;

drop trigger if exists perfis_desativado_em on public.perfis;
create trigger perfis_desativado_em
  before insert or update of ativo on public.perfis
  for each row execute function public.tg_perfil_desativado_em();

-- ---------------------------------------------------------------------------
-- convites — a unica porta de entrada, para equipe e para cliente
-- ---------------------------------------------------------------------------
create table if not exists public.convites (
  id            uuid primary key default gen_random_uuid(),
  destino       public.destino_convite not null,
  email         text not null check (length(btrim(email)) > 0),
  nome          text,

  -- destino = equipe
  papel         public.papel_perfil,
  cargo         text,

  -- destino = cliente
  cliente_id    uuid references public.clientes(id) on delete cascade,
  papel_cliente public.papel_cliente,

  criado_por    uuid references public.perfis(user_id) on delete set null,
  criado_em     timestamptz not null default now(),
  aceito_em     timestamptz,
  aceito_por    uuid references auth.users(id) on delete set null,
  revogado_em   timestamptz,

  constraint convites_coerente check (
    case destino
      when 'equipe'  then papel is not null
                      and cliente_id is null and papel_cliente is null
      when 'cliente' then cliente_id is not null and papel_cliente is not null
                      and papel is null and cargo is null
    end
  ),
  constraint convites_papel_vigente check (papel is null or papel <> 'social'),
  constraint convites_aceite_completo check (
    (aceito_em is null) = (aceito_por is null)
  ),
  constraint convites_aceito_ou_revogado check (
    aceito_em is null or revogado_em is null
  )
);

comment on table public.convites is
  'Nao tem coluna de validade de proposito: convite nao expira. Para fechar um '
  'convite em aberto, preencha revogado_em.';

-- Um convite em aberto por e-mail e destino. Reconvidar exige revogar antes.
create unique index if not exists convites_aberto_equipe_key
  on public.convites (lower(email))
  where destino = 'equipe' and aceito_em is null and revogado_em is null;

create unique index if not exists convites_aberto_cliente_key
  on public.convites (lower(email), cliente_id)
  where destino = 'cliente' and aceito_em is null and revogado_em is null;

create index if not exists convites_abertos_idx
  on public.convites (criado_em desc)
  where aceito_em is null and revogado_em is null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.convites enable row level security;
revoke all on public.convites from anon;

drop policy if exists convites_admin on public.convites;
create policy convites_admin on public.convites
  for all to authenticated
  using (public.usuario_admin())
  with check (public.usuario_admin());

-- A equipe precisa ver os colegas para atribuir responsavel. Escrita segue
-- so com admin; cada um edita o proprio contato.
drop policy if exists perfis_le_proprio on public.perfis;
drop policy if exists perfis_le_equipe on public.perfis;
create policy perfis_le_equipe on public.perfis
  for select to authenticated
  using (public.usuario_ativo() or user_id = auth.uid());

drop policy if exists perfis_edita_proprio on public.perfis;
create policy perfis_edita_proprio on public.perfis
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
