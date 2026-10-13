-- =============================================================================
-- Smoke da 0055 e da 0056. O que este teste cobra:
--   1. `canais_do_cliente` devolve UMA linha por (conta × formato), com o
--      motivo quando nao publica — a tela nao precisa cruzar duas listas;
--   2. Facebook aparece, e aparece RECUSADO com motivo. "Nao aparece" e pior
--      que "aparece apagado dizendo por que";
--   3. conta desligada, acesso de parceiro expirado e Instagram sem id
--      recusam ANTES do formato — e cada um com a sua frase;
--   4. `criar_publicacao` recusa canal que nao publica, antes de criar a linha;
--   5. `agendar_publicacao` recusa quando a conta PIORA depois de a peca ser
--      criada — o caso que nenhuma tela pega;
--   6. carrossel com video e recusado NO ANEXO, com a frase que explica que a
--      limitacao e nossa (0056).
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
  ('20000000-0000-0000-0000-000000000001', 'Padaria Aurora', 'padaria-aurora', 'America/Sao_Paulo');

insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select c.id, s.id, 'recorrente', 280000, 10, current_date
  from public.clientes c, public.servicos s
 where s.chave = 'gestao_digital' and c.slug = 'padaria-aurora';

-- Quatro contas, uma para cada estado que a regra tem de distinguir.
insert into public.contas_sociais
  (id, cliente_id, plataforma, nome_exibicao, ig_user_id, page_id, ativo, acesso_parceiro)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'instagram', 'aurora.boa',      '1784140000001', '1010', true,  'concedido'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
   'facebook',  'Padaria Aurora',  null,            '1011', true,  'concedido'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001',
   'instagram', 'aurora.desligada','1784140000003', '1012', false, 'concedido'),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001',
   'instagram', 'aurora.expirada', '1784140000004', '1013', true,  'expirado');

-- ---------------------------------------------------------------------------
-- 1, 2 e 3. A lista de canais
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_c jsonb;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  v := public.canais_do_cliente('20000000-0000-0000-0000-000000000001');

  -- Quatro contas × quatro formatos.
  perform public.afirma(jsonb_array_length(v) = 16, format('16 canais, achei %s', jsonb_array_length(v)));

  -- A conta boa publica nos quatro.
  perform public.afirma(
    (select count(*) from jsonb_array_elements(v) x
      where x->>'conta' = 'aurora.boa' and (x->>'publicavel')::boolean) = 4,
    'a conta boa de Instagram publica nos quatro formatos'
  );

  -- 2. O Facebook APARECE, e aparece recusado com motivo.
  perform public.afirma(
    (select count(*) from jsonb_array_elements(v) x
      where x->>'plataforma' = 'facebook') = 4,
    'o Facebook aparece na lista — nao aparecer faria a pessoa procurar'
  );
  select x into v_c from jsonb_array_elements(v) x
   where x->>'plataforma' = 'facebook' limit 1;
  perform public.afirma(not (v_c->>'publicavel')::boolean, 'e aparece recusado');
  perform public.afirma(
    position('adaptador' in (v_c->>'motivo')) > 0,
    'com o motivo escrito, nao so apagado'
  );

  -- 3. Cada estado ruim tem a SUA frase. Uma mensagem genérica mandaria a
  -- pessoa conferir tudo em vez de a coisa certa.
  select x into v_c from jsonb_array_elements(v) x
   where x->>'conta' = 'aurora.desligada' limit 1;
  perform public.afirma(
    position('desligada' in (v_c->>'motivo')) > 0,
    'conta desligada diz que esta desligada'
  );

  select x into v_c from jsonb_array_elements(v) x
   where x->>'conta' = 'aurora.expirada' limit 1;
  perform public.afirma(
    position('acesso de parceiro' in (v_c->>'motivo')) > 0
      and position('expirado' in (v_c->>'motivo')) > 0,
    'acesso expirado diz qual e o estado'
  );

  -- A tela escreve o limite embaixo do chip, e ele vem na mesma resposta.
  select x into v_c from jsonb_array_elements(v) x
   where x->>'conta' = 'aurora.boa' and x->>'tipo' = 'carrossel' limit 1;
  perform public.afirma((v_c->>'minimo')::int = 2, 'o chip de carrossel sabe que pede 2');
  perform public.afirma((v_c->>'maximo')::int = 10, 'e no maximo 10');
  perform public.afirma(
    v_c->>'natureza' = 'imagem',
    'e que aceita so imagem (0056) — a tela nao pode prometer video'
  );

  -- Canal publicavel vem antes do recusado: a pessoa escolhe entre o que
  -- funciona, e o resto fica no fim como informacao.
  perform public.afirma(
    (v->0->>'publicavel')::boolean,
    'o primeiro canal da lista e um que publica'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4. criar_publicacao recusa o canal que nao publica
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  -- Reel numa Página do Facebook: era a combinação que as duas perguntas
  -- separadas deixavam montar.
  begin
    perform public.criar_publicacao(
      '20000000-0000-0000-0000-000000000001', 'Reel no Facebook', 'reel',
      '', '', false, array['30000000-0000-0000-0000-000000000002'::uuid]);
    ok := false;
  exception when others then
    ok := position('adaptador' in sqlerrm) > 0 and position('Padaria Aurora' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'reel no Facebook e recusado, dizendo em qual conta');

  -- E nao deixou rascunho para tras: a recusa vem ANTES do insert.
  perform public.afirma(
    not exists (select 1 from public.posts where titulo_interno = 'Reel no Facebook'),
    'a recusa nao deixa rascunho orfao — ela vem antes de criar a linha'
  );

  -- Conta desligada tambem.
  begin
    perform public.criar_publicacao(
      '20000000-0000-0000-0000-000000000001', 'Post na desligada', 'imagem',
      '', '', false, array['30000000-0000-0000-0000-000000000003'::uuid]);
    ok := false;
  exception when others then
    ok := position('desligada' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'conta desligada e recusada na criacao');

  -- E a conta boa passa.
  perform public.afirma(
    public.criar_publicacao(
      '20000000-0000-0000-0000-000000000001', 'Post bom', 'imagem',
      '', '', false, array['30000000-0000-0000-0000-000000000001'::uuid])->>'id' is not null,
    'a conta boa cria normalmente'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 5. A conta PIORA depois de a peca ser criada
--
-- O caso que nenhuma tela pega: a peca foi criada com a conta boa, o acesso de
-- parceiro expirou depois, e a peca ficaria agendada para falhar sozinha.
-- ---------------------------------------------------------------------------
do $$
declare
  v_post uuid;
  ok boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  select id into v_post from public.posts where titulo_interno = 'Post bom';

  insert into public.post_midias (post_id, ordem, storage_path, mime)
  values (v_post, 0, '20000000-0000-0000-0000-000000000001/' || v_post || '/foto.jpg', 'image/jpeg');

  -- Agenda normalmente enquanto a conta esta boa.
  perform public.agendar_publicacao(v_post, now() + interval '2 days');
  perform public.afirma(
    (select status from public.posts where id = v_post)::text = 'agendado',
    'agenda com a conta boa'
  );

  -- A conta piora.
  update public.contas_sociais set acesso_parceiro = 'expirado'
   where id = '30000000-0000-0000-0000-000000000001';

  begin
    perform public.agendar_publicacao(v_post, now() + interval '3 days');
    ok := false;
  exception when others then
    ok := position('acesso de parceiro' in sqlerrm) > 0
      and position('aurora.boa' in sqlerrm) > 0;
  end;
  perform public.afirma(
    ok,
    'reagendar com a conta piorada e recusado, dizendo QUAL conta e por que'
  );

  update public.contas_sociais set acesso_parceiro = 'concedido'
   where id = '30000000-0000-0000-0000-000000000001';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Carrossel com video, recusado no ANEXO (0056)
--
-- Vivo em producao ate hoje: a 0045 deixava `imagem_ou_video`, o adaptador so
-- faz imagem, e o video era recusado na hora de publicar. Quem achou foi o
-- `provar-canais.mjs`, comparando as duas copias da regra.
-- ---------------------------------------------------------------------------
do $$
declare
  v_post uuid;
  ok boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  v_post := (public.criar_publicacao(
    '20000000-0000-0000-0000-000000000001', 'Carrossel de teste', 'carrossel')->>'id')::uuid;

  begin
    perform public.registrar_midia_post(
      v_post,
      '20000000-0000-0000-0000-000000000001/' || v_post || '/video.mp4',
      'video/mp4');
    ok := false;
  exception when others then
    -- A mensagem tem de dizer que a limitacao e NOSSA e o que fazer, senao a
    -- pessoa acha defeito: ela acabou de ver carrossel com video no Instagram.
    ok := position('limitacao nossa' in sqlerrm) > 0
      and position('nao da Meta' in sqlerrm) > 0
      and position('Reel' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'carrossel com video e recusado no anexo, explicando de quem e a limitacao');

  -- E a foto entra.
  perform public.registrar_midia_post(
    v_post,
    '20000000-0000-0000-0000-000000000001/' || v_post || '/foto.jpg',
    'image/jpeg');
  perform public.afirma(
    (select count(*) from public.post_midias where post_id = v_post) = 1,
    'foto JPG entra no carrossel'
  );

  -- Reel com video continua funcionando: a regra e so do carrossel.
  v_post := (public.criar_publicacao(
    '20000000-0000-0000-0000-000000000001', 'Reel de teste', 'reel')->>'id')::uuid;
  perform public.registrar_midia_post(
    v_post,
    '20000000-0000-0000-0000-000000000001/' || v_post || '/video.mp4',
    'video/mp4');
  perform public.afirma(
    (select count(*) from public.post_midias where post_id = v_post) = 1,
    'reel com video nao foi afetado'
  );
end $$;

select 'canais conferidos' as resultado;
