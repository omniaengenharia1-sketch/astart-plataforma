-- Smoke da 0062 — arquivo que ficou no balde sem dono.
--
-- Nasceu de uma pergunta simples da dona ("onde as fotos estao armazenadas?").
-- Fui medir para responder com numero, e 60% do balde era lixo: 369 arquivos,
-- 175 MB, de uma galeria apagada cujos arquivos ficaram.
--
-- O que tem de valer:
--   1. arquivo que um item referencia NAO e orfao;
--   2. arquivo sem referencia nenhuma E orfao, e os bytes batem;
--   3. arquivo RECEM-SUBIDO nao conta, mesmo sem referencia;
--   4. margem curta demais e recusada, com motivo;
--   5. so a direcao ve a lista.
--
-- O 3 e o que importa de verdade. O upload sobe o arquivo ANTES de gravar a
-- linha — e a ordem certa — entao durante uma subida ha arquivos no balde sem
-- dono, identicos a um orfao. Descobri medindo: entre duas consultas, a
-- galeria "Vida Ativa" foi de 47 para 108 arquivos, porque a dona estava
-- subindo naquele instante. Sem esta regra, uma faxina apagaria as fotos dela
-- no meio do upload.
-- ---------------------------------------------------------------------------
begin;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'operacao@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Direcao', 'admin', true, 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Operacao', 'operacao', true, 'operacao@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('a0000000-0000-0000-0000-00000000000a', 'Padaria Aurora', 'padaria-aurora', 'America/Sao_Paulo');
insert into public.sessoes_captacao (id, cliente_id, titulo, data, status) values
  ('5e550000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a',
   'Captacao na padaria', current_date, 'realizada');

set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000001';

do $$
declare
  v_gal  uuid;
  r      jsonb;
  ok     boolean;
begin
  v_gal := public.criar_galeria('5e550000-0000-0000-0000-00000000000a', 'Balde de teste', null);
  perform public.registrar_item_galeria(v_gal, 'viva.jpg', 'foto',
            v_gal || '/orig/viva.jpg', 'image/jpeg', 1000,
            v_gal || '/mini/viva.jpg', null, 100, 100, null);

  -- Tres arquivos no balde: um com dono, um sem dono e velho, um sem dono e
  -- recem-chegado (o que esta subindo agora).
  insert into storage.objects (bucket_id, name, metadata, created_at) values
    ('galerias', v_gal || '/orig/viva.jpg',    '{"size": 1000}'::jsonb, now() - interval '2 days'),
    ('galerias', v_gal || '/orig/morta.jpg',   '{"size": 7000}'::jsonb, now() - interval '2 days'),
    ('galerias', v_gal || '/orig/subindo.jpg', '{"size": 9000}'::jsonb, now() - interval '1 minute');

  r := public.arquivos_orfaos(60);

  perform public.afirma((r->>'arquivos')::int = 1,
    'so o arquivo sem dono conta como orfao');
  perform public.afirma(r->'caminhos' ? (v_gal || '/orig/morta.jpg'),
    'e e o arquivo certo');
  perform public.afirma(not (r->'caminhos' ? (v_gal || '/orig/viva.jpg')),
    'arquivo que um item referencia nunca entra na lista');
  perform public.afirma((r->>'bytes')::bigint = 7000,
    'e soma so os bytes do que sobrou');

  -- O ARQUIVO A CAMINHO.
  perform public.afirma(not (r->'caminhos' ? (v_gal || '/orig/subindo.jpg')),
    'arquivo recem-subido NAO e orfao: no upload ele existe antes da linha');

  -- Margem curta e recusada, e a mensagem diz por que.
  begin
    perform public.arquivos_orfaos(1);
    ok := false;
  exception when others then
    ok := position('upload' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'margem curta demais e recusada, com o motivo escrito');
end $$;

-- Operacao nao ve: a lista mistura caminhos de todos os clientes, e apagar em
-- massa nao tem desfazer. Mesma porta de `excluir_galeria`.
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$
declare ok boolean;
begin
  begin
    perform public.arquivos_orfaos(60);
    ok := false;
  exception when others then
    ok := position('direcao' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'operacao nao ve os arquivos orfaos');
end $$;

rollback;
