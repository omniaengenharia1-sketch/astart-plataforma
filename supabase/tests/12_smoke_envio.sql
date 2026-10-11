-- =============================================================================
-- Smoke do envio para aprovacao (0029). O ciclo inteiro, de ponta a ponta:
-- a equipe manda, o cliente pede ajuste, a equipe manda de novo, o cliente
-- aprova, e o lote fecha sozinho.
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
insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a','Padaria Aurora','aurora'),
  ('b0000000-0000-0000-0000-00000000000b','Bloco B','bloco-b');
insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('20000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Bruna','bruna@clientea.com.br');

insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, parcelas, inicio)
select 'a0000000-0000-0000-0000-00000000000a', s.id, 'projeto', 1200000, 3, current_date
  from public.servicos s where s.chave = 'website';
insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, parcelas, inicio)
select 'b0000000-0000-0000-0000-00000000000b', s.id, 'projeto', 900000, 2, current_date
  from public.servicos s where s.chave = 'branding';

set role authenticated;

-- ---------------------------------------------------------------------------
-- 1. o projeto nasce inteiro "a fazer"
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- operacao
do $$
declare p jsonb := public.projeto_do_cliente('a0000000-0000-0000-0000-00000000000a');
begin
  perform public.afirma(jsonb_array_length(p) = 1, 'um servico com entregaveis');
  perform public.afirma(p->0->>'servicoNome' = 'Website', 'e o site');
  perform public.afirma(jsonb_array_length(p->0->'entregaveis') = 11, 'os 11 do modelo');
  perform public.afirma(
    not exists (select 1 from jsonb_array_elements(p->0->'entregaveis') e
                 where e->>'estado' <> 'a_fazer'),
    'todos comecam em "a fazer": entregavel sem item nao comecou');
end $$;

-- ---------------------------------------------------------------------------
-- 2. o item nasce quando o trabalho comeca, e nasce uma vez so
-- ---------------------------------------------------------------------------
do $$
declare
  v_e1 uuid; v_e2 uuid; v_i1 uuid; v_i2 uuid; v_repetido uuid;
begin
  select e.id into v_e1 from public.entregaveis e
    join public.cliente_servicos cs on cs.id = e.cliente_servico_id
   where cs.cliente_id = 'a0000000-0000-0000-0000-00000000000a' and e.ordem = 1;
  select e.id into v_e2 from public.entregaveis e
    join public.cliente_servicos cs on cs.id = e.cliente_servico_id
   where cs.cliente_id = 'a0000000-0000-0000-0000-00000000000a' and e.ordem = 2;

  v_i1 := public.item_do_entregavel(v_e1);
  v_repetido := public.item_do_entregavel(v_e1);
  perform public.afirma(v_i1 = v_repetido,
    'chamar duas vezes devolve o mesmo item, nao cria um segundo');
  perform public.afirma(
    (select count(*) from public.itens_aprovacao i where i.cliente_id = 'a0000000-0000-0000-0000-00000000000a') = 1,
    'um item no banco, nao dois');
  perform public.afirma(
    (select i.estado from public.itens_aprovacao i where i.id = v_i1) = 'produzindo',
    'nasce em producao, nao esperando o cliente');

  v_i2 := public.item_do_entregavel(v_e2);

  -- 3. enviar
  declare r jsonb := public.enviar_para_aprovacao(array[v_i1, v_i2], 'Primeira leva do site.');
  begin
    perform public.afirma((r->>'enviados')::int = 2, 'dois itens enviados');
    perform public.afirma(
      (select count(*) from public.itens_aprovacao i
        where i.id in (v_i1, v_i2) and i.estado = 'em_aprovacao' and i.enviado_em is not null) = 2,
      'os dois passaram a esperar o cliente, com data');
    perform public.afirma(
      (select count(*) from public.envio_itens ei where ei.envio_id = (r->>'envioId')::uuid) = 2,
      'e os dois entraram no mesmo lote');
    perform public.afirma(
      (select e.mensagem from public.envios_aprovacao e where e.id = (r->>'envioId')::uuid)
        = 'Primeira leva do site.',
      'com o recado da equipe junto');
  end;

  -- Reenviar o que ja esta na mao do cliente nao passa.
  begin
    perform public.enviar_para_aprovacao(array[v_i1]);
    raise exception 'FALHOU: reenviou item que ja estava esperando o cliente';
  exception when others then
    if position('ja esta esperando' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- Dois clientes no mesmo envio: nao.
do $$
declare v_a uuid; v_b uuid; v_eb uuid;
begin
  select i.id into v_a from public.itens_aprovacao i
   where i.cliente_id = 'a0000000-0000-0000-0000-00000000000a' limit 1;
  select e.id into v_eb from public.entregaveis e
    join public.cliente_servicos cs on cs.id = e.cliente_servico_id
   where cs.cliente_id = 'b0000000-0000-0000-0000-00000000000b' and e.ordem = 1;
  v_b := public.item_do_entregavel(v_eb);

  begin
    perform public.enviar_para_aprovacao(array[v_a, v_b]);
    raise exception 'FALHOU: juntou dois clientes no mesmo envio';
  exception when others then
    if position('de um cliente so' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. o cliente responde, a equipe reenvia, o lote fecha
-- ---------------------------------------------------------------------------
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';   -- Bruna
do $$
declare v_i1 uuid;
begin
  -- criado_em empata dentro da mesma transacao; a ordem do entregavel nao.
  select e.item_id into v_i1 from public.entregaveis e
    join public.cliente_servicos cs on cs.id = e.cliente_servico_id
   where cs.cliente_id = 'a0000000-0000-0000-0000-00000000000a' and e.ordem = 1;
  perform public.responder_item(v_i1, 'com_ajustes', 'Bruna', 'cliente',
    'O diagnostico ficou generico demais.');
  perform public.afirma(
    (select i.estado from public.itens_aprovacao i where i.id = v_i1) = 'com_ajustes',
    'voltou com ajuste');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$
declare v_i1 uuid;
begin
  -- criado_em empata dentro da mesma transacao; a ordem do entregavel nao.
  select e.item_id into v_i1 from public.entregaveis e
    join public.cliente_servicos cs on cs.id = e.cliente_servico_id
   where cs.cliente_id = 'a0000000-0000-0000-0000-00000000000a' and e.ordem = 1;

  perform public.enviar_para_aprovacao(array[v_i1], 'Refeito com os numeros da loja.');
  perform public.afirma(
    (select i.respondido_em is null and i.respondido_por is null
       from public.itens_aprovacao i where i.id = v_i1),
    'item reenviado nao pode parecer respondido');
  perform public.afirma(
    (select i.estado from public.itens_aprovacao i where i.id = v_i1) = 'em_aprovacao',
    'voltou para a mao do cliente');
end $$;

set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$
declare v_item record; v_i1 uuid;
begin
  for v_item in
    select i.id, i.titulo from public.itens_aprovacao i
     where i.cliente_id = 'a0000000-0000-0000-0000-00000000000a' and i.estado = 'em_aprovacao'
  loop
    perform public.responder_item(v_item.id, 'aprovado', 'Bruna');
  end loop;

  perform public.afirma(
    (select count(*) from public.envios_aprovacao e
      where e.cliente_id = 'a0000000-0000-0000-0000-00000000000a' and e.fechado_em is null) = 0,
    'lote com todos os itens respondidos fecha sozinho');

  select e.item_id into v_i1 from public.entregaveis e
    join public.cliente_servicos cs on cs.id = e.cliente_servico_id
   where cs.cliente_id = 'a0000000-0000-0000-0000-00000000000a' and e.ordem = 1;
  perform public.afirma(
    (select e.estado from public.entregaveis_com_estado e where e.item_id = v_i1) = 'aprovado',
    'e a view do entregavel ja le o estado novo');
end $$;

-- Reenviar o que ja foi aprovado nao passa.
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$
declare v_i1 uuid;
begin
  select e.item_id into v_i1 from public.entregaveis e
    join public.cliente_servicos cs on cs.id = e.cliente_servico_id
   where cs.cliente_id = 'a0000000-0000-0000-0000-00000000000a' and e.ordem = 1;
  begin
    perform public.enviar_para_aprovacao(array[v_i1]);
    raise exception 'FALHOU: reenviou item ja aprovado';
  exception when others then
    if position('ja foi aprovado' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 5. quem nao produz nao envia
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000004';   -- leitura
do $$
declare v_i uuid;
begin
  select i.id into v_i from public.itens_aprovacao i
   where i.cliente_id = 'b0000000-0000-0000-0000-00000000000b' limit 1;
  begin
    perform public.enviar_para_aprovacao(array[v_i]);
    raise exception 'FALHOU: papel leitura enviou material para o cliente';
  exception when others then
    if position('nao envia material' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

set "teste.uid" = '20000000-0000-0000-0000-00000000000a';   -- cliente
do $$
declare v_i uuid;
begin
  select i.id into v_i from public.itens_aprovacao i
   where i.cliente_id = 'a0000000-0000-0000-0000-00000000000a' limit 1;
  begin
    perform public.enviar_para_aprovacao(array[v_i]);
    raise exception 'FALHOU: o cliente enviou material para ele mesmo';
  exception when others then
    if position('nao envia material' in sqlerrm) = 0 then raise; end if;
  end;

  -- E nao enxerga o projeto do vizinho.
  perform public.afirma(public.projeto_do_cliente('b0000000-0000-0000-0000-00000000000b') is null,
    'cliente nao abre o projeto de outro cliente');
  perform public.afirma(
    jsonb_array_length(public.projeto_do_cliente('a0000000-0000-0000-0000-00000000000a')) = 1,
    'mas abre o proprio');
end $$;

reset role;

do $$ begin
  perform public.afirma(
    not has_function_privilege('anon','public.enviar_para_aprovacao(uuid[],text)','execute'),
    'anon nao envia nada');
  perform public.afirma(
    not has_function_privilege('anon','public.projeto_do_cliente(uuid)','execute'),
    'anon nao le projeto');
end $$;

select 'envio: tudo passou' as resultado;
