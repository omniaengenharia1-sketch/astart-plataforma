-- 0067 — a fila de avisos vira fila de verdade.
--
-- A 0065 criou `tarefa_avisos` com `enviado_em` nulo e disse que o envio
-- ligaria depois. Depois e agora: o dominio esta verificado no Resend e a
-- chave esta no Vault.
--
-- O QUE FALTAVA PARA SER FILA, E NAO LISTA
--
-- Ter linha pendente nao basta. Tres coisas faltavam:
--
--   1. RESERVA. Sem reservar antes de enviar, duas invocacoes que se cruzem
--      mandam o mesmo e-mail duas vezes. A regra do projeto e explicita:
--      "o pior bug possivel e publicar duas vezes na conta de um cliente" —
--      aqui o equivalente e a Raquel receber o mesmo aviso tres vezes e parar
--      de ler os avisos.
--
--   2. NOVA TENTATIVA COM ESPERA. Resend fora do ar nao pode virar aviso
--      perdido, nem marretada a cada minuto. Espera que dobra, ate seis vezes.
--
--   3. DESISTIR, EM VOZ ALTA. Depois da sexta, o aviso para de tentar e fica
--      com o motivo escrito. Falha silenciosa e proibida; falha que tenta para
--      sempre tambem e silenciosa, so que cara.
-- ---------------------------------------------------------------------------

alter table public.tarefa_avisos
  add column if not exists tentativas  smallint not null default 0,
  add column if not exists tentar_em   timestamptz not null default now(),
  -- Enquanto reservado, ninguem mais pega. Nulo = livre.
  add column if not exists reservado_em timestamptz,
  add column if not exists desistiu_em  timestamptz;

-- O indice da fila: o que esta pendente, na hora, e ainda nao desistiu.
drop index if exists tarefa_avisos_pendentes;
create index if not exists tarefa_avisos_fila
  on public.tarefa_avisos (tentar_em)
  where enviado_em is null and desistiu_em is null;

-- ---------------------------------------------------------------------------
-- Reservar um lote
--
-- `for update skip locked` e o coracao disto: duas invocacoes simultaneas
-- pegam lotes DIFERENTES em vez de disputar as mesmas linhas.
--
-- A reserva expira em 5 minutos. Se a funcao morrer no meio — timeout, deploy,
-- queda — o aviso volta para a fila sozinho em vez de ficar preso para sempre
-- marcado como "em andamento".
-- ---------------------------------------------------------------------------
create or replace function public.reservar_avisos_de_tarefa(p_limite int default 20)
returns table (
  id            uuid,
  tipo          text,
  para_nome     text,
  para_email    text,
  tarefa_titulo text,
  tarefa_prazo  date,
  cliente       text,
  quem_fez      text,
  tentativas    smallint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with pegos as (
    update public.tarefa_avisos a
       set reservado_em = now(),
           tentativas   = a.tentativas + 1
     where a.id in (
       select x.id from public.tarefa_avisos x
        where x.enviado_em is null
          and x.desistiu_em is null
          and x.tentar_em <= now()
          and (x.reservado_em is null or x.reservado_em < now() - interval '5 minutes')
        order by x.criado_em
        limit greatest(p_limite, 1)
        for update skip locked
     )
    returning a.id, a.tipo, a.para_id, a.tarefa_id, a.tentativas
  )
  select p.id,
         p.tipo::text,
         coalesce(pf.nome, pf.email, 'colega'),
         pf.email,
         t.titulo,
         t.prazo,
         cl.nome,
         coalesce(pc.nome, 'alguem da equipe'),
         p.tentativas
    from pegos p
    join public.perfis   pf on pf.user_id = p.para_id
    join public.tarefas  t  on t.id = p.tarefa_id
    left join public.perfis   pc on pc.user_id = t.criado_por
    left join public.clientes cl on cl.id = t.cliente_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fechar: deu certo, ou nao deu
-- ---------------------------------------------------------------------------
create or replace function public.aviso_de_tarefa_saiu(p_aviso uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.tarefa_avisos
     set enviado_em = now(), reservado_em = null, erro = null
   where id = p_aviso;
$$;

create or replace function public.aviso_de_tarefa_falhou(p_aviso uuid, p_erro text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tentativas smallint;
begin
  select tentativas into v_tentativas from public.tarefa_avisos where id = p_aviso;

  update public.tarefa_avisos
     set erro         = left(coalesce(p_erro, 'erro sem mensagem'), 500),
         reservado_em = null,
         -- 2, 4, 8, 16, 32 minutos. Dobrar da tempo de um servico voltar sem
         -- martelar ele enquanto esta caido.
         tentar_em    = now() + make_interval(mins => power(2, least(v_tentativas, 5))::int),
         -- Na sexta, para de tentar — mas o motivo fica escrito, e a direcao
         -- ve. Tentar para sempre e falha silenciosa cara.
         desistiu_em  = case when v_tentativas >= 6 then now() else null end
   where id = p_aviso;
end;
$$;

revoke all on function public.reservar_avisos_de_tarefa(int) from public, anon, authenticated;
grant execute on function public.reservar_avisos_de_tarefa(int) to service_role;
revoke all on function public.aviso_de_tarefa_saiu(uuid) from public, anon, authenticated;
grant execute on function public.aviso_de_tarefa_saiu(uuid) to service_role;
revoke all on function public.aviso_de_tarefa_falhou(uuid, text) from public, anon, authenticated;
grant execute on function public.aviso_de_tarefa_falhou(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- O que a direcao ve quando algo nao saiu
--
-- Sem isto, "falha silenciosa e proibida" seria so uma frase: o erro estaria
-- gravado numa tabela que ninguem abre.
-- ---------------------------------------------------------------------------
create or replace function public.avisos_de_tarefa_travados()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_admin() then null::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'para', coalesce(p.nome, p.email),
               'tarefa', t.titulo,
               'tentativas', a.tentativas,
               'erro', a.erro,
               'desistiu', a.desistiu_em is not null,
               'desde', a.criado_em)
             order by a.criado_em)
        from public.tarefa_avisos a
        join public.perfis  p on p.user_id = a.para_id
        join public.tarefas t on t.id = a.tarefa_id
       where a.enviado_em is null
         and (a.desistiu_em is not null or a.tentativas >= 2)
    ), '[]'::jsonb)
  end;
$$;

revoke all on function public.avisos_de_tarefa_travados() from public, anon;
grant execute on function public.avisos_de_tarefa_travados() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ler UM segredo do cofre, pelo nome
--
-- A Edge Function precisa da chave do Resend, e `vault.decrypted_secrets` nao
-- e alcancavel pelo PostgREST. Entao uma funcao, com duas travas:
--
--   1. SO service_role. `authenticated` aqui seria entregar o cofre a quem
--      estiver logado — e quem esta logado e o navegador.
--   2. LISTA FECHADA de nomes. Mesmo com service role, esta funcao nao serve
--      para varrer o cofre: so devolve as chaves que alguem escreveu aqui de
--      proposito. Se um dia esta funcao vazar, ela vaza o que ja esta nesta
--      lista, e nao tudo.
-- ---------------------------------------------------------------------------
create or replace function public.segredo_do_cofre(p_nome text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_valor text;
begin
  if p_nome is null or p_nome not in ('resend_api_key') then
    raise exception 'Segredo "%" nao esta na lista que esta funcao pode ler.', p_nome;
  end if;

  select s.decrypted_secret into v_valor
    from vault.decrypted_secrets s
   where s.name = p_nome
   limit 1;

  return v_valor;
end;
$$;

revoke all on function public.segredo_do_cofre(text) from public, anon, authenticated;
grant execute on function public.segredo_do_cofre(text) to service_role;

-- ---------------------------------------------------------------------------
-- O cron, a cada minuto
--
-- Irmao do `agendar_tick` da 0009, e pelo mesmo desenho: o banco chama a Edge
-- Function por http, com o segredo no cabecalho. Confere o que falta ANTES de
-- agendar — cron apontando para endereco que nao existe falha calado todo
-- minuto, para sempre.
-- ---------------------------------------------------------------------------
create or replace function public.agendar_avisos_de_tarefa()
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_falta text;
begin
  if not public.usuario_admin() then
    raise exception 'So a direcao agenda o envio de avisos.';
  end if;

  select string_agg(c.nome, ', ')
    into v_falta
    from (values ('avisar_tarefa_url'), ('tick_secret'), ('resend_api_key')) as c(nome)
   where not exists (
     select 1 from vault.decrypted_secrets v where v.name = c.nome
   );

  if v_falta is not null then
    return format(
      'Falta %s no Vault. Cadastre e rode select public.agendar_avisos_de_tarefa() de novo.',
      v_falta);
  end if;

  if exists (select 1 from cron.job where jobname = 'avisar-tarefa') then
    perform cron.unschedule('avisar-tarefa');
  end if;

  perform cron.schedule(
    'avisar-tarefa',
    '* * * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'avisar_tarefa_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-tick-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'tick_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );

  return 'Agendado: os avisos saem a cada minuto.';
end;
$$;

revoke all on function public.agendar_avisos_de_tarefa() from public, anon;
grant execute on function public.agendar_avisos_de_tarefa() to authenticated, service_role;
