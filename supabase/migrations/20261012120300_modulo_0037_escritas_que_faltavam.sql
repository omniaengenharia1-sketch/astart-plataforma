-- =============================================================================
-- Modulo — 0037: as escritas das telas novas
--
-- Responder NPS, mexer no funil e abrir chamado. Tres acoes pequenas, cada uma
-- com a mesma pergunta: quem pode fazer isso?
-- =============================================================================

-- ---------------------------------------------------------------------------
-- responder_nps — a segunda (e ultima) escrita do cliente na plataforma
--
-- A primeira e responder item. Esta aceita uma resposta por pesquisa: NPS que
-- aceita duas notas da mesma pessoa nao e NPS, e enquete.
-- ---------------------------------------------------------------------------
create or replace function public.responder_nps(
  p_pesquisa   uuid,
  p_nota       smallint,
  p_comentario text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente uuid;
  v_quem    text;
begin
  if p_nota is null or p_nota < 0 or p_nota > 10 then
    raise exception 'A nota vai de 0 a 10.';
  end if;

  select cliente_id into v_cliente from public.nps_pesquisas where id = p_pesquisa;
  if v_cliente is null then
    raise exception 'Pesquisa nao encontrada.';
  end if;
  if not public.usuario_ve_cliente(v_cliente) then
    raise exception 'Sem permissao para responder esta pesquisa.';
  end if;
  if exists (select 1 from public.nps_respostas where pesquisa_id = p_pesquisa) then
    raise exception 'Esta pesquisa ja foi respondida.';
  end if;

  select coalesce(cu.nome, 'cliente') into v_quem
    from public.clientes_usuarios cu
   where cu.user_id = auth.uid() and cu.cliente_id = v_cliente;

  insert into public.nps_respostas (pesquisa_id, nota, comentario, autor_nome)
  values (p_pesquisa, p_nota, nullif(btrim(coalesce(p_comentario, '')), ''),
          coalesce(v_quem, 'cliente'));
end;
$$;

-- ---------------------------------------------------------------------------
-- nps_pendente_do_cliente — o que o portal pergunta
-- ---------------------------------------------------------------------------
create or replace function public.nps_do_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ve_cliente(p_cliente) then null::jsonb else jsonb_build_object(
    'pendente', (
      select jsonb_build_object('id', p.id, 'competencia', p.competencia)
        from public.nps_pesquisas p
       where p.cliente_id = p_cliente and p.enviada_em is not null
         and not exists (select 1 from public.nps_respostas n where n.pesquisa_id = p.id)
       order by p.competencia desc limit 1),
    'respondidas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'competencia', p.competencia, 'nota', n.nota, 'comentario', n.comentario,
        'quando', n.criado_em) order by p.competencia desc)
      from public.nps_pesquisas p
      join public.nps_respostas n on n.pesquisa_id = p.id
     where p.cliente_id = p_cliente), '[]'::jsonb)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- mover_lead — o funil arrastado na tela
-- ---------------------------------------------------------------------------
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
  -- As travas de 'perdido exige motivo' e 'so fechado converte' moram em
  -- CHECK na tabela (0025). Aqui so traduzo para portugues antes de bater.
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
-- abrir_chamado — o cliente pedindo socorro no site dele
-- ---------------------------------------------------------------------------
create or replace function public.abrir_chamado(
  p_cliente    uuid,
  p_titulo     text,
  p_descricao  text default null,
  p_prioridade public.prioridade_chamado default 'media'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id   uuid;
  v_quem text;
  v_tipo public.autor_tipo;
begin
  if length(btrim(coalesce(p_titulo, ''))) = 0 then
    raise exception 'Diga em uma linha o que esta acontecendo.';
  end if;
  if not public.usuario_ve_cliente(p_cliente) then
    raise exception 'Sem permissao neste cliente.';
  end if;
  -- SECURITY DEFINER pula a politica, e a politica era quem exigia o modulo.
  -- Sem esta linha, um cliente sem manutencao contratada abriria chamado —
  -- a funcao daria de presente o que o RLS recusava.
  if not public.cliente_tem_modulo(p_cliente, 'manutencao') then
    raise exception 'Este cliente nao tem manutencao no contrato.';
  end if;

  select cu.nome into v_quem from public.clientes_usuarios cu
   where cu.user_id = auth.uid() and cu.cliente_id = p_cliente;
  if v_quem is null then
    select pe.nome into v_quem from public.perfis pe where pe.user_id = auth.uid();
    v_tipo := 'equipe';
  else
    v_tipo := 'cliente';
  end if;

  insert into public.chamados (cliente_id, titulo, descricao, prioridade,
                               aberto_por_tipo, aberto_por_nome)
  values (p_cliente, btrim(p_titulo), nullif(btrim(coalesce(p_descricao, '')), ''),
          p_prioridade, v_tipo, coalesce(v_quem, 'cliente'))
  returning id into v_id;

  return v_id;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'responder_nps(uuid,smallint,text)', 'nps_do_cliente(uuid)',
    'mover_lead(uuid,public.etapa_lead,text)',
    'abrir_chamado(uuid,text,text,public.prioridade_chamado)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
