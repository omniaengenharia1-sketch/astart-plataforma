-- =============================================================================
-- Smoke da 0071 — o comercial com objetivo.
--
-- A dona: "a parte comercial ta um pouco vaga ali, eu nao consigo mexer em
-- nada. (...) ela tem que ter um fundamento, um objetivo."
--
-- O objetivo da tela e responder "com quem eu preciso falar hoje, e o que eu
-- combinei da ultima vez". Este arquivo cobra as regras que sustentam isso:
--
--   1. criar lead pede so o NOME — formulario de dez campos nao se preenche;
--   2. registrar interacao faz TRES coisas juntas: anota, carimba a data e
--      marca o proximo passo. E tira o lead de "novo" sozinho;
--   3. o historico ACUMULA, nunca sobrescreve;
--   4. perdido sem motivo e recusado;
--   5. converter exige um cliente que existe, e amarra os dois;
--   6. lead convertido nao se apaga;
--   7. a agenda separa atrasado, hoje, semana e SEM follow-up;
--   8. quem nao cuida do dinheiro nao entra aqui.
--
-- O 7 e o motivo deste arquivo. A lista "sem follow-up" e a que ninguem pensa
-- em fazer, e e exatamente onde o lead morre — sem ninguem decidir que morreu.
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
  ('20000000-0000-0000-0000-000000000001', 'Virou Cliente', 'virou', 'America/Sao_Paulo');

do $$
declare
  v_a   uuid;   -- atrasado
  v_h   uuid;   -- hoje
  v_s   uuid;   -- semana
  v_n   uuid;   -- sem follow-up
  v_hist text;
  v_ag  jsonb;
  ok    boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  -- 1. SO O NOME.
  v_n := public.criar_lead('Padaria da Esquina');
  perform public.afirma(v_n is not null, 'da para criar lead so com o nome');
  perform public.afirma(
    (select etapa::text from public.leads where id = v_n) = 'novo',
    'e ele nasce em "novo"');
  perform public.afirma(
    (select responsavel_id from public.leads where id = v_n)
      = '10000000-0000-0000-0000-000000000001',
    'com quem criou como responsavel, sem precisar escolher');

  -- 2. REGISTRAR FAZ TRES COISAS DE UMA VEZ.
  perform public.registrar_interacao_do_lead(
    v_n, 'Liguei, tem interesse em gestao de redes', 'Mandar proposta', current_date + 2);
  perform public.afirma(
    (select ultima_interacao_em from public.leads where id = v_n) = current_date,
    'registrar carimba a data da ultima conversa');
  perform public.afirma(
    (select proximo_passo from public.leads where id = v_n) = 'Mandar proposta',
    'e grava o proximo passo');
  perform public.afirma(
    (select proximo_followup_em from public.leads where id = v_n) = current_date + 2,
    'com data — lead sem proxima data e lead esquecido');
  perform public.afirma(
    (select etapa::text from public.leads where id = v_n) = 'conversando',
    'e o lead sai de "novo" sozinho: etapa que depende de lembrar fica errada');

  -- 3. O HISTORICO ACUMULA.
  perform public.registrar_interacao_do_lead(v_n, 'Mandei a proposta por email');
  select historico into v_hist from public.leads where id = v_n;
  perform public.afirma(position('tem interesse' in v_hist) > 0,
    'a primeira conversa continua no historico');
  perform public.afirma(position('Mandei a proposta' in v_hist) > 0,
    'e a segunda entrou junto');
  perform public.afirma(position('Layana' in v_hist) > 0,
    'com quem falou, porque daqui a seis meses isso importa');
  perform public.afirma(
    position(to_char(current_date, 'DD/MM/YYYY') in v_hist) > 0,
    'e com a data na frente');

  -- Sem texto nao registra: linha vazia no historico e pior que nada.
  begin
    perform public.registrar_interacao_do_lead(v_n, '   ');
    ok := false;
  exception when others then ok := position('conversado' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'registrar sem texto e recusado');

  -- 4. PERDIDO SEM MOTIVO NAO PASSA.
  begin
    perform public.mover_lead(v_n, 'perdido');
    ok := false;
  exception when others then ok := position('motivo' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'perdido sem motivo e recusado, dizendo por que');
  perform public.mover_lead(v_n, 'perdido', 'Achou caro');
  perform public.afirma(
    (select motivo_desqualificacao from public.leads where id = v_n) = 'Achou caro',
    'e com motivo entra, e o motivo fica escrito');

  -- 5. CONVERTER AMARRA OS DOIS.
  v_h := public.criar_lead('Vai Fechar', 'Empresa X', '11999999999');
  begin
    perform public.converter_lead(v_h, '20000000-0000-0000-0000-0000000000ff');
    ok := false;
  exception when others then ok := position('não encontrado' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'converter para cliente que nao existe e recusado');

  perform public.converter_lead(v_h, '20000000-0000-0000-0000-000000000001');
  perform public.afirma(
    (select etapa::text from public.leads where id = v_h) = 'fechado',
    'converter fecha o lead');
  perform public.afirma(
    (select cliente_id from public.leads where id = v_h)
      = '20000000-0000-0000-0000-000000000001',
    'e amarra ao cliente, para a historia da venda nao se perder');
  perform public.afirma(
    (select proximo_followup_em is null from public.leads where id = v_h),
    'e tira da fila de follow-up: ja fechou');

  -- 6. LEAD CONVERTIDO NAO SE APAGA.
  begin
    perform public.apagar_lead(v_h);
    ok := false;
  exception when others then ok := position('começo daquele contrato' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'lead que virou cliente nao e apagado');

  -- 7. A AGENDA SEPARA O QUE DOI DO QUE PODE ESPERAR.
  v_a := public.criar_lead('Atrasado');
  perform public.registrar_interacao_do_lead(v_a, 'falei', 'retomar', current_date - 3);
  v_s := public.criar_lead('Semana que vem');
  perform public.registrar_interacao_do_lead(v_s, 'falei', 'retomar', current_date + 4);
  v_h := public.criar_lead('Para hoje');
  perform public.registrar_interacao_do_lead(v_h, 'falei', 'retomar', current_date);
  v_n := public.criar_lead('Sem data nenhuma');

  v_ag := public.agenda_comercial();
  perform public.afirma(jsonb_array_length(v_ag->'atrasados') = 1, 'a agenda separa o atrasado');
  perform public.afirma(jsonb_array_length(v_ag->'hoje') = 1, 'o de hoje');
  perform public.afirma(jsonb_array_length(v_ag->'semana') = 1, 'e o dos proximos sete dias');
  perform public.afirma(jsonb_array_length(v_ag->'semFollowup') = 1,
    'e mostra quem esta SEM proxima data — e ali que o lead morre sem ninguem decidir');
  perform public.afirma(
    (v_ag->'atrasados'->0->>'nome') = 'Atrasado', 'o atrasado e o certo');
end $$;

-- 8. Quem nao cuida do dinheiro nao entra no comercial.
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- Raquel, operacao
do $$
declare ok boolean;
begin
  perform public.afirma(public.agenda_comercial() is null, 'operacao nao abre a agenda comercial');
  perform public.afirma(public.funil() is null, 'nem o funil');
  begin
    perform public.criar_lead('Lead da Raquel');
    ok := false;
  exception when others then ok := position('dinheiro' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'e nao cria lead');
end $$;
