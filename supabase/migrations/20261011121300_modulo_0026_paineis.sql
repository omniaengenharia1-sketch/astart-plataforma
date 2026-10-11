-- =============================================================================
-- Modulo — 0026: os paineis que o front le
--
-- Tudo aqui e SECURITY INVOKER de proposito: a funcao ve exatamente o que quem
-- chamou ve. Operacao nao recebe pendencia financeira porque o RLS de
-- lancamentos ja a escondeu — nao porque alguem lembrou de filtrar.
--
-- Uma chamada por tela, em vez de oito consultas do navegador montando o painel
-- na mao e cada uma delas podendo discordar das outras.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- minha_sessao — quem sou eu, e o que eu alcanco
-- ---------------------------------------------------------------------------
create or replace function public.minha_sessao()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then jsonb_build_object('tipo', 'anonimo')
    when exists (select 1 from public.perfis p where p.user_id = auth.uid() and p.ativo) then
      (select jsonb_build_object(
         'tipo', 'equipe',
         'perfil', jsonb_build_object(
           'userId', p.user_id, 'nome', p.nome, 'email', p.email,
           'papel', p.papel, 'cargo', p.cargo, 'ativo', p.ativo))
         from public.perfis p where p.user_id = auth.uid())
    when exists (select 1 from public.clientes_usuarios c where c.user_id = auth.uid() and c.ativo) then
      (select jsonb_build_object(
         'tipo', 'cliente',
         'nome', max(cu.nome),
         'email', max(cu.email),
         'clientes', jsonb_agg(jsonb_build_object(
           'id', c.id, 'nome', c.nome, 'slug', c.slug,
           'fusoHorario', c.fuso_horario, 'ativo', c.ativo) order by c.nome))
         from public.clientes_usuarios cu
         join public.clientes c on c.id = cu.cliente_id
        where cu.user_id = auth.uid() and cu.ativo)
    else jsonb_build_object('tipo', 'anonimo')
  end;
$$;

-- ---------------------------------------------------------------------------
-- painel_equipe — "o que precisa de voce hoje"
-- ---------------------------------------------------------------------------
create or replace function public.painel_equipe()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with pendencias as (
    -- peca ou entregavel que voltou com ajuste
    select i.id::text as id, i.cliente_id, c.nome as cliente_nome,
           case i.tipo when 'peca' then 'Peça voltou com ajuste'
                       else 'Entregável voltou com ajuste' end || ': ' || i.titulo as o_que,
           i.respondido_em as quando,
           case i.tipo when 'peca' then 'grid' else 'entregaveis' end as rota,
           'Abrir' as acao, true as urgente
      from public.itens_aprovacao i
      join public.clientes c on c.id = i.cliente_id
     where i.estado = 'com_ajustes'

    union all
    -- publicacao que falhou
    select a.id::text, p.cliente_id, c.nome,
           'Publicação falhou: ' || coalesce(a.erro_mensagem, 'motivo não registrado'),
           a.atualizado_em, 'fila', 'Resolver', true
      from public.post_alvos a
      join public.posts p    on p.id = a.post_id
      join public.clientes c on c.id = p.cliente_id
     where a.estado = 'falhou'

    union all
    -- cobranca vencida (so quem tem o financeiro enxerga; o RLS cuida disso)
    select l.id::text, l.cliente_id, c.nome,
           'Cobrança vencida: ' || l.descricao,
           l.vencimento::timestamptz, 'financeiro', 'Cobrar', true
      from public.lancamentos l
      join public.clientes c on c.id = l.cliente_id
     where l.status = 'previsto' and l.vencimento is not null and l.vencimento < current_date
       and public.subcategoria_natureza(l.subcategoria_id) = 'receita'

    union all
    -- detrator de NPS
    select r.id::text, p.cliente_id, c.nome,
           'NPS nota ' || r.nota || coalesce(' — “' || r.comentario || '”', ''),
           r.criado_em, 'feedbacks', 'Ver', true
      from public.nps_respostas r
      join public.nps_pesquisas p on p.id = r.pesquisa_id
      join public.clientes c      on c.id = p.cliente_id
     where r.nota <= 6
  )
  -- O RLS ja filtraria por cliente, mas isto e tela de equipe: quem nao e
  -- equipe recebe nada, nao uma versao reduzida da lista de tarefas da agencia.
  select case when not public.usuario_ativo() then null::jsonb else jsonb_build_object(
    'hoje', current_date,
    'pendencias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'clienteId', cliente_id, 'clienteNome', cliente_nome,
        'oQue', o_que, 'quando', quando, 'rota', rota, 'acao', acao, 'urgente', urgente)
        order by quando desc nulls last)
      from (select * from pendencias order by quando desc nulls last limit 20) x), '[]'::jsonb),

    'saiHoje', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'hora', to_char(p.agendado_para at time zone c.fuso_horario, 'HH24:MI'),
        'clienteNome', c.nome, 'tipo', p.tipo)
        order by p.agendado_para)
      from public.posts p join public.clientes c on c.id = p.cliente_id
      where p.status in ('agendado', 'publicando')
        and (p.agendado_para at time zone c.fuso_horario)::date = current_date), '[]'::jsonb),

    'semana', coalesce((
      select jsonb_agg(x order by x->>'data')
      from (
        select jsonb_build_object('id', m.id, 'data', m.prazo, 'titulo', m.titulo,
                                  'responsavelNome', pe.nome) as x
          from public.marcos m
          left join public.perfis pe on pe.user_id = m.responsavel_id
         where m.concluido_em is null
           and m.prazo between current_date and current_date + 7
        union all
        select jsonb_build_object('id', s.id, 'data', s.data,
                                  'titulo', 'Captação: ' || s.titulo, 'responsavelNome', pe.nome)
          from public.sessoes_captacao s
          left join public.perfis pe on pe.user_id = s.responsavel_id
         where s.status = 'agendada' and s.data between current_date and current_date + 7
      ) y), '[]'::jsonb),

    'esperandoCliente', (select count(*) from public.itens_aprovacao where estado = 'em_aprovacao'),

    'vencidoCentavos', coalesce((
      select sum(l.valor_centavos) from public.lancamentos l
       where l.status = 'previsto' and l.vencimento is not null and l.vencimento < current_date
         and public.subcategoria_natureza(l.subcategoria_id) = 'receita'), 0)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- painel_cliente — "o que precisa de voce" do lado do cliente
-- ---------------------------------------------------------------------------
create or replace function public.painel_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  -- Quem nao enxerga este cliente recebe nulo, e nao um objeto meio preenchido
  -- que o front teria de adivinhar como interpretar.
  select case when not public.usuario_ve_cliente(p_cliente)
    then null::jsonb
    else jsonb_build_object(

    'cliente', (select jsonb_build_object('id', c.id, 'nome', c.nome, 'slug', c.slug,
                  'fusoHorario', c.fuso_horario, 'ativo', c.ativo)
                  from public.clientes c where c.id = p_cliente),

    'modulos', coalesce((select jsonb_agg(m) from public.modulos_do_cliente(p_cliente) m), '[]'::jsonb),

    'paraAprovar', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'clienteId', i.cliente_id, 'clienteNome', c.nome, 'tipo', i.tipo,
        'estado', i.estado, 'titulo', i.titulo, 'enviadoEm', i.enviado_em,
        'respondidoEm', i.respondido_em, 'respondidoPor', i.respondido_por)
        order by i.enviado_em)
      from public.itens_aprovacao i join public.clientes c on c.id = i.cliente_id
      where i.cliente_id = p_cliente and i.estado = 'em_aprovacao'), '[]'::jsonb),

    'proximaCobranca', (
      select jsonb_build_object('id', v.id, 'descricao', v.descricao,
               'valorCentavos', v.valor_centavos, 'vencimento', v.vencimento,
               'situacao', v.situacao)
        from public.lancamentos_com_situacao v
       where v.cliente_id = p_cliente and v.natureza = 'receita'
         and v.situacao in ('previsto', 'atrasado')
       order by v.situacao = 'atrasado' desc, v.vencimento nulls last
       limit 1),

    'npsPendente', exists (
      select 1 from public.nps_pesquisas p
       where p.cliente_id = p_cliente and p.enviada_em is not null
         and not exists (select 1 from public.nps_respostas r where r.pesquisa_id = p.id)),

    'redes', case when public.cliente_tem_modulo(p_cliente, 'calendario') then (
      select jsonb_build_object(
        'publicados',    count(*) filter (where p.status = 'publicado'),
        'agendados',     count(*) filter (where p.status = 'agendado'),
        'esperandoVoce', count(*) filter (where i.estado = 'em_aprovacao'),
        'emProducao',    count(*) filter (where i.estado in ('produzindo', 'com_ajustes')))
        from public.posts p
        left join public.itens_aprovacao i on i.id = p.item_id
       where p.cliente_id = p_cliente
         and date_trunc('month', p.agendado_para) = date_trunc('month', now())) end,

    'projeto', (
      select jsonb_build_object(
        'servicoNome', s.nome,
        'total',     (select count(*) from public.entregaveis e where e.cliente_servico_id = cs.id),
        'entregues', (select count(*) from public.entregaveis_com_estado e
                       where e.cliente_servico_id = cs.id and e.estado = 'aprovado'),
        'fase',      (select e.fase from public.entregaveis_com_estado e
                       where e.cliente_servico_id = cs.id and e.estado <> 'aprovado'
                       order by e.ordem limit 1),
        'proximo',   (select e.titulo from public.entregaveis_com_estado e
                       where e.cliente_servico_id = cs.id and e.estado <> 'aprovado'
                       order by e.ordem limit 1))
        from public.cliente_servicos cs
        join public.servicos s on s.id = cs.servico_id
       where cs.cliente_id = p_cliente and cs.status = 'ativo' and cs.formato = 'projeto'
       order by cs.inicio limit 1),

    'captacao', case when public.cliente_tem_modulo(p_cliente, 'galeria') then
      jsonb_build_object(
        'proximaData',   (select s.data from public.sessoes_captacao s
                           where s.cliente_id = p_cliente and s.status = 'agendada'
                           order by s.data limit 1),
        'proximoTitulo', (select s.titulo from public.sessoes_captacao s
                           where s.cliente_id = p_cliente and s.status = 'agendada'
                           order by s.data limit 1),
        'ultimaTitulo',  (select s.titulo from public.sessoes_captacao s
                           where s.cliente_id = p_cliente and s.status = 'entregue'
                           order by s.data desc limit 1),
        'ultimaFotos',   coalesce((select s.qtd_fotos from public.sessoes_captacao s
                           where s.cliente_id = p_cliente and s.status = 'entregue'
                           order by s.data desc limit 1), 0),
        'ultimaVideos',  coalesce((select s.qtd_videos from public.sessoes_captacao s
                           where s.cliente_id = p_cliente and s.status = 'entregue'
                           order by s.data desc limit 1), 0))
      end
  ) end;
$$;

revoke all on function public.minha_sessao()        from public, anon;
revoke all on function public.painel_equipe()       from public, anon;
revoke all on function public.painel_cliente(uuid)  from public, anon;
grant execute on function public.minha_sessao()       to authenticated;
grant execute on function public.painel_equipe()      to authenticated;
grant execute on function public.painel_cliente(uuid) to authenticated;
