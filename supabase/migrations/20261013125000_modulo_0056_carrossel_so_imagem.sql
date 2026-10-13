-- 0056 — carrossel aceita só imagem, porque é só isso que o adaptador publica.
--
-- Achado pelo `scripts/provar-canais.mjs`, na PRIMEIRA vez que ele rodou:
--
--   instagram/carrossel: natureza (typescript imagem / banco imagem_ou_video)
--
-- E é um defeito de verdade, vivo em produção agora. A 0045 escreveu
-- `limites_de_midia('carrossel')` com `natureza = 'imagem_ou_video'`, então
-- `registrar_midia_post` aceita anexar um vídeo a um carrossel. O adaptador
-- recusa — ele monta os filhos com `image_url` e não sabe fazer filho de
-- vídeo. Resultado: o vídeo entra, a peça agenda, e a Meta recusa na hora de
-- publicar. De madrugada, com o cliente sem receber nada.
--
-- É exatamente o erro que a 0047 (só JPEG) e a `formatos.ts` (quatro formatos,
-- um implementado) foram escritas para evitar — a quarta repetição do mesmo
-- padrão nesta semana, e a primeira que uma ferramenta pegou antes do cliente.
-- Vale anotar: as três primeiras foram descobertas por um usuário, por uma
-- auditoria de concorrente e por mim lendo código. Esta foi um prover
-- falhando. É a diferença entre ter e não ter o verificador.
--
-- ESTA NÃO É A DECISÃO FINAL. A dona pediu carrossel "com foto e vídeo, assim
-- como o Insta permite", e tem razão: metade de um recurso confunde mais que a
-- ausência dele. O caminho certo é o adaptador aprender filho de vídeo — e
-- isso exige um estado novo na máquina do worker, porque cada filho de vídeo
-- precisa terminar de processar antes de o container pai ser criado, e dormir
-- dentro de uma invocação é proibido neste projeto.
--
-- Enquanto esse estado não existe, a regra tem de dizer a verdade. Recusar o
-- vídeo NO ANEXO, com o motivo, é melhor que aceitar e falhar no post. Quando
-- o adaptador aprender, esta linha volta para `imagem_ou_video` — nos dois
-- lugares, e o prover cobra os dois.

create or replace function public.limites_de_midia(p_tipo public.tipo_post)
returns table (minimo smallint, maximo smallint, natureza text)
language sql
immutable
set search_path = public, pg_temp
as $$
  select m.minimo, m.maximo, m.natureza
    from (values
      ('imagem'::public.tipo_post,    1::smallint, 1::smallint,  'imagem'),
      -- Era 'imagem_ou_video'. Ver o cabeçalho: o adaptador só faz imagem, e
      -- a regra que mente custa um post que não sai.
      ('carrossel'::public.tipo_post, 2::smallint, 10::smallint, 'imagem'),
      ('reel'::public.tipo_post,      1::smallint, 1::smallint,  'video'),
      ('story'::public.tipo_post,     1::smallint, 1::smallint,  'imagem_ou_video')
    ) as m(tipo, minimo, maximo, natureza)
   where m.tipo = p_tipo;
$$;

revoke all on function public.limites_de_midia(public.tipo_post) from public, anon;
grant execute on function public.limites_de_midia(public.tipo_post) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- E a mensagem de recusa passa a dizer O QUE FAZER
--
-- A 0045 recusa com "Esta peca aceita foto ou video, nao %" quando a natureza
-- não casa. Para o carrossel isso agora viraria "Peca de imagem aceita foto,
-- nao video/mp4" — correto e inútil: a pessoa acabou de ver um carrossel com
-- vídeo no Instagram e vai achar que é defeito da plataforma.
--
-- Então o caso do carrossel ganha a frase que explica a limitação e diz que
-- ela é nossa, não da Meta. Mentir por omissão aqui é pior que recusar.
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
      'Por enquanto: carrossel de fotos JPG, ou um Reel para o video.';
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

  -- A Meta publica imagem so em JPEG (0047).
  if v_ehImagem and p_mime not in ('image/jpeg', 'image/jpg') then
    raise exception
      'A Meta publica imagem so em JPEG, e este arquivo e %. '
      'Exporte como JPG e anexe de novo — nao converto sozinho porque fundo '
      'transparente viraria preto sem voce ver.', p_mime;
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
