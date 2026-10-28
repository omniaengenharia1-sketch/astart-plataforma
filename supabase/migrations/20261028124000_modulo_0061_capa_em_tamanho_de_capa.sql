-- 0061 — a capa sai do original, não da miniatura.
--
-- A dona abriu a entrega da Confraria 23/10 e disse: "a qualidade da capa tá
-- ruim". Estava mesmo, e a conta é direta:
--
--   original da foto ......... 2048 x 1365
--   o que a capa usava ....... a MINIATURA, 640 de largura
--   espaço que ela ocupa ..... 1440 na janela, 2880 numa tela retina
--
-- Ou seja: a capa era ampliada quatro vezes e meia. Nenhum redimensionador
-- inventa detalhe que não está no arquivo — pedir `width=1800` de uma imagem
-- de 640 devolve 1800 borrados.
--
-- A 0057 escolheu a miniatura porque a capa nasceu como uma faixa fina de
-- 16:7, onde 640 bastava. Depois a capa virou a tela inteira (foi o pedido:
-- "pode seguir o mesmo layout do pixieset") e ninguém voltou aqui. O defeito
-- entrou junto com a melhoria.
--
-- SOBRE EXPOR O ORIGINAL
--
-- O caminho do original de cada item continua fora desta função para a lista
-- de itens — o que a Edge Function devolve ali é miniatura. O que muda é UMA
-- foto, a capa, que a Edge Function assina com validade de uma hora, do mesmo
-- jeito que já assina o original de qualquer foto na ação `ver` (0057). Quem
-- tem o link vê a galeria; a capa é a primeira coisa que ele deveria ver, e
-- vê-la nítida não dá acesso a nada que o link já não dê.
--
-- O cartão da equipe continua na miniatura, de propósito: ali a capa aparece
-- num quadro de 4:3 com umas poucas centenas de pixels, e 640 sobra. Baixar
-- um arquivo de 900 KB para desenhar um cartão de lista seria o erro oposto.
-- ---------------------------------------------------------------------------

create or replace function public.galeria_por_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_link    public.links_galeria;
  v_galeria public.galerias;
  v_hash    text;
begin
  if length(coalesce(p_token, '')) < 16 then
    return null;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_link from public.links_galeria where token_hash = v_hash;
  if v_link.id is null or v_link.revogado_em is not null then
    return null;
  end if;

  select * into v_galeria from public.galerias where id = v_link.galeria_id;
  if v_galeria.arquivada_em is not null then
    return null;
  end if;

  update public.links_galeria
     set acessos = acessos + 1, ultimo_acesso_em = now()
   where id = v_link.id;

  return jsonb_build_object(
    'galeriaId', v_galeria.id,
    'titulo', coalesce(v_galeria.titulo, 'Galeria'),
    'recado', v_galeria.recado,
    'permiteDownload', v_galeria.permite_download,
    -- CAMINHO, não URL. Quem assina é a Edge Function, com validade curta.
    -- Caminho de bucket privado não serve para nada solto.
    --
    -- `i.caminho` e não `i.miniatura_caminho`: é a mudança desta migration.
    -- A capa ocupa a largura da tela; a miniatura tem 640 e era ampliada.
    'capa', (select i.caminho
               from public.galeria_itens i
              where i.id = v_galeria.capa_item_id
                and i.galeria_id = v_galeria.id
                and i.pronto),
    'capaItemId', v_galeria.capa_item_id,
    'cliente', (select c.nome from public.clientes c
                  join public.sessoes_captacao s on s.cliente_id = c.id
                 where s.id = v_galeria.sessao_id),
    'quando', (select s.data from public.sessoes_captacao s where s.id = v_galeria.sessao_id),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'tipo', i.tipo,
        'nome', i.nome,
        'caminho', i.caminho,
        'miniatura', i.miniatura_caminho,
        'poster', i.poster_caminho,
        'largura', i.largura,
        'altura', i.altura,
        'duracao', i.duracao_s,
        'bytes', i.tamanho_bytes)
        order by i.ordem)
      from public.galeria_itens i
     where i.galeria_id = v_galeria.id and i.pronto), '[]'::jsonb),
    'favoritos', coalesce((
      select jsonb_agg(f.item_id) from public.galeria_favoritos f
       where f.galeria_id = v_galeria.id), '[]'::jsonb)
  );
end;
$$;

-- As permissões não mudam, mas `create or replace` não as perde — então isto é
-- cinto e suspensório contra um futuro `drop function` seguido de recriação.
revoke all on function public.galeria_por_token(text) from public, anon, authenticated;
grant execute on function public.galeria_por_token(text) to service_role;
