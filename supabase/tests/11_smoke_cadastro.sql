-- =============================================================================
-- Smoke do cadastro de cliente (0028). O que importa aqui:
--   1. o catalogo diz o que a tela precisa perguntar (e so pergunta o formato
--      do Audiovisual, que e o unico sem padrao);
--   2. criar_cliente grava cliente e contrato numa transacao e liga os modulos
--      pelo servico — inclusive disparando os entregaveis do modelo;
--   3. clique duplo nao cria cliente gemeo;
--   4. e, como a funcao e SECURITY INVOKER, quem nao escreve em clientes nao
--      cadastra ninguem — nem com a funcao na mao.
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
  ('10000000-0000-0000-0000-000000000004', 'estagio@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000001','Viviane','admin',   'viviane@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002','Layana', 'operacao','layana@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000004','Estágio','leitura', 'estagio@astartstudio.com.br');
insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a','Cliente Existente','cliente-existente');
insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('20000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Bruna','bruna@clientea.com.br');

-- ---------------------------------------------------------------------------
-- 1. o catalogo
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- operacao

do $$
declare
  c jsonb := public.catalogo();
  audiovisual jsonb;
  gestao jsonb;
begin
  perform public.afirma(jsonb_array_length(c->'servicos') = 6, 'os seis servicos');

  select x into audiovisual from jsonb_array_elements(c->'servicos') x
   where x->>'chave' = 'audiovisual';
  perform public.afirma(audiovisual->'formatoPadrao' = 'null'::jsonb,
    'o Audiovisual e o unico sem formato padrao: a tela pergunta');

  select x into gestao from jsonb_array_elements(c->'servicos') x
   where x->>'chave' = 'gestao_digital';
  perform public.afirma(gestao->>'formatoPadrao' = 'recorrente',
    'Gestao Digital ja vem recorrente');
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(gestao->'modulos') m
             where m->>'chave' = 'campanhas' and (m->>'opcional')::boolean),
    'campanhas aparece como opcional da Gestao Digital');
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(gestao->'modulos') m
             where m->>'chave' = 'grid' and not (m->>'opcional')::boolean),
    'e o grid, como obrigatorio');

  perform public.afirma(jsonb_array_length(c->'modulosSempre') = 3,
    'financeiro, contrato e NPS valem para todo cliente');
  perform public.afirma(jsonb_array_length(c->'equipe') = 3, 'a equipe inteira');
end $$;

-- ---------------------------------------------------------------------------
-- 2. cadastrar
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb;
  v_id uuid;
begin
  r := public.criar_cliente(
    'Padaria Aurora & Cia',
    jsonb_build_array(
      jsonb_build_object('servico','gestao_digital','valorCentavos',280000,
        'diaVencimento',10,'inicio','2026-10-01',
        'responsavelId','10000000-0000-0000-0000-000000000002',
        'modulos', jsonb_build_array('campanhas')),
      jsonb_build_object('servico','website','valorCentavos',1200000,
        'parcelas',3,'inicio','2026-10-01','entregaEm','2026-12-01')));

  perform public.afirma(r->>'slug' = 'padaria-aurora-cia',
    'o endereco sai do nome, sem acento e sem o &');
  v_id := (r->>'id')::uuid;

  perform public.afirma(
    (select count(*) from public.cliente_servicos cs where cs.cliente_id = v_id) = 2,
    'os dois servicos entraram');
  -- Desde a 0039 a operacao GRAVA o valor no cadastro e nao le de volta: a
  -- coluna e fechada e `contrato_valores` confere o papel. Guarda o id para o
  -- bloco do admin conferir que o 3 chegou mesmo no banco.
  perform set_config('teste.cliente', v_id::text, false);
  perform public.afirma(
    not exists (select 1 from public.contrato_valores(v_id)),
    'quem cadastrou e operacao: grava o valor e nao le de volta');


  -- A matriz, aplicada.
  perform public.afirma(public.cliente_tem_modulo(v_id, 'grid'),
    'grid ligado pela gestao');
  perform public.afirma(public.cliente_tem_modulo(v_id, 'campanhas'),
    'campanhas ligado porque foi marcado no contrato');
  perform public.afirma(not public.cliente_tem_modulo(v_id, 'galeria'),
    'galeria segue desligada: e opcional e nao foi marcada');
  perform public.afirma(public.cliente_tem_modulo(v_id, 'manutencao'),
    'manutencao veio junto do site');
  perform public.afirma(public.cliente_tem_modulo(v_id, 'financeiro'),
    'financeiro vale para todo cliente');

  -- O gatilho da 0018 criou os entregaveis do modelo do site.
  perform public.afirma(
    (select count(*) from public.entregaveis e
       join public.cliente_servicos cs on cs.id = e.cliente_servico_id
      where cs.cliente_id = v_id) = 11,
    'os 11 entregaveis do site nasceram junto com o contrato');
end $$;

-- O valor foi gravado de verdade — quem confere e quem pode ver.
set "teste.uid" = '10000000-0000-0000-0000-000000000001';   -- Viviane, admin
do $$
declare v_id uuid := current_setting('teste.cliente', true)::uuid;
begin
  perform public.afirma(
    (select v.parcelas from public.contrato_valores(v_id) v
      join public.cliente_servicos cs on cs.id = v.cliente_servico_id
      join public.servicos s on s.id = cs.servico_id
     where s.chave = 'website') = 3,
    'o site em 3 parcelas, lido por quem cuida do dinheiro');
  perform public.afirma(
    (select mensal_centavos from public.contrato_totais(v_id)) = 280000,
    'e o mensal do contrato novo');
  perform public.afirma(
    (select v.dia_vencimento from public.contrato_valores(v_id) v
      join public.cliente_servicos cs on cs.id = v.cliente_servico_id
      join public.servicos s on s.id = cs.servico_id
     where s.chave = 'gestao_digital') = 10,
    'e a gestao vence dia 10');
end $$;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- volta para a operacao

-- ---------------------------------------------------------------------------
-- 3. o que a funcao recusa
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  -- Clique duplo.
  begin
    perform public.criar_cliente('Padaria Aurora & Cia',
      jsonb_build_array(jsonb_build_object('servico','gestao_digital',
        'valorCentavos',280000,'diaVencimento',10)));
    raise exception 'FALHOU: cadastrou o mesmo cliente duas vezes';
  exception when others then
    if position('Ja existe um cliente' in sqlerrm) = 0 then raise; end if;
  end;

  -- Audiovisual sem formato.
  begin
    perform public.criar_cliente('Bar do Zé',
      jsonb_build_array(jsonb_build_object('servico','audiovisual','valorCentavos',240000)));
    raise exception 'FALHOU: audiovisual passou sem dizer o formato';
  exception when others then
    -- A mensagem tem de NOMEAR as opcoes, e sao TRES.
    --
    -- Isto cobrava 'recorrente ou pontual', e estava cobrando um erro: o enum
    -- `formato_contrato` tem recorrente, projeto E pontual, e a mensagem antiga
    -- escondia o do meio. Apareceu quando a 0052 juntou num lugar so a
    -- validacao do cadastro e a da alteracao de contrato — duas copias da mesma
    -- regra divergindo, que e a armadilha que esta suite existe para pegar. A
    -- copia que divergiu era a mensagem, e quem pagava era quem lia a tela.
    if position('recorrente' in sqlerrm) = 0
       or position('projeto'  in sqlerrm) = 0
       or position('pontual'  in sqlerrm) = 0 then raise; end if;
  end;

  -- Recorrente sem dia.
  begin
    perform public.criar_cliente('Bar do Zé',
      jsonb_build_array(jsonb_build_object('servico','gestao_digital','valorCentavos',100000)));
    raise exception 'FALHOU: recorrente passou sem dia de vencimento';
  exception when others then
    if position('dia de vencimento' in sqlerrm) = 0 then raise; end if;
  end;

  -- Dia 31 nao existe em todo mes.
  begin
    perform public.criar_cliente('Bar do Zé',
      jsonb_build_array(jsonb_build_object('servico','gestao_digital',
        'valorCentavos',100000,'diaVencimento',31)));
    raise exception 'FALHOU: aceitou vencimento dia 31';
  exception when others then
    if position('entre 1 e 28' in sqlerrm) = 0 then raise; end if;
  end;

  -- Sem servico nenhum.
  begin
    perform public.criar_cliente('Bar do Zé', '[]'::jsonb);
    raise exception 'FALHOU: cadastrou cliente sem contrato';
  exception when others then
    if position('pelo menos um servico' in sqlerrm) = 0 then raise; end if;
  end;

  -- Modulo que nao e opcional daquele servico.
  begin
    perform public.criar_cliente('Bar do Zé',
      jsonb_build_array(jsonb_build_object('servico','website','valorCentavos',100000,
        'parcelas',1,'modulos',jsonb_build_array('campanhas'))));
    raise exception 'FALHOU: ligou campanhas num contrato de site';
  exception when others then
    if position('nao e uma opcao' in sqlerrm) = 0 then raise; end if;
  end;

  -- E nada disso deixou lixo para tras.
  perform public.afirma(
    not exists (select 1 from public.clientes c where c.nome = 'Bar do Zé'),
    'tentativa recusada nao deixa cliente pela metade');
end $$;

-- ---------------------------------------------------------------------------
-- 4. quem nao escreve em clientes nao cadastra — quem decide e o RLS
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000004';   -- leitura
do $$ begin
  perform public.afirma(public.catalogo() is not null, 'leitura ainda le o catalogo');
  begin
    perform public.criar_cliente('Tentativa da Leitura',
      jsonb_build_array(jsonb_build_object('servico','gestao_digital',
        'valorCentavos',100000,'diaVencimento',5)));
    raise exception 'FALHOU: papel leitura cadastrou cliente';
  exception when insufficient_privilege then
    null;  -- RLS recusou, que e o esperado
  when others then
    if position('row-level security' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

set "teste.uid" = '20000000-0000-0000-0000-00000000000a';   -- cliente
do $$ begin
  perform public.afirma(public.catalogo() is null,
    'cliente nao recebe o catalogo da equipe');
  begin
    perform public.criar_cliente('Tentativa do Cliente',
      jsonb_build_array(jsonb_build_object('servico','gestao_digital',
        'valorCentavos',100000,'diaVencimento',5)));
    raise exception 'FALHOU: cliente cadastrou cliente';
  exception when insufficient_privilege then
    null;
  when others then
    if position('row-level security' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

reset role;

do $$ begin
  perform public.afirma(not has_function_privilege('anon','public.criar_cliente(text,jsonb,text,text)','execute'),
    'anon nao chama criar_cliente');
  perform public.afirma(not has_function_privilege('anon','public.catalogo()','execute'),
    'anon nao chama catalogo');
end $$;

select 'cadastro: tudo passou' as resultado;
