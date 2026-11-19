-- =============================================================================
-- 0079 — a ponte com o Google Agenda: o lado do banco
--
-- A dona: "a agenda eu preciso que vc deixe ela integrada no google agenda",
-- nos DOIS sentidos e com a conta de CADA pessoa da equipe.
--
-- COMO A LIGACAO FUNCIONA, e por que nao e "entrar com o Google"
--
-- Os e-mails da agencia sao de cPanel, nao de Google Workspace. Isso joga um
-- app OAuth para o modo "externo", onde o Google so libera o escopo de
-- agenda depois de uma analise de semanas — e, enquanto ela nao sai, a
-- autorizacao expira a cada SETE DIAS e cada pessoa teria de religar toda
-- semana. Ninguem usa um sistema assim.
--
-- O caminho que evita a analise inteira: uma CONTA DE SERVICO. A plataforma
-- tem um endereco robo (…@…iam.gserviceaccount.com) e cada pessoa
-- COMPARTILHA a propria agenda com ele, uma vez, direto no Google Agenda.
-- Nao ha tela de consentimento, nao ha token de usuario e nao ha expiracao.
--
-- Esta migration guarda SO O VINCULO. A chave do robo nunca passa por aqui
-- nem pelo front: fica no Vault, lida exclusivamente pela Edge Function com
-- service role.
--
-- TRES COISAS QUE ESTE SCHEMA RESOLVE, E QUE SO APARECEM NA SEGUNDA SEMANA
--
-- 1. O QUE EMPURRAR. Um compromisso precisa ir para a agenda de ALGUEM. Vai
--    para a de quem foi marcado como responsavel; sem responsavel, para a de
--    quem criou. Sem essa regra escrita, ou o evento nao vai para lugar
--    nenhum ou vai para todas as agendas da equipe.
--
-- 2. O QUE APAGAR. Compromisso desmarcado aqui tem de sumir la. Linha
--    apagada nao deixa rastro, entao um gatilho guarda a lapide: qual evento,
--    em qual agenda. Sem isso, desmarcar na plataforma deixa o compromisso
--    para sempre no celular da pessoa — e e exatamente o erro que faz alguem
--    aparecer numa gravacao que nao existe mais.
--
-- 3. O QUE JA FOI. `sync_token` e o cursor do Google: com ele a Edge Function
--    pergunta "o que mudou desde a ultima vez" em vez de reler o ano inteiro.
--    Quando o Google o recusa (expirou), a funcao refaz do zero — por isso
--    ele pode ser nulo sem quebrar nada.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- QUEM LIGOU A PROPRIA AGENDA
-- ---------------------------------------------------------------------------
create table if not exists public.agendas_google (
  user_id        uuid primary key references public.perfis(user_id) on delete cascade,
  -- Normalmente o proprio e-mail da pessoa: no Google, o id da agenda
  -- principal e o endereco dela.
  calendar_id    text not null check (length(btrim(calendar_id)) > 0),

  -- O cursor do Google. Nulo = a proxima rodada le tudo da janela e recomeca.
  sync_token     text,
  ultima_sincronia_em timestamptz,
  /**
   * O ultimo erro, em portugues, para aparecer na tela de Ajustes.
   * Falha silenciosa e proibida: se a ponte parou, a pessoa tem de ver.
   */
  ultimo_erro    text,
  erro_em        timestamptz,

  ativo          boolean not null default true,
  ligado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  -- Duas pessoas nao ligam a MESMA agenda: os compromissos de uma apareceriam
  -- empurrados pela outra, em duplicata.
  constraint agendas_google_calendario_unico unique (calendar_id)
);

comment on table public.agendas_google is
  'Vinculo pessoa <-> agenda do Google. A chave da conta de servico NAO mora '
  'aqui: fica no Vault, lida so pela Edge Function.';

drop trigger if exists agendas_google_atualizado_em on public.agendas_google;
create trigger agendas_google_atualizado_em
  before update on public.agendas_google
  for each row execute function public.tg_set_atualizado_em();

alter table public.agendas_google enable row level security;
revoke all on public.agendas_google from anon;

-- Cada um ve a propria ligacao; a direcao ve todas, para saber quem ligou.
drop policy if exists agendas_google_le on public.agendas_google;
create policy agendas_google_le on public.agendas_google
  for select to authenticated
  using (user_id = auth.uid() or public.usuario_admin());

-- ---------------------------------------------------------------------------
-- A LAPIDE DO QUE FOI DESMARCADO
--
-- Compromisso apagado aqui tem de ser apagado la. A linha some e leva o
-- `google_event_id` junto, entao o gatilho guarda o par antes de sumir. A
-- Edge Function apaga no Google e so entao remove a lapide.
-- ---------------------------------------------------------------------------
create table if not exists public.compromissos_apagados (
  id                 uuid primary key default gen_random_uuid(),
  google_event_id    text not null,
  google_calendar_id text not null,
  apagado_em         timestamptz not null default now(),
  constraint compromissos_apagados_par unique (google_calendar_id, google_event_id)
);

alter table public.compromissos_apagados enable row level security;
revoke all on public.compromissos_apagados from anon, authenticated;

-- A fila e trabalho da Edge Function, que entra como service role e passa por
-- cima de RLS. Mas tabela com RLS ligada e ZERO politica e invisivel ate para
-- quem precisa entender por que um evento continua no Google — e a auditoria
-- do teste 08 recusa, com razao. Entao a direcao LE, e ninguem escreve pela
-- tela: quem escreve e o gatilho, que e security definer.
drop policy if exists compromissos_apagados_direcao_le on public.compromissos_apagados;
create policy compromissos_apagados_direcao_le on public.compromissos_apagados
  for select to authenticated
  using (public.usuario_admin());

grant select on public.compromissos_apagados to authenticated;

create or replace function public.tg_compromisso_apagado_no_google()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- So interessa o que CHEGOU a existir no Google. O resto nunca foi para la.
  if old.google_event_id is not null and old.google_calendar_id is not null then
    insert into public.compromissos_apagados (google_event_id, google_calendar_id)
    values (old.google_event_id, old.google_calendar_id)
    on conflict (google_calendar_id, google_event_id) do nothing;
  end if;
  return old;
end;
$$;

-- Funcao de gatilho nao se chama de fora. A auditoria do teste 08 recusa
-- security definer aberta para anon, e tem razao: e por ai que se escreve
-- numa tabela que a tela nem deveria conhecer.
revoke all on function public.tg_compromisso_apagado_no_google() from public, anon, authenticated;

drop trigger if exists compromissos_lapide on public.compromissos;
create trigger compromissos_lapide
  before delete on public.compromissos
  for each row execute function public.tg_compromisso_apagado_no_google();

-- ---------------------------------------------------------------------------
-- PARA ONDE VAI CADA COMPROMISSO
--
-- Quem e o dono: o responsavel, se houver; senao quem criou. Uma coluna
-- gerada em vez de uma regra repetida em cada consulta — regra repetida
-- diverge.
-- ---------------------------------------------------------------------------
alter table public.compromissos
  add column if not exists dono_id uuid generated always as
    (coalesce(responsavel_id, criado_por)) stored;

create index if not exists compromissos_dono_idx on public.compromissos (dono_id);

-- ---------------------------------------------------------------------------
-- LIGAR E DESLIGAR — cada um faz o seu
-- ---------------------------------------------------------------------------
create or replace function public.ligar_agenda_google(p_calendar_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para ligar agenda.';
  end if;
  if p_calendar_id is null or length(btrim(p_calendar_id)) = 0 then
    raise exception 'Diga qual e a sua agenda do Google (normalmente o seu e-mail).';
  end if;
  if exists (select 1 from public.agendas_google
              where calendar_id = btrim(lower(p_calendar_id)) and user_id <> auth.uid()) then
    raise exception
      'Esta agenda ja esta ligada em outra pessoa. Cada agenda e de uma pessoa so.';
  end if;

  insert into public.agendas_google (user_id, calendar_id, ativo)
  values (auth.uid(), btrim(lower(p_calendar_id)), true)
  on conflict (user_id) do update
    set calendar_id = excluded.calendar_id,
        ativo       = true,
        -- Trocar de agenda recomeca a sincronizacao: o cursor velho e de
        -- outra agenda e o Google o recusaria.
        sync_token  = case when public.agendas_google.calendar_id = excluded.calendar_id
                           then public.agendas_google.sync_token else null end,
        ultimo_erro = null,
        erro_em     = null;
end;
$$;

revoke all on function public.ligar_agenda_google(text) from public, anon;
grant execute on function public.ligar_agenda_google(text) to authenticated, service_role;

create or replace function public.desligar_agenda_google()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao.';
  end if;
  -- Desligar NAO apaga o vinculo dos compromissos ja empurrados: se religar,
  -- eles continuam sendo os mesmos eventos la, em vez de virarem duplicatas.
  update public.agendas_google set ativo = false where user_id = auth.uid();
  if not found then raise exception 'Voce nao tem agenda ligada.'; end if;
end;
$$;

revoke all on function public.desligar_agenda_google() from public, anon;
grant execute on function public.desligar_agenda_google() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- O QUE A TELA DE AJUSTES MOSTRA
-- ---------------------------------------------------------------------------
create or replace function public.minha_agenda_google()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ativo() then null::jsonb else
    coalesce((
      select jsonb_build_object(
        'ligada',      g.ativo,
        'calendarId',  g.calendar_id,
        'ligadoEm',    g.ligado_em,
        'ultimaEm',    g.ultima_sincronia_em,
        'ultimoErro',  g.ultimo_erro,
        'erroEm',      g.erro_em,
        'quantos', (select count(*) from public.compromissos k
                     where k.dono_id = auth.uid() and k.google_event_id is not null))
        from public.agendas_google g where g.user_id = auth.uid()
    ), jsonb_build_object('ligada', false))
  end;
$$;

revoke all on function public.minha_agenda_google() from public, anon;
grant execute on function public.minha_agenda_google() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- O QUE A EDGE FUNCTION PRECISA — e so ela
--
-- `security invoker`, e as politicas acima nao dao select a authenticated
-- nestas linhas de outras pessoas: quem chama isto e o service role.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_sincronia(
  p_user       uuid,
  p_sync_token text default null,
  p_erro       text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.agendas_google set
    -- O cursor so avanca quando a rodada deu certo. Gravar o token de uma
    -- rodada que falhou no meio perderia o que faltou buscar.
    sync_token = case when p_erro is null then coalesce(p_sync_token, sync_token)
                      else sync_token end,
    ultima_sincronia_em = case when p_erro is null then now() else ultima_sincronia_em end,
    ultimo_erro = p_erro,
    erro_em     = case when p_erro is null then null else now() end
  where user_id = p_user;
end;
$$;

revoke all on function public.registrar_sincronia(uuid, text, text) from public, anon, authenticated;
grant execute on function public.registrar_sincronia(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- MARCAR QUE O COMPROMISSO JA ESTA LA
--
-- Idempotencia da ponte: o par (agenda, evento) e unico por indice desde a
-- 0078, entao uma rodada repetida nao cria o mesmo evento duas vezes.
-- ---------------------------------------------------------------------------
-- `p_visto_em` e o `atualizado_em` que a rodada LEU quando pegou este
-- compromisso na fila, e nao `now()`. A diferenca e uma corrida de verdade:
--
--   a rodada le o compromisso (titulo "Reuniao")
--   a pessoa corrige para "Reuniao remarcada"      <- outra transacao
--   a rodada grava no Google e carimba now()
--
-- Com `now()`, o carimbo fica DEPOIS da correcao e o compromisso nunca mais
-- entra na fila: o Google guarda o titulo velho para sempre, calado. Com o
-- instante lido, `atualizado_em` continua maior e a proxima rodada corrige.
create or replace function public.casar_compromisso_com_google(
  p_compromisso uuid,
  p_calendar_id text,
  p_event_id    text,
  p_visto_em    timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.compromissos set
    google_calendar_id     = p_calendar_id,
    google_event_id        = p_event_id,
    google_sincronizado_em = coalesce(p_visto_em, now())
  where id = p_compromisso;
  if not found then raise exception 'Compromisso nao encontrado.'; end if;
end;
$$;

revoke all on function public.casar_compromisso_com_google(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.casar_compromisso_com_google(uuid, text, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- O QUE FALTA EMPURRAR
--
-- Compromisso de quem tem agenda ligada que nunca foi para la, ou que mudou
-- depois da ultima vez que foi. A comparacao e com `atualizado_em`, que o
-- gatilho da 0078 mantem.
-- ---------------------------------------------------------------------------
create or replace function public.compromissos_para_empurrar(p_limite int default 200)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', k.id,
      'calendarId', g.calendar_id,
      'eventId', k.google_event_id,
      -- O instante em que a rodada esta vendo esta versao. Volta em
      -- `casar_compromisso_com_google` e fecha a corrida descrita la.
      'atualizadoEm', k.atualizado_em,
      'titulo', k.titulo,
      'quando', k.quando,
      'terminaEm', k.termina_em,
      'diaInteiro', k.dia_inteiro,
      'fuso', k.fuso,
      'local', k.local,
      'observacao', k.observacao,
      'cliente', (select c.nome from public.clientes c where c.id = k.cliente_id)) as x
      from public.compromissos k
      join public.agendas_google g on g.user_id = k.dono_id and g.ativo
     -- NAO filtra por origem. Eu tinha posto `origem = 'astart'` aqui achando
     -- que era a trava do pingue-pongue, e era uma trava a mais do que o
     -- necessario: um evento que nasceu no Google e foi CORRIGIDO na
     -- plataforma tem de voltar para la — e com aquele filtro nunca voltava,
     -- em silencio. Quem impede o pingue-pongue e a comparacao abaixo:
     -- `aplicar_evento_do_google` carimba `google_sincronizado_em` no mesmo
     -- instante em que grava, entao o que acabou de chegar de la nao entra na
     -- fila; so entra depois que uma pessoa mexe nele aqui.
     where k.google_sincronizado_em is null
        or k.atualizado_em > k.google_sincronizado_em
     order by k.atualizado_em
     limit greatest(1, least(coalesce(p_limite, 200), 1000))
  ) y;
$$;

revoke all on function public.compromissos_para_empurrar(int) from public, anon, authenticated;
grant execute on function public.compromissos_para_empurrar(int) to service_role;

-- ---------------------------------------------------------------------------
-- O QUE VEM DO GOOGLE
--
-- A volta da mao dupla. Um evento criado no celular dela tem de virar
-- compromisso aqui — uma vez so, por mais que a rodada repita.
--
-- A chave da idempotencia e o indice unico `(google_calendar_id,
-- google_event_id)` da 0078: o `on conflict` abaixo se apoia nele. Sem ele,
-- uma rodada repetida encheria a agenda de copias.
--
-- `origem = 'google'` marca quem nasceu la. Isso importa porque
-- `compromissos_para_empurrar` IGNORA esses: empurrar de volta um evento que
-- acabou de chegar de la seria um pingue-pongue que nunca termina.
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_evento_do_google(
  p_user         uuid,
  p_calendar_id  text,
  p_event_id     text,
  p_titulo       text,
  p_quando       timestamptz,
  p_termina_em   timestamptz default null,
  p_dia_inteiro  boolean default false,
  p_local        text default null,
  p_observacao   text default null,
  p_fuso         text default 'America/Sao_Paulo'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_titulo is null or length(btrim(p_titulo)) = 0 then
    -- Evento sem titulo existe no Google ("(Sem titulo)"). Em vez de recusar
    -- e parar a rodada inteira, entra com um nome que diz o que e.
    p_titulo := 'Sem título';
  end if;

  insert into public.compromissos
    (titulo, quando, termina_em, dia_inteiro, fuso, local, observacao,
     responsavel_id, criado_por, origem,
     google_calendar_id, google_event_id, google_sincronizado_em)
  values
    (btrim(p_titulo), p_quando, p_termina_em, coalesce(p_dia_inteiro, false),
     coalesce(nullif(btrim(coalesce(p_fuso, '')), ''), 'America/Sao_Paulo'),
     nullif(btrim(coalesce(p_local, '')), ''),
     nullif(btrim(coalesce(p_observacao, '')), ''),
     p_user, p_user, 'google',
     p_calendar_id, p_event_id, now())
  on conflict (google_calendar_id, google_event_id) where google_event_id is not null
  do update set
    titulo      = excluded.titulo,
    quando      = excluded.quando,
    termina_em  = excluded.termina_em,
    dia_inteiro = excluded.dia_inteiro,
    fuso        = excluded.fuso,
    local       = excluded.local,
    observacao  = excluded.observacao,
    google_sincronizado_em = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.aplicar_evento_do_google(
  uuid, text, text, text, timestamptz, timestamptz, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.aplicar_evento_do_google(
  uuid, text, text, text, timestamptz, timestamptz, boolean, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- APAGADO LA, APAGADO AQUI
--
-- O gatilho da lapide dispara no delete e guardaria o par de novo, pedindo
-- para a Edge Function apagar no Google um evento que o Google ja apagou.
-- Entao a lapide e removida na mesma transacao.
-- ---------------------------------------------------------------------------
create or replace function public.apagar_compromisso_do_google(
  p_calendar_id text,
  p_event_id    text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_achou boolean := false;
begin
  delete from public.compromissos
   where google_calendar_id = p_calendar_id and google_event_id = p_event_id;
  v_achou := found;

  delete from public.compromissos_apagados
   where google_calendar_id = p_calendar_id and google_event_id = p_event_id;

  return v_achou;
end;
$$;

revoke all on function public.apagar_compromisso_do_google(text, text)
  from public, anon, authenticated;
grant execute on function public.apagar_compromisso_do_google(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- A FILA DO QUE FOI DESMARCADO AQUI
-- ---------------------------------------------------------------------------
create or replace function public.apagados_para_o_google(p_limite int default 200)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'calendarId', a.google_calendar_id,
           'eventId',    a.google_event_id)), '[]'::jsonb)
    from (select * from public.compromissos_apagados
           order by apagado_em
           limit greatest(1, least(coalesce(p_limite, 200), 1000))) a;
$$;

revoke all on function public.apagados_para_o_google(int) from public, anon, authenticated;
grant execute on function public.apagados_para_o_google(int) to service_role;

create or replace function public.esquecer_apagado(p_calendar_id text, p_event_id text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.compromissos_apagados
   where google_calendar_id = p_calendar_id and google_event_id = p_event_id;
$$;

revoke all on function public.esquecer_apagado(text, text) from public, anon, authenticated;
grant execute on function public.esquecer_apagado(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- AS AGENDAS QUE A RODADA TEM DE VISITAR
-- ---------------------------------------------------------------------------
create or replace function public.agendas_google_ativas()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId',     g.user_id,
           'calendarId', g.calendar_id,
           'syncToken',  g.sync_token,
           'nome',       p.nome)), '[]'::jsonb)
    from public.agendas_google g
    join public.perfis p on p.user_id = g.user_id
   where g.ativo and p.ativo;
$$;

revoke all on function public.agendas_google_ativas() from public, anon, authenticated;
grant execute on function public.agendas_google_ativas() to service_role;

-- ---------------------------------------------------------------------------
-- AGENDAR A RODADA
--
-- Mesma forma dos outros: a funcao confere o Vault primeiro e devolve o que
-- falta em portugues, em vez de agendar um cron que vai falhar calado toda
-- vez. Rodar `select public.agendar_ponte_google();` no SQL editor depois de
-- cadastrar os segredos.
--
-- A CADA CINCO MINUTOS, e nao a cada minuto. A agenda nao e tempo real: um
-- compromisso que aparece no celular cinco minutos depois nao atrapalha
-- ninguem, e cada rodada custa uma chamada ao Google por pessoa ligada.
-- ---------------------------------------------------------------------------
create or replace function public.agendar_ponte_google()
returns text
language plpgsql
security definer
set search_path = public, pg_temp, cron
as $$
declare v_falta text;
begin
  if not public.usuario_admin() then
    raise exception 'So a direcao agenda a ponte.';
  end if;

  select string_agg(c.nome, ', ') into v_falta
    from (values ('agenda_google_url'), ('tick_secret')) as c(nome)
   where not exists (select 1 from vault.decrypted_secrets v where v.name = c.nome);

  if v_falta is not null then
    return format(
      'Falta %s no Vault. Cadastre e rode select public.agendar_ponte_google() de novo.',
      v_falta);
  end if;

  if exists (select 1 from cron.job where jobname = 'agenda-google') then
    perform cron.unschedule('agenda-google');
  end if;

  perform cron.schedule(
    'agenda-google',
    '*/5 * * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'agenda_google_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-tick-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'tick_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );

  return 'Agendado: a agenda conversa com o Google a cada cinco minutos.';
end;
$$;

revoke all on function public.agendar_ponte_google() from public, anon;
grant execute on function public.agendar_ponte_google() to authenticated, service_role;
