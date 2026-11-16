-- 0065 — o quadro de tarefas.
--
-- Pedido da dona: "uma area de to do, tipo um kanban estilo trello que a gente
-- colocaria o que tem pra fazer... e que a gente possa conectar com outra
-- pessoa, por exemplo: fazer criativo - responsavel: raquel".
--
-- Nao existia nada de tarefa no sistema. A Fila mostra peca de conteudo indo
-- ao ar; nao ha onde escrever "fazer criativo pra tal cliente ate sexta".
--
-- AS TRES DECISOES DELA, E O QUE CADA UMA VIROU NO SCHEMA
--
-- 1. "editaveis" — as colunas sao linhas de tabela, nao enum. Enum obrigaria
--    migration para renomear uma coluna, o que e o oposto de editavel.
--
--    As colunas sao DA AGENCIA, nao de cada pessoa. Sao tres pessoas no mesmo
--    fluxo: se cada uma tivesse as suas, uma tarefa atribuida a outra nao
--    saberia em que coluna cair. Coluna e o vocabulario comum do trabalho; o
--    que e de cada um sao os cartoes.
--
-- 2. "cada ve o seu e se a pessoa quiser mencionar a outra, a outra ve o que
--    foi mencionado" — a visibilidade de um cartao e: sou o responsavel, OU
--    eu criei, OU fui mencionado. Direcao ve tudo, porque quem toca a agencia
--    precisa enxergar o todo.
--
--    A mencao e tabela propria e nao uma coluna de texto. Mencao escrita no
--    corpo ("falar com a @raquel") nao da para consultar, nao sobrevive a
--    troca de nome, e nao serve de gatilho para aviso nenhum.
--
-- 3. "faz primeiro o kanban e depois o email" — `tarefa_avisos` ja nasce aqui,
--    com `enviado_em` nulo. O aviso fica REGISTRADO desde hoje; o envio liga
--    depois, e quando ligar os pendentes saem. Assim nada se perde no meio, e
--    o dia em que o email quebrar a fila fica visivel em vez de sumir.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- As colunas
-- ---------------------------------------------------------------------------
create table if not exists public.tarefa_colunas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(btrim(nome)) between 1 and 40),
  ordem      integer not null,
  -- A coluna que significa "acabou". E dela que sai o `concluido_em` do
  -- cartao, e e ela que a tela pode recolher. Sem isto, "Feito" seria uma
  -- coluna como outra qualquer e o sistema nunca saberia o que foi entregue.
  final      boolean not null default false,
  criado_em  timestamptz not null default now()
);

alter table public.tarefa_colunas enable row level security;

-- ---------------------------------------------------------------------------
-- Os cartoes
-- ---------------------------------------------------------------------------
create table if not exists public.tarefas (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null check (length(btrim(titulo)) between 1 and 200),
  detalhe        text,
  coluna_id      uuid not null references public.tarefa_colunas(id) on delete restrict,
  ordem          integer not null default 0,

  -- De quem e a tarefa. Nulo = ninguem pegou ainda, e aparece para quem criou.
  responsavel_id uuid references public.perfis(user_id) on delete set null,
  -- De qual cliente, quando for de algum. "Fazer criativo" quase sempre e.
  cliente_id     uuid references public.clientes(id) on delete set null,
  -- E por aqui que a tela filtra semana e mes. Um quadro por semana criaria
  -- tarefa orfa toda segunda-feira.
  prazo          date,

  criado_por     uuid not null references public.perfis(user_id),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  concluido_em   timestamptz
);

create index if not exists tarefas_coluna_ordem on public.tarefas (coluna_id, ordem);
create index if not exists tarefas_responsavel  on public.tarefas (responsavel_id);
create index if not exists tarefas_prazo        on public.tarefas (prazo);

alter table public.tarefas enable row level security;

-- ---------------------------------------------------------------------------
-- As mencoes
-- ---------------------------------------------------------------------------
create table if not exists public.tarefa_mencoes (
  tarefa_id  uuid not null references public.tarefas(id) on delete cascade,
  perfil_id  uuid not null references public.perfis(user_id) on delete cascade,
  por_id     uuid references public.perfis(user_id) on delete set null,
  criado_em  timestamptz not null default now(),
  primary key (tarefa_id, perfil_id)
);

alter table public.tarefa_mencoes enable row level security;

-- ---------------------------------------------------------------------------
-- Os avisos
--
-- Uma LINHA por aviso, com `enviado_em` nulo ate sair. Nao e log: e fila.
--
-- Duas regras do projeto moram nesta tabela. Idempotencia: a chave unica
-- impede avisar a mesma pessoa duas vezes da mesma coisa, mesmo que a tela
-- chame duas vezes. E falha silenciosa e proibida: quando o envio falhar,
-- `erro` guarda o motivo e a tela mostra, em vez de o aviso evaporar.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.tipo_aviso_tarefa as enum ('atribuida', 'mencionada');
exception when duplicate_object then null; end $$;

create table if not exists public.tarefa_avisos (
  id         uuid primary key default gen_random_uuid(),
  tarefa_id  uuid not null references public.tarefas(id) on delete cascade,
  para_id    uuid not null references public.perfis(user_id) on delete cascade,
  tipo       public.tipo_aviso_tarefa not null,
  enviado_em timestamptz,
  erro       text,
  criado_em  timestamptz not null default now(),
  unique (tarefa_id, para_id, tipo)
);

create index if not exists tarefa_avisos_pendentes
  on public.tarefa_avisos (criado_em) where enviado_em is null;

alter table public.tarefa_avisos enable row level security;

-- ---------------------------------------------------------------------------
-- Quem ve um cartao
--
-- Em funcao, e nao repetida em cada politica: sao quatro tabelas perguntando a
-- mesma coisa, e quatro copias e como uma delas fica para tras.
-- ---------------------------------------------------------------------------
create or replace function public.usuario_ve_tarefa(p_tarefa uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.usuario_admin()
      or exists (
           select 1 from public.tarefas t
            where t.id = p_tarefa
              and (t.responsavel_id = auth.uid() or t.criado_por = auth.uid())
         )
      or exists (
           select 1 from public.tarefa_mencoes m
            where m.tarefa_id = p_tarefa and m.perfil_id = auth.uid()
         );
$$;

revoke all on function public.usuario_ve_tarefa(uuid) from public, anon;
grant execute on function public.usuario_ve_tarefa(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Cliente nao entra em nada disto: o quadro e trabalho interno da agencia, e
-- `usuario_ativo()` e falso para quem e do portal do cliente.
-- ---------------------------------------------------------------------------

-- Colunas: toda a equipe ve e mexe. Sao o vocabulario comum.
create policy tarefa_colunas_le on public.tarefa_colunas
  for select using (public.usuario_ativo());
create policy tarefa_colunas_escreve on public.tarefa_colunas
  for all using (public.usuario_edita()) with check (public.usuario_edita());

-- Cartoes: cada um ve o seu, mais o que foi mencionado. Direcao ve tudo.
create policy tarefas_le on public.tarefas
  for select using (public.usuario_ve_tarefa(id));
create policy tarefas_cria on public.tarefas
  for insert with check (public.usuario_edita() and criado_por = auth.uid());
create policy tarefas_muda on public.tarefas
  for update using (public.usuario_ve_tarefa(id))
          with check (public.usuario_ve_tarefa(id));
-- Apagar e so de quem criou, ou da direcao. Quem recebeu a tarefa pode
-- move-la e marcar feita; sumir com o pedido de outra pessoa, nao.
create policy tarefas_apaga on public.tarefas
  for delete using (public.usuario_admin() or criado_por = auth.uid());

-- Mencoes: ve quem ve o cartao; cria quem ve o cartao.
create policy tarefa_mencoes_le on public.tarefa_mencoes
  for select using (public.usuario_ve_tarefa(tarefa_id));
create policy tarefa_mencoes_escreve on public.tarefa_mencoes
  for all using (public.usuario_ve_tarefa(tarefa_id))
          with check (public.usuario_ve_tarefa(tarefa_id));

-- Avisos: cada um ve os seus; a direcao ve todos, para saber o que nao saiu.
create policy tarefa_avisos_le on public.tarefa_avisos
  for select using (public.usuario_admin() or para_id = auth.uid());
-- Quem escreve e o service_role (a funcao que enviar), nao o navegador.
create policy tarefa_avisos_servico on public.tarefa_avisos
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- As quatro colunas do primeiro dia
--
-- Quadro vazio nao ensina nada: a pessoa abre, ve nada e fecha. Estas quatro
-- sao o fluxo da agencia e podem ser renomeadas, reordenadas ou apagadas —
-- sao dados, nao codigo.
-- ---------------------------------------------------------------------------
insert into public.tarefa_colunas (nome, ordem, final)
select * from (values
  ('A fazer',       1, false),
  ('Fazendo',       2, false),
  ('Em aprovação',  3, false),
  ('Feito',         4, true)
) as v(nome, ordem, final)
where not exists (select 1 from public.tarefa_colunas);

-- ---------------------------------------------------------------------------
-- O quadro: colunas + os cartoes que EU posso ver
--
-- Uma chamada so. O RLS ja decide o que entra, entao a tela nao filtra nada —
-- filtrar no navegador seria confiar no navegador.
--
-- `p_de`/`p_ate` sao o filtro de semana e mes. Cartao SEM prazo entra sempre:
-- "sem data" nao e "fora do periodo", e some-lo do filtro faria tarefa
-- desaparecer sem ninguem entender por que.
-- ---------------------------------------------------------------------------
create or replace function public.quadro_de_tarefas(
  p_de  date default null,
  p_ate date default null
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ativo() then null::jsonb else
    jsonb_build_object(
      'colunas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'nome', c.nome, 'ordem', c.ordem, 'final', c.final)
                 order by c.ordem, c.criado_em)
          from public.tarefa_colunas c), '[]'::jsonb),
      'tarefas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id,
                 'titulo', t.titulo,
                 'detalhe', t.detalhe,
                 'colunaId', t.coluna_id,
                 'ordem', t.ordem,
                 'prazo', t.prazo,
                 'concluidoEm', t.concluido_em,
                 'responsavelId', t.responsavel_id,
                 'responsavel', pr.nome,
                 'criadoPor', t.criado_por,
                 'criadoPorNome', pc.nome,
                 'clienteId', t.cliente_id,
                 'cliente', cl.nome,
                 'mencionados', coalesce((
                   select jsonb_agg(jsonb_build_object('id', pm.user_id, 'nome', pm.nome)
                          order by pm.nome)
                     from public.tarefa_mencoes m
                     join public.perfis pm on pm.user_id = m.perfil_id
                    where m.tarefa_id = t.id), '[]'::jsonb))
                 order by t.ordem, t.criado_em)
          from public.tarefas t
          left join public.perfis   pr on pr.user_id = t.responsavel_id
          left join public.perfis   pc on pc.user_id = t.criado_por
          left join public.clientes cl on cl.id = t.cliente_id
         where (p_de  is null or t.prazo is null or t.prazo >= p_de)
           and (p_ate is null or t.prazo is null or t.prazo <= p_ate)), '[]'::jsonb)
    )
  end;
$$;

revoke all on function public.quadro_de_tarefas(date, date) from public, anon;
grant execute on function public.quadro_de_tarefas(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Criar uma tarefa
--
-- O aviso nasce JUNTO, na mesma transacao. Separar em duas chamadas deixaria
-- a tarefa existindo sem ninguem avisado quando a segunda falhasse — que e o
-- caso em que avisar mais importa.
-- ---------------------------------------------------------------------------
create or replace function public.criar_tarefa(
  p_titulo      text,
  p_coluna      uuid default null,
  p_responsavel uuid default null,
  p_cliente     uuid default null,
  p_prazo       date default null,
  p_detalhe     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_coluna uuid := p_coluna;
  v_id     uuid;
  v_ordem  integer;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para criar tarefa.';
  end if;
  if length(btrim(coalesce(p_titulo, ''))) = 0 then
    raise exception 'A tarefa precisa de um titulo.';
  end if;

  -- Sem coluna dita, vai para a primeira. A tela manda; a API nao exige.
  if v_coluna is null then
    select id into v_coluna from public.tarefa_colunas order by ordem, criado_em limit 1;
  end if;
  if v_coluna is null then
    raise exception 'Nao ha nenhuma coluna no quadro.';
  end if;

  -- No fim da coluna.
  select coalesce(max(ordem), 0) + 1 into v_ordem
    from public.tarefas where coluna_id = v_coluna;

  insert into public.tarefas
    (titulo, detalhe, coluna_id, ordem, responsavel_id, cliente_id, prazo, criado_por)
  values (btrim(p_titulo), nullif(btrim(coalesce(p_detalhe, '')), ''), v_coluna, v_ordem,
          p_responsavel, p_cliente, p_prazo, auth.uid())
  returning id into v_id;

  -- Avisar quem recebeu — menos quando a pessoa criou para si mesma, que
  -- seria mandar email para o proprio remetente.
  if p_responsavel is not null and p_responsavel <> auth.uid() then
    insert into public.tarefa_avisos (tarefa_id, para_id, tipo)
    values (v_id, p_responsavel, 'atribuida')
    on conflict do nothing;
  end if;

  return v_id;
end;
$$;

revoke all on function public.criar_tarefa(text, uuid, uuid, uuid, date, text) from public, anon;
grant execute on function public.criar_tarefa(text, uuid, uuid, uuid, date, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Mover o cartao — o arrastar do kanban
--
-- Renumera a coluna de destino inteira, em vez de tentar encaixar o cartao
-- entre dois numeros. Quadro de agencia tem dezenas de cartoes, nao milhares:
-- renumerar e barato e nao acumula o erro de arredondamento que a conta "meio
-- caminho entre o de cima e o de baixo" acumula depois de muitos arrastes.
--
-- `concluido_em` acompanha a coluna final: entrou, marca a hora; saiu, apaga.
-- Sem isto, uma tarefa reaberta continuaria contando como entregue.
-- ---------------------------------------------------------------------------
create or replace function public.mover_tarefa(
  p_tarefa uuid,
  p_coluna uuid,
  p_para   integer default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_final boolean;
  v_pos   integer;
begin
  if not public.usuario_ve_tarefa(p_tarefa) then
    raise exception 'Esta tarefa nao e sua.';
  end if;
  if not exists (select 1 from public.tarefa_colunas where id = p_coluna) then
    raise exception 'Coluna nao encontrada.';
  end if;

  v_pos := greatest(coalesce(p_para, 999999), 1);

  -- ESPALHA os vizinhos de 10 em 10 ANTES de encaixar.
  --
  -- Sem isto a conta nao fecha: com os vizinhos em 1,2,3,4, pedir a posicao 1
  -- dava `1*10-5 = 5`, que ordena DEPOIS de todos — o cartao ia para o fim
  -- justamente quando se pedia o comeco. Espalhados em 10,20,30,40, o 5 cai
  -- antes do primeiro, que e o que "posicao 1" quer dizer.
  with espalha as (
    select id, row_number() over (order by ordem, criado_em) * 10 as n
      from public.tarefas where coluna_id = p_coluna and id <> p_tarefa
  )
  update public.tarefas t set ordem = espalha.n from espalha where espalha.id = t.id;

  update public.tarefas
     set coluna_id = p_coluna,
         ordem = v_pos * 10 - 5,
         atualizado_em = now()
   where id = p_tarefa;

  select final into v_final from public.tarefa_colunas where id = p_coluna;
  update public.tarefas
     set concluido_em = case when v_final then coalesce(concluido_em, now()) else null end
   where id = p_tarefa;

  -- Renumera 1, 2, 3... na coluna de destino.
  with nova as (
    select id, row_number() over (order by ordem, atualizado_em) as n
      from public.tarefas where coluna_id = p_coluna
  )
  update public.tarefas t set ordem = nova.n
    from nova where nova.id = t.id and t.ordem <> nova.n;
end;
$$;

revoke all on function public.mover_tarefa(uuid, uuid, integer) from public, anon;
grant execute on function public.mover_tarefa(uuid, uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Editar — e o aviso quando o responsavel MUDA
--
-- Trocar o responsavel de uma tarefa que ja existe e tao "chega para ela"
-- quanto criar ja atribuida. Era o buraco obvio: criar avisava, passar
-- adiante nao.
-- ---------------------------------------------------------------------------
create or replace function public.editar_tarefa(
  p_tarefa      uuid,
  p_titulo      text default null,
  p_detalhe     text default null,
  p_responsavel uuid default null,
  p_cliente     uuid default null,
  p_prazo       date default null,
  p_limpar      text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antes uuid;
begin
  if not public.usuario_ve_tarefa(p_tarefa) then
    raise exception 'Esta tarefa nao e sua.';
  end if;

  select responsavel_id into v_antes from public.tarefas where id = p_tarefa;

  -- `p_limpar` existe porque nulo aqui quer dizer "nao mexe". Sem ele nao
  -- haveria como TIRAR o responsavel, o cliente ou o prazo de uma tarefa.
  update public.tarefas
     set titulo         = coalesce(nullif(btrim(coalesce(p_titulo, '')), ''), titulo),
         detalhe        = case when 'detalhe' = any(p_limpar) then null
                               else coalesce(nullif(btrim(coalesce(p_detalhe, '')), ''), detalhe) end,
         responsavel_id = case when 'responsavel' = any(p_limpar) then null
                               else coalesce(p_responsavel, responsavel_id) end,
         cliente_id     = case when 'cliente' = any(p_limpar) then null
                               else coalesce(p_cliente, cliente_id) end,
         prazo          = case when 'prazo' = any(p_limpar) then null
                               else coalesce(p_prazo, prazo) end,
         atualizado_em  = now()
   where id = p_tarefa;

  if p_responsavel is not null
     and p_responsavel <> coalesce(v_antes, '00000000-0000-0000-0000-000000000000'::uuid)
     and p_responsavel <> auth.uid() then
    insert into public.tarefa_avisos (tarefa_id, para_id, tipo)
    values (p_tarefa, p_responsavel, 'atribuida')
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.editar_tarefa(uuid, text, text, uuid, uuid, date, text[])
  from public, anon;
grant execute on function public.editar_tarefa(uuid, text, text, uuid, uuid, date, text[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Mencionar alguem — "a outra pessoa ve o que foi mencionado"
-- ---------------------------------------------------------------------------
create or replace function public.mencionar_na_tarefa(p_tarefa uuid, p_perfil uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_ve_tarefa(p_tarefa) then
    raise exception 'Esta tarefa nao e sua.';
  end if;
  if not exists (select 1 from public.perfis where user_id = p_perfil and ativo) then
    raise exception 'Essa pessoa nao esta na equipe.';
  end if;

  insert into public.tarefa_mencoes (tarefa_id, perfil_id, por_id)
  values (p_tarefa, p_perfil, auth.uid())
  on conflict do nothing;

  if p_perfil <> auth.uid() then
    insert into public.tarefa_avisos (tarefa_id, para_id, tipo)
    values (p_tarefa, p_perfil, 'mencionada')
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.tirar_mencao_da_tarefa(p_tarefa uuid, p_perfil uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_ve_tarefa(p_tarefa) then
    raise exception 'Esta tarefa nao e sua.';
  end if;
  delete from public.tarefa_mencoes where tarefa_id = p_tarefa and perfil_id = p_perfil;
end;
$$;

revoke all on function public.mencionar_na_tarefa(uuid, uuid) from public, anon;
grant execute on function public.mencionar_na_tarefa(uuid, uuid) to authenticated, service_role;
revoke all on function public.tirar_mencao_da_tarefa(uuid, uuid) from public, anon;
grant execute on function public.tirar_mencao_da_tarefa(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Apagar o cartao
-- ---------------------------------------------------------------------------
create or replace function public.apagar_tarefa(p_tarefa uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.tarefas
     where id = p_tarefa and (public.usuario_admin() or criado_por = auth.uid())
  ) then
    raise exception
      'So quem criou a tarefa (ou a direcao) pode apaga-la. Se ela nao e mais '
      'para fazer, mova para a coluna final.';
  end if;
  delete from public.tarefas where id = p_tarefa;
end;
$$;

revoke all on function public.apagar_tarefa(uuid) from public, anon;
grant execute on function public.apagar_tarefa(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- As colunas, editaveis — que foi o pedido ("1. editaveis")
-- ---------------------------------------------------------------------------
create or replace function public.criar_coluna_de_tarefa(p_nome text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para mexer nas colunas.';
  end if;
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'A coluna precisa de um nome.';
  end if;

  -- Entra ANTES da coluna final, nao depois. "Feito" e o fim do fluxo; coluna
  -- nova depois dela seria um fim depois do fim.
  insert into public.tarefa_colunas (nome, ordem)
  values (btrim(p_nome),
          coalesce((select min(ordem) from public.tarefa_colunas where final), 999999))
  returning id into v_id;

  -- Renumera tudo em sequencia.
  with nova as (
    select id, row_number() over (order by ordem, final, criado_em) as n
      from public.tarefa_colunas
  )
  update public.tarefa_colunas c set ordem = nova.n
    from nova where nova.id = c.id and c.ordem <> nova.n;

  return v_id;
end;
$$;

create or replace function public.renomear_coluna_de_tarefa(p_coluna uuid, p_nome text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para mexer nas colunas.';
  end if;
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'A coluna precisa de um nome.';
  end if;
  update public.tarefa_colunas set nome = btrim(p_nome) where id = p_coluna;
  if not found then raise exception 'Coluna nao encontrada.'; end if;
end;
$$;

create or replace function public.mover_coluna_de_tarefa(p_coluna uuid, p_para integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para mexer nas colunas.';
  end if;
  -- Espalha de 10 em 10 antes de encaixar; ver o mesmo comentario em
  -- `mover_tarefa`. Com os vizinhos em 1,2,3,4, pedir a posicao 1 mandava a
  -- coluna para o fim.
  with espalha as (
    select id, row_number() over (order by ordem, criado_em) * 10 as n
      from public.tarefa_colunas where id <> p_coluna
  )
  update public.tarefa_colunas c set ordem = espalha.n from espalha where espalha.id = c.id;

  update public.tarefa_colunas set ordem = greatest(p_para, 1) * 10 - 5 where id = p_coluna;
  if not found then raise exception 'Coluna nao encontrada.'; end if;

  with nova as (
    select id, row_number() over (order by ordem, criado_em) as n
      from public.tarefa_colunas
  )
  update public.tarefa_colunas c set ordem = nova.n
    from nova where nova.id = c.id and c.ordem <> nova.n;
end;
$$;

-- Apagar coluna NAO apaga tarefa.
--
-- A referencia e `on delete restrict` de proposito: apagar uma coluna cheia
-- levaria junto o trabalho que estava nela, sem desfazer. Entao a funcao
-- RECUSA e diz quantos cartoes precisam sair antes — erro que ensina o que
-- fazer, em vez de erro de constraint em ingles.
create or replace function public.apagar_coluna_de_tarefa(p_coluna uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cartoes integer;
  v_restam  integer;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para mexer nas colunas.';
  end if;

  select count(*) into v_cartoes from public.tarefas where coluna_id = p_coluna;
  if v_cartoes > 0 then
    raise exception
      'Esta coluna ainda tem % tarefa(s). Mova para outra coluna antes de apagar — '
      'apagar a coluna nao apaga o trabalho que esta nela.', v_cartoes;
  end if;

  select count(*) into v_restam from public.tarefa_colunas;
  if v_restam <= 1 then
    raise exception 'O quadro precisa de pelo menos uma coluna.';
  end if;

  delete from public.tarefa_colunas where id = p_coluna;
  if not found then raise exception 'Coluna nao encontrada.'; end if;
end;
$$;

revoke all on function public.criar_coluna_de_tarefa(text) from public, anon;
grant execute on function public.criar_coluna_de_tarefa(text) to authenticated, service_role;
revoke all on function public.renomear_coluna_de_tarefa(uuid, text) from public, anon;
grant execute on function public.renomear_coluna_de_tarefa(uuid, text) to authenticated, service_role;
revoke all on function public.mover_coluna_de_tarefa(uuid, integer) from public, anon;
grant execute on function public.mover_coluna_de_tarefa(uuid, integer) to authenticated, service_role;
revoke all on function public.apagar_coluna_de_tarefa(uuid) from public, anon;
grant execute on function public.apagar_coluna_de_tarefa(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- `anon` nao encosta em nada disto
--
-- O RLS ja recusaria (as politicas pedem `usuario_ativo()`, e quem nao esta
-- logado nao passa), mas privilegio de tabela e a camada de baixo: enquanto
-- ele existe, basta UMA politica escrita com descuido no futuro para a porta
-- abrir. A auditoria de RLS (teste 08) cobra isto de toda tabela nova, e
-- pegou estas quatro na primeira rodada.
-- ---------------------------------------------------------------------------
revoke all on table public.tarefa_colunas  from anon;
revoke all on table public.tarefas         from anon;
revoke all on table public.tarefa_mencoes  from anon;
revoke all on table public.tarefa_avisos   from anon;
