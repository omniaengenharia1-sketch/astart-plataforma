-- =============================================================================
-- 0078 — compromissos: a agenda deixa de ser so vitrine
--
-- A dona: "pq nao consigo colocar coisas na agenda, vc precisa fazer a agenda
-- estilo calendário. CALENDÁRIO BRASILEIRO".
--
-- A Agenda mostrava quatro coisas — peca agendada, captacao, marco e cobranca
-- — e TODAS nascem em outro modulo. Nao havia nenhuma tabela de compromisso
-- avulso: reuniao, gravacao, visita, feriado. Entao a tela era uma vitrine do
-- que outros modulos tinham criado, e a palavra "agenda" prometia uma coisa
-- que o sistema nao fazia.
--
-- Esta migration cria a tabela que faltava.
--
-- AS COLUNAS DO GOOGLE JA NASCEM AQUI, vazias.
--
-- A dona pediu a agenda "integrada no google agenda", nos DOIS sentidos e com
-- a conta de CADA pessoa da equipe. Essa ponte e a fase 2 — precisa de projeto
-- no Google Cloud, consentimento por pessoa e token guardado no Vault. Mas as
-- colunas entram agora porque acrescentar `google_event_id` depois obrigaria
-- a mexer na tabela ja com dados dentro, e porque sem elas o primeiro
-- compromisso criado aqui nao teria como ser reconhecido la depois.
--
-- A chave da ida e volta e o indice unico `(google_calendar_id,
-- google_event_id)`: e ele que impede que uma sincronizacao repetida crie o
-- mesmo compromisso duas vezes. Idempotencia acima de tudo — o pior bug
-- possivel desta ponte e a agenda da dona encher de duplicatas.
-- =============================================================================

create table if not exists public.compromissos (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null check (length(btrim(titulo)) > 0),

  -- Toda data em timestamptz, com o fuso guardado SEPARADO para renderizar.
  -- O fuso e o do compromisso, nao o do navegador de quem esta olhando: uma
  -- gravacao marcada para as 9h em Sao Paulo continua as 9h em Sao Paulo
  -- quando a dona abre a tela de outro lugar.
  quando         timestamptz not null,
  termina_em     timestamptz,
  fuso           text not null default 'America/Sao_Paulo',
  -- Dia inteiro: a hora nao importa (feriado, viagem, prazo). A tela mostra
  -- so o dia, e a ponte com o Google manda como `date` em vez de `dateTime`.
  dia_inteiro    boolean not null default false,

  cliente_id     uuid references public.clientes(id) on delete set null,
  responsavel_id uuid references public.perfis(user_id) on delete set null,
  local          text,
  observacao     text,

  -- ---- a ponte com o Google (fase 2), vazia por enquanto ----
  google_event_id      text,
  google_calendar_id   text,
  /** Quando esta linha foi conferida com o Google pela ultima vez. */
  google_sincronizado_em timestamptz,
  /** De que lado o compromisso nasceu. Decide quem ganha num conflito. */
  origem         text not null default 'astart'
                 check (origem in ('astart', 'google')),

  criado_por     uuid references public.perfis(user_id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  constraint compromissos_periodo check (termina_em is null or termina_em > quando),
  -- Id do Google so faz sentido com a agenda a que ele pertence: o mesmo id
  -- pode existir em duas agendas diferentes.
  constraint compromissos_google_completo check (
    (google_event_id is null) = (google_calendar_id is null))
);

comment on table public.compromissos is
  'O que a equipe marca na mao. Os outros quatro tipos da Agenda nascem nos '
  'modulos deles; este e o unico que a propria Agenda cria.';

-- IDEMPOTENCIA DA PONTE: um evento do Google entra uma vez so.
create unique index if not exists compromissos_google_idx
  on public.compromissos (google_calendar_id, google_event_id)
  where google_event_id is not null;

create index if not exists compromissos_quando_idx
  on public.compromissos (quando);

drop trigger if exists compromissos_atualizado_em on public.compromissos;
create trigger compromissos_atualizado_em
  before update on public.compromissos
  for each row execute function public.tg_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- RLS — a agenda interna e da equipe. Cliente nao entra.
--
-- "eu quero que apenas eu que tenho acesso proprietario possa ver a parte
-- financeira" vale para o dinheiro; a agenda e da equipe inteira, porque e
-- com ela que a equipe se organiza. O que NAO pode e o cliente ver a agenda
-- da agencia — onde aparece o nome dos outros clientes.
--
-- SEJA HONESTO SOBRE O QUE SEGURA O QUE: quem de fato mantem o cliente fora
-- daqui e o `usuario_ativo()`, porque o banco ja recusa que uma pessoa seja
-- cliente E equipe ao mesmo tempo (tentei montar o caso no teste 48 e levei
-- "Este usuario ja tem acesso de cliente e nao pode entrar na equipe"). O
-- `not usuario_cliente()` abaixo e trava sobre porta fechada: fica como
-- defesa para o dia em que aquela exclusividade mudar, e nao porque exista
-- um buraco hoje.
-- ---------------------------------------------------------------------------
alter table public.compromissos enable row level security;
revoke all on public.compromissos from anon;

drop policy if exists compromissos_equipe_le on public.compromissos;
create policy compromissos_equipe_le on public.compromissos
  for select to authenticated
  using (public.usuario_ativo() and not public.usuario_cliente());

-- Escrita so pelas funcoes abaixo, que sao security definer. Nada de tabela
-- aberta "por enquanto".

-- ---------------------------------------------------------------------------
-- CRIAR
--
-- `p_quando` chega como data + hora LOCAL e o fuso vem junto, em vez de um
-- timestamptz ja resolvido pelo navegador. Resolver no navegador significa
-- gravar o fuso de quem digitou, e nao o do compromisso.
-- ---------------------------------------------------------------------------
create or replace function public.criar_compromisso(
  p_titulo      text,
  p_quando      timestamptz,
  p_termina_em  timestamptz default null,
  p_dia_inteiro boolean default false,
  p_cliente     uuid default null,
  p_responsavel uuid default null,
  p_local       text default null,
  p_observacao  text default null,
  p_fuso        text default 'America/Sao_Paulo'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para marcar na agenda.';
  end if;
  if p_titulo is null or length(btrim(p_titulo)) = 0 then
    raise exception 'O compromisso precisa de um titulo.';
  end if;
  if p_quando is null then
    raise exception 'O compromisso precisa de uma data.';
  end if;
  if p_termina_em is not null and p_termina_em <= p_quando then
    raise exception 'O fim do compromisso tem de ser depois do comeco.';
  end if;
  if p_cliente is not null
     and not exists (select 1 from public.clientes where id = p_cliente) then
    raise exception 'Cliente nao encontrado.';
  end if;

  insert into public.compromissos
    (titulo, quando, termina_em, dia_inteiro, fuso, cliente_id, responsavel_id,
     local, observacao, criado_por)
  values
    (btrim(p_titulo), p_quando, p_termina_em, coalesce(p_dia_inteiro, false),
     coalesce(nullif(btrim(p_fuso), ''), 'America/Sao_Paulo'),
     p_cliente, p_responsavel,
     nullif(btrim(coalesce(p_local, '')), ''),
     nullif(btrim(coalesce(p_observacao, '')), ''),
     auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.criar_compromisso(
  text, timestamptz, timestamptz, boolean, uuid, uuid, text, text, text)
  from public, anon;
grant execute on function public.criar_compromisso(
  text, timestamptz, timestamptz, boolean, uuid, uuid, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- EDITAR — a convencao de sempre: nulo e "nao mexe", `p_limpar` apaga
-- ---------------------------------------------------------------------------
create or replace function public.editar_compromisso(
  p_compromisso uuid,
  p_titulo      text default null,
  p_quando      timestamptz default null,
  p_termina_em  timestamptz default null,
  p_dia_inteiro boolean default null,
  p_cliente     uuid default null,
  p_responsavel uuid default null,
  p_local       text default null,
  p_observacao  text default null,
  p_limpar      text[] default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limpar text[] := coalesce(p_limpar, array[]::text[]);
  v_ini timestamptz;
  v_fim timestamptz;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para mexer na agenda.';
  end if;
  if p_titulo is not null and length(btrim(p_titulo)) = 0 then
    raise exception 'O compromisso precisa de um titulo.';
  end if;

  -- O periodo e conferido com os valores que VAO FICAR, nao so com os que
  -- vieram: mudar so o comeco para depois do fim tem de ser recusado.
  select coalesce(p_quando, quando),
         case when 'fim' = any (v_limpar) then null
              else coalesce(p_termina_em, termina_em) end
    into v_ini, v_fim
    from public.compromissos where id = p_compromisso;
  if v_ini is null then raise exception 'Compromisso nao encontrado.'; end if;
  if v_fim is not null and v_fim <= v_ini then
    raise exception 'O fim do compromisso tem de ser depois do comeco.';
  end if;

  update public.compromissos set
    titulo         = coalesce(nullif(btrim(coalesce(p_titulo, '')), ''), titulo),
    quando         = coalesce(p_quando, quando),
    termina_em     = case when 'fim' = any (v_limpar) then null
                          else coalesce(p_termina_em, termina_em) end,
    dia_inteiro    = coalesce(p_dia_inteiro, dia_inteiro),
    cliente_id     = case when 'cliente' = any (v_limpar) then null
                          else coalesce(p_cliente, cliente_id) end,
    responsavel_id = case when 'responsavel' = any (v_limpar) then null
                          else coalesce(p_responsavel, responsavel_id) end,
    local          = case when 'local' = any (v_limpar) then null
                          else coalesce(nullif(btrim(coalesce(p_local, '')), ''), local) end,
    observacao     = case when 'observacao' = any (v_limpar) then null
                          else coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao) end
  where id = p_compromisso;

  if not found then raise exception 'Compromisso nao encontrado.'; end if;
end;
$$;

revoke all on function public.editar_compromisso(
  uuid, text, timestamptz, timestamptz, boolean, uuid, uuid, text, text, text[])
  from public, anon;
grant execute on function public.editar_compromisso(
  uuid, text, timestamptz, timestamptz, boolean, uuid, uuid, text, text, text[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- APAGAR
--
-- Compromisso nao guarda historico de ninguem: desmarcou, desmarcou. Entao
-- apagar e de quem edita, e nao so da direcao — ao contrario de lead e de
-- lancamento, que sao memoria da agencia.
-- ---------------------------------------------------------------------------
create or replace function public.apagar_compromisso(p_compromisso uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para mexer na agenda.';
  end if;
  delete from public.compromissos where id = p_compromisso;
  if not found then raise exception 'Compromisso nao encontrado.'; end if;
end;
$$;

revoke all on function public.apagar_compromisso(uuid) from public, anon;
grant execute on function public.apagar_compromisso(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A AGENDA, agora com cinco tipos
--
-- Mudancas em relacao a versao da 0036:
--
--   1. entra `compromisso`, o unico tipo que a propria Agenda cria;
--   2. todo evento passa a ter `id` e `editavel`. Sem id a tela nao tem como
--      abrir o compromisso para corrigir; e `editavel` diz, do banco, quais
--      linhas a tela pode oferecer para mexer — os outros quatro pertencem
--      ao modulo que os criou, e editar peca agendada aqui seria mentir;
--   3. `hora` vem separada, porque o calendario de mes mostra "14:00 Reuniao"
--      dentro do quadradinho do dia, e dia inteiro nao mostra hora nenhuma.
--
-- O corpo dos quatro tipos antigos veio IGUAL da 0036, so com os campos
-- novos acrescentados — `create or replace` troca o corpo inteiro, entao
-- recriar so a parte nova nao e uma opcao.
-- ---------------------------------------------------------------------------
create or replace function public.agenda(
  p_de  date default current_date,
  p_ate date default (current_date + 30)
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ativo() then null::jsonb else
    coalesce((
      select jsonb_agg(x order by x->>'quando', x->>'hora', x->>'oQue') from (

        select jsonb_build_object(
          'tipo', 'publicacao', 'id', p.id::text,
          'quando', (p.agendado_para at time zone c.fuso_horario)::date,
          'hora', to_char(p.agendado_para at time zone c.fuso_horario, 'HH24:MI'),
          'clienteNome', c.nome, 'clienteId', c.id, 'oQue', p.titulo_interno,
          'detalhe', p.tipo::text, 'editavel', false) as x
          from public.posts p join public.clientes c on c.id = p.cliente_id
         where p.agendado_para is not null
           and (p.agendado_para at time zone c.fuso_horario)::date between p_de and p_ate

        union all
        select jsonb_build_object(
          'tipo', 'captacao', 'id', s.id::text, 'quando', s.data, 'hora', null,
          'clienteNome', c.nome, 'clienteId', c.id,
          'oQue', s.titulo, 'detalhe', coalesce(s.local, ''), 'editavel', false)
          from public.sessoes_captacao s join public.clientes c on c.id = s.cliente_id
         where s.data between p_de and p_ate

        union all
        select jsonb_build_object(
          'tipo', 'marco', 'id', m.id::text, 'quando', m.prazo, 'hora', null,
          'clienteNome', c.nome, 'clienteId', c.id,
          'oQue', m.titulo, 'detalhe', sv.nome, 'editavel', false)
          from public.marcos m
          join public.cliente_servicos cs on cs.id = m.cliente_servico_id
          join public.servicos sv on sv.id = cs.servico_id
          join public.clientes c on c.id = cs.cliente_id
         where m.prazo between p_de and p_ate and m.concluido_em is null

        union all
        select jsonb_build_object(
          'tipo', 'cobranca', 'id', v.id::text, 'quando', v.vencimento, 'hora', null,
          'clienteNome', c.nome, 'clienteId', c.id,
          'oQue', v.descricao, 'detalhe', v.situacao, 'editavel', false)
          from public.lancamentos_com_situacao v
          join public.clientes c on c.id = v.cliente_id
         where v.vencimento between p_de and p_ate and v.natureza = 'receita'
           and v.situacao in ('previsto', 'atrasado')

        union all
        -- O UNICO QUE A AGENDA CRIA, e o unico editavel daqui.
        select jsonb_build_object(
          'tipo', 'compromisso', 'id', k.id::text,
          'quando', (k.quando at time zone k.fuso)::date,
          'hora', case when k.dia_inteiro then null
                       else to_char(k.quando at time zone k.fuso, 'HH24:MI') end,
          'clienteNome', cc.nome, 'clienteId', cc.id,
          'oQue', k.titulo,
          'detalhe', coalesce(nullif(k.local, ''), coalesce(pf.nome, '')),
          'editavel', public.usuario_edita())
          from public.compromissos k
          left join public.clientes cc on cc.id = k.cliente_id
          left join public.perfis    pf on pf.user_id = k.responsavel_id
         where not public.usuario_cliente()
           and (k.quando at time zone k.fuso)::date between p_de and p_ate
      ) y), '[]'::jsonb)
  end;
$$;

-- ---------------------------------------------------------------------------
-- UM COMPROMISSO SO, para a tela abrir e corrigir
--
-- A agenda devolve o que o calendario MOSTRA. Para editar, a tela precisa dos
-- campos que o formulario tem — hora de inicio e fim separadas, no fuso do
-- compromisso, e os ids de cliente e responsavel.
-- ---------------------------------------------------------------------------
create or replace function public.compromisso(p_compromisso uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ativo() or public.usuario_cliente() then null::jsonb
    else (
      select jsonb_build_object(
        'id', k.id::text,
        'titulo', k.titulo,
        'dia', to_char(k.quando at time zone k.fuso, 'YYYY-MM-DD'),
        'hora', case when k.dia_inteiro then null
                     else to_char(k.quando at time zone k.fuso, 'HH24:MI') end,
        'horaFim', case when k.dia_inteiro or k.termina_em is null then null
                        else to_char(k.termina_em at time zone k.fuso, 'HH24:MI') end,
        'diaInteiro', k.dia_inteiro,
        'fuso', k.fuso,
        'clienteId', k.cliente_id,
        'responsavelId', k.responsavel_id,
        'local', k.local,
        'observacao', k.observacao,
        'origem', k.origem,
        'noGoogle', k.google_event_id is not null)
        from public.compromissos k where k.id = p_compromisso)
  end;
$$;

revoke all on function public.compromisso(uuid) from public, anon;
grant execute on function public.compromisso(uuid) to authenticated, service_role;
