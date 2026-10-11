-- =============================================================================
-- Smoke dos entregaveis, versoes e marcos.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;

create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if;
end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000002', 'layana@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000002', 'Layana', 'operacao', 'layana@astartstudio.com.br');
insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a', 'Cliente A', 'entreg-a');
insert into public.clientes_usuarios (user_id, cliente_id, email) values
  ('20000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br');

-- ---------------------------------------------------------------------------
-- 1. Contratar Website cria os 11 entregaveis sozinho
-- ---------------------------------------------------------------------------
insert into public.cliente_servicos
  (id, cliente_id, servico_id, formato, valor_centavos, parcelas, inicio, entrega_em)
select 'c5000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a',
       s.id, 'projeto', 1200000, 3, date '2026-10-01', date '2026-12-15'
  from public.servicos s where s.chave = 'website';

do $$ begin
  perform public.afirma(
    (select count(*) from public.entregaveis
      where cliente_servico_id = 'c5000000-0000-0000-0000-000000000001') = 11,
    'contratar Website criou os 11 entregaveis do modelo');
  perform public.afirma(
    (select count(distinct fase) from public.entregaveis
      where cliente_servico_id = 'c5000000-0000-0000-0000-000000000001') = 4,
    'os 11 vieram em 4 fases');
  perform public.afirma(
    (select titulo from public.entregaveis
      where cliente_servico_id = 'c5000000-0000-0000-0000-000000000001' and ordem = 1) = 'Briefing e arquitetura',
    'a ordem do modelo foi respeitada');
end $$;

-- Rodar de novo nao duplica nem sobrescreve o que a equipe editou.
update public.entregaveis set titulo = 'Wireframe revisado'
 where cliente_servico_id = 'c5000000-0000-0000-0000-000000000001' and ordem = 2;

do $$ begin
  perform public.afirma(
    public.criar_entregaveis_do_modelo('c5000000-0000-0000-0000-000000000001') = 0,
    'criar de novo nao faz nada quando ja existe entregavel');
  perform public.afirma(
    (select titulo from public.entregaveis
      where cliente_servico_id = 'c5000000-0000-0000-0000-000000000001' and ordem = 2) = 'Wireframe revisado',
    'a edicao da equipe sobrevive');
end $$;

-- Gestao Digital nao tem modelo: nao cria nada.
insert into public.cliente_servicos
  (id, cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select 'c5000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a',
       s.id, 'recorrente', 280000, 10, date '2026-10-01'
  from public.servicos s where s.chave = 'gestao_digital';

do $$ begin
  perform public.afirma(
    (select count(*) from public.entregaveis
      where cliente_servico_id = 'c5000000-0000-0000-0000-000000000002') = 0,
    'Gestao Digital nao cria entregavel: o ciclo dela e mensal');
end $$;

-- ---------------------------------------------------------------------------
-- 2. O estado vem do item; sem item e "a fazer"
-- ---------------------------------------------------------------------------
do $$ begin
  perform public.afirma(
    (select count(*) from public.entregaveis_com_estado
      where cliente_servico_id = 'c5000000-0000-0000-0000-000000000001' and estado = 'a_fazer') = 11,
    'entregavel sem item e a fazer');
end $$;

insert into public.itens_aprovacao (id, cliente_id, tipo, estado, titulo, enviado_em)
values ('e1000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000a',
        'entregavel','em_aprovacao','Layout desktop', now());

update public.entregaveis set item_id = 'e1000000-0000-0000-0000-000000000003'
 where cliente_servico_id = 'c5000000-0000-0000-0000-000000000001' and ordem = 3;

do $$ begin
  perform public.afirma(
    (select estado from public.entregaveis_com_estado where ordem = 3
      and cliente_servico_id = 'c5000000-0000-0000-0000-000000000001') = 'em_aprovacao',
    'com item, o estado vem do item');
end $$;

-- Renomear o entregavel reflete na lista unica de aprovacoes.
update public.entregaveis set titulo = 'Layout desktop v2'
 where cliente_servico_id = 'c5000000-0000-0000-0000-000000000001' and ordem = 3;

do $$ begin
  perform public.afirma(
    (select titulo from public.itens_aprovacao where id = 'e1000000-0000-0000-0000-000000000003')
      = 'Layout desktop v2',
    'o titulo do entregavel espelha no item');
end $$;

-- Responder o item muda o estado que o entregavel mostra.
select public.responder_item('e1000000-0000-0000-0000-000000000003', 'com_ajustes', 'Bruna',
                             'cliente', 'O preco some na dobra.');

do $$ begin
  perform public.afirma(
    (select estado from public.entregaveis_com_estado where ordem = 3
      and cliente_servico_id = 'c5000000-0000-0000-0000-000000000001') = 'com_ajustes',
    'o entregavel segue o item, sem estado proprio');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Versoes
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '10000000-0000-0000-0000-000000000002';

do $$
declare v1 public.entregavel_versoes; v2 public.entregavel_versoes; alvo uuid;
begin
  select id into alvo from public.entregaveis
   where cliente_servico_id = 'c5000000-0000-0000-0000-000000000001' and ordem = 3;
  v1 := public.nova_versao_entregavel(alvo, 'primeira');
  v2 := public.nova_versao_entregavel(alvo, 'segunda');
  perform public.afirma(v1.numero = 1 and v2.numero = 2, 'versao numera 1, 2 sem buraco');
  perform public.afirma(
    (select versao_atual from public.entregaveis_com_estado where id = alvo) = 2,
    'a view mostra a versao atual');
end $$;

reset role;

-- Arquivo precisa de exatamente um destino: caminho OU url externa.
do $$
declare ok boolean := false; v uuid;
begin
  select id into v from public.entregavel_versoes limit 1;
  begin
    insert into public.entregavel_arquivos (versao_id, nome) values (v, 'solto.fig');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'arquivo sem destino e recusado');

  ok := false;
  begin
    insert into public.entregavel_arquivos (versao_id, nome, caminho, url_externa)
    values (v, 'dois.fig', 'a/b.fig', 'https://figma.com/x');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'arquivo com dois destinos e recusado');

  insert into public.entregavel_arquivos (versao_id, nome, url_externa)
  values (v, 'layout.fig', 'https://figma.com/x');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Marcos
-- ---------------------------------------------------------------------------
insert into public.marcos (cliente_servico_id, titulo, prazo, responsavel_id) values
  ('c5000000-0000-0000-0000-000000000001','Layout aprovado', date '2026-10-17',
   '10000000-0000-0000-0000-000000000002'),
  ('c5000000-0000-0000-0000-000000000001','Site no ar', date '2026-12-15', null);

-- ---------------------------------------------------------------------------
-- 5. O portao vale para entregavel e marco
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';

do $$ begin
  perform public.afirma((select count(*) from public.entregaveis) = 11,
    'cliente ve os entregaveis do proprio projeto');
  perform public.afirma((select count(*) from public.marcos) = 2,
    'cliente ve os marcos');
  perform public.afirma((select count(*) from public.entregavel_versoes) = 2,
    'cliente ve as versoes');
  perform public.afirma((select count(*) from public.entregavel_arquivos) = 1,
    'cliente ve o arquivo');
end $$;

reset role;

-- Encerrar o Website apaga o modulo e, com ele, o acesso do cliente.
update public.cliente_servicos set status = 'encerrado'
 where id = 'c5000000-0000-0000-0000-000000000001';

set role authenticated;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';

do $$ begin
  perform public.afirma(not public.cliente_tem_modulo('a0000000-0000-0000-0000-00000000000a','entregaveis'),
    'servico encerrado apaga o modulo entregaveis');
  perform public.afirma((select count(*) from public.entregaveis) = 0,
    'sem o modulo, o dado para de ser legivel — nao so a aba some');
  perform public.afirma((select count(*) from public.marcos) = 0,
    'o mesmo para marcos');
end $$;

reset role;
update public.cliente_servicos set status = 'ativo'
 where id = 'c5000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- 6. anon continua fora
-- ---------------------------------------------------------------------------
do $$
declare t text; v text;
begin
  foreach t in array array['modelos_entregavel','entregaveis','entregavel_versoes',
                           'entregavel_arquivos','marcos'] loop
    foreach v in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      perform public.afirma(not has_table_privilege('anon','public.'||t,v),
        format('anon nao tem %s em %s', v, t));
    end loop;
  end loop;
end $$;

select 'entregaveis: tudo passou' as resultado;
