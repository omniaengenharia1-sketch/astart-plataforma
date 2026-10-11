-- =============================================================================
-- Fundacao — 0015: o contrato do cliente
--
-- Valor em CENTAVOS inteiros. Dinheiro em ponto flutuante perde centavo, e
-- centavo perdido em cobranca vira ligacao de cliente.
-- =============================================================================

do $$ begin
  create type public.status_servico as enum ('ativo', 'pausado', 'encerrado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_documento as enum ('proposta', 'contrato', 'outro');
exception when duplicate_object then null; end $$;

create table if not exists public.cliente_servicos (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.clientes(id) on delete cascade,
  servico_id      uuid not null references public.servicos(id),
  formato         public.formato_contrato not null,
  status          public.status_servico not null default 'ativo',
  responsavel_id  uuid references public.perfis(user_id) on delete set null,

  valor_centavos  bigint not null check (valor_centavos >= 0),
  dia_vencimento  smallint check (dia_vencimento between 1 and 28),
  parcelas        smallint check (parcelas >= 1),

  inicio          date not null,
  fim             date,
  entrega_em      date,
  data_evento     date,
  observacao      text,

  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),

  unique (cliente_id, servico_id),
  constraint cliente_servicos_periodo check (fim is null or fim >= inicio),
  constraint cliente_servicos_coerente check (
    case formato
      when 'recorrente' then dia_vencimento is not null
                         and parcelas is null
                         and entrega_em is null
                         and data_evento is null
      when 'projeto'    then parcelas is not null
                         and dia_vencimento is null
                         and data_evento is null
      when 'pontual'    then parcelas is not null
                         and dia_vencimento is null
    end
  )
);

comment on column public.cliente_servicos.dia_vencimento is
  'Ate 28 de proposito: 29, 30 e 31 nao existem em todo mes.';
comment on column public.cliente_servicos.data_evento is
  'So no formato pontual. A data da captacao, por exemplo.';

create index if not exists cliente_servicos_cliente_idx
  on public.cliente_servicos (cliente_id) where status = 'ativo';

drop trigger if exists cliente_servicos_atualizado_em on public.cliente_servicos;
create trigger cliente_servicos_atualizado_em
  before update on public.cliente_servicos
  for each row execute function public.tg_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- Chaves do contrato: ligam e desligam um modulo OPCIONAL deste servico.
-- Trafego pago e captacao inclusa dentro da Gestao Digital sao isto.
-- ---------------------------------------------------------------------------
create table if not exists public.cliente_servico_modulos (
  cliente_servico_id uuid not null references public.cliente_servicos(id) on delete cascade,
  modulo_id          uuid not null references public.modulos(id) on delete cascade,
  ligado             boolean not null,
  primary key (cliente_servico_id, modulo_id)
);

-- So modulo marcado como opcional na matriz pode ser sobrescrito. Modulo
-- obrigatorio desligado "na mao" seria um buraco silencioso no portao.
create or replace function public.tg_chave_so_em_modulo_opcional()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_opcional boolean;
begin
  select sm.opcional into v_opcional
    from public.cliente_servicos cs
    join public.servico_modulos sm
      on sm.servico_id = cs.servico_id and sm.modulo_id = new.modulo_id
   where cs.id = new.cliente_servico_id;

  if v_opcional is null then
    raise exception 'Este modulo nao pertence ao servico contratado.';
  elsif not v_opcional then
    raise exception 'Este modulo e obrigatorio no servico e nao pode ser desligado.';
  end if;
  return new;
end;
$$;

drop trigger if exists cliente_servico_modulos_opcional on public.cliente_servico_modulos;
create trigger cliente_servico_modulos_opcional
  before insert or update on public.cliente_servico_modulos
  for each row execute function public.tg_chave_so_em_modulo_opcional();

-- ---------------------------------------------------------------------------
-- Documentos do contrato. A proposta importada vira o contrato do primeiro dia.
-- ---------------------------------------------------------------------------
create table if not exists public.cliente_documentos (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  tipo        public.tipo_documento not null,
  nome        text not null check (length(btrim(nome)) > 0),
  caminho     text not null,
  enviado_por uuid references public.perfis(user_id) on delete set null,
  criado_em   timestamptz not null default now()
);

comment on column public.cliente_documentos.caminho is
  'Caminho no bucket privado do Storage. Nunca URL publica.';

create index if not exists cliente_documentos_cliente_idx
  on public.cliente_documentos (cliente_id, criado_em desc);

-- ---------------------------------------------------------------------------
-- O PORTAO. Vale na tela e no banco.
-- ---------------------------------------------------------------------------
create or replace function public.cliente_tem_modulo(p_cliente uuid, p_modulo text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- modulo que existe sempre, desde que haja ao menos um servico ativo
    exists (
      select 1
        from public.modulos m
       where m.chave = p_modulo and m.sempre
         and exists (select 1 from public.cliente_servicos cs
                      where cs.cliente_id = p_cliente and cs.status = 'ativo')
    )
    or
    -- modulo ligado por algum servico ativo, respeitando a chave do contrato
    exists (
      select 1
        from public.cliente_servicos cs
        join public.servico_modulos sm on sm.servico_id = cs.servico_id
        join public.modulos m          on m.id = sm.modulo_id
       where cs.cliente_id = p_cliente
         and cs.status = 'ativo'
         and m.chave = p_modulo
         and coalesce(
               (select o.ligado
                  from public.cliente_servico_modulos o
                 where o.cliente_servico_id = cs.id and o.modulo_id = m.id),
               not sm.opcional)
    );
$$;

create or replace function public.modulos_do_cliente(p_cliente uuid)
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.chave
    from public.modulos m
   where public.cliente_tem_modulo(p_cliente, m.chave)
   order by m.ordem;
$$;

revoke all on function public.cliente_tem_modulo(uuid, text)  from public, anon;
revoke all on function public.modulos_do_cliente(uuid)        from public, anon;
grant execute on function public.cliente_tem_modulo(uuid, text) to authenticated, service_role;
grant execute on function public.modulos_do_cliente(uuid)       to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS — equipe le; admin e operacao escrevem. Cliente entra na 0016.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cliente_servicos', 'cliente_servico_modulos', 'cliente_documentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);

    execute format('drop policy if exists %I on public.%I', t || '_le', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.usuario_ativo())',
      t || '_le', t);

    execute format('drop policy if exists %I on public.%I', t || '_escreve', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.usuario_edita()) with check (public.usuario_edita())',
      t || '_escreve', t);
  end loop;
end $$;
