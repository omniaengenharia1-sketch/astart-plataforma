-- 0075 — a ficha devolve o que a edicao do contrato precisa.
--
-- A dona pediu, faz dias: "preciso tbm ficar liberada para alterar o valor e
-- informacoes de clientes cadastrados". Eu construi a `alterar_servico_do_cliente`,
-- escrevi teste, e NAO FIZ A TELA. A funcao ficou semanas sem caminho — foi
-- por isso que o valor da Publika teve de ser corrigido por SQL, por mim, em
-- vez de por ela em dez segundos.
--
-- Isto e a primeira metade do conserto: o formulario de editar precisa abrir
-- PREENCHIDO com o que esta valendo, e a ficha nao devolvia tres campos.
--
--   dataEvento       formulario abriria vazio e salvaria por cima
--   observacao       idem
--   responsaveisIds  as caixas de marcar nao teriam como vir marcadas.
--                    Os nomes nao servem: duas pessoas podem se chamar igual,
--                    e e o id que a `alterar_servico_do_cliente` recebe.
--
-- Vai junto o `fim`, que a tela mostra num servico encerrado.
--
-- CORPO EXTRAIDO do arquivo da 0070 e alterado por troca pontual, nao
-- reescrito de memoria — a licao da 0070. O script que gerou isto falha alto
-- se o alvo nao aparecer exatamente uma vez.
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
        'formato', cs.formato, 'status', cs.status,
        -- Lista, nao nome: um servico pode ser cuidado por mais de uma
        -- pessoa desde a 0070.
        'responsaveis', public.responsaveis_do_servico(cs.id),
        'valorCentavos', v.valor_centavos, 'diaVencimento', v.dia_vencimento,
        'parcelas', v.parcelas, 'inicio', cs.inicio, 'entregaEm', cs.entrega_em,
        -- A PARTIR DA 0075, o que a EDICAO precisa para abrir preenchida.
        --
        -- Faltavam tres, e a falta so apareceu quando a tela de editar
        -- nasceu: sem `dataEvento` e `observacao` o formulario abriria
        -- vazio e salvaria por cima; sem os IDS de quem cuida, as caixas de
        -- marcar nao teriam como vir marcadas — os nomes nao servem, porque
        -- duas pessoas podem se chamar igual.
        'dataEvento', cs.data_evento, 'observacao', cs.observacao,
        'responsaveisIds', coalesce((
          select jsonb_agg(csr.perfil_id)
            from public.cliente_servico_responsaveis csr
           where csr.cliente_servico_id = cs.id), '[]'::jsonb),
        'fim', cs.fim)
        order by s.ordem)
      from public.cliente_servicos cs
      join public.servicos s on s.id = cs.servico_id
      -- Sem permissao a funcao devolve zero linhas e o valor fica nulo; o
      -- servico, o responsavel e o prazo continuam na tela.
      left join public.contrato_valores(p_cliente) v on v.cliente_servico_id = cs.id
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

    'mensalCentavos', (select mensal_centavos from public.contrato_totais(p_cliente)),
    'unicoCentavos', (select unico_centavos from public.contrato_totais(p_cliente))
  ) end;
$$;
