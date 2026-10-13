-- 0047 — imagem só JPEG, porque é o que a Meta aceita.
--
-- Veio de uma auditoria do mLabs que a dona mandou, e é o melhor tipo de
-- achado: a documentação da Meta diz que a API de publicação do Instagram
-- aceita **só JPEG** para imagem — nem PNG, nem WebP, nem as variantes MPO e
-- JPS do próprio JPEG.
--
-- A 0045 aceitava qualquer `image/*`. Então um PNG entrava bonito na peça,
-- aparecia na tela, agendava — e a Meta recusava na hora de publicar, de
-- madrugada, com o cliente sem receber nada. É exatamente o erro que a 0045
-- foi escrita para evitar, e eu o deixei passar no formato do arquivo.
--
-- Por que não converter PNG para JPEG sozinho: porque conversão silenciosa
-- muda o que a pessoa viu. Fundo transparente vira preto ou branco sem avisar,
-- e ela descobre no feed do cliente. Melhor recusar e dizer o que fazer.
--
-- Quando o adaptador do Facebook existir, isto vira regra por PLATAFORMA: o
-- Facebook aceita PNG. Hoje todo post publicado vai para o Instagram, porque
-- é o único adaptador implementado, então a regra vale para todos.

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

  if v_lim.natureza = 'imagem' and not v_ehImagem then
    raise exception 'Peca de imagem aceita foto, nao %.', p_mime;
  end if;
  if v_lim.natureza = 'video' and not v_ehVideo then
    raise exception 'Reel aceita video, nao %.', p_mime;
  end if;
  if v_lim.natureza = 'imagem_ou_video' and not (v_ehImagem or v_ehVideo) then
    raise exception 'Esta peca aceita foto ou video, nao %.', p_mime;
  end if;

  -- A regra nova: imagem tem de ser JPEG.
  --
  -- A mensagem diz O QUE FAZER, nao so o que esta errado. "Formato invalido"
  -- faria a pessoa procurar no Google; "exporte como JPG" ela resolve em dez
  -- segundos no proprio editor onde fez a arte.
  if v_ehImagem and p_mime not in ('image/jpeg', 'image/jpg') then
    raise exception
      'A Meta publica imagem so em JPEG, e este arquivo e %. '
      'Exporte como JPG e anexe de novo — nao converto sozinho porque fundo '
      'transparente viraria preto sem voce ver.',
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
