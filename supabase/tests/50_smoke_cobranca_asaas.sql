-- =============================================================================
-- Smoke da 0081 — cobrança pela Asaas, no lado do banco.
--
-- A dona: "vamos montar a estrutura asaas agora?".
--
-- O PIOR BUG POSSIVEL DESTE MODULO e cobrar o cliente de outra pessoa duas
-- vezes, ou dar baixa num pagamento que nao aconteceu. Os dois so aparecem
-- na segunda semana: a rede cai no meio, a Asaas reenvia o aviso, o cron
-- repete. E e nisso que este arquivo bate.
--
--   1. so entra na fila quem TEM CPF/CNPJ — a Asaas nao cobra sem isso, e
--      sem a trava a rodada bateria na recusa dela todo dia;
--   2. dez dias antes, nao no dia (decisao dela, depois de eu mostrar que
--      "no dia do vencimento" da ao cliente zero dia para pagar);
--   3. emitida NAO volta para a fila. E a trava contra a cobranca dupla;
--   4. mas FALHOU volta — queda de rede nao pode virar cliente sem boleto —
--      e para de voltar depois de tres tentativas, porque a partir dai o
--      problema nao e a rede;
--   5. o MESMO aviso da Asaas processado duas vezes nao da baixa duas
--      vezes. A Asaas reenvia ate receber 200: receber repetido e o caso
--      normal, nao a excecao;
--   6. o aviso de pagamento liquida o LANCAMENTO junto — cobranca paga com
--      lancamento em aberto faz o painel mentir no numero que ela mais olha;
--   7. estorno e exclusao desfazem a baixa;
--   8. `cobranca_eventos` e append-only: historico de dinheiro nao se
--      corrige, se acrescenta;
--   9. e quem nao cuida do dinheiro nao mexe em nada disto.
--
-- O 3 e o 5 sao os que justificam o arquivo.
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
  ('20000000-0000-0000-0000-000000000001', 'Com Documento', 'com-doc',  'America/Sao_Paulo'),
  ('20000000-0000-0000-0000-000000000002', 'Sem Documento', 'sem-doc',  'America/Sao_Paulo');

do $$
declare
  v_sub   uuid;
  v_perto uuid;   -- vence dentro da janela
  v_longe uuid;   -- vence depois dela
  v_sem   uuid;   -- cliente sem CPF/CNPJ
  v_cb    uuid;
  v_fila  jsonb;
  v_n     int;
  ok      boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  -- 1. O CADASTRO, com mascara: o banco guarda so digitos.
  perform public.salvar_dados_de_cobranca(
    '20000000-0000-0000-0000-000000000001',
    '12.345.678/0001-90', 'financeiro@comdoc.com.br', '(11) 98888-7777');
  perform public.afirma(
    (select cnpj_cpf from public.clientes where id = '20000000-0000-0000-0000-000000000001')
      = '12345678000190',
    'o CNPJ entra sem mascara — senao o mesmo cliente vira dois para qualquer busca');
  perform public.afirma(
    (select telefone from public.clientes where id = '20000000-0000-0000-0000-000000000001')
      = '11988887777',
    'e o telefone tambem');

  begin
    perform public.salvar_dados_de_cobranca(
      '20000000-0000-0000-0000-000000000002', '123');
    ok := false;
  -- Casa com o pedaco SEM acento de proposito: a mensagem ganhou acento na
  -- 0087 ("11 dígitos"), e um teste casado na palavra inteira quebra a cada
  -- revisao de texto. O que importa aqui e que a recusa DIZ o tamanho certo.
  exception when others then ok := position('11 d' in sqlerrm) > 0
                               and position('14' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'documento com tamanho errado e recusado, dizendo o tamanho certo');

  select sub.id into v_sub
    from public.financeiro_subcategorias sub
    join public.financeiro_categorias cat on cat.id = sub.categoria_id
    join public.financeiro_grupos g on g.id = cat.grupo_id
   where g.chave = 'receita' limit 1;

  -- Tres lancamentos de receita, em situacoes diferentes.
  v_perto := public.criar_lancamento('Mensalidade 03/2026', v_sub, 150000,
    current_date + 5, p_cliente => '20000000-0000-0000-0000-000000000001');
  v_longe := public.criar_lancamento('Mensalidade 04/2026', v_sub, 150000,
    current_date + 40, p_cliente => '20000000-0000-0000-0000-000000000001');
  v_sem   := public.criar_lancamento('Job do sem documento', v_sub, 90000,
    current_date + 3, p_cliente => '20000000-0000-0000-0000-000000000002');

  -- 1 e 2. A FILA: janela de dez dias, e so quem tem documento.
  v_fila := public.cobrancas_para_emitir();
  perform public.afirma(jsonb_array_length(v_fila) = 1,
    'so um entra na fila: o que vence dentro de dez dias, de cliente com documento');
  perform public.afirma(
    (v_fila->0->>'lancamentoId')::uuid = v_perto, 'e e o certo');
  perform public.afirma(
    (v_fila->0->>'cnpjCpf') = '12345678000190',
    'a fila ja leva o documento, para a rodada nao ter de voltar ao banco');

  perform public.afirma(
    (select count(*) from jsonb_array_elements(public.cobrancas_para_emitir()) x
      where (x->>'lancamentoId')::uuid = v_sem) = 0,
    'cliente SEM documento fica de fora — a Asaas recusaria, todo dia, para sempre');

  -- A janela e o que a decisao dela diz. Com 45 dias, o de abril entra.
  perform public.afirma(
    jsonb_array_length(public.cobrancas_para_emitir('sandbox', 45)) = 2,
    'alargando a janela, o de abril entra: a regra e a janela, nao o acaso');

  -- SANDBOX E PRODUCAO NAO SE MISTURAM.
  --
  -- Os dois ambientes da Asaas nao compartilham nada: o cliente criado num
  -- nao existe no outro. Sem esta separacao, no dia em que a chave virar
  -- para producao a plataforma tentaria cobrar codigos fantasmas e erraria
  -- com "customer not found" para todo mundo, sem dizer por que.
  perform public.casar_cliente_com_asaas(
    '20000000-0000-0000-0000-000000000001', 'cus_sandbox_1', 'sandbox');
  perform public.afirma(
    (public.cobrancas_para_emitir('sandbox')->0->>'asaasCustomer') = 'cus_sandbox_1',
    'rodando em sandbox, a fila entrega o codigo de sandbox');
  perform public.afirma(
    (public.cobrancas_para_emitir('producao')->0->>'asaasCustomer') is null,
    'rodando em producao, o codigo de sandbox NAO vem — o emissor cria o cliente de novo');

  begin
    perform public.casar_cliente_com_asaas(
      '20000000-0000-0000-0000-000000000001', 'cus_x', 'homologacao');
    ok := false;
  exception when others then ok := position('sandbox ou produção' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'ambiente inventado e recusado');

  -- 3. EMITIDA NAO VOLTA PARA A FILA.
  v_cb := public.cobranca_emitida(
    v_perto, 'pay_000111', 'https://sandbox.asaas.com/b/pdf/000111',
    '00020126...5802BR', current_date + 5, 150000, 'sandbox');
  perform public.afirma(v_cb is not null, 'a emissao grava a cobranca');
  perform public.afirma(
    jsonb_array_length(public.cobrancas_para_emitir()) = 0,
    'e o lancamento sai da fila — e esta e a trava contra cobrar duas vezes');

  -- Rodada repetida: ATUALIZA, nao cria uma segunda cobranca.
  select count(*) into v_n from public.cobrancas;
  perform public.cobranca_emitida(
    v_perto, 'pay_000111', 'https://sandbox.asaas.com/b/pdf/000111',
    '00020126...5802BR', current_date + 5, 150000, 'sandbox');
  perform public.afirma((select count(*) from public.cobrancas) = v_n,
    'emitir o mesmo lancamento de novo nao cria uma segunda cobranca');

  -- 4. FALHOU VOLTA, ate a terceira tentativa.
  perform public.cobranca_falhou(v_longe, 'A Asaas recusou: CNPJ invalido.');
  perform public.afirma(
    (select status::text from public.cobrancas where lancamento_id = v_longe) = 'falhou',
    'a falha fica gravada');
  perform public.afirma(
    (select ultimo_erro from public.cobrancas where lancamento_id = v_longe)
      = 'A Asaas recusou: CNPJ invalido.',
    'com o motivo em portugues, para aparecer na tela');
  perform public.afirma(
    (select count(*) from jsonb_array_elements(public.cobrancas_para_emitir('sandbox', 45)) x
      where (x->>'lancamentoId')::uuid = v_longe) = 1,
    'e ela VOLTA para a fila: queda de rede nao pode virar cliente sem boleto');

  perform public.cobranca_falhou(v_longe, 'de novo');
  perform public.cobranca_falhou(v_longe, 'e de novo');
  perform public.afirma(
    (select tentativas from public.cobrancas where lancamento_id = v_longe) = 3,
    'as tentativas sao contadas');
  perform public.afirma(
    (select count(*) from jsonb_array_elements(public.cobrancas_para_emitir('sandbox', 45)) x
      where (x->>'lancamentoId')::uuid = v_longe) = 0,
    'e na terceira ela para de voltar: dai em diante o problema nao e a rede');

  -- O PIX QUE CHEGA DEPOIS.
  --
  -- A Asaas gera o QR do pix alguns SEGUNDOS depois de criar a cobranca: no
  -- primeiro ciclo de verdade em sandbox ele veio vazio, e existia logo em
  -- seguida. O defeito nao era o pix faltar — era ele NUNCA MAIS ser
  -- buscado, porque cobranca emitida sai da fila de emissao de proposito.
  -- O cliente abriria o portal e veria meia cobranca, sem erro nenhum.
  update public.cobrancas set pix_payload = null where id = v_cb;
  perform public.afirma(
    (select count(*) from jsonb_array_elements(public.cobrancas_sem_pix('sandbox')) x
      where (x->>'lancamentoId')::uuid = v_perto) = 1,
    'cobranca emitida sem pix entra na fila de buscar o pix');

  perform public.cobranca_ganhou_pix(v_perto, '00020101021226820014br.gov.bcb.pix...');
  perform public.afirma(
    (select pix_payload from public.cobrancas where id = v_cb) is not null,
    'e o pix e preenchido');
  perform public.afirma(
    jsonb_array_length(public.cobrancas_sem_pix('sandbox')) = 0,
    'e ela sai dessa fila');

  -- Preencher de novo NAO sobrescreve: o cliente pode ja ter copiado o
  -- codigo, e trocar por baixo quebraria o pagamento dele.
  begin
    perform public.cobranca_ganhou_pix(v_perto, 'outro_pix_qualquer');
    ok := false;
  exception when others then ok := position('já tem pix' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'e nao se reescreve um pix que o cliente ja pode ter copiado');

  -- A fila do pix nao e uma porta para emitir: ela so preenche um campo.
  perform public.afirma(
    not has_function_privilege('authenticated', 'public.cobranca_ganhou_pix(uuid, text)', 'execute'),
    'e nem essa funcao e alcancavel pela tela');

  -- 5 e 6. O AVISO DE PAGAMENTO.
  perform public.afirma(
    public.registrar_evento_de_cobranca(
      'evt_aaa', 'PAYMENT_RECEIVED', 'pay_000111',
      '{"id":"pay_000111"}'::jsonb, current_date, 150000, 'PIX'),
    'o aviso de pagamento e processado');
  perform public.afirma(
    (select status::text from public.cobrancas where id = v_cb) = 'paga',
    'a cobranca vira paga');
  perform public.afirma(
    (select status::text from public.lancamentos where id = v_perto) = 'liquidado',
    'e o LANCAMENTO e liquidado junto — senao o painel mente no numero que ela olha');
  perform public.afirma(
    (select situacao from public.lancamentos_com_situacao where id = v_perto) = 'recebido',
    'e a tela passa a mostrar "recebido"');

  -- O MESMO AVISO DE NOVO. A Asaas reenvia ate receber 200.
  perform public.afirma(
    public.registrar_evento_de_cobranca(
      'evt_aaa', 'PAYMENT_RECEIVED', 'pay_000111',
      '{"id":"pay_000111"}'::jsonb, current_date + 1, 999999, 'BOLETO') = false,
    'o MESMO aviso de novo devolve false — reenvio e no-op, nao erro');
  perform public.afirma(
    (select valor_pago_centavos from public.cobrancas where id = v_cb) = 150000,
    'e nao reescreve o valor pago com o do reenvio');
  select count(*) into v_n from public.cobranca_eventos where evento_externo_id = 'evt_aaa';
  perform public.afirma(v_n = 1, 'o evento ficou guardado uma vez so');

  -- 7. ESTORNO DESFAZ.
  perform public.afirma(
    public.registrar_evento_de_cobranca(
      'evt_bbb', 'PAYMENT_REFUNDED', 'pay_000111', '{}'::jsonb),
    'o estorno e processado');
  perform public.afirma(
    (select status::text from public.cobrancas where id = v_cb) = 'cancelada',
    'a cobranca volta para cancelada');
  perform public.afirma(
    (select status::text from public.lancamentos where id = v_perto) = 'previsto',
    'e o lancamento volta para previsto — dinheiro que voltou nao e dinheiro que entrou');

  -- Evento de cobranca que nao e nossa: fica registrado e nao mexe em nada.
  perform public.afirma(
    public.registrar_evento_de_cobranca('evt_ccc', 'PAYMENT_RECEIVED', 'pay_de_outro'),
    'aviso de cobranca desconhecida e aceito');
  perform public.afirma(
    (select cobranca_id is null from public.cobranca_eventos where evento_externo_id = 'evt_ccc'),
    'e fica sem dono, sem mexer em dinheiro nenhum');

  -- Aviso sem id de evento e recusado: sem ele nao ha idempotencia.
  begin
    perform public.registrar_evento_de_cobranca('   ', 'PAYMENT_RECEIVED', 'pay_000111');
    ok := false;
  exception when others then ok := position('id de evento' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'aviso sem id de evento e recusado: sem ele nao ha idempotencia');

  -- 8. APPEND-ONLY.
  begin
    update public.cobranca_eventos set tipo = 'MENTIRA' where evento_externo_id = 'evt_aaa';
    ok := false;
  exception when others then ok := position('append-only' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'nao se corrige um evento de dinheiro');
  begin
    delete from public.cobranca_eventos where evento_externo_id = 'evt_aaa';
    ok := false;
  exception when others then ok := position('append-only' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'nem se apaga');

  -- O EVENTO SOBREVIVE A COBRANCA.
  --
  -- Descoberto apagando o cliente de teste depois do ciclo em sandbox: a
  -- chave estrangeira fazia `set null` no delete, `set null` e UPDATE, e
  -- UPDATE bate no append-only. Resultado: nenhuma cobranca com historico
  -- podia ser apagada, e por cascata nenhum lancamento nem cliente ja
  -- cobrado. Um cadastro errado ficaria preso para sempre.
  delete from public.cobrancas where id = v_cb;
  perform public.afirma(
    (select count(*) from public.cobranca_eventos where evento_externo_id = 'evt_aaa') = 1,
    'apagar a cobranca NAO apaga o evento: o log registra o que o provedor disse');
  perform public.afirma(
    not exists (select 1 from public.cobrancas where id = v_cb),
    'e a cobranca sai mesmo — sem a FK, o delete passa');

  -- E APAGAR LANCAMENTO COM COBRANCA VIVA E RECUSADO.
  --
  -- Sumir com a linha aqui deixaria o boleto de pe na Asaas, e o cliente
  -- receberia a cobranca de algo que para nos nao existe mais.
  perform public.estornar_lancamento(v_longe);
  perform public.cobranca_emitida(v_longe, 'pay_viva', null, null, current_date + 40, 150000, 'sandbox');
  begin
    perform public.apagar_lancamento(v_longe);
    ok := false;
  exception when others then ok := position('Cancele a cobrança lá antes' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'lancamento com cobranca emitida na Asaas nao se apaga sem cancelar la primeiro');

  -- A TELA DO FINANCEIRO.
  perform public.afirma(
    jsonb_array_length(public.cobrancas_do_mes(current_date)) >= 1,
    'a tela do financeiro ve as cobrancas do mes');
end $$;

-- ---------------------------------------------------------------------------
-- 9. QUEM NAO CUIDA DO DINHEIRO NAO MEXE, E AS FUNCOES DE SERVICO SAO DO
--    SERVICE ROLE.
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- Raquel, operacao
do $$
declare ok boolean;
begin
  begin
    perform public.salvar_dados_de_cobranca(
      '20000000-0000-0000-0000-000000000001', '12345678000190');
    ok := false;
  exception when others then ok := position('dinheiro' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'a operacao nao cadastra dados de cobranca');
  perform public.afirma(public.cobrancas_do_mes() is null,
    'nem ve as cobrancas do mes');
end $$;

do $$
begin
  perform public.afirma(
    not has_function_privilege('authenticated',
      'public.registrar_evento_de_cobranca(text, text, text, jsonb, date, bigint, text)',
      'execute'),
    'dar baixa em pagamento nao e coisa que a tela faca');
  perform public.afirma(
    not has_function_privilege('authenticated', 'public.cobrancas_para_emitir(text, int, int)', 'execute'),
    'nem ler a fila de emissao');
  perform public.afirma(
    not has_function_privilege('authenticated',
      'public.cobranca_emitida(uuid, text, text, text, date, bigint, text)', 'execute'),
    'nem marcar uma cobranca como emitida');
  perform public.afirma(
    has_function_privilege('service_role',
      'public.registrar_evento_de_cobranca(text, text, text, jsonb, date, bigint, text)',
      'execute'),
    'mas o service role, que e quem recebe o webhook, pode');

  -- O COFRE NAO E LIDO PELA TELA, NEM PELA API.
  --
  -- A primeira versao da Edge Function tentava `sb.schema('vault')` e levou
  -- "Invalid schema: vault" na primeira chamada de verdade. Nao e falta de
  -- configuracao: o PostgREST nao expoe o cofre de proposito, e expor seria
  -- abrir a porta dos segredos para qualquer chave de leitura. Quem le e uma
  -- funcao do banco, e so o service role a executa.
  perform public.afirma(
    not has_function_privilege('authenticated', 'public.config_asaas()', 'execute'),
    'a chave da Asaas nao e alcancavel pela tela');
  perform public.afirma(
    not has_function_privilege('anon', 'public.config_asaas()', 'execute'),
    'nem por quem nao entrou');
  perform public.afirma(
    not has_function_privilege('authenticated', 'public.token_do_webhook_asaas()', 'execute'),
    'nem o token do webhook');
  perform public.afirma(
    has_function_privilege('service_role', 'public.config_asaas()', 'execute'),
    'so o service role, que e quem roda a emissao');
end $$;
