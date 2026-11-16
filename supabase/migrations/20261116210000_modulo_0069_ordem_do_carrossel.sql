-- 0069 — mudar a ordem dos arquivos do carrossel.
--
-- A dona, depois de subir um carrossel da Mor: "falta eu poder movimentar o
-- carrossel, tipo: colocar uma imagem em segundo outra em terceiro".
--
-- Ate agora a ordem era a ordem em que os arquivos subiram, e nao havia como
-- mudar sem tirar tudo e subir de novo na ordem certa. Num carrossel a ordem
-- E o conteudo: a primeira imagem e a capa do post no feed, e a sequencia e a
-- narrativa. Errar a ordem e refazer o post.
--
-- POR QUE UMA FUNCAO, E NAO UM UPDATE DA TELA
--
--   1. `unique (post_id, ordem)` NAO E DEFERRABLE (0003). Trocar duas linhas
--      num UPDATE so esbarra na restricao no meio do caminho — a posicao de
--      destino ainda esta ocupada quando a origem tenta assumi-la. Por isso
--      aqui a renumeracao e em DUAS FASES: todo mundo sai do caminho (+1000) e
--      so depois assume a posicao final. Foi exatamente este tipo de aritmetica
--      que me mordeu na `mover_tarefa` da 0065.
--
--   2. A TELA NAO DECIDE PERMISSAO. Quem edita, quem ve o cliente e se a peca
--      ainda pode mudar sao perguntas do banco, como em toda a familia
--      `*_midia_post`.
--
-- DE QUEBRA, FECHA OS BURACOS DE POSICAO
--
-- `remover_midia_post` apaga a linha e nao renumera: tirar o primeiro de tres
-- deixa as posicoes 1 e 2, sem 0. A `registrar_midia_post` conta com isso —
-- ela preenche o menor buraco. Nao e defeito, mas deixa a numeracao estranha
-- de ler. Esta funcao renumera denso (0..n-1) sempre que roda, entao a ordem
-- volta a ser 1, 2, 3 na tela assim que alguem mexe nela.
-- ---------------------------------------------------------------------------
create or replace function public.mover_midia_do_post(p_midia uuid, p_para smallint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post_id uuid;
  v_post    public.posts%rowtype;
  v_ids     uuid[];
  v_n       int;
  v_de      int;
  v_para    int;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para mudar a ordem dos arquivos.';
  end if;

  select m.post_id into v_post_id from public.post_midias m where m.id = p_midia;
  if v_post_id is null then
    raise exception 'Arquivo % nao encontrado.', p_midia;
  end if;

  select * into v_post from public.posts p where p.id = v_post_id;
  -- "Nao encontrado" e nao "sem permissao", de proposito: quem nao ve o
  -- cliente nao pode nem descobrir que a peca existe.
  if not found or not public.usuario_ve_cliente(v_post.cliente_id) then
    raise exception 'Arquivo % nao encontrado.', p_midia;
  end if;

  -- Peca no ar e historico. A mesma regra de anexar e de tirar: o que foi
  -- publicado nao muda, nem na ordem — o carrossel que esta na conta do
  -- cliente tem uma ordem, e o banco nao pode discordar dela.
  if v_post.status in ('publicando', 'publicado', 'publicado_parcial') then
    raise exception
      'Esta peca esta em % — a ordem do que foi publicado nao muda. '
      'Duplique a peca se quiser outra ordem.',
      v_post.status;
  end if;

  select array_agg(m.id order by m.ordem) into v_ids
    from public.post_midias m where m.post_id = v_post_id;

  v_n  := coalesce(array_length(v_ids, 1), 0);
  v_de := array_position(v_ids, p_midia);

  -- O destino e PRESO na faixa em vez de recusado: a tela manda "um para
  -- tras" no primeiro arquivo o tempo todo, e isso nao e erro de ninguem —
  -- e so nao ter para onde ir.
  v_para := least(greatest(p_para::int + 1, 1), v_n);

  if v_n < 2 or v_de = v_para then
    return jsonb_build_object('mudou', false, 'quantas', v_n);
  end if;

  -- Tira da posicao atual e poe na nova. As fatias vazias (`v_ids[1:0]`)
  -- devolvem array vazio, entao as pontas nao precisam de caso especial.
  v_ids := v_ids[1:v_de - 1] || v_ids[v_de + 1:v_n];
  v_ids := v_ids[1:v_para - 1] || p_midia || v_ids[v_para:array_length(v_ids, 1)];

  -- FASE 1: todo mundo sai do caminho. Sem isto, a restricao unica reclama no
  -- meio da renumeracao. +1000 cabe no smallint com folga — o carrossel maior
  -- que a Meta aceita tem 10 arquivos.
  update public.post_midias set ordem = ordem + 1000 where post_id = v_post_id;

  -- FASE 2: cada um assume a posicao final, denso, de 0 a n-1.
  for i in 1..v_n loop
    update public.post_midias set ordem = (i - 1)::smallint where id = v_ids[i];
  end loop;

  return jsonb_build_object('mudou', true, 'quantas', v_n);
end;
$$;

revoke all on function public.mover_midia_do_post(uuid, smallint) from public, anon;
grant execute on function public.mover_midia_do_post(uuid, smallint) to authenticated, service_role;
