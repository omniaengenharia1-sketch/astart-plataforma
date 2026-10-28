-- =============================================================================
-- Smoke da galeria propria (0034/0035). O que este teste cobra:
--   1. o link sem conta abre a galeria, e so ela;
--   2. link revogado deixa de abrir — porque nada vence aqui, revogar e a
--      unica porta de saida e precisa funcionar;
--   3. token errado nao abre nada, e nao vaza se a galeria existe;
--   4. o cliente logado ve a propria galeria e nao ve a do vizinho;
--   5. o caminho do arquivo decide quem pode ler o arquivo.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000002', 'layana@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br'),
  ('20000000-0000-0000-0000-00000000000b', 'carlos@clienteb.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000002','Layana','operacao','layana@astartstudio.com.br');
insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a','Padaria Aurora','aurora'),
  ('b0000000-0000-0000-0000-00000000000b','Bloco B','bloco-b');
insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('20000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Bruna','bruna@clientea.com.br'),
  ('20000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-00000000000b','Carlos','carlos@clienteb.com.br');

-- Audiovisual liga o modulo galeria nos dois.
insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, parcelas, inicio)
select c.id, s.id, 'pontual', 240000, 1, current_date
  from public.clientes c, public.servicos s
 where s.chave = 'audiovisual' and c.id in (
   'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');

insert into public.sessoes_captacao (id, cliente_id, titulo, data, status) values
  ('5e550000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a',
   'Captação na padaria', current_date, 'realizada'),
  ('5e550000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-00000000000b',
   'Captação na obra', current_date, 'realizada');

set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------------------
-- 1. a equipe monta a galeria e sobe os arquivos
-- ---------------------------------------------------------------------------
do $$
declare
  v_gal uuid;
  v_i1  uuid;
  v_i2  uuid;
begin
  v_gal := public.criar_galeria('5e550000-0000-0000-0000-00000000000a',
             'Captação na padaria — outubro', 'Separe as suas 20 preferidas.');

  v_i1 := public.registrar_item_galeria(v_gal, 'DSC_0001.jpg', 'foto',
            v_gal || '/orig/0001.jpg', 'image/jpeg', 8_400_000,
            v_gal || '/mini/0001.webp', null, 6000, 4000, null);
  v_i2 := public.registrar_item_galeria(v_gal, 'making-of.mp4', 'video',
            v_gal || '/orig/0002.mp4', 'video/mp4', 1_200_000_000,
            v_gal || '/mini/0002.webp', v_gal || '/poster/0002.webp', 3840, 2160, 94.5);

  perform public.afirma(
    (select capa_item_id from public.galerias where id = v_gal) = v_i1,
    'a primeira foto vira capa sozinha');
  perform public.afirma(
    (select capa_item_id from public.galerias where id = v_gal) <> v_i2,
    'e o video nao rouba a capa');

  -- A contagem da sessao passa a sair dos arquivos.
  perform public.afirma(
    (select qtd_fotos from public.sessoes_captacao where id = '5e550000-0000-0000-0000-00000000000a') = 1
    and (select qtd_videos from public.sessoes_captacao where id = '5e550000-0000-0000-0000-00000000000a') = 1,
    'a contagem da captacao passa a vir dos arquivos, nao da mao');

  perform public.afirma(
    (select tamanho_bytes from public.galeria_itens where id = v_i2) = 1200000000,
    'o tamanho do video cabe em bigint — 1,2 GB nao e bug de int');
end $$;

-- ---------------------------------------------------------------------------
-- 2. o link
-- ---------------------------------------------------------------------------
do $$
declare
  v_gal   uuid;
  v_token text;
  v_link  uuid;
  g       jsonb;
begin
  select id into v_gal from public.galerias
   where sessao_id = '5e550000-0000-0000-0000-00000000000a';

  select link_id, token into v_link, v_token from public.criar_link_galeria(v_gal);

  -- O token mudou de forma na 0057, e esta verificacao mudou junto. Era
  -- `length(v_token) = 64` — 32 bytes em hex — que chegava no cliente assim:
  --
  --   /g/cda055ce12840f4f780862a249b6fb5a124970d2a31c03783edc1b07d7333519
  --
  -- Agora e o nome da galeria mais 12 bytes em base64url. O que se cobra nao e
  -- o comprimento: e que o link DIGA de que galeria e, e que o segredo
  -- continue grande o bastante para ninguem chutar.
  perform public.afirma(
    v_token like 'captacao-na-padaria-outubro-%',
    format('o link diz de que galeria e (veio "%s")', v_token));
  perform public.afirma(
    v_token ~ '^captacao-na-padaria-outubro-[A-Za-z0-9_-]{16}$',
    format('e termina em 16 caracteres de segredo, sem + nem / (veio "%s")', v_token));
  -- 12 bytes = 96 bits. Dois links da mesma galeria nao podem coincidir, senao
  -- o segredo nao e segredo.
  perform public.afirma(
    v_token <> (select token from public.criar_link_galeria(v_gal)),
    'dois links da mesma galeria saem diferentes');
  perform public.afirma(
    not exists (select 1 from public.links_galeria where token_hash = v_token),
    'e o que fica guardado e o hash, nunca o token');
  perform public.afirma(
    (select publicada_em is not null from public.galerias where id = v_gal),
    'criar o link publica a galeria');

  -- O visitante nao esta logado: quem chama e a Edge Function, com service_role.
  reset role;
  g := public.galeria_por_token(v_token);
  perform public.afirma(g is not null, 'o link abre a galeria');
  perform public.afirma(g->>'cliente' = 'Padaria Aurora', 'com o nome do cliente');
  perform public.afirma(jsonb_array_length(g->'itens') = 2, 'com os dois arquivos');
  perform public.afirma((g->>'permiteDownload')::boolean, 'e com download liberado');
  perform public.afirma(
    (select acessos from public.links_galeria where id = v_link) = 1,
    'e o acesso fica contado');

  perform public.afirma(public.galeria_por_token('nao-e-token') is null,
    'token curto nao abre nada');
  perform public.afirma(
    public.galeria_por_token(repeat('a', 64)) is null,
    'token errado do tamanho certo tambem nao');

  -- Favoritar pelo link.
  perform public.favoritar_por_token(v_token, (g->'itens'->0->>'id')::uuid, 'Bruna', true);
  perform public.afirma(
    jsonb_array_length(public.galeria_por_token(v_token)->'favoritos') = 1,
    'a escolha do cliente fica marcada');
  perform public.favoritar_por_token(v_token, (g->'itens'->0->>'id')::uuid, 'Bruna', false);
  perform public.afirma(
    jsonb_array_length(public.galeria_por_token(v_token)->'favoritos') = 0,
    'e desmarcar funciona');

  -- Item de outra galeria nao entra pela porta desta.
  begin
    perform public.favoritar_por_token(v_token, gen_random_uuid(), 'Bruna', true);
    raise exception 'FALHOU: favoritou item que nao e da galeria';
  exception when others then
    if position('nao e desta galeria' in sqlerrm) = 0 then raise; end if;
  end;

  -- Revogar e a unica porta de saida, entao tem de fechar de verdade.
  set role authenticated;
  set "teste.uid" = '10000000-0000-0000-0000-000000000002';
  perform public.revogar_link_galeria(v_link);
  reset role;
  perform public.afirma(public.galeria_por_token(v_token) is null,
    'link revogado para de abrir');
  begin
    perform public.favoritar_por_token(v_token, (g->'itens'->0->>'id')::uuid, 'Bruna', true);
    raise exception 'FALHOU: favoritou por link revogado';
  exception when others then
    if position('invalido ou revogado' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. o cliente logado
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';   -- Bruna, da Aurora
do $$
declare g jsonb := public.galerias_do_cliente('a0000000-0000-0000-0000-00000000000a');
begin
  perform public.afirma(jsonb_array_length(g) = 1, 'a cliente ve a propria galeria');
  perform public.afirma((g->0->>'fotos')::int = 1 and (g->0->>'videos')::int = 1,
    'com a contagem certa');
  perform public.afirma((g->0->>'bytes')::bigint = 1208400000,
    'e o peso somado dos arquivos');
  perform public.afirma(public.galerias_do_cliente('b0000000-0000-0000-0000-00000000000b') is null,
    'e nao ve a galeria do vizinho');
end $$;

-- O cliente logado escolhe sem token nenhum, e o nome vem do cadastro.
do $$
declare v_item uuid;
begin
  select i.id into v_item from public.galeria_itens i
    join public.galerias g on g.id = i.galeria_id
   where g.sessao_id = '5e550000-0000-0000-0000-00000000000a' and i.tipo = 'foto';

  perform public.favoritar_item(v_item, true);
  perform public.afirma(
    (select quem from public.galeria_favoritos where item_id = v_item) = 'Bruna',
    'o nome de quem escolheu sai do cadastro, nao de um campo do front');
  perform public.favoritar_item(v_item, false);
  perform public.afirma(
    not exists (select 1 from public.galeria_favoritos where item_id = v_item),
    'e desmarcar funciona');

  -- Guarda o id para o proximo bloco. O Carlos nao enxerga esta galeria, entao
  -- se ele fosse buscar o id sozinho receberia nulo — e o teste provaria que
  -- "nulo nao favorita", que nao e a pergunta. A pergunta e se ele consegue
  -- favoritar um item REAL de outro cliente tendo o id na mao.
  perform set_config('teste.item', v_item::text, false);
end $$;

-- E o vizinho nao escolhe na galeria alheia, nem com o id na mao.
set "teste.uid" = '20000000-0000-0000-0000-00000000000b';
do $$ begin
  begin
    perform public.favoritar_item(current_setting('teste.item')::uuid, true);
    raise exception 'FALHOU: o Carlos escolheu foto da Aurora';
  exception when others then
    if position('Sem permissao' in sqlerrm) = 0 then raise; end if;
  end;
end $$;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';

-- ---------------------------------------------------------------------------
-- 4. o caminho do arquivo decide quem le o arquivo
-- ---------------------------------------------------------------------------
do $$
declare v_gal_a uuid; v_gal_b uuid;
begin
  select id into v_gal_a from public.galerias where sessao_id = '5e550000-0000-0000-0000-00000000000a';

  set role authenticated;
  set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
  perform public.afirma(public.usuario_ve_galeria(v_gal_a), 'a Bruna le os arquivos da dela');

  set "teste.uid" = '20000000-0000-0000-0000-00000000000b';
  perform public.afirma(not public.usuario_ve_galeria(v_gal_a),
    'o Carlos nao le os arquivos da Aurora');

  set "teste.uid" = '10000000-0000-0000-0000-000000000002';
  perform public.afirma(public.usuario_ve_galeria(v_gal_a), 'a equipe le');

  perform public.afirma(
    public.galeria_do_caminho(v_gal_a || '/orig/0001.jpg') = v_gal_a,
    'o caminho entrega a galeria');
  perform public.afirma(public.galeria_do_caminho('lixo') is null,
    'caminho torto nao vira galeria nenhuma');
end $$;

reset role;

do $$ begin
  perform public.afirma(
    not has_function_privilege('anon','public.galeria_por_token(text)','execute'),
    'anon nao chama galeria_por_token direto: quem chama e a Edge Function');
  perform public.afirma(
    not has_function_privilege('anon','public.criar_link_galeria(uuid)','execute'),
    'nem cria link');
  perform public.afirma(
    (select not public from storage.buckets where id = 'galerias'),
    'o bucket das galerias e privado');
end $$;

select 'galeria: tudo passou' as resultado;
