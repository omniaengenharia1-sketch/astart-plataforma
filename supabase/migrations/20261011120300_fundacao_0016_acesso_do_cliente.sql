-- =============================================================================
-- Fundacao — 0016: login do cliente
--
-- Equipe e cliente dividem o mesmo auth.users. Se um user_id aparecer nas duas
-- tabelas, usuario_ativo() devolve verdadeiro para um cliente e ele enxerga a
-- agencia inteira. A porta fica fechada no banco, nao na aplicacao.
-- =============================================================================

create table if not exists public.clientes_usuarios (
  user_id       uuid not null references auth.users(id) on delete cascade,
  cliente_id    uuid not null references public.clientes(id) on delete cascade,
  nome          text,
  email         text not null check (length(btrim(email)) > 0),
  papel_cliente public.papel_cliente not null default 'principal',
  ativo         boolean not null default true,
  convidado_por uuid references public.perfis(user_id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (user_id, cliente_id)
);

comment on table public.clientes_usuarios is
  'Chave composta de proposito: uma pessoa pode responder por mais de um cliente.';

create index if not exists clientes_usuarios_cliente_idx
  on public.clientes_usuarios (cliente_id) where ativo;

drop trigger if exists clientes_usuarios_atualizado_em on public.clientes_usuarios;
create trigger clientes_usuarios_atualizado_em
  before update on public.clientes_usuarios
  for each row execute function public.tg_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- Ninguem e equipe e cliente ao mesmo tempo. Barrado nos dois sentidos.
-- ---------------------------------------------------------------------------
create or replace function public.tg_nao_e_equipe()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.perfis p where p.user_id = new.user_id) then
    raise exception 'Este usuario ja faz parte da equipe da Astart e nao pode virar acesso de cliente.';
  end if;
  return new;
end;
$$;

create or replace function public.tg_nao_e_cliente()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.clientes_usuarios c where c.user_id = new.user_id) then
    raise exception 'Este usuario ja tem acesso de cliente e nao pode entrar na equipe.';
  end if;
  return new;
end;
$$;

drop trigger if exists clientes_usuarios_nao_e_equipe on public.clientes_usuarios;
create trigger clientes_usuarios_nao_e_equipe
  before insert or update of user_id on public.clientes_usuarios
  for each row execute function public.tg_nao_e_equipe();

drop trigger if exists perfis_nao_e_cliente on public.perfis;
create trigger perfis_nao_e_cliente
  before insert or update of user_id on public.perfis
  for each row execute function public.tg_nao_e_cliente();

-- ---------------------------------------------------------------------------
-- Helpers de RLS
-- ---------------------------------------------------------------------------
create or replace function public.usuario_cliente()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.clientes_usuarios c
     where c.user_id = auth.uid() and c.ativo
  );
$$;

create or replace function public.clientes_do_usuario()
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select c.cliente_id from public.clientes_usuarios c
   where c.user_id = auth.uid() and c.ativo;
$$;

create or replace function public.usuario_ve_cliente(p_cliente uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.usuario_ativo()
      or exists (
           select 1 from public.clientes_usuarios c
            where c.user_id = auth.uid() and c.ativo and c.cliente_id = p_cliente
         );
$$;

revoke all on function public.usuario_cliente()        from public, anon;
revoke all on function public.clientes_do_usuario()    from public, anon;
revoke all on function public.usuario_ve_cliente(uuid) from public, anon;
grant execute on function public.usuario_cliente()        to authenticated, service_role;
grant execute on function public.clientes_do_usuario()    to authenticated, service_role;
grant execute on function public.usuario_ve_cliente(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.clientes_usuarios enable row level security;
revoke all on public.clientes_usuarios from anon;

drop policy if exists clientes_usuarios_admin on public.clientes_usuarios;
create policy clientes_usuarios_admin on public.clientes_usuarios
  for all to authenticated
  using (public.usuario_admin())
  with check (public.usuario_admin());

-- A equipe ativa le para saber quem responde pelo cliente.
drop policy if exists clientes_usuarios_equipe_le on public.clientes_usuarios;
create policy clientes_usuarios_equipe_le on public.clientes_usuarios
  for select to authenticated
  using (public.usuario_ativo());

-- O cliente le a propria linha, e so ela.
drop policy if exists clientes_usuarios_propria on public.clientes_usuarios;
create policy clientes_usuarios_propria on public.clientes_usuarios
  for select to authenticated
  using (user_id = auth.uid());

-- O cliente le o proprio cadastro, o proprio contrato e os proprios documentos.
-- As politicas de equipe ja existem e convivem: politicas se somam.
drop policy if exists clientes_cliente_le on public.clientes;
create policy clientes_cliente_le on public.clientes
  for select to authenticated
  using (id in (select public.clientes_do_usuario()));

drop policy if exists cliente_servicos_cliente_le on public.cliente_servicos;
create policy cliente_servicos_cliente_le on public.cliente_servicos
  for select to authenticated
  using (cliente_id in (select public.clientes_do_usuario()));

drop policy if exists cliente_servico_modulos_cliente_le on public.cliente_servico_modulos;
create policy cliente_servico_modulos_cliente_le on public.cliente_servico_modulos
  for select to authenticated
  using (exists (
    select 1 from public.cliente_servicos cs
     where cs.id = cliente_servico_id
       and cs.cliente_id in (select public.clientes_do_usuario())));

drop policy if exists cliente_documentos_cliente_le on public.cliente_documentos;
create policy cliente_documentos_cliente_le on public.cliente_documentos
  for select to authenticated
  using (
    cliente_id in (select public.clientes_do_usuario())
    and public.cliente_tem_modulo(cliente_id, 'contrato')
  );
