-- =============================================================================
-- 0089 — tirar UMA foto da galeria
--
-- A dona: "conseguir apagar foto das galerias, as vezes mando foto errada".
--
-- Até agora a galeria tinha dois botões destrutivos e nenhum deles servia para
-- isso: `arquivar_galeria` tira a entrega inteira do ar, e `excluir_galeria`
-- apaga a entrega inteira. Mandar uma foto errada num ensaio de 60 significava
-- refazer a galeria inteira, ou deixar a foto lá.
--
-- POR QUE UMA FUNÇÃO, SE O RLS JÁ DEIXA APAGAR A LINHA
--
-- A política `galeria_itens_escreve` é `for all` com `usuario_edita()`, então
-- um `delete` direto pelo PostgREST já funcionaria. Não serve, por um motivo
-- concreto e já pago: o ARQUIVO ficaria no balde.
--
-- Foi assim que 175 MB — 60% do balde da Astart — viraram lixo invisível em
-- outubro, de uma galeria apagada cujos arquivos ninguém removeu. A linha some
-- da tela, o arquivo continua ocupando espaço, e nada em lugar nenhum diz
-- isso. Esta função devolve os CAMINHOS para quem chamou apagar do balde, do
-- mesmo jeito que `excluir_galeria` faz desde a 0058.
--
-- Três caminhos por item, não um: o original, a miniatura e o pôster do vídeo.
-- Apagar só o original deixaria dois arquivos órfãos por foto.
--
-- A CAPA
--
-- Se a foto removida era a capa, `galerias.capa_item_id` vira nulo pela própria
-- chave estrangeira (`on delete set null`) e a página passa a mostrar a
-- primeira foto — que é o que ela já faz quando nunca se escolheu capa. Não
-- promovo outra automaticamente: capa é escolha, e escolher no lugar dela
-- calado seria decidir por ela. A função AVISA que era a capa, e a tela diz.
--
-- O QUE VAI JUNTO, e foi conferido e não suposto: `galeria_favoritos` cai por
-- cascade (o coração do cliente numa foto que não existe mais não quer dizer
-- nada) e `galeria_downloads.item_id` vira nulo, preservando o registro de que
-- houve download — baixar aconteceu, e apagar a foto depois não desfaz isso.
-- Nenhuma das três tabelas tem gatilho append-only, conferido antes de
-- escrever: foi exatamente esse par (`on delete set null` + append-only) que
-- travou o apagar da cobrança na 0085.
-- =============================================================================

create or replace function public.remover_item_galeria(p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_galeria   uuid;
  v_nome      text;
  v_tipo      public.tipo_midia_captacao;
  v_era_capa  boolean;
  v_caminhos  text[];
  v_sobram    int;
begin
  -- Quem edita. O cliente NUNCA: ele recebeu um link para ver e escolher, e
  -- apagar o trabalho dele não é uma das duas coisas.
  if not public.usuario_edita() then
    raise exception 'Seu acesso não tira foto de galeria.';
  end if;

  select i.galeria_id, i.nome, i.tipo, (g.capa_item_id = i.id)
    into v_galeria, v_nome, v_tipo, v_era_capa
    from public.galeria_itens i
    join public.galerias g on g.id = i.galeria_id
   where i.id = p_item;

  if v_galeria is null then
    raise exception 'Esta foto não existe mais. Recarregue a galeria.';
  end if;

  -- Os três arquivos desta foto, antes de a linha sumir: depois do `delete`
  -- não há mais de onde tirar os caminhos.
  select array_agg(c)
    into v_caminhos
    from unnest(array[
      (select i.caminho          from public.galeria_itens i where i.id = p_item),
      (select i.miniatura_caminho from public.galeria_itens i where i.id = p_item),
      (select i.poster_caminho    from public.galeria_itens i where i.id = p_item)
    ]) as c
   where c is not null;

  delete from public.galeria_itens where id = p_item;

  select count(*) into v_sobram
    from public.galeria_itens where galeria_id = v_galeria;

  return jsonb_build_object(
    'galeriaId', v_galeria,
    'nome',      v_nome,
    'tipo',      v_tipo,
    'eraCapa',   coalesce(v_era_capa, false),
    'sobram',    v_sobram,
    'caminhos',  coalesce(to_jsonb(v_caminhos), '[]'::jsonb));
end;
$$;

revoke all on function public.remover_item_galeria(uuid) from public, anon;
grant execute on function public.remover_item_galeria(uuid) to authenticated, service_role;

comment on function public.remover_item_galeria(uuid) is
  'Tira uma foto da galeria e devolve os caminhos dos arquivos dela, para quem '
  'chamou apagar do balde. Sem isso o arquivo fica orfao ocupando espaco.';
