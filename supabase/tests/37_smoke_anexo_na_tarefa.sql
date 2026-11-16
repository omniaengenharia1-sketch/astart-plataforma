-- Smoke da 0066 — imagem e documento no cartao.
--
-- O que tem de valer:
--   1. o anexo aparece no quadro de quem ve o cartao;
--   2. caminho de OUTRA tarefa e recusado — senao um anexo apontaria para a
--      pasta de outro cartao e apareceria para quem nao deveria ve-lo;
--   3. quem nao ve o cartao nao ve o anexo;
--   4. apagar a tarefa DEVOLVE os caminhos, para o navegador limpar o balde;
--   5. e depois de apagada, a equipe AINDA ENXERGA o arquivo no balde.
--
-- O 5 e o motivo deste arquivo existir.
--
-- Duas semanas atras o balde das galerias acumulou 175 MB de orfao porque a
-- politica de leitura perguntava se a galeria existia. Apagar a galeria
-- tornava os arquivos invisiveis NO MESMO INSTANTE, e o Storage nao apaga o
-- que nao acha: toda galeria apagada vazava 100% dos arquivos, sempre. O
-- contador ainda reportava sucesso, porque somava o tamanho do lote em vez do
-- que o servidor devolveu.
--
-- Aqui a politica ja nasceu com o ramo do orfao. Este teste e o que impede
-- alguem de "simplificar" a politica um dia e refazer o mesmo buraco.
-- ---------------------------------------------------------------------------
begin;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'layana@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003', 'pedro@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Layana', 'admin',    true, 'layana@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003', 'Pedro',  'operacao', true, 'pedro@astartstudio.com.br');

set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000001';

do $$
declare
  v_a       uuid;
  v_b       uuid;
  v_col     uuid;
  v_arq     uuid;
  v_caminho text;
  q         jsonb;
  r         jsonb;
  ok        boolean;
begin
  select id into v_col from public.tarefa_colunas order by ordem limit 1;
  v_a := public.criar_tarefa('Fazer criativo', v_col, null, null, null, null);
  v_b := public.criar_tarefa('Outra tarefa',   v_col, null, null, null, null);

  v_caminho := v_a || '/f1e2d3c4-0000-4000-8000-000000000001.png';

  -- 2. Caminho de OUTRA tarefa e recusado, antes de qualquer coisa.
  begin
    perform public.registrar_arquivo_da_tarefa(
      v_a, 'referencia.png', v_b || '/intruso.png', 'image/png', 1000);
    ok := false;
  exception when others then
    ok := position('pasta desta tarefa' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'anexo apontando para a pasta de outro cartao e recusado');

  -- 1. O anexo entra e aparece no quadro.
  v_arq := public.registrar_arquivo_da_tarefa(
    v_a, 'referencia.png', v_caminho, 'image/png', 48000);

  q := public.quadro_de_tarefas();
  perform public.afirma(
    exists (
      select 1 from jsonb_array_elements(q->'tarefas') t,
                    jsonb_array_elements(t->'arquivos') a
       where t->>'id' = v_a::text and a->>'nome' = 'referencia.png'
    ),
    'o anexo aparece no quadro, no cartao certo');

  -- O quadro devolve o CAMINHO, nao uma URL: balde privado, e quem assina e o
  -- navegador na hora de abrir.
  perform public.afirma(
    not exists (
      select 1 from jsonb_array_elements(q->'tarefas') t,
                    jsonb_array_elements(t->'arquivos') a
       where a->>'caminho' like 'http%'
    ),
    'o quadro traz caminho, nunca URL assinada');

  -- O arquivo no balde, como o navegador teria subido.
  insert into storage.objects (bucket_id, name, metadata)
  values ('tarefas', v_caminho, '{"size": 48000}'::jsonb);

  perform public.afirma(
    exists (select 1 from storage.objects where bucket_id = 'tarefas' and name = v_caminho),
    'quem ve o cartao ve o arquivo no balde');

  -- 4. Apagar devolve os caminhos.
  r := public.apagar_tarefa(v_a);
  perform public.afirma(r->'caminhos' ? v_caminho,
    'apagar a tarefa devolve os caminhos para o navegador limpar o balde');
  perform public.afirma(
    not exists (select 1 from public.tarefa_arquivos where id = v_arq),
    'e a linha do anexo some junto, por cascade');

  -- 5. E O ARQUIVO CONTINUA VISIVEL PARA A EQUIPE.
  --
  -- Esta e a afirmacao que impede o bug da galeria de voltar. Sem o ramo do
  -- orfao na politica, este select devolveria zero — e um arquivo que ninguem
  -- enxerga e um arquivo que ninguem consegue apagar.
  perform public.afirma(
    exists (select 1 from storage.objects where bucket_id = 'tarefas' and name = v_caminho),
    'apagada a tarefa, a equipe AINDA ve o arquivo — senao nao haveria como limpar');
end $$;

-- 3. Quem nao ve o cartao nao ve o anexo.
do $$
declare v_col uuid; v_t uuid; v_cam text;
begin
  set "teste.uid" = '10000000-0000-0000-0000-000000000001';
  select id into v_col from public.tarefa_colunas order by ordem limit 1;
  v_t := public.criar_tarefa('So da Layana', v_col, null, null, null, null);
  v_cam := v_t || '/aaaaaaaa-0000-4000-8000-000000000002.pdf';
  perform public.registrar_arquivo_da_tarefa(v_t, 'briefing.pdf', v_cam, 'application/pdf', 900);
  insert into storage.objects (bucket_id, name, metadata)
  values ('tarefas', v_cam, '{"size": 900}'::jsonb);

  set "teste.uid" = '10000000-0000-0000-0000-000000000003';   -- Pedro
  perform public.afirma(
    not exists (select 1 from public.tarefa_arquivos where caminho = v_cam),
    'quem nao ve o cartao nao ve a linha do anexo');
  perform public.afirma(
    not exists (select 1 from storage.objects where bucket_id = 'tarefas' and name = v_cam),
    'nem o arquivo no balde — a tarefa existe e nao e dele');
end $$;

rollback;
