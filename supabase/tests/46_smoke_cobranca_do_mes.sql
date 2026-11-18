-- =============================================================================
-- Smoke da 0076 — a cobranca do mes.
--
-- O achado mais caro da varredura: oito contratos ativos, zero lancamentos.
-- `gerar_cobrancas_do_contrato` estava certa, testada e inalcancavel — sem
-- tela, sem gatilho, sem cron. O faturamento da agencia nunca entrou.
--
-- Este arquivo cobra a funcao que da a porta:
--
--   1. uma rodada lanca os contratos ativos de uma vez;
--   2. a segunda rodada NAO cobra de novo — e o resultado diz que nao cobrou,
--      em vez de ficar calado. Cobrar duas vezes o cliente de outra pessoa e
--      o pior erro que este modulo pode cometer;
--   3. contrato PAUSADO e contrato ENCERRADO antes do mes ficam de fora;
--   4. contrato que comeca no meio do mes entra no mes em que comecou;
--   5. UM contrato quebrado nao derruba os outros — e a falha aparece no
--      resultado com o motivo, em vez de sumir;
--   6. projeto lanca a fila de parcelas ancorada no INICIO, nao no mes em
--      que alguem apertou o botao;
--   7. e quem nao cuida do dinheiro nao gera cobranca nenhuma.
--
-- O 2 e o 5 sao os que justificam o arquivo. O 2 porque e dinheiro de
-- cliente; o 5 porque um contrato de cortesia (valor zero, que a tabela de
-- contratos aceita e a de lancamentos recusa) derrubaria a rodada inteira e
-- as outras sete cobrancas sumiriam sem ninguem ver.
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

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('20000000-0000-0000-0000-000000000001', 'Cliente Ativo',    'ativo',    'America/Sao_Paulo'),
  ('20000000-0000-0000-0000-000000000002', 'Cliente Pausado',  'pausado',  'America/Sao_Paulo'),
  ('20000000-0000-0000-0000-000000000003', 'Cliente Encerrado','encerrado','America/Sao_Paulo'),
  ('20000000-0000-0000-0000-000000000004', 'Cliente Cortesia', 'cortesia', 'America/Sao_Paulo'),
  ('20000000-0000-0000-0000-000000000005', 'Cliente Projeto',  'projeto',  'America/Sao_Paulo'),
  ('20000000-0000-0000-0000-000000000006', 'Cliente Novo',     'novo',     'America/Sao_Paulo');

do $$
declare
  v_mes   date := date_trunc('month', current_date)::date;
  v_gest  uuid;
  v_foto  uuid;
  v_r     jsonb;
  v_n     integer;
  ok      boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  select id into v_gest from public.servicos where chave = 'gestao_digital';
  select id into v_foto from public.servicos
   where chave <> 'gestao_digital' order by chave limit 1;

  -- ATIVO, recorrente, em vigor: tem de ser cobrado.
  insert into public.cliente_servicos
    (cliente_id, servico_id, formato, status, valor_centavos, dia_vencimento, inicio)
  values ('20000000-0000-0000-0000-000000000001', v_gest, 'recorrente', 'ativo',
          150000, 10, v_mes - 60);

  -- PAUSADO: fica de fora. Pausar e exatamente dizer "nao cobre este mes".
  insert into public.cliente_servicos
    (cliente_id, servico_id, formato, status, valor_centavos, dia_vencimento, inicio)
  values ('20000000-0000-0000-0000-000000000002', v_gest, 'recorrente', 'pausado',
          150000, 10, v_mes - 60);

  -- ENCERRADO no mes passado: tambem fica de fora. Cobrar cliente que saiu
  -- e o jeito mais rapido de perder a indicacao dele.
  insert into public.cliente_servicos
    (cliente_id, servico_id, formato, status, valor_centavos, dia_vencimento, inicio, fim)
  values ('20000000-0000-0000-0000-000000000003', v_gest, 'recorrente', 'ativo',
          150000, 10, v_mes - 120, v_mes - 1);

  -- CORTESIA: valor zero. `cliente_servicos` aceita, `lancamentos` recusa.
  -- E o contrato que derrubaria a rodada inteira sem o bloco de excecao.
  insert into public.cliente_servicos
    (cliente_id, servico_id, formato, status, valor_centavos, dia_vencimento, inicio)
  values ('20000000-0000-0000-0000-000000000004', v_gest, 'recorrente', 'ativo',
          0, 10, v_mes - 60);

  -- COMECOU NO MEIO DESTE MES: entra.
  insert into public.cliente_servicos
    (cliente_id, servico_id, formato, status, valor_centavos, dia_vencimento, inicio)
  values ('20000000-0000-0000-0000-000000000006', v_gest, 'recorrente', 'ativo',
          80000, 20, v_mes + 15);

  -- PROJETO em tres parcelas, comecado dois meses atras.
  insert into public.cliente_servicos
    (cliente_id, servico_id, formato, status, valor_centavos, parcelas, inicio)
  values ('20000000-0000-0000-0000-000000000005', v_foto, 'projeto', 'ativo',
          300001, 3, (v_mes - interval '2 months')::date);

  -- -------------------------------------------------------------------------
  -- A CONTAGEM QUE O BOTAO MOSTRA ANTES DE SER APERTADO.
  -- -------------------------------------------------------------------------
  perform public.afirma(public.contratos_a_cobrar() = 4,
    'a contagem ve os quatro em vigor: ativo, cortesia, novo e projeto');

  -- -------------------------------------------------------------------------
  -- 1. A PRIMEIRA RODADA.
  -- -------------------------------------------------------------------------
  v_r := public.gerar_cobrancas_do_mes();
  perform public.afirma((v_r->>'contratos')::int = 4,
    'a rodada olha so os contratos em vigor — pausado e encerrado nao contam');
  -- 1 do ativo + 1 do que comecou no meio do mes + 3 parcelas do projeto.
  perform public.afirma((v_r->>'criadas')::int = 5,
    'e cria cinco lancamentos: duas mensalidades e tres parcelas');
  perform public.afirma((v_r->>'erros')::int = 1,
    'com uma falha: o contrato de cortesia, valor zero');

  -- 3. PAUSADO E ENCERRADO NAO FORAM COBRADOS.
  perform public.afirma(
    not exists (select 1 from public.lancamentos
                 where cliente_id = '20000000-0000-0000-0000-000000000002'),
    'contrato pausado nao gera cobranca');
  perform public.afirma(
    not exists (select 1 from public.lancamentos
                 where cliente_id = '20000000-0000-0000-0000-000000000003'),
    'contrato encerrado antes do mes tambem nao');

  -- 4. O QUE COMECOU NO MEIO DO MES ENTROU.
  perform public.afirma(
    exists (select 1 from public.lancamentos
             where cliente_id = '20000000-0000-0000-0000-000000000006'
               and competencia = v_mes),
    'contrato que comecou no meio do mes e cobrado no mes em que comecou');

  -- 5. A FALHA APARECE, COM O MOTIVO, E NAO LEVOU AS OUTRAS JUNTO.
  select count(*) into v_n
    from jsonb_array_elements(v_r->'linhas') x
   where x->>'cliente' = 'Cliente Cortesia' and x->>'erro' is not null;
  perform public.afirma(v_n = 1,
    'o contrato quebrado aparece no resultado com o motivo — falha calada e proibida');
  perform public.afirma(
    exists (select 1 from public.lancamentos
             where cliente_id = '20000000-0000-0000-0000-000000000001'),
    'e o contrato bom foi cobrado mesmo com o quebrado na mesma rodada');

  -- 6. O PROJETO LANCOU A FILA ANCORADA NO INICIO.
  select count(*) into v_n from public.lancamentos
   where cliente_id = '20000000-0000-0000-0000-000000000005';
  perform public.afirma(v_n = 3, 'o projeto lancou as tres parcelas');
  perform public.afirma(
    (select min(competencia) from public.lancamentos
      where cliente_id = '20000000-0000-0000-0000-000000000005')
      = (v_mes - interval '2 months')::date,
    'a primeira parcela fica no mes de INICIO, nao no mes do botao');
  perform public.afirma(
    (select sum(valor_centavos) from public.lancamentos
      where cliente_id = '20000000-0000-0000-0000-000000000005') = 300001,
    'e as tres parcelas somam o contrato inteiro, com o centavo da divisao');

  -- -------------------------------------------------------------------------
  -- 2. A SEGUNDA RODADA NAO COBRA DE NOVO.
  --
  -- O pior erro possivel deste modulo. E nao basta nao duplicar: o resultado
  -- tem de DIZER que nao duplicou, senao quem apertou nao sabe o que houve.
  -- -------------------------------------------------------------------------
  select count(*) into v_n from public.lancamentos;
  v_r := public.gerar_cobrancas_do_mes();
  perform public.afirma((v_r->>'criadas')::int = 0,
    'apertar de novo nao cria nada');
  perform public.afirma((v_r->>'jaExistiam')::int = 3,
    'e o resultado diz que tres contratos ja estavam lancados');
  perform public.afirma(
    (select count(*) from public.lancamentos) = v_n,
    'o numero de lancamentos nao mudou — ninguem foi cobrado duas vezes');

  -- E o mes seguinte e outro mes: a mensalidade de novembro nao impede a de
  -- dezembro. Se impedisse, o sistema cobraria uma vez e nunca mais.
  v_r := public.gerar_cobrancas_do_mes((v_mes + interval '1 month')::date);
  perform public.afirma((v_r->>'criadas')::int >= 1,
    'o mes seguinte gera a mensalidade dele');
end $$;

-- 7. Quem nao cuida do dinheiro nao gera cobranca.
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- Raquel, operacao
do $$
declare ok boolean;
begin
  begin
    perform public.gerar_cobrancas_do_mes();
    ok := false;
  exception when others then ok := position('dinheiro' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'a operacao nao gera cobranca, e a recusa diz por que');
  perform public.afirma(public.contratos_a_cobrar() is null,
    'nem ve quantos contratos existem para cobrar');
end $$;
