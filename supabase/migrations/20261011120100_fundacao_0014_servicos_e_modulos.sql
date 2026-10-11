-- =============================================================================
-- Fundacao — 0014: os seis servicos e a matriz servico -> modulo
--
-- Servico contratado liga modulos. Varios servicos podem ligar o mesmo modulo,
-- e e por isso que a regra mora numa tabela e nao num "if" espalhado pelo codigo.
-- =============================================================================

do $$ begin
  create type public.formato_contrato as enum ('projeto', 'recorrente', 'pontual');
exception when duplicate_object then null; end $$;

create table if not exists public.servicos (
  id             uuid primary key default gen_random_uuid(),
  chave          text not null unique check (chave ~ '^[a-z][a-z0-9_]*$'),
  nome           text not null,
  -- Nulo = o cadastro pergunta. Hoje so o Audiovisual.
  formato_padrao public.formato_contrato,
  ordem          smallint not null default 0,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now()
);

comment on column public.servicos.formato_padrao is
  'Nulo significa que o cadastro pergunta o formato. Audiovisual e o unico.';

create table if not exists public.modulos (
  id     uuid primary key default gen_random_uuid(),
  chave  text not null unique check (chave ~ '^[a-z][a-z0-9_]*$'),
  nome   text not null,
  ordem  smallint not null default 0,
  -- Existe para todo cliente com qualquer servico ativo; fora da matriz.
  sempre boolean not null default false
);

create table if not exists public.servico_modulos (
  servico_id uuid not null references public.servicos(id) on delete cascade,
  modulo_id  uuid not null references public.modulos(id)  on delete cascade,
  -- Opcional = liga so se a chave estiver marcada no contrato do cliente.
  opcional   boolean not null default false,
  primary key (servico_id, modulo_id)
);

-- ---------------------------------------------------------------------------
-- Seed: os seis servicos reais (astartstudio.com.br/solucoes)
-- ---------------------------------------------------------------------------
insert into public.servicos (chave, nome, formato_padrao, ordem) values
  ('branding',          'Branding',          'projeto',    1),
  ('identidade_visual', 'Identidade Visual', 'projeto',    2),
  ('audiovisual',       'Audiovisual',        null,        3),
  ('website',           'Website',           'projeto',    4),
  ('sistemas',          'Sistemas',          'projeto',    5),
  ('gestao_digital',    'Gestão Digital',    'recorrente', 6)
on conflict (chave) do update
   set nome = excluded.nome,
       formato_padrao = excluded.formato_padrao,
       ordem = excluded.ordem;

insert into public.modulos (chave, nome, ordem, sempre) values
  ('marcos',       'Marcos',              1,  false),
  ('entregaveis',  'Entregáveis',         2,  false),
  ('acervo',       'Acervo',              3,  false),
  ('galeria',      'Galeria',             4,  false),
  ('calendario',   'Calendário',          5,  false),
  ('grid',         'Grid',                6,  false),
  ('publicacao',   'Publicação',          7,  false),
  ('campanhas',    'Campanhas',           8,  false),
  ('ambientes',    'Ambientes e acessos', 9,  false),
  ('manutencao',   'Manutenção',          10, false),
  ('integracoes',  'Integrações',         11, false),
  ('financeiro',   'Financeiro',          12, true),
  ('contrato',     'Contrato',            13, true),
  ('nps',          'Feedbacks e NPS',     14, true)
on conflict (chave) do update
   set nome = excluded.nome, ordem = excluded.ordem, sempre = excluded.sempre;

-- A matriz. 'true' na terceira coluna = opcional (liga so se marcado no contrato).
insert into public.servico_modulos (servico_id, modulo_id, opcional)
select s.id, m.id, x.opcional
  from (values
    ('branding',          'marcos',      false),
    ('branding',          'entregaveis', false),
    ('branding',          'acervo',      false),
    ('identidade_visual', 'marcos',      false),
    ('identidade_visual', 'entregaveis', false),
    ('identidade_visual', 'acervo',      false),
    ('audiovisual',       'marcos',      false),
    ('audiovisual',       'entregaveis', false),
    ('audiovisual',       'acervo',      false),
    ('audiovisual',       'galeria',     false),
    ('website',           'marcos',      false),
    ('website',           'entregaveis', false),
    ('website',           'acervo',      false),
    ('website',           'ambientes',   false),
    ('website',           'manutencao',  false),
    ('sistemas',          'marcos',      false),
    ('sistemas',          'entregaveis', false),
    ('sistemas',          'acervo',      false),
    ('sistemas',          'integracoes', false),
    ('sistemas',          'manutencao',  false),
    ('gestao_digital',    'calendario',  false),
    ('gestao_digital',    'grid',        false),
    ('gestao_digital',    'publicacao',  false),
    ('gestao_digital',    'campanhas',   true),
    ('gestao_digital',    'galeria',     true)
  ) as x(servico, modulo, opcional)
  join public.servicos s on s.chave = x.servico
  join public.modulos  m on m.chave = x.modulo
on conflict (servico_id, modulo_id) do update set opcional = excluded.opcional;

-- ---------------------------------------------------------------------------
-- RLS — o catalogo e lido por qualquer autenticado (o portal do cliente precisa
-- do nome do modulo para renderizar). Escrita so admin.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['servicos', 'modulos', 'servico_modulos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);

    execute format('drop policy if exists %I on public.%I', t || '_le', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_le', t);

    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.usuario_admin()) with check (public.usuario_admin())',
      t || '_admin', t);
  end loop;
end $$;
