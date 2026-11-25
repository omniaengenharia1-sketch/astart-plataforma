-- =============================================================================
-- 0083 — a Edge Function não lê o cofre direto
--
-- `cobrar-tick` tentava ler o Vault pelo cliente do Supabase:
--
--   sb.schema('vault').from('decrypted_secrets')
--
-- e a primeira chamada de verdade devolveu `Invalid schema: vault`. O
-- PostgREST só expõe os schemas configurados, e `vault` não é um deles —
-- nem deveria ser: expor o cofre na API seria abrir a porta dos segredos
-- para qualquer um com uma chave de leitura.
--
-- O jeito do projeto já existia e eu não segui: `obter_token_conta`, da
-- 0007, lê o cofre dentro de uma função `security definer` com `vault` no
-- `search_path`, liberada só para o service role. É isto aqui.
--
-- Duas funções e não uma, de propósito: o webhook não precisa da chave da
-- API, só do token que confere quem está chamando. Mandar a chave junto
-- seria dar a ele um poder que o trabalho dele não pede.
-- =============================================================================

create or replace function public.config_asaas()
returns table (chave text, base_url text, ambiente text)
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_chave text;
  v_base  text;
begin
  select decrypted_secret into v_chave
    from vault.decrypted_secrets where name = 'asaas_api_key';
  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'asaas_base_url';

  if v_chave is null or v_base is null then
    raise exception
      'Faltam asaas_api_key e/ou asaas_base_url no cofre. Sem elas nao ha como emitir cobranca.';
  end if;

  -- O ambiente sai do PROPRIO endereco, nao de uma variavel a parte: duas
  -- fontes para a mesma verdade divergem, e a que erra e sempre a que
  -- ninguem lembra de mudar.
  return query select
    v_chave,
    rtrim(v_base, '/'),
    case when position('sandbox' in lower(v_base)) > 0 then 'sandbox' else 'producao' end;
end;
$$;

revoke all on function public.config_asaas() from public, anon, authenticated;
grant execute on function public.config_asaas() to service_role;

create or replace function public.token_do_webhook_asaas()
returns text
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'asaas_webhook_token';
$$;

revoke all on function public.token_do_webhook_asaas() from public, anon, authenticated;
grant execute on function public.token_do_webhook_asaas() to service_role;
