-- Smoke da 0063 — quem apaga precisa enxergar.
--
-- A dona apertou "apagar" na faxina e nada saiu. A politica de leitura do
-- balde pergunta se a galeria e sua, e para arquivo orfao a galeria nao existe
-- mais — entao ninguem enxergava, e o Storage nao apaga o que nao acha.
--
-- Pior: `excluir_galeria` apaga a LINHA primeiro e os arquivos depois. No
-- instante em que a linha morre, todos os arquivos daquela galeria ficam
-- invisiveis. Nao era falha ocasional: TODA galeria apagada vazava 100% dos
-- arquivos, sempre.
--
-- O que tem de valer:
--   1. arquivo de galeria VIVA continua decidido pela regra de sempre;
--   2. arquivo orfao e visivel para a equipe, para poder limpar;
--   3. arquivo orfao NAO e visivel para quem nao edita;
--   4. caminho torto (sem uuid na frente) conta como orfao para a equipe.
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
  ('10000000-0000-0000-0000-000000000009', 'visita@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Direcao', 'admin', true, 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000009', 'Visita', 'leitura', true, 'visita@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('a0000000-0000-0000-0000-00000000000a', 'Padaria Aurora', 'padaria-aurora', 'America/Sao_Paulo');
insert into public.sessoes_captacao (id, cliente_id, titulo, data, status) values
  ('5e550000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a',
   'Captacao na padaria', current_date, 'realizada');

set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000001';

do $$
declare
  v_viva   uuid;
  v_morta  uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_conta  int;
begin
  v_viva := public.criar_galeria('5e550000-0000-0000-0000-00000000000a', 'Galeria viva', null);

  insert into storage.objects (bucket_id, name, metadata) values
    ('galerias', v_viva  || '/orig/viva.jpg',   '{"size": 10}'::jsonb),
    ('galerias', v_morta || '/orig/orfa.jpg',   '{"size": 20}'::jsonb),
    ('galerias', 'sem-uuid-nenhum/orig/x.jpg',  '{"size": 30}'::jsonb);

  -- 1 e 2: a direcao ve os tres. O da galeria viva pela regra de sempre, os
  -- outros dois pelo ramo novo.
  select count(*) into v_conta from storage.objects where bucket_id = 'galerias';
  perform public.afirma(v_conta = 3,
    'a direcao ve o arquivo da galeria viva E os que ficaram sem dono');

  perform public.afirma(
    exists (select 1 from storage.objects
             where bucket_id = 'galerias' and name = v_morta || '/orig/orfa.jpg'),
    'arquivo de galeria apagada e visivel para a equipe — sem isso nao da para limpar');

  -- 4: caminho torto tambem e lixo que a equipe precisa varrer.
  perform public.afirma(
    exists (select 1 from storage.objects
             where bucket_id = 'galerias' and name = 'sem-uuid-nenhum/orig/x.jpg'),
    'caminho fora do padrao conta como sem dono para a equipe');
end $$;

-- 3. Quem NAO edita nao ve orfao nenhum.
--
-- O perfil 'leitura' nao passa em `usuario_edita()`. Ele continua vendo o que
-- a regra de sempre deixar — aqui, nada, porque nao e dono de cliente nenhum.
set "teste.uid" = '10000000-0000-0000-0000-000000000009';
do $$
declare v_conta int;
begin
  select count(*) into v_conta
    from storage.objects
   where bucket_id = 'galerias'
     and name like 'dddddddd%';
  perform public.afirma(v_conta = 0,
    'quem nao edita nao ve arquivo sem dono');
end $$;

rollback;
