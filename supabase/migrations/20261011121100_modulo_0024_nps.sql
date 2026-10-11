-- =============================================================================
-- Modulo — 0024: NPS
--
-- Detrator nao e numero num grafico: e coisa urgente no painel da equipe.
-- Por isso a classificacao e derivada da nota, e nao um campo que alguem
-- esquece de preencher.
-- =============================================================================

create table if not exists public.nps_pesquisas (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  competencia date not null,
  enviada_em  timestamptz,
  criado_por  uuid references public.perfis(user_id) on delete set null,
  criado_em   timestamptz not null default now(),
  unique (cliente_id, competencia)
);

create table if not exists public.nps_respostas (
  id          uuid primary key default gen_random_uuid(),
  pesquisa_id uuid not null references public.nps_pesquisas(id) on delete cascade,
  nota        smallint not null check (nota between 0 and 10),
  comentario  text,
  autor_nome  text,
  criado_em   timestamptz not null default now()
);

create index if not exists nps_respostas_pesquisa_idx
  on public.nps_respostas (pesquisa_id, criado_em desc);

create or replace view public.nps_com_classificacao as
  select r.*,
         p.cliente_id,
         p.competencia,
         case
           when r.nota <= 6 then 'detrator'
           when r.nota <= 8 then 'neutro'
           else 'promotor'
         end as classificacao
    from public.nps_respostas r
    join public.nps_pesquisas p on p.id = r.pesquisa_id;

alter view public.nps_com_classificacao set (security_invoker = on);
revoke all on public.nps_com_classificacao from anon;

do $$
declare t text;
begin
  foreach t in array array['nps_pesquisas','nps_respostas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_equipe_le', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.usuario_ativo())',
      t || '_equipe_le', t);
    execute format('drop policy if exists %I on public.%I', t || '_escreve', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.usuario_edita()) with check (public.usuario_edita())',
      t || '_escreve', t);
  end loop;
end $$;

drop policy if exists nps_pesquisas_cliente_le on public.nps_pesquisas;
create policy nps_pesquisas_cliente_le on public.nps_pesquisas
  for select to authenticated
  using (
    cliente_id in (select public.clientes_do_usuario())
    and public.cliente_tem_modulo(cliente_id, 'nps')
  );

drop policy if exists nps_respostas_cliente_le on public.nps_respostas;
create policy nps_respostas_cliente_le on public.nps_respostas
  for select to authenticated
  using (exists (select 1 from public.nps_pesquisas p
                  where p.id = pesquisa_id
                    and p.cliente_id in (select public.clientes_do_usuario())
                    and public.cliente_tem_modulo(p.cliente_id, 'nps')));

drop policy if exists nps_respostas_cliente_responde on public.nps_respostas;
create policy nps_respostas_cliente_responde on public.nps_respostas
  for insert to authenticated
  with check (exists (select 1 from public.nps_pesquisas p
                       where p.id = pesquisa_id
                         and p.cliente_id in (select public.clientes_do_usuario())
                         and public.cliente_tem_modulo(p.cliente_id, 'nps')));
