-- =============================================================================
-- Smoke da fundacao: portao de modulo, isolamento entre clientes, separacao
-- equipe/cliente e o motor de aprovacao.
--
-- auth.uid() do stub devolve sempre null. Aqui ele passa a ler uma variavel de
-- sessao, para dar para trocar de usuario no meio do teste.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;

create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'viviane@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'layana@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br'),
  ('20000000-0000-0000-0000-00000000000b', 'carlos@clienteb.com.br');

insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000001', 'Viviane', 'admin',    'viviane@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Layana',  'operacao', 'layana@astartstudio.com.br');

insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a', 'Cliente A', 'fundacao-a'),
  ('b0000000-0000-0000-0000-00000000000b', 'Cliente B', 'fundacao-b');

insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('20000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'Bruna',  'bruna@clientea.com.br'),
  ('20000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'Carlos', 'carlos@clienteb.com.br');

-- A: gestao digital (recorrente) + website (projeto). B: branding (projeto).
insert into public.cliente_servicos
  (id, cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select 'c5000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a',
       s.id, 'recorrente', 280000, 10, date '2026-10-01'
  from public.servicos s where s.chave = 'gestao_digital';

insert into public.cliente_servicos
  (id, cliente_id, servico_id, formato, valor_centavos, parcelas, inicio, entrega_em)
select 'c5000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a',
       s.id, 'projeto', 1200000, 3, date '2026-10-01', date '2026-12-15'
  from public.servicos s where s.chave = 'website';

insert into public.cliente_servicos
  (cliente_id, servico_id, formato, valor_centavos, parcelas, inicio)
select 'b0000000-0000-0000-0000-00000000000b', s.id, 'projeto', 950000, 2, date '2026-09-01'
  from public.servicos s where s.chave = 'branding';

-- ---------------------------------------------------------------------------
-- 1. O portao
-- ---------------------------------------------------------------------------
do $$
declare a uuid := 'a0000000-0000-0000-0000-00000000000a';
        b uuid := 'b0000000-0000-0000-0000-00000000000b';
begin
  perform public.afirma(public.cliente_tem_modulo(a,'calendario'),  'A tem calendario (gestao digital)');
  perform public.afirma(public.cliente_tem_modulo(a,'grid'),        'A tem grid');
  perform public.afirma(public.cliente_tem_modulo(a,'ambientes'),   'A tem ambientes (website)');
  perform public.afirma(public.cliente_tem_modulo(a,'financeiro'),  'A tem financeiro (sempre)');
  perform public.afirma(not public.cliente_tem_modulo(a,'campanhas'), 'A NAO tem campanhas: chave opcional desligada');
  perform public.afirma(not public.cliente_tem_modulo(a,'galeria'),   'A NAO tem galeria: opcional desligada e sem audiovisual');
  perform public.afirma(not public.cliente_tem_modulo(a,'integracoes'),'A NAO tem integracoes: nao contratou Sistemas');

  perform public.afirma(public.cliente_tem_modulo(b,'marcos'),       'B tem marcos (branding)');
  perform public.afirma(public.cliente_tem_modulo(b,'contrato'),     'B tem contrato (sempre)');
  perform public.afirma(not public.cliente_tem_modulo(b,'calendario'),'B NAO tem calendario: nao contratou gestao digital');
end $$;

-- Ligar a chave do trafego acende Campanhas.
insert into public.cliente_servico_modulos (cliente_servico_id, modulo_id, ligado)
select 'c5000000-0000-0000-0000-000000000001', m.id, true
  from public.modulos m where m.chave = 'campanhas';

do $$ begin
  perform public.afirma(public.cliente_tem_modulo('a0000000-0000-0000-0000-00000000000a','campanhas'),
    'chave ligada acende Campanhas');
end $$;

-- Pausar o servico apaga os modulos dele, e so os dele.
update public.cliente_servicos set status = 'pausado'
 where id = 'c5000000-0000-0000-0000-000000000001';

do $$
declare a uuid := 'a0000000-0000-0000-0000-00000000000a';
begin
  perform public.afirma(not public.cliente_tem_modulo(a,'calendario'), 'servico pausado apaga o calendario');
  perform public.afirma(not public.cliente_tem_modulo(a,'campanhas'),  'servico pausado apaga campanhas');
  perform public.afirma(public.cliente_tem_modulo(a,'ambientes'),      'pausar gestao digital NAO afeta o website');
  perform public.afirma(public.cliente_tem_modulo(a,'financeiro'),     'financeiro continua: ainda ha servico ativo');
end $$;

update public.cliente_servicos set status = 'ativo'
 where id = 'c5000000-0000-0000-0000-000000000001';

-- Modulo obrigatorio nao pode ser desligado na mao.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.cliente_servico_modulos (cliente_servico_id, modulo_id, ligado)
    select 'c5000000-0000-0000-0000-000000000001', m.id, false
      from public.modulos m where m.chave = 'calendario';
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'desligar modulo obrigatorio e recusado');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Coerencia do contrato
-- ---------------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  begin
    insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, inicio)
    select 'b0000000-0000-0000-0000-00000000000b', s.id, 'recorrente', 100000, current_date
      from public.servicos s where s.chave = 'gestao_digital';
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'recorrente sem dia de vencimento e recusado');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, parcelas, inicio, fim)
    select 'b0000000-0000-0000-0000-00000000000b', s.id, 'projeto', 100000, 2,
           date '2026-10-01', date '2026-09-01'
      from public.servicos s where s.chave = 'website';
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'fim antes do inicio e recusado');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Ninguem e equipe e cliente ao mesmo tempo
-- ---------------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  begin
    insert into public.perfis (user_id, nome, papel, email)
    values ('20000000-0000-0000-0000-00000000000a', 'Bruna', 'operacao', 'bruna@clientea.com.br');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'cliente nao vira equipe');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.clientes_usuarios (user_id, cliente_id, email)
    values ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'layana@astartstudio.com.br');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'equipe nao vira cliente');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Convite: um aberto por e-mail, e nao expira
-- ---------------------------------------------------------------------------
insert into public.convites (destino, email, nome, papel, cargo)
values ('equipe', 'novo@astartstudio.com.br', 'Novo', 'operacao', 'Designer');

do $$
declare ok boolean := false;
begin
  begin
    insert into public.convites (destino, email, papel)
    values ('equipe', 'NOVO@astartstudio.com.br', 'leitura');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'dois convites abertos para o mesmo e-mail sao recusados');
end $$;

update public.convites set revogado_em = now() where email = 'novo@astartstudio.com.br';
insert into public.convites (destino, email, papel) values ('equipe', 'novo@astartstudio.com.br', 'leitura');

do $$ begin
  perform public.afirma(
    not exists (select 1 from information_schema.columns
                 where table_name = 'convites' and column_name like 'expira%'),
    'convite nao tem coluna de validade');
end $$;

-- Convite de equipe com cliente_id preenchido e incoerente.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.convites (destino, email, papel, cliente_id)
    values ('equipe', 'x@y.com', 'leitura', 'a0000000-0000-0000-0000-00000000000a');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'convite de equipe com cliente_id e recusado');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Motor de aprovacao
-- ---------------------------------------------------------------------------
insert into public.itens_aprovacao (id, cliente_id, tipo, estado, titulo, enviado_em) values
  ('e1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','peca','em_aprovacao','Carrossel de outubro', now()),
  ('e1000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','entregavel','em_aprovacao','Layout mobile', now());

insert into public.envios_aprovacao (id, cliente_id, criado_por)
values ('f1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-000000000002');

insert into public.envio_itens (envio_id, item_id) values
  ('f1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000002');

do $$ begin
  perform public.afirma(
    (select count(*) from public.itens_aprovacao
      where cliente_id = 'a0000000-0000-0000-0000-00000000000a' and estado = 'em_aprovacao') = 2,
    'peca e entregavel na MESMA fila');
end $$;

-- Pedir ajuste sem comentario e recusado no banco.
do $$
declare ok boolean := false;
begin
  begin
    perform public.responder_item('e1000000-0000-0000-0000-000000000001', 'com_ajustes', 'Bruna');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'pedido de ajuste sem comentario e recusado');
end $$;

select public.responder_item('e1000000-0000-0000-0000-000000000001', 'com_ajustes', 'Bruna',
                             'cliente', 'Trocar a foto do slide 3.');

do $$ begin
  perform public.afirma(
    (select estado from public.itens_aprovacao where id = 'e1000000-0000-0000-0000-000000000001') = 'com_ajustes',
    'item voltou com ajustes');
  perform public.afirma(
    (select count(*) from public.aprovacao_comentarios
      where item_id = 'e1000000-0000-0000-0000-000000000001') = 1,
    'comentario ficou preso ao item');
  perform public.afirma(
    (select fechado_em from public.envios_aprovacao where id = 'f1000000-0000-0000-0000-000000000001') is null,
    'envio continua aberto: falta um item');
end $$;

-- Responder duas vezes o mesmo item e recusado.
do $$
declare ok boolean := false;
begin
  begin
    perform public.responder_item('e1000000-0000-0000-0000-000000000001', 'aprovado', 'Bruna');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'item ja respondido nao aceita nova resposta');
end $$;

select public.responder_item('e1000000-0000-0000-0000-000000000002', 'aprovado', 'Bruna');

do $$ begin
  perform public.afirma(
    (select fechado_em from public.envios_aprovacao where id = 'f1000000-0000-0000-0000-000000000001') is not null,
    'envio fecha quando o ultimo item e respondido');
end $$;

-- O link nao tem validade.
do $$ begin
  perform public.afirma(
    not exists (select 1 from information_schema.columns
                 where table_name = 'links_aprovacao' and column_name = 'expira_em'),
    'links_aprovacao nao tem expira_em');
end $$;

-- ---------------------------------------------------------------------------
-- 6. RLS: cliente nao le cliente
-- ---------------------------------------------------------------------------
insert into public.cliente_documentos (cliente_id, tipo, nome, caminho) values
  ('a0000000-0000-0000-0000-00000000000a','proposta','proposta-a.pdf','a/proposta-a.pdf'),
  ('b0000000-0000-0000-0000-00000000000b','proposta','proposta-b.pdf','b/proposta-b.pdf');

set role authenticated;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';

do $$ begin
  perform public.afirma((select count(*) from public.clientes) = 1, 'cliente ve 1 cliente: o seu');
  perform public.afirma(
    (select nome from public.clientes) = 'Cliente A', 'e o cliente certo');
  perform public.afirma(
    (select count(*) from public.cliente_documentos) = 1, 'cliente ve so o proprio documento');
  perform public.afirma(
    (select count(*) from public.cliente_servicos) = 2, 'cliente ve os 2 servicos dele');
  perform public.afirma(
    (select count(*) from public.itens_aprovacao) = 2, 'cliente ve os itens dele');
  perform public.afirma(not public.usuario_ativo(), 'cliente NAO conta como equipe');
  perform public.afirma(public.usuario_cliente(),   'cliente conta como cliente');
end $$;

set "teste.uid" = '20000000-0000-0000-0000-00000000000b';
do $$ begin
  perform public.afirma((select count(*) from public.clientes) = 1, 'o outro cliente ve 1');
  perform public.afirma((select nome from public.clientes) = 'Cliente B', 'e o dele');
  perform public.afirma((select count(*) from public.itens_aprovacao) = 0,
    'cliente B nao ve item nenhum do cliente A');
  perform public.afirma((select count(*) from public.perfis) = 0, 'cliente nao ve a equipe');
end $$;

-- Cliente B nao consegue responder item do cliente A.
do $$
declare ok boolean := false;
begin
  begin
    perform public.responder_item('e1000000-0000-0000-0000-000000000001', 'aprovado', 'Carlos');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'cliente nao responde item de outro cliente');
end $$;

-- Equipe ve tudo.
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$ begin
  perform public.afirma((select count(*) from public.clientes) >= 2, 'equipe ve todos os clientes');
  perform public.afirma(public.usuario_ativo(), 'operacao e equipe ativa');
  perform public.afirma(not public.usuario_cliente(), 'equipe nao e cliente');
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 7. anon nao toca em nada
-- ---------------------------------------------------------------------------
do $$
declare t text; v text;
begin
  foreach t in array array[
    'convites','servicos','modulos','servico_modulos','cliente_servicos',
    'cliente_servico_modulos','cliente_documentos','clientes_usuarios',
    'itens_aprovacao','envios_aprovacao','envio_itens'
  ] loop
    foreach v in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      perform public.afirma(
        not has_table_privilege('anon', 'public.' || t, v),
        format('anon nao tem %s em %s', v, t));
    end loop;
  end loop;
end $$;

-- As funcoes de portao tambem nao sao chamaveis por anon.
do $$ begin
  perform public.afirma(not has_function_privilege('anon','public.cliente_tem_modulo(uuid,text)','execute'),
    'anon nao executa cliente_tem_modulo');
  perform public.afirma(not has_function_privilege('anon','public.clientes_do_usuario()','execute'),
    'anon nao executa clientes_do_usuario');
end $$;

select 'fundacao: tudo passou' as resultado;
