-- =============================================================================
-- Smoke da instalacao nova: o banco nasce com o Vault VAZIO.
--
-- Este teste existe por causa de um bug que chegou na mao da dona. As migrations
-- 0009 e 0012 recusavam aplicar sem as chaves do agendador no Vault, e o primeiro
-- paste no SQL Editor morria com "Cadastre a chave publicar_tick_url". Nenhum
-- teste pegava, porque o stub criava justamente aquelas chaves: o ambiente de
-- teste estava mais configurado que uma instalacao nova.
--
-- O que se cobra aqui:
--   1. com o Vault vazio, o schema inteiro existe — clientes, aprovacoes,
--      financeiro, galeria. O agendador e UM modulo de oito e nao pode impedir
--      o banco de nascer;
--   2. o cron NAO foi agendado — melhor nao agendado que batendo de minuto em
--      minuto numa Edge Function que ainda nao existe;
--   3. `agendar_tick()` diz o que falta, em portugues, em vez de estourar;
--   4. com as chaves no Vault, uma linha liga o agendador;
--   5. e ligar duas vezes nao cria dois jobs.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

-- 1. o banco nasceu inteiro
do $$ begin
  perform public.afirma(
    (select count(*) from vault.decrypted_secrets) = 0,
    'o Vault comeca vazio, como num projeto novo');

  perform public.afirma(
    (select count(*) from pg_tables where schemaname = 'public') >= 50,
    'o schema inteiro existe mesmo sem nenhuma chave no Vault');
  perform public.afirma(
    (select count(*) from pg_tables where schemaname='public' and not rowsecurity) = 0,
    'e toda tabela nasceu com RLS');

  -- As telas que nao tem nada a ver com a Meta tem de estar de pe.
  perform public.afirma(
    to_regprocedure('public.lista_clientes()') is not null
    and to_regprocedure('public.painel_financeiro(date)') is not null
    and to_regprocedure('public.envio_por_token(text)') is not null
    and to_regprocedure('public.primeiro_admin(text)') is not null,
    'clientes, financeiro, link de aprovacao e primeiro admin existem');
end $$;

-- 2 e 3. o cron ficou de fora, e a funcao explica
do $$
declare v_resposta text;
begin
  perform public.afirma(
    not exists (select 1 from cron.job where jobname = 'publicar-tick'),
    'sem as chaves, o tick NAO foi agendado');
  perform public.afirma(
    not exists (select 1 from cron.job where jobname = 'renovar-tokens'),
    'nem a renovacao de token');

  v_resposta := public.agendar_tick();
  perform public.afirma(v_resposta like 'Falta%',
    'agendar_tick() diz o que falta em vez de estourar');
  perform public.afirma(position('publicar_tick_url' in v_resposta) > 0
                    and position('tick_secret' in v_resposta) > 0,
    'e diz QUAIS chaves faltam, as duas');

  v_resposta := public.agendar_renovacao_tokens();
  perform public.afirma(v_resposta like 'Falta%', 'o mesmo para a renovacao');
end $$;

-- 4. com as chaves, uma linha liga
do $$
declare v_resposta text;
begin
  perform vault.create_secret('https://exemplo.supabase.co/functions/v1/publicar-tick', 'publicar_tick_url');
  perform vault.create_secret('segredo-de-teste', 'tick_secret');

  v_resposta := public.agendar_tick();
  perform public.afirma(v_resposta not like 'Falta%', 'com as chaves, agendar_tick() liga');
  perform public.afirma(
    exists (select 1 from cron.job where jobname = 'publicar-tick'),
    'e o job aparece no cron');
  perform public.afirma(
    (select schedule from cron.job where jobname = 'publicar-tick') = '* * * * *',
    'a cada minuto, como o tick precisa');

  -- 5. idempotente: ligar de novo nao duplica
  perform public.agendar_tick();
  perform public.afirma(
    (select count(*) from cron.job where jobname = 'publicar-tick') = 1,
    'ligar duas vezes nao cria dois jobs — publicar duas vezes e o pior bug possivel');

  perform vault.create_secret('https://exemplo.supabase.co/functions/v1/renovar-tokens', 'renovar_tokens_url');
  v_resposta := public.agendar_renovacao_tokens();
  perform public.afirma(v_resposta not like 'Falta%', 'e a renovacao liga do mesmo jeito');
  perform public.afirma(
    (select count(*) from cron.job where jobname = 'renovar-tokens') = 1,
    'com um job so');
end $$;

-- E nao e o navegador que liga nada disso.
do $$ begin
  perform public.afirma(
    not has_function_privilege('anon','public.agendar_tick()','execute')
    and not has_function_privilege('authenticated','public.agendar_tick()','execute'),
    'agendar_tick e de service_role: ninguem liga o agendador pelo navegador');
end $$;

select 'instalacao nova: tudo passou' as resultado;
