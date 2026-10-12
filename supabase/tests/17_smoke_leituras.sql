-- =============================================================================
-- Smoke das leituras da 0036. A pergunta aqui nao e se o numero bate (bate),
-- e QUEM recebe o numero: tela de modulo nao contratado tem de voltar nula,
-- igual tela de outro cliente.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000002','layana@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003','camila@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a','bruna@clientea.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000002','Layana','operacao','layana@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003','Camila','financeiro','camila@astartstudio.com.br');
insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a','Padaria Aurora','aurora'),
  ('b0000000-0000-0000-0000-00000000000b','Bloco B','bloco-b');
insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('20000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Bruna','bruna@clientea.com.br');

-- A Aurora tem Gestao Digital (grid sim, campanhas NAO: opcional nao marcada).
insert into public.cliente_servicos (id, cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select 'c5000000-0000-0000-0000-00000000000d','a0000000-0000-0000-0000-00000000000a',
       s.id,'recorrente',280000,10,current_date from public.servicos s where s.chave='gestao_digital';

insert into public.lancamentos (descricao, subcategoria_id, cliente_id, valor_centavos, competencia, vencimento)
select 'Gestão Digital — outubro', sub.id, 'a0000000-0000-0000-0000-00000000000a',
       280000, date_trunc('month', current_date)::date, current_date - 3
  from public.financeiro_subcategorias sub
  join public.financeiro_categorias cat on cat.id = sub.categoria_id
  join public.financeiro_grupos g on g.id = cat.grupo_id
 where g.chave='receita' and cat.nome='Contrato' and sub.nome='Recorrente';

insert into public.lancamentos (descricao, subcategoria_id, valor_centavos, competencia, vencimento)
select 'Assinatura de banco de imagens', sub.id, 9900,
       date_trunc('month', current_date)::date, current_date + 5
  from public.financeiro_subcategorias sub
  join public.financeiro_categorias cat on cat.id = sub.categoria_id
  join public.financeiro_grupos g on g.id = cat.grupo_id
 where g.chave <> 'receita' limit 1;

insert into public.contas_sociais (id, cliente_id, plataforma, nome_exibicao, ig_user_id)
values ('f0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a',
        'instagram','@aurora','ig-1');
insert into public.posts (id, cliente_id, titulo_interno, tipo, status, agendado_para)
values ('f1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a',
        'Pão da semana','imagem','falhou', now() + interval '2 hours'),
       ('f1000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a',
        'Bastidores','reel','agendado', now() + interval '1 day');
insert into public.post_alvos (post_id, conta_social_id, estado, erro_mensagem, tentativas)
values ('f1000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',
        'falhou','O token do Instagram venceu.', 3);

insert into public.nps_pesquisas (id, cliente_id, competencia, enviada_em)
values ('d3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a',
        date_trunc('month', current_date)::date, now());
insert into public.nps_respostas (pesquisa_id, nota, comentario, autor_nome)
values ('d3000000-0000-0000-0000-000000000001', 10, 'Time sensacional.', 'Bruna');

insert into public.leads (nome, empresa, etapa, valor_estimado_centavos, proximo_passo)
values ('Marina', 'Café Central', 'proposta_enviada', 450000, 'Ligar na quinta'),
       ('Joana', 'Studio J', 'fechado', 300000, null);

set role authenticated;

-- ---------------------------------------------------------------------------
-- 1. financeiro: o que cada papel enxerga ja vem do RLS
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000003';   -- financeiro
do $$
declare f jsonb := public.painel_financeiro();
begin
  perform public.afirma((f->>'receitaCentavos')::bigint = 280000, 'a receita do mes');
  perform public.afirma((f->>'custoCentavos')::bigint = 9900, 'e o custo do mes');
  perform public.afirma((f->>'atrasadoCentavos')::bigint = 280000, 'a cobranca vencida entra em atrasado');
  perform public.afirma(jsonb_array_length(f->'porCliente') = 1, 'e a quebra por cliente');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- operacao
do $$
declare f jsonb := public.painel_financeiro();
begin
  perform public.afirma((f->>'receitaCentavos')::bigint = 0,
    'operacao nao ve dinheiro nenhum — e o RLS, nao um if na funcao');
end $$;

-- ---------------------------------------------------------------------------
-- 2. fila de publicacao e agenda
-- ---------------------------------------------------------------------------
do $$
declare
  fila jsonb := public.fila_publicacao();
  -- A janela comeca antes de hoje de proposito: a cobranca de exemplo venceu
  -- ha tres dias, e a agenda e uma janela de datas, nao uma lista do futuro.
  ag   jsonb := public.agenda(current_date - 5, current_date + 7);
begin
  perform public.afirma(jsonb_array_length(fila) = 2, 'as duas pecas na fila');
  perform public.afirma(fila->0->>'status' = 'falhou', 'a que falhou vem primeiro');
  perform public.afirma(fila->0->'alvos'->0->>'erro' = 'O token do Instagram venceu.',
    'com o erro da conta, que e o que resolve');
  perform public.afirma((fila->0->'alvos'->0->>'tentativas')::int = 3, 'e quantas tentativas');

  perform public.afirma(
    exists (select 1 from jsonb_array_elements(ag) x where x->>'tipo' = 'publicacao'),
    'a agenda traz publicacao');
  -- A agenda e SECURITY INVOKER: a operacao nao enxerga lancamento, entao
  -- cobranca simplesmente nao existe na agenda dela. Nao ha if nenhum aqui.
  perform public.afirma(
    not exists (select 1 from jsonb_array_elements(ag) x where x->>'tipo' = 'cobranca'),
    'e NAO traz cobranca para quem nao ve dinheiro');
end $$;

-- A mesma agenda, para quem cuida do dinheiro.
set "teste.uid" = '10000000-0000-0000-0000-000000000003';
do $$
declare ag jsonb := public.agenda(current_date - 5, current_date + 7);
begin
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(ag) x where x->>'tipo' = 'cobranca'),
    'o financeiro ve a cobranca na agenda');
end $$;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------------------
-- 3. NPS e funil
-- ---------------------------------------------------------------------------
do $$
declare n jsonb := public.nps_resumo(); f jsonb := public.funil();
begin
  perform public.afirma((n->>'promotores')::int = 1 and (n->>'nps')::int = 100, 'o NPS do mes');
  perform public.afirma((f->>'abertos')::int = 1, 'um lead em aberto');
  perform public.afirma((f->>'valorAbertoCentavos')::bigint = 450000, 'com o valor dele');
  perform public.afirma((f->>'fechadosNoMes')::int = 0,
    'e o fechado so conta quando convertido_em for preenchido');
end $$;

-- ---------------------------------------------------------------------------
-- 4. o cliente: ve o seu, nao ve o que nao contratou
-- ---------------------------------------------------------------------------
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$
declare fin jsonb := public.financeiro_do_cliente('a0000000-0000-0000-0000-00000000000a');
begin
  perform public.afirma(jsonb_array_length(fin->'lancamentos') = 1,
    'a cliente ve a propria cobranca');
  perform public.afirma((fin->>'atrasadoCentavos')::bigint = 280000, 'com o valor certo');
  perform public.afirma(
    not exists (select 1 from jsonb_array_elements(fin->'lancamentos') x
                 where x->>'descricao' like 'Assinatura%'),
    'e nao ve o custo da agencia');

  perform public.afirma(public.financeiro_do_cliente('b0000000-0000-0000-0000-00000000000b') is null,
    'nem a conta do vizinho');
  perform public.afirma(public.painel_financeiro() is null, 'nem o painel da equipe');
  perform public.afirma(public.fila_publicacao() is null, 'nem a fila de publicacao');
  perform public.afirma(public.agenda() is null, 'nem a agenda');
  perform public.afirma(public.funil() is null, 'nem o comercial');

  -- Contratou Gestao Digital: grid sim.
  perform public.afirma(public.grid_do_cliente('a0000000-0000-0000-0000-00000000000a') is not null,
    'grid vem com a Gestao Digital');
  -- Campanhas e opcional e nao foi marcada: a tela nao existe para ela.
  perform public.afirma(public.campanhas_do_cliente('a0000000-0000-0000-0000-00000000000a') is null,
    'campanhas nao foi contratada: a tela volta nula');
  perform public.afirma(public.ambientes_do_cliente('a0000000-0000-0000-0000-00000000000a') is null,
    'nem ambientes, que vem do site');
end $$;

-- ---------------------------------------------------------------------------
-- 5. as escritas novas (0037)
-- ---------------------------------------------------------------------------
do $$
declare n jsonb := public.nps_do_cliente('a0000000-0000-0000-0000-00000000000a');
begin
  perform public.afirma(n->'pendente' = 'null'::jsonb or n->'pendente' is null,
    'a pesquisa deste mes ja foi respondida, entao nao ha pendente');
  perform public.afirma(jsonb_array_length(n->'respondidas') = 1, 'e a respondida aparece');

  -- Responder duas vezes nao e NPS, e enquete.
  begin
    perform public.responder_nps('d3000000-0000-0000-0000-000000000001', 8::smallint, 'de novo');
    raise exception 'FALHOU: respondeu a mesma pesquisa duas vezes';
  exception when others then
    if position('ja foi respondida' in sqlerrm) = 0 then raise; end if;
  end;

  -- Sem manutencao no contrato, nao ha chamado. A funcao e SECURITY DEFINER:
  -- se ela nao conferir o modulo, entrega o que a politica recusava.
  begin
    perform public.abrir_chamado('a0000000-0000-0000-0000-00000000000a', 'Teste sem contrato');
    raise exception 'FALHOU: abriu chamado sem manutencao contratada';
  exception when others then
    if position('nao tem manutencao' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- Agora com o site contratado, que e o que liga a manutencao.
reset role;
insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, parcelas, inicio)
select 'a0000000-0000-0000-0000-00000000000a', s.id, 'projeto', 1200000, 3, current_date
  from public.servicos s where s.chave = 'website';
set role authenticated;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';

do $$ begin
  perform public.abrir_chamado('a0000000-0000-0000-0000-00000000000a', 'O site saiu do ar');
  perform public.afirma(
    (select aberto_por_nome from public.chamados
      where cliente_id = 'a0000000-0000-0000-0000-00000000000a') = 'Bruna',
    'o chamado fica no nome de quem abriu');
  perform public.afirma(
    (select aberto_por_tipo from public.chamados
      where cliente_id = 'a0000000-0000-0000-0000-00000000000a')::text = 'cliente',
    'e marcado como aberto pelo cliente');

  begin
    perform public.abrir_chamado('b0000000-0000-0000-0000-00000000000b', 'Chamado alheio');
    raise exception 'FALHOU: abriu chamado em cliente que nao e dele';
  exception when others then
    if position('Sem permissao' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- O funil, do lado da equipe.
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$
declare v_lead uuid;
begin
  select id into v_lead from public.leads where nome = 'Marina';
  begin
    perform public.mover_lead(v_lead, 'perdido');
    raise exception 'FALHOU: perdeu o lead sem motivo';
  exception when others then
    if position('precisa de motivo' in sqlerrm) = 0 then raise; end if;
  end;
  perform public.mover_lead(v_lead, 'perdido', 'Fechou com outra agência');
  perform public.afirma(
    (select etapa::text from public.leads where id = v_lead) = 'perdido',
    'com motivo, o lead sai do funil');
  perform public.afirma((public.funil()->>'abertos')::int = 0, 'e o funil esvazia');
end $$;

reset role;

do $$ begin
  perform public.afirma(not has_function_privilege('anon','public.painel_financeiro(date)','execute'),
    'anon nao le financeiro');
  perform public.afirma(not has_function_privilege('anon','public.funil()','execute'),
    'anon nao le comercial');
end $$;

select 'leituras: tudo passou' as resultado;
