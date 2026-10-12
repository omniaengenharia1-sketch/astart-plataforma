-- =============================================================================
-- Fundacao — 0040: a porta de entrada do primeiro dia
--
-- Num banco novo `perfis` esta vazia. Logo `usuario_admin()` e falso para todo
-- mundo, a Edge Function `convidar` recusa com "So quem e admin convida", e a
-- plataforma nasce TRANCADA: ninguem pode convidar ninguem, nem a propria dona.
--
-- Esta funcao abre a porta uma vez e se fecha sozinha: no segundo uso ela
-- recusa, porque ja ha alguem administrando e dali em diante a porta e o
-- convite. Nao ha e-mail escrito no codigo — quem roda diz qual conta promove.
--
-- Nao e `authenticated`: so service_role. Ela roda do editor SQL do painel ou
-- do CLI, nunca do navegador. Se fosse chamavel por quem esta logado, numa base
-- recem-criada a primeira pessoa a aparecer se promoveria.
--
-- Como usar, no editor SQL do Supabase, depois de criar a conta em
-- Authentication > Users:
--
--   select public.primeiro_admin('voce@astartstudio.com.br');
-- =============================================================================
create or replace function public.primeiro_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user  uuid;
begin
  if v_email = '' then
    raise exception 'Diga o e-mail da conta que vai administrar.';
  end if;

  -- A trava que faz esta funcao ser segura: ela so existe enquanto a casa esta
  -- vazia. Com um admin ativo, quem da acesso e o convite — e e ele que grava
  -- quem convidou quem.
  if exists (select 1 from public.perfis where papel = 'admin' and ativo) then
    raise exception 'Ja existe alguem administrando a plataforma. Use o convite.';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is null then
    raise exception 'Nao achei a conta %. Crie ela em Authentication > Users primeiro.', v_email;
  end if;

  -- Ninguem e equipe e cliente ao mesmo tempo (gatilho da 0013); se o e-mail
  -- ja for de cliente, o gatilho recusa e a mensagem dele e a resposta certa.
  insert into public.perfis (user_id, nome, email, papel, ativo)
  values (v_user, initcap(split_part(v_email, '@', 1)), v_email, 'admin', true)
  on conflict (user_id) do update
    set papel = 'admin', ativo = true, email = excluded.email;

  return v_user;
end;
$$;

revoke all on function public.primeiro_admin(text) from public, anon, authenticated;
grant execute on function public.primeiro_admin(text) to service_role;

comment on function public.primeiro_admin(text) is
  'Promove a primeira conta a admin. Recusa quando ja ha admin ativo. So service_role.';
