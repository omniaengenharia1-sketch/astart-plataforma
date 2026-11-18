-- 0072 — a Pagina do Facebook passa a publicar.
--
-- A dona: "eu preciso do Facebook, nao so do Instagram". E o `pages_manage_posts`
-- so se justifica no App Review da Meta se o video mostrar um post saindo numa
-- Pagina — entao o adaptador tinha de existir ANTES da submissao, nao depois.
--
-- O adaptador esta em `supabase/functions/_shared/meta/facebook.ts`. Esta
-- migration e o lado do banco: libera os formatos que ele faz de verdade, e
-- fecha as duas travas que ate aqui so sabiam perguntar pelo Instagram.
--
-- FOTO SIM, VIDEO NAO, E O MOTIVO E PROTOCOLO
--
-- Foto entra por `POST /{page}/photos` com a URL do arquivo: mesmo feitio do
-- Instagram, mesma funcao de chamada. Reel e story da Pagina sobem por
-- `rupload.facebook.com`, em upload retomavel de tres fases — outro host,
-- outro protocolo, e um estado novo na maquina do worker. Ficam recusados com
-- o motivo escrito, que e melhor que aceitos e quebrados de madrugada.
--
-- Os textos abaixo sao os MESMOS de `formatos.ts`. Quem cobra essa igualdade e
-- o `scripts/provar-canais.mjs`, e ele falha quando as duas listas divergem.
-- ---------------------------------------------------------------------------

insert into public.formatos_suportados (plataforma, tipo, publicavel, motivo) values
  ('facebook', 'imagem',    true, null),
  ('facebook', 'carrossel', true, null),
  ('facebook', 'reel',      false,
   'O Facebook ainda publica so foto por aqui — video da Pagina usa outro protocolo de envio. Ja esta na fila.'),
  ('facebook', 'story',     false,
   'O Facebook ainda publica so foto por aqui — video da Pagina usa outro protocolo de envio. Ja esta na fila.')
on conflict (plataforma, tipo) do update
   set publicavel = excluded.publicavel,
       motivo     = excluded.motivo;

-- ---------------------------------------------------------------------------
-- A trava de cadastro: conta de Pagina sem `page_id` nao publica
--
-- CORRECAO DE UMA VERSAO ANTERIOR DESTE ARQUIVO. Eu escrevi aqui que a
-- pergunta antiga (`plataforma = 'instagram' and ig_user_id is null`) deixava
-- uma conta de Pagina sem `page_id` passar por boa, e que ela quebraria na
-- hora de publicar. NAO E VERDADE, e o teste me mostrou: a tabela tem, desde
-- a 0002, a restricao `contas_sociais_ids_por_plataforma`, que recusa a linha
-- no insert. Essa conta nao existe e nunca existiu.
--
-- Entao o que isto aqui e, de verdade:
--
--   1. SEGUNDA BARREIRA. A regra vive numa restricao de tabela e em mais
--      nenhum lugar. Se alguem derrubar a restricao numa migration futura
--      — para aceitar uma conta em cadastro, por exemplo — a funcao continua
--      recusando, em vez de a trava sumir inteira de uma vez so.
--   2. A FRASE CERTA. Se um dia a linha existir, a mensagem fala da Pagina.
--      Dizer "falta o id do Instagram" para uma conta de Facebook manda a
--      pessoa conferir a coisa errada.
--
-- O resto do corpo e o mesmo; so este trecho muda.
-- ---------------------------------------------------------------------------
create or replace function public.canal_publicavel(p_conta uuid, p_tipo public.tipo_post)
returns table (publicavel boolean, motivo text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_conta record;
  v_fmt   record;
begin
  select c.* into v_conta
    from public.contas_sociais c
   where c.id = p_conta
     and public.usuario_ve_cliente(c.cliente_id);

  if not found then
    return query select false, 'Conta não encontrada.'::text;
    return;
  end if;

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
  if v_conta.plataforma = 'facebook' and v_conta.page_id is null then
    return query select false, 'Falta o id da Página desta conta. Reconecte-a.'::text;
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
-- A contagem de "este cliente tem alguma conta que presta?"
--
-- Aqui o buraco e REAL, e e outro do que eu tinha escrito. Estava:
--
--   (c.plataforma <> 'instagram' or c.ig_user_id is not null)
--
-- Para o Facebook de hoje isso da certo por acidente: a restricao de tabela
-- garante o `page_id`. O problema e a PROXIMA plataforma. No dia em que
-- `plataforma_social` ganhar um valor novo, essa expressao devolve `true`
-- para qualquer conta dele, com identificador ou sem — e a peca e aceita
-- achando que tem destino.
--
-- `case` sem `else` devolve NULO para o ramo que ninguem escreveu, e nulo nao
-- conta no `where`. A conta some da contagem em vez de passar por boa calada.
-- Esquecer de atualizar isto passa a custar "nao aparece", e nao "aceita e
-- quebra depois" — que e o lado certo para errar.
-- ---------------------------------------------------------------------------
create or replace function public.conta_tem_identificador(
  p_plataforma public.plataforma_social,
  p_ig_user_id text,
  p_page_id    text
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_plataforma
           when 'instagram' then p_ig_user_id is not null
           when 'facebook'  then p_page_id    is not null
         end;
$$;

comment on function public.conta_tem_identificador(public.plataforma_social, text, text) is
  'A conta tem o id que a plataforma dela exige para publicar? Nulo de proposito '
  'para plataforma nova: some da contagem em vez de passar por boa.';

revoke all on function public.conta_tem_identificador(public.plataforma_social, text, text)
  from public, anon;
grant execute on function public.conta_tem_identificador(public.plataforma_social, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- As duas funcoes que faziam a pergunta antiga
--
-- Corpos EXTRAIDOS dos arquivos de migration (0055 e 0044) e reescritos por
-- troca pontual, nao de memoria — a licao da 0070. O script que gerou isto
-- falha alto se o alvo nao aparecer exatamente uma vez em cada uma.
--
--   agendar_publicacao  recusava agendar quando o cliente nao tem conta boa
--   contas_do_cliente   marca na tela quais contas servem
--
-- Em ambas, "conta boa" passa a ser `conta_tem_identificador`, que sabe
-- perguntar pelo `page_id` da Pagina tambem.
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
     and public.conta_tem_identificador(c.plataforma, c.ig_user_id, c.page_id);

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

create or replace function public.contas_do_cliente(p_cliente uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',                 c.id,
               'plataforma',         c.plataforma,
               'nome',               c.nome_exibicao,
               'igUserId',           c.ig_user_id,
               'pageId',             c.page_id,
               'ativo',              c.ativo,
               'acessoParceiro',     c.acesso_parceiro,
               'tokenProprio',       c.token_ref is not null,
               'prontaParaPublicar', c.ativo
                                      and c.acesso_parceiro = 'concedido'
                                      and public.conta_tem_identificador(c.plataforma, c.ig_user_id, c.page_id)
             )
             order by c.nome_exibicao
           ),
           '[]'::jsonb
         )
    from public.contas_sociais c
   where c.cliente_id = p_cliente
     and public.cliente_tem_modulo(p_cliente, 'publicacao');
$$;
