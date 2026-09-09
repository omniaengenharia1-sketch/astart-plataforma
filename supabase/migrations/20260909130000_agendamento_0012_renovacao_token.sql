-- =============================================================================
-- 0012: rotina de renovacao de token OAuth
--
-- So existe por causa da excecao de OAuth. Conta com System User nao passa por
-- aqui: o token nao expira e nao ha o que renovar.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Grava o token novo no Vault e move o vencimento, numa operacao so.
-- A Edge Function nunca fala com vault.secrets direto.
-- ---------------------------------------------------------------------------
create or replace function public.atualizar_token_conta(
  p_conta_social_id uuid,
  p_token           text,
  p_expira_em       timestamptz
)
returns text
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_conta public.contas_sociais%rowtype;
  v_ref   text;
  v_id    uuid;
begin
  select * into v_conta from public.contas_sociais c where c.id = p_conta_social_id;
  if not found then
    raise exception 'Conta social % nao encontrada.', p_conta_social_id;
  end if;

  if v_conta.origem_token <> 'oauth' then
    raise exception
      'A conta "%" usa o System User do Business Manager da Astart, que nao expira. '
      'Nao ha token para renovar.', v_conta.nome_exibicao;
  end if;

  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'Token vazio para a conta "%".', v_conta.nome_exibicao;
  end if;
  if p_expira_em is null or p_expira_em <= now() then
    raise exception
      'Vencimento invalido para a conta "%": a Meta devolveu uma data que ja passou.',
      v_conta.nome_exibicao;
  end if;

  -- Uma chave por conta, estavel entre renovacoes.
  v_ref := coalesce(
    nullif(btrim(v_conta.token_ref), ''),
    'token_conta_' || replace(p_conta_social_id::text, '-', '')
  );

  select s.id into v_id from vault.secrets s where s.name = v_ref;

  if v_id is null then
    perform vault.create_secret(p_token, v_ref, 'Token OAuth da conta ' || v_conta.nome_exibicao);
  else
    perform vault.update_secret(v_id, p_token);
  end if;

  update public.contas_sociais
     set token_ref = v_ref,
         token_expira_em = p_expira_em
   where id = p_conta_social_id;

  return v_ref;
end;
$$;

revoke all on function public.atualizar_token_conta(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.atualizar_token_conta(uuid, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Cron diario. Exige a chave "renovar_tokens_url" no Vault:
--   select vault.create_secret(
--     'https://<ref>.supabase.co/functions/v1/renovar-tokens', 'renovar_tokens_url');
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'renovar_tokens_url') then
    raise exception
      'Cadastre a chave "renovar_tokens_url" no Vault antes de agendar a renovacao. Veja o README.';
  end if;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'renovar-tokens') then
    perform cron.unschedule('renovar-tokens');
  end if;
end $$;

-- 06:20 UTC, longe do pico e longe do tick de publicacao.
select cron.schedule(
  'renovar-tokens',
  '20 6 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'renovar_tokens_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-tick-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'tick_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
