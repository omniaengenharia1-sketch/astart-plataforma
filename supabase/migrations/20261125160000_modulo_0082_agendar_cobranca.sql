-- =============================================================================
-- 0082 — agendar a emissão, e o conector deixa de ser só schema
--
-- A 0081 montou o banco e deixou `conectores.construida` em falso de
-- propósito: o que existia era só o lado de cá. Agora existem as duas Edge
-- Functions — `cobrar-tick`, que emite, e `asaas-webhook`, que recebe o
-- aviso de pagamento — então a tela de Ajustes pode dizer a verdade.
--
-- UMA VEZ POR DIA, e não a cada cinco minutos. A cobrança sai dez dias antes
-- do vencimento: adiantar a rodada em algumas horas não muda nada para
-- ninguém, e cada rodada custa chamadas à Asaas.
--
-- 12:17 UTC é 9:17 em São Paulo. Não é hora redonda de propósito: todo mundo
-- agenda em :00, e a fila do provedor é mais lenta nesses minutos.
-- =============================================================================

create or replace function public.agendar_cobranca()
returns text
language plpgsql
security definer
set search_path = public, pg_temp, cron
as $$
declare v_falta text;
begin
  -- Pela plataforma, só a direção. Direto no banco, quem já está dentro — o
  -- SQL editor não tem `auth.uid()`, e exigir papel ali é trancar a porta
  -- por onde se entra. (A lição é da 0080, onde eu tranquei.)
  if auth.uid() is not null and not public.usuario_admin() then
    raise exception 'So a direcao agenda a cobranca.';
  end if;

  select string_agg(c.nome, ', ') into v_falta
    from (values ('cobrar_tick_url'), ('tick_secret'),
                 ('asaas_api_key'), ('asaas_base_url')) as c(nome)
   where not exists (select 1 from vault.decrypted_secrets v where v.name = c.nome);

  if v_falta is not null then
    return format(
      'Falta %s no Vault. Cadastre e rode select public.agendar_cobranca() de novo.',
      v_falta);
  end if;

  if exists (select 1 from cron.job where jobname = 'cobrar-tick') then
    perform cron.unschedule('cobrar-tick');
  end if;

  perform cron.schedule(
    'cobrar-tick',
    '17 12 * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'cobrar_tick_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-tick-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'tick_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );

  return 'Agendado: a cobranca sai uma vez por dia, as 9h17 de Sao Paulo.';
end;
$$;

revoke all on function public.agendar_cobranca() from public, anon;
grant execute on function public.agendar_cobranca() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- AGORA SIM: o conector está construído.
--
-- `construida` separa "falta a chave" de "falta eu escrever o código". O
-- código existe desde este commit.
-- ---------------------------------------------------------------------------
update public.conectores set construida = true where id = 'asaas';
