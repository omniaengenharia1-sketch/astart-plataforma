-- 0050 — o formato do token, sem mostrar o token.
--
-- Correção de rota, com dado novo. A 0048 e a 0049 foram escritas sobre uma
-- leitura que o próprio banco desmentiu doze minutos depois:
--
--   `meta_system_user_token` foi gravada às 05:09 e a Meta recusava. Conclusão
--   razoável: token curto do Graph API Explorer, que vive uma ou duas horas.
--
--   Depois a dona trocou a chave. Gravada 16:08:56. Recusada igual, com o
--   mesmo código 190, doze minutos de vida. Token nenhum expira em doze
--   minutos. A explicação estava errada.
--
-- Quando um token recém-gravado é recusado com 190, a causa quase nunca é
-- validade — é o TEXTO. Espaço ou quebra de linha colados junto, aspas que
-- vieram do editor, valor truncado no meio, token de outro app. Nada disso a
-- Meta sabe dizer, e `debug_token` nem aceita a pergunta sem um token vivo.
--
-- Mas o formato dá para conferir AQUI, e sem revelar nada: tamanho, pontas
-- sujas, alfabeto, prefixo. Seis sinalizadores que separam "o texto está
-- quebrado" de "o token está morto" — duas coisas com dois consertos
-- completamente diferentes, que até agora davam a mesma mensagem.
--
-- E um defeito meu, que produz exatamente este sintoma:
--
--   `token_do_sistema()` (0044) conferia `length(btrim(v_token)) = 0` e
--   devolvia `v_token` SEM APARAR. Uma quebra de linha no fim do valor colado
--   ia inteira para a Graph API, que recusa com 190. O `btrim` estava ali, na
--   linha de cima, usado só para decidir se a chave estava vazia — e não para
--   o valor que sai. Isso é pior que não ter: parece cuidado e não é.
--
-- Aparar é conserto silencioso, e a regra aqui é não converter em silêncio.
-- Então faz as duas coisas: apara (para funcionar) e CONTA (para a pessoa
-- saber), no sinalizador `pontasSujas`.

-- ---------------------------------------------------------------------------
-- 1. O token sai aparado — e o relatório conta que estava sujo
-- ---------------------------------------------------------------------------
create or replace function public.token_do_sistema()
returns text
language plpgsql
stable
security definer
set search_path = public, vault, pg_temp
as $$
declare v_token text;
begin
  select s.decrypted_secret into v_token
    from vault.decrypted_secrets s
   where s.name = 'meta_system_user_token'
   limit 1;

  if v_token is null or length(btrim(v_token)) = 0 then
    raise exception
      'Token da Meta ausente no Vault (chave "meta_system_user_token"). '
      'Cadastre em Ajustes > Integrações antes de conectar contas.';
  end if;

  -- O `btrim` que faltava. Espaço e quebra de linha nas pontas de um valor
  -- colado são invisíveis na tela e viram recusa 190 na Meta.
  return btrim(v_token, E' \t\r\n');
end;
$$;

revoke all on function public.token_do_sistema() from public, anon, authenticated;
grant execute on function public.token_do_sistema() to service_role;

-- ---------------------------------------------------------------------------
-- 2. O formato, em sinalizadores
--
-- Nada aqui devolve o valor nem pedaço dele. São respostas de sim ou não, mais
-- o tamanho — e o tamanho é o que denuncia um valor truncado, que é a causa
-- mais chata de achar à mão.
--
-- `comecaComEAA`: token de usuário e de usuário do sistema da Meta começa com
-- "EAA". Não é documentado como garantia, então o sinalizador DESCREVE em vez
-- de julgar: ele serve para flagrar valor que claramente não é um token (um
-- app id colado no lugar, por exemplo), não para aprovar.
-- ---------------------------------------------------------------------------
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
    -- Pontas sujas: o caso que a 0044 deixava passar inteiro para a Meta.
    'pontasSujas',          v_limpo <> v_bruto,
    'temQuebraDeLinha',     v_bruto ~ E'[\r\n]',
    -- Aspas quase sempre vêm de copiar o comando SQL junto com o valor.
    'temAspas',             v_limpo ~ '["'']',
    -- Alfabeto de token da Meta. Qualquer coisa fora disso é texto estranho,
    -- não token.
    'soCaracteresEsperados', v_limpo ~ '^[A-Za-z0-9_-]+$',
    'comecaComEAA',         v_limpo like 'EAA%'
  );
end;
$$;

revoke all on function public.formato_do_token_meta() from public, anon, authenticated;
grant execute on function public.formato_do_token_meta() to service_role;

comment on function public.formato_do_token_meta() is
  'Sinalizadores de formato do token da Meta. Nunca devolve o valor nem parte dele.';
