-- =============================================================================
-- Smoke da 0069 — mudar a ordem dos arquivos do carrossel.
--
-- Pedido da dona: "falta eu poder movimentar o carrossel, tipo: colocar uma
-- imagem em segundo outra em terceiro".
--
-- O que tem de valer:
--   1. mover para o meio reposiciona os DOIS lados — nao basta a peca movida
--      chegar no lugar certo, quem estava la tem de ter andado;
--   2. mover para o fim e para o comeco, que sao as pontas onde aritmetica de
--      lista costuma errar por um;
--   3. destino fora da faixa e PRESO, nao recusado — a tela manda "um para
--      tras" no primeiro o tempo todo;
--   4. a ordem fica DENSA (0,1,2...), inclusive depois de remover, que deixa
--      buraco de proposito;
--   5. peca no ar NAO muda de ordem — o carrossel ja esta na conta do cliente;
--   6. quem nao ve o cliente nao mexe, e a mensagem nao revela que a peca
--      existe.
--
-- O 1 e o motivo deste arquivo. `unique (post_id, ordem)` nao e deferrable, e
-- renumerar sem tirar todo mundo do caminho primeiro esbarra na restricao no
-- meio do caminho. Um teste que so conferisse "a movida chegou na posicao 1"
-- passaria com a lista inteira errada atras dela.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'direcao@astartstudio.com.br'),
  ('30000000-0000-0000-0000-000000000003', 'cliente@vizinho.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Direcao', 'admin', true, 'direcao@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('20000000-0000-0000-0000-000000000001', 'Mor', 'mor', 'America/Sao_Paulo'),
  ('20000000-0000-0000-0000-000000000002', 'Vizinho', 'vizinho', 'America/Sao_Paulo');

insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select c.id, s.id, 'recorrente', 100000, 10, current_date
  from public.clientes c, public.servicos s
 where s.nome = 'Gestão Digital' and c.slug in ('mor', 'vizinho');

insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','Vizinho','cliente@vizinho.com.br');

-- ---------------------------------------------------------------------------
-- Um carrossel da Mor com quatro arquivos, como ela acabou de subir
-- ---------------------------------------------------------------------------
do $$
declare
  v_post uuid;
  v_ids  uuid[];
  v_n    int;
  ok     boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  v_post := (public.criar_publicacao(
    '20000000-0000-0000-0000-000000000001', 'Carrossel da Mor', 'carrossel')->>'id')::uuid;

  for i in 1..4 loop
    perform public.registrar_midia_post(
      v_post,
      '20000000-0000-0000-0000-000000000001/' || v_post || '/foto-' || i || '.jpg',
      'image/jpeg');
  end loop;

  select array_agg(m.id order by m.ordem) into v_ids
    from public.post_midias m where m.post_id = v_post;
  perform public.afirma(array_length(v_ids, 1) = 4, 'o carrossel entrou com quatro arquivos');

  -- -------------------------------------------------------------------------
  -- 1. O PEDIDO AO PE DA LETRA: o quarto vira o segundo.
  --
  -- E o que ela descreveu: "colocar uma imagem em segundo". Confere a LISTA
  -- INTEIRA, nao so o que foi movido: quem estava no 2 tem de ter andado para
  -- o 3, e quem estava no 3, para o 4.
  -- -------------------------------------------------------------------------
  perform public.mover_midia_do_post(v_ids[4], 1::smallint);

  perform public.afirma(
    (select array_agg(m.id order by m.ordem) from public.post_midias m where m.post_id = v_post)
      = array[v_ids[1], v_ids[4], v_ids[2], v_ids[3]],
    'o quarto vira segundo E os outros andam junto — nao basta a movida chegar');

  -- 4. A ordem fica densa, 0..n-1.
  perform public.afirma(
    (select array_agg(m.ordem order by m.ordem) from public.post_midias m where m.post_id = v_post)
      = array[0, 1, 2, 3]::smallint[],
    'as posicoes ficam densas, sem buraco');

  -- -------------------------------------------------------------------------
  -- 2. As pontas.
  -- -------------------------------------------------------------------------
  perform public.mover_midia_do_post(v_ids[1], 3::smallint);   -- o primeiro vai ao fim
  perform public.afirma(
    (select array_agg(m.id order by m.ordem) from public.post_midias m where m.post_id = v_post)
      = array[v_ids[4], v_ids[2], v_ids[3], v_ids[1]],
    'mover para o fim poe no fim, e nao um antes');

  perform public.mover_midia_do_post(v_ids[3], 0::smallint);   -- e outro para a capa
  perform public.afirma(
    (select array_agg(m.id order by m.ordem) from public.post_midias m where m.post_id = v_post)
      = array[v_ids[3], v_ids[4], v_ids[2], v_ids[1]],
    'mover para o comeco poe na capa — que no feed e a imagem do post');

  -- -------------------------------------------------------------------------
  -- 3. Destino fora da faixa e preso, nao recusado.
  -- -------------------------------------------------------------------------
  perform public.mover_midia_do_post(v_ids[3], -5::smallint);
  perform public.afirma(
    (select m.ordem from public.post_midias m where m.id = v_ids[3]) = 0,
    'destino antes do comeco fica no comeco, sem erro na cara de quem clicou');

  perform public.mover_midia_do_post(v_ids[3], 99::smallint);
  perform public.afirma(
    (select m.ordem from public.post_midias m where m.id = v_ids[3]) = 3,
    'e destino depois do fim fica no fim');

  -- -------------------------------------------------------------------------
  -- 4b. Densa TAMBEM depois de remover, que deixa buraco de proposito.
  -- -------------------------------------------------------------------------
  perform public.remover_midia_post(v_ids[4]);
  select count(*) into v_n from public.post_midias where post_id = v_post;
  perform public.afirma(v_n = 3, 'sobraram tres');

  -- Qualquer movimento renumera o que sobrou.
  select array_agg(m.id order by m.ordem) into v_ids
    from public.post_midias m where m.post_id = v_post;
  perform public.mover_midia_do_post(v_ids[1], 1::smallint);
  perform public.afirma(
    (select array_agg(m.ordem order by m.ordem) from public.post_midias m where m.post_id = v_post)
      = array[0, 1, 2]::smallint[],
    'mover fecha o buraco que o remover deixou');

  -- -------------------------------------------------------------------------
  -- 5. Peca no ar nao muda de ordem.
  -- -------------------------------------------------------------------------
  update public.posts set status = 'publicado' where id = v_post;
  begin
    perform public.mover_midia_do_post(v_ids[1], 0::smallint);
    ok := false;
  exception when others then
    ok := position('nao muda' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'peca no ar recusa mudanca de ordem — o carrossel ja esta na conta do cliente');
  update public.posts set status = 'rascunho' where id = v_post;

  -- -------------------------------------------------------------------------
  -- 6. Quem nao ve o cliente nao mexe.
  -- -------------------------------------------------------------------------
  perform set_config('teste.uid', '30000000-0000-0000-0000-000000000003', false);
  begin
    perform public.mover_midia_do_post(v_ids[1], 0::smallint);
    ok := false;
  exception when others then
    -- "nao encontrado", e nao "sem permissao": quem nao ve o cliente nao pode
    -- nem descobrir que a peca existe.
    ok := position('nao encontrado' in sqlerrm) > 0
       or position('permissao' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'cliente de outro cliente nao mexe na ordem da Mor');
end $$;
