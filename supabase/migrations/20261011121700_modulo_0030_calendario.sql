-- =============================================================================
-- Modulo — 0030: o calendario de conteudo
--
-- O mes da Gestao Digital: as pecas, onde elas caem, em que pe esta cada uma
-- e quanto falta para fechar a cota do contrato.
--
-- As datas saem daqui JA no fuso do cliente. O banco guarda timestamptz, e e
-- ele quem sabe o fuso de cada cliente — deixar o navegador converter faria a
-- peca das 23h aparecer no dia seguinte para quem abrisse de outro fuso.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- calendario_do_cliente — um mes
-- ---------------------------------------------------------------------------
create or replace function public.calendario_do_cliente(
  p_cliente uuid,
  p_mes     date default current_date
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with ctx as (
    select c.id, c.fuso_horario as fuso,
           date_trunc('month', p_mes)::date as inicio,
           (date_trunc('month', p_mes) + interval '1 month')::date as proximo
      from public.clientes c where c.id = p_cliente
  ),
  pecas as (
    select p.*,
           (p.agendado_para at time zone x.fuso)::date as dia_local,
           to_char(p.agendado_para at time zone x.fuso, 'HH24:MI') as hora_local
      from public.posts p, ctx x
     where p.cliente_id = p_cliente
       and p.agendado_para >= (x.inicio::timestamp at time zone x.fuso)
       and p.agendado_para <  (x.proximo::timestamp at time zone x.fuso)
  )
  select case when not public.usuario_ve_cliente(p_cliente) then null::jsonb else jsonb_build_object(

    'mes', (select to_char(inicio, 'YYYY-MM-DD') from ctx),
    'fusoHorario', (select fuso from ctx),

    'pecas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id,
        'itemId', q.item_id,
        'titulo', q.titulo_interno,
        'tipo', q.tipo,
        'legenda', q.legenda,
        'dia', to_char(q.dia_local, 'YYYY-MM-DD'),
        'hora', q.hora_local,
        'statusPublicacao', q.status,
        'estadoAprovacao', coalesce(
          (select i.estado::text from public.itens_aprovacao i where i.id = q.item_id),
          'produzindo'),
        'erro', q.erro_mensagem,
        'contas', coalesce((
          select jsonb_agg(cs.nome_exibicao order by cs.nome_exibicao)
            from public.post_alvos pa
            join public.contas_sociais cs on cs.id = pa.conta_social_id
           where pa.post_id = q.id), '[]'::jsonb))
        order by q.dia_local, q.hora_local)
      from pecas q), '[]'::jsonb),

    -- O plano do contrato: quantas peças o mês deveria ter, e em que dias.
    'plano', (
      select jsonb_build_object(
        'clienteServicoId', pl.cliente_servico_id,
        'diasSemana', to_jsonb(pl.dias_semana),
        'horario', to_char(pl.horario, 'HH24:MI'),
        'postsPorMes', pl.posts_por_mes,
        'reelsPorMes', pl.reels_por_mes,
        'cota', pl.posts_por_mes + pl.reels_por_mes)
        from public.planos_conteudo pl
        join public.cliente_servicos cs on cs.id = pl.cliente_servico_id
       where cs.cliente_id = p_cliente and cs.status = 'ativo'
       limit 1),

    'noMes', (select count(*) from pecas),
    'esperandoCliente', (select count(*) from pecas q
       where coalesce((select i.estado::text from public.itens_aprovacao i where i.id = q.item_id),'') = 'em_aprovacao'),
    'comAjustes', (select count(*) from pecas q
       where coalesce((select i.estado::text from public.itens_aprovacao i where i.id = q.item_id),'') = 'com_ajustes'),
    'publicadas', (select count(*) from pecas q where q.status = 'publicado'),
    'falhas', (select count(*) from pecas q where q.status = 'falhou')
  ) end;
$$;

revoke all on function public.calendario_do_cliente(uuid, date) from public, anon;
grant execute on function public.calendario_do_cliente(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- criar_peca — a peca nasce como rascunho, com data e hora no fuso do cliente
--
-- Recebe dia e hora separados, como a tela pergunta, e monta o timestamptz
-- aqui dentro: montar no navegador usaria o fuso de quem esta digitando, que
-- nao e necessariamente o do cliente.
-- ---------------------------------------------------------------------------
create or replace function public.criar_peca(
  p_cliente  uuid,
  p_titulo   text,
  p_tipo     public.tipo_post,
  p_dia      date,
  p_hora     time default '12:00',
  p_legenda  text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_fuso text;
  v_post public.posts;
begin
  if length(btrim(coalesce(p_titulo, ''))) = 0 then
    raise exception 'A peca precisa de um nome interno — e por ele que a equipe acha ela.';
  end if;
  if p_dia is null then
    raise exception 'Diga que dia a peca sai.';
  end if;

  select c.fuso_horario into v_fuso from public.clientes c where c.id = p_cliente;
  if v_fuso is null then
    raise exception 'Cliente nao encontrado.';
  end if;

  insert into public.posts (cliente_id, titulo_interno, tipo, legenda, agendado_para, criado_por)
  values (p_cliente, btrim(p_titulo), p_tipo, coalesce(p_legenda, ''),
          ((p_dia + coalesce(p_hora, time '12:00'))::timestamp at time zone v_fuso),
          auth.uid())
  returning * into v_post;

  return jsonb_build_object('id', v_post.id, 'itemId', v_post.item_id);
end;
$$;

revoke all on function public.criar_peca(uuid, text, public.tipo_post, date, time, text)
  from public, anon;
grant execute on function public.criar_peca(uuid, text, public.tipo_post, date, time, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- mover_peca / renomear_peca — o que o calendario precisa mexer
--
-- Peca que ja saiu (ou esta saindo) nao se mexe: mudar a data de algo que ja
-- foi publicado so serviria para mentir no historico.
-- ---------------------------------------------------------------------------
create or replace function public.mover_peca(
  p_post uuid,
  p_dia  date,
  p_hora time default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_fuso text;
  v_post public.posts;
  v_hora time;
begin
  select p.* into v_post from public.posts p where p.id = p_post;
  if v_post.id is null then
    raise exception 'Peca nao encontrada.';
  end if;
  if v_post.status in ('publicando', 'publicado') then
    raise exception 'Esta peca ja saiu. Nao da para mudar a data dela.';
  end if;

  select c.fuso_horario into v_fuso from public.clientes c where c.id = v_post.cliente_id;
  v_hora := coalesce(p_hora, (v_post.agendado_para at time zone v_fuso)::time, time '12:00');

  update public.posts
     set agendado_para = ((p_dia + v_hora)::timestamp at time zone v_fuso),
         atualizado_em = now()
   where id = p_post;
end;
$$;

revoke all on function public.mover_peca(uuid, date, time) from public, anon;
grant execute on function public.mover_peca(uuid, date, time) to authenticated;
