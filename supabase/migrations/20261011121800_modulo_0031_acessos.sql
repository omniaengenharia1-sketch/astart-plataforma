-- =============================================================================
-- Modulo — 0031: quem tem acesso
--
-- A tela de Ajustes > Equipe e a lista de contatos de cada cliente. O convite
-- em si sai pela Edge Function `convidar` (precisa de service role, que nunca
-- chega ao navegador); aqui ficam a leitura e as duas acoes que o banco resolve
-- sozinho: revogar convite e tirar o acesso de alguem.
--
-- Nada expira: convite aberto fica aberto ate ser aceito ou revogado na mao.
-- Por isso "revogar" tem de existir de verdade, e aparecer na tela.
-- =============================================================================

create or replace function public.equipe_e_convites()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ativo() then null::jsonb else jsonb_build_object(

    'pessoas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', p.user_id,
        'nome', p.nome,
        'email', p.email,
        'papel', p.papel,
        'cargo', p.cargo,
        'ativo', p.ativo,
        'desativadoEm', p.desativado_em)
        order by p.ativo desc, p.nome)
      from public.perfis p), '[]'::jsonb),

    -- Convites so o admin le (politica da 0013). Para os outros papeis a lista
    -- volta vazia pelo RLS, sem if nenhum escrito aqui.
    'convites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cv.id,
        'destino', cv.destino,
        'email', cv.email,
        'nome', cv.nome,
        'papel', cv.papel,
        'cargo', cv.cargo,
        'clienteId', cv.cliente_id,
        'clienteNome', (select c.nome from public.clientes c where c.id = cv.cliente_id),
        'papelCliente', cv.papel_cliente,
        'criadoEm', cv.criado_em)
        order by cv.criado_em desc)
      from public.convites cv
     where cv.aceito_em is null and cv.revogado_em is null), '[]'::jsonb),

    'souAdmin', public.usuario_admin()
  ) end;
$$;

revoke all on function public.equipe_e_convites() from public, anon;
grant execute on function public.equipe_e_convites() to authenticated;

-- ---------------------------------------------------------------------------
-- revogar_convite — o convite que nao vence precisa poder ser cancelado
-- ---------------------------------------------------------------------------
create or replace function public.revogar_convite(p_convite uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_cv public.convites;
begin
  select * into v_cv from public.convites where id = p_convite;
  if v_cv.id is null then
    raise exception 'Convite nao encontrado.';
  end if;
  if v_cv.aceito_em is not null then
    raise exception 'Este convite ja foi aceito. Para tirar o acesso, desative a pessoa.';
  end if;
  if v_cv.revogado_em is not null then
    return;  -- Ja estava revogado: repetir a acao nao e erro.
  end if;

  update public.convites set revogado_em = now() where id = p_convite;
end;
$$;

revoke all on function public.revogar_convite(uuid) from public, anon;
grant execute on function public.revogar_convite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- desativar_pessoa / reativar_pessoa
--
-- Desativar nao apaga: o historico de quem respondeu o que continua de pe. O
-- perfil desativado perde o e-mail obrigatorio (constraint da 0013) mas guarda
-- o nome, para as telas antigas nao virarem "null aprovou".
-- ---------------------------------------------------------------------------
create or replace function public.desativar_pessoa(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_user_id = auth.uid() then
    raise exception 'Voce nao pode tirar o proprio acesso.';
  end if;
  if not exists (select 1 from public.perfis p where p.user_id = p_user_id) then
    raise exception 'Pessoa nao encontrada.';
  end if;

  update public.perfis
     set ativo = false, desativado_em = now()
   where user_id = p_user_id and ativo;
end;
$$;

create or replace function public.reativar_pessoa(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.perfis
     set ativo = true, desativado_em = null
   where user_id = p_user_id and not ativo;
end;
$$;

revoke all on function public.desativar_pessoa(uuid) from public, anon;
revoke all on function public.reativar_pessoa(uuid) from public, anon;
grant execute on function public.desativar_pessoa(uuid) to authenticated;
grant execute on function public.reativar_pessoa(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- tirar_acesso_do_cliente — o contato do cliente que nao responde mais por ele
-- ---------------------------------------------------------------------------
create or replace function public.tirar_acesso_do_cliente(
  p_user_id  uuid,
  p_cliente  uuid
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.clientes_usuarios
     set ativo = false
   where user_id = p_user_id and cliente_id = p_cliente and ativo;
end;
$$;

revoke all on function public.tirar_acesso_do_cliente(uuid, uuid) from public, anon;
grant execute on function public.tirar_acesso_do_cliente(uuid, uuid) to authenticated;
