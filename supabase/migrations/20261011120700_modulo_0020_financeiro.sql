-- =============================================================================
-- Modulo — 0020: financeiro
--
-- Hierarquia de tres niveis (Grupo > Categoria > Subcategoria), rateio por
-- cliente que tem que fechar exato com o total, e classificacao sugerida pela
-- IA que NUNCA se aplica sozinha: guarda-se o sugerido e o aceito, lado a lado.
--
-- A integracao de cobranca (Asaas) ainda nao entrou. A tabela cobrancas existe
-- sem amarra de provedor, para nao desenhar contra uma API nao confirmada.
-- =============================================================================

do $$ begin
  create type public.natureza_lancamento as enum ('receita', 'custo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.forma_pagamento as enum
    ('pix', 'boleto', 'cartao', 'transferencia', 'dinheiro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.status_lancamento as enum ('previsto', 'liquidado', 'cancelado');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Hierarquia
-- ---------------------------------------------------------------------------
create table if not exists public.financeiro_grupos (
  id       uuid primary key default gen_random_uuid(),
  chave    text not null unique check (chave ~ '^[a-z][a-z0-9_]*$'),
  nome     text not null,
  natureza public.natureza_lancamento not null,
  ordem    smallint not null default 0
);

create table if not exists public.financeiro_categorias (
  id       uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.financeiro_grupos(id) on delete cascade,
  nome     text not null check (length(btrim(nome)) > 0),
  ordem    smallint not null default 0,
  unique (grupo_id, nome)
);

create table if not exists public.financeiro_subcategorias (
  id           uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references public.financeiro_categorias(id) on delete cascade,
  nome         text not null check (length(btrim(nome)) > 0),
  ordem        smallint not null default 0,
  unique (categoria_id, nome)
);

-- ---------------------------------------------------------------------------
-- Lancamentos
-- ---------------------------------------------------------------------------
create table if not exists public.lancamentos (
  id              uuid primary key default gen_random_uuid(),
  descricao       text not null check (length(btrim(descricao)) > 0),
  subcategoria_id uuid not null references public.financeiro_subcategorias(id),
  -- Quem pagou ou recebeu. Cliente nosso tem id; freela e fornecedor so nome.
  cliente_id      uuid references public.clientes(id) on delete set null,
  contraparte     text,

  valor_centavos  bigint not null check (valor_centavos > 0),
  forma           public.forma_pagamento,
  -- Mes a que o lancamento pertence, independente de quando o dinheiro anda.
  competencia     date not null,
  vencimento      date,
  liquidado_em    date,
  status          public.status_lancamento not null default 'previsto',

  -- Classificacao sugerida pela IA. Guardamos as duas pontas para medir
  -- depois se a sugestao presta ou se esta fazendo a equipe perder tempo.
  subcategoria_sugerida_id uuid references public.financeiro_subcategorias(id),
  sugerido_em      timestamptz,
  sugestao_modelo  text,
  aceito_por       uuid references public.perfis(user_id) on delete set null,
  aceito_em        timestamptz,

  criado_por       uuid references public.perfis(user_id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  constraint lancamentos_liquidacao_datada check (
    (status = 'liquidado') = (liquidado_em is not null)
  ),
  constraint lancamentos_sugestao_datada check (
    (subcategoria_sugerida_id is null) = (sugerido_em is null)
  ),
  constraint lancamentos_aceite_datado check (
    (aceito_por is null) = (aceito_em is null)
  )
);

comment on column public.lancamentos.competencia is
  'O mes a que o lancamento pertence. O dinheiro pode andar em outro mes.';
comment on column public.lancamentos.subcategoria_sugerida_id is
  'O que a IA achou. A coluna que vale e subcategoria_id, preenchida por gente.';

create index if not exists lancamentos_competencia_idx
  on public.lancamentos (competencia desc);
create index if not exists lancamentos_vencidos_idx
  on public.lancamentos (vencimento)
  where status = 'previsto' and vencimento is not null;
create index if not exists lancamentos_cliente_idx
  on public.lancamentos (cliente_id, vencimento desc) where cliente_id is not null;

drop trigger if exists lancamentos_atualizado_em on public.lancamentos;
create trigger lancamentos_atualizado_em
  before update on public.lancamentos
  for each row execute function public.tg_set_atualizado_em();

-- Status "atrasado" nao e guardado: e derivado da data. Guardar significaria
-- uma rotina para virar a chave todo dia, e um dia ela falha calada.
create or replace view public.lancamentos_com_situacao as
  select l.*,
         g.natureza,
         g.nome  as grupo,
         cat.nome as categoria,
         sub.nome as subcategoria,
         case
           when l.status = 'cancelado' then 'cancelado'
           when l.status = 'liquidado' then
             case g.natureza when 'receita' then 'recebido' else 'pago' end
           when l.vencimento is not null and l.vencimento < current_date then 'atrasado'
           else 'previsto'
         end as situacao
    from public.lancamentos l
    join public.financeiro_subcategorias sub on sub.id = l.subcategoria_id
    join public.financeiro_categorias   cat on cat.id = sub.categoria_id
    join public.financeiro_grupos         g on g.id = cat.grupo_id;

alter view public.lancamentos_com_situacao set (security_invoker = on);
revoke all on public.lancamentos_com_situacao from anon;

-- ---------------------------------------------------------------------------
-- Rateio por cliente. A soma tem que bater exata com o total — validado aqui,
-- no commit, nao na tela.
-- ---------------------------------------------------------------------------
create table if not exists public.lancamento_rateios (
  lancamento_id  uuid not null references public.lancamentos(id) on delete cascade,
  cliente_id     uuid not null references public.clientes(id) on delete restrict,
  valor_centavos bigint not null check (valor_centavos > 0),
  primary key (lancamento_id, cliente_id)
);

create or replace function public.tg_rateio_fecha_exato()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_lanc  uuid := coalesce(new.lancamento_id, old.lancamento_id);
  v_total bigint;
  v_soma  bigint;
begin
  select valor_centavos into v_total from public.lancamentos where id = v_lanc;
  if v_total is null then
    return null; -- lancamento foi apagado junto; nada a conferir
  end if;

  select coalesce(sum(valor_centavos), 0) into v_soma
    from public.lancamento_rateios where lancamento_id = v_lanc;

  if v_soma <> 0 and v_soma <> v_total then
    raise exception
      'O rateio soma % e o lancamento e de %. Tem que bater exato.',
      (v_soma::numeric / 100)::money, (v_total::numeric / 100)::money;
  end if;
  return null;
end;
$$;

drop trigger if exists lancamento_rateios_fecha on public.lancamento_rateios;
create constraint trigger lancamento_rateios_fecha
  after insert or update or delete on public.lancamento_rateios
  deferrable initially deferred
  for each row execute function public.tg_rateio_fecha_exato();

comment on function public.tg_rateio_fecha_exato() is
  'Gatilho de restricao adiado: confere no commit, para dar para inserir as '
  'linhas do rateio uma a uma sem a primeira ja estourar.';

-- Mudar o valor do lancamento tambem precisa conferir o rateio.
create or replace function public.tg_lancamento_confere_rateio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_soma bigint;
begin
  select coalesce(sum(valor_centavos), 0) into v_soma
    from public.lancamento_rateios where lancamento_id = new.id;
  if v_soma <> 0 and v_soma <> new.valor_centavos then
    raise exception
      'Mudar o valor quebraria o rateio: ele soma %. Refaça o rateio primeiro.',
      (v_soma::numeric / 100)::money;
  end if;
  return null;
end;
$$;

drop trigger if exists lancamentos_confere_rateio on public.lancamentos;
create constraint trigger lancamentos_confere_rateio
  after update of valor_centavos on public.lancamentos
  deferrable initially deferred
  for each row execute function public.tg_lancamento_confere_rateio();

-- ---------------------------------------------------------------------------
-- Cobranca — o artefato que o cliente ve. Sem amarra de provedor: a Asaas
-- entra depois, quando estiver confirmada.
-- ---------------------------------------------------------------------------
create table if not exists public.cobrancas (
  id            uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null unique references public.lancamentos(id) on delete cascade,
  provedor      text,
  externo_id    text,
  boleto_url    text,
  pix_payload   text,
  emitida_em    timestamptz,
  criado_em     timestamptz not null default now(),
  unique (provedor, externo_id)
);

comment on table public.cobrancas is
  'Vazia ate a integracao de cobranca entrar. provedor e externo_id ficam '
  'genericos de proposito.';

-- ---------------------------------------------------------------------------
-- Gerar as cobrancas do contrato
-- ---------------------------------------------------------------------------
create or replace function public.gerar_cobrancas_do_contrato(
  p_cliente_servico_id uuid,
  p_competencia        date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cs    public.cliente_servicos;
  v_sub   uuid;
  v_nome  text;
  v_mes   date := date_trunc('month', p_competencia)::date;
  v_venc  date;
  v_n     integer := 0;
  v_i     smallint;
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'Sem permissao para gerar cobranca.';
  end if;

  select * into v_cs from public.cliente_servicos where id = p_cliente_servico_id;
  if v_cs.id is null then raise exception 'Contrato nao encontrado.'; end if;

  select s.nome into v_nome from public.servicos s where s.id = v_cs.servico_id;

  select sub.id into v_sub
    from public.financeiro_subcategorias sub
    join public.financeiro_categorias cat on cat.id = sub.categoria_id
    join public.financeiro_grupos       g on g.id = cat.grupo_id
   where g.chave = 'receita' and cat.nome = 'Contrato'
     and sub.nome = case v_cs.formato
                      when 'recorrente' then 'Recorrente'
                      when 'projeto'    then 'Projeto'
                      else 'Pontual' end;

  if v_cs.formato = 'recorrente' then
    v_venc := make_date(extract(year from v_mes)::int, extract(month from v_mes)::int,
                        v_cs.dia_vencimento);
    if exists (select 1 from public.lancamentos
                where cliente_id = v_cs.cliente_id and competencia = v_mes
                  and descricao = v_nome || ' — ' || to_char(v_mes, 'MM/YYYY')) then
      return 0;
    end if;
    insert into public.lancamentos
      (descricao, subcategoria_id, cliente_id, valor_centavos, competencia, vencimento, criado_por)
    values (v_nome || ' — ' || to_char(v_mes, 'MM/YYYY'), v_sub, v_cs.cliente_id,
            v_cs.valor_centavos, v_mes, v_venc, auth.uid());
    return 1;
  end if;

  -- projeto e pontual: uma linha por parcela, mes a mes a partir da competencia
  if exists (select 1 from public.lancamentos
              where cliente_id = v_cs.cliente_id
                and descricao like v_nome || ' — parcela%') then
    return 0;
  end if;

  for v_i in 1 .. v_cs.parcelas loop
    insert into public.lancamentos
      (descricao, subcategoria_id, cliente_id, valor_centavos, competencia, vencimento, criado_por)
    values (format('%s — parcela %s de %s', v_nome, v_i, v_cs.parcelas), v_sub, v_cs.cliente_id,
            -- a ultima parcela absorve o centavo que a divisao deixou
            case when v_i < v_cs.parcelas
                 then v_cs.valor_centavos / v_cs.parcelas
                 else v_cs.valor_centavos - (v_cs.valor_centavos / v_cs.parcelas) * (v_cs.parcelas - 1)
            end,
            (v_mes + make_interval(months => v_i - 1))::date,
            (v_mes + make_interval(months => v_i - 1))::date + 14,
            auth.uid());
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.gerar_cobrancas_do_contrato(uuid, date) from public, anon;
grant execute on function public.gerar_cobrancas_do_contrato(uuid, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seed da hierarquia (as categorias reais do Notion da agencia)
-- ---------------------------------------------------------------------------
insert into public.financeiro_grupos (chave, nome, natureza, ordem) values
  ('receita', 'Receita', 'receita', 1),
  ('custo',   'Custo',   'custo',   2)
on conflict (chave) do update set nome = excluded.nome, natureza = excluded.natureza;

insert into public.financeiro_categorias (grupo_id, nome, ordem)
select g.id, x.cat, x.ordem
  from (values
    ('receita','Contrato',1), ('receita','Outros',2),
    ('custo','Freela',1), ('custo','Equipe',2), ('custo','Aplicativo',3),
    ('custo','Transporte',4), ('custo','Alimentação',5),
    ('custo','Cartão Agência',6), ('custo','Outro',7)
  ) as x(grupo, cat, ordem)
  join public.financeiro_grupos g on g.chave = x.grupo
on conflict (grupo_id, nome) do nothing;

insert into public.financeiro_subcategorias (categoria_id, nome, ordem)
select c.id, x.sub, x.ordem
  from (values
    ('receita','Contrato','Recorrente',1), ('receita','Contrato','Projeto',2),
    ('receita','Contrato','Pontual',3),
    ('receita','Outros','Reembolso',1), ('receita','Outros','Diversos',2),
    ('custo','Freela','Audiovisual',1), ('custo','Freela','Design',2),
    ('custo','Freela','Redação',3), ('custo','Freela','Desenvolvimento',4),
    ('custo','Equipe','Salário',1), ('custo','Equipe','Pró-labore',2),
    ('custo','Equipe','Benefício',3),
    ('custo','Aplicativo','Assinatura',1), ('custo','Aplicativo','Mídia',2),
    ('custo','Transporte','Combustível',1), ('custo','Transporte','Aplicativo',2),
    ('custo','Alimentação','Equipe',1), ('custo','Alimentação','Cliente',2),
    ('custo','Cartão Agência','Diversos',1),
    ('custo','Outro','Diversos',1)
  ) as x(grupo, cat, sub, ordem)
  join public.financeiro_grupos g      on g.chave = x.grupo
  join public.financeiro_categorias c  on c.grupo_id = g.id and c.nome = x.cat
on conflict (categoria_id, nome) do nothing;

-- ---------------------------------------------------------------------------
-- RLS — financeiro e de admin e financeiro. Operacao nao entra.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['financeiro_grupos','financeiro_categorias','financeiro_subcategorias'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_le', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.usuario_ativo())',
      t || '_le', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.usuario_admin()) with check (public.usuario_admin())',
      t || '_admin', t);
  end loop;

  foreach t in array array['lancamentos','lancamento_rateios','cobrancas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_financeiro', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.usuario_financeiro()) with check (public.usuario_financeiro())',
      t || '_financeiro', t);
  end loop;
end $$;

-- Politica de RLS nao pode consultar tabela que tambem tem RLS: a subconsulta
-- roda como o proprio usuario e volta vazia, escondendo tudo em silencio.
-- Por isso a natureza vem de uma funcao SECURITY DEFINER.
create or replace function public.subcategoria_natureza(p_sub uuid)
returns public.natureza_lancamento
language sql stable security definer
set search_path = public, pg_temp
as $$
  select g.natureza
    from public.financeiro_subcategorias sub
    join public.financeiro_categorias cat on cat.id = sub.categoria_id
    join public.financeiro_grupos       g on g.id = cat.grupo_id
   where sub.id = p_sub;
$$;

revoke all on function public.subcategoria_natureza(uuid) from public, anon;
grant execute on function public.subcategoria_natureza(uuid) to authenticated, service_role;

-- O cliente ve as proprias cobrancas: so receita, so dele, so com o modulo.
drop policy if exists lancamentos_cliente_le on public.lancamentos;
create policy lancamentos_cliente_le on public.lancamentos
  for select to authenticated
  using (
    cliente_id in (select public.clientes_do_usuario())
    and public.cliente_tem_modulo(cliente_id, 'financeiro')
    and public.subcategoria_natureza(subcategoria_id) = 'receita'
  );

drop policy if exists cobrancas_cliente_le on public.cobrancas;
create policy cobrancas_cliente_le on public.cobrancas
  for select to authenticated
  using (exists (
    select 1 from public.lancamentos l
     where l.id = lancamento_id
       and l.cliente_id in (select public.clientes_do_usuario())
       and public.cliente_tem_modulo(l.cliente_id, 'financeiro')));

-- O cliente precisa do rotulo da propria cobranca ("Contrato > Recorrente"),
-- entao le o ramo de RECEITA da hierarquia. O ramo de custo continua interno.
--
-- Repare que cada politica abaixo consulta a tabela de cima, que tambem tem
-- RLS — e aqui isso funciona justamente porque o cliente PODE ver aquelas
-- linhas. Quando ele nao pode, a subconsulta volta vazia e esconde tudo em
-- silencio; foi o que aconteceu com a natureza do lancamento mais acima.
drop policy if exists financeiro_grupos_receita_le on public.financeiro_grupos;
create policy financeiro_grupos_receita_le on public.financeiro_grupos
  for select to authenticated
  using (natureza = 'receita');

drop policy if exists financeiro_categorias_receita_le on public.financeiro_categorias;
create policy financeiro_categorias_receita_le on public.financeiro_categorias
  for select to authenticated
  using (exists (select 1 from public.financeiro_grupos g
                  where g.id = grupo_id and g.natureza = 'receita'));

drop policy if exists financeiro_subcategorias_receita_le on public.financeiro_subcategorias;
create policy financeiro_subcategorias_receita_le on public.financeiro_subcategorias
  for select to authenticated
  using (exists (select 1 from public.financeiro_categorias cat
                  where cat.id = categoria_id));

-- Rateio e custo interno: o cliente nunca ve quanto foi rateado para ele.
