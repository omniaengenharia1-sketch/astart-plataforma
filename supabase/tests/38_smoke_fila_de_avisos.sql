-- Smoke da 0067 — a fila de avisos do quadro.
--
-- O que tem de valer:
--   1. reservar devolve o aviso pendente, com e-mail e titulo prontos;
--   2. RESERVADO NAO SAI DE NOVO — duas invocacoes que se cruzem nao mandam o
--      mesmo e-mail duas vezes;
--   3. reserva ABANDONADA volta para a fila sozinha;
--   4. falhar reagenda com espera que dobra, e na sexta desiste;
--   5. enviado sai da fila para sempre;
--   6. `segredo_do_cofre` recusa nome fora da lista;
--   7. so a direcao ve a lista de travados.
--
-- O 2 e o motivo deste arquivo. A regra do projeto diz que o pior bug
-- possivel e publicar duas vezes na conta de um cliente; aqui o equivalente e
-- a Raquel receber o mesmo aviso tres vezes e parar de ler os avisos. Lista
-- com `enviado_em` nulo nao basta: sem reservar antes de enviar, duas
-- invocacoes pegam a mesma linha.
-- ---------------------------------------------------------------------------
begin;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'layana@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'raquel@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Layana', 'admin',    true, 'layana@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Raquel', 'operacao', true, 'raquel@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('a0000000-0000-0000-0000-00000000000a', 'Padaria Aurora', 'padaria-aurora', 'America/Sao_Paulo');

set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000001';

do $$
declare v_col uuid; v_t uuid;
begin
  select id into v_col from public.tarefa_colunas order by ordem limit 1;
  v_t := public.criar_tarefa('Fazer criativo', v_col,
           '10000000-0000-0000-0000-000000000002'::uuid,
           'a0000000-0000-0000-0000-00000000000a'::uuid,
           current_date + 3, null);
  perform public.afirma(
    exists (select 1 from public.tarefa_avisos where tarefa_id = v_t and enviado_em is null),
    'criar atribuida deixa o aviso na fila');
end $$;

-- A funcao da fila e so do service_role: e ela que entrega e-mail de todo
-- mundo para quem chamar.
reset role;

do $$
declare
  v_id     uuid;
  v_email  text;
  v_titulo text;
  v_n      int;
  ok       boolean;
begin
  -- 1. Reservar devolve tudo o que o e-mail precisa, numa chamada.
  select id, para_email, tarefa_titulo into v_id, v_email, v_titulo
    from public.reservar_avisos_de_tarefa(20);
  perform public.afirma(v_id is not null, 'a fila devolve o aviso pendente');
  perform public.afirma(v_email = 'raquel@astartstudio.com.br',
    'com o e-mail de quem recebe');
  perform public.afirma(v_titulo = 'Fazer criativo',
    'e com o titulo da tarefa, sem a funcao precisar de outra consulta');

  -- 2. RESERVADO NAO SAI DE NOVO.
  select count(*) into v_n from public.reservar_avisos_de_tarefa(20);
  perform public.afirma(v_n = 0,
    'aviso ja reservado nao volta na proxima chamada — senao o e-mail sai duas vezes');

  -- 3. Reserva ABANDONADA volta sozinha.
  --
  -- Se a funcao morrer no meio (timeout, deploy, queda), o aviso nao pode
  -- ficar preso para sempre marcado como "em andamento".
  update public.tarefa_avisos set reservado_em = now() - interval '10 minutes';
  select count(*) into v_n from public.reservar_avisos_de_tarefa(20);
  perform public.afirma(v_n = 1, 'reserva abandonada volta para a fila sozinha');

  -- 4. Falhar reagenda com espera, e NAO desiste cedo demais.
  select id into v_id from public.tarefa_avisos limit 1;
  perform public.aviso_de_tarefa_falhou(v_id, 'Resend respondeu 503');
  perform public.afirma(
    (select erro from public.tarefa_avisos where id = v_id) = 'Resend respondeu 503',
    'o motivo da falha fica escrito, nao sumido');
  perform public.afirma(
    (select tentar_em > now() from public.tarefa_avisos where id = v_id),
    'e a proxima tentativa fica no futuro, em vez de marretar o servico caido');
  perform public.afirma(
    (select desistiu_em is null from public.tarefa_avisos where id = v_id),
    'duas tentativas nao desistem');
  perform public.afirma(
    (select reservado_em is null from public.tarefa_avisos where id = v_id),
    'e a reserva e devolvida, senao o aviso ficaria preso');

  -- Esperando a hora, ele nao e pego.
  select count(*) into v_n from public.reservar_avisos_de_tarefa(20);
  perform public.afirma(v_n = 0, 'aviso aguardando a proxima tentativa nao e pego antes da hora');

  -- Na sexta, desiste — em voz alta.
  update public.tarefa_avisos set tentativas = 6, tentar_em = now();
  perform public.aviso_de_tarefa_falhou(v_id, 'Resend respondeu 503');
  perform public.afirma(
    (select desistiu_em is not null from public.tarefa_avisos where id = v_id),
    'na sexta tentativa desiste — tentar para sempre e falha silenciosa cara');
  select count(*) into v_n from public.reservar_avisos_de_tarefa(20);
  perform public.afirma(v_n = 0, 'e quem desistiu nao volta para a fila');

  -- 5. Enviado sai da fila para sempre.
  update public.tarefa_avisos set desistiu_em = null, tentar_em = now(), tentativas = 0;
  perform public.aviso_de_tarefa_saiu(v_id);
  select count(*) into v_n from public.reservar_avisos_de_tarefa(20);
  perform public.afirma(v_n = 0, 'aviso enviado nao volta nunca mais');
  perform public.afirma(
    (select erro is null from public.tarefa_avisos where id = v_id),
    'e o erro antigo e limpo quando finalmente sai');

  -- 6. O cofre so entrega o que esta na lista.
  begin
    perform public.segredo_do_cofre('meta_system_user_token');
    ok := false;
  exception when others then
    ok := position('lista' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'segredo_do_cofre recusa nome fora da lista — nao serve para varrer o cofre');
end $$;

-- 7. A lista de travados e so da direcao.
set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- Raquel, operacao
do $$ begin
  perform public.afirma(public.avisos_de_tarefa_travados() is null,
    'operacao nao ve a lista de avisos travados');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$ begin
  perform public.afirma(public.avisos_de_tarefa_travados() is not null,
    'a direcao ve');
end $$;

rollback;
