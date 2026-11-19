-- =============================================================================
-- Smoke da 0079 — a ponte com o Google Agenda, no lado do banco.
--
-- A dona: "a agenda eu preciso que vc deixe ela integrada no google agenda",
-- nos dois sentidos, com a conta de cada pessoa.
--
-- O PIOR BUG POSSIVEL DESTA PONTE e duplicar compromisso na agenda de
-- alguem, ou deixar la um que foi desmarcado aqui. Os dois acontecem na
-- segunda semana, nao no primeiro teste: a rede cai no meio de uma rodada, o
-- cron repete, o cursor do Google vence. Entao e isso que este arquivo
-- persegue.
--
--   1. ligar a agenda, e a mesma agenda nao caber em duas pessoas;
--   2. PARA ONDE VAI cada compromisso: do responsavel; sem responsavel, de
--      quem criou. Sem essa regra, ou nao vai para lugar nenhum ou vai para
--      todas as agendas da equipe;
--   3. so entra na fila de empurrar o que mudou depois da ultima ida — e
--      NUNCA o que veio do Google, senao e pingue-pongue sem fim;
--   4. o mesmo evento do Google aplicado duas vezes ATUALIZA, nao duplica;
--   5. desmarcar aqui deixa a lapide, para a rodada apagar la. Sem isso o
--      compromisso fica para sempre no celular da pessoa, e alguem aparece
--      numa gravacao que nao existe mais;
--   6. apagado no Google some daqui, e a lapide nao renasce — senao a rodada
--      seguinte tentaria apagar de novo, para sempre;
--   7. o cursor da sincronizacao so avanca quando a rodada deu certo;
--   8. e ninguem ve a ligacao de outra pessoa, nem as funcoes de servico.
--
-- O 3, o 4 e o 5 sao os que justificam o arquivo.
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

do $$
declare
  v_a    uuid;
  v_b    uuid;
  v_g    uuid;
  v_fila jsonb;
  v_n    int;
  ok     boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  -- 1. LIGAR.
  perform public.ligar_agenda_google('astart.studio@gmail.com');
  perform public.afirma(
    (public.minha_agenda_google()->>'ligada')::boolean,
    'a direcao liga a propria agenda');
  perform public.afirma(
    public.minha_agenda_google()->>'calendarId' = 'astart.studio@gmail.com',
    'e a tela sabe qual e');

  -- A MESMA agenda em duas pessoas seria duplicata garantida: cada uma
  -- empurraria os proprios compromissos para o mesmo lugar.
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000002', false);
  begin
    perform public.ligar_agenda_google('ASTART.STUDIO@gmail.com');   -- caixa alta
    ok := false;
  exception when others then ok := position('outra pessoa' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'a mesma agenda nao entra em duas pessoas, nem com caixa diferente');

  perform public.ligar_agenda_google('raquel.astart@gmail.com');
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  -- 2. PARA ONDE VAI CADA COMPROMISSO.
  v_a := public.criar_compromisso('Reuniao de pauta', now() + interval '2 days');
  v_b := public.criar_compromisso(
    'Gravacao', now() + interval '3 days', null, false, null,
    '10000000-0000-0000-0000-000000000002');   -- responsavel: Raquel

  perform public.afirma(
    (select dono_id from public.compromissos where id = v_a)
      = '10000000-0000-0000-0000-000000000001',
    'sem responsavel, o dono e quem criou');
  perform public.afirma(
    (select dono_id from public.compromissos where id = v_b)
      = '10000000-0000-0000-0000-000000000002',
    'com responsavel, o dono e o responsavel — e e para a agenda DELE que vai');

  -- 3. A FILA DO QUE FALTA EMPURRAR.
  v_fila := public.compromissos_para_empurrar();
  perform public.afirma(jsonb_array_length(v_fila) = 2,
    'os dois entram na fila: nenhum foi para o Google ainda');
  perform public.afirma(
    (select count(*) from jsonb_array_elements(v_fila) x
      where x->>'calendarId' = 'raquel.astart@gmail.com') = 1,
    'e cada um vai para a agenda do dono dele');

  -- A rodada LE o compromisso agora, e guarda o instante — e ele que volta
  -- em `casar_compromisso_com_google`, como a Edge Function faz.
  create temp table lido_pela_rodada as
    select id, atualizado_em from public.compromissos where id = v_a;
end $$;

-- TRANSACAO 2: a pessoa corrige, DEPOIS de a rodada ler e ANTES de ela gravar.
set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$
begin
  perform public.editar_compromisso(
    (select id from lido_pela_rodada), p_titulo => 'Reuniao de pauta (remarcada)');
end $$;

-- TRANSACAO 3: a rodada grava o que tinha lido.
--
-- AQUI MORA A CORRIDA. Com carimbo de `now()` na hora de gravar, este carimbo
-- ficaria DEPOIS da correcao e o compromisso sumiria da fila para sempre: o
-- Google guardaria o titulo velho, calado, e ninguem jamais saberia. Com o
-- instante LIDO, a correcao continua mais nova e a proxima rodada a leva.
set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$
declare v_a uuid;
begin
  select id into v_a from lido_pela_rodada;
  perform public.casar_compromisso_com_google(
    v_a, 'astart.studio@gmail.com', 'evt_a',
    (select atualizado_em from lido_pela_rodada));
  perform public.afirma(
    (select count(*) from jsonb_array_elements(public.compromissos_para_empurrar()) x
      where (x->>'id')::uuid = v_a) = 1,
    'correcao feita no meio da rodada NAO se perde — e a corrida que deixaria '
    'o titulo velho no Google para sempre');

  -- E quando nada muda depois da leitura, sai da fila como tem de sair.
  perform public.casar_compromisso_com_google(
    v_a, 'astart.studio@gmail.com', 'evt_a',
    (select atualizado_em from public.compromissos where id = v_a));
  perform public.afirma(
    (select count(*) from jsonb_array_elements(public.compromissos_para_empurrar()) x
      where (x->>'id')::uuid = v_a) = 0,
    'o que ja foi para o Google, e nao mudou desde entao, sai da fila');
end $$;


set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$
declare
  v_a    uuid;
  v_b    uuid;
  v_g    uuid;
  v_n    int;
begin
  select id into v_a from public.compromissos where titulo like 'Reuniao de pauta%';
  select id into v_b from public.compromissos where titulo = 'Gravacao';

  -- 4. O QUE VEM DO GOOGLE ENTRA UMA VEZ SO.
  v_g := public.aplicar_evento_do_google(
    '10000000-0000-0000-0000-000000000001', 'astart.studio@gmail.com', 'evt_do_google',
    'Dentista', now() + interval '5 days');
  perform public.afirma(v_g is not null, 'um evento do Google vira compromisso aqui');

  -- A MESMA rodada repetida — rede caiu, cron repetiu. Tem de ATUALIZAR.
  select count(*) into v_n from public.compromissos;
  perform public.aplicar_evento_do_google(
    '10000000-0000-0000-0000-000000000001', 'astart.studio@gmail.com', 'evt_do_google',
    'Dentista (mudou de hora)', now() + interval '5 days 2 hours');
  perform public.afirma((select count(*) from public.compromissos) = v_n,
    'aplicar o MESMO evento de novo nao cria outro — e o pior bug desta ponte');
  perform public.afirma(
    (select titulo from public.compromissos where id = v_g) = 'Dentista (mudou de hora)',
    'ele apenas se atualiza');

  -- 3b. O QUE ACABOU DE CHEGAR DE LA NAO VOLTA PARA LA.
  --
  -- Pingue-pongue sem fim. Quem impede NAO e um filtro por origem — eu tinha
  -- posto um e ele travava tambem a volta LEGITIMA, em silencio. Quem impede
  -- e o carimbo: aplicar do Google marca `google_sincronizado_em` no mesmo
  -- instante em que grava, entao nada fica pendente.
  perform public.afirma(
    (select count(*) from jsonb_array_elements(public.compromissos_para_empurrar()) x
      where (x->>'id')::uuid = v_g) = 0,
    'o que acabou de chegar do Google nao e empurrado de volta na hora');

  -- 5. DESMARCAR AQUI DEIXA A LAPIDE.
  perform public.apagar_compromisso(v_a);
  perform public.afirma(
    exists (select 1 from public.compromissos_apagados
             where google_event_id = 'evt_a' and google_calendar_id = 'astart.studio@gmail.com'),
    'desmarcar deixa a lapide, para a rodada apagar no Google tambem');

  -- Compromisso que NUNCA foi para o Google nao deixa lapide: nao ha o que
  -- apagar la, e a fila ficaria presa tentando.
  perform public.apagar_compromisso(v_b);
  select count(*) into v_n from public.compromissos_apagados;
  perform public.afirma(v_n = 1, 'o que nunca foi para la nao deixa lapide');

  perform public.afirma(
    jsonb_array_length(public.apagados_para_o_google()) = 1,
    'e a fila de apagar mostra o que falta');

  -- 6. APAGADO NO GOOGLE SOME DAQUI, SEM RENASCER A LAPIDE.
  --
  -- O gatilho dispara em todo delete. Se a lapide nascesse de novo aqui, a
  -- rodada seguinte tentaria apagar no Google um evento que o Google acabou
  -- de apagar — para sempre.
  perform public.afirma(
    public.apagar_compromisso_do_google('astart.studio@gmail.com', 'evt_do_google'),
    'evento cancelado no Google some daqui');
  perform public.afirma(
    not exists (select 1 from public.compromissos_apagados
                 where google_event_id = 'evt_do_google'),
    'e NAO deixa lapide: o Google ja apagou, nao ha o que pedir a ele');

  -- 7. O CURSOR SO AVANCA QUANDO DEU CERTO.
  perform public.registrar_sincronia(
    '10000000-0000-0000-0000-000000000001', 'cursor_bom', null);
  perform public.afirma(
    (select sync_token from public.agendas_google
      where user_id = '10000000-0000-0000-0000-000000000001') = 'cursor_bom',
    'rodada boa grava o cursor');

  perform public.registrar_sincronia(
    '10000000-0000-0000-0000-000000000001', 'cursor_de_rodada_quebrada', 'O Google recusou.');
  perform public.afirma(
    (select sync_token from public.agendas_google
      where user_id = '10000000-0000-0000-0000-000000000001') = 'cursor_bom',
    'rodada que falhou NAO avanca o cursor — perderia o que faltou buscar');
  perform public.afirma(
    (select ultimo_erro from public.agendas_google
      where user_id = '10000000-0000-0000-0000-000000000001') = 'O Google recusou.',
    'e o erro fica gravado, em portugues, para aparecer em Ajustes');
  perform public.afirma(
    public.minha_agenda_google()->>'ultimoErro' = 'O Google recusou.',
    'e a tela da pessoa mostra — falha silenciosa e proibida');

  -- Desligar nao apaga o vinculo dos que ja foram: religar nao duplica.
  perform public.desligar_agenda_google();
  perform public.afirma(
    not (public.minha_agenda_google()->>'ligada')::boolean, 'desligar desliga');
  perform public.afirma(
    jsonb_array_length(public.agendas_google_ativas()) = 1,
    'e a rodada passa a visitar so quem continua ligado');
end $$;

-- MAS CORRIGIR AQUI UM EVENTO QUE NASCEU LA TEM DE VOLTAR PARA LA.
--
-- E a metade da "mao dupla" que o filtro por origem matava em silencio. Em
-- transacao separada porque `atualizado_em` so fica maior depois do commit.
set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$
declare v_g uuid;
begin
  -- A direcao desligou a agenda no bloco anterior. Religa: a fila so olha
  -- quem esta ligado, e e justamente isso que este bloco vai medir.
  perform public.ligar_agenda_google('astart.studio@gmail.com');
  v_g := public.aplicar_evento_do_google(
    '10000000-0000-0000-0000-000000000001', 'astart.studio@gmail.com', 'evt_nasceu_la',
    'Consulta', now() + interval '9 days');
  perform public.afirma(
    (select origem from public.compromissos where id = v_g) = 'google',
    'o evento nasceu no Google');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$
declare v_g uuid;
begin
  select id into v_g from public.compromissos where google_event_id = 'evt_nasceu_la';
  perform public.editar_compromisso(v_g, p_local => 'Mudou de lugar');
  perform public.afirma(
    (select count(*) from jsonb_array_elements(public.compromissos_para_empurrar()) x
      where (x->>'id')::uuid = v_g) = 1,
    'corrigir aqui um evento que nasceu no Google o manda de volta — sem isso, '
    'metade da mao dupla nao existe');
end $$;

-- ---------------------------------------------------------------------------
-- 8. NINGUEM ESPIA A LIGACAO DE OUTRA PESSOA, E AS FUNCOES DE SERVICO SAO
--    SO DO SERVICE ROLE.
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$
begin
  perform public.afirma(
    public.minha_agenda_google()->>'calendarId' = 'raquel.astart@gmail.com',
    'cada um ve a propria ligacao');
end $$;

do $$
declare ok boolean;
begin
  -- `authenticated` nao tem execute nestas. Quem chama e a Edge Function.
  perform public.afirma(
    not has_function_privilege('authenticated', 'public.agendas_google_ativas()', 'execute'),
    'a lista de todas as agendas nao e para a tela');
  perform public.afirma(
    not has_function_privilege('authenticated',
      'public.aplicar_evento_do_google(uuid, text, text, text, timestamptz, timestamptz, boolean, text, text, text)',
      'execute'),
    'nem escrever evento como se viesse do Google');
  perform public.afirma(
    not has_function_privilege('authenticated', 'public.registrar_sincronia(uuid, text, text)', 'execute'),
    'nem mexer no cursor da sincronizacao');
  perform public.afirma(
    has_function_privilege('service_role', 'public.agendas_google_ativas()', 'execute'),
    'mas o service role, que e quem roda a ponte, pode');
end $$;
