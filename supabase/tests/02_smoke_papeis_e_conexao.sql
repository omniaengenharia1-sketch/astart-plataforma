-- Smoke das migrations 0010 e 0011: papeis do time e conexao com a Meta.
-- Rodar depois de 00_stubs_supabase.sql e de todas as migrations.
\set ON_ERROR_STOP on
\pset pager off

insert into auth.users (id) values ('11111111-0000-0000-0000-000000000001');
insert into clientes (id, nome, slug) values ('aaaa1111-0000-0000-0000-000000000001','Cliente A','cliente-a');
insert into perfis (user_id, nome) values ('11111111-0000-0000-0000-000000000001','Rafael');

insert into contas_sociais (id, cliente_id, plataforma, nome_exibicao, ig_user_id, origem_token, acesso_parceiro, token_expira_em, token_ref) values
  ('bbbb1111-0000-0000-0000-000000000001','aaaa1111-0000-0000-0000-000000000001','instagram','@system','1780000001','system_user','concedido',null,null),
  ('bbbb1111-0000-0000-0000-000000000002','aaaa1111-0000-0000-0000-000000000001','instagram','@pendente','1780000002','system_user','pendente',null,null),
  ('bbbb1111-0000-0000-0000-000000000003','aaaa1111-0000-0000-0000-000000000001','instagram','@oauth5d','1780000004','oauth','concedido', now() + interval '5 days','token_oauth_a'),
  ('bbbb1111-0000-0000-0000-000000000004','aaaa1111-0000-0000-0000-000000000001','instagram','@oauth60d','1780000005','oauth','concedido', now() + interval '60 days','token_oauth_b'),
  ('bbbb1111-0000-0000-0000-000000000005','aaaa1111-0000-0000-0000-000000000001','instagram','@vencido','1780000006','oauth','concedido', now() - interval '1 day','token_oauth_c');
select vault.create_secret('TOK_A','token_oauth_a');

\echo '--- 1. papel padrao virou operacao'
select papel from perfis;

\echo '--- 2. papel "social" bloqueado pela constraint'
do $$ begin
  update perfis set papel = 'social';
  raise exception 'FALHOU: deveria ter bloqueado';
exception when check_violation then raise notice 'ok, bloqueado';
end $$;

\echo '--- 3. system_user com vencimento e recusado'
do $$ begin
  insert into contas_sociais (cliente_id, plataforma, nome_exibicao, ig_user_id, origem_token, token_expira_em)
  values ('aaaa1111-0000-0000-0000-000000000001','instagram','@x','1780000099','system_user', now());
  raise exception 'FALHOU: deveria ter bloqueado';
exception when check_violation then raise notice 'ok, bloqueado';
end $$;

\echo '--- 4. oauth sem vencimento e recusado'
do $$ begin
  insert into contas_sociais (cliente_id, plataforma, nome_exibicao, ig_user_id, origem_token)
  values ('aaaa1111-0000-0000-0000-000000000001','instagram','@y','1780000098','oauth');
  raise exception 'FALHOU: deveria ter bloqueado';
exception when check_violation then raise notice 'ok, bloqueado';
end $$;

\echo '--- 5. vencendo e vencido saem separados'
select nome_exibicao, situacao from contas_com_token_vencendo(7) order by 1;

\echo '--- 6. acesso pendente vira mensagem legivel, nao erro cru da Meta'
do $$ begin
  perform obter_token_conta('bbbb1111-0000-0000-0000-000000000002');
  raise exception 'FALHOU: deveria ter recusado';
exception when others then raise notice '%', sqlerrm;
end $$;

\echo '--- 7. token de oauth vencido idem'
do $$ begin
  perform obter_token_conta('bbbb1111-0000-0000-0000-000000000005');
  raise exception 'FALHOU: deveria ter recusado';
exception when others then raise notice '%', sqlerrm;
end $$;

\echo '--- 8. oauth valido devolve o token proprio do cliente'
select access_token from obter_token_conta('bbbb1111-0000-0000-0000-000000000003');

\echo '--- 9. anon nao executa nenhum helper de RLS'
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute')  as service_role
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('usuario_ativo','usuario_edita','usuario_admin','usuario_financeiro',
                     'contas_com_token_vencendo','obter_token_conta')
 order by 1;

-- ---------------------------------------------------------------------------
-- Migration 0012: renovacao de token OAuth
-- ---------------------------------------------------------------------------
insert into clientes (id, nome, slug) values ('cccc1111-0000-0000-0000-000000000001','Cliente B','cliente-b');
insert into contas_sociais (id, cliente_id, plataforma, nome_exibicao, ig_user_id, origem_token, token_expira_em) values
  ('dddd1111-0000-0000-0000-000000000001','cccc1111-0000-0000-0000-000000000001','instagram','@oauth','1780000101','oauth', now() + interval '3 days'),
  ('dddd1111-0000-0000-0000-000000000002','cccc1111-0000-0000-0000-000000000001','instagram','@sysuser','1780000102','system_user', null);

\echo '--- 10. renovacao grava o token e move o vencimento'
select atualizar_token_conta('dddd1111-0000-0000-0000-000000000001','TOKEN_NOVO', now() + interval '60 days') as chave;
select access_token from obter_token_conta('dddd1111-0000-0000-0000-000000000001');

\echo '--- 11. renovar de novo reusa a mesma chave, nao cria outra'
select atualizar_token_conta('dddd1111-0000-0000-0000-000000000001','TOKEN_MAIS_NOVO', now() + interval '60 days');
select count(*) as chaves_no_vault from vault.secrets where name like 'token_conta_%';
select access_token from obter_token_conta('dddd1111-0000-0000-0000-000000000001');

\echo '--- 12. System User recusa renovacao'
do $$ begin
  perform atualizar_token_conta('dddd1111-0000-0000-0000-000000000002','X', now() + interval '60 days');
  raise exception 'FALHOU: deveria ter recusado';
exception when others then raise notice '%', sqlerrm;
end $$;

\echo '--- 13. vencimento no passado e recusado'
do $$ begin
  perform atualizar_token_conta('dddd1111-0000-0000-0000-000000000001','X', now() - interval '1 day');
  raise exception 'FALHOU: deveria ter recusado';
exception when others then raise notice '%', sqlerrm;
end $$;
