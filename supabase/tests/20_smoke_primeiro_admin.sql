-- =============================================================================
-- Smoke da 0040. O que este teste cobra:
--   1. num banco vazio a funcao promove a conta e ela vira admin de verdade;
--   2. no segundo uso ela recusa — a porta se fecha sozinha;
--   3. e-mail que nao tem conta: recusa dizendo o que fazer;
--   4. quem esta logado nao chama esta funcao, so service_role.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'Viviane@AstartStudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'layana@astartstudio.com.br');

-- ---------------------------------------------------------------------------
-- 1 e 3. a casa vazia
-- ---------------------------------------------------------------------------
do $$
declare
  v_user uuid;
  ok boolean;
begin
  perform public.afirma(not exists (select 1 from public.perfis), 'a casa comeca vazia');
  perform public.afirma(not public.usuario_admin(), 'e sem ninguem administrando');

  begin
    perform public.primeiro_admin('naoexiste@astartstudio.com.br');
    raise exception 'FALHOU: promoveu um e-mail sem conta';
  exception when others then
    if position('Nao achei a conta' in sqlerrm) = 0 then raise; end if;
    ok := true;
  end;
  perform public.afirma(ok, 'e-mail sem conta recusa dizendo onde criar');

  begin
    perform public.primeiro_admin('   ');
    raise exception 'FALHOU: aceitou e-mail vazio';
  exception when others then
    if position('Diga o e-mail' in sqlerrm) = 0 then raise; end if;
  end;

  -- Maiuscula no e-mail nao pode impedir a dona de entrar na propria conta.
  v_user := public.primeiro_admin('viviane@astartstudio.com.br');
  perform public.afirma(v_user = '10000000-0000-0000-0000-000000000001',
    'a conta certa foi promovida, ignorando a caixa do e-mail');
  perform public.afirma(
    (select papel::text from public.perfis where user_id = v_user) = 'admin',
    'e ela e admin');
  perform public.afirma(
    (select nome from public.perfis where user_id = v_user) = 'Viviane',
    'com um nome que da para ler na tela');
end $$;

-- E ela administra de verdade.
set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$ begin
  perform public.afirma(public.usuario_admin(), 'ela administra');
  perform public.afirma(public.usuario_financeiro(), 'e ve o dinheiro');
end $$;
set "teste.uid" = '';

-- ---------------------------------------------------------------------------
-- 2. a porta se fecha
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  begin
    perform public.primeiro_admin('layana@astartstudio.com.br');
    raise exception 'FALHOU: a porta do primeiro dia continuou aberta';
  exception when others then
    if position('Ja existe alguem administrando' in sqlerrm) = 0 then raise; end if;
    ok := true;
  end;
  perform public.afirma(ok, 'com um admin ativo, a funcao recusa');
  perform public.afirma(
    not exists (select 1 from public.perfis
                 where user_id = '10000000-0000-0000-0000-000000000002'),
    'e nao promoveu ninguem de tabela');
end $$;

-- ---------------------------------------------------------------------------
-- 4. e nao e chamavel de dentro da plataforma
-- ---------------------------------------------------------------------------
do $$ begin
  perform public.afirma(
    not has_function_privilege('authenticated','public.primeiro_admin(text)','execute'),
    'quem esta logado nao se promove por aqui');
  perform public.afirma(
    not has_function_privilege('anon','public.primeiro_admin(text)','execute'),
    'nem anon');
  perform public.afirma(
    has_function_privilege('service_role','public.primeiro_admin(text)','execute'),
    'so service_role, que e quem roda do painel');
end $$;

select 'primeiro admin: tudo passou' as resultado;
