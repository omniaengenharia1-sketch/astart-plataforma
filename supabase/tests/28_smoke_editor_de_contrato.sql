-- =============================================================================
-- Smoke da 0052. O que este teste cobra:
--   1. adicionar servico a um cliente que JA EXISTE — o que nao havia;
--   2. servico ja ativo recusa, em vez de criar uma segunda linha (que seria
--      cobrar o cliente duas vezes);
--   3. servico ENCERRADO reativa a MESMA linha, com o historico pendurado;
--   4. valor so muda para quem ve valor — operacao podia ESCREVER um valor que
--      nao consegue LER;
--   5. encerrar nao apaga nada, e fecha as abas na hora;
--   6. operacao NAO apaga linha de contrato pela tabela (a armadilha nº 9, que
--      a 0039 consertou em `clientes` e deixou passar aqui);
--   7. apagar existe so para desfazer engano, e recusa quando ha historico.
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
  ('10000000-0000-0000-0000-000000000002', 'operacao@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Direcao',  'admin',    true, 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Operacao', 'operacao', true, 'operacao@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('20000000-0000-0000-0000-000000000001', 'Padaria Aurora', 'padaria-aurora', 'America/Sao_Paulo');

-- ---------------------------------------------------------------------------
-- 1. Adicionar a um cliente que ja existe
--
-- Antes da 0052 nao havia caminho nenhum: `cliente_servicos` tinha um unico
-- escritor em todo o sistema, o `criar_cliente()`. Errou o valor, o cliente
-- contratou outro servico — recadastrar era a unica saida.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  perform public.afirma(
    not public.cliente_tem_modulo('20000000-0000-0000-0000-000000000001', 'publicacao'),
    'sem contrato, o modulo de publicacao esta fechado'
  );

  v := public.adicionar_servico_ao_cliente(
    '20000000-0000-0000-0000-000000000001',
    'gestao_digital',
    'recorrente',
    280000::bigint,
    10::smallint
  );
  perform public.afirma(v->>'id' is not null, 'adicionou o servico');
  perform public.afirma(not (v->>'reativou')::boolean, 'e foi linha nova, nao reativacao');

  -- O portao de modulo le servico ATIVO, entao a aba abre sem mais nenhuma
  -- linha de codigo.
  perform public.afirma(
    public.cliente_tem_modulo('20000000-0000-0000-0000-000000000001', 'publicacao'),
    'com o contrato, a aba de publicacao abre'
  );

  -- Gestao Digital NAO tem modelo de entregavel, e isso esta certo: servico
  -- recorrente trabalha por calendario de conteudo, nao por lista de entregas.
  -- Eu supus que tinha ao escrever este teste, e o banco me corrigiu.
  perform public.afirma(
    (select count(*) from public.entregaveis e
      join public.cliente_servicos cs on cs.id = e.cliente_servico_id
     where cs.cliente_id = '20000000-0000-0000-0000-000000000001') = 0,
    'recorrente nao nasce com entregavel'
  );

  -- Website nasce com onze, do modelo da 0018. E com ele que se testa a recusa
  -- de apagar servico com historico.
  v := public.adicionar_servico_ao_cliente(
    '20000000-0000-0000-0000-000000000001', 'website', 'projeto',
    900000::bigint, null, 3::smallint);
  perform public.afirma(
    (select count(*) from public.entregaveis where cliente_servico_id = (v->>'id')::uuid) > 0,
    'projeto nasce com os entregaveis do modelo'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2. O mesmo servico de novo
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  begin
    perform public.adicionar_servico_ao_cliente(
      '20000000-0000-0000-0000-000000000001', 'gestao_digital', 'recorrente',
      300000::bigint, 10::smallint);
    ok := false;
  exception when others then
    ok := position('ja tem' in sqlerrm) > 0 and position('encerre' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'servico ja ativo recusa, e diz o que fazer');

  perform public.afirma(
    (select count(*) from public.cliente_servicos
      where cliente_id = '20000000-0000-0000-0000-000000000001'
        and servico_id = (select id from public.servicos where chave = 'gestao_digital')) = 1,
    'e NAO criou uma segunda linha — isso cobraria o cliente duas vezes'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4. Valor so para quem ve valor
--
-- `valor_centavos` nao tem SELECT para `authenticated` (a 0039 escondeu o
-- dinheiro) e tinha UPDATE. Operacao podia escrever um valor de contrato que
-- nao consegue ler.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cs uuid;
  ok boolean;
begin
  -- O recorrente, nomeado: o cliente agora tem dois servicos, e uma busca sem
  -- nome pegaria o que o Postgres devolvesse primeiro.
  select cs.id into v_cs from public.cliente_servicos cs
    join public.servicos s on s.id = cs.servico_id
   where cs.cliente_id = '20000000-0000-0000-0000-000000000001'
     and s.chave = 'gestao_digital';

  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000002', false);  -- operacao

  begin
    perform public.alterar_servico_do_cliente(v_cs, p_valor_centavos => 999900::bigint);
    ok := false;
  exception when others then
    ok := position('nao mexe em valor' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'operacao nao mexe em valor de contrato');

  -- Mas altera o RESTO sem tocar no valor: nulo quer dizer "nao mexe", e nao
  -- "zera". Senao a tela de quem nao ve dinheiro apagaria o valor por omissao.
  perform public.alterar_servico_do_cliente(v_cs, p_observacao => 'troca de responsavel em maio');
  perform public.afirma(
    (select observacao from public.cliente_servicos where id = v_cs)
      = 'troca de responsavel em maio',
    'operacao altera o resto do contrato'
  );
  perform public.afirma(
    (select valor_centavos from public.cliente_servicos where id = v_cs) = 280000,
    'e o valor ficou intacto'
  );

  -- Direcao muda.
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  perform public.alterar_servico_do_cliente(v_cs, p_valor_centavos => 320000::bigint);
  perform public.afirma(
    (select valor_centavos from public.cliente_servicos where id = v_cs) = 320000,
    'direcao muda o valor'
  );

  -- E recorrente nao fica sem dia de vencimento nem mandando nulo de proposito:
  -- a regra de formato vale na alteracao, nao so no cadastro.
  perform public.alterar_servico_do_cliente(v_cs, p_dia_vencimento => null);
  perform public.afirma(
    (select dia_vencimento from public.cliente_servicos where id = v_cs) = 10,
    'nulo nao apaga o dia de vencimento de um recorrente'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 6. Operacao nao apaga contrato pela tabela
--
-- A armadilha nº 9 desta documentacao: a politica da 0006 era
-- `for all using (usuario_edita())`, e `for all` INCLUI DELETE. O cascade
-- levaria entregaveis, marcos, planos de conteudo, ambientes, acessos e
-- integracoes. A 0039 consertou isso em `clientes` e eu nao varri as vizinhas.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cs uuid;
  v_antes int;
begin
  -- O recorrente, nomeado: o cliente agora tem dois servicos, e uma busca sem
  -- nome pegaria o que o Postgres devolvesse primeiro.
  select cs.id into v_cs from public.cliente_servicos cs
    join public.servicos s on s.id = cs.servico_id
   where cs.cliente_id = '20000000-0000-0000-0000-000000000001'
     and s.chave = 'gestao_digital';

  set local role authenticated;
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000002', false);  -- operacao

  select count(*) into v_antes from public.cliente_servicos where id = v_cs;
  delete from public.cliente_servicos where id = v_cs;   -- RLS deixa sem efeito
  perform public.afirma(
    (select count(*) from public.cliente_servicos where id = v_cs) = v_antes,
    'operacao NAO apaga linha de contrato'
  );

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Apagar: so para desfazer engano
-- ---------------------------------------------------------------------------
do $$
declare
  v_site uuid;
  v_rec  uuid;
  ok boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  select cs.id into v_site from public.cliente_servicos cs
    join public.servicos s on s.id = cs.servico_id
   where cs.cliente_id = '20000000-0000-0000-0000-000000000001' and s.chave = 'website';

  -- Com historico pendurado: recusa, e a mensagem diz O QUE tem e o que fazer.
  begin
    perform public.remover_servico_do_cliente(v_site);
    ok := false;
  exception when others then
    ok := position('historico' in sqlerrm) > 0
      and position('entregaveis' in sqlerrm) > 0
      and position('encerrar' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'servico com historico nao se apaga, e a mensagem diz por que');

  -- Sem nada pendurado: apaga, porque isso e desfazer engano, nao apagar
  -- historia. O recorrente serve: nasceu sem entregavel.
  select cs.id into v_rec from public.cliente_servicos cs
    join public.servicos s on s.id = cs.servico_id
   where cs.cliente_id = '20000000-0000-0000-0000-000000000001' and s.chave = 'gestao_digital';

  perform public.remover_servico_do_cliente(v_rec);
  perform public.afirma(
    not exists (select 1 from public.cliente_servicos where id = v_rec),
    'servico sem historico se apaga — e o engano do mesmo dia'
  );

  -- E volta para os testes seguintes, que precisam dele.
  perform public.adicionar_servico_ao_cliente(
    '20000000-0000-0000-0000-000000000001', 'gestao_digital', 'recorrente',
    320000::bigint, 10::smallint);
end $$;

-- ---------------------------------------------------------------------------
-- 5 e 3. Encerrar nao apaga; e encerrado reativa a MESMA linha
-- ---------------------------------------------------------------------------
do $$
declare
  v_cs   uuid;
  v_ents int;
  v jsonb;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  -- O recorrente, nomeado: o cliente agora tem dois servicos, e uma busca sem
  -- nome pegaria o que o Postgres devolvesse primeiro.
  select cs.id into v_cs from public.cliente_servicos cs
    join public.servicos s on s.id = cs.servico_id
   where cs.cliente_id = '20000000-0000-0000-0000-000000000001'
     and s.chave = 'gestao_digital';
  select count(*) into v_ents from public.entregaveis where cliente_servico_id = v_cs;

  v := public.encerrar_servico_do_cliente(v_cs);
  perform public.afirma(v->>'fim' is not null, 'encerrar grava a data de fim');
  perform public.afirma(
    (select status from public.cliente_servicos where id = v_cs)::text = 'encerrado',
    'e o status vira encerrado'
  );
  -- O ponto todo: nada foi apagado.
  perform public.afirma(
    (select count(*) from public.entregaveis where cliente_servico_id = v_cs) = v_ents,
    'encerrar NAO apaga os entregaveis — e o historico que protege as duas partes'
  );
  -- E as abas fecham, porque o portao de modulo conta servico ativo.
  perform public.afirma(
    not public.cliente_tem_modulo('20000000-0000-0000-0000-000000000001', 'publicacao'),
    'servico encerrado fecha a aba na hora'
  );

  -- Data de fim antes do inicio e recusada: seria um periodo negativo.
  begin
    perform public.encerrar_servico_do_cliente(v_cs, '2020-01-01'::date);
    perform public.afirma(false, 'aceitou fim antes do inicio');
  exception when others then
    if position('anterior ao inicio' in sqlerrm) = 0 then raise; end if;
  end;

  -- 3. Reativar: a MESMA linha volta, com o historico pendurado nela.
  v := public.adicionar_servico_ao_cliente(
    '20000000-0000-0000-0000-000000000001', 'gestao_digital', 'recorrente',
    350000::bigint, 15::smallint);
  perform public.afirma((v->>'reativou')::boolean, 'cliente que volta reativa, nao duplica');
  perform public.afirma((v->>'id')::uuid = v_cs, 'e e a MESMA linha de antes');
  perform public.afirma(
    (select count(*) from public.cliente_servicos cs
       join public.servicos s on s.id = cs.servico_id
      where cs.cliente_id = '20000000-0000-0000-0000-000000000001'
        and s.chave = 'gestao_digital') = 1,
    'continua uma linha so para aquele servico'
  );
  perform public.afirma(
    (select fim from public.cliente_servicos where id = v_cs) is null,
    'e a data de fim foi limpa: ativo com fim no passado nao quer dizer nada'
  );
  perform public.afirma(
    (select count(*) from public.entregaveis where cliente_servico_id = v_cs) = v_ents,
    'o historico continua la depois da reativacao'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 8. O que a tela pode oferecer
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  v := public.servicos_para_adicionar('20000000-0000-0000-0000-000000000001');

  perform public.afirma(jsonb_array_length(v) > 1, 'o catalogo inteiro aparece');
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(v) x
             where x->>'chave' = 'gestao_digital' and (x->>'jaTem')::boolean),
    'o que o cliente ja tem vem marcado — senao a tela oferece o que vira erro'
  );
  perform public.afirma(
    exists (select 1 from jsonb_array_elements(v) x
             where x->>'chave' <> 'gestao_digital' and not (x->>'jaTem')::boolean),
    'e o que ele nao tem vem como adicionavel'
  );
end $$;

select 'editor de contrato conferido' as resultado;
