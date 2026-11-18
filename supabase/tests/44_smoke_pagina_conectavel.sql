-- =============================================================================
-- Smoke da 0074 — ligar a Página do Facebook a um cliente.
--
-- A dona: "conectei a astart mas la so da a opcao de conectar no insta".
--
-- O adaptador da Pagina existe desde a 0072, com nove testes, e estava
-- inalcancavel: nao havia caminho para ligar uma Pagina a um cliente. Nenhum
-- teste pegou porque TODOS criavam a conta com `insert` direto na tabela — o
-- unico jeito que ninguem usa de verdade. Este arquivo passa pela porta.
--
-- O que ele cobra:
--
--   1. da para ligar o Instagram E a Pagina do mesmo cliente, e as duas
--      linhas convivem. Antes nao cabiam: as duas carregam o MESMO `page_id`
--      (na linha do Instagram ele e o vinculo que a Meta exige), e o indice
--      unico global recusava a segunda com "duplicate key";
--   2. ligar a Pagina depois do Instagram NAO renomeia o Instagram — e este
--      e o motivo do arquivo. A busca de duplicata casava `page_id` sem olhar
--      a plataforma, achava a linha do Instagram e caia no `update`: o
--      destino do Facebook nunca nascia e a conta de Instagram passava a se
--      chamar pelo nome da Pagina. Silencioso, e na conta de um cliente;
--   3. a MESMA Pagina nao se liga duas vezes como Pagina;
--   4. e nao se liga a Pagina de um cliente em outro cliente;
--   5. depois das duas ligadas, `canais_do_cliente` oferece os formatos dos
--      dois — que e o que a tela mostra.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'direcao@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Layana', 'admin', true, 'direcao@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('20000000-0000-0000-0000-000000000001', 'Astart Studio', 'astart', 'America/Sao_Paulo'),
  ('20000000-0000-0000-0000-000000000002', 'Outro Cliente', 'outro',  'America/Sao_Paulo');

insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select c.id, s.id, 'recorrente', 100000, 10, current_date
  from public.clientes c, public.servicos s
 where s.chave = 'gestao_digital' and c.slug in ('astart', 'outro');

do $$
declare
  v_ig  jsonb;
  v_fb  jsonb;
  v_n   int;
  ok    boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  -- 1. O INSTAGRAM PRIMEIRO, como a pessoa faz.
  --
  -- Repare no `page_id`: a conta de Instagram guarda a Pagina a que esta
  -- vinculada. E dai que vem o choque do item 1.
  v_ig := public.salvar_conta_social(
    '20000000-0000-0000-0000-000000000001', 'instagram',
    'astart.studio', '17841400000777', '555000111');
  perform public.afirma((v_ig->>'novo')::boolean, 'o Instagram liga');

  -- AGORA A PAGINA, com o mesmo page_id. Antes da 0074 esta linha explodia
  -- com "duplicate key value violates contas_sociais_page_id_key".
  v_fb := public.salvar_conta_social(
    '20000000-0000-0000-0000-000000000001', 'facebook',
    'Astart Studio', null, '555000111');
  perform public.afirma((v_fb->>'novo')::boolean,
    'e a Pagina liga TAMBEM — antes nao cabia, as duas carregam o mesmo page_id');
  perform public.afirma((v_fb->>'id') <> (v_ig->>'id'),
    'e sao duas linhas, nao uma reaproveitada');

  -- 2. O INSTAGRAM NAO FOI RENOMEADO.
  --
  -- E o defeito que o arquivo existe para travar. A busca casava `page_id`
  -- sem olhar a plataforma, achava a linha do Instagram e a renomeava para
  -- "Astart Studio", sem criar destino nenhum no Facebook.
  perform public.afirma(
    (select nome_exibicao from public.contas_sociais where id = (v_ig->>'id')::uuid)
      = 'astart.studio',
    'ligar a Pagina NAO renomeia a conta de Instagram');
  perform public.afirma(
    (select plataforma::text from public.contas_sociais where id = (v_fb->>'id')::uuid) = 'facebook',
    'e a linha nova e mesmo de Facebook');
  perform public.afirma(
    (select ig_user_id is null from public.contas_sociais where id = (v_fb->>'id')::uuid),
    'e a Pagina nao herda o ig_user_id do vizinho');

  select count(*) into v_n from public.contas_sociais
   where cliente_id = '20000000-0000-0000-0000-000000000001';
  perform public.afirma(v_n = 2, 'o cliente fica com dois destinos');

  -- 3. A MESMA PAGINA NAO ENTRA DUAS VEZES.
  v_fb := public.salvar_conta_social(
    '20000000-0000-0000-0000-000000000001', 'facebook',
    'Astart Studio (de novo)', null, '555000111');
  perform public.afirma(not (v_fb->>'novo')::boolean,
    'ligar a mesma Pagina de novo atualiza, nao duplica');
  select count(*) into v_n from public.contas_sociais
   where cliente_id = '20000000-0000-0000-0000-000000000001';
  perform public.afirma(v_n = 2, 'e continua com dois destinos');

  -- 4. E NAO SE LIGA A PAGINA DE UM CLIENTE EM OUTRO.
  begin
    perform public.salvar_conta_social(
      '20000000-0000-0000-0000-000000000002', 'facebook', 'Roubada', null, '555000111');
    ok := false;
  exception when others then ok := position('outro cliente' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'Pagina ja ligada noutro cliente e recusada — senao o post sai no perfil errado');

  -- 5. OS DOIS DESTINOS APARECEM NA LISTA DE CANAIS.
  select count(*) into v_n
    from jsonb_array_elements(public.canais_do_cliente('20000000-0000-0000-0000-000000000001')) x
   where x->>'plataforma' = 'facebook' and (x->>'publicavel')::boolean;
  perform public.afirma(v_n = 2,
    'a Pagina oferece os dois formatos que ela publica: foto e album');

  select count(*) into v_n
    from jsonb_array_elements(public.canais_do_cliente('20000000-0000-0000-0000-000000000001')) x
   where x->>'plataforma' = 'instagram' and (x->>'publicavel')::boolean;
  perform public.afirma(v_n = 4, 'e o Instagram continua com os quatro');
end $$;
