-- =============================================================================
-- Smoke da 0077 — lançar pagamento.
--
-- A dona: "aqui tbm eu nao consigo lançar pagamentos".
--
-- Nao havia NENHUMA funcao que escrevesse em `lancamentos`. O financeiro era
-- leitura de uma tabela que ninguem conseguia preencher, e os numeros do
-- topo — "Entrou", "Atrasado" — nunca poderiam sair de zero.
--
-- O que este arquivo cobra:
--
--   1. criar previsto, e criar JA PAGO num passo so (que e o caso do dia a
--      dia: registrar o que ja saiu da conta);
--   2. a competencia nasce do vencimento quando ninguem diz qual e, e sempre
--      no primeiro dia do mes;
--   3. o que e recusado, e com que palavras: sem descricao, valor zero,
--      valor negativo, categoria que nao existe;
--   4. liquidar muda a situacao para "recebido" na receita e "pago" no
--      custo — e e a view quem decide isso, nao a tela;
--   5. LIQUIDAR DUAS VEZES E RECUSADO, dizendo a data da primeira. Dois
--      cliques trocariam a data do pagamento em silencio;
--   6. cancelar tira das contas sem apagar, e estornar desfaz os dois;
--   7. apagar e so da direcao, e NUNCA de linha liquidada — dinheiro que
--      andou e historia;
--   8. editar segue a convencao de nulo = "nao mexe", com `p_limpar`;
--   9. e quem nao cuida do dinheiro nao escreve nada.
--
-- O 5 e o 7 sao os que justificam o arquivo: sao os dois jeitos de o extrato
-- da agencia passar a mentir sem ninguem perceber.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'raquel@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003', 'financeiro@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Layana', 'admin',      true, 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Raquel', 'operacao',   true, 'raquel@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003', 'Nara',   'financeiro', true, 'financeiro@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('20000000-0000-0000-0000-000000000001', 'Cliente Um', 'um', 'America/Sao_Paulo');

do $$
declare
  v_receita uuid;
  v_custo   uuid;
  v_a       uuid;
  v_b       uuid;
  v_cats    jsonb;
  ok        boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  -- A ARVORE QUE O FORMULARIO OFERECE.
  v_cats := public.categorias_financeiras();
  perform public.afirma(jsonb_array_length(v_cats) > 0,
    'o formulario tem categorias para oferecer');
  perform public.afirma(
    (select count(*) from jsonb_array_elements(v_cats) x
      where x->>'rotulo' like '% · % · %') = jsonb_array_length(v_cats),
    'e cada uma vem com o rotulo inteiro montado: grupo, categoria, subcategoria');

  select sub.id into v_receita
    from public.financeiro_subcategorias sub
    join public.financeiro_categorias cat on cat.id = sub.categoria_id
    join public.financeiro_grupos       g on g.id = cat.grupo_id
   where g.chave = 'receita' limit 1;
  select sub.id into v_custo
    from public.financeiro_subcategorias sub
    join public.financeiro_categorias cat on cat.id = sub.categoria_id
    join public.financeiro_grupos       g on g.id = cat.grupo_id
   where g.chave = 'custo' limit 1;
  perform public.afirma(v_receita is not null and v_custo is not null,
    'existem subcategorias de receita e de custo no catalogo');

  -- 1 e 2. CRIAR PREVISTO.
  -- Vencimento no FUTURO de proposito: vencido vira "atrasado" na view, e
  -- este bloco esta medindo o nascimento, nao o atraso.
  v_a := public.criar_lancamento(
    'Job avulso da feira', v_receita, 180000, current_date + 9,
    p_cliente => '20000000-0000-0000-0000-000000000001');
  perform public.afirma(v_a is not null, 'da para criar um lancamento de receita');
  perform public.afirma(
    (select status::text from public.lancamentos where id = v_a) = 'previsto',
    'e sem data de pagamento ele nasce previsto');
  perform public.afirma(
    (select competencia from public.lancamentos where id = v_a)
      = date_trunc('month', current_date + 9)::date,
    'a competencia sai do vencimento, no primeiro dia do mes');
  perform public.afirma(
    (select situacao from public.lancamentos_com_situacao where id = v_a) = 'previsto',
    'e a situacao que a tela mostra e "previsto"');

  -- CRIAR JA PAGO, num passo so.
  v_b := public.criar_lancamento(
    'Anuncio no Meta', v_custo, 50000,
    p_liquidado_em => current_date, p_forma => 'cartao',
    p_contraparte => 'Meta Platforms');
  perform public.afirma(
    (select status::text from public.lancamentos where id = v_b) = 'liquidado',
    'da para registrar num passo so o que JA saiu da conta');
  perform public.afirma(
    (select situacao from public.lancamentos_com_situacao where id = v_b) = 'pago',
    'e no custo a situacao se chama "pago", nao "recebido"');
  perform public.afirma(
    (select contraparte from public.lancamentos where id = v_b) = 'Meta Platforms',
    'com a contraparte guardada, que nem todo gasto tem cliente');

  -- 3. O QUE E RECUSADO.
  begin
    perform public.criar_lancamento('   ', v_custo, 1000);
    ok := false;
  exception when others then ok := position('descrição' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'lancamento sem descricao e recusado');

  begin
    perform public.criar_lancamento('Zerado', v_custo, 0);
    ok := false;
  exception when others then ok := position('maior que zero' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'valor zero e recusado');

  begin
    perform public.criar_lancamento('Negativo', v_custo, -500);
    ok := false;
  exception when others then ok := position('maior que zero' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'valor negativo tambem — saida se escolhe pela categoria, nao pelo sinal');

  begin
    perform public.criar_lancamento('Sem categoria', '00000000-0000-0000-0000-0000000000ff', 1000);
    ok := false;
  exception when others then ok := position('categoria' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'categoria que nao existe e recusada');

  -- 4. LIQUIDAR.
  perform public.liquidar_lancamento(v_a, current_date, 'pix');
  perform public.afirma(
    (select situacao from public.lancamentos_com_situacao where id = v_a) = 'recebido',
    'liquidar uma receita vira "recebido"');
  perform public.afirma(
    (select liquidado_em from public.lancamentos where id = v_a) = current_date,
    'com a data em que o dinheiro andou');
  perform public.afirma(
    (select forma::text from public.lancamentos where id = v_a) = 'pix',
    'e a forma de pagamento');

  -- 5. LIQUIDAR DE NOVO E RECUSADO, DIZENDO QUANDO FOI A PRIMEIRA VEZ.
  begin
    perform public.liquidar_lancamento(v_a, current_date - 3);
    ok := false;
  exception when others then
    ok := position('já foi liquidado' in sqlerrm) > 0
          and position(to_char(current_date, 'DD/MM/YYYY') in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'liquidar duas vezes e recusado, e a recusa diz a data da primeira');
  perform public.afirma(
    (select liquidado_em from public.lancamentos where id = v_a) = current_date,
    'e a data da primeira continua de pe — a segunda tentativa nao trocou nada');

  -- 6. CANCELAR E ESTORNAR.
  perform public.cancelar_lancamento(v_a);
  perform public.afirma(
    (select situacao from public.lancamentos_com_situacao where id = v_a) = 'cancelado',
    'cancelar tira das contas');
  perform public.afirma(
    exists (select 1 from public.lancamentos where id = v_a),
    'sem apagar: saber que existiu e foi cancelado vale mais que a linha sumir');

  begin
    perform public.liquidar_lancamento(v_a);
    ok := false;
  exception when others then ok := position('cancelado' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'e cancelado nao se liquida sem reabrir antes');

  perform public.estornar_lancamento(v_a);
  perform public.afirma(
    (select status::text from public.lancamentos where id = v_a) = 'previsto'
    and (select liquidado_em is null from public.lancamentos where id = v_a),
    'estornar volta para previsto e limpa a data do pagamento');

  -- 8. EDITAR, com a convencao de sempre.
  perform public.editar_lancamento(v_a, p_valor_centavos => 200000);
  perform public.afirma(
    (select valor_centavos from public.lancamentos where id = v_a) = 200000,
    'editar troca o valor');
  perform public.afirma(
    (select descricao from public.lancamentos where id = v_a) = 'Job avulso da feira',
    'e nao encosta na descricao, que foi mandada nula');
  perform public.editar_lancamento(v_a, p_limpar => array['vencimento', 'cliente']);
  perform public.afirma(
    (select vencimento is null and cliente_id is null from public.lancamentos where id = v_a),
    'e p_limpar apaga de verdade o vencimento e o cliente');

  begin
    perform public.editar_lancamento(v_a, p_valor_centavos => -1);
    ok := false;
  exception when others then ok := position('maior que zero' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'editar para valor negativo e recusado');

  -- 7. APAGAR: nunca o liquidado.
  begin
    perform public.apagar_lancamento(v_b);   -- o anuncio, que esta pago
    ok := false;
  exception when others then ok := position('o dinheiro andou' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'lancamento liquidado nao se apaga, e a recusa diz o caminho: estornar ou cancelar');

  perform public.apagar_lancamento(v_a);     -- esse esta previsto
  perform public.afirma(
    not exists (select 1 from public.lancamentos where id = v_a),
    'o previsto, esse sim, e apagado');
end $$;

-- ---------------------------------------------------------------------------
-- 9. QUEM NAO CUIDA DO DINHEIRO NAO ESCREVE NADA.
--
-- E o financeiro escreve tudo, menos apagar — igual ao lead: apagar e so da
-- direcao.
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- Raquel, operacao
do $$
declare
  v_sub uuid;
  ok    boolean;
begin
  select id into v_sub from public.financeiro_subcategorias limit 1;
  begin
    perform public.criar_lancamento('Gasto da Raquel', v_sub, 1000);
    ok := false;
  exception when others then ok := position('dinheiro' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'a operacao nao cria lancamento');
  perform public.afirma(public.categorias_financeiras() is null,
    'nem ve o catalogo de categorias');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000003';   -- Nara, financeiro
do $$
declare
  v_sub uuid;
  v_id  uuid;
  ok    boolean;
begin
  select sub.id into v_sub
    from public.financeiro_subcategorias sub
    join public.financeiro_categorias cat on cat.id = sub.categoria_id
    join public.financeiro_grupos       g on g.id = cat.grupo_id
   where g.chave = 'custo' limit 1;

  v_id := public.criar_lancamento('Assinatura do banco de imagens', v_sub, 9900);
  perform public.afirma(v_id is not null, 'quem cuida do dinheiro cria lancamento');
  perform public.liquidar_lancamento(v_id);
  perform public.afirma(
    (select situacao from public.lancamentos_com_situacao where id = v_id) = 'pago',
    'e liquida');
  perform public.estornar_lancamento(v_id);

  begin
    perform public.apagar_lancamento(v_id);
    ok := false;
  exception when others then ok := position('direção' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'mas nao apaga — apagar e so da direcao');
end $$;
