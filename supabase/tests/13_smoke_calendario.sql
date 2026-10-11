-- =============================================================================
-- Smoke do calendario (0030). O que este teste cobra de verdade e o fuso:
-- a peca das 23h de um cliente no Acre tem de cair no dia dela, no mes dela,
-- independentemente de quem esta olhando. Data e a coisa mais facil de errar
-- em silencio num sistema assim.
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
  ('10000000-0000-0000-0000-000000000004', 'estagio@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000002','Layana', 'operacao','layana@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000004','Estágio','leitura', 'estagio@astartstudio.com.br');

-- Um cliente no Acre (UTC-5) de proposito: se a conversao estiver errada, a
-- peca das 23h aparece no dia seguinte.
insert into public.clientes (id, nome, slug, fuso_horario) values
  ('a0000000-0000-0000-0000-00000000000a','Sorveteria do Acre','acre','America/Rio_Branco'),
  ('b0000000-0000-0000-0000-00000000000b','Outro Cliente','outro','America/Sao_Paulo');
insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('20000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Bruna','bruna@clientea.com.br');

insert into public.cliente_servicos (id, cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select 'c5000000-0000-0000-0000-00000000000d','a0000000-0000-0000-0000-00000000000a',
       s.id,'recorrente',280000,10,date '2026-11-01'
  from public.servicos s where s.chave='gestao_digital';
insert into public.planos_conteudo (cliente_servico_id, dias_semana, horario, posts_por_mes, reels_por_mes)
values ('c5000000-0000-0000-0000-00000000000d', array[1,3,5]::smallint[], time '19:00', 8, 2);

set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- operacao

-- ---------------------------------------------------------------------------
-- 1. a peca cai no dia certo, mesmo na virada
-- ---------------------------------------------------------------------------
do $$
declare
  r1 jsonb; r2 jsonb;
  cal jsonb;
  ultima jsonb;
begin
  r1 := public.criar_peca('a0000000-0000-0000-0000-00000000000a',
          'Sabor do mes', 'imagem', date '2026-11-04', time '19:00');
  -- 23h do ultimo dia do mes: o caso que vira o mes se a conversao escorregar.
  r2 := public.criar_peca('a0000000-0000-0000-0000-00000000000a',
          'Virada do mes', 'reel', date '2026-11-30', time '23:00');

  cal := public.calendario_do_cliente('a0000000-0000-0000-0000-00000000000a', date '2026-11-01');

  perform public.afirma(cal->>'fusoHorario' = 'America/Rio_Branco', 'o fuso do cliente vem junto');
  perform public.afirma((cal->>'noMes')::int = 2, 'as duas pecas estao em novembro');

  select x into ultima from jsonb_array_elements(cal->'pecas') x where x->>'titulo' = 'Virada do mes';
  perform public.afirma(ultima->>'dia' = '2026-11-30',
    'a peca das 23h do dia 30 fica no dia 30 — e nao vaza para dezembro');
  perform public.afirma(ultima->>'hora' = '23:00', 'e na hora que foi marcada');
  perform public.afirma(ultima->>'tipo' = 'reel', 'com o tipo certo');

  -- E dezembro nao herda nada.
  perform public.afirma(
    (public.calendario_do_cliente('a0000000-0000-0000-0000-00000000000a', date '2026-12-01')->>'noMes')::int = 0,
    'dezembro esta vazio');

  -- O plano do contrato aparece para a tela saber a cota.
  perform public.afirma((cal->'plano'->>'cota')::int = 10, 'a cota do mes e 10');
  perform public.afirma(cal->'plano'->>'horario' = '19:00', 'com o horario padrao do plano');
end $$;

-- ---------------------------------------------------------------------------
-- 2. estado de aprovacao e estado de publicacao sao dois eixos
-- ---------------------------------------------------------------------------
do $$
declare
  v_post uuid; v_item uuid; cal jsonb; peca jsonb;
begin
  select p.id, p.item_id into v_post, v_item
    from public.posts p where p.titulo_interno = 'Sabor do mes';
  perform public.afirma(v_item is not null,
    'o item de aprovacao nasce junto com a peca, pelo gatilho da 0019');

  cal := public.calendario_do_cliente('a0000000-0000-0000-0000-00000000000a', date '2026-11-01');
  select x into peca from jsonb_array_elements(cal->'pecas') x where x->>'titulo' = 'Sabor do mes';
  perform public.afirma(peca->>'estadoAprovacao' = 'produzindo', 'comeca em producao');
  perform public.afirma(peca->>'statusPublicacao' = 'rascunho', 'e como rascunho');

  perform public.enviar_para_aprovacao(array[v_item], 'Olha o sabor de novembro.');

  cal := public.calendario_do_cliente('a0000000-0000-0000-0000-00000000000a', date '2026-11-01');
  select x into peca from jsonb_array_elements(cal->'pecas') x where x->>'titulo' = 'Sabor do mes';
  perform public.afirma(peca->>'estadoAprovacao' = 'em_aprovacao', 'passou a esperar o cliente');
  perform public.afirma(peca->>'statusPublicacao' = 'aguardando_aprovacao',
    'e o espelho de mao unica levou o post junto');
  perform public.afirma((cal->>'esperandoCliente')::int = 1, 'o contador bate');
end $$;

-- ---------------------------------------------------------------------------
-- 3. mover
-- ---------------------------------------------------------------------------
do $$
declare v_post uuid; cal jsonb; peca jsonb;
begin
  select p.id into v_post from public.posts p where p.titulo_interno = 'Sabor do mes';
  perform public.mover_peca(v_post, date '2026-11-06');

  cal := public.calendario_do_cliente('a0000000-0000-0000-0000-00000000000a', date '2026-11-01');
  select x into peca from jsonb_array_elements(cal->'pecas') x where x->>'titulo' = 'Sabor do mes';
  perform public.afirma(peca->>'dia' = '2026-11-06', 'mudou de dia');
  perform public.afirma(peca->>'hora' = '19:00', 'e manteve a hora de antes');

  -- Peca publicada nao se mexe.
  update public.posts set status = 'publicado' where id = v_post;
  begin
    perform public.mover_peca(v_post, date '2026-11-09');
    raise exception 'FALHOU: mexeu na data de peca ja publicada';
  exception when others then
    if position('ja saiu' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. quem ve o que
-- ---------------------------------------------------------------------------
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';   -- cliente
do $$ begin
  perform public.afirma(
    (public.calendario_do_cliente('a0000000-0000-0000-0000-00000000000a', date '2026-11-01')->>'noMes')::int = 2,
    'o cliente ve o proprio mes');
  perform public.afirma(
    public.calendario_do_cliente('b0000000-0000-0000-0000-00000000000b', date '2026-11-01') is null,
    'e nao ve o mes de outro cliente');
  begin
    perform public.criar_peca('a0000000-0000-0000-0000-00000000000a',
      'Peca do cliente', 'imagem', date '2026-11-10');
    raise exception 'FALHOU: o cliente criou peca';
  exception when insufficient_privilege then null;
  when others then
    if position('row-level security' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000004';   -- leitura
do $$ begin
  perform public.afirma(
    (public.calendario_do_cliente('a0000000-0000-0000-0000-00000000000a', date '2026-11-01')->>'noMes')::int = 2,
    'quem so le, le o calendario');
  begin
    perform public.criar_peca('a0000000-0000-0000-0000-00000000000a',
      'Peca da leitura', 'imagem', date '2026-11-10');
    raise exception 'FALHOU: papel leitura criou peca';
  exception when insufficient_privilege then null;
  when others then
    if position('row-level security' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- Peca sem nome interno nao entra.
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$ begin
  begin
    perform public.criar_peca('a0000000-0000-0000-0000-00000000000a', '   ', 'imagem', date '2026-11-10');
    raise exception 'FALHOU: criou peca sem nome';
  exception when others then
    if position('nome interno' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

reset role;

do $$ begin
  perform public.afirma(
    not has_function_privilege('anon','public.calendario_do_cliente(uuid,date)','execute'),
    'anon nao le calendario');
  perform public.afirma(
    not has_function_privilege('anon','public.criar_peca(uuid,text,public.tipo_post,date,time,text)','execute'),
    'anon nao cria peca');
end $$;

select 'calendario: tudo passou' as resultado;
