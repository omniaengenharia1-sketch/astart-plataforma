-- =============================================================================
-- Modulo — 0019: plano de conteudo (o lado recorrente)
--
-- Seis clientes x dez pecas por mes e sessenta pecas. Criar uma a uma, abrindo
-- formulario sessenta vezes, e o que faz gente voltar para a planilha. O
-- sistema gera os slots nas datas certas; a pessoa preenche o miolo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Peca em rascunho pode nao ter titulo: e um slot vazio esperando o miolo.
-- Sair de rascunho sem titulo continua proibido.
-- ---------------------------------------------------------------------------
alter table public.posts alter column titulo_interno set default '';
alter table public.posts drop constraint if exists posts_titulo_interno_check;
alter table public.posts drop constraint if exists posts_titulo_fora_do_rascunho;
alter table public.posts add constraint posts_titulo_fora_do_rascunho
  check (status = 'rascunho' or length(btrim(titulo_interno)) > 0);

alter table public.posts add column if not exists ordem_feed smallint;

comment on column public.posts.ordem_feed is
  'Posicao no grid quando a equipe reordena. Nulo = ordena pela data.';

-- Toda peca tem um item de aprovacao, para a fila unica nao ter buraco.
create or replace function public.tg_post_cria_item()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if new.item_id is not null then
    return new;
  end if;
  insert into public.itens_aprovacao (cliente_id, tipo, estado, titulo)
  values (new.cliente_id, 'peca', 'produzindo',
          coalesce(nullif(btrim(new.titulo_interno), ''), 'Peça sem título'))
  returning id into v_id;
  new.item_id := v_id;
  return new;
end;
$$;

drop trigger if exists posts_cria_item on public.posts;
create trigger posts_cria_item
  before insert on public.posts
  for each row execute function public.tg_post_cria_item();

-- E o titulo da peca espelha no item, como no entregavel.
create or replace function public.tg_post_espelha_titulo()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.item_id is not null then
    update public.itens_aprovacao
       set titulo = coalesce(nullif(btrim(new.titulo_interno), ''), 'Peça sem título')
     where id = new.item_id
       and titulo is distinct from coalesce(nullif(btrim(new.titulo_interno), ''), 'Peça sem título');
  end if;
  return new;
end;
$$;

drop trigger if exists posts_espelha_titulo on public.posts;
create trigger posts_espelha_titulo
  after update of titulo_interno on public.posts
  for each row execute function public.tg_post_espelha_titulo();

-- ---------------------------------------------------------------------------
-- O plano: escopo contratado e em que dias esse cliente publica
-- ---------------------------------------------------------------------------
create table if not exists public.planos_conteudo (
  cliente_servico_id uuid primary key references public.cliente_servicos(id) on delete cascade,
  -- 0 = domingo ... 6 = sabado, como o extract(dow) do Postgres.
  dias_semana        smallint[] not null default '{1,3,5}',
  horario            time not null default '12:00',
  posts_por_mes      smallint not null default 8  check (posts_por_mes  >= 0),
  reels_por_mes      smallint not null default 2  check (reels_por_mes  >= 0),
  atualizado_em      timestamptz not null default now(),
  constraint planos_conteudo_dias_validos check (
    array_length(dias_semana, 1) between 1 and 7
    and dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]
  )
);

comment on column public.planos_conteudo.dias_semana is
  '0 = domingo ... 6 = sabado, igual ao extract(dow). Evita traduzir no meio.';

drop trigger if exists planos_conteudo_atualizado_em on public.planos_conteudo;
create trigger planos_conteudo_atualizado_em
  before update on public.planos_conteudo
  for each row execute function public.tg_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- Banco de ideias — alimentado pela rotina das 9h
-- ---------------------------------------------------------------------------
create table if not exists public.ideias (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  titulo     text not null check (length(btrim(titulo)) > 0),
  -- Por que esta ideia apareceu: "subiu em buscas", "pergunta recorrente".
  motivo     text,
  origem     text not null default 'rotina',
  post_id    uuid references public.posts(id) on delete set null,
  usada_em   timestamptz,
  descartada_em timestamptz,
  criado_em  timestamptz not null default now(),
  constraint ideias_uso_coerente check ((post_id is null) = (usada_em is null)),
  constraint ideias_usada_ou_descartada check (usada_em is null or descartada_em is null)
);

comment on table public.ideias is
  'Entra sempre como rascunho. Ideia nunca vira post publicado sozinha.';

create index if not exists ideias_abertas_idx
  on public.ideias (cliente_id, criado_em desc)
  where usada_em is null and descartada_em is null;

-- ---------------------------------------------------------------------------
-- gerar_slots — cria as pecas vazias nas datas do plano
--
-- Todas nascem como 'imagem'. Qual delas vira reels e decisao de quem planeja,
-- nao do calendario: o sistema nao adivinha isso.
-- ---------------------------------------------------------------------------
create or replace function public.gerar_slots(
  p_cliente_servico_id uuid,
  p_mes                date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plano   public.planos_conteudo;
  v_cliente uuid;
  v_fuso    text;
  v_total   smallint;
  v_inicio  date := date_trunc('month', p_mes)::date;
  v_fim     date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_criados integer := 0;
  -- Pecas que o mes ja tem. Sem contar com elas, regerar passa do escopo.
  v_existentes integer := 0;
  v_dia     date;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para gerar o mes.';
  end if;

  select * into v_plano from public.planos_conteudo
   where cliente_servico_id = p_cliente_servico_id;
  if v_plano.cliente_servico_id is null then
    raise exception 'Este contrato ainda nao tem plano de conteudo.';
  end if;

  select cs.cliente_id, c.fuso_horario into v_cliente, v_fuso
    from public.cliente_servicos cs
    join public.clientes c on c.id = cs.cliente_id
   where cs.id = p_cliente_servico_id;

  v_total := v_plano.posts_por_mes + v_plano.reels_por_mes;

  select count(*) into v_existentes
    from public.posts p
   where p.cliente_id = v_cliente
     and p.agendado_para >= (v_inicio::timestamp at time zone v_fuso)
     and p.agendado_para <  ((v_fim + 1)::timestamp at time zone v_fuso);

  for v_dia in select d::date from generate_series(v_inicio, v_fim, interval '1 day') d loop
    exit when v_existentes + v_criados >= v_total;
    continue when not (extract(dow from v_dia)::smallint = any (v_plano.dias_semana));

    -- Nao duplica slot num horario que ja tem peca.
    continue when exists (
      select 1 from public.posts p
       where p.cliente_id = v_cliente
         and p.agendado_para = ((v_dia + v_plano.horario) at time zone v_fuso));

    insert into public.posts (cliente_id, tipo, agendado_para, status, criado_por)
    values (v_cliente, 'imagem',
            (v_dia + v_plano.horario) at time zone v_fuso,
            'rascunho', auth.uid());
    v_criados := v_criados + 1;
  end loop;

  return v_criados;
end;
$$;

revoke all on function public.gerar_slots(uuid, date) from public, anon;
grant execute on function public.gerar_slots(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['planos_conteudo', 'ideias'] loop
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

-- O banco de ideias e trabalho interno: o cliente nao ve.
comment on column public.ideias.origem is
  'rotina (as 9h), equipe, ou cliente. Nenhuma politica expoe isto ao portal.';
