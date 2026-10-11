-- =============================================================================
-- Modulo — 0021: campanhas de trafego pago
--
-- Isto NAO e painel de midia: e relatorio publicado. A equipe alimenta, o
-- cliente le. Se um dia virar leitura automatica da API da Meta, e outro modulo.
--
-- As metricas sao chave/valor de proposito: Meta, Google e TikTok nao reportam
-- as mesmas coisas, e um conjunto fixo de colunas ia mentir em dois deles.
-- =============================================================================

do $$ begin
  create type public.plataforma_midia as enum ('meta', 'google', 'tiktok', 'outra');
exception when duplicate_object then null; end $$;

create table if not exists public.relatorios_campanha (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  periodo_inicio date not null,
  periodo_fim    date not null,
  arquivo_nome   text,
  arquivo_caminho text,
  enviado_por    uuid references public.perfis(user_id) on delete set null,
  enviado_em     timestamptz not null default now(),
  constraint relatorios_campanha_periodo check (periodo_fim >= periodo_inicio),
  unique (cliente_id, periodo_inicio, periodo_fim)
);

create index if not exists relatorios_campanha_cliente_idx
  on public.relatorios_campanha (cliente_id, periodo_inicio desc);

create table if not exists public.campanhas (
  id             uuid primary key default gen_random_uuid(),
  relatorio_id   uuid not null references public.relatorios_campanha(id) on delete cascade,
  nome           text not null check (length(btrim(nome)) > 0),
  plataforma     public.plataforma_midia not null,
  objetivo       text,
  inicio         date,
  fim            date,
  verba_centavos bigint not null default 0 check (verba_centavos >= 0),
  -- O resultado que importa muda por objetivo: alcance, conversa, clique.
  resultado_rotulo text,
  resultado_valor  numeric,
  constraint campanhas_periodo check (fim is null or inicio is null or fim >= inicio),
  constraint campanhas_resultado_completo check (
    (resultado_rotulo is null) = (resultado_valor is null))
);

create index if not exists campanhas_relatorio_idx on public.campanhas (relatorio_id);

create table if not exists public.relatorio_metricas (
  relatorio_id uuid not null references public.relatorios_campanha(id) on delete cascade,
  chave        text not null check (chave ~ '^[a-z][a-z0-9_]*$'),
  rotulo       text not null,
  valor        numeric not null,
  ordem        smallint not null default 0,
  primary key (relatorio_id, chave)
);

comment on table public.relatorio_metricas is
  'Chave/valor porque cada plataforma reporta coisas diferentes. Colunas fixas '
  'mentiriam em pelo menos uma delas.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['relatorios_campanha','campanhas','relatorio_metricas'] loop
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

drop policy if exists relatorios_campanha_cliente_le on public.relatorios_campanha;
create policy relatorios_campanha_cliente_le on public.relatorios_campanha
  for select to authenticated
  using (
    cliente_id in (select public.clientes_do_usuario())
    and public.cliente_tem_modulo(cliente_id, 'campanhas')
  );

drop policy if exists campanhas_cliente_le on public.campanhas;
create policy campanhas_cliente_le on public.campanhas
  for select to authenticated
  using (exists (select 1 from public.relatorios_campanha r
                  where r.id = relatorio_id
                    and r.cliente_id in (select public.clientes_do_usuario())
                    and public.cliente_tem_modulo(r.cliente_id, 'campanhas')));

drop policy if exists relatorio_metricas_cliente_le on public.relatorio_metricas;
create policy relatorio_metricas_cliente_le on public.relatorio_metricas
  for select to authenticated
  using (exists (select 1 from public.relatorios_campanha r
                  where r.id = relatorio_id
                    and r.cliente_id in (select public.clientes_do_usuario())
                    and public.cliente_tem_modulo(r.cliente_id, 'campanhas')));
