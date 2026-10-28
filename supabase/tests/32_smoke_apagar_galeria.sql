-- =============================================================================
-- Smoke da 0058 — arquivar e excluir galeria.
--
-- "nao tem como eu apagar a galeria". Nao tinha mesmo: `arquivada_em` existia
-- desde a 0034, os leitores a respeitavam, e nenhuma funcao a preenchia.
--
-- O que este teste cobra, e por que cada um importa:
--   1. arquivar tira do ar: o LINK para de abrir e o cliente nao ve na lista;
--   2. a EQUIPE continua vendo a arquivada — senao arquivar vira sumico, e nao
--      haveria como desarquivar;
--   3. desarquivar devolve o MESMO link ao ar. Arquivar e gaveta, nao revogacao;
--   4. quem edita NAO exclui, e a recusa ensina o caminho reversivel;
--   5. a direcao exclui: devolve os caminhos do balde para quem apaga o
--      arquivo, e o cascade leva itens, links e favoritos junto. Linha que
--      sobra apontando para arquivo apagado e miniatura quebrada na cara do
--      cliente.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'layana@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Direcao',  'admin',    true, 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Layana',   'operacao', true, 'layana@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('a0000000-0000-0000-0000-00000000000a', 'Club Confraria', 'club-confraria', 'America/Sao_Paulo');
insert into public.sessoes_captacao (id, cliente_id, titulo, data, status) values
  ('5e550000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a',
   'Confraria 23/09', current_date, 'realizada');

-- ---------------------------------------------------------------------------
-- 1, 2 e 3 — arquivar, ver arquivada, desarquivar
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- Layana, operacao

do $$
declare
  v_gal   uuid;
  v_item  uuid;
  v_token text;
  v_lista jsonb;
  ok      boolean;
begin
  v_gal := public.criar_galeria('5e550000-0000-0000-0000-00000000000a', 'Confraria 23/09', null);
  v_item := public.registrar_item_galeria(v_gal, 'DSC_0001.jpg', 'foto',
              v_gal || '/orig/1.jpg', 'image/jpeg', 514000,
              v_gal || '/mini/1.webp', null, 6000, 4000, null);
  select token into v_token from public.criar_link_galeria(v_gal);

  -- Antes de arquivar o link abre.
  reset role;
  perform public.afirma(public.galeria_por_token(v_token) is not null, 'o link abre antes');

  set role authenticated;
  set "teste.uid" = '10000000-0000-0000-0000-000000000002';
  perform public.arquivar_galeria(v_gal);
  perform public.afirma(
    (select arquivada_em from public.galerias where id = v_gal) is not null,
    'arquivar marca a data');

  -- 1. O link morre junto, sem precisar revogar nada.
  reset role;
  perform public.afirma(public.galeria_por_token(v_token) is null,
    'galeria arquivada para de abrir pelo link');

  -- 2. A equipe continua vendo, com a marca.
  set role authenticated;
  set "teste.uid" = '10000000-0000-0000-0000-000000000002';
  v_lista := public.galerias_do_cliente('a0000000-0000-0000-0000-00000000000a');
  perform public.afirma(jsonb_array_length(v_lista) = 1, 'a equipe continua vendo a arquivada');
  perform public.afirma(
    (v_lista->0->>'arquivadaEm') is not null,
    'e sabe que ela esta arquivada');

  -- 3. Desarquivar devolve o MESMO link ao ar.
  perform public.arquivar_galeria(v_gal, false);
  perform public.afirma(
    (select arquivada_em from public.galerias where id = v_gal) is null,
    'desarquivar limpa a data');
  reset role;
  perform public.afirma(public.galeria_por_token(v_token) is not null,
    'e o mesmo link volta a abrir — arquivar e gaveta, nao revogacao');

  -- 4. Quem edita nao exclui, e a recusa ensina o caminho reversivel.
  set role authenticated;
  set "teste.uid" = '10000000-0000-0000-0000-000000000002';
  begin
    perform public.excluir_galeria(v_gal);
    ok := false;
  exception when others then
    ok := position('direcao' in sqlerrm) > 0 and position('arquivar' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'quem edita nao exclui, e a recusa diz o que fazer no lugar');
  perform public.afirma(
    exists (select 1 from public.galerias where id = v_gal),
    'e a galeria continua inteira depois da recusa');
end $$;

-- ---------------------------------------------------------------------------
-- 5 — a direcao exclui
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000001';   -- Direcao, admin

do $$
declare
  v_gal  uuid;
  v_item uuid;
  v_link uuid;
  r      jsonb;
begin
  select g.id into v_gal from public.galerias g
    join public.sessoes_captacao s on s.id = g.sessao_id
   where s.cliente_id = 'a0000000-0000-0000-0000-00000000000a' limit 1;
  select i.id into v_item from public.galeria_itens i where i.galeria_id = v_gal limit 1;
  select l.id into v_link from public.links_galeria l where l.galeria_id = v_gal limit 1;

  insert into public.galeria_favoritos (galeria_id, item_id, quem)
  values (v_gal, v_item, 'Bruna');

  r := public.excluir_galeria(v_gal);

  perform public.afirma(r->>'titulo' = 'Confraria 23/09', 'a resposta diz o que foi apagado');
  perform public.afirma((r->>'itens')::int = 1, 'e quantos arquivos tinha');

  -- Os caminhos sao o que o navegador usa para tirar do balde. Sem eles, os
  -- arquivos ficariam ocupando espaco para sempre, sem linha que os aponte.
  perform public.afirma(
    r->'caminhos' @> to_jsonb(v_gal || '/orig/1.jpg'),
    'devolve o caminho do original');
  perform public.afirma(
    r->'caminhos' @> to_jsonb(v_gal || '/mini/1.webp'),
    'e o da miniatura');

  -- E o cascade levou tudo junto: linha orfa apontando para arquivo apagado e
  -- miniatura quebrada na cara de quem abrir.
  perform public.afirma(
    not exists (select 1 from public.galerias where id = v_gal),
    'a galeria sumiu');
  perform public.afirma(
    not exists (select 1 from public.galeria_itens where id = v_item),
    'os itens foram junto');
  perform public.afirma(
    not exists (select 1 from public.links_galeria where id = v_link),
    'os links foram junto');
  perform public.afirma(
    not exists (select 1 from public.galeria_favoritos where galeria_id = v_gal),
    'e os favoritos tambem');
end $$;

reset role;
select 'arquivar e excluir conferidos' as resultado;
