-- =============================================================================
-- 0077 — lançar pagamento
--
-- A dona, olhando o Financeiro: "aqui tbm eu nao consigo lançar pagamentos".
--
-- Ela esta certa, e e pior do que parece. Procurei no banco inteiro: NAO
-- EXISTE nenhuma funcao que escreva em `lancamentos`. Nem para criar, nem
-- para marcar como pago, nem para corrigir, nem para apagar. A unica coisa
-- que insere linha la e a `gerar_cobrancas_do_contrato`, que a 0076 acabou de
-- ligar na tela. Fora as mensalidades de contrato, o financeiro era somente
-- leitura de uma tabela que ninguem conseguia preencher.
--
-- Entao faltava a metade operacional do modulo:
--
--   - o custo avulso (anuncio, freela, assinatura, imposto);
--   - a receita fora de contrato (um job pontual, uma venda);
--   - e, acima de tudo, DIZER QUE ENTROU. Sem isso "Entrou R$ 0,00" e
--     "Atrasado" ficam errados para sempre, e um painel que mente e pior do
--     que painel nenhum: ela tomaria decisao em cima dele.
--
-- O QUE ESTA MIGRATION ACRESCENTA
--
--   categorias_financeiras   a arvore grupo > categoria > subcategoria, para
--                            o formulario ter o que oferecer
--   criar_lancamento         entrada ou saida, prevista ou ja paga
--   liquidar_lancamento      marcar que o dinheiro andou, com data e forma
--   estornar_lancamento      desfazer: volta para previsto
--   cancelar_lancamento      nao vai acontecer — sai das contas sem sumir
--   editar_lancamento        corrigir valor, data, descricao, categoria
--   apagar_lancamento        so engano de cadastro, so a direcao, e nunca
--                            uma linha que ja foi liquidada
--
-- DUAS DECISOES, E POR QUE
--
-- 1. LIQUIDADO NAO SE APAGA, SE ESTORNA. Dinheiro que andou e historia. Se
--    foi engano, o caminho e estornar (volta a previsto, e dai da para
--    apagar) ou cancelar (fica guardado, fora das contas). Apagar direto
--    sumiria com a linha do extrato sem deixar rastro de que existiu.
--
-- 2. LIQUIDAR DUAS VEZES E RECUSADO, com a data da primeira na mensagem.
--    Nao e um erro inofensivo: dois cliques no mesmo botao, ou duas pessoas
--    conferindo o extrato juntas, trocariam a data do pagamento sem avisar.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A ARVORE DE CATEGORIAS, para o formulario
--
-- O rotulo ja vem montado ("Receita · Serviços · Mensalidade") porque e assim
-- que o seletor mostra, e montar no front significaria montar de novo em cada
-- tela que precisar.
-- ---------------------------------------------------------------------------
create or replace function public.categorias_financeiras()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.usuario_financeiro() or public.usuario_admin() then
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',           sub.id,
               'natureza',     g.natureza,
               'grupo',        g.nome,
               'categoria',    cat.nome,
               'subcategoria', sub.nome,
               'rotulo',       g.nome || ' · ' || cat.nome || ' · ' || sub.nome)
             order by g.ordem, cat.ordem, sub.nome)
        from public.financeiro_subcategorias sub
        join public.financeiro_categorias cat on cat.id = sub.categoria_id
        join public.financeiro_grupos       g on g.id = cat.grupo_id
    ), '[]'::jsonb)
  end;
$$;

revoke all on function public.categorias_financeiras() from public, anon;
grant execute on function public.categorias_financeiras() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CRIAR
--
-- `p_liquidado_em` nao nulo cria a linha JA PAGA. E o caso mais comum do dia
-- a dia: ela nao esta prevendo um gasto, esta registrando um que ja saiu da
-- conta. Obrigar a criar previsto e depois liquidar seriam dois passos para
-- um fato unico.
-- ---------------------------------------------------------------------------
create or replace function public.criar_lancamento(
  p_descricao      text,
  p_subcategoria   uuid,
  p_valor_centavos bigint,
  p_vencimento     date default null,
  p_competencia    date default null,
  p_cliente        uuid default null,
  p_contraparte    text default null,
  p_forma          public.forma_pagamento default null,
  p_liquidado_em   date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id   uuid;
  v_comp date;
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'O financeiro e de quem cuida do dinheiro.';
  end if;
  if p_descricao is null or length(btrim(p_descricao)) = 0 then
    raise exception 'O lancamento precisa de uma descricao.';
  end if;
  if p_valor_centavos is null or p_valor_centavos <= 0 then
    raise exception 'O valor precisa ser maior que zero.';
  end if;
  if not exists (select 1 from public.financeiro_subcategorias where id = p_subcategoria) then
    raise exception 'Escolha uma categoria.';
  end if;
  if p_cliente is not null
     and not exists (select 1 from public.clientes where id = p_cliente) then
    raise exception 'Cliente nao encontrado.';
  end if;

  -- A competencia e o mes a que o dinheiro PERTENCE. Sem ela dita, segue o
  -- vencimento; sem vencimento, o mes de hoje.
  v_comp := date_trunc('month',
              coalesce(p_competencia, p_vencimento, p_liquidado_em, current_date))::date;

  insert into public.lancamentos
    (descricao, subcategoria_id, cliente_id, contraparte, valor_centavos,
     competencia, vencimento, forma, status, liquidado_em, criado_por)
  values
    (btrim(p_descricao), p_subcategoria, p_cliente, nullif(btrim(coalesce(p_contraparte, '')), ''),
     p_valor_centavos, v_comp, p_vencimento, p_forma,
     (case when p_liquidado_em is null then 'previsto' else 'liquidado' end)::public.status_lancamento,
     p_liquidado_em, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.criar_lancamento(
  text, uuid, bigint, date, date, uuid, text, public.forma_pagamento, date) from public, anon;
grant execute on function public.criar_lancamento(
  text, uuid, bigint, date, date, uuid, text, public.forma_pagamento, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- LIQUIDAR — o dinheiro andou
-- ---------------------------------------------------------------------------
create or replace function public.liquidar_lancamento(
  p_lancamento uuid,
  p_em         date default null,
  p_forma      public.forma_pagamento default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_l public.lancamentos;
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'O financeiro e de quem cuida do dinheiro.';
  end if;

  select * into v_l from public.lancamentos where id = p_lancamento;
  if v_l.id is null then raise exception 'Lancamento nao encontrado.'; end if;

  -- Recusa dizendo QUANDO foi a primeira vez. Dois cliques no mesmo botao
  -- trocariam a data do pagamento em silencio.
  if v_l.status = 'liquidado' then
    raise exception 'Este lancamento ja foi liquidado em %.',
      to_char(coalesce(v_l.liquidado_em, current_date), 'DD/MM/YYYY');
  end if;
  if v_l.status = 'cancelado' then
    raise exception 'Este lancamento esta cancelado. Reabra antes de liquidar.';
  end if;

  update public.lancamentos
     set status       = 'liquidado',
         liquidado_em = coalesce(p_em, current_date),
         forma        = coalesce(p_forma, forma)
   where id = p_lancamento;
end;
$$;

revoke all on function public.liquidar_lancamento(uuid, date, public.forma_pagamento)
  from public, anon;
grant execute on function public.liquidar_lancamento(uuid, date, public.forma_pagamento)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CANCELAR e ESTORNAR
--
-- Cancelar: nao vai acontecer. Sai das contas (a view ja trata 'cancelado')
-- e continua guardado, porque saber que existiu e foi cancelado vale mais do
-- que a linha sumir.
--
-- Estornar: volta para previsto, venha de liquidado ou de cancelado. E o
-- desfazer de quem marcou a linha errada.
-- ---------------------------------------------------------------------------
create or replace function public.cancelar_lancamento(p_lancamento uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'O financeiro e de quem cuida do dinheiro.';
  end if;
  update public.lancamentos
     set status = 'cancelado', liquidado_em = null
   where id = p_lancamento;
  if not found then raise exception 'Lancamento nao encontrado.'; end if;
end;
$$;

revoke all on function public.cancelar_lancamento(uuid) from public, anon;
grant execute on function public.cancelar_lancamento(uuid) to authenticated, service_role;

create or replace function public.estornar_lancamento(p_lancamento uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'O financeiro e de quem cuida do dinheiro.';
  end if;
  update public.lancamentos
     set status = 'previsto', liquidado_em = null
   where id = p_lancamento;
  if not found then raise exception 'Lancamento nao encontrado.'; end if;
end;
$$;

revoke all on function public.estornar_lancamento(uuid) from public, anon;
grant execute on function public.estornar_lancamento(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- EDITAR
--
-- Mesma convencao de `editar_tarefa` (0065) e `editar_lead` (0071): nulo e
-- "nao mexe", e apagar um campo pede o nome dele em `p_limpar`. Tres
-- convencoes diferentes para a mesma coisa no mesmo sistema e armadilha.
-- ---------------------------------------------------------------------------
create or replace function public.editar_lancamento(
  p_lancamento     uuid,
  p_descricao      text default null,
  p_subcategoria   uuid default null,
  p_valor_centavos bigint default null,
  p_vencimento     date default null,
  p_competencia    date default null,
  p_cliente        uuid default null,
  p_contraparte    text default null,
  p_forma          public.forma_pagamento default null,
  p_limpar         text[] default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_limpar text[] := coalesce(p_limpar, array[]::text[]);
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'O financeiro e de quem cuida do dinheiro.';
  end if;
  if p_descricao is not null and length(btrim(p_descricao)) = 0 then
    raise exception 'O lancamento precisa de uma descricao.';
  end if;
  if p_valor_centavos is not null and p_valor_centavos <= 0 then
    raise exception 'O valor precisa ser maior que zero.';
  end if;
  if p_subcategoria is not null
     and not exists (select 1 from public.financeiro_subcategorias where id = p_subcategoria) then
    raise exception 'Categoria nao encontrada.';
  end if;

  update public.lancamentos set
    descricao       = coalesce(nullif(btrim(coalesce(p_descricao, '')), ''), descricao),
    subcategoria_id = coalesce(p_subcategoria, subcategoria_id),
    valor_centavos  = coalesce(p_valor_centavos, valor_centavos),
    vencimento      = case when 'vencimento'  = any (v_limpar) then null
                           else coalesce(p_vencimento, vencimento) end,
    competencia     = coalesce(date_trunc('month', p_competencia)::date, competencia),
    cliente_id      = case when 'cliente'     = any (v_limpar) then null
                           else coalesce(p_cliente, cliente_id) end,
    contraparte     = case when 'contraparte' = any (v_limpar) then null
                           else coalesce(nullif(btrim(coalesce(p_contraparte, '')), ''), contraparte) end,
    forma           = case when 'forma'       = any (v_limpar) then null
                           else coalesce(p_forma, forma) end
  where id = p_lancamento;

  if not found then raise exception 'Lancamento nao encontrado.'; end if;
end;
$$;

revoke all on function public.editar_lancamento(
  uuid, text, uuid, bigint, date, date, uuid, text, public.forma_pagamento, text[])
  from public, anon;
grant execute on function public.editar_lancamento(
  uuid, text, uuid, bigint, date, date, uuid, text, public.forma_pagamento, text[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- APAGAR — so engano de cadastro
--
-- Direcao apenas, e NUNCA uma linha liquidada: dinheiro que andou e historia,
-- e sumir com ele e exatamente o que o extrato nao perdoa. Para tirar das
-- contas sem apagar, o caminho e cancelar.
-- ---------------------------------------------------------------------------
create or replace function public.apagar_lancamento(p_lancamento uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_admin() then
    raise exception 'So a direcao apaga lancamento.';
  end if;
  if exists (select 1 from public.lancamentos
              where id = p_lancamento and status = 'liquidado') then
    raise exception
      'Este lancamento ja foi liquidado — o dinheiro andou. Estorne ou cancele.';
  end if;

  delete from public.lancamentos where id = p_lancamento;
  if not found then raise exception 'Lancamento nao encontrado.'; end if;
end;
$$;

revoke all on function public.apagar_lancamento(uuid) from public, anon;
grant execute on function public.apagar_lancamento(uuid) to authenticated, service_role;
