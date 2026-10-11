-- =============================================================================
-- Modulo — 0033: a ficha devolve o user_id de cada contato
--
-- A tela "Quem responde" precisa poder tirar o acesso de um contato, e
-- tirar_acesso_do_cliente() pede o user_id. Sem ele a tela so sabia o e-mail.
--
-- Migration separada, e nao edicao da 0027, porque migration ja empurrada nao
-- se reescreve: quem aplicou a 0027 nao aplicaria a mudanca de novo.
-- =============================================================================

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
        'userId', cu.user_id,
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
