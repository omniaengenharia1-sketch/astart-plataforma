-- 0073 — apagar uma peça.
--
-- A dona: "essas peças pendentes eu nao consegui apaga".
--
-- Ela não conseguiu porque NÃO DAVA. Não existia `apagar_publicacao` no banco
-- nem botão na tela: dava para criar peça desde a 0046 e nunca para desfazer.
-- Três rascunhos sem arquivo e sem data ficaram na conta dela desde 16/11,
-- parados para sempre.
--
-- É o tipo de buraco que não aparece em teste nenhum, porque todo teste cria
-- o que precisa e nunca precisa limpar. Aparece no primeiro dia de uso real.
--
-- O QUE NÃO SE APAGA, E POR QUÊ
--
-- Peça com destino PUBLICADO não sai. O post existe no Instagram do cliente;
-- o que está aqui é o registro de que a agência o publicou, com o id da Meta,
-- a hora e o log das chamadas. Apagar isso não tira nada do ar — só cega a
-- agência sobre o que ela mesma fez.
--
-- Peça com destino PUBLICANDO também não sai, e por um motivo pior: nesse
-- estado a plataforma AINDA NÃO SABE se saiu. É o estado que existe para o
-- worker reconciliar no tick seguinte. Apagar no meio é perder a única pista
-- de um post que pode estar no ar.
--
-- Nos dois casos a mensagem diz o que fazer em vez de só recusar.
--
-- O LOG NÃO SE APAGA, E ISSO MUDOU O DESENHO
--
-- Eu escrevi esta função apagando os `publicacao_eventos` do alvo junto, para
-- contornar a chave estrangeira NO ACTION. O teste recusou:
--
--   publicacao_eventos e append-only: DELETE nao e permitido
--
-- Existe um gatilho, desde a 0004, que proíbe UPDATE e DELETE nessa tabela
-- para todo mundo. É uma garantia de auditoria deliberada, e furá-la para
-- fazer caber um botão de apagar seria trocar uma regra do sistema por uma
-- conveniência — exatamente o que este projeto evita.
--
-- Então a regra passa a ser: **peça com log de publicação não se apaga.** O
-- log só nasce quando o worker começa a trabalhar num destino, então rascunho
-- e peça agendada que nunca rodou — o caso da dona, e o caso comum — passam
-- sem encostar nisso.
--
-- E para a peça que JÁ tentou existe a outra porta, aqui embaixo: cancelar.
-- Ela para de tentar, some da fila, e o log fica inteiro. Apontar para uma
-- saída que não existe seria pior que recusar sem alternativa, então as duas
-- nascem juntas.
--
-- OS ARQUIVOS SAEM PELA TELA, como na `excluir_galeria` (0058)
--
-- A função devolve os caminhos e quem apaga do Storage é o navegador, com a
-- sessão de quem clicou. E aqui isso não é só estilo: o varredor de órfãos
-- (0062) cobre só o bucket `galerias`. Se esta função deixasse os arquivos
-- para trás, eles ficariam em `midias-posts` para sempre, sem ninguém varrer.
-- ---------------------------------------------------------------------------

create or replace function public.apagar_publicacao(p_post uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post     record;
  v_caminhos text[];
  v_estado   text;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para apagar peca.';
  end if;

  select p.id, p.titulo_interno, p.cliente_id into v_post
    from public.posts p
   where p.id = p_post
     and public.usuario_ve_cliente(p.cliente_id);

  if not found then
    raise exception 'Peca nao encontrada.';
  end if;

  -- Já publicado em ALGUM destino: não apaga, nem o destino que falhou.
  -- A peça é uma coisa só; apagar metade dela deixaria um post no ar sem
  -- registro nenhum deste lado.
  select a.estado::text into v_estado
    from public.post_alvos a
   where a.post_id = p_post and a.estado = 'publicado'
   limit 1;

  if found then
    raise exception
      'Esta peca ja foi publicada — apagar aqui nao tira o post do ar, so '
      'apaga o registro de que a agencia publicou. Se o post precisa sair, '
      'apague na conta do cliente.';
  end if;

  select a.estado::text into v_estado
    from public.post_alvos a
   where a.post_id = p_post and a.estado = 'publicando'
   limit 1;

  if found then
    raise exception
      'Esta peca esta publicando agora e ainda nao se sabe se saiu. Espere o '
      'proximo ciclo decidir, e apague depois se nao tiver ido ao ar.';
  end if;

  select array_agg(m.storage_path) into v_caminhos
    from public.post_midias m
   where m.post_id = p_post;

  -- O LOG MANDA AQUI. Ele e append-only desde a 0004, entao nem apagar nem
  -- soltar: se existe, a peca fica. A chave estrangeira NO ACTION barraria o
  -- delete de baixo de qualquer jeito — a diferenca e que assim a pessoa le
  -- um motivo em portugues em vez de "violates foreign key constraint".
  if exists (
    select 1 from public.publicacao_eventos e
      join public.post_alvos a on a.id = e.post_alvo_id
     where a.post_id = p_post
  ) then
    raise exception
      'Esta peca ja tentou publicar, e o registro dessas tentativas nao pode '
      'ser apagado — o log de publicacao e permanente de proposito. Use '
      'cancelar: ela para de tentar e sai da fila, e o historico fica.';
  end if;

  -- A IDEIA PRECISA SER SOLTA NA MAO, e isto o teste 43 me ensinou.
  --
  -- `ideias.post_id` e ON DELETE SET NULL, entao eu achei que o banco
  -- resolvia sozinho. Nao resolve: a tabela tem a restricao
  -- `ideias_uso_coerente` — `(post_id is null) = (usada_em is null)` — e o
  -- SET NULL e um UPDATE, que a restricao confere. Zerar so o `post_id`
  -- deixaria a linha com "usada em tal dia" apontando para peca nenhuma, e o
  -- delete inteiro falharia com um erro que nao fala de post nem de peca.
  --
  -- Soltar as duas colunas e o certo tambem no significado: a peca deixou de
  -- existir, entao a ideia voltou a NAO ter sido usada, e pode virar outra
  -- peca amanha.
  update public.ideias
     set post_id = null, usada_em = null
   where post_id = p_post;

  -- O cascade da 0003 leva alvos e midias.
  delete from public.posts where id = p_post;

  return jsonb_build_object(
    'titulo',   v_post.titulo_interno,
    'caminhos', coalesce(to_jsonb(v_caminhos), '[]'::jsonb)
  );
end;
$$;

comment on function public.apagar_publicacao(uuid) is
  'Apaga peca que NUNCA publicou. Devolve os caminhos no Storage para a tela '
  'apagar os arquivos — o varredor de orfaos nao cobre o bucket midias-posts.';

revoke all on function public.apagar_publicacao(uuid) from public, anon;
grant execute on function public.apagar_publicacao(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- CANCELAR — a outra porta, para a peça que já tem história
--
-- Nasce junto com a de apagar porque a de apagar manda usar esta. Recusar sem
-- oferecer saída seria o mesmo buraco com outra mensagem.
--
-- O que ela faz: para os destinos que ainda não resolveram e marca a peça
-- como cancelada. Não apaga nada — nem arquivo, nem log, nem a linha. A peça
-- continua na tela, com o que aconteceu escrito nela.
--
-- Destino já PUBLICADO não se mexe: ele é fato consumado, e reescrever o
-- estado dele aqui apagaria o id da Meta da vista de quem for conferir. Uma
-- peça que publicou num destino e falhou noutro fica `publicado_parcial`, que
-- é o estado honesto — e é por isso que o `case` abaixo olha o que sobrou em
-- vez de carimbar 'cancelado' por cima de tudo.
-- ---------------------------------------------------------------------------
create or replace function public.cancelar_publicacao(p_post uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente   uuid;
  v_parados   int;
  v_publicados int;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para cancelar peca.';
  end if;

  select p.cliente_id into v_cliente
    from public.posts p
   where p.id = p_post and public.usuario_ve_cliente(p.cliente_id);
  if not found then
    raise exception 'Peca nao encontrada.';
  end if;

  -- `publicando` fica de fora junto com `publicado`: nesse estado a resposta
  -- da Meta ainda esta em aberto, e carimbar 'cancelado' por cima faria a
  -- reconciliacao do worker perder o alvo de um post que pode estar no ar.
  update public.post_alvos
     set estado = 'cancelado',
         proxima_tentativa_em = null,
         lock_token = null,
         bloqueado_ate = null,
         atualizado_em = now()
   where post_id = p_post
     and estado not in ('publicado', 'publicando', 'cancelado');
  get diagnostics v_parados = row_count;

  select count(*) into v_publicados
    from public.post_alvos a
   where a.post_id = p_post and a.estado = 'publicado';

  update public.posts
     set status = case when v_publicados > 0 then 'publicado_parcial'::public.status_post
                       else 'cancelado'::public.status_post end,
         atualizado_em = now()
   where id = p_post;

  return jsonb_build_object('parados', v_parados, 'jaPublicados', v_publicados);
end;
$$;

comment on function public.cancelar_publicacao(uuid) is
  'Para os destinos que ainda nao resolveram e marca a peca. Nao apaga nada: '
  'e a saida para peca que ja tentou publicar, cujo log e permanente.';

revoke all on function public.cancelar_publicacao(uuid) from public, anon;
grant execute on function public.cancelar_publicacao(uuid) to authenticated, service_role;
