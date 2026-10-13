-- 0048 — saúde do token da Meta: chave cadastrada não é chave que funciona.
--
-- Veio de um erro real, hoje. A dona clicou em "Conectar conta" e leu:
--
--   "A Meta recusou a consulta: O token de acesso da Meta expirou ou foi
--    revogado. Regere o token do System User no Business Manager da Astart."
--
-- O token tinha sido cadastrado no Vault às 05:09 do MESMO DIA. Dez horas de
-- vida. Token de System User não morre em dez horas — ele não expira. O que
-- morre em uma ou duas horas é o token curto que o Graph API Explorer entrega
-- por padrão, e foi quase certamente esse que entrou ali.
--
-- Mas o ponto desta migration não é aquele token. É o que a plataforma
-- deixava de saber:
--
--   `estado_dos_conectores()` (0043) responde "a chave está cadastrada?".
--   Ninguém respondia "a chave FUNCIONA?".
--
-- É a mesma armadilha nº 13 que eu mesmo escrevi na documentação deste projeto
-- — "`if not exists` é idempotência, não verificação" — um nível acima:
-- presença no Vault é cadastro, não validade. E o custo da diferença aparece no
-- pior momento possível: na hora de conectar a conta de um cliente, ou de
-- madrugada, no post que não sai.
--
-- O que entra aqui:
--   1. app_id e app_secret da Meta como chaves do conector. Servem para
--      perguntar à Meta a saúde de um token que JÁ MORREU — com o token morto
--      não dá para perguntar nada, porque a própria pergunta precisa de um
--      token válido. O app token (`app_id|app_secret`) não expira.
--   2. `credenciais_do_app_meta()`, irmã de `token_do_sistema()`: só
--      service_role, e com mensagem que diz o que fazer quando falta.
--
-- Quem usa é a Edge Function `conectar-conta`, na ação `conferir`, que chama
-- `GET /debug_token` e devolve TIPO, VALIDADE e ESCOPOS do token — em vez de
-- "cadastrada ●".

-- ---------------------------------------------------------------------------
-- 0. Conserto de um erro meu, na 0043: anon ficou com privilégio nas duas
--    tabelas de conector.
--
-- O teste 08 (auditoria de RLS) cobra exatamente isso — "anon não tem
-- privilégio nenhum em public" — e estava VERMELHO desde a 0043. Eu não vi, e
-- a razão de não ter visto é a de sempre nesta semana: rodei o teste que eu
-- esperava que falhasse, não a suíte inteira.
--
-- O que estava em risco de verdade: nada, hoje. As duas tabelas têm RLS ligada
-- e só uma política de leitura `to authenticated`, então anon chegava a zero
-- linha de qualquer jeito. Mas privilégio sem política é uma porta trancada por
-- fora: basta alguém escrever `create policy ... to public` um dia e ela abre
-- sem que ninguém tenha mexido na permissão. E contraria a regra escrita deste
-- projeto — "nada de tabela aberta por enquanto".
--
-- A causa é o `alter default privileges` do Supabase, que dá grant ao anon em
-- toda tabela nova de `public`. Tabela nova precisa de revoke explícito, e a
-- 0043 não tinha.
-- ---------------------------------------------------------------------------
revoke all on table public.conectores       from anon;
revoke all on table public.conector_chaves  from anon;

-- ---------------------------------------------------------------------------
-- 1. As duas chaves novas
--
-- `obrigatoria = false` de propósito: sem elas a conferência ainda funciona,
-- só não alcança token já morto (a conferência cai para auto-inspeção, que
-- exige o token vivo). Marcar como obrigatória faria a tela de Integrações
-- acusar falta vermelha de uma coisa que é melhoria, não requisito.
--
-- O app_secret é tão sensível quanto o token: vai para o Vault, nunca para o
-- front, e é lido só pela função com service role. Mesma regra, sem exceção.
-- ---------------------------------------------------------------------------
insert into public.conector_chaves (conector_id, chave, onde, obrigatoria, para_que) values
  ('meta', 'meta_app_id',     'vault', false,
   'id do app da Meta — serve para conferir a saúde de um token já expirado'),
  ('meta', 'meta_app_secret', 'vault', false,
   'segredo do app da Meta — com o id, forma o app token, que não expira')
on conflict (conector_id, chave) do update
   set onde        = excluded.onde,
       obrigatoria = excluded.obrigatoria,
       para_que    = excluded.para_que;

-- ---------------------------------------------------------------------------
-- 2. As credenciais do app, para a Edge Function
--
-- Devolve as duas juntas porque uma sem a outra não forma o app token, e
-- "cadastrei o id e esqueci o segredo" tem de falhar dizendo isso — não
-- devolver metade e deixar a função montar `123|undefined`.
--
-- Nulo em vez de exceção quando as DUAS faltam: a conferência tem um caminho
-- degradado que funciona sem elas, e exceção aqui mataria esse caminho. Falta
-- de melhoria opcional não é erro. Já meia configuração É erro, e levanta.
-- ---------------------------------------------------------------------------
create or replace function public.credenciais_do_app_meta()
returns table (app_id text, app_secret text)
language plpgsql
stable
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_id     text;
  v_segredo text;
begin
  select btrim(s.decrypted_secret) into v_id
    from vault.decrypted_secrets s where s.name = 'meta_app_id' limit 1;
  select btrim(s.decrypted_secret) into v_segredo
    from vault.decrypted_secrets s where s.name = 'meta_app_secret' limit 1;

  v_id      := nullif(v_id, '');
  v_segredo := nullif(v_segredo, '');

  if v_id is null and v_segredo is null then
    return;  -- nenhuma linha: a função chamadora usa o caminho degradado
  end if;

  if v_id is null or v_segredo is null then
    raise exception
      'Configuração da Meta pela metade: % está no Vault e % não. '
      'Cadastre as duas, senão não dá para formar o app token.',
      case when v_id is null then 'meta_app_secret' else 'meta_app_id' end,
      case when v_id is null then 'meta_app_id'     else 'meta_app_secret' end;
  end if;

  return query select v_id, v_segredo;
end;
$$;

revoke all on function public.credenciais_do_app_meta() from public, anon, authenticated;
grant execute on function public.credenciais_do_app_meta() to service_role;

comment on function public.credenciais_do_app_meta() is
  'app_id e app_secret da Meta, só para service_role. Zero linhas = não cadastradas.';
