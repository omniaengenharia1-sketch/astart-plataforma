-- =============================================================================
-- Smoke do financeiro: rateio exato, situacao derivada, parcelas sem centavo
-- perdido, sugestao da IA que nao se aplica sozinha e o que o cliente nao ve.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000003', 'camila@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'layana@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000003', 'Camila', 'financeiro', 'camila@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Layana', 'operacao',   'layana@astartstudio.com.br');
insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a', 'Cliente A', 'fin-a'),
  ('b0000000-0000-0000-0000-00000000000b', 'Cliente B', 'fin-b');
insert into public.clientes_usuarios (user_id, cliente_id, email) values
  ('20000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br');

-- Cliente A precisa de contrato ativo: sem servico nenhum, nem o modulo
-- "sempre" (financeiro, contrato, nps) acende.
insert into public.cliente_servicos
  (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select 'a0000000-0000-0000-0000-00000000000a', s.id, 'recorrente', 280000, 10, date '2026-10-01'
  from public.servicos s where s.chave = 'gestao_digital';

create or replace function public.sub(p_grupo text, p_cat text, p_sub text)
returns uuid language sql stable as $$
  select sub.id from public.financeiro_subcategorias sub
    join public.financeiro_categorias cat on cat.id = sub.categoria_id
    join public.financeiro_grupos       g on g.id = cat.grupo_id
   where g.chave = p_grupo and cat.nome = p_cat and sub.nome = p_sub;
$$;

-- ---------------------------------------------------------------------------
-- 1. Hierarquia de tres niveis
-- ---------------------------------------------------------------------------
do $$ begin
  perform public.afirma(public.sub('custo','Aplicativo','Mídia') is not null,
    'Custo > Aplicativo > Midia existe');
  perform public.afirma(public.sub('receita','Contrato','Recorrente') is not null,
    'Receita > Contrato > Recorrente existe');
  perform public.afirma(
    (select count(*) from public.financeiro_subcategorias) >= 20,
    'a hierarquia veio semeada');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Rateio tem que fechar exato
-- ---------------------------------------------------------------------------
insert into public.lancamentos (id, descricao, subcategoria_id, valor_centavos, competencia, contraparte)
values ('11110000-0000-0000-0000-000000000001', 'Meta Ads — verba',
        public.sub('custo','Aplicativo','Mídia'), 214000, date '2026-10-01', 'Meta');

-- rateio que nao fecha: recusado no commit
do $$
declare ok boolean := false;
begin
  begin
    insert into public.lancamento_rateios (lancamento_id, cliente_id, valor_centavos) values
      ('11110000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a', 90000),
      ('11110000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b', 50000);
    -- o gatilho e adiado para o commit; aqui forcamos a conferencia agora
    set constraints all immediate;
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'rateio que nao fecha com o total e recusado');
end $$;

-- rateio que fecha: aceito, e as linhas entram uma a uma sem a primeira estourar
begin;
  insert into public.lancamento_rateios (lancamento_id, cliente_id, valor_centavos)
  values ('11110000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a', 90000);
  insert into public.lancamento_rateios (lancamento_id, cliente_id, valor_centavos)
  values ('11110000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b', 124000);
commit;

do $$ begin
  perform public.afirma(
    (select sum(valor_centavos) from public.lancamento_rateios
      where lancamento_id = '11110000-0000-0000-0000-000000000001') = 214000,
    'rateio fecha exato com o lancamento');
end $$;

-- mudar o valor do lancamento sem refazer o rateio e recusado
do $$
declare ok boolean := false;
begin
  begin
    update public.lancamentos set valor_centavos = 300000
     where id = '11110000-0000-0000-0000-000000000001';
    set constraints all immediate;
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'mudar o valor quebrando o rateio e recusado');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Situacao derivada da data, nao guardada
-- ---------------------------------------------------------------------------
insert into public.lancamentos (id, descricao, subcategoria_id, cliente_id, valor_centavos,
                                competencia, vencimento)
values
  ('11110000-0000-0000-0000-000000000002','Gestão Digital — 10/2026',
   public.sub('receita','Contrato','Recorrente'), 'a0000000-0000-0000-0000-00000000000a',
   280000, date '2026-10-01', current_date - 3),
  ('11110000-0000-0000-0000-000000000003','Gestão Digital — 11/2026',
   public.sub('receita','Contrato','Recorrente'), 'a0000000-0000-0000-0000-00000000000a',
   280000, date '2026-11-01', current_date + 10);

do $$ begin
  perform public.afirma(
    (select situacao from public.lancamentos_com_situacao
      where id = '11110000-0000-0000-0000-000000000002') = 'atrasado',
    'vencido e previsto aparece como atrasado, sem rotina diaria');
  perform public.afirma(
    (select situacao from public.lancamentos_com_situacao
      where id = '11110000-0000-0000-0000-000000000003') = 'previsto',
    'a vencer e previsto');
end $$;

update public.lancamentos set status = 'liquidado', liquidado_em = current_date
 where id = '11110000-0000-0000-0000-000000000002';

do $$ begin
  perform public.afirma(
    (select situacao from public.lancamentos_com_situacao
      where id = '11110000-0000-0000-0000-000000000002') = 'recebido',
    'receita liquidada le "recebido"');
  perform public.afirma(
    (select situacao from public.lancamentos_com_situacao
      where id = '11110000-0000-0000-0000-000000000001') = 'previsto',
    'custo sem vencimento continua previsto');
end $$;

-- liquidado sem data e recusado
do $$
declare ok boolean := false;
begin
  begin
    update public.lancamentos set status = 'liquidado'
     where id = '11110000-0000-0000-0000-000000000003';
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'liquidado sem data de liquidacao e recusado');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Parcelas: nenhum centavo se perde
-- ---------------------------------------------------------------------------
insert into public.cliente_servicos
  (id, cliente_id, servico_id, formato, valor_centavos, parcelas, inicio)
select 'c5000000-0000-0000-0000-00000000000f', 'b0000000-0000-0000-0000-00000000000b',
       s.id, 'projeto', 100000, 3, date '2026-10-01'
  from public.servicos s where s.chave = 'website';

set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000003';
do $$ begin
  perform public.afirma(
    public.gerar_cobrancas_do_contrato('c5000000-0000-0000-0000-00000000000f', date '2026-10-01') = 3,
    'gerou as 3 parcelas');
end $$;
reset role;

do $$ begin
  perform public.afirma(
    (select sum(valor_centavos) from public.lancamentos
      where cliente_id = 'b0000000-0000-0000-0000-00000000000b') = 100000,
    'R$ 1.000,00 em 3x soma exatamente R$ 1.000,00 — o centavo da divisao vai na ultima');
  perform public.afirma(
    (select count(distinct competencia) from public.lancamentos
      where cliente_id = 'b0000000-0000-0000-0000-00000000000b') = 3,
    'uma parcela por mes');
end $$;

-- Operacao nao gera cobranca.
set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$
declare ok boolean := false;
begin
  begin
    perform public.gerar_cobrancas_do_contrato('c5000000-0000-0000-0000-00000000000f', date '2027-01-01');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'operacao nao mexe em cobranca');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 5. A IA sugere, a pessoa aceita — e o banco guarda os dois
-- ---------------------------------------------------------------------------
update public.lancamentos
   set subcategoria_sugerida_id = public.sub('custo','Freela','Design'),
       sugerido_em = now(), sugestao_modelo = 'modelo-de-teste'
 where id = '11110000-0000-0000-0000-000000000001';

do $$ begin
  perform public.afirma(
    (select subcategoria_id from public.lancamentos
      where id = '11110000-0000-0000-0000-000000000001') = public.sub('custo','Aplicativo','Mídia'),
    'a sugestao NAO se aplica sozinha');
  perform public.afirma(
    (select subcategoria_sugerida_id from public.lancamentos
      where id = '11110000-0000-0000-0000-000000000001') = public.sub('custo','Freela','Design'),
    'mas fica guardada para medir depois');
end $$;

-- sugestao sem data e recusada
do $$
declare ok boolean := false;
begin
  begin
    update public.lancamentos set sugerido_em = null
     where id = '11110000-0000-0000-0000-000000000001';
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'sugestao sem data e recusada');
end $$;

-- ---------------------------------------------------------------------------
-- 6. O que cada um ve
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';   -- cliente A
do $$ begin
  perform public.afirma((select count(*) from public.lancamentos) = 2,
    'cliente ve so as proprias cobrancas de receita');
  perform public.afirma(
    not exists (select 1 from public.lancamentos where descricao like 'Meta Ads%'),
    'cliente NAO ve custo da agencia');
  perform public.afirma((select count(*) from public.lancamento_rateios) = 0,
    'cliente NAO ve quanto foi rateado para ele');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- operacao
do $$ begin
  perform public.afirma((select count(*) from public.lancamentos) = 0,
    'operacao nao ve o financeiro');
end $$;

set "teste.uid" = '10000000-0000-0000-0000-000000000003';   -- financeiro
do $$ begin
  perform public.afirma((select count(*) from public.lancamentos) = 6,
    'financeiro ve tudo: 1 custo + 2 receitas do A + 3 parcelas do B');
end $$;
reset role;

do $$
declare t text; v text;
begin
  foreach t in array array['lancamentos','lancamento_rateios','cobrancas',
                           'financeiro_grupos','financeiro_categorias','financeiro_subcategorias'] loop
    foreach v in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      perform public.afirma(not has_table_privilege('anon','public.'||t,v),
        format('anon nao tem %s em %s', v, t));
    end loop;
  end loop;
end $$;

select 'financeiro: tudo passou' as resultado;
