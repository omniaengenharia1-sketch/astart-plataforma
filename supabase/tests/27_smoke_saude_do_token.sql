-- =============================================================================
-- Smoke da 0048. O que este teste cobra:
--   1. as duas chaves novas entraram, e como OPCIONAIS — chave opcional não
--      pode fazer a tela de Integrações acusar falta vermelha;
--   2. sem nenhuma das duas, `credenciais_do_app_meta()` devolve ZERO LINHA, e
--      não exceção: a conferência tem um caminho degradado que depende disso;
--   3. com só uma das duas, LEVANTA — meia configuração é erro, e silenciar
--      aqui montaria `app_id|undefined` e mandaria para a Meta;
--   4. com as duas, devolve o par;
--   5. nem anon nem authenticated executam — é leitura de segredo;
--   6. anon não tem privilégio nas tabelas de conector (o conserto da 0043).
--
-- O que este arquivo NÃO cobra, e é bom dizer: se a resposta da Meta é lida
-- certo. Isso é TypeScript, mora na Edge Function, e nenhum teste de SQL
-- alcança. É a mesma fronteira do CORS, que me custou caro nesta semana.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

-- ---------------------------------------------------------------------------
-- 1. as chaves novas, e opcionais
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.afirma(
    (select count(*) from public.conector_chaves
      where conector_id = 'meta' and chave in ('meta_app_id', 'meta_app_secret')) = 2,
    'as duas chaves do app entraram no registro'
  );
  perform public.afirma(
    not exists (
      select 1 from public.conector_chaves
       where conector_id = 'meta' and chave in ('meta_app_id', 'meta_app_secret')
         and obrigatoria
    ),
    'e entraram como OPCIONAIS: sem elas a conferencia ainda funciona, degradada'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2. nenhuma das duas: zero linha, nao excecao
--
-- Parece detalhe e nao e. A Edge Function faz `credenciais[0]` e, quando nao
-- ha, confere o token com o proprio token. Trocar isto por uma excecao
-- derrubaria a conferencia em toda instalacao que nao cadastrou o app — que e
-- justamente a instalacao que mais precisa de diagnostico.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.afirma(
    (select count(*) from public.credenciais_do_app_meta()) = 0,
    'sem as chaves, devolve zero linha'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3. meia configuracao levanta
-- ---------------------------------------------------------------------------
select vault.create_secret('1234567890', 'meta_app_id');

do $$
declare ok boolean;
begin
  begin
    perform * from public.credenciais_do_app_meta();
    ok := false;
  exception when others then
    -- A mensagem tem de DIZER QUAL FALTA. "Configuracao invalida" faria a
    -- pessoa conferir as duas.
    ok := position('pela metade' in sqlerrm) > 0
      and position('meta_app_secret' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'com so o id, levanta dizendo que falta o secret');
end $$;

-- ---------------------------------------------------------------------------
-- 4. com as duas, devolve o par
-- ---------------------------------------------------------------------------
select vault.create_secret('SEGREDO-DO-APP-DA-META-999', 'meta_app_secret');

do $$
declare
  v_id  text;
  v_seg text;
begin
  select c.app_id, c.app_secret into v_id, v_seg from public.credenciais_do_app_meta() c;
  perform public.afirma(v_id = '1234567890', 'devolve o app_id');
  perform public.afirma(v_seg = 'SEGREDO-DO-APP-DA-META-999', 'e o app_secret');
end $$;

-- ---------------------------------------------------------------------------
-- 5. quem pode executar
--
-- Esta funcao LE SEGREDO EM CLARO. É a única razão de ela ser SECURITY
-- DEFINER, e é a razão de o teste 23 (declarações) e este cobrarem o grant em
-- dois lugares: um grant a mais aqui vale um token da agência.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.afirma(
    not has_function_privilege('anon', 'public.credenciais_do_app_meta()', 'EXECUTE'),
    'anon nao executa'
  );
  perform public.afirma(
    not has_function_privilege('authenticated', 'public.credenciais_do_app_meta()', 'EXECUTE'),
    'authenticated tambem nao — nem a direcao logada le segredo em claro'
  );
  perform public.afirma(
    has_function_privilege('service_role', 'public.credenciais_do_app_meta()', 'EXECUTE'),
    'service_role executa, que e a Edge Function'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 6. o conserto da 0043
--
-- As duas tabelas nasceram com o grant que o `alter default privileges` do
-- Supabase da ao anon. Com RLS ligada e politica so `to authenticated`, anon
-- chegava a zero linha — mas privilegio sem politica e porta trancada por fora.
-- O teste 08 ja cobrava isto em geral e estava vermelho; aqui fica nominal,
-- para o dia em que alguem criar a terceira tabela de conector.
-- ---------------------------------------------------------------------------
do $$
declare achou text;
begin
  select string_agg(format('%s.%s', t, v), ', ') into achou
    from unnest(array['conectores', 'conector_chaves']) as t
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) as v
   where has_table_privilege('anon', format('public.%I', t), v);
  perform public.afirma(achou is null, format('anon ainda tem privilegio em: %s', achou));
end $$;

select 'saude do token conferida' as resultado;
