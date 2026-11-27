-- =============================================================================
-- Smoke da 0089 — tirar UMA foto da galeria.
--
-- A dona: "as vezes mando foto errada".
--
-- O QUE JUSTIFICA O ARQUIVO nao e o `delete` funcionar: a politica de RLS ja
-- deixava apagar a linha. E o que vem junto do `delete`:
--
--   1. os CAMINHOS voltam — os tres, original, miniatura e poster. Sem eles
--      o arquivo fica no balde ocupando espaco para sempre, que foi como
--      175 MB viraram lixo invisivel em outubro;
--   2. a foto removida some da galeria do cliente, pelo link, na hora;
--   3. tirar a CAPA nao quebra a galeria — ela volta a mostrar a primeira
--      foto, e a funcao avisa que era a capa;
--   4. o coracao do cliente naquela foto vai junto (cascade) e o registro de
--      download SOBREVIVE com item nulo: baixar aconteceu, e apagar a foto
--      depois nao desfaz isso. Esse par `on delete set null` + tabela
--      append-only foi o que travou o apagar da cobranca na 0085, entao aqui
--      ele e cobrado, nao suposto;
--   5. o CLIENTE nao tira foto nenhuma. Ele recebeu um link para ver e
--      escolher;
--   6. tirar foto que nao existe mais recusa com recado, em vez de passar
--      calado.
--
-- O 1 e o 5 sao os que justificam o arquivo.
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
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000002','Layana','operacao','layana@astartstudio.com.br');
insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a','Padaria Aurora','aurora');
insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('20000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a',
   'Bruna','bruna@clientea.com.br');

insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, parcelas, inicio)
select 'a0000000-0000-0000-0000-00000000000a', s.id, 'pontual', 240000, 1, current_date
  from public.servicos s where s.chave = 'audiovisual';

insert into public.sessoes_captacao (id, cliente_id, titulo, data, status) values
  ('5e550000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a',
   'Captação na padaria', current_date, 'realizada');

set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';

do $$
declare
  v_gal   uuid;
  v_certa uuid;
  v_errada uuid;
  v_r     jsonb;
  ok      boolean;
begin
  v_gal := public.criar_galeria('5e550000-0000-0000-0000-00000000000a',
             'Ensaio Dona Zilda', 'Separe as suas preferidas.');

  v_certa := public.registrar_item_galeria(v_gal, 'DSC_0001.jpg', 'foto',
    'a0000000-0000-0000-0000-00000000000a/' || v_gal || '/DSC_0001.jpg',
    'image/jpeg', 4000000,
    'a0000000-0000-0000-0000-00000000000a/' || v_gal || '/mini/DSC_0001.jpg');

  v_errada := public.registrar_item_galeria(v_gal, 'ERRADA.jpg', 'foto',
    'a0000000-0000-0000-0000-00000000000a/' || v_gal || '/ERRADA.jpg',
    'image/jpeg', 3000000,
    'a0000000-0000-0000-0000-00000000000a/' || v_gal || '/mini/ERRADA.jpg');

  -- A primeira vira capa sozinha (0034). Ponho a ERRADA de capa de proposito:
  -- e o caso ruim de verdade — mandar a foto errada E deixar ela na capa.
  perform public.definir_capa_galeria(v_gal, v_errada);

  -- O cliente ja viu e ja mexeu: coracao numa, download na outra. Escrito
  -- direto na tabela, e nao pelas funcoes do link, porque quem esta logado
  -- aqui e a equipe — e o que este teste precisa e do ESTADO (ha um coracao e
  -- ha um download apontando para a foto errada), nao do caminho ate ele.
  insert into public.galeria_favoritos (galeria_id, item_id, quem)
  values (v_gal, v_errada, 'Bruna');
  insert into public.galeria_downloads (galeria_id, item_id, quem)
  values (v_gal, v_errada, 'Bruna');

  -- 1. OS CAMINHOS VOLTAM -------------------------------------------------
  v_r := public.remover_item_galeria(v_errada);

  perform public.afirma(jsonb_array_length(v_r->'caminhos') = 2,
    format('tinham de voltar 2 caminhos (original e miniatura), vieram %s',
           jsonb_array_length(v_r->'caminhos')));
  perform public.afirma(
    (v_r->'caminhos') @> to_jsonb(
      'a0000000-0000-0000-0000-00000000000a/' || v_gal || '/ERRADA.jpg'),
    'o caminho do original nao voltou — o arquivo ficaria no balde');
  perform public.afirma(
    (v_r->'caminhos') @> to_jsonb(
      'a0000000-0000-0000-0000-00000000000a/' || v_gal || '/mini/ERRADA.jpg'),
    'o caminho da miniatura nao voltou — ela ficaria no balde');
  perform public.afirma(v_r->>'nome' = 'ERRADA.jpg', 'a funcao nao disse qual foto saiu');
  perform public.afirma((v_r->>'sobram')::int = 1, 'a conta do que sobrou saiu errada');

  -- 2. sumiu da galeria ---------------------------------------------------
  perform public.afirma(
    not exists (select 1 from public.galeria_itens where id = v_errada),
    'a linha da foto continua no banco');

  -- 3. a capa: a funcao avisa, e a galeria nao quebra ---------------------
  perform public.afirma((v_r->>'eraCapa')::boolean,
    'a funcao nao avisou que a foto removida era a capa');
  perform public.afirma(
    (select capa_item_id is null from public.galerias where id = v_gal),
    'a capa continua apontando para uma foto que nao existe');

  -- 4. coracao vai, download fica -----------------------------------------
  perform public.afirma(
    not exists (select 1 from public.galeria_favoritos where item_id = v_errada),
    'o coracao do cliente sobreviveu a foto');
  perform public.afirma(
    exists (select 1 from public.galeria_downloads
             where galeria_id = v_gal and item_id is null),
    'o registro de download sumiu — baixar aconteceu e isso nao se apaga');

  -- 6. foto que nao existe mais -------------------------------------------
  ok := false;
  begin
    perform public.remover_item_galeria(v_errada);
  exception when others then ok := position('não existe mais' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'tirar foto que ja saiu passou calado');

  perform public.afirma(
    (select nome from public.galeria_itens where galeria_id = v_gal) = 'DSC_0001.jpg',
    'sobrou a foto errada no lugar da certa');
end $$;

-- ---------------------------------------------------------------------------
-- 5. O CLIENTE NAO TIRA FOTO NENHUMA
-- ---------------------------------------------------------------------------
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';

do $$
declare
  v_item uuid;
  ok     boolean;
begin
  -- Pelas lentes do RLS: o cliente ve a que ficou e NAO ve a que saiu. Esta
  -- e a prova de que a remocao chega ate a tela dele, e nao so ao banco.
  perform public.afirma((select count(*) from public.galeria_itens) = 1,
    'o cliente nao ve exatamente uma foto depois da remocao');
  select id into v_item from public.galeria_itens limit 1;
  perform public.afirma(
    (select nome from public.galeria_itens where id = v_item) = 'DSC_0001.jpg',
    'o cliente esta vendo a foto errada');

  ok := false;
  begin
    perform public.remover_item_galeria(v_item);
  exception when others then ok := position('não tira foto' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'o CLIENTE apagou uma foto da propria entrega');
  perform public.afirma(exists (select 1 from public.galeria_itens where id = v_item),
    'a foto sumiu mesmo com a recusa');
end $$;

-- E anon nem chega perto.
reset role;
do $$ begin
  perform public.afirma(
    not has_function_privilege('anon','public.remover_item_galeria(uuid)','execute'),
    'anon chama remover_item_galeria');
end $$;

select 'ok 52_smoke_tirar_foto_da_galeria' as resultado;
