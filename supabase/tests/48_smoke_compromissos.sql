-- =============================================================================
-- Smoke da 0078 — compromissos na agenda.
--
-- A dona: "pq nao consigo colocar coisas na agenda, vc precisa fazer a agenda
-- estilo calendário. CALENDÁRIO BRASILEIRO".
--
-- A Agenda mostrava quatro tipos e todos nasciam em OUTRO modulo. Nao havia
-- tabela de compromisso avulso: reuniao, gravacao, visita. A tela se chamava
-- agenda e nao aceitava nada.
--
-- O que este arquivo cobra:
--
--   1. marcar um compromisso, e ele aparecer na agenda do dia certo;
--   2. o FUSO sai do compromisso, nao de quem olha. Uma gravacao as 9h em
--      Sao Paulo cai no dia 20 mesmo quando o banco responde em UTC — se
--      fosse pelo UTC, um compromisso das 22h cairia no dia seguinte;
--   3. dia inteiro nao tem hora, e com hora a agenda devolve "HH:MM";
--   4. o que e recusado: sem titulo, sem data, fim antes do comeco — e
--      editar so o comeco para DEPOIS do fim tambem;
--   5. `editavel` separa o que a Agenda criou do que ela so mostra: peca,
--      captacao, marco e cobranca pertencem ao modulo deles;
--   6. editar com a convencao de sempre, e `p_limpar` apagando de verdade;
--   7. apagar;
--   8. o CLIENTE nao ve a agenda interna — e la que aparece o nome dos
--      outros clientes dele;
--   9. e o indice que impede a ponte com o Google de duplicar o mesmo
--      evento, que e o pior bug possivel daquela sincronizacao.
--
-- O 2 e o 9 sao os que justificam o arquivo.
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
  ('10000000-0000-0000-0000-000000000009', 'cliente@exemplo.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Layana', 'admin',    true, 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Raquel', 'operacao', true, 'raquel@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('20000000-0000-0000-0000-000000000001', 'Mor Marcas', 'mor', 'America/Sao_Paulo');
insert into public.clientes_usuarios (cliente_id, user_id, email, ativo) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000009',
   'cliente@exemplo.com.br', true);

do $$
declare
  v_a    uuid;
  v_b    uuid;
  v_dia  date := date_trunc('month', current_date)::date + 19;  -- dia 20 do mes
  v_ag   jsonb;
  v_ev   jsonb;
  v_c    jsonb;
  ok     boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  -- 1 e 2. MARCAR, E O FUSO SER O DO COMPROMISSO.
  --
  -- 22h em Sao Paulo e 01h do dia SEGUINTE em UTC. Se a agenda agrupasse
  -- pelo timestamp cru, esta gravacao apareceria no dia errado do
  -- calendario — e e exatamente o tipo de erro que so aparece em dia de
  -- gravacao, com a equipe no lugar errado.
  v_a := public.criar_compromisso(
    'Gravacao Mor Marcas',
    ((v_dia || ' 22:00')::timestamp at time zone 'America/Sao_Paulo'),
    ((v_dia || ' 23:30')::timestamp at time zone 'America/Sao_Paulo'),
    false,
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    'Estudio da Vila');
  perform public.afirma(v_a is not null, 'da para marcar um compromisso');

  v_ag := public.agenda(v_dia - 1, v_dia + 1);
  select x into v_ev from jsonb_array_elements(v_ag) x
   where x->>'tipo' = 'compromisso' and x->>'oQue' = 'Gravacao Mor Marcas';
  perform public.afirma(v_ev is not null, 'e ele aparece na agenda');
  perform public.afirma((v_ev->>'quando')::date = v_dia,
    'no dia em que foi marcado — o fuso e o do compromisso, nao o do banco');
  perform public.afirma(v_ev->>'hora' = '22:00', 'com a hora local, pronta para a tela');
  perform public.afirma(v_ev->>'clienteNome' = 'Mor Marcas', 'e com o cliente junto');
  perform public.afirma(v_ev->>'detalhe' = 'Estudio da Vila',
    'e o local, que e o que ajuda a sair de casa na hora certa');

  -- 3. DIA INTEIRO NAO TEM HORA.
  v_b := public.criar_compromisso(
    'Feriado', ((v_dia || ' 00:00')::timestamp at time zone 'America/Sao_Paulo'),
    null, true);
  v_ag := public.agenda(v_dia, v_dia);
  select x into v_ev from jsonb_array_elements(v_ag) x where x->>'oQue' = 'Feriado';
  perform public.afirma(v_ev->>'hora' is null,
    'compromisso de dia inteiro nao mostra hora nenhuma');

  -- 5. EDITAVEL SEPARA O QUE A AGENDA CRIA DO QUE ELA SO MOSTRA.
  perform public.afirma((v_ev->>'editavel')::boolean,
    'compromisso e editavel: e o unico tipo que a propria Agenda cria');

  -- 4. O QUE E RECUSADO.
  begin
    perform public.criar_compromisso('   ', now());
    ok := false;
  exception when others then ok := position('título' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'compromisso sem titulo e recusado');

  begin
    perform public.criar_compromisso('Sem data', null);
    ok := false;
  exception when others then ok := position('data' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'sem data tambem');

  begin
    perform public.criar_compromisso('Ao contrario', now(), now() - interval '1 hour');
    ok := false;
  exception when others then ok := position('depois do começo' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'e fim antes do comeco');

  -- Editar SO o comeco, para depois do fim que ja estava gravado, tambem e
  -- recusado: a conferencia olha os valores que VAO FICAR, nao so os que
  -- vieram na chamada.
  begin
    perform public.editar_compromisso(
      v_a, p_quando => ((v_dia || ' 23:45')::timestamp at time zone 'America/Sao_Paulo'));
    ok := false;
  exception when others then ok := position('depois do começo' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'empurrar so o comeco para depois do fim e recusado — a regra olha o que vai ficar');

  -- 6. EDITAR, com a convencao de sempre.
  perform public.editar_compromisso(v_a, p_titulo => 'Gravacao remarcada');
  perform public.afirma(
    (select titulo from public.compromissos where id = v_a) = 'Gravacao remarcada',
    'editar troca o titulo');
  perform public.afirma(
    (select local from public.compromissos where id = v_a) = 'Estudio da Vila',
    'e nao encosta no local, que foi mandado nulo');

  perform public.editar_compromisso(v_a, p_limpar => array['local', 'cliente', 'fim']);
  perform public.afirma(
    (select local is null and cliente_id is null and termina_em is null
       from public.compromissos where id = v_a),
    'e p_limpar apaga local, cliente e hora de fim de verdade');

  -- A FICHA PARA O FORMULARIO ABRIR PREENCHIDO.
  v_c := public.compromisso(v_a);
  perform public.afirma(v_c->>'titulo' = 'Gravacao remarcada', 'a ficha traz o titulo');
  perform public.afirma(v_c->>'dia' = to_char(v_dia, 'YYYY-MM-DD'),
    'o dia, ja no fuso do compromisso');
  perform public.afirma(v_c->>'hora' = '22:00', 'e a hora, separada, como o formulario pede');
  perform public.afirma(v_c->>'horaFim' is null, 'sem hora de fim, porque ela foi apagada');
  perform public.afirma(not (v_c->>'noGoogle')::boolean,
    'e diz que ainda nao esta no Google — a ponte e a fase 2');

  -- 9. A PONTE COM O GOOGLE NAO PODE DUPLICAR.
  --
  -- Sincronizacao que roda duas vezes e o caso normal, nao a excecao: a rede
  -- cai no meio, o cron repete. Sem este indice, a agenda da dona encheria
  -- de copias do mesmo evento.
  update public.compromissos
     set google_event_id = 'evt_abc', google_calendar_id = 'layana@astartstudio.com.br'
   where id = v_a;
  begin
    update public.compromissos
       set google_event_id = 'evt_abc', google_calendar_id = 'layana@astartstudio.com.br'
     where id = v_b;
    ok := false;
  exception when unique_violation then ok := true;
  end;
  perform public.afirma(ok,
    'o mesmo evento do Google nao entra duas vezes — e o pior bug da sincronizacao');

  -- O mesmo id em OUTRA agenda pode: id de evento so e unico dentro da agenda.
  update public.compromissos
     set google_event_id = 'evt_abc', google_calendar_id = 'raquel@astartstudio.com.br'
   where id = v_b;
  perform public.afirma(
    (select count(*) from public.compromissos where google_event_id = 'evt_abc') = 2,
    'mas o mesmo id em outra agenda cabe: id de evento e unico DENTRO da agenda');

  -- E o vinculo e completo ou nao e: id sem agenda nao identifica nada.
  begin
    update public.compromissos set google_calendar_id = null where id = v_b;
    ok := false;
  exception when check_violation then ok := true;
  end;
  perform public.afirma(ok, 'id do Google sem a agenda dele e recusado');

  -- 7. APAGAR.
  perform public.apagar_compromisso(v_b);
  perform public.afirma(
    not exists (select 1 from public.compromissos where id = v_b),
    'apagar tira o compromisso');
  begin
    perform public.apagar_compromisso(v_b);
    ok := false;
  exception when others then ok := position('não encontrado' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'e apagar duas vezes avisa, em vez de fingir que deu certo');
end $$;

-- ---------------------------------------------------------------------------
-- 8. O CLIENTE NAO VE A AGENDA INTERNA.
--
-- E nela que aparece o nome dos OUTROS clientes, a gravacao de um, a cobranca
-- de outro. Agenda interna vazando para o portal do cliente e o tipo de
-- vazamento que ninguem percebe olhando a tela certa.
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000009';
do $$
declare v_n int;
begin
  -- A PRIMEIRA BARREIRA e `usuario_ativo()`, no topo da `agenda()`: quem nao
  -- tem perfil de equipe nao recebe nada, seja cliente ou nao. Entao este
  -- bloco sozinho NAO prova a barreira do cliente — tirei o
  -- `not usuario_cliente()` da funcao de proposito e ele continuou verde.
  -- O bloco de baixo e que prova a segunda barreira.
  select count(*) into v_n
    from jsonb_array_elements(coalesce(public.agenda(current_date - 60, current_date + 60), '[]'::jsonb)) x
   where x->>'tipo' = 'compromisso';
  perform public.afirma(v_n = 0, 'o cliente nao ve compromisso nenhum da agencia');
  perform public.afirma(
    public.compromisso((select id from public.compromissos limit 1)) is null,
    'nem abrindo um pelo id');
end $$;

-- POR QUE NAO HA UM TESTE DA "SEGUNDA BARREIRA" AQUI.
--
-- O `not usuario_cliente()` na `agenda()` e na politica de RLS e uma trava
-- sobre uma porta que ja esta fechada: tentei montar o caso de alguem que e
-- cliente E equipe ao mesmo tempo, e o banco recusa na hora de inserir o
-- perfil — "Este usuario ja tem acesso de cliente e nao pode entrar na
-- equipe.". Os dois estados sao exclusivos por construcao.
--
-- Entao deixo escrito em vez de inventar cobertura: quem segura o cliente
-- fora da agenda interna e o `usuario_ativo()`, e a trava extra e defesa em
-- profundidade para o dia em que essa regra mudar. O que da para provar, e
-- o que este bloco prova, e a exclusividade em si.
do $$
declare ok boolean;
begin
  begin
    insert into public.perfis (user_id, nome, papel, ativo, email) values
      ('10000000-0000-0000-0000-000000000009', 'Os dois ao mesmo tempo',
       'operacao', true, 'cliente@exemplo.com.br');
    ok := false;
  exception when others then ok := position('acesso de cliente' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'quem e cliente nao vira equipe — e por isso que o cliente nunca chega na agenda interna');
end $$;

-- A operacao VE a agenda (e com ela que a equipe se organiza) e tambem marca:
-- `usuario_edita` cobre admin e operacao.
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$
declare v_id uuid;
begin
  v_id := public.criar_compromisso('Reuniao de pauta', now() + interval '2 days');
  perform public.afirma(v_id is not null, 'a operacao tambem marca na agenda');
  perform public.afirma(
    (select count(*) from jsonb_array_elements(
       public.agenda(current_date, current_date + 5)) x
      where x->>'oQue' = 'Reuniao de pauta') = 1,
    'e enxerga o que marcou');
end $$;
