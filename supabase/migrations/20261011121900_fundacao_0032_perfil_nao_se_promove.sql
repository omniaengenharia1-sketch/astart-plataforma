-- =============================================================================
-- Fundacao — 0032: ninguem se promove sozinho
--
-- BURACO QUE ISTO FECHA. A politica `perfis_edita_proprio` (0013) deixa cada
-- pessoa editar a PROPRIA linha de perfil, para trocar nome, cargo e telefone.
-- Mas politica de RLS e por LINHA, nao por COLUNA: quem podia editar a propria
-- linha podia editar a coluna `papel` dela tambem.
--
--   update public.perfis set papel = 'admin' where user_id = auth.uid();
--
-- Uma linha, e qualquer pessoa da equipe virava admin — com acesso ao
-- financeiro, aos convites e a todos os clientes. Provado num banco limpo
-- antes desta migration existir.
--
-- O conserto nao pode ser privilegio de coluna (`grant update (nome, ...)`),
-- porque o admin tambem e `authenticated` e perderia o direito junto. Entao e
-- um gatilho: quem nao e admin mexe so no que e dele.
--
-- auth.uid() nulo = service_role (Edge Function `convidar`), que e quem cria o
-- perfil no aceite do convite. Esse caminho passa.
-- =============================================================================

create or replace function public.tg_perfil_protege_privilegio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.usuario_admin() then
    return new;
  end if;

  if new.papel is distinct from old.papel then
    raise exception 'Papel so quem administra a plataforma muda.';
  end if;
  if new.ativo is distinct from old.ativo
     or new.desativado_em is distinct from old.desativado_em then
    raise exception 'Acesso so quem administra a plataforma muda.';
  end if;
  if new.user_id is distinct from old.user_id or new.email is distinct from old.email then
    raise exception 'E-mail e conta nao se trocam por aqui.';
  end if;

  return new;
end;
$$;

drop trigger if exists perfis_protege_privilegio on public.perfis;
create trigger perfis_protege_privilegio
  before update on public.perfis
  for each row execute function public.tg_perfil_protege_privilegio();

comment on function public.tg_perfil_protege_privilegio() is
  'RLS e por linha, nao por coluna: sem este gatilho, quem edita o proprio '
  'perfil se promove a admin numa linha de SQL.';
