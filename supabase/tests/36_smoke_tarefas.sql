-- Smoke da 0065 — o quadro de tarefas.
--
-- As tres decisoes da dona, viradas em afirmacao:
--
--   1. "editaveis"  -> coluna se cria, renomeia, reordena e apaga; e apagar
--      coluna cheia e RECUSADO, porque levaria o trabalho junto.
--
--   2. "cada ve o seu e se a pessoa quiser mencionar a outra, a outra ve o
--      que foi mencionado" -> esta e a regra que mais importa. Um cartao da
--      Raquel NAO aparece para o Pedro; mencionou, aparece; tirou a mencao,
--      some de novo. Direcao ve tudo.
--
--   3. "faz primeiro o kanban e depois o email" -> o aviso NASCE na mesma
--      transacao da tarefa, com `enviado_em` nulo. Se so existisse quando o
--      envio existisse, toda tarefa criada ate la ficaria sem aviso.
--
-- E a armadilha do exemplo dela ("fazer criativo - responsavel: raquel"):
-- atribuir no momento da criacao avisa, mas PASSAR ADIANTE depois tambem
-- precisa avisar — e esse era o buraco obvio de esquecer.
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
  ('10000000-0000-0000-0000-000000000002', 'raquel@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003', 'pedro@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Layana', 'admin',    true, 'layana@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Raquel', 'operacao', true, 'raquel@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003', 'Pedro',  'operacao', true, 'pedro@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('a0000000-0000-0000-0000-00000000000a', 'Padaria Aurora', 'padaria-aurora', 'America/Sao_Paulo');

set role authenticated;

-- ---------------------------------------------------------------------------
-- 1. As quatro colunas do primeiro dia, e colunas editaveis
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000001';   -- Layana, direcao
do $$
declare
  v_nova  uuid;
  v_feito uuid;
  v_nomes text;
  ok      boolean;
begin
  select string_agg(nome, ' | ' order by ordem) into v_nomes from public.tarefa_colunas;
  perform public.afirma(v_nomes = 'A fazer | Fazendo | Em aprovação | Feito',
    'o quadro nasce com as quatro colunas, em ordem — quadro vazio nao ensina nada');

  -- Coluna nova entra ANTES da final: fim depois do fim nao e fluxo.
  v_nova := public.criar_coluna_de_tarefa('Esperando cliente');
  select string_agg(nome, ' | ' order by ordem) into v_nomes from public.tarefa_colunas;
  perform public.afirma(v_nomes = 'A fazer | Fazendo | Em aprovação | Esperando cliente | Feito',
    'coluna nova entra antes da final');

  perform public.renomear_coluna_de_tarefa(v_nova, 'Com o cliente');
  perform public.afirma(
    (select nome from public.tarefa_colunas where id = v_nova) = 'Com o cliente',
    'da para renomear coluna');

  perform public.mover_coluna_de_tarefa(v_nova, 1);
  perform public.afirma(
    (select ordem from public.tarefa_colunas where id = v_nova) = 1,
    'da para reordenar coluna');

  perform public.apagar_coluna_de_tarefa(v_nova);
  perform public.afirma(
    not exists (select 1 from public.tarefa_colunas where id = v_nova),
    'da para apagar coluna vazia');

  -- Apagar coluna CHEIA e recusado, e o erro diz quantos cartoes sair antes.
  select id into v_feito from public.tarefa_colunas where final;
  perform public.criar_tarefa('Nao me apague junto', v_feito, null, null, null, null);
  begin
    perform public.apagar_coluna_de_tarefa(v_feito);
    ok := false;
  exception when others then
    ok := position('1 tarefa' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'apagar coluna cheia e recusado, dizendo quantas tarefas tirar antes');
end $$;

-- ---------------------------------------------------------------------------
-- 2. "cada ve o seu" — a regra central
-- ---------------------------------------------------------------------------
do $$
declare
  v_primeira uuid;
  v_da_raquel uuid;
  v_avisos    int;
begin
  select id into v_primeira from public.tarefa_colunas order by ordem limit 1;

  -- O exemplo dela, ao pe da letra.
  v_da_raquel := public.criar_tarefa(
    'Fazer criativo', v_primeira,
    '10000000-0000-0000-0000-000000000002'::uuid,   -- Raquel
    'a0000000-0000-0000-0000-00000000000a'::uuid,   -- Padaria Aurora
    current_date + 3, 'Tres opcoes de arte');

  -- 3. O AVISO JA EXISTE, mesmo sem envio ligado.
  select count(*) into v_avisos from public.tarefa_avisos
   where tarefa_id = v_da_raquel
     and para_id = '10000000-0000-0000-0000-000000000002'
     and tipo = 'atribuida' and enviado_em is null;
  perform public.afirma(v_avisos = 1,
    'atribuir gera o aviso na mesma transacao, pendente de envio');

  -- Idempotente: atribuir de novo nao duplica.
  perform public.editar_tarefa(v_da_raquel, null, null,
    '10000000-0000-0000-0000-000000000002'::uuid, null, null);
  select count(*) into v_avisos from public.tarefa_avisos where tarefa_id = v_da_raquel;
  perform public.afirma(v_avisos = 1, 'atribuir a mesma pessoa de novo nao duplica o aviso');
end $$;

-- A RAQUEL ve a dela.
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$
declare q jsonb;
begin
  q := public.quadro_de_tarefas();
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(q->'tarefas') t
             where t->>'titulo' = 'Fazer criativo'),
    'a Raquel ve a tarefa que e dela');
  perform public.afirma(
    not exists (select 1 from jsonb_array_elements(q->'tarefas') t
                 where t->>'titulo' = 'Nao me apague junto'),
    'mas NAO ve a tarefa que a Layana criou para si mesma');
end $$;

-- O PEDRO nao ve nada disso.
set "teste.uid" = '10000000-0000-0000-0000-000000000003';
do $$
declare q jsonb;
begin
  q := public.quadro_de_tarefas();
  perform public.afirma(jsonb_array_length(q->'tarefas') = 0,
    'o Pedro nao ve tarefa de ninguem — cada um ve o seu');
  perform public.afirma(jsonb_array_length(q->'colunas') = 4,
    'mas ve as colunas, que sao o vocabulario comum da agencia');
end $$;

-- ---------------------------------------------------------------------------
-- A MENCAO: "se a pessoa quiser mencionar a outra, a outra ve"
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- Raquel menciona
do $$
declare v_t uuid;
begin
  select id into v_t from public.tarefas where titulo = 'Fazer criativo';
  perform public.mencionar_na_tarefa(v_t, '10000000-0000-0000-0000-000000000003');
end $$;

-- O aviso se confere pela DIRECAO, e nao pela Raquel: aviso e de quem recebe,
-- e a politica so deixa cada um ver os seus. A primeira versao deste teste
-- conferia como Raquel e falhava — nao porque o aviso nao existisse, mas
-- porque ela nao pode ve-lo. A privacidade funcionando parecia defeito.
set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$
declare v_t uuid;
begin
  select id into v_t from public.tarefas where titulo = 'Fazer criativo';
  perform public.afirma(
    exists (select 1 from public.tarefa_avisos
             where tarefa_id = v_t and para_id = '10000000-0000-0000-0000-000000000003'
               and tipo = 'mencionada' and enviado_em is null),
    'mencionar tambem deixa aviso pendente');
end $$;

-- E o Pedro ve o aviso que e dele, mas nao os dos outros.
set "teste.uid" = '10000000-0000-0000-0000-000000000003';
do $$
begin
  perform public.afirma(
    (select count(*) from public.tarefa_avisos) = 1,
    'cada um ve so os avisos dirigidos a ele');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000003';   -- e agora o Pedro ve
do $$
declare q jsonb;
begin
  q := public.quadro_de_tarefas();
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(q->'tarefas') t
             where t->>'titulo' = 'Fazer criativo'),
    'mencionado, o Pedro passa a ver a tarefa');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$
declare v_t uuid;
begin
  select id into v_t from public.tarefas where titulo = 'Fazer criativo';
  perform public.tirar_mencao_da_tarefa(v_t, '10000000-0000-0000-0000-000000000003');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000003';
do $$
begin
  perform public.afirma(
    jsonb_array_length(public.quadro_de_tarefas()->'tarefas') = 0,
    'tirada a mencao, o Pedro para de ver — a visibilidade acompanha a mencao');
end $$;

-- ---------------------------------------------------------------------------
-- PASSAR ADIANTE tambem avisa
--
-- O buraco obvio: criar atribuida avisa, trocar o responsavel depois nao.
-- Para quem recebe, "me passaram isto" e a mesma coisa nos dois casos.
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$
declare v_t uuid;
begin
  select id into v_t from public.tarefas where titulo = 'Fazer criativo';
  perform public.editar_tarefa(v_t, null, null,
    '10000000-0000-0000-0000-000000000003'::uuid, null, null);
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000001';   -- confere pela direcao
do $$
declare v_t uuid;
begin
  select id into v_t from public.tarefas where titulo = 'Fazer criativo';
  perform public.afirma(
    exists (select 1 from public.tarefa_avisos
             where tarefa_id = v_t and para_id = '10000000-0000-0000-0000-000000000003'
               and tipo = 'atribuida'),
    'passar a tarefa adiante avisa quem recebeu, igual a criar ja atribuida');
end $$;

-- ---------------------------------------------------------------------------
-- Mover entre colunas, e o `concluido_em` que acompanha
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$
declare
  v_t     uuid;
  v_feito uuid;
  v_fazer uuid;
begin
  select id into v_t from public.tarefas where titulo = 'Fazer criativo';
  select id into v_feito from public.tarefa_colunas where final;
  select id into v_fazer from public.tarefa_colunas where not final order by ordem limit 1;

  perform public.mover_tarefa(v_t, v_feito, 1);
  perform public.afirma(
    (select concluido_em is not null from public.tarefas where id = v_t),
    'cair na coluna final marca a hora de conclusao');

  -- Reabrir LIMPA a marca: tarefa reaberta nao pode continuar contando como
  -- entregue.
  perform public.mover_tarefa(v_t, v_fazer, 1);
  perform public.afirma(
    (select concluido_em is null from public.tarefas where id = v_t),
    'tirar da coluna final desfaz a conclusao');
end $$;

-- ---------------------------------------------------------------------------
-- Apagar: quem recebeu move, mas nao some com o pedido dos outros
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000003';   -- Pedro, responsavel
do $$
declare v_t uuid; ok boolean;
begin
  select id into v_t from public.tarefas where titulo = 'Fazer criativo';
  begin
    perform public.apagar_tarefa(v_t);
    ok := false;
  exception when others then
    ok := position('criou' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'quem so recebeu a tarefa nao a apaga, e o erro diz o que fazer no lugar');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000001';   -- Layana criou
do $$
declare v_t uuid;
begin
  select id into v_t from public.tarefas where titulo = 'Fazer criativo';
  perform public.apagar_tarefa(v_t);
  perform public.afirma(not exists (select 1 from public.tarefas where id = v_t),
    'quem criou apaga');
end $$;

rollback;
