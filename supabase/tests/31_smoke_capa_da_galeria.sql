-- =============================================================================
-- Smoke da 0057 — a capa da galeria.
--
-- A coluna `capa_item_id` existia desde a 0034 e ninguem nunca conseguiu mexer
-- nela: a `registrar_item_galeria` punha a primeira foto e ficava assim para
-- sempre. A dona pediu escolher ("colocar uma capa que eu possa selecionar das
-- fotos do cliente"), e isto cobra as recusas que importam.
--
-- O que este teste cobra:
--   1. a primeira foto vira capa sozinha, como na 0034 — isso nao pode ter
--      quebrado;
--   2. a equipe troca a capa, e a leitura do visitante devolve a nova;
--   3. foto de OUTRA galeria e recusada. Sem isto, a capa de uma entrega
--      apontaria para a foto de outro cliente, e o caminho assinado sairia
--      junto na resposta publica;
--   4. video nao vira capa, e arquivo que ainda esta subindo tambem nao;
--   5. quem nao edita nao troca capa nenhuma.
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
  ('10000000-0000-0000-0000-000000000009', 'visita@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Direcao', 'admin', true, 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000009', 'Visita', 'leitura', true, 'visita@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('a0000000-0000-0000-0000-00000000000a', 'Padaria Aurora', 'padaria-aurora', 'America/Sao_Paulo'),
  ('b0000000-0000-0000-0000-00000000000b', 'Club Confraria', 'club-confraria', 'America/Sao_Paulo');

insert into public.sessoes_captacao (id, cliente_id, titulo, data, status) values
  ('5e550000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a',
   'Captacao na padaria', current_date, 'realizada'),
  ('5e550000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-00000000000b',
   'Confraria 23/09', current_date, 'realizada');

set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000001';

do $$
declare
  v_a     uuid;
  v_b     uuid;
  v_foto1 uuid;
  v_foto2 uuid;
  v_video uuid;
  v_outra uuid;
  v_token text;
  g       jsonb;
  ok      boolean;
begin
  v_a := public.criar_galeria('5e550000-0000-0000-0000-00000000000a', 'Padaria outubro', null);
  v_b := public.criar_galeria('5e550000-0000-0000-0000-00000000000b', 'Confraria 23/09', null);

  v_foto1 := public.registrar_item_galeria(v_a, 'DSC_0001.jpg', 'foto',
               v_a || '/orig/1.jpg', 'image/jpeg', 500000,
               v_a || '/mini/1.webp', null, 6000, 4000, null);
  v_foto2 := public.registrar_item_galeria(v_a, 'DSC_0002.jpg', 'foto',
               v_a || '/orig/2.jpg', 'image/jpeg', 520000,
               v_a || '/mini/2.webp', null, 4000, 6000, null);
  v_video := public.registrar_item_galeria(v_a, 'clipe.mp4', 'video',
               v_a || '/orig/3.mp4', 'video/mp4', 90000000,
               v_a || '/mini/3.webp', v_a || '/mini/3.webp', 1920, 1080, 42);
  v_outra := public.registrar_item_galeria(v_b, 'DSC_9999.jpg', 'foto',
               v_b || '/orig/9.jpg', 'image/jpeg', 480000,
               v_b || '/mini/9.webp', null, 6000, 4000, null);

  -- 1. O comportamento da 0034 continua: a primeira foto entra sozinha.
  perform public.afirma(
    (select capa_item_id from public.galerias where id = v_a) = v_foto1,
    'a primeira foto vira capa sozinha, como antes');

  -- 2. A equipe troca.
  perform public.definir_capa_galeria(v_a, v_foto2);
  perform public.afirma(
    (select capa_item_id from public.galerias where id = v_a) = v_foto2,
    'a equipe troca a capa');

  -- 3. Foto de OUTRA galeria e recusada. E a recusa que mais importa: sem ela,
  -- a resposta publica de um cliente carregaria o caminho da foto de outro.
  begin
    perform public.definir_capa_galeria(v_a, v_outra);
    ok := false;
  exception when others then
    ok := position('outra galeria' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'foto de outra galeria nao vira capa, e diz por que');
  perform public.afirma(
    (select capa_item_id from public.galerias where id = v_a) = v_foto2,
    'e a capa anterior continua de pe depois da recusa');

  -- 4. Video nao vira capa parado.
  begin
    perform public.definir_capa_galeria(v_a, v_video);
    ok := false;
  exception when others then
    ok := position('foto' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'video nao vira capa');

  -- E item que ainda nao terminou de subir tambem nao.
  update public.galeria_itens set pronto = false where id = v_foto1;
  begin
    perform public.definir_capa_galeria(v_a, v_foto1);
    ok := false;
  exception when others then
    ok := position('subindo' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'foto que ainda esta subindo nao vira capa');
  update public.galeria_itens set pronto = true where id = v_foto1;

  -- Tirar a capa volta ao padrao, sem erro.
  perform public.definir_capa_galeria(v_a, null);
  perform public.afirma(
    (select capa_item_id from public.galerias where id = v_a) is null,
    'da para tirar a capa');
  perform public.definir_capa_galeria(v_a, v_foto2);

  -- 5. A leitura do visitante devolve a capa escolhida, como CAMINHO.
  select token into v_token from public.criar_link_galeria(v_a);
  reset role;
  g := public.galeria_por_token(v_token);
  perform public.afirma(g is not null, 'o link abre');
  perform public.afirma(
    g->>'capaItemId' = v_foto2::text,
    'e diz qual item e a capa');
  -- O ORIGINAL, nao a miniatura (0061).
  --
  -- Esta linha afirmava o contrario, e e por isso que vale escrever o motivo
  -- junto da afirmacao: quando a capa era uma faixa fina de 16:7, a miniatura
  -- de 640px bastava e a afirmacao estava certa. A capa virou a tela inteira,
  -- e a afirmacao virou um cadeado em cima do defeito — o teste passava, verde,
  -- enquanto a dona via a capa borrada na entrega da cliente.
  --
  -- Continua sendo CAMINHO, e nao URL: quem assina e a Edge Function, com
  -- validade curta. Caminho de balde privado nao serve para nada solto.
  perform public.afirma(
    g->>'capa' = v_a || '/orig/2.jpg',
    'e devolve o CAMINHO do ORIGINAL — a miniatura tem 640px e a capa ocupa a tela toda');
  perform public.afirma(
    g->>'capa' not like '%/mini/%',
    'nunca a miniatura: esticada na largura da tela ela fica borrada');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Quem nao edita nao troca capa
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000009';   -- papel 'leitura'
do $$
declare
  v_gal uuid;
  v_it  uuid;
  ok    boolean;
begin
  select g.id into v_gal from public.galerias g
    join public.sessoes_captacao s on s.id = g.sessao_id
   where s.cliente_id = 'a0000000-0000-0000-0000-00000000000a' limit 1;
  select i.id into v_it from public.galeria_itens i where i.galeria_id = v_gal limit 1;

  begin
    perform public.definir_capa_galeria(v_gal, v_it);
    ok := false;
  exception when others then
    ok := position('permissao' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'quem so le nao troca a capa');
end $$;

reset role;
select 'capa da galeria conferida' as resultado;
