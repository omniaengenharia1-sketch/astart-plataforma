-- 0044 — conectar a conta de Instagram do cliente.
--
-- O elo que faltava. O calendário cria post com hora, o worker publica, as
-- chaves da Meta estão no Vault — e `contas_sociais` não tinha escritor nenhum:
-- nem tela, nem função. Sem conta, o worker roda, não acha destino, e não
-- publica nada. Em silêncio, porque não há nada de errado em um cliente sem
-- conta: só não dá para publicar para ele.
--
-- A escrita fica no service_role, chamada pela Edge Function `conectar-conta`.
-- O motivo é o token: descobrir qual Página e qual conta de Instagram o
-- Business Manager alcança exige falar com a Graph API com o token do System
-- User, e esse token mora no Vault — longe do navegador, por regra.

-- ---------------------------------------------------------------------------
-- 1. Quem escreve conta social é a direção.
--
-- A `0006` deixou `contas_sociais` com `for all using (usuario_edita())`, que
-- inclui operação e inclui delete. Conectar a conta de um cliente a uma conta
-- de rede social é ato de direção: envolve o Business Manager da agência, o
-- token compartilhado, e erro aqui publica na conta errada de um cliente.
--
-- O delete continua existindo e continua protegido por outra via: `post_alvos`
-- referencia com `on delete restrict`, então conta com histórico de publicação
-- não é apagável nem por admin. Isso já estava certo desde a 0004.
-- ---------------------------------------------------------------------------
drop policy if exists contas_sociais_escreve on public.contas_sociais;

create policy contas_sociais_insere on public.contas_sociais
  for insert to authenticated with check (public.usuario_admin());

create policy contas_sociais_atualiza on public.contas_sociais
  for update to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

create policy contas_sociais_apaga on public.contas_sociais
  for delete to authenticated using (public.usuario_admin());

-- ---------------------------------------------------------------------------
-- 2. O token do sistema, para a Edge Function descobrir as contas.
--
-- Irmã da `token_da_conta()` da 0011, para o caso em que ainda NÃO existe
-- conta: é justamente o que a descoberta resolve. Só service_role, como a
-- outra — e a mensagem diz o que fazer quando a chave não está lá, em vez de
-- devolver nulo e deixar a Edge Function adivinhar.
-- ---------------------------------------------------------------------------
create or replace function public.token_do_sistema()
returns text
language plpgsql
stable
security definer
set search_path = public, vault, pg_temp
as $$
declare v_token text;
begin
  select s.decrypted_secret into v_token
    from vault.decrypted_secrets s
   where s.name = 'meta_system_user_token'
   limit 1;

  if v_token is null or length(btrim(v_token)) = 0 then
    raise exception
      'Token da Meta ausente no Vault (chave "meta_system_user_token"). '
      'Cadastre em Ajustes > Integrações antes de conectar contas.';
  end if;

  return v_token;
end;
$$;

revoke all on function public.token_do_sistema() from public, anon, authenticated;
grant execute on function public.token_do_sistema() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Salvar a conta descoberta.
--
-- Idempotente pelo id da Meta, não pelo nome: reconectar a mesma conta tem de
-- atualizar a linha existente, nunca criar uma segunda. Duas linhas para a
-- mesma conta de Instagram significaria publicar duas vezes — o pior bug
-- possível neste sistema, e o índice único da `0002` já impediria, com um erro
-- feio. Aqui o reencontro é explícito.
-- ---------------------------------------------------------------------------
create or replace function public.salvar_conta_social(
  p_cliente     uuid,
  p_plataforma  public.plataforma_social,
  p_nome        text,
  p_ig_user_id  text default null,
  p_page_id     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.clientes c where c.id = p_cliente) then
    raise exception 'Cliente % nao encontrado.', p_cliente;
  end if;
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'A conta precisa de um nome para aparecer na tela.';
  end if;

  -- O CHECK da tabela já cobra isto, e dizer antes é mais gentil que o erro do
  -- Postgres para quem está olhando a tela.
  if p_plataforma = 'instagram' and nullif(btrim(coalesce(p_ig_user_id, '')), '') is null then
    raise exception 'Conta de Instagram precisa do ig_user_id.';
  end if;
  if p_plataforma = 'facebook' and nullif(btrim(coalesce(p_page_id, '')), '') is null then
    raise exception 'Pagina do Facebook precisa do page_id.';
  end if;

  select c.id into v_id
    from public.contas_sociais c
   where (p_ig_user_id is not null and c.ig_user_id = p_ig_user_id)
      or (p_page_id    is not null and c.page_id    = p_page_id)
   limit 1;

  if v_id is not null then
    -- Conta que já existe pode estar em OUTRO cliente: trocar de cliente por
    -- engano moveria a publicação de lugar. Recusa alto.
    if exists (select 1 from public.contas_sociais c where c.id = v_id and c.cliente_id <> p_cliente) then
      raise exception
        'Esta conta da Meta ja esta ligada a outro cliente. '
        'Desligue lá antes de ligar aqui, para nao publicar no lugar errado.';
    end if;

    update public.contas_sociais
       set nome_exibicao = btrim(p_nome),
           ig_user_id    = coalesce(p_ig_user_id, ig_user_id),
           page_id       = coalesce(p_page_id, page_id),
           ativo         = true,
           atualizado_em = now()
     where id = v_id;

    return jsonb_build_object('id', v_id, 'novo', false, 'nome', btrim(p_nome));
  end if;

  insert into public.contas_sociais (cliente_id, plataforma, nome_exibicao, ig_user_id, page_id)
  values (p_cliente, p_plataforma, btrim(p_nome),
          nullif(btrim(coalesce(p_ig_user_id, '')), ''),
          nullif(btrim(coalesce(p_page_id, '')), ''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'novo', true, 'nome', btrim(p_nome));
end;
$$;

revoke all on function public.salvar_conta_social(uuid, public.plataforma_social, text, text, text)
  from public, anon, authenticated;
grant execute on function public.salvar_conta_social(uuid, public.plataforma_social, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. O que a tela mostra.
--
-- Fica atrás do módulo, como todo o resto: cliente sem publicação contratada
-- não tem esta pergunta. E devolve `prontaParaPublicar`, que é a única coisa
-- que a pessoa quer saber — em vez de obrigá-la a cruzar três campos de cabeça.
-- ---------------------------------------------------------------------------
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
                                      and (c.plataforma <> 'instagram' or c.ig_user_id is not null)
             )
             order by c.nome_exibicao
           ),
           '[]'::jsonb
         )
    from public.contas_sociais c
   where c.cliente_id = p_cliente
     and public.cliente_tem_modulo(p_cliente, 'publicacao');
$$;

revoke all on function public.contas_do_cliente(uuid) from public, anon;
grant execute on function public.contas_do_cliente(uuid) to authenticated, service_role;
