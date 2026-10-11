-- =============================================================================
-- Smoke dos acessos (0031). Nada expira nesta plataforma, entao revogar e
-- desativar precisam existir de verdade — e precisam ser do admin so.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'viviane@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'layana@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000001','Viviane','admin',   'viviane@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002','Layana', 'operacao','layana@astartstudio.com.br');
insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a','Padaria Aurora','aurora');
insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('20000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Bruna','bruna@clientea.com.br');

insert into public.convites (id, destino, email, nome, papel, criado_por) values
  ('c0000000-0000-0000-0000-000000000001','equipe','nova@astartstudio.com.br','Nova',
   'operacao','10000000-0000-0000-0000-000000000001');
insert into public.convites (id, destino, email, nome, cliente_id, papel_cliente, criado_por) values
  ('c0000000-0000-0000-0000-000000000002','cliente','socio@aurora.com.br','Sócio',
   'a0000000-0000-0000-0000-00000000000a','leitura','10000000-0000-0000-0000-000000000001');

set role authenticated;

-- ---------------------------------------------------------------------------
-- 1. o admin ve as pessoas e os convites abertos
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$
declare r jsonb := public.equipe_e_convites();
begin
  perform public.afirma(jsonb_array_length(r->'pessoas') = 2, 'as duas pessoas da equipe');
  perform public.afirma(jsonb_array_length(r->'convites') = 2, 'os dois convites abertos');
  perform public.afirma((r->>'souAdmin')::boolean, 'e ela e admin');
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(r->'convites') c
             where c->>'clienteNome' = 'Padaria Aurora'),
    'o convite de cliente vem com o nome do cliente');
end $$;

-- ---------------------------------------------------------------------------
-- 2. quem nao e admin le a equipe, mas nao os convites — e quem esconde e o RLS
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$
declare r jsonb := public.equipe_e_convites();
begin
  perform public.afirma(jsonb_array_length(r->'pessoas') = 2, 'operacao ve a equipe');
  perform public.afirma(jsonb_array_length(r->'convites') = 0,
    'e nao ve convite nenhum: a politica da 0013 e so do admin');
  perform public.afirma((r->>'souAdmin')::boolean = false, 'e sabe que nao e admin');

  begin
    perform public.revogar_convite('c0000000-0000-0000-0000-000000000001');
    -- A funcao e SECURITY INVOKER: para operacao o update nao acha a linha.
    perform public.afirma(
      (select revogado_em is null from public.convites
        where id = 'c0000000-0000-0000-0000-000000000001'),
      'operacao nao revoga convite');
  exception when others then
    if position('nao encontrado' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. revogar e idempotente, e convite aceito nao se revoga
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$ begin
  perform public.revogar_convite('c0000000-0000-0000-0000-000000000001');
  perform public.afirma(
    (select revogado_em is not null from public.convites
      where id = 'c0000000-0000-0000-0000-000000000001'),
    'o convite foi revogado');
  -- Repetir a acao nao e erro.
  perform public.revogar_convite('c0000000-0000-0000-0000-000000000001');

  perform public.afirma(
    jsonb_array_length(public.equipe_e_convites()->'convites') = 1,
    'e ele sai da lista de abertos');

  update public.convites
     set aceito_em = now(), aceito_por = '20000000-0000-0000-0000-00000000000a'
   where id = 'c0000000-0000-0000-0000-000000000002';
  begin
    perform public.revogar_convite('c0000000-0000-0000-0000-000000000002');
    raise exception 'FALHOU: revogou convite ja aceito';
  exception when others then
    if position('ja foi aceito' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. desativar pessoa
-- ---------------------------------------------------------------------------
do $$ begin
  begin
    perform public.desativar_pessoa('10000000-0000-0000-0000-000000000001');
    raise exception 'FALHOU: a pessoa tirou o proprio acesso';
  exception when others then
    if position('proprio acesso' in sqlerrm) = 0 then raise; end if;
  end;

  perform public.desativar_pessoa('10000000-0000-0000-0000-000000000002');
  perform public.afirma(
    (select not ativo and desativado_em is not null from public.perfis
      where user_id = '10000000-0000-0000-0000-000000000002'),
    'a pessoa foi desativada, com data');
  perform public.afirma(
    (select nome = 'Layana' from public.perfis
      where user_id = '10000000-0000-0000-0000-000000000002'),
    'e o nome fica: o historico nao pode virar "null aprovou"');

  perform public.reativar_pessoa('10000000-0000-0000-0000-000000000002');
  perform public.afirma(
    (select ativo from public.perfis where user_id = '10000000-0000-0000-0000-000000000002'),
    'e volta quando reativa');
end $$;

-- Pessoa desativada perde o acesso na hora.
do $$ begin
  perform public.desativar_pessoa('10000000-0000-0000-0000-000000000002');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$ begin
  perform public.afirma(public.equipe_e_convites() is null,
    'quem foi desativado nao le mais nada');
  perform public.afirma(public.lista_clientes() is null,
    'nem a lista de clientes');
end $$;

-- ---------------------------------------------------------------------------
-- 5. tirar o acesso de um contato do cliente
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$ begin
  perform public.tirar_acesso_do_cliente(
    '20000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a');
  perform public.afirma(
    (select not ativo from public.clientes_usuarios
      where user_id = '20000000-0000-0000-0000-00000000000a'),
    'o contato perdeu o acesso');
end $$;

set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$ begin
  perform public.afirma(public.minha_sessao()->>'tipo' = 'anonimo',
    'e a sessao dele deixa de ser de cliente');
  perform public.afirma(public.ficha_cliente('a0000000-0000-0000-0000-00000000000a') is null,
    'a ficha fecha junto');
end $$;

reset role;

do $$ begin
  perform public.afirma(not has_function_privilege('anon','public.equipe_e_convites()','execute'),
    'anon nao le a equipe');
  perform public.afirma(not has_function_privilege('anon','public.desativar_pessoa(uuid)','execute'),
    'anon nao desativa ninguem');
end $$;

select 'acessos: tudo passou' as resultado;
