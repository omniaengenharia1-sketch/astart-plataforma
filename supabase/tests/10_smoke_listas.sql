-- =============================================================================
-- Smoke das listas (0027). Elas sao SECURITY INVOKER: o que cada um recebe vem
-- do RLS, nao de um filtro escrito dentro da funcao. O que este teste cobra:
--   1. a equipe ve a lista inteira de clientes, com contrato e pendencia;
--   2. cliente que chamar tela de equipe recebe nulo, nao uma versao reduzida;
--   3. a ficha de um cliente nao abre para outro cliente;
--   4. o ciclo fecha: o cliente pede ajuste e o pedido aparece na fila da
--      equipe, com o comentario dele.
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
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br'),
  ('20000000-0000-0000-0000-00000000000b', 'carlos@clienteb.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000001','Viviane','admin',    'viviane@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002','Layana', 'operacao', 'layana@astartstudio.com.br');
insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a','Padaria Aurora','aurora'),
  ('b0000000-0000-0000-0000-00000000000b','Bloco B Arquitetura','bloco-b');
insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('20000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Bruna','bruna@clientea.com.br'),
  ('20000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-00000000000b','Carlos','carlos@clienteb.com.br');

-- Aurora: gestao recorrente de 2.800,00 + site de 12.000,00 em 3 parcelas.
insert into public.cliente_servicos
  (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio, responsavel_id)
select 'a0000000-0000-0000-0000-00000000000a', s.id,'recorrente',280000,10,date '2026-10-01',
       '10000000-0000-0000-0000-000000000002'
  from public.servicos s where s.chave='gestao_digital';
insert into public.cliente_servicos
  (cliente_id, servico_id, formato, valor_centavos, parcelas, inicio, responsavel_id)
select 'a0000000-0000-0000-0000-00000000000a', s.id,'projeto',1200000,3,date '2026-10-01',
       '10000000-0000-0000-0000-000000000002'
  from public.servicos s where s.chave='website';
-- Bloco B: so gestao.
insert into public.cliente_servicos
  (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select 'b0000000-0000-0000-0000-00000000000b', s.id,'recorrente',220000,5,date '2026-10-01'
  from public.servicos s where s.chave='gestao_digital';

-- Duas pecas esperando a Aurora e uma esperando o Bloco B.
insert into public.itens_aprovacao (id, cliente_id, tipo, estado, titulo, enviado_em) values
  ('e1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a',
   'peca','em_aprovacao','Carrossel do pão de fermentação natural', now() - interval '3 hours'),
  ('e1000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a',
   'entregavel','em_aprovacao','Layout da home no celular', now() - interval '1 hour'),
  ('e1000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-00000000000b',
   'peca','em_aprovacao','Reels da obra da fachada', now() - interval '2 hours');

-- ---------------------------------------------------------------------------
-- 1. lista_clientes — a tela da equipe
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- operacao

do $$
declare
  l jsonb := public.lista_clientes();
  a jsonb;
begin
  perform public.afirma(jsonb_array_length(l) = 2, 'a equipe ve os dois clientes');
  perform public.afirma(l->0->>'nome' = 'Bloco B Arquitetura', 'em ordem alfabetica');

  select x into a from jsonb_array_elements(l) x where x->>'slug' = 'aurora';
  perform public.afirma(a->'servicos' @> '["Gestão Digital"]'::jsonb
                    and a->'servicos' @> '["Website"]'::jsonb,
    'a Aurora aparece com os dois servicos contratados');
  perform public.afirma(a->'responsaveis' = '["Layana"]'::jsonb,
    'com a responsavel pelos contratos');
  -- Layana e operacao: desde a 0039 ela ve o serviço e a responsavel, nao o
  -- valor. Nulo, nao zero — zero diria que a Aurora nao paga nada.
  perform public.afirma(a->'mensalCentavos' = 'null'::jsonb,
    'operacao nao ve o valor do contrato na lista');
  perform public.afirma(a->'unicoCentavos' = 'null'::jsonb,
    'nem o do projeto');
  perform public.afirma((a->>'esperandoCliente')::int = 2,
    'dois itens esperando a Aurora');
  perform public.afirma((a->>'precisaDeVoce')::int = 0,
    'e nada voltou com ajuste ainda');
end $$;

-- ---------------------------------------------------------------------------
-- 2. fila_aprovacoes — a equipe ve os dois clientes na mesma fila
-- ---------------------------------------------------------------------------
do $$
declare f jsonb := public.fila_aprovacoes();
begin
  perform public.afirma(jsonb_array_length(f) = 3, 'tres itens na fila');
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(f) x where x->>'tipo' = 'entregavel')
    and exists (select 1 from jsonb_array_elements(f) x where x->>'tipo' = 'peca'),
    'peca e entregavel dividem a mesma fila');
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(f) x
             where x->>'clienteNome' = 'Bloco B Arquitetura'),
    'a fila atravessa clientes');
  perform public.afirma(f->0->>'titulo' = 'Carrossel do pão de fermentação natural',
    'o mais antigo primeiro enquanto ninguem pediu ajuste');
end $$;

-- ---------------------------------------------------------------------------
-- 3. ficha_cliente — e a mesma funcao para a equipe e para o cliente
-- ---------------------------------------------------------------------------
do $$
declare f jsonb := public.ficha_cliente('a0000000-0000-0000-0000-00000000000a');
begin
  perform public.afirma(f->'cliente'->>'nome' = 'Padaria Aurora', 'a ficha certa');
  perform public.afirma(jsonb_array_length(f->'servicos') = 2, 'os dois contratos');
  perform public.afirma(f->'modulos' @> '["calendario"]'::jsonb, 'calendario ligado');
  perform public.afirma(f->'modulos' @> '["entregaveis"]'::jsonb, 'entregaveis ligado');
  perform public.afirma(not (f->'modulos' @> '["campanhas"]'::jsonb),
    'campanhas desligado: nao contratou trafego');
  perform public.afirma(jsonb_array_length(f->'contatos') = 1, 'a Bruna como contato');
  perform public.afirma(f->'contatos'->0->>'userId' = '20000000-0000-0000-0000-00000000000a',
    'com o user_id, que e o que a tela precisa para tirar o acesso dele');
  perform public.afirma(jsonb_array_length(f->'pendencias') = 0, 'sem pendencia ainda');
  -- A ficha aberta pela operacao: o contrato aparece, o preco nao. Ela precisa
  -- do servico, do responsavel e do prazo para trabalhar; do valor, nao.
  perform public.afirma(f->'mensalCentavos' = 'null'::jsonb,
    'a operacao abre a ficha sem o mensal');
  perform public.afirma(
    f->'servicos'->0->'valorCentavos' = 'null'::jsonb,
    'e sem o valor de cada servico');
  perform public.afirma(f->'servicos'->0->>'servicoNome' is not null
                    and f->'servicos'->0->>'formato' is not null,
    'mas com o nome do servico e o formato, que e o que ela usa');
end $$;

-- ---------------------------------------------------------------------------
-- 4. o cliente nao recebe tela de equipe, nem ficha de vizinho
-- ---------------------------------------------------------------------------
-- A mesma lista, nos olhos de quem cuida do dinheiro.
set "teste.uid" = '10000000-0000-0000-0000-000000000001';   -- Viviane, admin
do $$
declare
  l jsonb := public.lista_clientes();
  a jsonb;
begin
  select x into a from jsonb_array_elements(l) x where x->>'slug' = 'aurora';
  perform public.afirma((a->>'mensalCentavos')::bigint = 280000,
    'admin ve o mensal, e ele soma so o recorrente');
  perform public.afirma((a->>'unicoCentavos')::bigint = 1200000,
    'e o projeto entra no valor unico, nao no mensal');
end $$;

set "teste.uid" = '20000000-0000-0000-0000-00000000000a';   -- Bruna, da Aurora

do $$ begin
  perform public.afirma(public.lista_clientes() is null,
    'cliente que chamar a lista de clientes recebe nulo, nao a propria linha');
  perform public.afirma(public.fila_aprovacoes() is null,
    'nem a fila da equipe');
  perform public.afirma(public.ficha_cliente('b0000000-0000-0000-0000-00000000000b') is null,
    'a Aurora nao abre a ficha do Bloco B');
  perform public.afirma(
    public.ficha_cliente('a0000000-0000-0000-0000-00000000000a')->'cliente'->>'slug' = 'aurora',
    'mas abre a propria');
end $$;

-- O cliente so ve a si mesmo nos servicos da propria ficha.
do $$
declare f jsonb := public.ficha_cliente('a0000000-0000-0000-0000-00000000000a');
begin
  perform public.afirma(jsonb_array_length(f->'servicos') = 2,
    'o cliente ve os servicos que contratou');
  perform public.afirma(jsonb_array_length(f->'contatos') = 1,
    'e so o proprio contato');
end $$;

-- ---------------------------------------------------------------------------
-- 5. o ciclo: o cliente pede ajuste e o pedido chega na fila da equipe
-- ---------------------------------------------------------------------------
do $$ begin
  begin
    perform public.responder_item('e1000000-0000-0000-0000-00000000000b',
      'aprovado', 'Bruna');
    raise exception 'FALHOU: a Aurora aprovou peca do Bloco B';
  exception when others then
    if position('Sem permissao' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.responder_item('e1000000-0000-0000-0000-000000000001',
      'com_ajustes', 'Bruna');
    raise exception 'FALHOU: pedido de ajuste passou sem dizer o que mudar';
  exception when others then
    if position('exige um comentario' in sqlerrm) = 0 then raise; end if;
  end;

  perform public.responder_item('e1000000-0000-0000-0000-000000000001',
    'com_ajustes', 'Bruna', 'cliente',
    'Trocar a foto do primeiro quadro, o pão saiu escuro.');
  perform public.responder_item('e1000000-0000-0000-0000-000000000002',
    'aprovado', 'Bruna');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- volta para a equipe

do $$
declare
  f jsonb := public.fila_aprovacoes();
  l jsonb := public.lista_clientes();
  a jsonb;
  ficha jsonb := public.ficha_cliente('a0000000-0000-0000-0000-00000000000a');
begin
  perform public.afirma(jsonb_array_length(f) = 2,
    'o aprovado saiu da fila, o ajuste e o do Bloco B ficaram');
  perform public.afirma(f->0->>'estado' = 'com_ajustes',
    'o que precisa da equipe vem primeiro, antes do que espera o cliente');
  perform public.afirma(f->0->>'comentario' like 'Trocar a foto%',
    'com o comentario do cliente do lado, sem precisar abrir o item');
  perform public.afirma(f->0->>'respondidoPor' = 'Bruna', 'e quem respondeu');

  select x into a from jsonb_array_elements(l) x where x->>'slug' = 'aurora';
  perform public.afirma((a->>'precisaDeVoce')::int = 1, 'a lista marca um ajuste');
  perform public.afirma((a->>'esperandoCliente')::int = 0,
    'e nada mais esperando o cliente');

  perform public.afirma(jsonb_array_length(ficha->'pendencias') = 1,
    'a ficha mostra a pendencia');
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(ficha->'movimentos') x
             where x->>'oQue' like 'Bruna aprovou%'),
    'e o historico registra a aprovacao');
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(ficha->'movimentos') x
             where x->>'oQue' like 'Bruna pediu ajuste em%'),
    'e tambem o pedido de ajuste');
end $$;

-- Item respondido nao responde de novo.
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$ begin
  begin
    perform public.responder_item('e1000000-0000-0000-0000-000000000002',
      'com_ajustes', 'Bruna', 'cliente', 'Mudei de ideia.');
    raise exception 'FALHOU: respondeu duas vezes o mesmo item';
  exception when others then
    if position('nao esta em aprovacao' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 6. anon nao chama nenhuma das tres
-- ---------------------------------------------------------------------------
do $$ begin
  perform public.afirma(not has_function_privilege('anon','public.lista_clientes()','execute'),
    'anon nao chama lista_clientes');
  perform public.afirma(not has_function_privilege('anon','public.fila_aprovacoes()','execute'),
    'anon nao chama fila_aprovacoes');
  perform public.afirma(not has_function_privilege('anon','public.ficha_cliente(uuid)','execute'),
    'anon nao chama ficha_cliente');
end $$;

select 'listas: tudo passou' as resultado;
