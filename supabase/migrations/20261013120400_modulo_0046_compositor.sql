-- 0046 — o compositor: criar a publicação inteira numa tela.
--
-- O que a dona descreveu, e é o fluxo do mLabs: sobe a mídia, escolhe a rede e
-- o formato, escreve a legenda, escreve as hashtags, e embaixo agenda na hora
-- que quiser ou posta agora.
--
-- O calendário já criava peça (`criar_peca`), mas com título, tipo, dia e hora
-- — faltava escolher as contas, separar hashtags, e o botão que diz "vai".
--
-- Três decisões:
--
-- 1. HASHTAGS EM CAMPO PRÓPRIO, não concatenadas na legenda ao salvar. Se eu
--    guardasse tudo junto, reabrir a publicação para editar mostraria as
--    hashtags no meio do texto, e a pessoa teria de separá-las de novo com a
--    mão. Cada campo guarda uma coisa, e quem junta é o worker na hora de
--    publicar.
--
-- 2. A ORDEM É: criar, anexar a mídia, e só então agendar. O caminho do arquivo
--    precisa do id do post (0045), então o post nasce `rascunho` sem hora. E
--    `agendar_publicacao()` RECUSA agendar sem a mídia que o formato pede —
--    é o último ponto onde ainda dá para avisar antes de a peça virar erro de
--    madrugada.
--
-- 3. "POSTAR AGORA" é agendar para agora, não um caminho separado. O worker
--    varre `agendado and agendado_para <= now()` a cada minuto; pedir "agora"
--    é pôr `now()` ali. Um caminho paralelo que publicasse na hora teria outra
--    lógica de retentativa, outro registro de erro, e um dia divergiria do
--    caminho agendado — que é o que roda sempre.

-- ---------------------------------------------------------------------------
-- As hashtags
-- ---------------------------------------------------------------------------
alter table public.posts
  add column if not exists hashtags text not null default '',
  -- Muita agência prefere as hashtags no primeiro comentário, para a legenda
  -- ficar limpa no feed. A coluna `primeiro_comentario` já existia e o
  -- adaptador já sabe comentar; faltava dizer de onde vem o texto.
  add column if not exists hashtags_no_comentario boolean not null default false;

comment on column public.posts.hashtags is
  'Só as hashtags, sem a legenda. Quem junta é o worker, na hora de publicar.';

-- ---------------------------------------------------------------------------
-- Criar
-- ---------------------------------------------------------------------------
create or replace function public.criar_publicacao(
  p_cliente   uuid,
  p_titulo    text,
  p_tipo      public.tipo_post,
  p_legenda   text default '',
  p_hashtags  text default '',
  p_no_comentario boolean default false,
  p_contas    uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post   uuid;
  v_quantas int;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para criar publicacao.';
  end if;
  if not public.usuario_ve_cliente(p_cliente) then
    raise exception 'Cliente % nao encontrado.', p_cliente;
  end if;
  if not public.cliente_tem_modulo(p_cliente, 'publicacao') then
    raise exception 'Este cliente nao tem publicacao no contrato.';
  end if;
  if length(btrim(coalesce(p_titulo, ''))) = 0 then
    raise exception 'De um nome interno para a publicacao, para a equipe achar depois.';
  end if;

  insert into public.posts
    (cliente_id, titulo_interno, tipo, legenda, hashtags, hashtags_no_comentario, criado_por)
  values
    (p_cliente, btrim(p_titulo), p_tipo, coalesce(p_legenda, ''),
     btrim(coalesce(p_hashtags, '')), coalesce(p_no_comentario, false), auth.uid())
  returning id into v_post;

  -- Contas escolhidas. Sem escolha, o worker publica em todas as ativas do
  -- cliente (fallback da 0007) — e isso continua valendo, de proposito: e o
  -- caso do cliente com um perfil so, que e a maioria.
  if p_contas is not null and array_length(p_contas, 1) > 0 then
    insert into public.post_alvos (post_id, conta_social_id, estado, proxima_tentativa_em)
    select v_post, c.id, 'pendente', now()
      from public.contas_sociais c
     where c.id = any(p_contas)
       and c.cliente_id = p_cliente
       and c.ativo;

    select count(*) into v_quantas from public.post_alvos a where a.post_id = v_post;
    if v_quantas = 0 then
      raise exception
        'Nenhuma das contas escolhidas serve para este cliente. '
        'Conecte a conta no calendario antes de agendar.';
    end if;
  end if;

  return jsonb_build_object('id', v_post);
end;
$$;

revoke all on function public.criar_publicacao(uuid, text, public.tipo_post, text, text, boolean, uuid[])
  from public, anon;
grant execute on function public.criar_publicacao(uuid, text, public.tipo_post, text, text, boolean, uuid[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Editar — enquanto ainda não saiu
-- ---------------------------------------------------------------------------
create or replace function public.atualizar_publicacao(
  p_post      uuid,
  p_titulo    text default null,
  p_legenda   text default null,
  p_hashtags  text default null,
  p_no_comentario boolean default null,
  p_tipo      public.tipo_post default null,
  p_contas    uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post public.posts%rowtype;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para editar publicacao.';
  end if;

  select * into v_post from public.posts p where p.id = p_post;
  if not found or not public.usuario_ve_cliente(v_post.cliente_id) then
    raise exception 'Publicacao % nao encontrada.', p_post;
  end if;
  if v_post.status in ('publicando', 'publicado', 'publicado_parcial') then
    raise exception 'Esta publicacao esta em % — nao muda mais.', v_post.status;
  end if;

  -- Trocar o formato com mídia anexada quebraria a regra do novo formato: um
  -- carrossel de cinco fotos virando reel não tem vídeo nenhum. Recusa alto
  -- em vez de deixar a peça num estado que não publica.
  if p_tipo is not null and p_tipo <> v_post.tipo
     and exists (select 1 from public.post_midias m where m.post_id = p_post) then
    raise exception
      'Tire os arquivos antes de trocar o formato: o que serve para % pode nao servir para %.',
      v_post.tipo, p_tipo;
  end if;

  update public.posts
     set titulo_interno = coalesce(nullif(btrim(coalesce(p_titulo, '')), ''), titulo_interno),
         legenda        = coalesce(p_legenda, legenda),
         hashtags       = coalesce(btrim(p_hashtags), hashtags),
         hashtags_no_comentario = coalesce(p_no_comentario, hashtags_no_comentario),
         tipo           = coalesce(p_tipo, tipo),
         atualizado_em  = now()
   where id = p_post;

  if p_contas is not null then
    -- Alvo que já tentou publicar não se apaga: é histórico do que aconteceu.
    delete from public.post_alvos a
     where a.post_id = p_post
       and a.estado = 'pendente'
       and not (a.conta_social_id = any(p_contas));

    insert into public.post_alvos (post_id, conta_social_id, estado, proxima_tentativa_em)
    select p_post, c.id, 'pendente', now()
      from public.contas_sociais c
     where c.id = any(p_contas)
       and c.cliente_id = v_post.cliente_id
       and c.ativo
    on conflict (post_id, conta_social_id) do nothing;
  end if;

  return jsonb_build_object('id', p_post);
end;
$$;

revoke all on function public.atualizar_publicacao(uuid, text, text, text, boolean, public.tipo_post, uuid[])
  from public, anon;
grant execute on function public.atualizar_publicacao(uuid, text, text, text, boolean, public.tipo_post, uuid[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Agendar, ou postar agora
--
-- "Postar agora" é `p_quando = now()`. Um caminho paralelo que publicasse na
-- hora teria outra lógica de retentativa e outro registro de erro, e um dia
-- divergiria do caminho que roda sempre.
-- ---------------------------------------------------------------------------
create or replace function public.agendar_publicacao(
  p_post   uuid,
  p_quando timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post    public.posts%rowtype;
  v_lim     record;
  v_midias  int;
  v_contas  int;
  v_quando  timestamptz;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para agendar.';
  end if;

  select * into v_post from public.posts p where p.id = p_post;
  if not found or not public.usuario_ve_cliente(v_post.cliente_id) then
    raise exception 'Publicacao % nao encontrada.', p_post;
  end if;
  if v_post.status in ('publicando', 'publicado', 'publicado_parcial') then
    raise exception 'Esta publicacao esta em % — nao da para agendar de novo.', v_post.status;
  end if;

  -- O ULTIMO ponto onde ainda da para avisar. Depois disto a peca e do worker,
  -- e um erro aqui aparece de madrugada, com o cliente sem receber nada.
  select * into v_lim from public.limites_de_midia(v_post.tipo);
  select count(*) into v_midias from public.post_midias m where m.post_id = p_post;

  if v_midias < v_lim.minimo then
    raise exception
      'Falta arquivo: % pede % e tem %. Anexe antes de agendar.',
      v_post.tipo, v_lim.minimo, v_midias;
  end if;

  -- Sem destino, o worker marca a peca com erro e ninguem ve nada publicado.
  -- Melhor recusar agora, com o motivo.
  select count(*) into v_contas
    from public.contas_sociais c
   where c.cliente_id = v_post.cliente_id
     and c.ativo
     and c.acesso_parceiro = 'concedido'
     and (c.plataforma <> 'instagram' or c.ig_user_id is not null);

  if v_contas = 0 and not exists (select 1 from public.post_alvos a where a.post_id = p_post) then
    raise exception
      'Este cliente nao tem conta conectada. Conecte em "onde publica", no calendario, '
      'senao nada sai no ar.';
  end if;

  v_quando := coalesce(p_quando, now());

  update public.posts
     set status        = 'agendado',
         agendado_para = v_quando,
         erro_mensagem = null,
         atualizado_em = now()
   where id = p_post;

  return jsonb_build_object(
    'id', p_post,
    'quando', v_quando,
    -- A tela diz coisas diferentes para "sai em instantes" e "sai dia 20":
    -- a primeira pede que a pessoa fique por perto.
    'agora', v_quando <= now() + interval '70 seconds'
  );
end;
$$;

revoke all on function public.agendar_publicacao(uuid, timestamptz) from public, anon;
grant execute on function public.agendar_publicacao(uuid, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ler, para reabrir no compositor
-- ---------------------------------------------------------------------------
create or replace function public.publicacao(p_post uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'id',            p.id,
           'clienteId',     p.cliente_id,
           'titulo',        p.titulo_interno,
           'tipo',          p.tipo,
           'legenda',       p.legenda,
           'hashtags',      p.hashtags,
           'noComentario',  p.hashtags_no_comentario,
           'quando',        p.agendado_para,
           'status',        p.status,
           'erro',          p.erro_mensagem,
           'contas',        (
             select coalesce(jsonb_agg(a.conta_social_id), '[]'::jsonb)
               from public.post_alvos a where a.post_id = p.id
           ),
           'midias',        public.midias_do_post(p.id)
         )
    from public.posts p
   where p.id = p_post
     and public.usuario_ve_cliente(p.cliente_id);
$$;

revoke all on function public.publicacao(uuid) from public, anon;
grant execute on function public.publicacao(uuid) to authenticated, service_role;
