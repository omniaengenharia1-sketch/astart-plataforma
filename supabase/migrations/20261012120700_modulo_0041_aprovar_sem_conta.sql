-- =============================================================================
-- Modulo — 0041: aprovar sem ter conta
--
-- O README promete isso na primeira linha desde o comeco, a 0005 criou a tabela
-- do link, a 0017 criou o lote e deixou `responder_item` aceitar `auth.uid()`
-- nulo de proposito — "o caminho do link sem conta: ali quem valida o token e a
-- funcao, antes de chegar aqui". Faltava exatamente essa funcao.
--
-- Sem ela, na pratica o cliente PRECISAVA de conta para aprovar, e isso muda o
-- dia da agencia: com o link, manda no WhatsApp e a pessoa responde em dez
-- segundos; sem ele, alguem tem de criar senha numa sexta a noite.
--
-- Mesma arquitetura da galeria (0034), e pelos mesmos motivos:
--   - guardamos o HASH do token, nunca o token: vazou o banco, nao vazou o acesso;
--   - quem le e service_role, ou seja a Edge Function — o visitante nunca fala
--     com o banco;
--   - o link NAO vence por relogio. Ele vira leitura quando o lote fecha (todos
--     os itens respondidos) e morre quando alguem revoga. Validade por data
--     vence sempre na hora errada: no meio de uma aprovacao.
-- =============================================================================

-- O time precisa saber se o cliente ABRIU. "Mandei e ele nao respondeu" e
-- diferente de "mandei e ele nem abriu" — a primeira e cobranca, a segunda e
-- conferir se o link chegou.
alter table public.links_aprovacao
  add column if not exists ultimo_acesso_em timestamptz,
  add column if not exists acessos integer not null default 0 check (acessos >= 0);

-- ---------------------------------------------------------------------------
-- envio_por_token — o que a pagina do link mostra
--
-- Devolve `null` para token errado, revogado ou curto demais: a pagina diz "este
-- link nao vale mais" sem revelar se o lote existe. Token errado que respondesse
-- "lote nao encontrado" contaria que outros existem.
-- ---------------------------------------------------------------------------
create or replace function public.envio_por_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_link_id   uuid;
  v_envio_id  uuid;
  v_cliente   uuid;
begin
  -- O token tem 64 hex. Qualquer coisa menor nao chega a consultar a tabela.
  if length(coalesce(p_token, '')) < 32 then
    return null;
  end if;

  select l.id, l.envio_id, l.cliente_id
    into v_link_id, v_envio_id, v_cliente
    from public.links_aprovacao l
   where l.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and not l.revogado;

  if v_link_id is null then
    return null;
  end if;

  update public.links_aprovacao
     set acessos = acessos + 1, ultimo_acesso_em = now()
   where id = v_link_id;

  return jsonb_build_object(
    'cliente', (select c.nome from public.clientes c where c.id = v_cliente),
    'mensagem', (select e.mensagem from public.envios_aprovacao e where e.id = v_envio_id),
    'quando', (select e.criado_em from public.envios_aprovacao e where e.id = v_envio_id),
    -- Lote fechado = link virou leitura. A pagina mostra o que foi respondido,
    -- sem botao nenhum.
    'fechado', (select e.fechado_em is not null
                  from public.envios_aprovacao e where e.id = v_envio_id),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'tipo', i.tipo,
        'titulo', i.titulo,
        'estado', i.estado,
        'respondidoPor', i.respondido_por,
        'respondidoEm', i.respondido_em,
        -- O ultimo comentario, para quem abre de novo lembrar o que pediu.
        'comentario', (select c.texto from public.aprovacao_comentarios c
                        where c.item_id = i.id order by c.criado_em desc limit 1))
        order by i.criado_em)
      from public.envio_itens ei
      join public.itens_aprovacao i on i.id = ei.item_id
     where ei.envio_id = v_envio_id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- responder_por_token — a resposta de quem nao tem conta
--
-- Confere que o item e DESTE lote antes de passar adiante. Sem isso, um token
-- valido viraria chave para responder qualquer item do cliente, e um link que
-- vazou viraria acesso permanente.
-- ---------------------------------------------------------------------------
create or replace function public.responder_por_token(
  p_token      text,
  p_item       uuid,
  p_decisao    public.estado_aprovacao,
  p_nome       text,
  p_comentario text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_envio_id uuid;
begin
  if length(coalesce(p_token, '')) < 32 then
    raise exception 'Este link não vale mais.';
  end if;

  select l.envio_id into v_envio_id
    from public.links_aprovacao l
   where l.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and not l.revogado;

  if v_envio_id is null then
    raise exception 'Este link não vale mais.';
  end if;

  if not exists (
    select 1 from public.envio_itens ei
     where ei.envio_id = v_envio_id and ei.item_id = p_item
  ) then
    raise exception 'Este item não é deste link.';
  end if;

  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'Diga o seu nome para a equipe saber quem respondeu.';
  end if;

  -- Daqui pra frente e a mesma porta que o portal usa: comentario obrigatorio
  -- no ajuste, item que nao esta em aprovacao recusado, lote que fecha sozinho
  -- quando o ultimo item e respondido. `auth.uid()` e nulo (service_role), e a
  -- 0017 abre excecao para esse caso porque quem validou o token fui eu, acima.
  perform public.responder_item(p_item, p_decisao, btrim(p_nome), 'cliente', p_comentario);
end;
$$;

-- ---------------------------------------------------------------------------
-- revogar_link_aprovacao — a unica porta de saida, ja que nada vence
-- ---------------------------------------------------------------------------
create or replace function public.revogar_link_aprovacao(p_link uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.links_aprovacao set revogado = true where id = p_link;
  if not found then
    raise exception 'Link nao encontrado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- envios_do_cliente — os lotes e os links, para a equipe
--
-- Sem esta leitura ninguem veria um link para revogar, e "revogar e a unica
-- porta de saida" seria promessa sem porta.
-- ---------------------------------------------------------------------------
create or replace function public.envios_do_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ve_cliente(p_cliente) then null::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'mensagem', e.mensagem,
        'quando', e.criado_em,
        'fechadoEm', e.fechado_em,
        'itens', (select count(*) from public.envio_itens ei where ei.envio_id = e.id),
        'respondidos', (
          select count(*) from public.envio_itens ei
            join public.itens_aprovacao i on i.id = ei.item_id
           where ei.envio_id = e.id and i.estado <> 'em_aprovacao'),
        'links', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id,
            'criadoEm', l.criado_em,
            'acessos', l.acessos,
            'ultimoAcessoEm', l.ultimo_acesso_em)
            order by l.criado_em desc)
          from public.links_aprovacao l
         where l.envio_id = e.id and not l.revogado), '[]'::jsonb))
        order by e.criado_em desc)
      from public.envios_aprovacao e
     where e.cliente_id = p_cliente), '[]'::jsonb)
  end;
$$;

-- As duas do token sao de service_role: quem fala com elas e a Edge Function,
-- nunca o navegador de quem recebeu o link.
revoke all on function public.envio_por_token(text) from public, anon, authenticated;
revoke all on function public.responder_por_token(
  text, uuid, public.estado_aprovacao, text, text) from public, anon, authenticated;
grant execute on function public.envio_por_token(text) to service_role;
grant execute on function public.responder_por_token(
  text, uuid, public.estado_aprovacao, text, text) to service_role;

revoke all on function public.revogar_link_aprovacao(uuid) from public, anon;
revoke all on function public.envios_do_cliente(uuid)      from public, anon;
grant execute on function public.revogar_link_aprovacao(uuid) to authenticated;
grant execute on function public.envios_do_cliente(uuid)      to authenticated;

comment on function public.envio_por_token(text) is
  'O lote de um link sem conta. Null para token errado ou revogado. So service_role.';
