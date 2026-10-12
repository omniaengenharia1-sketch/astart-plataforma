-- =============================================================================
-- Modulo — 0036: as leituras das telas que faltavam
--
-- Financeiro, fila de publicacao, agenda, grid, NPS, comercial, campanhas e
-- ambientes. Todas SECURITY INVOKER, como as outras: quem chama recebe o que o
-- RLS deixa, sem filtro escrito na mao dentro da funcao.
--
-- As do cliente conferem `usuario_ve_cliente` E o modulo contratado — ver a
-- tela de um modulo que o cliente nao contratou e tao errado quanto ver a de
-- outro cliente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- painel_financeiro — a tela Financeiro da equipe
--
-- O cliente nunca chama esta: ela cruza todos. O que ele ve e a sua propria
-- conta, em financeiro_do_cliente.
-- ---------------------------------------------------------------------------
create or replace function public.painel_financeiro(p_mes date default current_date)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with janela as (
    select date_trunc('month', p_mes)::date as inicio,
           (date_trunc('month', p_mes) + interval '1 month')::date as proximo
  ),
  linhas as (
    select v.* from public.lancamentos_com_situacao v, janela j
     where v.competencia >= j.inicio and v.competencia < j.proximo
  )
  select case when not public.usuario_ativo() then null::jsonb else jsonb_build_object(
    'mes', (select to_char(inicio, 'YYYY-MM-DD') from janela),

    'receitaCentavos', coalesce((select sum(valor_centavos) from linhas
       where natureza = 'receita' and situacao <> 'cancelado'), 0),
    'custoCentavos', coalesce((select sum(valor_centavos) from linhas
       where natureza = 'custo' and situacao <> 'cancelado'), 0),
    'recebidoCentavos', coalesce((select sum(valor_centavos) from linhas
       where natureza = 'receita' and situacao = 'recebido'), 0),
    'atrasadoCentavos', coalesce((select sum(valor_centavos) from linhas
       where natureza = 'receita' and situacao = 'atrasado'), 0),

    'lancamentos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'descricao', l.descricao,
        'clienteNome', (select c.nome from public.clientes c where c.id = l.cliente_id),
        'clienteId', l.cliente_id,
        'natureza', l.natureza,
        'grupo', l.grupo,
        'categoria', l.categoria,
        'subcategoria', l.subcategoria,
        'valorCentavos', l.valor_centavos,
        'vencimento', l.vencimento,
        'situacao', l.situacao,
        'forma', l.forma,
        -- A sugestao da IA so aparece enquanto ninguem confirmou.
        'sugestao', case when l.aceito_em is null and l.subcategoria_sugerida_id is not null
          then (select s.nome from public.financeiro_subcategorias s
                 where s.id = l.subcategoria_sugerida_id) end)
        order by l.vencimento nulls last, l.descricao)
      from linhas l), '[]'::jsonb),

    'porCliente', coalesce((
      select jsonb_agg(x order by (x->>'receitaCentavos')::bigint desc) from (
        select jsonb_build_object(
          'clienteId', c.id,
          'clienteNome', c.nome,
          'receitaCentavos', coalesce(sum(l.valor_centavos) filter (where l.natureza = 'receita'), 0),
          'atrasadoCentavos', coalesce(sum(l.valor_centavos) filter (where l.situacao = 'atrasado'), 0)) as x
          from linhas l
          join public.clientes c on c.id = l.cliente_id
         where l.natureza = 'receita' and l.situacao <> 'cancelado'
         group by c.id, c.nome
      ) y), '[]'::jsonb)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- financeiro_do_cliente — a aba Financeiro, dos dois lados
--
-- O cliente so enxerga o ramo de receita da hierarquia (politica da 0020),
-- entao a mesma funcao devolve a conta dele sem precisar de um `if` aqui.
-- ---------------------------------------------------------------------------
create or replace function public.financeiro_do_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ve_cliente(p_cliente) then null::jsonb else jsonb_build_object(
    'aVencerCentavos', coalesce((select sum(v.valor_centavos) from public.lancamentos_com_situacao v
       where v.cliente_id = p_cliente and v.situacao = 'previsto'), 0),
    'atrasadoCentavos', coalesce((select sum(v.valor_centavos) from public.lancamentos_com_situacao v
       where v.cliente_id = p_cliente and v.situacao = 'atrasado'), 0),
    'pagoNoAnoCentavos', coalesce((select sum(v.valor_centavos) from public.lancamentos_com_situacao v
       where v.cliente_id = p_cliente and v.situacao = 'recebido'
         and v.competencia >= date_trunc('year', current_date)::date), 0),
    'lancamentos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'descricao', v.descricao,
        'valorCentavos', v.valor_centavos,
        'vencimento', v.vencimento,
        'competencia', v.competencia,
        'situacao', v.situacao,
        'boletoUrl', (select cb.boleto_url from public.cobrancas cb where cb.lancamento_id = v.id),
        'pix', (select cb.pix_payload from public.cobrancas cb where cb.lancamento_id = v.id))
        order by v.vencimento desc nulls last)
      from public.lancamentos_com_situacao v
     where v.cliente_id = p_cliente), '[]'::jsonb)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- fila_publicacao — o que esta saindo, e o que falhou
--
-- Dois eixos de novo: `status` do post e `estado` do alvo. Uma peca aprovada
-- com um alvo que falhou continua "publicado" no post e "falhou" na conta.
-- ---------------------------------------------------------------------------
create or replace function public.fila_publicacao()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ativo() then null::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'clienteId', p.cliente_id,
        'clienteNome', c.nome,
        'titulo', p.titulo_interno,
        'tipo', p.tipo,
        'status', p.status,
        'quando', p.agendado_para,
        'erro', p.erro_mensagem,
        'alvos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'conta', cs.nome_exibicao,
            'plataforma', cs.plataforma,
            'estado', pa.estado,
            'erro', pa.erro_mensagem,
            'tentativas', pa.tentativas)
            order by cs.nome_exibicao)
          from public.post_alvos pa
          join public.contas_sociais cs on cs.id = pa.conta_social_id
         where pa.post_id = p.id), '[]'::jsonb))
        -- Falha primeiro: e o unico estado que pede mao humana.
        order by (p.status = 'falhou') desc, p.agendado_para)
      from public.posts p
      join public.clientes c on c.id = p.cliente_id
     where p.status in ('aprovado', 'agendado', 'publicando', 'falhou')
        or (p.status = 'publicado' and p.agendado_para > now() - interval '2 days')
    ), '[]'::jsonb)
  end;
$$;

-- ---------------------------------------------------------------------------
-- agenda — tudo que tem data, no mesmo lugar
-- ---------------------------------------------------------------------------
create or replace function public.agenda(
  p_de  date default current_date,
  p_ate date default (current_date + 30)
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ativo() then null::jsonb else
    coalesce((
      select jsonb_agg(x order by x->>'quando', x->>'oQue') from (

        select jsonb_build_object(
          'tipo', 'publicacao', 'quando', (p.agendado_para at time zone c.fuso_horario)::date,
          'clienteNome', c.nome, 'clienteId', c.id, 'oQue', p.titulo_interno,
          'detalhe', p.tipo::text) as x
          from public.posts p join public.clientes c on c.id = p.cliente_id
         where p.agendado_para is not null
           and (p.agendado_para at time zone c.fuso_horario)::date between p_de and p_ate

        union all
        select jsonb_build_object(
          'tipo', 'captacao', 'quando', s.data, 'clienteNome', c.nome, 'clienteId', c.id,
          'oQue', s.titulo, 'detalhe', coalesce(s.local, ''))
          from public.sessoes_captacao s join public.clientes c on c.id = s.cliente_id
         where s.data between p_de and p_ate

        union all
        select jsonb_build_object(
          'tipo', 'marco', 'quando', m.prazo, 'clienteNome', c.nome, 'clienteId', c.id,
          'oQue', m.titulo, 'detalhe', sv.nome)
          from public.marcos m
          join public.cliente_servicos cs on cs.id = m.cliente_servico_id
          join public.servicos sv on sv.id = cs.servico_id
          join public.clientes c on c.id = cs.cliente_id
         where m.prazo between p_de and p_ate and m.concluido_em is null

        union all
        select jsonb_build_object(
          'tipo', 'cobranca', 'quando', v.vencimento, 'clienteNome', c.nome, 'clienteId', c.id,
          'oQue', v.descricao, 'detalhe', v.situacao)
          from public.lancamentos_com_situacao v
          join public.clientes c on c.id = v.cliente_id
         where v.vencimento between p_de and p_ate and v.natureza = 'receita'
           and v.situacao in ('previsto', 'atrasado')
      ) y), '[]'::jsonb)
  end;
$$;

-- ---------------------------------------------------------------------------
-- grid_do_cliente — o feed como ele vai ficar
-- ---------------------------------------------------------------------------
create or replace function public.grid_do_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when not public.usuario_ve_cliente(p_cliente)
      or not public.cliente_tem_modulo(p_cliente, 'grid') then null::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'titulo', p.titulo_interno,
        'tipo', p.tipo,
        'status', p.status,
        'estado', coalesce((select i.estado::text from public.itens_aprovacao i where i.id = p.item_id), 'produzindo'),
        'quando', p.agendado_para,
        'capa', (select m.storage_path from public.post_midias m
                  where m.post_id = p.id order by m.ordem limit 1))
        order by coalesce(p.ordem_feed, 9999), p.agendado_para desc nulls last)
      from public.posts p
     where p.cliente_id = p_cliente
       and p.status in ('aprovado', 'agendado', 'publicando', 'publicado')), '[]'::jsonb)
  end;
$$;

-- ---------------------------------------------------------------------------
-- nps_resumo / nps_do_cliente
-- ---------------------------------------------------------------------------
create or replace function public.nps_resumo()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with r as (
    select n.*, p.cliente_id, p.competencia
      from public.nps_respostas n
      join public.nps_pesquisas p on p.id = n.pesquisa_id
     where p.competencia >= (date_trunc('month', current_date) - interval '5 months')::date
  )
  select case when not public.usuario_ativo() then null::jsonb else jsonb_build_object(
    'respostas', (select count(*) from r),
    'promotores', (select count(*) from r where nota >= 9),
    'neutros', (select count(*) from r where nota between 7 and 8),
    'detratores', (select count(*) from r where nota <= 6),
    'nps', case when (select count(*) from r) = 0 then null else
      round(((select count(*) from r where nota >= 9)::numeric
           - (select count(*) from r where nota <= 6)::numeric)
           / (select count(*) from r)::numeric * 100) end,
    'ultimas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nota', r.nota, 'comentario', r.comentario, 'quem', r.autor_nome,
        'quando', r.criado_em,
        'clienteNome', (select c.nome from public.clientes c where c.id = r.cliente_id),
        'clienteId', r.cliente_id)
        order by r.criado_em desc)
      from r where r.comentario is not null or r.nota <= 6), '[]'::jsonb),
    'semResposta', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clienteNome', c.nome, 'competencia', p.competencia)
        order by p.competencia desc)
      from public.nps_pesquisas p
      join public.clientes c on c.id = p.cliente_id
     where not exists (select 1 from public.nps_respostas n where n.pesquisa_id = p.id)
       and p.enviada_em is not null), '[]'::jsonb)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- funil — o comercial
-- ---------------------------------------------------------------------------
create or replace function public.funil()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ativo() then null::jsonb else jsonb_build_object(
    'abertos', (select count(*) from public.leads
                 where etapa not in ('fechado', 'perdido', 'descartado')),
    'valorAbertoCentavos', coalesce((select sum(valor_estimado_centavos) from public.leads
       where etapa not in ('fechado', 'perdido', 'descartado')), 0),
    'fechadosNoMes', (select count(*) from public.leads
       where convertido_em >= date_trunc('month', current_date)),
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'nome', l.nome, 'empresa', l.empresa, 'etapa', l.etapa,
        'valorCentavos', l.valor_estimado_centavos, 'origem', l.origem,
        'proximoPasso', l.proximo_passo, 'proximoEm', l.proximo_followup_em,
        'responsavelNome', (select p.nome from public.perfis p where p.user_id = l.responsavel_id),
        'ultimaEm', l.ultima_interacao_em)
        order by l.proximo_followup_em nulls last, l.atualizado_em desc)
      from public.leads l
     where l.etapa not in ('fechado', 'perdido', 'descartado')), '[]'::jsonb)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- campanhas_do_cliente / ambientes_do_cliente
-- ---------------------------------------------------------------------------
create or replace function public.campanhas_do_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when not public.usuario_ve_cliente(p_cliente)
      or not public.cliente_tem_modulo(p_cliente, 'campanhas') then null::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'de', r.periodo_inicio,
        'ate', r.periodo_fim,
        'arquivo', r.arquivo_nome,
        'metricas', coalesce((
          select jsonb_agg(jsonb_build_object('rotulo', m.rotulo, 'valor', m.valor) order by m.ordem)
          from public.relatorio_metricas m where m.relatorio_id = r.id), '[]'::jsonb),
        'campanhas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'nome', ca.nome, 'plataforma', ca.plataforma, 'objetivo', ca.objetivo,
            'verbaCentavos', ca.verba_centavos,
            'resultadoRotulo', ca.resultado_rotulo, 'resultadoValor', ca.resultado_valor)
            order by ca.nome)
          from public.campanhas ca where ca.relatorio_id = r.id), '[]'::jsonb))
        order by r.periodo_inicio desc)
      from public.relatorios_campanha r
     where r.cliente_id = p_cliente), '[]'::jsonb)
  end;
$$;

create or replace function public.ambientes_do_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when not public.usuario_ve_cliente(p_cliente)
      or not public.cliente_tem_modulo(p_cliente, 'ambientes') then null::jsonb
    else jsonb_build_object(
      'ambientes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'nome', a.nome, 'url', a.url, 'hospedagem', a.hospedagem,
          'sslRenovaEm', a.ssl_renova_em, 'noAr', a.no_ar) order by a.nome)
        from public.ambientes a
        join public.cliente_servicos cs on cs.id = a.cliente_servico_id
       where cs.cliente_id = p_cliente), '[]'::jsonb),
      'dominios', coalesce((
        select jsonb_agg(jsonb_build_object(
          'dominio', d.dominio, 'registrador', d.registrador,
          'titular', d.titular, 'venceEm', d.vence_em) order by d.vence_em)
        from public.dominios d where d.cliente_id = p_cliente), '[]'::jsonb),
      'chamados', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', ch.id, 'titulo', ch.titulo, 'prioridade', ch.prioridade,
          'status', ch.status, 'abertoEm', ch.criado_em) order by ch.criado_em desc)
        from public.chamados ch where ch.cliente_id = p_cliente), '[]'::jsonb)
    )
  end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'painel_financeiro(date)', 'financeiro_do_cliente(uuid)', 'fila_publicacao()',
    'agenda(date,date)', 'grid_do_cliente(uuid)', 'nps_resumo()', 'funil()',
    'campanhas_do_cliente(uuid)', 'ambientes_do_cliente(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
