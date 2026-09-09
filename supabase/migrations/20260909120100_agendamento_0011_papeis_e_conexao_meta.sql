-- =============================================================================
-- 0011: papeis do time e conexao com a Meta
--
-- Fecha duas divergencias entre o escopo e o que a Fase 1 construiu:
--   1. Papeis passam a ser admin | operacao | financeiro | leitura.
--   2. contas_sociais passa a distinguir System User de OAuth, e a guardar o
--      estado do acesso de parceiro no Business Manager.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Papeis
-- ---------------------------------------------------------------------------

-- 'social' vira 'operacao'. O valor antigo continua no tipo porque o Postgres
-- nao remove valor de enum; a constraint abaixo impede que volte a ser usado.
update public.perfis set papel = 'operacao' where papel = 'social';

alter table public.perfis alter column papel set default 'operacao';

alter table public.perfis drop constraint if exists perfis_papel_vigente;
alter table public.perfis
  add constraint perfis_papel_vigente check (papel <> 'social');

comment on column public.perfis.papel is
  'admin mexe em contas e tokens; operacao cria e publica; financeiro lanca e '
  'concilia; leitura so acompanha. "social" e legado da Fase 1.';

-- Quem edita conteudo. Financeiro nao publica, e leitura nao escreve nada.
create or replace function public.usuario_edita()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.perfis p
     where p.user_id = auth.uid()
       and p.ativo
       and p.papel in ('admin', 'operacao')
  );
$$;

create or replace function public.usuario_financeiro()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.perfis p
     where p.user_id = auth.uid()
       and p.ativo
       and p.papel in ('admin', 'financeiro')
  );
$$;

-- A 0002 criou os helpers sem revoke, entao anon herdou execute. Nenhum deles
-- vaza dado (auth.uid() nulo devolve false), mas nao ha razao para anon chamar.
do $$
declare f text;
begin
  foreach f in array array[
    'public.usuario_ativo()',
    'public.usuario_edita()',
    'public.usuario_admin()',
    'public.usuario_financeiro()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Conexao com a Meta
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.origem_token as enum ('system_user', 'oauth');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.acesso_parceiro as enum ('concedido', 'pendente', 'expirado');
exception when duplicate_object then null; end $$;

alter table public.contas_sociais
  add column if not exists origem_token    public.origem_token   not null default 'system_user',
  add column if not exists token_expira_em timestamptz,
  add column if not exists acesso_parceiro public.acesso_parceiro not null default 'concedido',
  add column if not exists conectado_por   uuid references auth.users(id) on delete set null,
  add column if not exists conectado_em    timestamptz;

comment on column public.contas_sociais.origem_token is
  'system_user: token do BM da Astart, nao expira, sem rotina de refresh. '
  'oauth: excecao para cliente sem Business Manager, expira e precisa renovar.';
comment on column public.contas_sociais.acesso_parceiro is
  'Estado do compartilhamento da Pagina e do Instagram com o BM da Astart. '
  'Sem "concedido", a conta nao publica.';

-- Invariante que separa os dois regimes: token de System User nao tem
-- vencimento, e token de OAuth sempre tem. Sem isso, uma conta OAuth entraria
-- no banco sem data e a rotina de renovacao nunca a veria.
alter table public.contas_sociais drop constraint if exists contas_sociais_token_coerente;
alter table public.contas_sociais
  add constraint contas_sociais_token_coerente check (
    (origem_token = 'system_user' and token_expira_em is null)
    or
    (origem_token = 'oauth' and token_expira_em is not null)
  );

-- Query da rotina de renovacao.
create index if not exists contas_sociais_token_vencendo_idx
  on public.contas_sociais (token_expira_em)
  where origem_token = 'oauth' and ativo;

-- ---------------------------------------------------------------------------
-- Contas com token proximo do vencimento
-- ---------------------------------------------------------------------------
-- Separa os dois casos de proposito: token "vencendo" ainda da para renovar
-- sozinho; token "vencido" so volta com alguem reconectando a conta. A rotina
-- de renovacao trata um; a outra vira alerta para o time.
create or replace function public.contas_com_token_vencendo(p_dias integer default 7)
returns table (
  conta_social_id uuid,
  cliente_nome    text,
  nome_exibicao   text,
  token_expira_em timestamptz,
  horas_restantes integer,
  situacao        text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id,
         cl.nome,
         c.nome_exibicao,
         c.token_expira_em,
         greatest(floor(extract(epoch from (c.token_expira_em - now())) / 3600), 0)::integer,
         case when c.token_expira_em <= now() then 'vencido' else 'vencendo' end
    from public.contas_sociais c
    join public.clientes cl on cl.id = c.cliente_id
   where c.origem_token = 'oauth'
     and c.ativo
     and c.token_expira_em is not null
     and c.token_expira_em <= now() + make_interval(days => greatest(p_dias, 1))
   order by c.token_expira_em;
$$;

revoke all on function public.contas_com_token_vencendo(integer) from public, anon, authenticated;
grant execute on function public.contas_com_token_vencendo(integer) to service_role;

-- ---------------------------------------------------------------------------
-- O worker passa a recusar conta sem acesso de parceiro, com mensagem legivel.
-- Antes, isso so aparecia como erro cru da Meta na hora de publicar.
-- ---------------------------------------------------------------------------
create or replace function public.obter_token_conta(p_conta_social_id uuid)
returns table (
  conta_social_id uuid,
  plataforma      public.plataforma_social,
  ig_user_id      text,
  page_id         text,
  access_token    text
)
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_conta public.contas_sociais%rowtype;
  v_ref   text;
  v_token text;
begin
  select * into v_conta from public.contas_sociais c where c.id = p_conta_social_id;

  if not found then
    raise exception 'Conta social % nao encontrada.', p_conta_social_id;
  end if;
  if not v_conta.ativo then
    raise exception 'A conta "%" esta inativa.', v_conta.nome_exibicao;
  end if;

  if v_conta.acesso_parceiro = 'pendente' then
    raise exception
      'A conta "%" ainda nao aceitou o convite de parceiro no Business Manager da Astart. '
      'Peca ao cliente para aceitar antes de reagendar.', v_conta.nome_exibicao;
  end if;
  if v_conta.acesso_parceiro = 'expirado' then
    raise exception
      'O acesso de parceiro a conta "%" foi removido no Business Manager. '
      'Reative antes de reagendar.', v_conta.nome_exibicao;
  end if;

  if v_conta.origem_token = 'oauth' and v_conta.token_expira_em <= now() then
    raise exception
      'O token de acesso da conta "%" venceu em %. Reconecte a conta.',
      v_conta.nome_exibicao, to_char(v_conta.token_expira_em, 'DD/MM/YYYY');
  end if;

  -- Sem token_ref => token de System User do BM da Astart.
  v_ref := coalesce(nullif(btrim(v_conta.token_ref), ''), 'meta_system_user_token');

  select s.decrypted_secret into v_token
    from vault.decrypted_secrets s
   where s.name = v_ref
   limit 1;

  if v_token is null or length(btrim(v_token)) = 0 then
    raise exception 'Token da Meta ausente no Vault (chave "%"). Cadastre o token antes de publicar.', v_ref;
  end if;

  return query
    select v_conta.id, v_conta.plataforma, v_conta.ig_user_id, v_conta.page_id, v_token;
end;
$$;

revoke all on function public.obter_token_conta(uuid) from public, anon, authenticated;
grant execute on function public.obter_token_conta(uuid) to service_role;
