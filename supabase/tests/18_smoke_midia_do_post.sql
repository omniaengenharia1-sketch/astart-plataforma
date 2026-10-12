-- =============================================================================
-- Smoke da 0038: quem le a midia de um post.
--
--   1. a equipe ativa continua lendo tudo (era o unico caso antes da 0038);
--   2. o cliente le a midia do PROPRIO post;
--   3. e nao le a do vizinho — nem sabendo o caminho;
--   4. cliente sem Grid nem Calendario no contrato nao le a sua propria:
--      contrato encerrado nao apaga arquivo, mas fecha a porta;
--   5. caminho torto nao estoura a politica. Esta e a parte que importa: a
--      funcao roda dentro do `using` do bucket, e um cast que levanta excecao
--      ali derrubaria TODA leitura de storage, para todo mundo.
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
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br'),
  ('20000000-0000-0000-0000-00000000000b', 'carlos@clienteb.com.br'),
  ('20000000-0000-0000-0000-00000000000c', 'dani@clientec.com.br');

insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000002','Layana','operacao','layana@astartstudio.com.br');

insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a','Padaria Aurora','aurora'),
  ('b0000000-0000-0000-0000-00000000000b','Bloco B','bloco-b'),
  ('c0000000-0000-0000-0000-00000000000c','Estudio Ceu','estudio-ceu');

insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('20000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Bruna','bruna@clientea.com.br'),
  ('20000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-00000000000b','Carlos','carlos@clienteb.com.br'),
  ('20000000-0000-0000-0000-00000000000c','c0000000-0000-0000-0000-00000000000c','Dani','dani@clientec.com.br');

-- A e B tem Gestao Digital: calendario, grid e publicacao.
insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select c.id, s.id, 'recorrente', 280000, 10, current_date
  from public.clientes c, public.servicos s
 where s.chave = 'gestao_digital'
   and c.id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');

-- C so tem Audiovisual: tem Galeria, nao tem Grid nem Calendario.
insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, parcelas, inicio)
select c.id, s.id, 'pontual', 240000, 1, current_date
  from public.clientes c, public.servicos s
 where s.chave = 'audiovisual' and c.id = 'c0000000-0000-0000-0000-00000000000c';

do $$ begin
  perform public.afirma(
    public.cliente_tem_modulo('a0000000-0000-0000-0000-00000000000a', 'grid'),
    'A tem grid pelo contrato');
  perform public.afirma(
    not public.cliente_tem_modulo('c0000000-0000-0000-0000-00000000000c', 'grid')
    and not public.cliente_tem_modulo('c0000000-0000-0000-0000-00000000000c', 'calendario'),
    'C nao tem grid nem calendario — so audiovisual');
end $$;

-- Os arquivos. Convencao da 0008: {cliente_id}/{post_id}/{ordem}-{arquivo}.
-- Inseridos como dono da tabela, que e quem o worker representa.
insert into storage.objects (bucket_id, name) values
  ('midias-posts', 'a0000000-0000-0000-0000-00000000000a/99990000-0000-0000-0000-000000000001/1-feed.jpg'),
  ('midias-posts', 'b0000000-0000-0000-0000-00000000000b/99990000-0000-0000-0000-000000000002/1-feed.jpg'),
  ('midias-posts', 'c0000000-0000-0000-0000-00000000000c/99990000-0000-0000-0000-000000000003/1-feed.jpg'),
  -- Arquivo com nome fora da convencao: existia antes de haver convencao.
  ('midias-posts', 'solto.jpg');

-- ---------------------------------------------------------------------------
-- O caminho entrega o cliente, e caminho torto nao vira cliente nenhum
-- ---------------------------------------------------------------------------
do $$ begin
  perform public.afirma(
    public.cliente_do_caminho_midia(
      'a0000000-0000-0000-0000-00000000000a/99990000-0000-0000-0000-000000000001/1-feed.jpg')
      = 'a0000000-0000-0000-0000-00000000000a',
    'o primeiro pedaco do caminho e o cliente');
  perform public.afirma(public.cliente_do_caminho_midia('solto.jpg') is null,
    'nome sem pasta nao vira cliente');
  perform public.afirma(public.cliente_do_caminho_midia('') is null,
    'caminho vazio nao vira cliente');
  perform public.afirma(public.cliente_do_caminho_midia(null) is null,
    'caminho nulo nao vira cliente');
  perform public.afirma(
    public.cliente_do_caminho_midia('nao-e-uuid/post/1.jpg') is null,
    'pasta que nao e uuid nao estoura no cast');
end $$;

set role authenticated;

-- ---------------------------------------------------------------------------
-- 1. a equipe
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$ begin
  perform public.afirma(
    (select count(*) from storage.objects where bucket_id = 'midias-posts') = 4,
    'a equipe le os quatro arquivos, inclusive o de nome solto');
end $$;

-- ---------------------------------------------------------------------------
-- 2 e 3. o cliente A
-- ---------------------------------------------------------------------------
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$
declare v_nomes text[];
begin
  select array_agg(name order by name) into v_nomes
    from storage.objects where bucket_id = 'midias-posts';

  perform public.afirma(array_length(v_nomes, 1) = 1,
    'o cliente A le um arquivo, nao quatro');
  perform public.afirma(
    v_nomes[1] like 'a0000000-0000-0000-0000-00000000000a/%',
    'e o arquivo que le e o da pasta dele');

  -- A pergunta direta, com o caminho do vizinho na mao: nao e por obscuridade
  -- que o arquivo do outro nao abre.
  perform public.afirma(
    not exists (select 1 from storage.objects
                 where name = 'b0000000-0000-0000-0000-00000000000b/99990000-0000-0000-0000-000000000002/1-feed.jpg'),
    'sabendo o caminho exato, o arquivo do vizinho continua fechado');
end $$;

-- ---------------------------------------------------------------------------
-- 4. o cliente C, sem Grid nem Calendario
-- ---------------------------------------------------------------------------
set "teste.uid" = '20000000-0000-0000-0000-00000000000c';
do $$ begin
  perform public.afirma(
    (select count(*) from storage.objects where bucket_id = 'midias-posts') = 0,
    'sem Grid nem Calendario no contrato, o cliente nao le nem a sua propria midia');
end $$;

-- ---------------------------------------------------------------------------
-- 5. e nada disso estoura
-- ---------------------------------------------------------------------------
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$ begin
  -- Se o cast de 'solto.jpg' levantasse excecao dentro da politica, esta
  -- consulta nao devolveria zero: morreria.
  perform public.afirma(
    (select count(*) from storage.objects where name = 'solto.jpg') = 0,
    'arquivo de nome torto fica invisivel para o cliente, sem derrubar a leitura');
end $$;

reset role;

do $$ begin
  perform public.afirma(
    (select not public from storage.buckets where id = 'midias-posts'),
    'o bucket das midias continua privado');
  perform public.afirma(
    not has_function_privilege('anon','public.usuario_ve_midia_do_post(uuid)','execute'),
    'anon nao pergunta nada a esta funcao');
end $$;

select 'midia do post: tudo passou' as resultado;
