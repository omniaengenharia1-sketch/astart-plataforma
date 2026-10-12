-- =============================================================================
-- Smoke da 0039. O que este teste cobra:
--   1. o valor do contrato: equipe do dinheiro ve, operacao nao, cliente ve o
--      proprio — e a COLUNA esta fechada, nao so a funcao;
--   2. o comercial fechado, e a recusa com mensagem que diz o motivo;
--   3. mudar_papel: so admin, idempotente, e nao deixa a conta sem admin;
--   4. desativar_cliente tira do ar e fecha o portal;
--   5. remover_cliente recusa quem tem historico, e apaga quem nao tem;
--   6. operacao nao apaga cliente nem por fora da funcao.
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
  ('10000000-0000-0000-0000-000000000003', 'contador@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br');

insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000001','Viviane', 'admin',     'viviane@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002','Layana',  'operacao',  'layana@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003','Contador','financeiro','contador@astartstudio.com.br');

insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a','Padaria Aurora','aurora'),
  ('f0000000-0000-0000-0000-00000000000f','Cadastrado Errado','erro');

insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('20000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Bruna','bruna@clientea.com.br');

insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select 'a0000000-0000-0000-0000-00000000000a', s.id, 'recorrente', 280000, 10, current_date
  from public.servicos s where s.chave = 'gestao_digital';

set role authenticated;

-- ---------------------------------------------------------------------------
-- 1. o valor do contrato
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000003';   -- financeiro
do $$ begin
  perform public.afirma(
    (select valor_centavos from public.contrato_valores('a0000000-0000-0000-0000-00000000000a')) = 280000,
    'quem cuida do dinheiro ve o valor do contrato');
  perform public.afirma(
    (select mensal_centavos from public.contrato_totais('a0000000-0000-0000-0000-00000000000a')) = 280000,
    'e o total do mes');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- operacao
do $$ begin
  perform public.afirma(
    not exists (select 1 from public.contrato_valores('a0000000-0000-0000-0000-00000000000a')),
    'operacao nao recebe valor nenhum da funcao');
  -- Sempre uma linha, com nulo dentro: a tela esconde o cartao em vez de
  -- mostrar R$ 0,00.
  perform public.afirma(
    (select count(*) from public.contrato_totais('a0000000-0000-0000-0000-00000000000a')) = 1,
    'o total vem como uma linha');
  perform public.afirma(
    (select mensal_centavos from public.contrato_totais('a0000000-0000-0000-0000-00000000000a')) is null,
    'e o valor dentro dela e nulo, nao zero');

  -- E a ficha dela mostra o servico sem o preco.
  perform public.afirma(
    public.ficha_cliente('a0000000-0000-0000-0000-00000000000a')
      ->'servicos'->0->>'servicoNome' = 'Gestão Digital',
    'a ficha mostra o servico');
  perform public.afirma(
    public.ficha_cliente('a0000000-0000-0000-0000-00000000000a')
      ->'servicos'->0->'valorCentavos' = 'null'::jsonb,
    'e nao mostra o valor dele');
end $$;

-- A parte que importa: a COLUNA esta fechada. Esconder so na funcao seria
-- teatro — a coluna continuaria aberta na API para qualquer login.
do $$
declare ok boolean;
begin
  begin
    perform (select valor_centavos from public.cliente_servicos limit 1);
    raise exception 'FALHOU: operacao leu valor_centavos direto da tabela';
  exception when insufficient_privilege then
    ok := true;
  end;
  perform public.afirma(ok, 'o privilegio de coluna recusa a leitura direta');

  -- E o que ela precisa continua aberto.
  perform public.afirma(
    (select count(*) from public.cliente_servicos where status = 'ativo') = 1,
    'a linha continua legivel: a operacao precisa do contrato para trabalhar');
end $$;

-- Nem o admin le a coluna direto. De proposito: ele le pela funcao, como todo
-- mundo. Privilegio de coluna nao distingue papel, e e isso que o faz valer.
set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$
declare ok boolean;
begin
  begin
    perform (select dia_vencimento from public.cliente_servicos limit 1);
    raise exception 'FALHOU: admin leu a coluna direto';
  exception when insufficient_privilege then
    ok := true;
  end;
  perform public.afirma(ok, 'nem o admin le a coluna por fora');
  perform public.afirma(
    (select valor_centavos from public.contrato_valores('a0000000-0000-0000-0000-00000000000a')) = 280000,
    'mas ele le pela funcao');
end $$;

-- O cliente ve o proprio contrato: o valor dele ele ja ve na cobranca.
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$ begin
  perform public.afirma(
    (select valor_centavos from public.contrato_valores('a0000000-0000-0000-0000-00000000000a')) = 280000,
    'a cliente ve o valor do proprio contrato');
  perform public.afirma(
    not exists (select 1 from public.contrato_valores('f0000000-0000-0000-0000-00000000000f')),
    'e nao ve o de mais ninguem');
end $$;

-- ---------------------------------------------------------------------------
-- 2. o comercial
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000003';
insert into public.leads (nome, empresa, etapa, valor_estimado_centavos)
values ('Marina', 'Doce Ponto', 'proposta_enviada', 450000);

do $$ begin
  perform public.afirma((public.funil()->>'abertos')::int = 1, 'o financeiro ve o funil');
  perform set_config('teste.lead', (select id::text from public.leads where nome = 'Marina'), false);
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$
declare ok boolean;
begin
  perform public.afirma(public.funil() is null, 'operacao nao abre o comercial');
  perform public.afirma(
    not exists (select 1 from public.leads), 'e nao alcanca a tabela: o RLS esconde a linha');
  begin
    perform public.mover_lead(current_setting('teste.lead')::uuid, 'negociacao');
    raise exception 'FALHOU: operacao moveu o lead';
  exception when others then
    if position('cuida do dinheiro' in sqlerrm) = 0 then raise; end if;
    ok := true;
  end;
  perform public.afirma(ok, 'e a recusa diz o motivo, nao "lead nao encontrado"');
end $$;

-- ---------------------------------------------------------------------------
-- 3. mudar_papel
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  begin
    perform public.mudar_papel('10000000-0000-0000-0000-000000000002', 'admin');
    raise exception 'FALHOU: operacao se promoveu por mudar_papel';
  exception when others then
    if position('administra a plataforma' in sqlerrm) = 0 then raise; end if;
    ok := true;
  end;
  perform public.afirma(ok, 'operacao nao muda papel de ninguem, nem o proprio');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000001';   -- admin
do $$
declare ok boolean;
begin
  perform public.mudar_papel('10000000-0000-0000-0000-000000000002', 'financeiro');
  perform public.afirma(
    (select papel::text from public.perfis where user_id = '10000000-0000-0000-0000-000000000002')
      = 'financeiro',
    'o admin muda o papel de alguem');

  -- Idempotente: pedir o mesmo papel duas vezes nao e erro.
  perform public.mudar_papel('10000000-0000-0000-0000-000000000002', 'financeiro');

  begin
    perform public.mudar_papel('10000000-0000-0000-0000-000000000002', 'social');
    raise exception 'FALHOU: aceitou o papel morto';
  exception when others then
    if position('Papel invalido' in sqlerrm) = 0 then raise; end if;
    ok := true;
  end;
  perform public.afirma(ok, 'e recusa "social", que e lixo da fase do agendador');

  -- A trava que importa: rebaixar o ultimo admin tranca a conta inteira.
  begin
    perform public.mudar_papel('10000000-0000-0000-0000-000000000001', 'operacao');
    raise exception 'FALHOU: o unico admin se rebaixou e trancou a plataforma';
  exception when others then
    if position('outra pessoa administrando' in sqlerrm) = 0 then raise; end if;
    ok := true;
  end;
  perform public.afirma(ok, 'o ultimo admin nao sai sozinho');

  -- Com outro admin na casa, ele pode sair.
  perform public.mudar_papel('10000000-0000-0000-0000-000000000003', 'admin');
  perform public.mudar_papel('10000000-0000-0000-0000-000000000001', 'financeiro');
  perform public.afirma(
    (select papel::text from public.perfis where user_id = '10000000-0000-0000-0000-000000000001')
      = 'financeiro',
    'com outro admin na casa, ele sai');
end $$;

-- ---------------------------------------------------------------------------
-- 4 e 5. tirar do ar e apagar
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000003';   -- virou admin acima
do $$ begin
  perform public.desativar_cliente('a0000000-0000-0000-0000-00000000000a');
  perform public.afirma(
    not (select ativo from public.clientes where id = 'a0000000-0000-0000-0000-00000000000a'),
    'o cliente sai do ar');
  perform public.afirma(
    (select status::text from public.cliente_servicos
      where cliente_id = 'a0000000-0000-0000-0000-00000000000a') = 'encerrado',
    'e o contrato encerra junto');
  perform public.afirma(
    not (select ativo from public.clientes_usuarios
          where cliente_id = 'a0000000-0000-0000-0000-00000000000a'),
    'e o portal dele fecha: contrato encerrado com portal aberto e o pior dos dois');
  perform public.afirma(
    not exists (select 1 from jsonb_array_elements(public.lista_clientes()) x
                 where x->>'slug' = 'aurora'),
    'e ele sai da lista de clientes');

  -- Reativar devolve o cliente, NAO o contrato: qual servico volta e por
  -- quanto e decisao de contrato, nao de um clique.
  perform public.reativar_cliente('a0000000-0000-0000-0000-00000000000a');
  perform public.afirma(
    (select ativo from public.clientes where id = 'a0000000-0000-0000-0000-00000000000a'),
    'reativar devolve o cliente');
  perform public.afirma(
    (select status::text from public.cliente_servicos
      where cliente_id = 'a0000000-0000-0000-0000-00000000000a') = 'encerrado',
    'e deixa o contrato encerrado, para alguem dizer o preco novo');
end $$;

do $$
declare ok boolean;
begin
  -- Com historico, apagar recusa e manda desativar.
  insert into public.itens_aprovacao (cliente_id, tipo, titulo)
  values ('a0000000-0000-0000-0000-00000000000a', 'peca', 'Post de teste');

  begin
    perform public.remover_cliente('a0000000-0000-0000-0000-00000000000a');
    raise exception 'FALHOU: apagou cliente com historico';
  exception when others then
    if position('Tire do ar' in sqlerrm) = 0 then raise; end if;
    ok := true;
  end;
  perform public.afirma(ok, 'cliente com historico nao se apaga');

  -- O cadastrado errado, sem nada, sai.
  perform public.remover_cliente('f0000000-0000-0000-0000-00000000000f');
  perform public.afirma(
    not exists (select 1 from public.clientes where id = 'f0000000-0000-0000-0000-00000000000f'),
    'e o cadastrado errado sai');
end $$;

-- ---------------------------------------------------------------------------
-- 6. e por fora da funcao tambem nao
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- hoje financeiro, nao admin
do $$ begin
  delete from public.clientes where id = 'a0000000-0000-0000-0000-00000000000a';
  -- A politica da 0006 era `for all`, e `all` inclui delete: qualquer pessoa
  -- de operacao apagava um cliente e o cascade levava oito meses de historico.
  perform public.afirma(
    exists (select 1 from public.clientes where id = 'a0000000-0000-0000-0000-00000000000a'),
    'quem nao administra nao apaga cliente nem por SQL direto');
end $$;

reset role;

do $$ begin
  perform public.afirma(
    not has_function_privilege('anon','public.mudar_papel(uuid, public.papel_perfil)','execute'),
    'anon nao muda papel de ninguem');
  perform public.afirma(
    not has_function_privilege('anon','public.contrato_valores(uuid)','execute'),
    'nem le valor de contrato');
end $$;

select 'dinheiro e admin: tudo passou' as resultado;
