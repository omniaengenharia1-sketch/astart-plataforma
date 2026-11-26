-- =============================================================================
-- Smoke das 0086 e 0087 — o documento entra no cadastro.
--
-- A dona: "na tela do cliente quando for cadastrar precisa do campo do
-- cnpj/cpf pra eu cadastrar".
--
-- O DEFEITO QUE ISTO FECHA nao dava erro nenhum. `cobrancas_para_emitir`
-- filtra `c.cnpj_cpf is not null`; o cadastro nao pedia o documento; logo todo
-- cliente novo nascia fora da cobranca, em silencio. Ninguem reclama de uma
-- cobranca que nao foi tentada.
--
-- O que este arquivo cobra:
--
--   1. `criar_cliente` grava CPF/CNPJ, e-mail e telefone, SO OS DIGITOS —
--      "12.345.678/0001-90" e "12345678000190" seriam dois clientes
--      diferentes para qualquer busca, e a Asaas recusa com pontuacao;
--   2. documento com tamanho errado e RECUSADO no cadastro, nao depois;
--   3. cadastro sem documento continua valendo — ha cliente que nao e
--      cobrado pela plataforma, e isso e decisao dela, nao defeito;
--   4. quem nasce com documento JA ENTRA na fila da cobranca. Este e o
--      ponto todo: o 1 sem o 4 e so uma coluna preenchida;
--   5. a assinatura antiga de 4 argumentos NAO existe mais — se ela tivesse
--      ficado, a chamada de 4 argumentos viraria ambigua ("function is not
--      unique") e o cadastro quebraria inteiro;
--   6. `dados_de_cobranca` le de volta, e so para quem cuida do dinheiro:
--      CPF de cliente nao e preciso para fazer um carrossel;
--   7. `salvar_dados_de_cobranca` nao apaga o que ja estava la quando o
--      campo vem vazio — abrir o formulario e salvar sem mexer em nada nao
--      pode zerar o CPF de um cliente que esta sendo cobrado.
--
-- O 4 e o 5 sao os que justificam o arquivo.
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
  ('10000000-0000-0000-0000-000000000002', 'raquel@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Layana', 'admin',    true, 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Raquel', 'operacao', true, 'raquel@astartstudio.com.br');

set role postgres;
select set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

do $$
declare
  v_novo   jsonb;
  v_id     uuid;
  v_linha  record;
  v_dados  jsonb;
  v_fila   jsonb;
  v_sub    uuid;
  v_lanc   uuid;
  ok       boolean;
begin
  -- 1. O documento entra, e entra limpo -------------------------------------
  v_novo := public.criar_cliente(
    'Padaria com CNPJ',
    '[{"servico": "gestao_digital", "valorCentavos": 150000, "diaVencimento": 10}]'::jsonb,
    null, 'America/Sao_Paulo',
    '12.345.678/0001-90',            -- com mascara, como vem da tela
    '  financeiro@padaria.com.br  ', -- com espaco, como vem de quem copia e cola
    '(11) 98888-7777');
  v_id := (v_novo->>'id')::uuid;

  select cnpj_cpf, email_cobranca, telefone into v_linha
    from public.clientes where id = v_id;

  perform public.afirma(v_linha.cnpj_cpf = '12345678000190',
    format('o CNPJ tinha de ficar so com digitos, ficou "%s"', v_linha.cnpj_cpf));
  perform public.afirma(v_linha.email_cobranca = 'financeiro@padaria.com.br',
    format('o e-mail tinha de vir sem espaco, veio "%s"', v_linha.email_cobranca));
  perform public.afirma(v_linha.telefone = '11988887777',
    format('o telefone tinha de ficar so com digitos, ficou "%s"', v_linha.telefone));

  -- 2. Tamanho errado nao passa ---------------------------------------------
  ok := false;
  begin
    perform public.criar_cliente(
      'Documento Torto',
      '[{"servico": "gestao_digital", "valorCentavos": 1000, "diaVencimento": 10}]'::jsonb,
      null, 'America/Sao_Paulo', '123456');
  exception when others then
    ok := sqlerrm like '%11 d%gitos%';
  end;
  perform public.afirma(ok, 'aceitou um documento de 6 digitos no cadastro');
  perform public.afirma(
    not exists (select 1 from public.clientes where nome = 'Documento Torto'),
    'o cliente do documento torto foi gravado mesmo assim');

  -- 3. Sem documento continua valendo ---------------------------------------
  v_novo := public.criar_cliente(
    'Cliente Sem Documento',
    '[{"servico": "gestao_digital", "valorCentavos": 90000, "diaVencimento": 10}]'::jsonb);
  perform public.afirma(
    (select cnpj_cpf is null from public.clientes where id = (v_novo->>'id')::uuid),
    'cliente sem documento deveria nascer com cnpj_cpf nulo');

  -- 4. O QUE JUSTIFICA O MODULO: ja entra na fila da cobranca ---------------
  --
  -- Uma coluna preenchida nao e cobranca. O que importa e que `criar_cliente`
  -- com documento produz um cliente que a rodada ENXERGA.
  select sub.id into v_sub
    from public.financeiro_subcategorias sub
    join public.financeiro_categorias cat on cat.id = sub.categoria_id
    join public.financeiro_grupos g on g.id = cat.grupo_id
   where g.natureza = 'receita'
   limit 1;
  perform public.afirma(v_sub is not null, 'nao ha subcategoria de receita para o teste');

  insert into public.lancamentos
    (cliente_id, subcategoria_id, descricao, valor_centavos, vencimento, competencia, status)
  values (v_id, v_sub, 'Mensalidade de teste', 150000,
          current_date + 5, date_trunc('month', current_date)::date, 'previsto')
  returning id into v_lanc;

  v_fila := public.cobrancas_para_emitir('sandbox', 10, 100);
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(v_fila) x
             where (x->>'lancamentoId')::uuid = v_lanc),
    'o cliente cadastrado com documento NAO entrou na fila da cobranca');
  perform public.afirma(
    (select x->>'cnpjCpf' from jsonb_array_elements(v_fila) x
      where (x->>'lancamentoId')::uuid = v_lanc) = '12345678000190',
    'a fila levou o documento com mascara ou vazio');

  -- 5. A assinatura de 4 argumentos saiu de cena ----------------------------
  --
  -- Se as duas existissem juntas, `criar_cliente(nome, servicos, slug, fuso)`
  -- seria ambigua e o cadastro inteiro quebraria. Entao: existe UMA so.
  perform public.afirma(
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'criar_cliente') = 1,
    'ha mais de uma criar_cliente — a chamada de 4 argumentos fica ambigua');

  -- 6. Ler de volta, so quem cuida do dinheiro ------------------------------
  v_dados := public.dados_de_cobranca(v_id);
  perform public.afirma(v_dados->>'cnpjCpf' = '12345678000190',
    'dados_de_cobranca nao devolveu o documento');
  perform public.afirma((v_dados->>'naAsaas')::boolean = false,
    'cliente novo nao tem cadastro na Asaas, e a funcao disse que tem');

  -- 7. Campo vazio nao apaga o que esta gravado -----------------------------
  perform public.salvar_dados_de_cobranca(v_id, null, null, null);
  select cnpj_cpf, email_cobranca, telefone into v_linha
    from public.clientes where id = v_id;
  perform public.afirma(v_linha.cnpj_cpf = '12345678000190',
    'salvar com tudo vazio APAGOU o documento');
  perform public.afirma(v_linha.email_cobranca = 'financeiro@padaria.com.br',
    'salvar com tudo vazio apagou o e-mail');

  -- E trocar troca.
  perform public.salvar_dados_de_cobranca(v_id, '111.444.777-35', null, null);
  perform public.afirma(
    (select cnpj_cpf from public.clientes where id = v_id) = '11144477735',
    'nao trocou o documento quando veio um novo');
end $$;

-- A operacao: cadastra (senao o cliente nasce fora da cobranca) e NAO le ------
--
-- Mesma regra do valor do contrato, que a 0039 ja aplicava: quem nao cuida do
-- dinheiro grava e nao le de volta. CPF de cliente e dado pessoal.
select set_config('teste.uid', '10000000-0000-0000-0000-000000000002', false);
set role authenticated;

do $$
declare
  v_novo jsonb;
  ok     boolean;
begin
  v_novo := public.criar_cliente(
    'Cadastrado pela Operacao',
    '[{"servico": "gestao_digital", "valorCentavos": 120000, "diaVencimento": 10}]'::jsonb,
    null, 'America/Sao_Paulo', '11222333000181');
  perform public.afirma(
    (select cnpj_cpf from public.clientes where id = (v_novo->>'id')::uuid) = '11222333000181',
    'a operacao nao conseguiu gravar o documento no cadastro');

  ok := false;
  begin
    perform public.dados_de_cobranca((v_novo->>'id')::uuid);
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'a operacao leu os dados de cobranca de volta');

  ok := false;
  begin
    perform public.salvar_dados_de_cobranca((v_novo->>'id')::uuid, '11144477735');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'a operacao editou os dados de cobranca de um cliente');
end $$;

reset role;
select 'ok 51_smoke_documento_no_cadastro' as resultado;
