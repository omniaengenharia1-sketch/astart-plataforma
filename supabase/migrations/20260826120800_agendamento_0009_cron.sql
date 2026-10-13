-- =============================================================================
-- Agendamento Meta — 0009: pg_cron dispara publicar-tick a cada minuto
--
-- O tick e stateless: acorda, avanca cada item UM passo e devolve o controle.
-- Nunca ha sleep/polling dentro de uma invocacao.
--
-- DUAS CHAVES NO VAULT, e elas NAO sao pre-requisito para aplicar:
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/publicar-tick',
--                              'publicar_tick_url');
--   select vault.create_secret('<TICK_SECRET>', 'tick_secret');
--
-- Esta migration JA recusou aplicar sem elas, e isso estava errado: banco novo
-- nao nasce com Vault preenchido, e o agendador da Meta e UM modulo de oito.
-- Travar o schema inteiro — clientes, aprovacoes, financeiro, galeria — porque
-- uma integracao ainda nao foi configurada e a ordem ao contrario. Pior: o cron
-- ficaria batendo de minuto em minuto numa Edge Function que ainda nem foi
-- publicada.
--
-- Agora o agendamento mora numa funcao. Sem as chaves, a migration avisa e seu
-- segue; quando elas existirem, uma linha liga o agendador:
--
--   select public.agendar_tick();
-- =============================================================================

create or replace function public.agendar_tick()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_falta text;
begin
  select string_agg(c.nome, ' e ') into v_falta
    from (values ('publicar_tick_url'), ('tick_secret')) as c(nome)
   where not exists (
     select 1 from vault.decrypted_secrets v where v.name = c.nome
   );

  if v_falta is not null then
    return format('Falta %s no Vault. Cadastre e rode select public.agendar_tick() de novo.', v_falta);
  end if;

  if exists (select 1 from cron.job where jobname = 'publicar-tick') then
    perform cron.unschedule('publicar-tick');
  end if;

  perform cron.schedule(
    'publicar-tick',
    '* * * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'publicar_tick_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-tick-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'tick_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );

  return 'Agendador ligado: publicar-tick roda a cada minuto.';
end;
$$;

revoke all on function public.agendar_tick() from public, anon, authenticated;
grant execute on function public.agendar_tick() to service_role;

-- Tenta ligar agora. Se o Vault ainda nao tem as chaves, avisa e a migration
-- segue — o resto do banco nao depende disso.
do $$
declare v_resposta text;
begin
  v_resposta := public.agendar_tick();
  if v_resposta like 'Falta%' then
    raise warning 'Agendador da Meta nao foi ligado. %', v_resposta;
  end if;
end $$;

-- pg_net acumula respostas; sem isso a tabela cresce para sempre.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'limpar-respostas-net') then
    perform cron.unschedule('limpar-respostas-net');
  end if;
end $$;

select cron.schedule(
  'limpar-respostas-net',
  '17 4 * * *',
  $cron$ delete from net._http_response where created < now() - interval '3 days' $cron$
);
