-- =============================================================================
-- Smoke da 0090 — o caso da dona Zilda, ponta a ponta.
--
-- A dona: "eu dei um ensaio pra ela de graca. E aí eu vou fazer as fotos do
-- aniversario dela, que aí vai ser R$ 500. Aí eu queria ver se da pra colocar,
-- tipo, no cliente, colocar 2 cobrancas".
--
-- Os dois trabalhos sao AUDIOVISUAL. O que este arquivo cobra:
--
--   1. o mesmo servico entra duas vezes, cada um com o seu nome, valor e
--      data — e os dois convivem ativos;
--   2. a CORTESIA nao vira cobranca, e nao vira erro: uma linha de R$ 0
--      sai calada da geracao, porque `lancamentos` tem
--      `check (valor_centavos > 0)` e tentar lancar derrubaria a rodada;
--   3. O QUE JUSTIFICA O ARQUIVO: a linha que vale R$ 500 GERA a cobranca.
--      Antes da 0090 ela nao geraria: a conferencia de repetido era por
--      descricao (`Audiovisual — parcela 1 de 1`), as duas linhas escreviam
--      a mesma, e a segunda era lida como ja gerada. Sem erro, sem log — o
--      dinheiro simplesmente nao apareceria;
--   4. o nome que ela escreveu vai na cobranca, e e o que o cliente le no
--      boleto. Com dois trabalhos no mesmo cliente, "Audiovisual" nos dois
--      e a ligacao perguntando de qual se trata;
--   5. rodar de novo NAO cobra de novo — nem por linha, nem no total. E o
--      banco segura isso sozinho, com indice unico, para o caso de duas
--      rodadas ao mesmo tempo;
--   6. apagar a linha do contrato nao some com o dinheiro ja lancado.
--
-- O 3 e o 5 sao os que justificam o arquivo. O 3 porque e o pedido dela; o 5
-- porque cobrar o cliente duas vezes e o pior bug possivel deste sistema.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'direcao@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Layana', 'admin', true, 'direcao@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('20000000-0000-0000-0000-00000000aaaa', 'Dona Zilda', 'dona-zilda', 'America/Sao_Paulo');

set role authenticated;
select set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

do $$
declare
  v_mes     date := date_trunc('month', current_date)::date;
  v_ensaio  uuid;
  v_aniver  uuid;
  v_r       jsonb;
  v_n       int;
  v_lanc    uuid;
  ok        boolean;
begin
  -- 1. AS DUAS LINHAS -------------------------------------------------------
  v_ensaio := (public.adicionar_servico_ao_cliente(
    '20000000-0000-0000-0000-00000000aaaa', 'audiovisual', 'pontual',
    0::bigint, null, 1::smallint,
    p_inicio => v_mes,
    p_apelido => 'Ensaio cortesia')->>'id')::uuid;

  v_aniver := (public.adicionar_servico_ao_cliente(
    '20000000-0000-0000-0000-00000000aaaa', 'audiovisual', 'pontual',
    50000::bigint, null, 1::smallint,
    p_inicio => v_mes,
    p_apelido => 'Aniversário da Zilda')->>'id')::uuid;

  perform public.afirma(v_ensaio <> v_aniver, 'as duas linhas tinham de ser diferentes');
  perform public.afirma(
    (select count(*) from public.cliente_servicos
      where cliente_id = '20000000-0000-0000-0000-00000000aaaa' and status = 'ativo') = 2,
    'o mesmo serviço não entrou duas vezes no contrato');
  perform public.afirma(
    (select apelido from public.cliente_servicos where id = v_aniver) = 'Aniversário da Zilda',
    'a linha não guardou o nome que ela escreveu');

  -- E a tela de adicionar mostra o serviço UMA vez, não uma por linha.
  v_n := (select count(*) from jsonb_array_elements(
            public.servicos_para_adicionar('20000000-0000-0000-0000-00000000aaaa')) x
           where x->>'chave' = 'audiovisual');
  perform public.afirma(v_n = 1,
    format('a lista de adicionar mostrou audiovisual %s vezes', v_n));

  -- 2 e 3. A RODADA: a cortesia passa calada, o aniversário vira dinheiro ---
  v_r := public.gerar_cobrancas_do_mes(v_mes);

  perform public.afirma((v_r->>'erros')::int = 0,
    format('a rodada deu erro: %s', v_r->'linhas'));
  perform public.afirma((v_r->>'cortesias')::int = 1,
    'a rodada tinha de contar uma cortesia');

  perform public.afirma(
    not exists (select 1 from public.lancamentos where cliente_servico_id = v_ensaio),
    'a CORTESIA gerou cobrança — ela é de graça');

  select count(*) into v_n from public.lancamentos where cliente_servico_id = v_aniver;
  perform public.afirma(v_n = 1,
    format('o aniversário tinha de gerar UMA cobrança, gerou %s — '
           'é exatamente isto que a conferência por descrição quebrava', v_n));

  -- 3b. E O CASO QUE REALMENTE PROVA A CORREÇÃO: duas linhas SEM nome.
  --
  -- Sabotei a conferência de volta para "por descrição" e este arquivo passou
  -- verde. Motivo: a linha do aniversário tem apelido, então a descrição dela
  -- já era diferente de "Audiovisual — parcela…". A sabotagem não reproduzia
  -- o defeito, e um teste que não morde com o defeito de volta não estava
  -- provando nada.
  --
  -- Duas captações SEM apelido escrevem a MESMA descrição. É aí que a regra
  -- antiga lia a segunda como repetida e não cobrava — que é o defeito.
  declare
    v_s1 uuid;
    v_s2 uuid;
  begin
    v_s1 := (public.adicionar_servico_ao_cliente(
      '20000000-0000-0000-0000-00000000aaaa', 'audiovisual', 'pontual',
      30000::bigint, null, 1::smallint, p_inicio => v_mes)->>'id')::uuid;
    v_s2 := (public.adicionar_servico_ao_cliente(
      '20000000-0000-0000-0000-00000000aaaa', 'audiovisual', 'pontual',
      20000::bigint, null, 1::smallint, p_inicio => v_mes)->>'id')::uuid;

    perform public.gerar_cobrancas_do_mes(v_mes);

    perform public.afirma(
      (select count(*) from public.lancamentos where cliente_servico_id = v_s1) = 1,
      'a primeira captação sem nome não gerou cobrança');
    perform public.afirma(
      (select count(*) from public.lancamentos where cliente_servico_id = v_s2) = 1,
      'a SEGUNDA captação sem nome não gerou cobrança — é o defeito que a '
      'conferência por descrição causava: sem erro, sem log, sem dinheiro');

    -- E elas saem do caminho, para as contas abaixo continuarem simples.
    delete from public.lancamentos where cliente_servico_id in (v_s1, v_s2);
    delete from public.cliente_servicos where id in (v_s1, v_s2);
  end;

  -- 4. O NOME NO BOLETO -----------------------------------------------------
  perform public.afirma(
    (select descricao from public.lancamentos where cliente_servico_id = v_aniver)
      like 'Aniversário da Zilda%',
    format('a cobrança saiu como "%s", e não com o nome que ela deu',
           (select descricao from public.lancamentos where cliente_servico_id = v_aniver)));

  -- 5. RODAR DE NOVO NÃO COBRA DE NOVO --------------------------------------
  select count(*) into v_n from public.lancamentos;
  v_r := public.gerar_cobrancas_do_mes(v_mes);
  perform public.afirma((v_r->>'criadas')::int = 0, 'a segunda rodada criou cobrança');
  perform public.afirma((select count(*) from public.lancamentos) = v_n,
    'a segunda rodada mexeu no número de lançamentos');

  -- E O BANCO SEGURA SOZINHO. A conferência em plpgsql resolve a rodada
  -- normal; o índice resolve duas rodadas ao mesmo tempo, que é quando a
  -- conferência de aplicação perde.
  ok := false;
  begin
    insert into public.lancamentos
      (descricao, subcategoria_id, cliente_id, valor_centavos, competencia, vencimento,
       cliente_servico_id)
    select 'Cópia à mão', l.subcategoria_id, l.cliente_id, l.valor_centavos,
           l.competencia, l.vencimento, l.cliente_servico_id
      from public.lancamentos l where l.cliente_servico_id = v_aniver;
  exception when unique_violation then ok := true;
  end;
  perform public.afirma(ok,
    'o banco deixou lançar a MESMA linha de contrato duas vezes na mesma competência');

  -- 6. APAGAR A LINHA NÃO SOME COM O DINHEIRO -------------------------------
  select id into v_lanc from public.lancamentos where cliente_servico_id = v_aniver;
  delete from public.cliente_servicos where id = v_aniver;
  perform public.afirma(
    exists (select 1 from public.lancamentos where id = v_lanc and cliente_servico_id is null),
    'apagar a linha do contrato levou junto o lançamento — dinheiro lançado não some');
end $$;

reset role;
select 'ok 53_smoke_duas_linhas_do_mesmo_servico' as resultado;
