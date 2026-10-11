-- =============================================================================
-- Modulo — 0025: comercial (CRM)
--
-- As treze etapas sao as que a agencia ja usa no Notion. Negocio fechado vira
-- cliente levando nome, empresa, servico e valor — ninguem redigita.
-- =============================================================================

do $$ begin
  create type public.etapa_lead as enum (
    'novo_lead', 'pronto_abordar', 'aguardando_aprovacao', 'aguardando_edicao',
    'contato_feito', 'em_conversa', 'qualificado', 'reuniao_agendada',
    'proposta_enviada', 'negociacao', 'fechado', 'perdido', 'descartado'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.score_lead as enum ('hot', 'warm', 'cold', 'desqualificado');
exception when duplicate_object then null; end $$;

create table if not exists public.leads (
  id                      uuid primary key default gen_random_uuid(),
  nome                    text not null check (length(btrim(nome)) > 0),
  empresa                 text,
  cargo                   text,
  etapa                   public.etapa_lead not null default 'novo_lead',
  score                   public.score_lead,
  origem                  text,
  canal                   text,
  setor                   text,
  faturamento_estimado    text,
  valor_estimado_centavos bigint check (valor_estimado_centavos is null or valor_estimado_centavos >= 0),

  whatsapp                text,
  linkedin                text,
  instagram               text,
  site                    text,

  gatilho                 text,
  mensagem_proposta       text,
  mensagem_aprovada       text,
  historico               text,
  notas                   text,
  proximo_passo           text,

  data_contato            date,
  ultima_interacao_em     date,
  proximo_followup_em     date,
  reuniao_em              timestamptz,

  responsavel_id          uuid references public.perfis(user_id) on delete set null,
  motivo_desqualificacao  text,
  -- Preenchido quando o lead virou cliente de verdade.
  cliente_id              uuid references public.clientes(id) on delete set null,
  convertido_em           timestamptz,

  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now(),

  constraint leads_conversao_coerente check (
    (cliente_id is null) = (convertido_em is null)),
  constraint leads_so_fechado_converte check (
    cliente_id is null or etapa = 'fechado'),
  constraint leads_perdido_tem_motivo check (
    etapa not in ('perdido', 'descartado') or motivo_desqualificacao is not null)
);

comment on constraint leads_perdido_tem_motivo on public.leads is
  'Perder negocio sem registrar o porque joga fora a unica informacao util '
  'que a perda produz.';

create index if not exists leads_etapa_idx on public.leads (etapa, atualizado_em desc);
create index if not exists leads_followup_idx
  on public.leads (proximo_followup_em)
  where etapa not in ('fechado', 'perdido', 'descartado');

drop trigger if exists leads_atualizado_em on public.leads;
create trigger leads_atualizado_em
  before update on public.leads
  for each row execute function public.tg_set_atualizado_em();

create table if not exists public.lead_servicos (
  lead_id    uuid not null references public.leads(id) on delete cascade,
  servico_id uuid not null references public.servicos(id) on delete cascade,
  primary key (lead_id, servico_id)
);

-- ---------------------------------------------------------------------------
-- RLS — o CRM e interno. Cliente nenhum le, com modulo ou sem.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['leads','lead_servicos'] loop
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
