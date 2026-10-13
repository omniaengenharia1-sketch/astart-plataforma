-- 0051 — o erro era o `<` e o `>`, e a culpa é da instrução que eu escrevi.
--
-- A 0050 acabou de provar o que estava errado com o token da Astart, e não foi
-- nada do que eu havia suposto. Os sinalizadores do valor guardado:
--
--   199 caracteres · pontas limpas · sem aspas · não começa com EAA ·
--   dois caracteres fora do alfabeto de token: um `<` e um `>`.
--
-- Isso é um token colado DENTRO do marcador de lugar. Eu mandei, em texto e na
-- própria tela de Ajustes:
--
--   select vault.update_secret((select id from ...), '<valor novo>');
--
-- e a leitura natural de `'<valor novo>'` é "troque `valor novo` pelo token",
-- não "apague os sinais também". O valor foi para o Vault como `<TOKEN>`, a
-- Meta recebeu `<TOKEN>` e recusou com 190 — a mesma mensagem de token
-- expirado, que me levou a perseguir validade por duas migrations.
--
-- O marcador com `<` e `>` é uma convenção de documentação técnica, e eu a usei
-- com alguém que não escreve SQL. A notação custou duas horas e três teorias
-- erradas. Troco por `COLE_O_TOKEN_AQUI`, que não tem sinal para esquecer — e
-- se ficar esquecido, o `comecaComEAA` e o tamanho pegam na hora.
--
-- O que entra aqui é o sinalizador específico, porque "tem caracteres
-- estranhos" manda a pessoa procurar, e "tire o `<` e o `>`" ela resolve em
-- cinco segundos. Mensagem de erro que descreve o sintoma é metade do
-- trabalho; a outra metade é dizer o que fazer.

create or replace function public.formato_do_token_meta()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_bruto text;
  v_limpo text;
begin
  select s.decrypted_secret into v_bruto
    from vault.decrypted_secrets s
   where s.name = 'meta_system_user_token'
   limit 1;

  if v_bruto is null then
    return jsonb_build_object('cadastrada', false);
  end if;

  v_limpo := btrim(v_bruto, E' \t\r\n');

  return jsonb_build_object(
    'cadastrada',           true,
    'tamanho',              length(v_limpo),
    'pontasSujas',          v_limpo <> v_bruto,
    'temQuebraDeLinha',     v_bruto ~ E'[\r\n]',
    'temAspas',             v_limpo ~ '["'']',
    -- O caso real, e o mais provável de todos porque a instrução o convidava.
    'temSinaisDeMarcador',  v_limpo ~ '[<>]',
    'soCaracteresEsperados', v_limpo ~ '^[A-Za-z0-9_-]+$',
    'comecaComEAA',         v_limpo like 'EAA%'
  );
end;
$$;

revoke all on function public.formato_do_token_meta() from public, anon, authenticated;
grant execute on function public.formato_do_token_meta() to service_role;
