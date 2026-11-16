-- 0068 — PNG passa a ser aceito no envio, e a recusa do banco muda de sentido.
--
-- A dona: "achei um erro, na hora de enviar a arte ele precisa aceitar png
-- tbm". Ela exporta a arte em PNG, e o seletor de arquivos da peca nem deixava
-- CLICAR no arquivo: o `accept` era `image/jpeg`.
--
-- O PRIMEIRO IMPULSO ERA ERRADO. Aceitar PNG e guardar PNG so mudaria o lugar
-- da falha: a peca entraria no calendario parecendo pronta e quebraria na hora
-- de publicar, de madrugada, na conta do cliente. Conferido na documentacao da
-- Meta em 16/11, e nao de memoria: "JPEG is the only image format supported.
-- Extended JPEG formats such as MPO and JPS are not supported."
--
-- Entao o envio passou a CONVERTER, no navegador, antes de subir
-- (`paraJpegDaMeta`, em derivadas.ts): o arquivo que chega ao bucket e ao
-- banco ja e JPEG, com o fundo transparente achatado em branco e um aviso na
-- tela dizendo que isso aconteceu.
--
-- O QUE MUDA AQUI, ENTAO, E SO A FRASE — e isso e de proposito.
--
-- A regra "imagem tem de ser JPEG" (0047) NAO afrouxa. Ela e a ultima linha
-- antes da conta do cliente, e a Meta continua aceitando so JPEG. O que mudou
-- foi o significado dela: antes recusava a pessoa, agora recusa um caminho que
-- pulou a conversao. A frase antiga ("exporte como JPG e anexe de novo — nao
-- converto sozinho") passou a ser mentira no mesmo minuto em que a conversao
-- entrou, e mensagem de erro que mente custa mais caro que erro nenhum: manda
-- a pessoa fazer um trabalho que a plataforma ja faz.
--
-- As mensagens daqui sao copiadas letra por letra em `formatos.ts`, porque o
-- modo exemplo tem de recusar com a frase que o banco recusaria — senao o
-- roteiro de navegador aprova um caminho que a producao reprova.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_midia_post(
  p_post     uuid,
  p_caminho  text,
  p_mime     text,
  p_largura  integer default null,
  p_altura   integer default null,
  p_duracao  numeric default null,
  p_bytes    bigint  default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post     public.posts%rowtype;
  v_lim      record;
  v_quantas  smallint;
  v_ordem    smallint;
  v_id       uuid;
  v_ehVideo  boolean;
  v_ehImagem boolean;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para anexar midia.';
  end if;

  select * into v_post from public.posts p where p.id = p_post;
  if not found then
    raise exception 'Peca % nao encontrada.', p_post;
  end if;
  if not public.usuario_ve_cliente(v_post.cliente_id) then
    raise exception 'Peca % nao encontrada.', p_post;
  end if;

  if v_post.status in ('publicando', 'publicado', 'publicado_parcial') then
    raise exception
      'Esta peca esta em % — a midia nao muda mais. Duplique a peca se quiser outra imagem.',
      v_post.status;
  end if;

  if public.cliente_do_caminho_midia(p_caminho) is distinct from v_post.cliente_id then
    raise exception
      'O caminho do arquivo tem de comecar pelo id do cliente (%), senao ninguem consegue le-lo.',
      v_post.cliente_id;
  end if;

  select * into v_lim from public.limites_de_midia(v_post.tipo);
  if not found then
    raise exception 'Tipo de peca % nao tem regra de midia.', v_post.tipo;
  end if;

  v_ehVideo  := p_mime like 'video/%';
  v_ehImagem := p_mime like 'image/%';

  -- O carrossel primeiro, porque a recusa generica abaixo nao explicaria por
  -- que o Instagram aceita e a plataforma nao.
  if v_post.tipo = 'carrossel' and v_ehVideo then
    raise exception
      'Carrossel com video ainda nao sai por aqui — e limitacao nossa, nao da Meta. '
      'Cada video de um carrossel precisa terminar de processar antes de o carrossel ser '
      'montado, e o agendador ainda nao sabe esperar por isso. Ja esta na fila. '
      'Por enquanto: carrossel de fotos, ou um Reel para o video.';
  end if;

  if v_lim.natureza = 'imagem' and not v_ehImagem then
    raise exception 'Peca de imagem aceita foto, nao %.', p_mime;
  end if;
  if v_lim.natureza = 'video' and not v_ehVideo then
    raise exception 'Reel aceita video, nao %.', p_mime;
  end if;
  if v_lim.natureza = 'imagem_ou_video' and not (v_ehImagem or v_ehVideo) then
    raise exception 'Esta peca aceita foto ou video, nao %.', p_mime;
  end if;

  -- A Meta publica imagem so em JPEG (0047). A frase e a da 0068.
  if v_ehImagem and p_mime not in ('image/jpeg', 'image/jpg') then
    raise exception
      'A Meta publica imagem so em JPEG, e este arquivo e %. '
      'A plataforma converte sozinha no envio — PNG e afins viram JPG com fundo '
      'branco. Este chegou sem passar por essa conversao: anexe pela tela da peca.',
      p_mime;
  end if;

  select count(*) into v_quantas from public.post_midias m where m.post_id = p_post;

  if v_quantas >= v_lim.maximo then
    raise exception
      'Esta peca (%) aceita no maximo % arquivo(s), e ja tem %.',
      v_post.tipo, v_lim.maximo, v_quantas;
  end if;

  select coalesce(min(g.n), v_quantas)::smallint into v_ordem
    from generate_series(0, v_lim.maximo - 1) as g(n)
   where not exists (select 1 from public.post_midias m where m.post_id = p_post and m.ordem = g.n);

  insert into public.post_midias
    (post_id, ordem, storage_path, mime, largura, altura, duracao_segundos, tamanho_bytes)
  values
    (p_post, v_ordem, p_caminho, p_mime, p_largura, p_altura, p_duracao, p_bytes)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'ordem', v_ordem,
    'quantas', v_quantas + 1,
    'minimo', v_lim.minimo,
    'maximo', v_lim.maximo,
    'completa', (v_quantas + 1) >= v_lim.minimo
  );
end;
$$;

revoke all on function public.registrar_midia_post(uuid, text, text, integer, integer, numeric, bigint)
  from public, anon;
grant execute on function public.registrar_midia_post(uuid, text, text, integer, integer, numeric, bigint)
  to authenticated, service_role;
