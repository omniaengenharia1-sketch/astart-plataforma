-- =============================================================================
-- Auditoria: varre o catalogo em vez de listar tabela por tabela.
-- Tabela nova que esquecer o RLS cai aqui sozinha, sem ninguem lembrar de
-- atualizar o teste.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

-- ---------------------------------------------------------------------------
-- 1. Toda tabela de public tem RLS ligado
-- ---------------------------------------------------------------------------
do $$
declare faltam text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into faltam
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  perform public.afirma(faltam is null, format('tabelas sem RLS: %s', faltam));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Toda tabela com RLS tem ao menos uma politica.
--    RLS ligado sem politica nenhuma nao e seguranca: e tabela morta, e
--    alguem vai "consertar" desligando o RLS.
-- ---------------------------------------------------------------------------
do $$
declare faltam text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into faltam
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
  perform public.afirma(faltam is null, format('tabelas com RLS e sem politica: %s', faltam));
end $$;

-- ---------------------------------------------------------------------------
-- 3. anon nao tem privilegio nenhum em public
-- ---------------------------------------------------------------------------
do $$
declare achou text;
begin
  select string_agg(format('%s.%s', c.relname, v), ', ') into achou
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) as v
   where n.nspname = 'public' and c.relkind in ('r', 'v')
     and has_table_privilege('anon', c.oid, v);
  perform public.afirma(achou is null, format('anon tem privilegio em: %s', achou));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Nenhuma funcao SECURITY DEFINER de public e chamavel por anon.
--    SECURITY DEFINER roda como dono e passa por cima do RLS: deixar uma
--    aberta para anon e abrir o banco inteiro por uma fresta.
-- ---------------------------------------------------------------------------
do $$
declare achou text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into achou
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute');
  perform public.afirma(achou is null,
    format('funcoes SECURITY DEFINER abertas para anon: %s', achou));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Toda funcao SECURITY DEFINER fixa o search_path.
--    Sem isso da para plantar uma funcao homonima num schema anterior no
--    caminho e sequestrar a execucao.
-- ---------------------------------------------------------------------------
do $$
declare achou text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into achou
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) cfg
                          where cfg like 'search_path=%'));
  perform public.afirma(achou is null,
    format('SECURITY DEFINER sem search_path fixo: %s', achou));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Toda view de public roda com security_invoker.
--    View sem isso le como dono e fura o RLS das tabelas de base.
-- ---------------------------------------------------------------------------
do $$
declare achou text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into achou
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and lower(coalesce(
           (select option_value from pg_options_to_table(c.reloptions)
             where option_name = 'security_invoker'), 'false')) not in ('true', 'on', '1');
  perform public.afirma(achou is null,
    format('views sem security_invoker: %s', achou));
end $$;

-- ---------------------------------------------------------------------------
-- 7. Nenhuma coluna com cara de segredo em claro
-- ---------------------------------------------------------------------------
do $$
declare achou text;
begin
  select string_agg(format('%s.%s', table_name, column_name), ', ') into achou
    from information_schema.columns
   where table_schema = 'public'
     and (column_name ~ '(^|_)(senha|password|secret|api_key)($|_)'
          or column_name = 'token')
     and column_name not in ('token_hash', 'token_ref', 'senha_dica');
  perform public.afirma(achou is null,
    format('colunas com cara de segredo em claro: %s', achou));
end $$;

select 'auditoria: tudo passou' as resultado;
