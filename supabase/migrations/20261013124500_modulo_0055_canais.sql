-- 0055 — o canal: rede e formato numa escolha só.
--
-- A dona descreveu o mLabs e pediu igual: *"você escolhe a plataforma que você
-- quer... seleciona a rede social e o formato"*. No mLabs isso é UM ícone —
-- `[Instagram] [Instagram Stories] [Instagram Reels] [Facebook]`. O compositor
-- que eu construí faz duas perguntas separadas: "formato?" e "onde publica?".
--
-- Duas perguntas não são só mais cliques. Elas deixam a pessoa montar
-- combinação impossível: Reel numa Página do Facebook, que não tem adaptador
-- nenhum; story num formato que a conta não alcança. A tela aceitava, o banco
-- aceitava, e a recusa vinha na hora de publicar — de madrugada.
--
-- É a mesma falha da 0047 (PNG onde a Meta quer JPEG) e da `formatos.ts`
-- (quatro formatos oferecidos, um implementado), agora na terceira dimensão: a
-- COMBINAÇÃO de conta e formato. Três vezes o mesmo erro em arquivos
-- diferentes, e sempre porque a tela sabia menos que o adaptador.
--
-- Então o banco passa a responder a pergunta inteira: *quais canais este
-- cliente tem, e em quais deles dá para publicar de verdade?*
--
-- A FONTE DA VERDADE É O ADAPTADOR, não a documentação da Meta. A Meta aceita
-- coisa que a gente não implementou, e prometer na tela o que o código não faz
-- é pior que não oferecer. A tabela abaixo espelha
-- `supabase/functions/_shared/meta/formatos.ts`, e `scripts/provar-canais.mjs`
-- compara as duas e falha quando divergem — porque duas cópias da mesma regra
-- em linguagens diferentes é a armadilha que este projeto já pagou três vezes.

-- ---------------------------------------------------------------------------
-- 1. O que cada plataforma publica
--
-- Tabela, não função com `case`: é dado de catálogo, muda por migration, e um
-- `select` nela é o que o prover compara com o TypeScript. Regra escondida
-- dentro de um `case` não dá para conferir de fora.
-- ---------------------------------------------------------------------------
create table if not exists public.formatos_suportados (
  plataforma  public.plataforma_social not null,
  tipo        public.tipo_post not null,
  -- Falso = o adaptador ainda não faz. A tela mostra o chip apagado, com o
  -- motivo do lado. "Não aparece" é pior que "aparece apagado dizendo por
  -- quê": a pessoa fica procurando o que não existe.
  publicavel  boolean not null,
  motivo      text,
  primary key (plataforma, tipo),
  constraint formatos_suportados_motivo check (publicavel or motivo is not null)
);

comment on table public.formatos_suportados is
  'Espelha supabase/functions/_shared/meta/formatos.ts. scripts/provar-canais.mjs compara.';

alter table public.formatos_suportados enable row level security;

-- Catálogo, não dado de cliente: quem está logado e ativo lê. Escrita não tem
-- política nenhuma, de propósito — muda por migration, junto com o adaptador.
drop policy if exists formatos_suportados_le on public.formatos_suportados;
create policy formatos_suportados_le on public.formatos_suportados
  for select to authenticated using (public.usuario_ativo());

revoke all on table public.formatos_suportados from anon;

insert into public.formatos_suportados (plataforma, tipo, publicavel, motivo) values
  ('instagram', 'imagem',    true,  null),
  ('instagram', 'carrossel', true,  null),
  ('instagram', 'reel',      true,  null),
  ('instagram', 'story',     true,  null),
  -- O Facebook ainda não tem adaptador. A dona confirmou que precisa dele, e
  -- ele é pré-requisito do vídeo da homologação — mas enquanto não existe, a
  -- tela tem de dizer isso em vez de aceitar e falhar de madrugada.
  ('facebook',  'imagem',    false,
   'O Facebook ainda não publica por aqui — falta o adaptador da Página. Já está na fila.'),
  ('facebook',  'carrossel', false,
   'O Facebook ainda não publica por aqui — falta o adaptador da Página. Já está na fila.'),
  ('facebook',  'reel',      false,
   'O Facebook ainda não publica por aqui — falta o adaptador da Página. Já está na fila.'),
  ('facebook',  'story',     false,
   'O Facebook ainda não publica por aqui — falta o adaptador da Página. Já está na fila.')
on conflict (plataforma, tipo) do update
   set publicavel = excluded.publicavel,
       motivo     = excluded.motivo;

-- ---------------------------------------------------------------------------
-- 2. Dá para publicar NESTE canal?
--
-- Uma função, usada pela tela e pelas duas travas de escrita. Sem ela, a regra
-- ficaria escrita em três lugares — e o terceiro seria o que divergisse.
-- ---------------------------------------------------------------------------
create or replace function public.canal_publicavel(p_conta uuid, p_tipo public.tipo_post)
returns table (publicavel boolean, motivo text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_conta public.contas_sociais%rowtype;
  v_fmt   public.formatos_suportados%rowtype;
begin
  select * into v_conta from public.contas_sociais c where c.id = p_conta;
  if not found then
    return query select false, 'Esta conta não existe mais. Recarregue a tela.'::text;
    return;
  end if;

  -- A conta antes do formato: conta desligada não publica em formato nenhum, e
  -- dizer "o Facebook não faz reel" para uma conta desligada seria responder a
  -- pergunta errada.
  if not v_conta.ativo then
    return query select false, 'Esta conta está desligada na plataforma.'::text;
    return;
  end if;
  if v_conta.acesso_parceiro <> 'concedido' then
    return query select false,
      ('O acesso de parceiro desta conta está ' || v_conta.acesso_parceiro ||
       '. Confira no Business Manager.')::text;
    return;
  end if;
  if v_conta.plataforma = 'instagram' and v_conta.ig_user_id is null then
    return query select false, 'Falta o id do Instagram desta conta. Reconecte-a.'::text;
    return;
  end if;

  select * into v_fmt from public.formatos_suportados f
   where f.plataforma = v_conta.plataforma and f.tipo = p_tipo;
  if not found then
    return query select false,
      ('Não existe regra para ' || p_tipo || ' em ' || v_conta.plataforma || '.')::text;
    return;
  end if;

  return query select v_fmt.publicavel, v_fmt.motivo;
end;
$$;

revoke all on function public.canal_publicavel(uuid, public.tipo_post) from public, anon;
grant execute on function public.canal_publicavel(uuid, public.tipo_post)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Os canais do cliente, prontos para a tela desenhar
--
-- Uma linha por (conta × formato), com o rótulo que a pessoa lê. É a resposta
-- da pergunta única: a tela não precisa cruzar duas listas nem saber quais
-- combinações existem.
--
-- `limites_de_midia` entra junto porque é o que a tela escreve embaixo do chip
-- ("pede 1 foto JPG"). Duas chamadas para montar um chip seria a tela
-- remontando a regra.
-- ---------------------------------------------------------------------------
create or replace function public.canais_do_cliente(p_cliente uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if not public.usuario_ve_cliente(p_cliente) then
    return null;
  end if;

  select coalesce(jsonb_agg(linha order by ordem), '[]'::jsonb) into v
    from (
      select jsonb_build_object(
               'contaId',    c.id,
               'conta',      c.nome_exibicao,
               'plataforma', c.plataforma,
               'tipo',       f.tipo,
               'publicavel', p.publicavel,
               'motivo',     p.motivo,
               'minimo',     l.minimo,
               'maximo',     l.maximo,
               'natureza',   l.natureza
             ) as linha,
             -- Instagram primeiro, e dentro dele a ordem em que a agência
             -- pensa: post, carrossel, reel, story.
             (case c.plataforma when 'instagram' then 0 else 1 end) * 100
               + (case f.tipo
                    when 'imagem' then 1 when 'carrossel' then 2
                    when 'reel' then 3 else 4 end)
               + (case when p.publicavel then 0 else 50 end) as ordem
        from public.contas_sociais c
        join public.formatos_suportados f on f.plataforma = c.plataforma
        cross join lateral public.canal_publicavel(c.id, f.tipo) p
        cross join lateral public.limites_de_midia(f.tipo) l
       where c.cliente_id = p_cliente
    ) t;

  return v;
end;
$$;

revoke all on function public.canais_do_cliente(uuid) from public, anon;
grant execute on function public.canais_do_cliente(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. As travas: nada entra num canal que não publica
--
-- A tela já não oferece. Isto é a segunda barreira, e existe porque tela não é
-- garantia: uma aba aberta de ontem, um clique duplo, uma chamada direta à
-- RPC. A regra vale onde o dado entra.
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
  v_post    uuid;
  v_quantas int;
  v_conta   uuid;
  v_pub     record;
  v_nome    text;
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

  -- O canal, conta por conta, ANTES de criar a linha. Recusar depois deixaria
  -- um rascunho que nunca publica, e a pessoa descobriria no botao de agendar.
  if p_contas is not null and array_length(p_contas, 1) > 0 then
    foreach v_conta in array p_contas loop
      select * into v_pub from public.canal_publicavel(v_conta, p_tipo);
      if not v_pub.publicavel then
        select c.nome_exibicao into v_nome from public.contas_sociais c where c.id = v_conta;
        raise exception '% em %: %',
          p_tipo, coalesce('@' || v_nome, 'conta escolhida'), v_pub.motivo;
      end if;
    end loop;
  end if;

  insert into public.posts
    (cliente_id, titulo_interno, tipo, legenda, hashtags, hashtags_no_comentario, criado_por)
  values
    (p_cliente, btrim(p_titulo), p_tipo, coalesce(p_legenda, ''),
     btrim(coalesce(p_hashtags, '')), coalesce(p_no_comentario, false), auth.uid())
  returning id into v_post;

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
-- 5. E a última porta antes do worker
--
-- `agendar_publicacao` já recusava sem arquivo e sem conta conectada. Passa a
-- recusar também o canal que não publica — incluindo o caso em que o alvo foi
-- gravado antes de a regra existir, ou em que a conta mudou de estado depois
-- de a peça ser criada.
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
  v_ruim    record;
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

  -- Canal que nao publica, entre os alvos ja gravados. Acontece quando a conta
  -- muda de estado depois de a peca ser criada: o acesso de parceiro expira, a
  -- conta e desligada. A peca ficaria agendada e falharia sozinha.
  select a.conta_social_id, c.nome_exibicao, p.motivo into v_ruim
    from public.post_alvos a
    join public.contas_sociais c on c.id = a.conta_social_id
    cross join lateral public.canal_publicavel(a.conta_social_id, v_post.tipo) p
   where a.post_id = p_post
     and not p.publicavel
   limit 1;

  if found then
    raise exception '% em @%: %', v_post.tipo, v_ruim.nome_exibicao, v_ruim.motivo;
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
    'agora', v_quando <= now() + interval '70 seconds'
  );
end;
$$;

revoke all on function public.agendar_publicacao(uuid, timestamptz) from public, anon;
grant execute on function public.agendar_publicacao(uuid, timestamptz) to authenticated, service_role;
