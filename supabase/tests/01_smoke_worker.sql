\set ON_ERROR_STOP on
\pset pager off

-- ============ cenario ============
-- O token global que este teste usa. Fica AQUI, e nao no stub: o Vault comeca
-- vazio de proposito, porque banco novo comeca vazio. Quando o stub criava as
-- chaves do agendador, toda rodada passava enquanto uma instalacao nova
-- falhava no primeiro paste — o ambiente de teste estava mais configurado que
-- a realidade. Teste que precisa de chave cria a dele.
select vault.create_secret('TOKEN_FAKE_DO_SYSTEM_USER', 'meta_system_user_token');

insert into clientes (id, nome, slug) values
  ('11111111-1111-1111-1111-111111111111', 'Cliente A', 'cliente-a'),
  ('22222222-2222-2222-2222-222222222222', 'Cliente B', 'cliente-b'),
  ('33333333-3333-3333-3333-333333333333', 'Sem Conta', 'sem-conta');

insert into contas_sociais (id, cliente_id, plataforma, nome_exibicao, ig_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'instagram', 'IG A', '1780000001');
insert into contas_sociais (id, cliente_id, plataforma, nome_exibicao, ig_user_id, page_id) values
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'instagram', 'IG B', '1780000002', null),
  ('aaaaaaaa-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'facebook',  'FB B', null, '5550000002');

insert into posts (id, cliente_id, titulo_interno, tipo, legenda, status, agendado_para) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A - vencido', 'imagem', 'oi', 'agendado', now() - interval '1 minute'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'B - duas contas', 'imagem', 'oi', 'agendado', now() - interval '1 minute'),
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'A - futuro', 'imagem', 'oi', 'agendado', now() + interval '1 hour'),
  ('bbbbbbbb-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333', 'Sem destino', 'imagem', 'oi', 'agendado', now() - interval '1 minute');

\echo '--- 1. promover_posts_agendados (esperado: 2 promovidos; o sem-destino falha)'
select promover_posts_agendados() as promovidos;
select titulo_interno, status, coalesce(erro_mensagem,'-') as erro from posts order by titulo_interno;

\echo '--- 2. alvos criados (esperado: 1 para A, 2 para B, 0 para futuro/sem-destino)'
select p.titulo_interno, c.nome_exibicao, a.estado from post_alvos a
  join posts p on p.id = a.post_id join contas_sociais c on c.id = a.conta_social_id
  order by 1,2;

\echo '--- 3. idempotencia: rodar de novo nao duplica nem promove'
select promover_posts_agendados() as promovidos_2;
select count(*) as total_alvos from post_alvos;

\echo '--- 4. reivindicar_alvos com lease (esperado: 3)'
select count(*) as reivindicados from reivindicar_alvos(20, '99999999-9999-9999-9999-999999999999'::uuid, 120);

\echo '--- 5. segunda reivindicacao concorrente (esperado: 0, tudo com lease vivo)'
select count(*) as reivindicados_concorrente from reivindicar_alvos(20, gen_random_uuid(), 120);

\echo '--- 6. lease vencido: container_criando volta a pendente, publicando NAO volta'
update post_alvos set estado='container_criando', container_id='ct_1', bloqueado_ate = now() - interval '1 second'
  where conta_social_id='aaaaaaaa-0000-0000-0000-000000000001';
update post_alvos set estado='publicando', container_id='ct_2', bloqueado_ate = now() - interval '1 second'
  where conta_social_id='aaaaaaaa-0000-0000-0000-000000000002';
select liberar_leases_vencidos() as liberados;
select c.nome_exibicao, a.estado, a.tentativas, a.erro_codigo from post_alvos a
  join contas_sociais c on c.id=a.conta_social_id
  where a.conta_social_id in ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002')
  order by 1;

\echo '--- 7. recalcular_status_post: 1 publicado + 1 falhou = publicado_parcial'
update post_alvos set estado='publicado', media_id_publicado='m1', publicado_em=now(), bloqueado_ate=null
  where post_id='bbbbbbbb-0000-0000-0000-000000000002' and conta_social_id='aaaaaaaa-0000-0000-0000-000000000002';
update post_alvos set estado='falhou', erro_mensagem='Token invalido.', bloqueado_ate=null
  where post_id='bbbbbbbb-0000-0000-0000-000000000002' and conta_social_id='aaaaaaaa-0000-0000-0000-000000000003';
select recalcular_status_post('bbbbbbbb-0000-0000-0000-000000000002') as status_b;
select status, erro_mensagem from posts where id='bbbbbbbb-0000-0000-0000-000000000002';

\echo '--- 8. todos publicados = publicado'
update post_alvos set estado='publicado', media_id_publicado='m2', publicado_em=now(), erro_mensagem=null, bloqueado_ate=null
  where post_id='bbbbbbbb-0000-0000-0000-000000000002';
select recalcular_status_post('bbbbbbbb-0000-0000-0000-000000000002') as status_b2;

\echo '--- 9. reivindicar so pega post em publicando (post A foi para publicando? sim)'
select count(*) as elegiveis from reivindicar_alvos(20, gen_random_uuid(), 120);

\echo '--- 10. obter_token_conta (esperado: token do Vault, fallback global)'
select conta_social_id, plataforma, ig_user_id, access_token from obter_token_conta('aaaaaaaa-0000-0000-0000-000000000001');

\echo '--- 11. token por conta (token_ref proprio)'
select vault.create_secret('TOKEN_SO_DESSE_CLIENTE','token_cliente_b');
update contas_sociais set token_ref='token_cliente_b' where id='aaaaaaaa-0000-0000-0000-000000000002';
select access_token from obter_token_conta('aaaaaaaa-0000-0000-0000-000000000002');

\echo '--- 12. token ausente vira excecao legivel'
update contas_sociais set token_ref='chave_que_nao_existe' where id='aaaaaaaa-0000-0000-0000-000000000003';
do $$ begin
  perform obter_token_conta('aaaaaaaa-0000-0000-0000-000000000003');
  raise exception 'FALHOU: deveria ter dado erro';
exception when others then raise notice 'ok, erro esperado: %', sqlerrm;
end $$;

\echo '--- 13. redacao de segredos no log'
insert into publicacao_eventos (post_alvo_id, evento, payload)
select id, 'teste.redacao', jsonb_build_object(
  'url','https://graph.facebook.com/v23.0/123/media?fields=id&access_token=EAAG_SUPER_SECRETO',
  'corpo', jsonb_build_object('access_token','EAAG_SUPER_SECRETO','image_url','https://x/y.jpg'),
  'lista', jsonb_build_array(jsonb_build_object('Authorization','Bearer abc'))
) from post_alvos limit 1;
select jsonb_pretty(payload) from publicacao_eventos where evento='teste.redacao';

\echo '--- 14. log e append-only'
do $$ begin
  update publicacao_eventos set evento='hack' where evento='teste.redacao';
  raise exception 'FALHOU: update deveria ser bloqueado';
exception when others then raise notice 'ok, bloqueado: %', sqlerrm;
end $$;

\echo '--- 15. unique(post_id, conta_social_id) segura duplicata'
do $$ begin
  insert into post_alvos (post_id, conta_social_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001');
  raise exception 'FALHOU: duplicata deveria ser bloqueada';
exception when unique_violation then raise notice 'ok, duplicata bloqueada';
end $$;

\echo '--- 16. RLS habilitada em todas as tabelas do modulo'
select tablename, rowsecurity from pg_tables
 where schemaname='public'
   and tablename in ('clientes','contas_sociais','perfis','posts','post_midias','post_alvos','publicacao_eventos','aprovacao_comentarios','links_aprovacao')
 order by 1;

\echo '--- 17. anon nao tem privilegio nenhum nas tabelas do modulo'
select count(*) as grants_para_anon from information_schema.role_table_grants
 where grantee='anon' and table_schema='public';

\echo '--- 18. cron agendado'
select jobname, schedule from cron.job order by 1;
