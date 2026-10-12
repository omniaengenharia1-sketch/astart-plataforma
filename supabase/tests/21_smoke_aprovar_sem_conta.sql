-- =============================================================================
-- Smoke da 0041: aprovar sem ter conta. O que este teste cobra:
--   1. o link abre o lote, e so o lote daquele envio;
--   2. a resposta pelo token entra igual a do portal, com o nome de quem foi;
--   3. item de OUTRO lote do mesmo cliente nao responde por este token — token
--      vazado nao e chave do cliente inteiro;
--   4. token errado nao abre nada e nao conta se o lote existe;
--   5. link revogado deixa de abrir — como nada vence, revogar e a unica saida;
--   6. quando o ultimo item e respondido, o lote fecha e o link vira leitura;
--   7. o navegador de quem recebeu o link nao alcanca as funcoes: so a Edge
--      Function (service_role) chama.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000002', 'layana@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000002','Layana','operacao','layana@astartstudio.com.br');

insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a','Padaria Aurora','aurora');

insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select 'a0000000-0000-0000-0000-00000000000a', s.id, 'recorrente', 280000, 10, current_date
  from public.servicos s where s.chave = 'gestao_digital';

insert into public.itens_aprovacao (id, cliente_id, tipo, titulo) values
  ('11110000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','peca','Frase da semana'),
  ('11110000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','peca','Making of'),
  -- Este vai para um SEGUNDO lote: e com ele que se prova que o token nao e
  -- chave do cliente inteiro.
  ('11110000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000a','peca','Depoimento');

set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------------------
-- A equipe manda dois lotes e cria o link do primeiro
-- ---------------------------------------------------------------------------
do $$
declare
  v_um    jsonb;
  v_dois  jsonb;
  v_link  record;
begin
  v_um := public.enviar_para_aprovacao(
    array['11110000-0000-0000-0000-000000000001'::uuid,
          '11110000-0000-0000-0000-000000000002'::uuid],
    'Separei duas pra essa semana.');
  v_dois := public.enviar_para_aprovacao(
    array['11110000-0000-0000-0000-000000000003'::uuid], null);

  perform public.afirma((v_um->>'enviados')::int = 2, 'o primeiro lote saiu com dois itens');

  select * into v_link from public.criar_link_aprovacao((v_um->>'envioId')::uuid);
  perform public.afirma(length(v_link.token) = 64, 'o token tem 64 hex');
  perform public.afirma(
    (select count(*) from public.links_aprovacao where token_hash = v_link.token) = 0,
    'e o token em claro NAO esta no banco: la mora o hash');

  perform set_config('teste.token', v_link.token, false);
  perform set_config('teste.link', v_link.link_id::text, false);
  perform set_config('teste.envio2', v_dois->>'envioId', false);
end $$;

-- ---------------------------------------------------------------------------
-- 7. e o navegador de quem recebeu o link nao alcanca nada disso
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  begin
    perform public.envio_por_token(current_setting('teste.token'));
    raise exception 'FALHOU: authenticated chamou envio_por_token';
  exception when insufficient_privilege then
    ok := true;
  end;
  perform public.afirma(ok, 'quem esta logado nao le o lote por token: quem le e a Edge Function');
end $$;

-- ---------------------------------------------------------------------------
-- 1, 2, 3 e 4. agora como a Edge Function
-- ---------------------------------------------------------------------------
reset role;
set role service_role;
set "teste.uid" = '';   -- service_role nao tem auth.uid(), e a 0017 conta com isso

do $$
declare
  v_lote jsonb;
  ok boolean;
begin
  v_lote := public.envio_por_token(current_setting('teste.token'));
  perform public.afirma(v_lote is not null, 'o link abre');
  perform public.afirma(v_lote->>'cliente' = 'Padaria Aurora', 'com o nome do cliente');
  perform public.afirma(v_lote->>'mensagem' = 'Separei duas pra essa semana.', 'e o recado do envio');
  perform public.afirma(jsonb_array_length(v_lote->'itens') = 2,
    'com os dois itens DO LOTE, nao os tres do cliente');
  perform public.afirma((v_lote->>'fechado')::boolean is false, 'e o lote esta aberto');

  -- Abrir conta acesso: "ele nem abriu" e diferente de "abriu e nao respondeu".
  perform public.afirma(
    (select acessos from public.links_aprovacao
      where id = current_setting('teste.link')::uuid) = 1,
    'abrir conta um acesso');

  -- 4. token errado: nulo, e sem contar que existem outros
  perform public.afirma(public.envio_por_token(repeat('f', 64)) is null,
    'token errado nao abre nada');
  perform public.afirma(public.envio_por_token('curto') is null,
    'token curto nem consulta a tabela');
  perform public.afirma(public.envio_por_token(null) is null, 'e nulo tambem nao');

  -- 3. item de outro lote do MESMO cliente
  begin
    perform public.responder_por_token(current_setting('teste.token'),
      '11110000-0000-0000-0000-000000000003', 'aprovado', 'Bruna');
    raise exception 'FALHOU: respondeu item de outro lote';
  exception when others then
    if position('deste link' in sqlerrm) = 0 then raise; end if;
    ok := true;
  end;
  perform public.afirma(ok, 'token vazado nao e chave do cliente inteiro');

  -- 2. a regra do ajuste vale aqui tambem: ela mora na 0017, nao na tela
  begin
    perform public.responder_por_token(current_setting('teste.token'),
      '11110000-0000-0000-0000-000000000001', 'com_ajustes', 'Bruna');
    raise exception 'FALHOU: pediu ajuste sem dizer o que mudar';
  exception when others then
    if position('exige um comentario' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.responder_por_token(current_setting('teste.token'),
      '11110000-0000-0000-0000-000000000001', 'com_ajustes', '  ', 'trocar a foto');
    raise exception 'FALHOU: respondeu sem nome';
  exception when others then
    if position('Diga o seu nome' in sqlerrm) = 0 then raise; end if;
  end;

  perform public.responder_por_token(current_setting('teste.token'),
    '11110000-0000-0000-0000-000000000001', 'com_ajustes', 'Bruna Melo',
    'A foto do primeiro quadro ficou escura.');

  perform public.afirma(
    (select estado::text from public.itens_aprovacao
      where id = '11110000-0000-0000-0000-000000000001') = 'com_ajustes',
    'a resposta entrou');
  perform public.afirma(
    (select respondido_por from public.itens_aprovacao
      where id = '11110000-0000-0000-0000-000000000001') = 'Bruna Melo',
    'com o nome que ela digitou — e o que a equipe le na fila');
  perform public.afirma(
    (select texto from public.aprovacao_comentarios
      where item_id = '11110000-0000-0000-0000-000000000001') = 'A foto do primeiro quadro ficou escura.',
    'e o comentario virou registro');

  -- Responder duas vezes o mesmo item nao reabre nada.
  begin
    perform public.responder_por_token(current_setting('teste.token'),
      '11110000-0000-0000-0000-000000000001', 'aprovado', 'Bruna Melo');
    raise exception 'FALHOU: respondeu o mesmo item duas vezes';
  exception when others then
    if position('nao esta em aprovacao' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 6. o ultimo item fecha o lote, e o link vira leitura
-- ---------------------------------------------------------------------------
do $$
declare v_lote jsonb;
begin
  perform public.responder_por_token(current_setting('teste.token'),
    '11110000-0000-0000-0000-000000000002', 'aprovado', 'Bruna Melo');

  v_lote := public.envio_por_token(current_setting('teste.token'));
  perform public.afirma((v_lote->>'fechado')::boolean,
    'respondido o ultimo item, o lote fecha');
  perform public.afirma(jsonb_array_length(v_lote->'itens') = 2,
    'e o link continua abrindo: vira leitura, nao erro');
  perform public.afirma(
    (select x->>'comentario' from jsonb_array_elements(v_lote->'itens') x
      where x->>'id' = '11110000-0000-0000-0000-000000000001')
      = 'A foto do primeiro quadro ficou escura.',
    'com o que ela pediu, para quem abrir de novo lembrar');
end $$;

-- ---------------------------------------------------------------------------
-- 5. revogar
-- ---------------------------------------------------------------------------
reset role;
set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';

do $$
declare v jsonb;
begin
  v := public.envios_do_cliente('a0000000-0000-0000-0000-00000000000a');
  perform public.afirma(jsonb_array_length(v) = 2, 'a equipe ve os dois lotes');
  perform public.afirma(
    (select (x->'links'->0->>'acessos')::int from jsonb_array_elements(v) x
      where jsonb_array_length(x->'links') > 0) = 2,
    'e quantas vezes o link foi aberto');

  perform public.revogar_link_aprovacao(current_setting('teste.link')::uuid);
end $$;

reset role;
set role service_role;
set "teste.uid" = '';
do $$ begin
  perform public.afirma(public.envio_por_token(current_setting('teste.token')) is null,
    'link revogado deixa de abrir');
end $$;

reset role;

do $$ begin
  perform public.afirma(
    not has_function_privilege('anon','public.envio_por_token(text)','execute'),
    'anon nao chama envio_por_token');
  perform public.afirma(
    not has_function_privilege('authenticated','public.responder_por_token(text, uuid, public.estado_aprovacao, text, text)','execute'),
    'nem quem esta logado: o caminho do link e a Edge Function');
  perform public.afirma(
    has_function_privilege('service_role','public.envio_por_token(text)','execute'),
    'so service_role');
end $$;

select 'aprovar sem conta: tudo passou' as resultado;
