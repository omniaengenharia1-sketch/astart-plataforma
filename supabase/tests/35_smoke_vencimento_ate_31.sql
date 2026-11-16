-- Smoke da 0064 — vencimento 29, 30 e 31.
--
-- A dona: "os vencimentos dos clientes vao ate dia 28, sendo que a maioria dos
-- clientes pagam dia 30".
--
-- O limite nao era regra de negocio. A geracao de cobranca montava a data com
-- `make_date(ano, mes, dia)`, e `make_date(2026, 2, 30)` ESTOURA em vez de cair
-- para 28. Travar em 28 fazia o estouro nunca acontecer, ao preco de nao
-- conseguir registrar o cliente que paga dia 30.
--
-- O que tem de valer:
--   1. `dia_do_mes` cai para o ultimo dia quando o mes e mais curto;
--   2. e acerta fevereiro bissexto, que e onde um `case` escrito a mao erra;
--   3. `coerir_contrato` aceita 29, 30 e 31, e ainda recusa 0 e 32;
--   4. o CHECK da coluna aceita 31;
--   5. a cobranca de um contrato com dia 30 NASCE em fevereiro, em 28 —
--      antes desta migration esta linha derrubava a funcao inteira.
--
-- O 5 e o que importa: os outros quatro poderiam passar com a cobranca ainda
-- quebrada, porque e so ela que chama `make_date`.
-- ---------------------------------------------------------------------------
begin;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

-- 1 e 2: a conta da data, sem precisar de permissao nenhuma.
do $$
begin
  perform public.afirma(public.dia_do_mes('2026-03-01'::date, 30) = '2026-03-30'::date,
    'mes que tem o dia 30 cobra no dia 30');
  perform public.afirma(public.dia_do_mes('2026-02-01'::date, 30) = '2026-02-28'::date,
    'dia 30 em fevereiro cobra no ultimo dia (28)');
  perform public.afirma(public.dia_do_mes('2026-04-01'::date, 31) = '2026-04-30'::date,
    'dia 31 em abril cobra em 30');
  perform public.afirma(public.dia_do_mes('2026-01-01'::date, 31) = '2026-01-31'::date,
    'dia 31 em janeiro cobra em 31');
  perform public.afirma(public.dia_do_mes('2026-02-01'::date, 1) = '2026-02-01'::date,
    'dia 1 continua dia 1');

  -- Ano bissexto. 2028 tem 29 de fevereiro; um `case` escrito a mao erra aqui.
  perform public.afirma(public.dia_do_mes('2028-02-01'::date, 30) = '2028-02-29'::date,
    'dia 30 em fevereiro bissexto cobra em 29');
  perform public.afirma(public.dia_do_mes('2100-02-01'::date, 31) = '2100-02-28'::date,
    'e 2100 nao e bissexto, mesmo divisivel por 4');

  -- O mes chega como qualquer dia dele, nao so o primeiro.
  perform public.afirma(public.dia_do_mes('2026-02-17'::date, 30) = '2026-02-28'::date,
    'a competencia pode vir com qualquer dia do mes');
end $$;

-- 3: a recusa de `coerir_contrato`.
do $$
declare d smallint; devolvido smallint; ok boolean;
begin
  for d in 29..31 loop
    select dia_vencimento into devolvido from public.coerir_contrato(
      'Social', 'recorrente'::public.formato_contrato, d::smallint, null);
    perform public.afirma(devolvido = d, 'coerir_contrato aceita o dia ' || d);
  end loop;

  begin
    perform public.coerir_contrato('Social', 'recorrente'::public.formato_contrato, 32::smallint, null);
    ok := false;
  exception when others then ok := position('entre 1 e 31' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'dia 32 continua recusado, dizendo o intervalo certo');

  begin
    perform public.coerir_contrato('Social', 'recorrente'::public.formato_contrato, 0::smallint, null);
    ok := false;
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'dia 0 continua recusado');
end $$;

-- 4 e 5: o CHECK da coluna, e a cobranca nascendo em fevereiro.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'direcao@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Direcao', 'admin', true, 'direcao@astartstudio.com.br');
insert into public.clientes (id, nome, slug, fuso_horario) values
  ('a0000000-0000-0000-0000-00000000000a', 'Padaria Aurora', 'padaria-aurora', 'America/Sao_Paulo');

set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000001';

do $$
declare
  v_serv uuid;
  v_cs   uuid;
  v_n    int;
  v_venc date;
begin
  select id into v_serv from public.servicos where chave = 'gestao_digital';
  perform public.afirma(v_serv is not null, 'ha servico no catalogo para o teste');

  -- 4. O CHECK aceita 30. Antes da 0064 este insert era recusado.
  insert into public.cliente_servicos
    (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
  values ('a0000000-0000-0000-0000-00000000000a', v_serv, 'recorrente', 150000, 30, '2026-01-01')
  returning id into v_cs;
  perform public.afirma(v_cs is not null, 'da para contratar com vencimento dia 30');

  -- 5. A COBRANCA DE FEVEREIRO.
  --
  -- Esta e a linha que importa. Com `make_date(2026, 2, 30)` a funcao inteira
  -- estourava com "date field value out of range", e o financeiro do mes nao
  -- saia — nao era so o dia ficar errado, era a cobranca nao existir.
  v_n := public.gerar_cobrancas_do_contrato(v_cs, '2026-02-01'::date);
  perform public.afirma(v_n = 1, 'a cobranca de fevereiro e gerada');

  select vencimento into v_venc from public.lancamentos
   where cliente_id = 'a0000000-0000-0000-0000-00000000000a' and competencia = '2026-02-01';
  perform public.afirma(v_venc = '2026-02-28'::date,
    'e vence em 28/02, nao em 30/02, que nao existe');

  -- E em marco volta para o dia combinado.
  perform public.gerar_cobrancas_do_contrato(v_cs, '2026-03-01'::date);
  select vencimento into v_venc from public.lancamentos
   where cliente_id = 'a0000000-0000-0000-0000-00000000000a' and competencia = '2026-03-01';
  perform public.afirma(v_venc = '2026-03-30'::date,
    'e em marco volta a vencer no dia 30 combinado');
end $$;

rollback;
