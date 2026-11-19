-- =============================================================================
-- 0080 — a trava que trancava a porta por onde se entra
--
-- `agendar_ponte_google`, da 0079, abria com `if not public.usuario_admin()
-- then raise`. Parecia cuidado e era defeito: o UNICO caminho documentado
-- para chamar essa funcao e o SQL editor do Supabase, onde nao ha usuario
-- logado — `auth.uid()` e nulo, `usuario_admin()` e falso, e a funcao recusa
-- a propria dona. Tentei rodar e levei "So a direcao agenda a ponte.".
--
-- As outras do mesmo tipo (`agendar_avisos_de_tarefa`, da 0067) nao tem trava
-- nenhuma: sao `grant execute` para `authenticated` e `service_role`, e
-- dependem de alguem decidir chama-las. Eu inventei uma regra mais apertada
-- so nesta, sem reparar em como ela e usada.
--
-- A regra certa: ou e a direcao pela plataforma, ou e uma sessao direta no
-- banco — que so quem tem a senha do projeto consegue abrir, e para quem uma
-- checagem de papel nao significa nada de todo jeito.
--
-- O resto do corpo vem IGUAL da 0079: `create or replace` troca a funcao
-- inteira, entao recriar so a linha mudada nao e uma opcao.
-- =============================================================================

create or replace function public.agendar_ponte_google()
returns text
language plpgsql
security definer
set search_path = public, pg_temp, cron
as $$
declare v_falta text;
begin
  -- Pela plataforma, so a direcao. Direto no banco, quem ja esta dentro: o
  -- SQL editor nao tem `auth.uid()`, e exigir papel ali e trancar a porta
  -- por onde se entra.
  if auth.uid() is not null and not public.usuario_admin() then
    raise exception 'So a direcao agenda a ponte.';
  end if;

  select string_agg(c.nome, ', ') into v_falta
    from (values ('agenda_google_url'), ('tick_secret')) as c(nome)
   where not exists (select 1 from vault.decrypted_secrets v where v.name = c.nome);

  if v_falta is not null then
    return format(
      'Falta %s no Vault. Cadastre e rode select public.agendar_ponte_google() de novo.',
      v_falta);
  end if;

  if exists (select 1 from cron.job where jobname = 'agenda-google') then
    perform cron.unschedule('agenda-google');
  end if;

  perform cron.schedule(
    'agenda-google',
    '*/5 * * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'agenda_google_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-tick-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'tick_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );

  return 'Agendado: a agenda conversa com o Google a cada cinco minutos.';
end;
$$;

revoke all on function public.agendar_ponte_google() from public, anon;
grant execute on function public.agendar_ponte_google() to authenticated, service_role;
