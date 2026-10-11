-- =============================================================================
-- Smoke do plano de conteudo: geracao de slots, fuso, item por peca e ideias.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000002', 'layana@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000002', 'Layana', 'operacao', 'layana@astartstudio.com.br');

-- Fuso diferente de UTC de proposito, para o horario ser testado de verdade.
insert into public.clientes (id, nome, slug, fuso_horario) values
  ('a0000000-0000-0000-0000-00000000000a', 'Cliente A', 'plano-a', 'America/Sao_Paulo');

insert into public.cliente_servicos
  (id, cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select 'c5000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a',
       s.id, 'recorrente', 280000, 10, date '2026-10-01'
  from public.servicos s where s.chave = 'gestao_digital';

-- ---------------------------------------------------------------------------
-- 1. Sem plano, a funcao recusa com motivo
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';

do $$
declare ok boolean := false;
begin
  begin
    perform public.gerar_slots('c5000000-0000-0000-0000-000000000001', date '2026-11-01');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'gerar sem plano e recusado');
end $$;

reset role;

insert into public.planos_conteudo (cliente_servico_id, dias_semana, horario, posts_por_mes, reels_por_mes)
values ('c5000000-0000-0000-0000-000000000001', '{1,3,5}', '12:00', 8, 2);

-- ---------------------------------------------------------------------------
-- 2. Gera exatamente o escopo contratado, nas segundas, quartas e sextas
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';

do $$
declare n integer;
begin
  n := public.gerar_slots('c5000000-0000-0000-0000-000000000001', date '2026-11-01');
  perform public.afirma(n = 10, 'gerou 10 slots: 8 posts + 2 reels do contrato');
end $$;

reset role;

do $$ begin
  perform public.afirma(
    (select count(*) from public.posts
      where cliente_id = 'a0000000-0000-0000-0000-00000000000a') = 10,
    '10 pecas no banco');

  perform public.afirma(
    not exists (
      select 1 from public.posts p
       where p.cliente_id = 'a0000000-0000-0000-0000-00000000000a'
         and extract(dow from (p.agendado_para at time zone 'America/Sao_Paulo'))
             not in (1, 3, 5)),
    'toda peca caiu em segunda, quarta ou sexta');

  perform public.afirma(
    not exists (
      select 1 from public.posts p
       where p.cliente_id = 'a0000000-0000-0000-0000-00000000000a'
         and (p.agendado_para at time zone 'America/Sao_Paulo')::time <> time '12:00'),
    'o horario e 12h no fuso do cliente, nao em UTC');

  -- Em Sao Paulo (UTC-3) meio-dia local e 15h UTC.
  perform public.afirma(
    (select distinct (agendado_para at time zone 'UTC')::time from public.posts
      where cliente_id = 'a0000000-0000-0000-0000-00000000000a') = time '15:00',
    'gravado em UTC, renderizado no fuso do cliente');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Toda peca nasce com item, em producao, sem titulo
-- ---------------------------------------------------------------------------
do $$ begin
  perform public.afirma(
    not exists (select 1 from public.posts
                 where cliente_id = 'a0000000-0000-0000-0000-00000000000a' and item_id is null),
    'toda peca nasce com item de aprovacao');
  perform public.afirma(
    (select count(*) from public.itens_aprovacao
      where cliente_id = 'a0000000-0000-0000-0000-00000000000a' and estado = 'produzindo') = 10,
    'os 10 itens nascem em producao');
  perform public.afirma(
    (select count(*) from public.posts
      where cliente_id = 'a0000000-0000-0000-0000-00000000000a' and btrim(titulo_interno) = '') = 10,
    'slot nasce sem titulo: e isso que a pessoa vai preencher');
end $$;

-- Preencher o titulo espelha no item.
update public.posts set titulo_interno = '5 tecidos que não encolhem'
 where id = (select id from public.posts
              where cliente_id = 'a0000000-0000-0000-0000-00000000000a'
              order by agendado_para limit 1);

do $$ begin
  perform public.afirma(
    exists (select 1 from public.itens_aprovacao
             where titulo = '5 tecidos que não encolhem'),
    'titulo da peca espelha no item');
end $$;

-- Sair de rascunho sem titulo e recusado.
do $$
declare ok boolean := false; alvo uuid;
begin
  select id into alvo from public.posts
   where cliente_id = 'a0000000-0000-0000-0000-00000000000a' and btrim(titulo_interno) = ''
   limit 1;
  begin
    update public.posts set status = 'aguardando_aprovacao' where id = alvo;
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'peca sem titulo nao sai de rascunho');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Gerar de novo nao duplica
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';
do $$ begin
  perform public.afirma(
    public.gerar_slots('c5000000-0000-0000-0000-000000000001', date '2026-11-01') = 0,
    'gerar o mesmo mes de novo nao cria nada');
end $$;
reset role;

do $$ begin
  perform public.afirma(
    (select count(*) from public.posts
      where cliente_id = 'a0000000-0000-0000-0000-00000000000a') = 10,
    'continuam 10 pecas');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Dias de semana invalidos sao recusados
-- ---------------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  begin
    update public.planos_conteudo set dias_semana = '{1,9}'
     where cliente_servico_id = 'c5000000-0000-0000-0000-000000000001';
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'dia 9 da semana nao existe');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Ideias
-- ---------------------------------------------------------------------------
insert into public.ideias (cliente_id, titulo, motivo) values
  ('a0000000-0000-0000-0000-00000000000a', '3 erros ao lavar linho', 'subiu em buscas esta semana'),
  ('a0000000-0000-0000-0000-00000000000a', 'Antes e depois de uma peça', 'mais salvamento em setembro');

do $$
declare ok boolean := false; alvo uuid;
begin
  select id into alvo from public.posts
   where cliente_id = 'a0000000-0000-0000-0000-00000000000a' limit 1;

  -- marcar como usada sem apontar a peca e incoerente
  begin
    update public.ideias set usada_em = now() where titulo = '3 erros ao lavar linho';
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'ideia usada precisa dizer em qual peca');

  update public.ideias set usada_em = now(), post_id = alvo
   where titulo = '3 erros ao lavar linho';
  perform public.afirma(
    (select count(*) from public.ideias
      where cliente_id = 'a0000000-0000-0000-0000-00000000000a'
        and usada_em is null and descartada_em is null) = 1,
    'sobra uma ideia em aberto');
end $$;

select 'plano de conteudo: tudo passou' as resultado;
