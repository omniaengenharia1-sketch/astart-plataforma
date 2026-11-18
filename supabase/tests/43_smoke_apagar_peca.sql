-- =============================================================================
-- Smoke da 0073 — apagar peça.
--
-- A dona: "essas peças pendentes eu nao consegui apaga". Nao conseguia porque
-- nao existia. Este arquivo cobra o que a funcao nova tem de garantir:
--
--   1. rascunho sai, e leva midias e alvos junto;
--   2. a funcao DEVOLVE os caminhos do Storage — sem isso os arquivos ficam
--      em `midias-posts` para sempre, porque o varredor de orfaos (0062) so
--      cobre o bucket `galerias`;
--   3. peca com destino JA PUBLICADO e recusada, dizendo que apagar aqui nao
--      tira o post do ar;
--   4. peca PUBLICANDO e recusada: nesse estado nem se sabe se saiu;
--   5. peca que ja tentou publicar e tem LOG **nao** se apaga, e `cancelar`
--      e a saida — este e o motivo do arquivo. `publicacao_eventos` e
--      append-only desde a 0004, com gatilho que recusa UPDATE e DELETE para
--      todo mundo. A primeira versao da funcao apagava o log junto; o gatilho
--      a derrubou, e o desenho mudou por causa dele. Um teste que so apagasse
--      rascunho virgem passaria verde e esconderia isso ate o primeiro uso de
--      verdade;
--   6. a ideia que gerou a peca NAO some junto;
--   7. quem nao edita nao apaga, e quem nao ve o cliente nao apaga.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000009', 'leitura@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Layana', 'admin',   true, 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000009', 'Visita', 'leitura', true, 'leitura@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('20000000-0000-0000-0000-000000000001', 'Mor Marcas', 'mor', 'America/Sao_Paulo');

insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select c.id, s.id, 'recorrente', 150000, 10, current_date
  from public.clientes c, public.servicos s
 where s.chave = 'gestao_digital' and c.slug = 'mor';

insert into public.contas_sociais
  (id, cliente_id, plataforma, nome_exibicao, ig_user_id, page_id, ativo, acesso_parceiro)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'instagram', 'mor.marcas', '1784140000001', '778899', true, 'concedido');

do $$
declare
  v_post  uuid;
  v_alvo  uuid;
  v_r     jsonb;
  v_ideia uuid;
  ok      boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  -- ---------------------------------------------------------------------
  -- 1, 2, 5 e 6. O caminho bom, com tudo o que torna ele dificil
  -- ---------------------------------------------------------------------
  v_post := (public.criar_publicacao(
    '20000000-0000-0000-0000-000000000001', 'Rascunho de teste', 'imagem',
    'oi', null, false, array['30000000-0000-0000-0000-000000000001'::uuid])->>'id')::uuid;

  insert into public.post_midias (post_id, ordem, storage_path, mime)
  values (v_post, 0, '20000000-0000-0000-0000-000000000001/' || v_post || '/foto.jpg', 'image/jpeg');

  perform public.agendar_publicacao(v_post, now() + interval '2 days');
  select a.id into v_alvo from public.post_alvos a where a.post_id = v_post limit 1;
  perform public.afirma(v_alvo is not null, 'agendar criou o destino');

  -- A ideia que gerou a peca, para o item 6.
  -- `usada_em` junto: a tabela tem `ideias_uso_coerente`, que exige
  -- `(post_id is null) = (usada_em is null)`. E e essa restricao que faz o
  -- item 6 valer a pena — ela transforma "soltar a ideia" num passo que a
  -- funcao tem de dar na mao.
  insert into public.ideias (cliente_id, titulo, post_id, usada_em)
  values ('20000000-0000-0000-0000-000000000001', 'Ideia da peca', v_post, now())
  returning id into v_ideia;

  v_r := public.apagar_publicacao(v_post);

  perform public.afirma(
    not exists (select 1 from public.posts where id = v_post),
    'a peca sai');
  perform public.afirma(
    not exists (select 1 from public.post_alvos where post_id = v_post),
    'e os destinos saem junto');
  perform public.afirma(
    not exists (select 1 from public.post_midias where post_id = v_post),
    'e as midias tambem');

  -- 2. OS CAMINHOS VOLTAM. Sem eles o arquivo fica no bucket para sempre: o
  -- varredor de orfaos so olha `galerias`.
  perform public.afirma(
    jsonb_array_length(v_r->'caminhos') = 1,
    'a funcao devolve o caminho do arquivo para a tela apagar do Storage');
  perform public.afirma(
    (v_r->'caminhos'->>0) like '%/foto.jpg',
    'e o caminho e o do arquivo de verdade');
  perform public.afirma(
    (v_r->>'titulo') = 'Rascunho de teste',
    'e o titulo volta, para a tela poder dizer o que apagou');

  -- 6. A IDEIA FICA.
  perform public.afirma(
    exists (select 1 from public.ideias where id = v_ideia),
    'a ideia que gerou a peca continua na lista');
  perform public.afirma(
    (select post_id is null and usada_em is null from public.ideias where id = v_ideia),
    'e volta a estar NAO USADA — peca que nao existe nao consumiu ideia nenhuma');

  -- ---------------------------------------------------------------------
  -- 5. PECA COM LOG NAO SE APAGA — E CANCELAR E A SAIDA
  --
  -- E o motivo deste arquivo. `publicacao_eventos` e append-only desde a
  -- 0004: nem UPDATE nem DELETE, para ninguem. A primeira versao da funcao
  -- apagava o log junto e o gatilho a derrubou — a regra valeu mais que a
  -- conveniencia, e o desenho mudou por causa dela.
  --
  -- Um teste que so apagasse rascunho virgem passaria verde e esconderia
  -- isso ate o primeiro uso de verdade numa peca que ja tentou publicar.
  -- ---------------------------------------------------------------------
  v_post := (public.criar_publicacao(
    '20000000-0000-0000-0000-000000000001', 'Tentou e nao foi', 'imagem',
    'oi', null, false, array['30000000-0000-0000-0000-000000000001'::uuid])->>'id')::uuid;
  insert into public.post_midias (post_id, ordem, storage_path, mime)
  values (v_post, 0, 'x/' || v_post || '/c.jpg', 'image/jpeg');
  perform public.agendar_publicacao(v_post, now() + interval '2 days');
  select a.id into v_alvo from public.post_alvos a where a.post_id = v_post limit 1;

  insert into public.publicacao_eventos (post_alvo_id, evento, payload)
  values (v_alvo, 'container_criado', '{"nota":"tentativa que nao foi adiante"}'::jsonb);

  begin
    perform public.apagar_publicacao(v_post);
    ok := false;
  exception when others then ok := position('log de publicacao e permanente' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'peca com log nao se apaga, e a mensagem manda cancelar em vez de so recusar');

  -- E cancelar funciona, sem encostar no log.
  v_r := public.cancelar_publicacao(v_post);
  perform public.afirma((v_r->>'parados')::int = 1, 'cancelar para o destino que estava na fila');
  perform public.afirma(
    (select estado::text from public.post_alvos where id = v_alvo) = 'cancelado',
    'e o destino fica cancelado');
  perform public.afirma(
    (select status::text from public.posts where id = v_post) = 'cancelado',
    'e a peca tambem');
  perform public.afirma(
    exists (select 1 from public.publicacao_eventos where post_alvo_id = v_alvo),
    'e o log continua inteiro — e o ponto de cancelar em vez de apagar');
  perform public.afirma(
    (select proxima_tentativa_em is null from public.post_alvos where id = v_alvo),
    'e o destino sai da fila de tentativas, senao cancelar nao cancela nada');

  -- ---------------------------------------------------------------------
  -- 3. PUBLICADO NAO SE APAGA
  -- ---------------------------------------------------------------------
  v_post := (public.criar_publicacao(
    '20000000-0000-0000-0000-000000000001', 'Ja foi ao ar', 'imagem',
    'oi', null, false, array['30000000-0000-0000-0000-000000000001'::uuid])->>'id')::uuid;
  insert into public.post_midias (post_id, ordem, storage_path, mime)
  values (v_post, 0, 'x/' || v_post || '/a.jpg', 'image/jpeg');
  perform public.agendar_publicacao(v_post, now() + interval '2 days');
  update public.post_alvos
     set estado = 'publicado', media_id_publicado = '17900000000000000',
         publicado_em = now()
   where post_id = v_post;

  begin
    perform public.apagar_publicacao(v_post);
    ok := false;
  exception when others then ok := position('nao tira o post do ar' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'peca publicada e recusada, e a mensagem explica que apagar aqui nao tira do ar');
  perform public.afirma(
    exists (select 1 from public.posts where id = v_post),
    'e ela continua la');

  -- ---------------------------------------------------------------------
  -- 4. PUBLICANDO TAMBEM NAO
  -- ---------------------------------------------------------------------
  v_post := (public.criar_publicacao(
    '20000000-0000-0000-0000-000000000001', 'No meio do caminho', 'imagem',
    'oi', null, false, array['30000000-0000-0000-0000-000000000001'::uuid])->>'id')::uuid;
  insert into public.post_midias (post_id, ordem, storage_path, mime)
  values (v_post, 0, 'x/' || v_post || '/b.jpg', 'image/jpeg');
  perform public.agendar_publicacao(v_post, now() + interval '2 days');
  update public.post_alvos set estado = 'publicando' where post_id = v_post;

  begin
    perform public.apagar_publicacao(v_post);
    ok := false;
  exception when others then ok := position('ainda nao se sabe se saiu' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'peca publicando e recusada — e o estado em que nem se sabe se o post existe');
end $$;

-- ---------------------------------------------------------------------------
-- 7. Quem nao edita nao apaga
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000009';   -- papel de leitura
do $$
declare v_post uuid; ok boolean;
begin
  select id into v_post from public.posts where titulo_interno = 'Ja foi ao ar';
  begin
    perform public.apagar_publicacao(v_post);
    ok := false;
  exception when others then ok := position('permissao' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'quem so le nao apaga peca');
end $$;
