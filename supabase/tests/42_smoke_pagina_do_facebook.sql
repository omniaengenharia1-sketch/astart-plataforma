-- =============================================================================
-- Smoke da 0072 — a Pagina do Facebook publicando.
--
-- A 0072 existe porque a dona disse "preciso do Facebook, nao so do
-- Instagram", e porque o `pages_manage_posts` so se justifica no App Review se
-- o video mostrar um post saindo numa Pagina.
--
-- O que este arquivo cobra:
--
--   1. foto e album publicam na Pagina; reel e story nao, dizendo por que;
--   2. com a restricao da tabela DERRUBADA de proposito, a funcao ainda
--      recusa Pagina sem `page_id` — e a segunda barreira valendo sozinha;
--   3. `conta_tem_identificador` devolve NULO para plataforma que ela nao
--      conhece — some da contagem em vez de passar por boa calada;
--   4. criar peca de reel para a Pagina continua recusado, antes de gravar.
--
-- SOBRE O ITEM 2, E ESTA E A PARTE QUE EU ERREI PRIMEIRO. Eu escrevi este
-- arquivo afirmando que uma conta de Pagina sem `page_id` existia e quebrava
-- na hora de publicar. Nao existe: a tabela tem, desde a 0002, a restricao
-- `contas_sociais_ids_por_plataforma`, e foi ela que derrubou o insert quando
-- rodei. A linha so pode nascer derrubando a restricao — que e o que o item 2
-- faz, de proposito. Segunda barreira so se prova sem a primeira.
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
  ('20000000-0000-0000-0000-000000000001', 'Mor Marcas', 'mor', 'America/Sao_Paulo'),
  -- Cliente so com a Pagina QUEBRADA, para o item 3 poder medir a contagem
  -- sem uma conta boa de Instagram mascarando o resultado.
  ('20000000-0000-0000-0000-000000000002', 'So Quebrada', 'quebrada', 'America/Sao_Paulo');

insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select c.id, s.id, 'recorrente', 150000, 10, current_date
  from public.clientes c, public.servicos s
 where s.chave = 'gestao_digital' and c.slug in ('mor', 'quebrada');

insert into public.contas_sociais
  (id, cliente_id, plataforma, nome_exibicao, ig_user_id, page_id, ativo, acesso_parceiro)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'facebook',  'Mor Marcas',   null, '778899', true, 'concedido'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
   -- page_id proprio: a coluna e UNICA, e repetir o da conta de cima
   -- derruba o insert antes de o teste comecar.
   'instagram', 'mor.marcas',   '1784140000001', '778900', true, 'concedido');

do $$
declare
  v_ok   boolean;
  v_mot  text;
  v_n    int;
  v_post uuid;
  ok     boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  -- 1. FOTO E ALBUM PUBLICAM; VIDEO NAO.
  select publicavel, motivo into v_ok, v_mot
    from public.canal_publicavel('30000000-0000-0000-0000-000000000001', 'imagem');
  perform public.afirma(v_ok, 'foto na Pagina publica');

  select publicavel into v_ok
    from public.canal_publicavel('30000000-0000-0000-0000-000000000001', 'carrossel');
  perform public.afirma(v_ok, 'album de fotos na Pagina publica');

  select publicavel, motivo into v_ok, v_mot
    from public.canal_publicavel('30000000-0000-0000-0000-000000000001', 'reel');
  perform public.afirma(not v_ok, 'reel na Pagina nao publica');
  perform public.afirma(position('protocolo' in v_mot) > 0,
    'e diz por que: video da Pagina usa outro protocolo de envio');

  select publicavel, motivo into v_ok, v_mot
    from public.canal_publicavel('30000000-0000-0000-0000-000000000001', 'story');
  perform public.afirma(not v_ok, 'story na Pagina nao publica');

  -- 2. A SEGUNDA BARREIRA, PROVADA SEM A PRIMEIRA.
  --
  -- A tabela ja recusa Pagina sem `page_id` desde a 0002
  -- (`contas_sociais_ids_por_plataforma`), e foi ela que derrubou este teste
  -- na primeira vez que rodei. Entao a unica forma de provar que a FUNCAO
  -- segura sozinha e tirar a restricao primeiro — que e o cenario do dia em
  -- que alguem a derrubar numa migration.
  --
  -- A restricao volta logo abaixo: teste que deixa o banco diferente de como
  -- encontrou contamina o proximo bloco.
  alter table public.contas_sociais drop constraint contas_sociais_ids_por_plataforma;
  insert into public.contas_sociais
    (id, cliente_id, plataforma, nome_exibicao, ig_user_id, page_id, ativo, acesso_parceiro)
  values
    ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002',
     'facebook', 'Sem Id', null, null, true, 'concedido');

  select publicavel, motivo into v_ok, v_mot
    from public.canal_publicavel('30000000-0000-0000-0000-000000000003', 'imagem');
  perform public.afirma(not v_ok,
    'sem a restricao da tabela, a funcao ainda recusa Pagina sem id');
  perform public.afirma(position('Página' in v_mot) > 0,
    'e a frase fala da Pagina, nao do Instagram: mensagem errada manda conferir a coisa errada');

  -- E ela tambem nao conta como "o cliente tem conta conectada": o cliente
  -- 'quebrada' so tem essa, entao agendar tem de ser recusado.
  --
  -- A MIDIA PRECISA ESTAR ANEXADA, e isso custou uma rodada: sem arquivo, o
  -- `agendar_publicacao` recusa antes, com "Falta arquivo: imagem pede 1 e
  -- tem 0", e o teste passaria verde sem nunca ter chegado no guarda que ele
  -- diz estar cobrando. Teste que para na porta errada nao prova nada.
  v_post := (public.criar_publicacao(
    '20000000-0000-0000-0000-000000000002', 'Foto sem destino', 'imagem',
    'oi', null, false, null)->>'id')::uuid;

  insert into public.post_midias (post_id, ordem, storage_path, mime)
  values (v_post, 0, '20000000-0000-0000-0000-000000000002/' || v_post || '/foto.jpg', 'image/jpeg');

  begin
    perform public.agendar_publicacao(v_post, now() + interval '1 day');
    ok := false;
  exception when others then
    ok := position('conta conectada' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'cliente cuja unica conta e uma Pagina sem id nao agenda — ele nao tem destino de verdade');

  delete from public.contas_sociais where id = '30000000-0000-0000-0000-000000000003';
  alter table public.contas_sociais add constraint contas_sociais_ids_por_plataforma check (
    (plataforma = 'instagram' and ig_user_id is not null)
    or
    (plataforma = 'facebook'  and page_id    is not null)
  );

  -- 3. PLATAFORMA DESCONHECIDA DEVOLVE NULO, NAO `true`.
  perform public.afirma(
    public.conta_tem_identificador('instagram', '123', null) is true,
    'Instagram com id: boa');
  perform public.afirma(
    public.conta_tem_identificador('instagram', null, '999') is not true,
    'Instagram sem ig_user_id: nao boa, mesmo tendo page_id');
  perform public.afirma(
    public.conta_tem_identificador('facebook', null, '999') is true,
    'Pagina com page_id: boa');
  perform public.afirma(
    public.conta_tem_identificador('facebook', '123', null) is not true,
    'Pagina sem page_id: nao boa, mesmo tendo ig_user_id');

  -- 4. REEL PARA A PAGINA CONTINUA RECUSADO ANTES DE GRAVAR A PECA.
  begin
    perform public.criar_publicacao(
      '20000000-0000-0000-0000-000000000001', 'Reel na Pagina', 'reel',
      'oi', null, false, array['30000000-0000-0000-0000-000000000001'::uuid]);
    ok := false;
  exception when others then ok := position('protocolo' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'reel na Pagina e recusado na criacao, dizendo por que');
  perform public.afirma(
    not exists (select 1 from public.posts where titulo_interno = 'Reel na Pagina'),
    'e a peca nao fica meio criada no banco');

  -- E a conta boa de Instagram do mesmo cliente nao foi afetada por nada disso.
  select count(*) into v_n
    from public.canal_publicavel('30000000-0000-0000-0000-000000000002', 'reel')
   where publicavel;
  perform public.afirma(v_n = 1, 'reel no Instagram continua publicando');
end $$;
