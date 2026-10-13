-- =============================================================================
-- O teste que faltava, e a razao dele.
--
-- Os 22 testes anteriores cobram COMPORTAMENTO: o cliente errado nao le, o
-- operador nao ve o valor, o token revogado nao abre. Todos passavam enquanto
-- cinco funcoes estavam sem `search_path` e tres funcoes de token continuavam
-- chamaveis pelo navegador. Comportamento certo com declaracao frouxa passa em
-- teste de comportamento — quem achou foi o linter do Supabase, num banco de
-- producao, depois de tudo aplicado.
--
-- Entao este nao testa a 0042. Testa a PROPRIEDADE, em toda funcao de public,
-- inclusive nas que ainda nao foram escritas:
--   1. nenhuma funcao de public sem search_path fixo;
--   2. nenhuma funcao `_por_token` alcancavel por anon ou authenticated;
--   3. a trava do primeiro dia continua de pe: anon nao executa nada que
--      escreva, e as funcoes de so-service_role continuam so dele.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

-- ---------------------------------------------------------------------------
-- 1. search_path em todas.
--
-- `proconfig` guarda os `set` da funcao. Nulo, ou sem search_path dentro,
-- significa que o caminho e o que o chamador deixou — e e isso que a regra do
-- projeto nao admite, em DEFINER por risco e em INVOKER por consistencia.
--
-- A mensagem lista os nomes: um teste que diz "3 funcoes" sem dizer quais
-- obriga quem le a ir cacar, e e nesse momento que alguem desiste e comenta a
-- linha.
-- ---------------------------------------------------------------------------
do $$
declare
  v_soltas text;
  v_quantas int;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', '
                    order by p.proname),
         count(*)
    into v_soltas, v_quantas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     -- As do proprio teste nao contam: nascem aqui dentro, nao no banco.
     and p.proname not in ('afirma')
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as c(linha)
        where c.linha like 'search\_path=%'
     );

  perform public.afirma(
    v_quantas = 0,
    format('%s funcao(oes) de public sem search_path fixo: %s', v_quantas, v_soltas)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2. As funcoes de token sao da Edge Function, nao do navegador.
--
-- A regra e o sufixo: quem se chama `_por_token` autoriza por token, e quem
-- confere token e service_role dentro da Edge Function. Cobrar pelo sufixo, e
-- nao pela lista de nomes, faz a proxima funcao de token nascer coberta.
-- ---------------------------------------------------------------------------
do $$
declare
  v_abertas text;
begin
  select string_agg(p.proname || ' -> ' || r.papel, ', ' order by p.proname)
    into v_abertas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   cross join (values ('anon'), ('authenticated')) as r(papel)
   where n.nspname = 'public'
     and p.proname like '%\_por\_token'
     and has_function_privilege(r.papel, p.oid, 'execute');

  perform public.afirma(
    v_abertas is null,
    format('funcao de token alcancavel sem service_role: %s', v_abertas)
  );
end $$;

-- E o contrario: service_role tem de alcancar, senao a Edge Function quebra e
-- o link de galeria para de abrir para todo mundo.
do $$
declare
  v_faltando text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
    into v_faltando
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like '%\_por\_token'
     and not has_function_privilege('service_role', p.oid, 'execute');

  perform public.afirma(
    v_faltando is null,
    format('service_role NAO alcanca funcao de token: %s', v_faltando)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3. As portas que so o service_role abre continuam so dele.
--
-- Lista explicita de proposito: aqui o nome importa. Cada uma destas, se
-- vazasse para authenticated, daria a alguem logado um poder que a plataforma
-- nao oferece em tela nenhuma.
-- ---------------------------------------------------------------------------
do $$
declare
  v_nome text;
begin
  foreach v_nome in array array['primeiro_admin', 'agendar_tick', 'agendar_renovacao_tokens',
                                'envio_por_token', 'responder_por_token']
  loop
    perform public.afirma(
      not exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         cross join (values ('anon'), ('authenticated')) as r(papel)
         where n.nspname = 'public' and p.proname = v_nome
           and has_function_privilege(r.papel, p.oid, 'execute')
      ),
      format('%s deveria ser so do service_role', v_nome)
    );
  end loop;
end $$;

select 'declaracoes conferidas' as resultado;
