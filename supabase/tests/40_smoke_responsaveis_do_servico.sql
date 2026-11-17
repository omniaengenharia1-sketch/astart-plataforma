-- =============================================================================
-- Smoke da 0070 — mais de uma pessoa cuidando do mesmo servico.
--
-- Pedido da dona: "as vezes o cliente e cuidado por mais de uma pessoa".
--
-- O que tem de valer:
--   1. definir uma lista grava a lista inteira;
--   2. definir uma lista MENOR tira quem ficou de fora — e este e o ponto
--      do arquivo: funcao que so soma deixa gente pendurada em contrato de
--      que ela nao cuida mais, e isso ninguem percebe olhando a tela;
--   3. lista vazia tira todos, e nao e confundida com "nao mexe";
--   4. repetido e nulo na entrada nao viram linha nem erro;
--   5. quem nao esta na equipe ATIVA e recusado, com o motivo;
--   6. `ficha_cliente` devolve a lista de nomes, nao um nome;
--   7. `lista_clientes` junta os nomes dos varios servicos, sem repetir;
--   8. quem nao ve o cliente nao mexe em quem cuida dele.
--
-- O QUE ESTE TESTE NAO ALCANCA: a copia dos dados antigos para a tabela nova.
-- O banco de teste nasce das migrations em ordem, entao quando a 0070 roda nao
-- ha contrato nenhum para copiar. Essa parte foi conferida na producao, contra
-- os contratos de verdade, antes e depois.
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
  ('10000000-0000-0000-0000-000000000002', 'raquel@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003', 'pedro@astartstudio.com.br'),
  ('30000000-0000-0000-0000-000000000009', 'vizinho@outro.com.br');

insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Layana', 'admin',    true,  'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Raquel', 'operacao', true,  'raquel@astartstudio.com.br'),
  -- Saiu da agencia: continua no banco por causa do historico, e NAO pode
  -- ser posto para cuidar de nada.
  ('10000000-0000-0000-0000-000000000003', 'Pedro',  'operacao', false, 'pedro@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('20000000-0000-0000-0000-000000000001', 'Mor Marcas', 'mor', 'America/Sao_Paulo'),
  ('20000000-0000-0000-0000-000000000002', 'Vizinho',    'viz', 'America/Sao_Paulo');

insert into public.clientes_usuarios (user_id, cliente_id, nome, email) values
  ('30000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000002','Vizinho','vizinho@outro.com.br');

do $$
declare
  v_gd   uuid;   -- Gestao Digital da Mor
  v_av   uuid;   -- Audiovisual da Mor
  v_nomes text[];
  v_n    int;
  ok     boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  select public.adicionar_servico_ao_cliente(
    '20000000-0000-0000-0000-000000000001', 'gestao_digital', 'recorrente',
    150000, 10::smallint, null, current_date, null, null,
    array['10000000-0000-0000-0000-000000000002'::uuid]   -- so a Raquel
  )->>'id' into v_gd;
  v_gd := (select cs.id from public.cliente_servicos cs
            join public.servicos s on s.id = cs.servico_id
           where cs.cliente_id = '20000000-0000-0000-0000-000000000001'
             and s.chave = 'gestao_digital');

  -- 1. A lista entra inteira.
  perform public.definir_responsaveis_do_servico(v_gd, array[
    '10000000-0000-0000-0000-000000000001'::uuid,
    '10000000-0000-0000-0000-000000000002'::uuid]);
  v_nomes := public.responsaveis_do_servico(v_gd);
  perform public.afirma(v_nomes = array['Layana','Raquel'],
    'duas pessoas cuidando do mesmo servico, em ordem');

  -- 2. LISTA MENOR TIRA QUEM FICOU DE FORA.
  --
  -- E o motivo deste arquivo. Uma funcao que so soma passaria no item 1 e
  -- deixaria a Layana pendurada num contrato que nao e mais dela — e ninguem
  -- descobre isso olhando a tela, porque a tela mostra o que o banco diz.
  perform public.definir_responsaveis_do_servico(v_gd, array[
    '10000000-0000-0000-0000-000000000002'::uuid]);
  perform public.afirma(public.responsaveis_do_servico(v_gd) = array['Raquel'],
    'tirar alguem da lista tira do banco, e nao so deixa de somar');

  -- 3. Lista VAZIA tira todos. E diferente de "nao mexe".
  perform public.definir_responsaveis_do_servico(v_gd, array[]::uuid[]);
  perform public.afirma(public.responsaveis_do_servico(v_gd) = array[]::text[],
    'lista vazia deixa o servico sem responsavel');

  -- 4. Repetido e nulo nao viram linha nem erro.
  perform public.definir_responsaveis_do_servico(v_gd, array[
    '10000000-0000-0000-0000-000000000002'::uuid,
    '10000000-0000-0000-0000-000000000002'::uuid,
    null::uuid]);
  perform public.afirma(public.responsaveis_do_servico(v_gd) = array['Raquel'],
    'repetido e nulo na entrada nao viram linha');

  -- 5. Quem saiu da equipe e recusado, dizendo por que.
  begin
    perform public.definir_responsaveis_do_servico(v_gd, array[
      '10000000-0000-0000-0000-000000000003'::uuid]);
    ok := false;
  exception when others then
    ok := position('equipe ativa' in sqlerrm) > 0;
  end;
  perform public.afirma(ok,
    'quem saiu da agencia nao pode ser posto para cuidar — nome pendurado parece que alguem esta cuidando');
  perform public.afirma(public.responsaveis_do_servico(v_gd) = array['Raquel'],
    'e a recusa nao estraga a lista que ja estava la');

  -- 6. A ficha devolve LISTA, nao nome.
  perform public.definir_responsaveis_do_servico(v_gd, array[
    '10000000-0000-0000-0000-000000000001'::uuid,
    '10000000-0000-0000-0000-000000000002'::uuid]);
  perform public.afirma(
    (select jsonb_array_length(x->'responsaveis')
       from jsonb_array_elements(
         public.ficha_cliente('20000000-0000-0000-0000-000000000001')->'servicos') x
      limit 1) = 2,
    'a ficha do cliente devolve os dois nomes');

  -- 7. A lista de clientes junta os nomes dos varios servicos, sem repetir.
  select public.adicionar_servico_ao_cliente(
    '20000000-0000-0000-0000-000000000001', 'audiovisual', 'pontual',
    80000, null, 1::smallint, current_date, null, current_date + 10,
    array['10000000-0000-0000-0000-000000000001'::uuid]   -- so a Layana
  )->>'id' into v_av;

  select jsonb_array_length(x->'responsaveis') into v_n
    from jsonb_array_elements(public.lista_clientes()) x
   where x->>'nome' = 'Mor Marcas';
  perform public.afirma(v_n = 2,
    'a lista de clientes junta Layana e Raquel uma vez cada, dos dois servicos');
end $$;

-- 8. Quem nao ve o cliente nao mexe em quem cuida dele.
set "teste.uid" = '30000000-0000-0000-0000-000000000009';   -- usuario do Vizinho
do $$
declare v_gd uuid; ok boolean;
begin
  select cs.id into v_gd from public.cliente_servicos cs
    join public.servicos s on s.id = cs.servico_id
   where cs.cliente_id = '20000000-0000-0000-0000-000000000001'
     and s.chave = 'gestao_digital';
  begin
    perform public.definir_responsaveis_do_servico(v_gd, array[]::uuid[]);
    ok := false;
  exception when others then
    ok := position('nao encontrado' in sqlerrm) > 0
       or position('permissao' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'cliente de outro cliente nao mexe em quem cuida da Mor');
end $$;
