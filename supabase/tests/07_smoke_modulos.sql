-- =============================================================================
-- Smoke de campanhas, galeria, ambientes, manutencao, NPS e comercial.
-- O foco e o portao e o que o cliente NAO pode ver.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000002', 'layana@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br');
insert into public.perfis (user_id, nome, papel, email) values
  ('10000000-0000-0000-0000-000000000002', 'Layana', 'operacao', 'layana@astartstudio.com.br');
insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a', 'Cliente A', 'mod-a');
insert into public.clientes_usuarios (user_id, cliente_id, email) values
  ('20000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br');

-- Gestao Digital (trafego desligado), Audiovisual e Website.
insert into public.cliente_servicos
  (id, cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select 'c5000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-00000000000a',
       s.id, 'recorrente', 280000, 10, date '2026-10-01'
  from public.servicos s where s.chave = 'gestao_digital';
insert into public.cliente_servicos
  (id, cliente_id, servico_id, formato, valor_centavos, parcelas, inicio, data_evento)
select 'c5000000-0000-0000-0000-00000000000e', 'a0000000-0000-0000-0000-00000000000a',
       s.id, 'pontual', 240000, 1, date '2026-10-01', date '2026-10-14'
  from public.servicos s where s.chave = 'audiovisual';
insert into public.cliente_servicos
  (id, cliente_id, servico_id, formato, valor_centavos, parcelas, inicio)
select 'c5000000-0000-0000-0000-0000000000cc', 'a0000000-0000-0000-0000-00000000000a',
       s.id, 'projeto', 1200000, 3, date '2026-10-01'
  from public.servicos s where s.chave = 'website';

-- ---------------------------------------------------------------------------
-- 1. Campanhas: so com a chave do trafego ligada
-- ---------------------------------------------------------------------------
insert into public.relatorios_campanha (id, cliente_id, periodo_inicio, periodo_fim, arquivo_nome)
values ('d1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a',
        date '2026-09-01', date '2026-09-30', 'relatorio-setembro.pdf');
insert into public.campanhas (relatorio_id, nome, plataforma, verba_centavos, resultado_rotulo, resultado_valor)
values ('d1000000-0000-0000-0000-000000000001','Coleção primavera','meta', 40000, 'pessoas alcançadas', 22400);
insert into public.relatorio_metricas (relatorio_id, chave, rotulo, valor, ordem) values
  ('d1000000-0000-0000-0000-000000000001','alcance','Alcance',48200,1),
  ('d1000000-0000-0000-0000-000000000001','cliques','Cliques',1930,2);

set role authenticated;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$ begin
  perform public.afirma((select count(*) from public.relatorios_campanha) = 0,
    'sem a chave do trafego o cliente NAO ve relatorio');
  perform public.afirma((select count(*) from public.relatorio_metricas) = 0,
    'nem as metricas');
end $$;
reset role;

insert into public.cliente_servico_modulos (cliente_servico_id, modulo_id, ligado)
select 'c5000000-0000-0000-0000-00000000000d', m.id, true
  from public.modulos m where m.chave = 'campanhas';

set role authenticated;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$ begin
  perform public.afirma((select count(*) from public.relatorios_campanha) = 1,
    'com a chave ligada o relatorio aparece');
  perform public.afirma((select count(*) from public.campanhas) = 1, 've a campanha');
  perform public.afirma((select count(*) from public.relatorio_metricas) = 2, 've as metricas');
end $$;
reset role;

-- Resultado pela metade e recusado.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.campanhas (relatorio_id, nome, plataforma, resultado_rotulo)
    values ('d1000000-0000-0000-0000-000000000001','Sem valor','tiktok','cliques');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'resultado com rotulo e sem valor e recusado');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Galeria: vem do Audiovisual
-- ---------------------------------------------------------------------------
insert into public.sessoes_captacao (id, cliente_id, cliente_servico_id, titulo, data, status, qtd_fotos, qtd_videos)
values ('d2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a',
        'c5000000-0000-0000-0000-00000000000e','Captação na fábrica', date '2026-09-30','entregue',44,6);
insert into public.galerias (sessao_id, provedor, url)
values ('d2000000-0000-0000-0000-000000000001','pixieset','https://exemplo.pixieset.com/fabrica');

set role authenticated;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$ begin
  perform public.afirma((select count(*) from public.sessoes_captacao) = 1,
    'Audiovisual acende a galeria');
  perform public.afirma((select count(*) from public.galerias) = 1, 've o link da galeria');
end $$;
reset role;

-- Galeria sem endereco nenhum e recusada.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.galerias (sessao_id, provedor) values
      ('d2000000-0000-0000-0000-000000000001','drive');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'galeria sem url nem id externo e recusada');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Ambientes e acessos: o cliente ve o ambiente, NUNCA os acessos
-- ---------------------------------------------------------------------------
insert into public.ambientes (cliente_servico_id, nome, url, hospedagem, ssl_renova_em, no_ar)
values ('c5000000-0000-0000-0000-0000000000cc','Produção','mormarcas.com.br','Vercel', date '2027-01-12', true);
insert into public.dominios (cliente_id, dominio, registrador, vence_em)
values ('a0000000-0000-0000-0000-00000000000a','mormarcas.com.br','registro.br', date '2027-03-04');
insert into public.acessos (cliente_servico_id, descricao, onde)
values ('c5000000-0000-0000-0000-0000000000cc','Painel de hospedagem','cofre da Astart');
insert into public.integracoes (cliente_servico_id, nome, categoria)
values ('c5000000-0000-0000-0000-0000000000cc','Google Analytics','medição');

set role authenticated;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$ begin
  perform public.afirma((select count(*) from public.ambientes) = 1, 'cliente ve o ambiente');
  perform public.afirma((select count(*) from public.dominios) = 1, 'cliente ve o dominio');
  perform public.afirma((select count(*) from public.acessos) = 0,
    'cliente NUNCA ve onde ficam as chaves, nem com o modulo ligado');
  perform public.afirma((select count(*) from public.integracoes) = 0,
    'integracao e trabalho interno');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 4. Chamados: o cliente abre, e abre como cliente
-- ---------------------------------------------------------------------------
set role authenticated;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';

insert into public.chamados (cliente_id, titulo, aberto_por_tipo, aberto_por_nome)
values ('a0000000-0000-0000-0000-00000000000a','Formulário não envia no Safari','cliente','Bruna Melo');

do $$
declare ok boolean := false;
begin
  begin
    insert into public.chamados (cliente_id, titulo, aberto_por_tipo, aberto_por_nome)
    values ('a0000000-0000-0000-0000-00000000000a','Chamado falso','agencia','Bruna');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'cliente nao abre chamado se passando pela agencia');
end $$;

do $$ begin
  perform public.afirma((select count(*) from public.chamados) = 1, 'cliente ve o proprio chamado');
end $$;
reset role;

do $$
declare ok boolean := false;
begin
  begin
    update public.chamados set status = 'resolvido';
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'resolver sem data de resolucao e recusado');
end $$;

-- ---------------------------------------------------------------------------
-- 5. NPS: classificacao derivada da nota
-- ---------------------------------------------------------------------------
insert into public.nps_pesquisas (id, cliente_id, competencia, enviada_em)
values ('d3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a',
        date '2026-09-01', now());
insert into public.nps_respostas (pesquisa_id, nota, comentario, autor_nome) values
  ('d3000000-0000-0000-0000-000000000001', 6, 'Demora nos ajustes.', 'Bruna');

do $$ begin
  perform public.afirma(
    (select classificacao from public.nps_com_classificacao where nota = 6) = 'detrator',
    'nota 6 e detrator, nao neutro');
end $$;

insert into public.nps_pesquisas (id, cliente_id, competencia)
values ('d3000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a', date '2026-10-01');
insert into public.nps_respostas (pesquisa_id, nota) values
  ('d3000000-0000-0000-0000-000000000002', 9);

do $$ begin
  perform public.afirma(
    (select classificacao from public.nps_com_classificacao where nota = 9) = 'promotor',
    'nota 9 e promotor');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.nps_respostas (pesquisa_id, nota)
    values ('d3000000-0000-0000-0000-000000000002', 11);
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'nota 11 nao existe');
end $$;

-- Duas pesquisas no mesmo mes para o mesmo cliente sao recusadas.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.nps_pesquisas (cliente_id, competencia)
    values ('a0000000-0000-0000-0000-00000000000a', date '2026-10-01');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'uma pesquisa por cliente por mes');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Comercial: interno, e perder negocio exige motivo
-- ---------------------------------------------------------------------------
insert into public.leads (id, nome, empresa, etapa, score, valor_estimado_centavos)
values ('d4000000-0000-0000-0000-000000000001','Marcos Vinícius','Chopp do Barbudo',
        'fechado','hot', 190000);
insert into public.lead_servicos (lead_id, servico_id)
select 'd4000000-0000-0000-0000-000000000001', s.id
  from public.servicos s where s.chave = 'gestao_digital';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.leads (nome, etapa) values ('Perdido sem motivo', 'perdido');
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'perder negocio sem motivo e recusado');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    update public.leads set cliente_id = 'a0000000-0000-0000-0000-00000000000a'
     where id = 'd4000000-0000-0000-0000-000000000001';
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'converter sem data de conversao e recusado');
end $$;

update public.leads
   set cliente_id = 'a0000000-0000-0000-0000-00000000000a', convertido_em = now()
 where id = 'd4000000-0000-0000-0000-000000000001';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.leads (nome, etapa, cliente_id, convertido_em)
    values ('Em conversa que virou cliente', 'em_conversa',
            'a0000000-0000-0000-0000-00000000000a', now());
  exception when others then ok := true;
  end;
  perform public.afirma(ok, 'so lead fechado vira cliente');
end $$;

set role authenticated;
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';
do $$ begin
  perform public.afirma((select count(*) from public.leads) = 0,
    'cliente nao ve o CRM da agencia');
  perform public.afirma((select count(*) from public.lead_servicos) = 0, 'nem os servicos do lead');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 7. anon fora de tudo
-- ---------------------------------------------------------------------------
do $$
declare t text; v text;
begin
  foreach t in array array['relatorios_campanha','campanhas','relatorio_metricas',
                           'sessoes_captacao','galerias','galeria_itens',
                           'ambientes','dominios','acessos','integracoes',
                           'chamados','chamado_comentarios',
                           'nps_pesquisas','nps_respostas','leads','lead_servicos'] loop
    foreach v in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      perform public.afirma(not has_table_privilege('anon','public.'||t,v),
        format('anon nao tem %s em %s', v, t));
    end loop;
  end loop;
end $$;

select 'modulos: tudo passou' as resultado;
