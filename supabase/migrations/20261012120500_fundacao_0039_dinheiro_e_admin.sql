-- =============================================================================
-- Fundacao — 0039: o dinheiro e so de quem cuida dele, e o admin manda
--
-- Duas coisas estavam erradas, e a primeira era pior do que parecia.
--
-- 1. O RLS de `lancamentos`, `cobrancas` e `lancamento_rateios` ja era de
--    admin e financeiro. Mas `painel_financeiro()` abria para qualquer pessoa
--    ativa — o RLS filtrava as LINHAS em silencio e a tela mostrava R$ 0,00 em
--    tudo. Operacao abria o Financeiro e lia "a agencia nao faturou nada".
--    Zero que mente e pior que porta fechada: agora a funcao devolve null, e a
--    aba deixa de existir.
--
-- 2. O valor do contrato vazava por fora do Financeiro. `cliente_servicos` era
--    legivel por toda a equipe (politica da 0015), e a lista de Clientes
--    mostrava "por mes" de cada um. Esconder isso apenas na funcao seria
--    teatro: a coluna continuaria aberta na API REST para qualquer login.
--
--    Aqui RLS nao resolve: a operacao PRECISA da linha (nome do servico,
--    responsavel, prazo de entrega) e nao pode ver tres colunas dela. RLS e por
--    LINHA, nao por coluna — a armadilha numero quatro deste projeto. Entao o
--    corte e no privilegio de coluna, e o dinheiro passa a sair de funcao
--    SECURITY DEFINER que confere o papel.
--
--    Isso tira o acesso direto do admin tambem, de proposito: ele le pela
--    funcao, como todo mundo. Foi exatamente o motivo de a 0032 NAO usar
--    privilegio de coluna para `perfis.papel` — la nao havia funcao no caminho,
--    aqui ha.
--
-- 3. O comercial fecha junto. O funil carrega o valor estimado de cada
--    proposta; e a mesma informacao. Aqui RLS resolve, porque a linha inteira
--    e sigilosa: ninguem de fora do dinheiro precisa do lead.
--
-- 4. E o admin ganha o que lhe faltava: mudar o papel de alguem depois do
--    convite, e tirar um cliente do ar.
--
-- O portao e `usuario_financeiro()`, que ja existia: papel admin OU financeiro.
-- Hoje so o dono e admin; no dia que entrar um contador, e um papel, nao uma
-- migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Quem pode ver o valor de um contrato
--
-- A equipe do dinheiro ve o de todos. O cliente ve o proprio — e o dele ele
-- ja ve na cobranca, esconder no contrato nao esconderia nada.
-- ---------------------------------------------------------------------------
create or replace function public.ve_valor_do_contrato(p_cliente uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.usuario_financeiro()
      or (public.usuario_cliente() and public.usuario_ve_cliente(p_cliente));
$$;

-- O valor de cada servico do contrato. Devolve nada para quem nao pode ver —
-- e o `left join lateral` de quem chama vira nulo, nao zero.
create or replace function public.contrato_valores(p_cliente uuid)
returns table (
  cliente_servico_id uuid,
  valor_centavos     bigint,
  dia_vencimento     smallint,
  parcelas           smallint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cs.id, cs.valor_centavos, cs.dia_vencimento, cs.parcelas
    from public.cliente_servicos cs
   where cs.cliente_id = p_cliente
     and public.ve_valor_do_contrato(p_cliente);
$$;

-- Os dois totais do cliente. Sempre uma linha: nulo quando nao pode ver, para
-- a tela esconder o cartao em vez de mostrar R$ 0,00.
create or replace function public.contrato_totais(p_cliente uuid)
returns table (mensal_centavos bigint, unico_centavos bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    case when public.ve_valor_do_contrato(p_cliente) then coalesce(sum(cs.valor_centavos)
      filter (where cs.status = 'ativo' and cs.formato = 'recorrente'), 0) end,
    case when public.ve_valor_do_contrato(p_cliente) then coalesce(sum(cs.valor_centavos)
      filter (where cs.status = 'ativo' and cs.formato <> 'recorrente'), 0) end
    from public.cliente_servicos cs
   where cs.cliente_id = p_cliente;
$$;

revoke all on function public.ve_valor_do_contrato(uuid) from public, anon;
revoke all on function public.contrato_valores(uuid)     from public, anon;
revoke all on function public.contrato_totais(uuid)      from public, anon;
grant execute on function public.ve_valor_do_contrato(uuid) to authenticated, service_role;
grant execute on function public.contrato_valores(uuid)     to authenticated, service_role;
grant execute on function public.contrato_totais(uuid)      to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- O corte na coluna
--
-- `select *` em cliente_servicos passa a falhar para `authenticated`, e isso e
-- intencional: quem precisa do dinheiro usa as funcoes acima. As escritas
-- continuam como a 0015 deixou (usuario_edita), inclusive das colunas de
-- dinheiro — quem cadastra o cliente digita o valor; quem nao pode e ler de
-- volta por fora.
-- ---------------------------------------------------------------------------
revoke select on public.cliente_servicos from authenticated;
grant select (
  id, cliente_id, servico_id, formato, status, responsavel_id,
  inicio, fim, entrega_em, data_evento, observacao, criado_em, atualizado_em
) on public.cliente_servicos to authenticated;

-- ---------------------------------------------------------------------------
-- lista_clientes — sem as duas colunas de dinheiro para quem nao pode
-- ---------------------------------------------------------------------------
create or replace function public.lista_clientes()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
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
      -- Nulo, nao zero: a coluna desaparece da tabela em vez de mostrar
      -- "R$ 0,00" ao lado de um cliente que paga 2.800 por mes.
      'mensalCentavos', t.mensal_centavos,
      'unicoCentavos', t.unico_centavos
    ) as x
      from public.clientes c
      left join lateral public.contrato_totais(c.id) t on true
     where c.ativo
  ) y;
$$;

-- ---------------------------------------------------------------------------
-- ficha_cliente — idem, e o valor de cada servico vem da funcao
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
        'valorCentavos', v.valor_centavos, 'diaVencimento', v.dia_vencimento,
        'parcelas', v.parcelas, 'inicio', cs.inicio, 'entregaEm', cs.entrega_em)
        order by s.ordem)
      from public.cliente_servicos cs
      join public.servicos s on s.id = cs.servico_id
      left join public.perfis pe on pe.user_id = cs.responsavel_id
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

-- ---------------------------------------------------------------------------
-- painel_equipe — o cartao "vencido" sai do Inicio de quem nao ve dinheiro
--
-- O corpo e o da 0026 inteiro porque `create or replace` nao aceita remendo.
-- Muda uma expressao: a soma do vencido.
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

    -- Nulo para quem nao cuida do dinheiro. O RLS ja escondia as linhas, mas
    -- a soma vinha 0 — e "R$ 0,00 vencido" no Inicio da operacao nao e
    -- discricao, e informacao errada. Nulo a tela esconde o cartao.
    'vencidoCentavos', case when public.usuario_financeiro() then coalesce((
      select sum(l.valor_centavos) from public.lancamentos l
       where l.status = 'previsto' and l.vencimento is not null and l.vencimento < current_date
         and public.subcategoria_natureza(l.subcategoria_id) = 'receita'), 0) end
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- As leituras do dinheiro: null, nao zero
--
-- `painel_financeiro` trocou `usuario_ativo()` por `usuario_financeiro()`.
-- `financeiro_do_cliente` serve os dois lados, entao abre para a equipe do
-- dinheiro OU para o proprio cliente — e nao mais para a equipe toda.
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
  select case when not public.usuario_financeiro() then null::jsonb else jsonb_build_object(
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

create or replace function public.financeiro_do_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not (
      public.usuario_financeiro()
      or (public.usuario_cliente() and public.usuario_ve_cliente(p_cliente))
    ) then null::jsonb else jsonb_build_object(
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
-- O comercial fecha junto
--
-- Aqui o corte e por LINHA, e por isso o RLS resolve: ninguem fora do dinheiro
-- precisa do lead. Nao e caso de privilegio de coluna.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['leads','lead_servicos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_equipe_le', t);
    execute format('drop policy if exists %I on public.%I', t || '_escreve', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.usuario_financeiro()) with check (public.usuario_financeiro())',
      t || '_financeiro', t);
  end loop;
end $$;

create or replace function public.funil()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_financeiro() then null::jsonb else jsonb_build_object(
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

-- `mover_lead` e SECURITY INVOKER: o `update` nao acha a linha e a propria
-- funcao ja respondia "Lead nao encontrado". Mas mensagem errada custa uma
-- ligacao, entao ela diz o que e.
create or replace function public.mover_lead(
  p_lead  uuid,
  p_etapa public.etapa_lead,
  p_motivo text default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_financeiro() then
    raise exception 'O comercial e de quem cuida do dinheiro.';
  end if;
  if p_etapa = 'perdido' and length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Lead perdido precisa de motivo.';
  end if;

  update public.leads
     set etapa = p_etapa,
         motivo_desqualificacao = case when p_etapa in ('perdido', 'descartado')
           then nullif(btrim(coalesce(p_motivo, '')), '') else motivo_desqualificacao end,
         ultima_interacao_em = now()
   where id = p_lead;

  if not found then
    raise exception 'Lead nao encontrado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- O que faltava ao admin
-- ---------------------------------------------------------------------------

-- Mudar o papel de alguem depois do convite. A 0032 impede que a pessoa mude o
-- proprio; isto da a quem administra a porta que ela precisa.
--
-- A trava que importa: nao deixar a plataforma sem nenhum admin. Rebaixar o
-- ultimo admin tranca a conta inteira, e ninguem de dentro conseguiria abrir.
create or replace function public.mudar_papel(p_user_id uuid, p_papel public.papel_perfil)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_antes public.papel_perfil;
begin
  if not public.usuario_admin() then
    raise exception 'So quem administra a plataforma muda papel.';
  end if;

  -- 'social' e lixo da fase do agendador: o enum ainda tem o valor, a
  -- plataforma nao usa. Deixar entrar criaria gente com papel que nenhuma
  -- funcao reconhece — nem equipe, nem leitura, nem nada.
  if p_papel not in ('admin', 'operacao', 'financeiro', 'leitura') then
    raise exception 'Papel invalido: %', p_papel;
  end if;

  select papel into v_antes from public.perfis where user_id = p_user_id;
  if v_antes is null then
    raise exception 'Essa pessoa nao esta na equipe.';
  end if;
  if v_antes = p_papel then
    return;  -- idempotente: pedir o mesmo papel duas vezes nao e erro
  end if;

  if v_antes = 'admin' and p_papel <> 'admin'
     and (select count(*) from public.perfis where papel = 'admin' and ativo) <= 1 then
    raise exception 'Precisa de outra pessoa administrando antes de sair.';
  end if;

  update public.perfis set papel = p_papel where user_id = p_user_id;
end;
$$;

-- Tirar um cliente do ar. Nao apaga nada: pausa os servicos e some das listas.
-- E o que "remover cliente" quer dizer em 99% dos casos — e o unico que nao
-- destroi oito meses de historico.
create or replace function public.desativar_cliente(p_cliente uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_admin() then
    raise exception 'So quem administra a plataforma tira um cliente do ar.';
  end if;
  update public.clientes set ativo = false where id = p_cliente;
  if not found then raise exception 'Cliente nao encontrado.'; end if;

  update public.cliente_servicos set status = 'encerrado'
   where cliente_id = p_cliente and status = 'ativo';
  -- O acesso dele cai junto: contrato encerrado e portal aberto e a pior
  -- combinacao — ele continua vendo tudo e ninguem esta cuidando.
  update public.clientes_usuarios set ativo = false
   where cliente_id = p_cliente and ativo;
end;
$$;

create or replace function public.reativar_cliente(p_cliente uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_admin() then
    raise exception 'So quem administra a plataforma reativa um cliente.';
  end if;
  update public.clientes set ativo = true where id = p_cliente;
  if not found then raise exception 'Cliente nao encontrado.'; end if;
  -- Os servicos e os acessos NAO voltam sozinhos: qual servico volta, e por
  -- quanto, e decisao de contrato. Voltar tudo no automatico reabriria um
  -- contrato encerrado sem ninguem ter dito o preco.
end;
$$;

-- Apagar de verdade. Existe para o cliente cadastrado errado, e so para ele:
-- com qualquer historico, recusa e manda desativar.
create or replace function public.remover_cliente(p_cliente uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_quanto integer;
begin
  if not public.usuario_admin() then
    raise exception 'So quem administra a plataforma remove um cliente.';
  end if;

  select
    (select count(*) from public.itens_aprovacao where cliente_id = p_cliente)
  + (select count(*) from public.posts where cliente_id = p_cliente)
  + (select count(*) from public.lancamentos where cliente_id = p_cliente)
  + (select count(*) from public.sessoes_captacao where cliente_id = p_cliente)
    into v_quanto;

  if v_quanto > 0 then
    raise exception 'Este cliente ja tem % registros. Tire do ar em vez de apagar.', v_quanto;
  end if;

  delete from public.clientes where id = p_cliente;
  if not found then raise exception 'Cliente nao encontrado.'; end if;
end;
$$;

revoke all on function public.mudar_papel(uuid, public.papel_perfil) from public, anon;
revoke all on function public.desativar_cliente(uuid)                from public, anon;
revoke all on function public.reativar_cliente(uuid)                 from public, anon;
revoke all on function public.remover_cliente(uuid)                  from public, anon;
grant execute on function public.mudar_papel(uuid, public.papel_perfil) to authenticated;
grant execute on function public.desativar_cliente(uuid)                to authenticated;
grant execute on function public.reativar_cliente(uuid)                 to authenticated;
grant execute on function public.remover_cliente(uuid)                  to authenticated;

-- ---------------------------------------------------------------------------
-- E apagar cliente deixa de ser coisa de operacao
--
-- A politica da 0006 era `for all` com `usuario_edita()`, e `all` inclui
-- delete: qualquer pessoa de operacao podia apagar um cliente, e o cascade
-- levaria posts, cobrancas, galerias e aprovacoes com ele. Agora delete e so
-- de admin — e mesmo ele passa por `remover_cliente()`, que confere o
-- historico antes.
-- ---------------------------------------------------------------------------
drop policy if exists clientes_escreve on public.clientes;
create policy clientes_insere on public.clientes
  for insert to authenticated with check (public.usuario_edita());
create policy clientes_atualiza on public.clientes
  for update to authenticated using (public.usuario_edita()) with check (public.usuario_edita());
create policy clientes_apaga on public.clientes
  for delete to authenticated using (public.usuario_admin());
