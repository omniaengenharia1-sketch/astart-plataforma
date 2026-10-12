-- =============================================================================
-- Smoke dos paineis. O que mais importa aqui: as funcoes sao SECURITY INVOKER,
-- entao cada papel recebe exatamente o que o RLS deixa ele ver — sem nenhum
-- filtro escrito na mao dentro da funcao.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'viviane@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'layana@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003', 'camila@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br'),
  ('20000000-0000-0000-0000-00000000000b', 'carlos@clienteb.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000001','Viviane','admin',     'viviane@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002','Layana', 'operacao',  'layana@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003','Camila', 'financeiro','camila@astartstudio.com.br');
insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a','Cliente A','pain-a'),
  ('b0000000-0000-0000-0000-00000000000b','Cliente B','pain-b');
insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('20000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Bruna','bruna@clientea.com.br'),
  ('20000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-00000000000b','Carlos','carlos@clienteb.com.br');

insert into public.cliente_servicos
  (id, cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select 'c5000000-0000-0000-0000-00000000000d','a0000000-0000-0000-0000-00000000000a',
       s.id,'recorrente',280000,10,date '2026-10-01' from public.servicos s where s.chave='gestao_digital';
insert into public.cliente_servicos
  (id, cliente_id, servico_id, formato, valor_centavos, parcelas, inicio)
select 'c5000000-0000-0000-0000-0000000000cc','a0000000-0000-0000-0000-00000000000a',
       s.id,'projeto',1200000,3,date '2026-10-01' from public.servicos s where s.chave='website';
insert into public.cliente_servicos
  (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select 'b0000000-0000-0000-0000-00000000000b', s.id,'recorrente',220000,5,date '2026-10-01'
  from public.servicos s where s.chave='gestao_digital';

-- Uma peca que voltou com ajuste, e outra esperando o cliente.
insert into public.itens_aprovacao (id, cliente_id, tipo, estado, titulo, enviado_em, respondido_em, respondido_por)
values ('e1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','peca',
        'com_ajustes','Como a peça é feita', now() - interval '2 days', now() - interval '1 day','Bruna');
insert into public.itens_aprovacao (id, cliente_id, tipo, estado, titulo, enviado_em)
values ('e1000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','entregavel',
        'em_aprovacao','Layout mobile', now());

-- Uma publicacao que falhou.
insert into public.contas_sociais (id, cliente_id, plataforma, nome_exibicao, ig_user_id)
values ('f0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a',
        'instagram','@clientea','ig-1');
insert into public.posts (id, cliente_id, titulo_interno, tipo, status, agendado_para)
values ('f1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a',
        'Bastidores','imagem','publicado', now());
insert into public.post_alvos (post_id, conta_social_id, estado, erro_mensagem)
values ('f1000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',
        'falhou','O token do Instagram venceu.');

-- Uma cobranca vencida.
insert into public.lancamentos (descricao, subcategoria_id, cliente_id, valor_centavos, competencia, vencimento)
select 'Gestão Digital — setembro', sub.id, 'a0000000-0000-0000-0000-00000000000a',
       280000, date '2026-09-01', current_date - 5
  from public.financeiro_subcategorias sub
  join public.financeiro_categorias cat on cat.id = sub.categoria_id
  join public.financeiro_grupos       g on g.id = cat.grupo_id
 where g.chave='receita' and cat.nome='Contrato' and sub.nome='Recorrente';

-- Um detrator.
insert into public.nps_pesquisas (id, cliente_id, competencia, enviada_em)
values ('d3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a',
        date '2026-09-01', now());
insert into public.nps_respostas (pesquisa_id, nota, comentario)
values ('d3000000-0000-0000-0000-000000000001', 5, 'Demora nos ajustes.');

-- ---------------------------------------------------------------------------
-- 1. minha_sessao diz quem e cada um
-- ---------------------------------------------------------------------------
set role authenticated;

set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$ begin
  perform public.afirma(public.minha_sessao()->>'tipo' = 'equipe', 'operacao e equipe');
  perform public.afirma(public.minha_sessao()->'perfil'->>'papel' = 'operacao', 'com o papel certo');
end $$;

set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$ begin
  perform public.afirma(public.minha_sessao()->>'tipo' = 'cliente', 'bruna e cliente');
  perform public.afirma(jsonb_array_length(public.minha_sessao()->'clientes') = 1,
    'e responde por um cliente so');
  perform public.afirma(public.minha_sessao()->'clientes'->0->>'nome' = 'Cliente A',
    'o cliente certo');
end $$;

set "teste.uid" = '';
do $$ begin
  perform public.afirma(public.minha_sessao()->>'tipo' = 'anonimo', 'sem login, anonimo');
end $$;

-- ---------------------------------------------------------------------------
-- 2. painel_equipe: cada papel recebe o que o RLS deixa
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- operacao
do $$
declare p jsonb := public.painel_equipe();
begin
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(p->'pendencias') x
             where x->>'oQue' like 'Peça voltou com ajuste%'),
    'operacao ve a peca que voltou com ajuste');
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(p->'pendencias') x
             where x->>'oQue' like 'Publicação falhou%'),
    'operacao ve a publicacao que falhou');
  perform public.afirma(
    not exists (select 1 from jsonb_array_elements(p->'pendencias') x
                 where x->>'oQue' like 'Cobrança vencida%'),
    'operacao NAO ve cobranca vencida — e o RLS escondendo, nao um if na funcao');
  -- O RLS esconde as LINHAS, e a soma delas vinha 0. Desde a 0039 o total vem
  -- nulo: "R$ 0,00 vencido" no Inicio da operacao nao e discricao, e numero
  -- errado. Nulo a tela esconde o cartao.
  perform public.afirma(p->'vencidoCentavos' = 'null'::jsonb,
    'e o total vencido nao aparece para ela — nulo, nao zero');
  perform public.afirma((p->>'esperandoCliente')::int = 1, 'um item esperando o cliente');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000003';   -- financeiro
do $$
declare p jsonb := public.painel_equipe();
begin
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(p->'pendencias') x
             where x->>'oQue' like 'Cobrança vencida%'),
    'financeiro ve a cobranca vencida');
  perform public.afirma((p->>'vencidoCentavos')::bigint = 280000,
    'e o total vencido bate');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000001';   -- admin
do $$
declare p jsonb := public.painel_equipe();
begin
  perform public.afirma(jsonb_array_length(p->'pendencias') = 4,
    'admin ve as quatro: ajuste, falha, cobranca e detrator');
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(p->'pendencias') x
             where x->>'oQue' like 'NPS nota 5%'),
    'inclusive o detrator, com a nota e o comentario');
end $$;

set "teste.uid" = '20000000-0000-0000-0000-00000000000a';   -- cliente
do $$ begin
  perform public.afirma(public.painel_equipe() is null,
    'cliente que chamar o painel da equipe recebe nulo, nao uma versao filtrada');
end $$;

-- ---------------------------------------------------------------------------
-- 3. painel_cliente
-- ---------------------------------------------------------------------------
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$
declare p jsonb := public.painel_cliente('a0000000-0000-0000-0000-00000000000a');
begin
  perform public.afirma(p->'cliente'->>'nome' = 'Cliente A', 'o painel e do cliente certo');
  perform public.afirma(jsonb_array_length(p->'paraAprovar') = 1, 'um item para aprovar');
  perform public.afirma(p->'paraAprovar'->0->>'tipo' = 'entregavel',
    'e e o entregavel — peca e entregavel na mesma fila');
  perform public.afirma(p->'modulos' ? 'calendario', 'tem calendario');
  perform public.afirma(p->'modulos' ? 'entregaveis', 'tem entregaveis');
  perform public.afirma(not (p->'modulos' ? 'campanhas'), 'nao tem campanhas: chave desligada');
  perform public.afirma(p->'redes' is not null and p->'redes' <> 'null'::jsonb,
    'tem o resumo de redes');
  perform public.afirma(p->'captacao' = 'null'::jsonb or p->'captacao' is null,
    'nao tem captacao: nao contratou audiovisual');
  perform public.afirma(p->'projeto'->>'servicoNome' = 'Website', 'o projeto em aberto e o site');
  perform public.afirma((p->'projeto'->>'total')::int = 11, 'com os 11 entregaveis');
  perform public.afirma((p->>'npsPendente')::boolean = false,
    'o NPS de setembro ja foi respondido');
  perform public.afirma(p->'proximaCobranca'->>'situacao' = 'atrasado',
    'a proxima cobranca aparece como atrasada');
end $$;

-- O cliente A pedindo o painel do B nao recebe o B.
do $$ begin
  perform public.afirma(public.painel_cliente('b0000000-0000-0000-0000-00000000000b') is null,
    'cliente A nao monta o painel do cliente B');
end $$;

reset role;

do $$ begin
  perform public.afirma(not has_function_privilege('anon','public.painel_equipe()','execute'),
    'anon nao chama painel_equipe');
  perform public.afirma(not has_function_privilege('anon','public.minha_sessao()','execute'),
    'anon nao chama minha_sessao');
end $$;

select 'paineis: tudo passou' as resultado;
