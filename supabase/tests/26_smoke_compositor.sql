-- =============================================================================
-- Smoke da 0046. O que este teste cobra, e tudo gira em volta de uma coisa:
-- NADA vai para o agendador sem poder publicar.
--   1. agendar sem arquivo e recusado, dizendo quantos faltam;
--   2. agendar sem conta conectada e recusado, dizendo onde conectar;
--   3. com arquivo e conta, agenda — e "postar agora" vira agendado_para=now();
--   4. trocar o formato com arquivo anexado e recusado;
--   5. publicacao no ar nao muda mais, nem por editar nem por reagendar;
--   6. cliente sem o modulo de publicacao nao cria publicacao;
--   7. legenda e hashtags ficam em campos separados — e o worker e que junta.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'direcao@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Direcao', 'admin', true, 'direcao@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('20000000-0000-0000-0000-000000000001', 'Com publicacao', 'com-pub', 'America/Sao_Paulo'),
  ('20000000-0000-0000-0000-000000000009', 'Sem publicacao', 'sem-pub', 'America/Sao_Paulo');

insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select c.id, s.id, 'recorrente', 100000, 10, current_date
  from public.clientes c, public.servicos s
 where s.nome = 'Gestão Digital' and c.slug = 'com-pub';

insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, parcelas, inicio)
select c.id, s.id, 'projeto', 500000, 1, current_date
  from public.clientes c, public.servicos s
 where s.nome = 'Branding' and c.slug = 'sem-pub';

-- ---------------------------------------------------------------------------
-- 6. o portao do modulo
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  begin
    perform public.criar_publicacao('20000000-0000-0000-0000-000000000009', 'nao devia', 'imagem');
    ok := false;
  exception when others then
    ok := position('publicacao no contrato' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'cliente sem publicacao contratada nao cria publicacao');
end $$;

-- ---------------------------------------------------------------------------
-- 1, 2 e 7. criar, e as duas recusas antes de agendar
-- ---------------------------------------------------------------------------
do $$
declare
  v_post uuid;
  v_row  public.posts%rowtype;
  ok boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  v_post := (public.criar_publicacao(
    '20000000-0000-0000-0000-000000000001',
    'Bastidores de outubro',
    'imagem',
    'olha o que saiu do estudio hoje',
    '#astart #social',
    false
  )->>'id')::uuid;

  select * into v_row from public.posts where id = v_post;
  perform public.afirma(v_row.status = 'rascunho', 'nasce rascunho, sem hora');
  perform public.afirma(v_row.agendado_para is null, 'e sem agendado_para');

  -- 7. os dois campos separados, cada um com uma coisa.
  perform public.afirma(
    v_row.legenda = 'olha o que saiu do estudio hoje',
    'a legenda guarda SO a legenda'
  );
  perform public.afirma(v_row.hashtags = '#astart #social', 'e as hashtags ficam no campo delas');
  perform public.afirma(
    position('#astart' in v_row.legenda) = 0,
    'as hashtags NAO sao concatenadas na legenda ao salvar — senao editar depois seria um inferno'
  );

  -- 1. sem arquivo
  begin
    perform public.agendar_publicacao(v_post, now() + interval '1 day');
    ok := false;
  exception when others then
    ok := position('Falta arquivo' in sqlerrm) > 0 and position('tem 0' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'agendar sem arquivo e recusado, dizendo quantos faltam');

  -- Com arquivo, mas ainda sem conta conectada.
  insert into public.post_midias (post_id, ordem, storage_path, mime)
  values (v_post, 0, '20000000-0000-0000-0000-000000000001/' || v_post || '/foto.jpg', 'image/jpeg');

  begin
    perform public.agendar_publicacao(v_post, now() + interval '1 day');
    ok := false;
  exception when others then
    ok := position('conta conectada' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'agendar sem conta conectada e recusado, dizendo onde conectar');
end $$;

-- ---------------------------------------------------------------------------
-- 3, 4 e 5. com tudo no lugar
-- ---------------------------------------------------------------------------
insert into public.contas_sociais (cliente_id, plataforma, nome_exibicao, ig_user_id, page_id)
values ('20000000-0000-0000-0000-000000000001', 'instagram', 'astartstudio', '1784140000001', '1010');

do $$
declare
  v_post uuid;
  v_row  public.posts%rowtype;
  v_r    jsonb;
  ok boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  select id into v_post from public.posts where titulo_interno = 'Bastidores de outubro';

  -- 3. agenda para o futuro
  v_r := public.agendar_publicacao(v_post, now() + interval '2 days');
  select * into v_row from public.posts where id = v_post;
  perform public.afirma(v_row.status = 'agendado', 'com arquivo e conta, agenda');
  perform public.afirma(not (v_r->>'agora')::boolean, 'e sabe que NAO e agora');

  -- 3. "postar agora" e agendar para agora: o worker varre
  -- `agendado and agendado_para <= now()` e pega na proxima rodada.
  v_r := public.agendar_publicacao(v_post, null);
  select * into v_row from public.posts where id = v_post;
  perform public.afirma(v_row.agendado_para <= now(), 'postar agora poe a hora no passado imediato');
  perform public.afirma((v_r->>'agora')::boolean, 'e a tela sabe dizer que sai em instantes');

  -- 4. trocar o formato com arquivo anexado
  begin
    perform public.atualizar_publicacao(v_post, p_tipo => 'reel');
    ok := false;
  exception when others then
    ok := position('Tire os arquivos' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'trocar o formato com arquivo anexado e recusado');

  -- 5. no ar nao muda mais
  update public.posts set status = 'publicado' where id = v_post;

  begin
    perform public.atualizar_publicacao(v_post, p_legenda => 'tentando mudar');
    ok := false;
  exception when others then
    ok := position('nao muda mais' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'publicacao no ar nao aceita edicao');

  begin
    perform public.agendar_publicacao(v_post, now() + interval '1 day');
    ok := false;
  exception when others then
    ok := position('nao da para agendar de novo' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'e nao aceita ser reagendada');
end $$;

-- ---------------------------------------------------------------------------
-- 8. imagem so JPEG (0047)
--
-- A Meta publica imagem so em JPEG. PNG entrava, agendava, e era recusado na
-- hora de publicar — de madrugada, com o cliente sem receber nada.
-- ---------------------------------------------------------------------------
do $$
declare
  v_post uuid;
  ok boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  v_post := (public.criar_publicacao(
    '20000000-0000-0000-0000-000000000001', 'Teste de formato', 'imagem')->>'id')::uuid;

  begin
    perform public.registrar_midia_post(
      v_post,
      '20000000-0000-0000-0000-000000000001/' || v_post || '/arte.png',
      'image/png');
    ok := false;
  exception when others then
    -- A mensagem tem de dizer O QUE FAZER, nao so o que esta errado.
    ok := position('so em JPEG' in sqlerrm) > 0 and position('Exporte como JPG' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'PNG e recusado, dizendo para exportar como JPG');

  perform public.registrar_midia_post(
    v_post,
    '20000000-0000-0000-0000-000000000001/' || v_post || '/arte.jpg',
    'image/jpeg');
  perform public.afirma(
    (select count(*) from public.post_midias where post_id = v_post) = 1,
    'e JPEG entra'
  );

  -- Video segue aceito como antes: a regra e so para imagem.
  v_post := (public.criar_publicacao(
    '20000000-0000-0000-0000-000000000001', 'Teste de reel', 'reel')->>'id')::uuid;
  perform public.registrar_midia_post(
    v_post,
    '20000000-0000-0000-0000-000000000001/' || v_post || '/video.mp4',
    'video/mp4');
  perform public.afirma(
    (select count(*) from public.post_midias where post_id = v_post) = 1,
    'video nao e afetado pela regra do JPEG'
  );
end $$;

select 'compositor conferido' as resultado;
