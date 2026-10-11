-- =============================================================================
-- Modulo — 0027: as listas que as telas leem
--
-- SECURITY INVOKER como as do 0026: quem chama ve o que o RLS deixa.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- lista_clientes — a tela Clientes
-- ---------------------------------------------------------------------------
create or replace function public.lista_clientes()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  -- A tela e da equipe. Cliente que chamar recebe nulo, nao a propria linha.
  select case when not public.usuario_ativo() then null::jsonb else
    coalesce(jsonb_agg(x order by x->>'nome'), '[]'::jsonb) end from (
    select jsonb_build_object(
      'id', c.id,
      'nome', c.nome,
      'slug', c.slug,
      'servicos', coalesce((
        select jsonb_agg(s.nome order by s.ordem)
          from public.cliente_servicos cs
          join public.servicos s on s.id = cs.servico_id
         where cs.cliente_id = c.id and cs.status = 'ativo'), '[]'::jsonb),
      'responsaveis', coalesce((
        select jsonb_agg(distinct pe.nome)
          from public.cliente_servicos cs
          join public.perfis pe on pe.user_id = cs.responsavel_id
         where cs.cliente_id = c.id and cs.status = 'ativo'), '[]'::jsonb),
      'precisaDeVoce', (
        select count(*) from public.itens_aprovacao i
         where i.cliente_id = c.id and i.estado = 'com_ajustes'),
      'esperandoCliente', (
        select count(*) from public.itens_aprovacao i
         where i.cliente_id = c.id and i.estado = 'em_aprovacao'),
      'mensalCentavos', coalesce((
        select sum(cs.valor_centavos) from public.cliente_servicos cs
         where cs.cliente_id = c.id and cs.status = 'ativo' and cs.formato = 'recorrente'), 0),
      'unicoCentavos', coalesce((
        select sum(cs.valor_centavos) from public.cliente_servicos cs
         where cs.cliente_id = c.id and cs.status = 'ativo' and cs.formato <> 'recorrente'), 0)
    ) as x
      from public.clientes c
     where c.ativo
  ) y;
$$;

-- ---------------------------------------------------------------------------
-- fila_aprovacoes — a tela Aprovacoes, todos os clientes, os dois objetos
-- ---------------------------------------------------------------------------
create or replace function public.fila_aprovacoes()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ativo() then null::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'clienteId', i.cliente_id,
        'clienteNome', c.nome,
        'tipo', i.tipo,
        'estado', i.estado,
        'titulo', i.titulo,
        'enviadoEm', i.enviado_em,
        'respondidoEm', i.respondido_em,
        'respondidoPor', i.respondido_por,
        'comentario', (
          select a.texto from public.aprovacao_comentarios a
           where a.item_id = i.id order by a.criado_em desc limit 1))
        order by i.estado = 'com_ajustes' desc, i.enviado_em)
      from public.itens_aprovacao i
      join public.clientes c on c.id = i.cliente_id
     where i.estado in ('em_aprovacao', 'com_ajustes')), '[]'::jsonb)
  end;
$$;

-- ---------------------------------------------------------------------------
-- ficha_cliente — a visao geral dentro do cliente
-- ---------------------------------------------------------------------------
create or replace function public.ficha_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ve_cliente(p_cliente) then null::jsonb else jsonb_build_object(

    'cliente', (select jsonb_build_object('id', c.id, 'nome', c.nome, 'slug', c.slug,
                  'fusoHorario', c.fuso_horario, 'ativo', c.ativo)
                  from public.clientes c where c.id = p_cliente),

    'modulos', coalesce((select jsonb_agg(m) from public.modulos_do_cliente(p_cliente) m), '[]'::jsonb),

    'servicos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cs.id, 'clienteId', cs.cliente_id, 'servico', s.chave, 'servicoNome', s.nome,
        'formato', cs.formato, 'status', cs.status, 'responsavelNome', pe.nome,
        'valorCentavos', cs.valor_centavos, 'diaVencimento', cs.dia_vencimento,
        'parcelas', cs.parcelas, 'inicio', cs.inicio, 'entregaEm', cs.entrega_em)
        order by s.ordem)
      from public.cliente_servicos cs
      join public.servicos s on s.id = cs.servico_id
      left join public.perfis pe on pe.user_id = cs.responsavel_id
     where cs.cliente_id = p_cliente), '[]'::jsonb),

    'contatos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nome', cu.nome, 'email', cu.email, 'papel', cu.papel_cliente, 'ativo', cu.ativo)
        order by cu.papel_cliente)
      from public.clientes_usuarios cu where cu.cliente_id = p_cliente), '[]'::jsonb),

    'pendencias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'tipo', i.tipo, 'titulo', i.titulo, 'quando', i.respondido_em)
        order by i.respondido_em desc)
      from public.itens_aprovacao i
     where i.cliente_id = p_cliente and i.estado = 'com_ajustes'), '[]'::jsonb),

    'movimentos', coalesce((
      select jsonb_agg(x order by x->>'quando' desc)
      from (
        select jsonb_build_object(
          'quando', i.respondido_em,
          'oQue', coalesce(i.respondido_por, 'O cliente') || ' ' ||
                  case i.estado when 'aprovado' then 'aprovou'
                                when 'com_ajustes' then 'pediu ajuste em'
                                else 'declinou' end || ' “' || i.titulo || '”') as x
          from public.itens_aprovacao i
         where i.cliente_id = p_cliente and i.respondido_em is not null
         order by i.respondido_em desc limit 8
      ) z), '[]'::jsonb),

    'mensalCentavos', coalesce((
      select sum(cs.valor_centavos) from public.cliente_servicos cs
       where cs.cliente_id = p_cliente and cs.status = 'ativo' and cs.formato = 'recorrente'), 0),
    'unicoCentavos', coalesce((
      select sum(cs.valor_centavos) from public.cliente_servicos cs
       where cs.cliente_id = p_cliente and cs.status = 'ativo' and cs.formato <> 'recorrente'), 0)
  ) end;
$$;

revoke all on function public.lista_clientes()      from public, anon;
revoke all on function public.fila_aprovacoes()     from public, anon;
revoke all on function public.ficha_cliente(uuid)   from public, anon;
grant execute on function public.lista_clientes()    to authenticated;
grant execute on function public.fila_aprovacoes()   to authenticated;
grant execute on function public.ficha_cliente(uuid) to authenticated;
