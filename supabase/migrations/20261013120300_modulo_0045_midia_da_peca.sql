-- 0045 — a mídia da peça. A segunda escrita que faltava, e a que trava tudo.
--
-- O calendário cria a peça com dia e hora, o worker publica, as contas agora
-- conectam. E `post_midias` não tinha escritor: a peça ia para a Meta sem
-- arquivo, e o adaptador recusava com "um post de imagem única precisa de
-- exatamente 1 arquivo". Legenda sem imagem o Instagram não publica.
--
-- A decisão que organiza este arquivo: **as regras da Meta são cobradas na
-- hora de anexar, não na hora de publicar.**
--
-- O adaptador já recusa carrossel com 11 itens — mas recusa no minuto do post,
-- de madrugada, quando ninguém está olhando. A peça volta com erro e o cliente
-- não recebeu nada. Cobrar aqui custa uma mensagem na tela enquanto a pessoa
-- tem o arquivo na mão, e é a diferença entre "não deixei você errar" e
-- "descobri que você errou".

-- ---------------------------------------------------------------------------
-- Quantos arquivos cada tipo aceita, e de que natureza.
--
-- Fica em função, não espalhado em `if`, porque é a regra da plataforma e um
-- dia muda junto com a Meta: Stories de vídeo, carrossel misto, Reels mais
-- longo. Um lugar para mudar.
-- ---------------------------------------------------------------------------
create or replace function public.limites_de_midia(p_tipo public.tipo_post)
returns table (minimo smallint, maximo smallint, natureza text)
language sql
immutable
set search_path = public, pg_temp
as $$
  select t.minimo, t.maximo, t.natureza from (values
    ('imagem'::public.tipo_post,    1::smallint, 1::smallint,  'imagem'),
    ('carrossel'::public.tipo_post, 2::smallint, 10::smallint, 'imagem_ou_video'),
    ('reel'::public.tipo_post,      1::smallint, 1::smallint,  'video'),
    ('story'::public.tipo_post,     1::smallint, 1::smallint,  'imagem_ou_video')
  ) as t(tipo, minimo, maximo, natureza)
  where t.tipo = p_tipo;
$$;

revoke all on function public.limites_de_midia(public.tipo_post) from public, anon;
grant execute on function public.limites_de_midia(public.tipo_post) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Anexar
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

  -- Peça publicada é histórico: trocar a imagem depois mudaria o que a
  -- plataforma diz que foi publicado, sem mudar o que está no Instagram.
  --
  -- `publicando` e `publicado_parcial` entram na mesma trava, e isto eu quase
  -- deixei passar: no primeiro o worker está no meio do voo — trocar o arquivo
  -- ali publicaria uma coisa e registraria outra; no segundo já saiu em uma
  -- conta e falta outra, então a mídia tem de continuar a mesma nas duas.
  if v_post.status in ('publicando', 'publicado', 'publicado_parcial') then
    raise exception
      'Esta peca esta em % — a midia nao muda mais. Duplique a peca se quiser outra imagem.',
      v_post.status;
  end if;

  -- O CAMINHO decide quem pode ler o arquivo: a politica do bucket (0038) le o
  -- cliente do primeiro segmento. Caminho fora da convencao criaria um arquivo
  -- que nem o cliente nem a equipe conseguem abrir — um arquivo invisivel,
  -- ocupando espaco, sem ninguem entender por que a imagem nao aparece.
  if public.cliente_do_caminho_midia(p_caminho) is distinct from v_post.cliente_id then
    raise exception
      'O caminho do arquivo tem de comecar pelo id do cliente (%), senao ninguem consegue le-lo.',
      v_post.cliente_id;
  end if;

  select * into v_lim from public.limites_de_midia(v_post.tipo);
  if not found then
    raise exception 'Tipo de peca % nao tem regra de midia.', v_post.tipo;
  end if;

  v_ehVideo := p_mime like 'video/%';

  if v_lim.natureza = 'imagem' and not (p_mime like 'image/%') then
    raise exception 'Peca de imagem aceita foto, nao %.', p_mime;
  end if;
  if v_lim.natureza = 'video' and not v_ehVideo then
    raise exception 'Reel aceita video, nao %.', p_mime;
  end if;
  if v_lim.natureza = 'imagem_ou_video'
     and not (p_mime like 'image/%' or v_ehVideo) then
    raise exception 'Esta peca aceita foto ou video, nao %.', p_mime;
  end if;

  select count(*) into v_quantas from public.post_midias m where m.post_id = p_post;

  if v_quantas >= v_lim.maximo then
    raise exception
      'Esta peca (%) aceita no maximo % arquivo(s), e ja tem %.',
      v_post.tipo, v_lim.maximo, v_quantas;
  end if;

  -- `ordem` conta de zero e preenche buraco deixado por remocao, em vez de
  -- seguir subindo: o indice unico (post_id, ordem) reclamaria depois.
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
    -- A tela precisa saber se a peça já está publicável, e a conta é aqui.
    'completa', (v_quantas + 1) >= v_lim.minimo
  );
end;
$$;

revoke all on function public.registrar_midia_post(uuid, text, text, integer, integer, numeric, bigint)
  from public, anon;
grant execute on function public.registrar_midia_post(uuid, text, text, integer, integer, numeric, bigint)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tirar
-- ---------------------------------------------------------------------------
create or replace function public.remover_midia_post(p_midia uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post     public.posts%rowtype;
  v_post_id  uuid;
  v_caminho  text;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para tirar midia.';
  end if;

  -- Um `%rowtype` nao pode dividir a lista do INTO com outra variavel.
  select m.storage_path, m.post_id into v_caminho, v_post_id
    from public.post_midias m
   where m.id = p_midia;

  if v_caminho is null then
    raise exception 'Arquivo % nao encontrado.', p_midia;
  end if;

  select * into v_post from public.posts p where p.id = v_post_id;

  if not found or not public.usuario_ve_cliente(v_post.cliente_id) then
    raise exception 'Arquivo % nao encontrado.', p_midia;
  end if;
  if v_post.status in ('publicando', 'publicado', 'publicado_parcial') then
    raise exception 'Esta peca esta em % — a midia nao muda mais.', v_post.status;
  end if;

  delete from public.post_midias where id = p_midia;

  -- Devolve o caminho para a tela apagar o arquivo do bucket. A linha sai
  -- primeiro: arquivo orfao no storage e desperdicio, linha apontando para
  -- arquivo que nao existe e imagem quebrada na cara de quem olha.
  return jsonb_build_object('caminho', v_caminho);
end;
$$;

revoke all on function public.remover_midia_post(uuid) from public, anon;
grant execute on function public.remover_midia_post(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ler
--
-- SECURITY INVOKER: quem decide e o RLS, e o cliente no portal tambem chama
-- esta funcao para ver a midia da propria peca. O caminho vai como CAMINHO,
-- nunca como endereco — quem assina e o front, com validade curta.
-- ---------------------------------------------------------------------------
create or replace function public.midias_do_post(p_post uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',       m.id,
               'ordem',    m.ordem,
               'caminho',  m.storage_path,
               'mime',     m.mime,
               'bytes',    m.tamanho_bytes
             ) order by m.ordem
           ),
           '[]'::jsonb
         )
    from public.post_midias m
    join public.posts p on p.id = m.post_id
   where m.post_id = p_post
     and public.usuario_ve_cliente(p.cliente_id);
$$;

revoke all on function public.midias_do_post(uuid) from public, anon;
grant execute on function public.midias_do_post(uuid) to authenticated, service_role;
