-- =============================================================================
-- Smoke da 0044. O que este teste cobra:
--   1. salvar duas vezes a MESMA conta nao cria duas linhas — duas linhas
--      significariam publicar duas vezes, o pior bug possivel neste sistema;
--   2. conta ja ligada a OUTRO cliente e recusada alto, com mensagem — mover
--      sem querer publicaria o post de um cliente no perfil de outro;
--   3. Instagram sem ig_user_id e recusado antes do CHECK, em portugues;
--   4. `contas_do_cliente` fica atras do modulo: cliente sem publicacao
--      contratada nao tem esta pergunta;
--   5. escrever conta social e so da direcao, e a leitura e de quem esta ativo;
--   6. `token_do_sistema` e so do service_role, e diz o que fazer quando falta.
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

insert into public.clientes (id, nome, slug) values
  ('20000000-0000-0000-0000-000000000001', 'Com publicacao', 'com-publicacao'),
  ('20000000-0000-0000-0000-000000000002', 'Outro cliente',  'outro-cliente'),
  ('20000000-0000-0000-0000-000000000003', 'Sem publicacao', 'sem-publicacao');

-- Os dois primeiros contratam o servico que liga `publicacao`; o terceiro nao.
insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select c.id, s.id, 'recorrente', 100000, 10, current_date
  from public.clientes c, public.servicos s
 where s.nome = 'Gestão Digital'
   and c.slug in ('com-publicacao', 'outro-cliente');

insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, parcelas, inicio)
select c.id, s.id, 'projeto', 500000, 1, current_date
  from public.clientes c, public.servicos s
 where s.nome = 'Branding' and c.slug = 'sem-publicacao';

-- ---------------------------------------------------------------------------
-- 1 e 2. idempotencia, e a recusa de mover de cliente
-- ---------------------------------------------------------------------------
do $$
declare
  r1 jsonb;
  r2 jsonb;
  ok boolean;
begin
  r1 := public.salvar_conta_social(
          '20000000-0000-0000-0000-000000000001', 'instagram', 'mormarcas', '17841400000001', '1010');
  perform public.afirma((r1->>'novo')::boolean, 'a primeira vez cria');

  r2 := public.salvar_conta_social(
          '20000000-0000-0000-0000-000000000001', 'instagram', 'mormarcas', '17841400000001', '1010');
  perform public.afirma(not (r2->>'novo')::boolean, 'a segunda vez reencontra, nao cria');
  perform public.afirma(r1->>'id' = r2->>'id', 'e e a mesma linha');
  perform public.afirma(
    (select count(*) from public.contas_sociais where ig_user_id = '17841400000001') = 1,
    'uma conta da Meta, uma linha — duas publicariam duas vezes'
  );

  -- A mesma conta apontada para outro cliente.
  begin
    perform public.salvar_conta_social(
      '20000000-0000-0000-0000-000000000002', 'instagram', 'mormarcas', '17841400000001', '1010');
    ok := false;
  exception when others then
    ok := position('outro cliente' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'conta de outro cliente e recusada, dizendo por que');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Instagram sem id
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  begin
    perform public.salvar_conta_social(
      '20000000-0000-0000-0000-000000000001', 'instagram', 'sem id', null, '1099');
    ok := false;
  exception when others then
    ok := position('ig_user_id' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'Instagram sem ig_user_id e recusado em portugues');

  -- E cliente que nao existe tambem.
  begin
    perform public.salvar_conta_social(
      '20000000-0000-0000-0000-00000000dead', 'instagram', 'x', '1784140000009', '1098');
    ok := false;
  exception when others then
    ok := position('nao encontrado' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'cliente inexistente e recusado');
end $$;

-- ---------------------------------------------------------------------------
-- 4 e 5. o portao do modulo, e quem pode o que
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  v := public.contas_do_cliente('20000000-0000-0000-0000-000000000001');
  perform public.afirma(jsonb_array_length(v) = 1, 'o cliente com publicacao mostra a conta');
  perform public.afirma(
    (v->0->>'prontaParaPublicar')::boolean,
    'conta ativa com acesso concedido esta pronta para publicar'
  );

  -- Cliente sem o modulo: a funcao devolve lista vazia, nao erro. Nao e falha,
  -- e ausencia de pergunta.
  v := public.contas_do_cliente('20000000-0000-0000-0000-000000000003');
  perform public.afirma(jsonb_array_length(v) = 0, 'cliente sem publicacao nao tem contas a mostrar');
end $$;

-- A leitura e de quem esta ativo; a escrita direta na tabela, so da direcao.
do $$
declare ok boolean;
begin
  set local role authenticated;
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000002', true);

  perform public.afirma(
    (select count(*) from public.contas_sociais) >= 1,
    'operacao LE as contas, que aparecem na tela de calendario'
  );

  begin
    insert into public.contas_sociais (cliente_id, plataforma, nome_exibicao, ig_user_id)
    values ('20000000-0000-0000-0000-000000000001', 'instagram', 'na mao', '17841499999999');
    ok := false;
  exception when insufficient_privilege then
    ok := true;
  end;
  perform public.afirma(ok, 'operacao NAO escreve conta social na mao');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 6. o token do sistema
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  set local role authenticated;
  begin
    perform public.token_do_sistema();
    ok := false;
  exception when insufficient_privilege then
    ok := true;
  end;
  perform public.afirma(ok, 'quem esta logado NAO le o token do sistema');
end $$;
reset role;

do $$
declare ok boolean;
begin
  -- Vault vazio: a mensagem tem de dizer o que fazer, nao devolver nulo.
  begin
    perform public.token_do_sistema();
    ok := false;
  exception when others then
    ok := position('meta_system_user_token' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'sem a chave no Vault, a funcao diz qual chave falta');
end $$;

select vault.create_secret('TOKEN-DE-TESTE', 'meta_system_user_token');

do $$
begin
  perform public.afirma(
    public.token_do_sistema() = 'TOKEN-DE-TESTE',
    'com a chave cadastrada, o service_role le o token'
  );
end $$;

select 'conectar conta conferido' as resultado;
