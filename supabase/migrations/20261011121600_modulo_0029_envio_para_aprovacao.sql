-- =============================================================================
-- Modulo — 0029: enviar para aprovacao
--
-- Ate aqui o cliente respondia, mas nada na plataforma colocava item na mao
-- dele: a fila so tinha o que uma migration inseriu. Esta migration fecha o
-- lado da producao.
--
-- Um envio e por cliente e vira UM lote: o cliente recebe os itens juntos, e o
-- lote fecha sozinho quando o ultimo for respondido (regra que ja estava na
-- responder_item, da 0017).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- item_do_entregavel — o item de aprovacao nasce quando o trabalho comeca
--
-- Entregavel sem item e "a fazer". Esta funcao cria o item em 'produzindo' e
-- amarra os dois. Chamar de novo devolve o mesmo item: nada duplica.
-- ---------------------------------------------------------------------------
create or replace function public.item_do_entregavel(p_entregavel_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e  public.entregaveis;
  v_cl uuid;
  v_id uuid;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para mexer neste entregavel.';
  end if;

  select * into v_e from public.entregaveis where id = p_entregavel_id for update;
  if v_e.id is null then
    raise exception 'Entregavel nao encontrado.';
  end if;
  if v_e.item_id is not null then
    return v_e.item_id;
  end if;

  select cs.cliente_id into v_cl
    from public.cliente_servicos cs where cs.id = v_e.cliente_servico_id;

  insert into public.itens_aprovacao (cliente_id, tipo, estado, titulo)
  values (v_cl, 'entregavel', 'produzindo', v_e.titulo)
  returning id into v_id;

  update public.entregaveis set item_id = v_id, atualizado_em = now()
   where id = p_entregavel_id;

  return v_id;
end;
$$;

revoke all on function public.item_do_entregavel(uuid) from public, anon;
grant execute on function public.item_do_entregavel(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- enviar_para_aprovacao — o lote
--
-- Recusa item ja em aprovacao em vez de reenviar em silencio: reenviar apaga a
-- espera do cliente e faz o mesmo material aparecer duas vezes na fila dele.
-- ---------------------------------------------------------------------------
create or replace function public.enviar_para_aprovacao(
  p_item_ids uuid[],
  p_mensagem text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente uuid;
  v_envio   uuid;
  v_item    public.itens_aprovacao;
  v_n       integer := 0;
begin
  if not public.usuario_edita() then
    raise exception 'Seu acesso nao envia material para o cliente.';
  end if;
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    raise exception 'Escolha o que enviar.';
  end if;

  -- Um lote e de um cliente so: dois clientes no mesmo envio virariam um link
  -- que mostra material de um para o outro.
  select distinct i.cliente_id into v_cliente
    from public.itens_aprovacao i where i.id = any(p_item_ids);
  if v_cliente is null then
    raise exception 'Item nao encontrado.';
  end if;
  if (select count(distinct i.cliente_id) from public.itens_aprovacao i
       where i.id = any(p_item_ids)) > 1 then
    raise exception 'Um envio e de um cliente so. Separe em dois.';
  end if;
  if (select count(*) from public.itens_aprovacao i where i.id = any(p_item_ids))
     <> cardinality(p_item_ids) then
    raise exception 'Item nao encontrado.';
  end if;

  insert into public.envios_aprovacao (cliente_id, criado_por, mensagem)
  values (v_cliente, auth.uid(), nullif(btrim(coalesce(p_mensagem, '')), ''))
  returning id into v_envio;

  for v_item in
    select * from public.itens_aprovacao where id = any(p_item_ids) order by criado_em for update
  loop
    if v_item.estado = 'em_aprovacao' then
      raise exception '"%" ja esta esperando o cliente desde %.',
        v_item.titulo, to_char(v_item.enviado_em, 'DD/MM HH24:MI');
    end if;
    if v_item.estado = 'aprovado' then
      raise exception '"%" ja foi aprovado. Para mandar de novo, crie uma nova versao.',
        v_item.titulo;
    end if;

    update public.itens_aprovacao
       set estado = 'em_aprovacao',
           enviado_em = now(),
           -- A resposta anterior fica no historico de comentarios; o item volta
           -- a esperar, e nao pode parecer respondido.
           respondido_em = null,
           respondido_por = null,
           atualizado_em = now()
     where id = v_item.id;

    insert into public.envio_itens (envio_id, item_id) values (v_envio, v_item.id)
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('envioId', v_envio, 'enviados', v_n, 'clienteId', v_cliente);
end;
$$;

revoke all on function public.enviar_para_aprovacao(uuid[], text) from public, anon;
grant execute on function public.enviar_para_aprovacao(uuid[], text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- projeto_do_cliente — a aba Entregaveis da ficha, e o "Meu projeto" do portal
-- ---------------------------------------------------------------------------
create or replace function public.projeto_do_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ve_cliente(p_cliente) then null::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'clienteServicoId', cs.id,
        'servico', s.chave,
        'servicoNome', s.nome,
        'entregaEm', cs.entrega_em,
        'entregaveis', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id,
            'itemId', e.item_id,
            'fase', e.fase,
            'titulo', e.titulo,
            'ordem', e.ordem,
            'estado', e.estado,
            'prazo', e.prazo,
            'versaoAtual', e.versao_atual,
            'enviadoEm', e.enviado_em,
            'respondidoEm', e.respondido_em,
            'responsavelNome', (select p.nome from public.perfis p
                                 where p.user_id = e.responsavel_id))
            order by e.ordem)
          from public.entregaveis_com_estado e
         where e.cliente_servico_id = cs.id), '[]'::jsonb),
        'marcos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', m.id, 'titulo', m.titulo, 'prazo', m.prazo,
            'concluidoEm', m.concluido_em) order by m.prazo)
          from public.marcos m where m.cliente_servico_id = cs.id), '[]'::jsonb))
        order by s.ordem)
      from public.cliente_servicos cs
      join public.servicos s on s.id = cs.servico_id
     where cs.cliente_id = p_cliente
       and cs.status = 'ativo'
       and public.cliente_tem_modulo(p_cliente, 'entregaveis')
       and exists (select 1 from public.entregaveis e where e.cliente_servico_id = cs.id)
    ), '[]'::jsonb)
  end;
$$;

revoke all on function public.projeto_do_cliente(uuid) from public, anon;
grant execute on function public.projeto_do_cliente(uuid) to authenticated;
