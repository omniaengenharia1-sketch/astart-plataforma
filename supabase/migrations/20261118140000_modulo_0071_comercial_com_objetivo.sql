-- 0071 — o comercial deixa de ser vitrine.
--
-- A dona: "a parte comercial ta um pouco vaga ali, eu nao consigo mexer em
-- nada. (...) ela tem que ter um fundamento, um objetivo."
--
-- Ela esta certa, e da para medir: a tabela `leads` tem 31 campos e a
-- plataforma sabia fazer DUAS coisas com um lead — listar o funil e arrastar
-- entre etapas. Nao dava para criar, editar, anotar o que foi conversado nem
-- marcar o que fazer depois. E uma tela que mostra e nao deixa trabalhar.
-- Resultado: zero leads cadastrados desde que o modulo existe.
--
-- O OBJETIVO QUE ESTA TELA PASSA A TER
--
--   "Com quem eu preciso falar hoje, e o que eu combinei da ultima vez."
--
-- Nao e um funil bonito: e uma lista de trabalho. Tudo o que entra aqui serve
-- a essa pergunta, e o que nao serve ficou de fora.
--
-- AS ETAPAS CAIRAM DE 13 PARA 6
--
-- As 13 incluiam `aguardando_aprovacao` e `aguardando_edicao`, que sao de
-- aprovacao de CONTEUDO e vieram parar no modulo errado. E havia pares que
-- ninguem distingue na pratica (`contato_feito` x `em_conversa`,
-- `proposta_enviada` x `negociacao`, `perdido` x `descartado`).
--
-- Etapa que nao muda o que voce FAZ nao e etapa, e decoracao que atrasa o
-- cadastro. As seis que ficam significam, cada uma, uma acao diferente:
--
--   novo        chegou, ainda nao falei
--   conversando falei, estamos conversando
--   reuniao     tem reuniao marcada
--   proposta    mandei proposta, esperando resposta
--   fechado     virou cliente
--   perdido     nao vai acontecer, e o motivo fica escrito
--
-- A troca e segura porque nao ha um unico lead cadastrado — conferido na
-- producao antes de escrever isto. Mesmo assim o `using` abaixo mapeia valor
-- por valor, e nao joga tudo em 'novo': se aparecer uma linha entre este
-- arquivo e a aplicacao, ela chega no lugar certo.
-- ---------------------------------------------------------------------------

-- `mover_lead` recebe o tipo por parametro, entao sai antes do rename e volta
-- depois. Sem isso, a assinatura dela apontaria para o tipo velho.
drop function if exists public.mover_lead(uuid, public.etapa_lead, text);

-- E os indices tambem saem antes.
--
-- `leads_followup_idx` e PARCIAL, e a condicao dele cita 'descartado' — um
-- valor que o tipo novo nao tem. Ao trocar o tipo da coluna o Postgres
-- reconstroi o indice, a condicao nao resolve mais, e a migration inteira
-- falha com uma mensagem que nao aponta para o indice:
--
--   ERROR: operator does not exist: etapa_lead <> etapa_lead_antiga
--
-- Foi assim que descobri: a mensagem fala de um operador que nao existe em
-- lugar nenhum do arquivo.
drop index if exists public.leads_followup_idx;
drop index if exists public.leads_etapa_idx;

-- E as duas RESTRICOES que citam a etapa, pelo mesmo motivo. Elas sao boas
-- regras e voltam logo abaixo; o que nao da e troca-las de tipo no meio do
-- caminho.
--
--   leads_perdido_tem_motivo   perdido sem motivo nao entra
--   leads_so_fechado_converte  so lead fechado aponta para um cliente
alter table public.leads drop constraint if exists leads_perdido_tem_motivo;
alter table public.leads drop constraint if exists leads_so_fechado_converte;

alter type public.etapa_lead rename to etapa_lead_antiga;

do $$ begin
  create type public.etapa_lead as enum
    ('novo', 'conversando', 'reuniao', 'proposta', 'fechado', 'perdido');
exception when duplicate_object then null; end $$;

alter table public.leads alter column etapa drop default;
alter table public.leads
  alter column etapa type public.etapa_lead
  using (case etapa::text
           when 'novo_lead'            then 'novo'
           when 'pronto_abordar'       then 'novo'
           when 'contato_feito'        then 'conversando'
           when 'em_conversa'          then 'conversando'
           when 'qualificado'          then 'conversando'
           when 'aguardando_aprovacao' then 'conversando'
           when 'aguardando_edicao'    then 'conversando'
           when 'reuniao_agendada'     then 'reuniao'
           when 'proposta_enviada'     then 'proposta'
           when 'negociacao'           then 'proposta'
           when 'fechado'              then 'fechado'
           else 'perdido'
         end)::public.etapa_lead;
alter table public.leads alter column etapa set default 'novo';

drop type if exists public.etapa_lead_antiga;

-- Os indices voltam, agora falando o vocabulario novo.
create index if not exists leads_etapa_idx on public.leads (etapa, atualizado_em desc);
create index if not exists leads_followup_idx
  on public.leads (proximo_followup_em)
  where etapa not in ('fechado', 'perdido');

-- As duas regras voltam, sem 'descartado', que deixou de existir.
alter table public.leads add constraint leads_perdido_tem_motivo
  check (etapa <> 'perdido' or motivo_desqualificacao is not null);
alter table public.leads add constraint leads_so_fechado_converte
  check (cliente_id is null or etapa = 'fechado');

-- ---------------------------------------------------------------------------
-- CRIAR
--
-- Pede o minimo: um nome. Todo o resto entra depois, no cartao.
--
-- Isso e deliberado. Formulario de lead que exige dez campos e formulario que
-- nao se preenche: quem acabou de desligar o telefone quer anotar o nome e o
-- que ficou combinado, e nao abrir uma ficha cadastral.
-- ---------------------------------------------------------------------------
create or replace function public.criar_lead(
  p_nome           text,
  p_empresa        text    default null,
  p_whatsapp       text    default null,
  p_origem         text    default null,
  p_valor_centavos bigint  default null,
  p_proximo_passo  text    default null,
  p_proximo_em     date    default null,
  p_notas          text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.usuario_financeiro() then
    raise exception 'O comercial e de quem cuida do dinheiro.';
  end if;
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'O lead precisa de um nome.';
  end if;
  if p_valor_centavos is not null and p_valor_centavos < 0 then
    raise exception 'O valor estimado nao pode ser negativo.';
  end if;

  insert into public.leads (
    nome, empresa, whatsapp, origem, valor_estimado_centavos,
    proximo_passo, proximo_followup_em, notas, etapa, responsavel_id)
  values (
    btrim(p_nome),
    nullif(btrim(coalesce(p_empresa, '')), ''),
    nullif(btrim(coalesce(p_whatsapp, '')), ''),
    nullif(btrim(coalesce(p_origem, '')), ''),
    p_valor_centavos,
    nullif(btrim(coalesce(p_proximo_passo, '')), ''),
    p_proximo_em,
    nullif(btrim(coalesce(p_notas, '')), ''),
    'novo',
    auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- EDITAR
--
-- Nulo quer dizer "nao mexe". Para APAGAR um campo, o nome dele vai em
-- `p_limpar` — mesma convencao da `editar_tarefa` (0065), porque duas
-- convencoes diferentes para a mesma coisa no mesmo sistema e armadilha.
-- ---------------------------------------------------------------------------
create or replace function public.editar_lead(
  p_lead           uuid,
  p_nome           text    default null,
  p_empresa        text    default null,
  p_whatsapp       text    default null,
  p_origem         text    default null,
  p_valor_centavos bigint  default null,
  p_notas          text    default null,
  p_score          public.score_lead default null,
  p_reuniao_em     timestamptz default null,
  p_limpar         text[]  default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limpar text[] := coalesce(p_limpar, array[]::text[]);
begin
  if not public.usuario_financeiro() then
    raise exception 'O comercial e de quem cuida do dinheiro.';
  end if;
  if p_nome is not null and length(btrim(p_nome)) = 0 then
    raise exception 'O lead precisa de um nome.';
  end if;
  if p_valor_centavos is not null and p_valor_centavos < 0 then
    raise exception 'O valor estimado nao pode ser negativo.';
  end if;

  update public.leads set
    nome        = coalesce(nullif(btrim(coalesce(p_nome, '')), ''), nome),
    empresa     = case when 'empresa'  = any (v_limpar) then null
                       else coalesce(nullif(btrim(coalesce(p_empresa, '')), ''), empresa) end,
    whatsapp    = case when 'whatsapp' = any (v_limpar) then null
                       else coalesce(nullif(btrim(coalesce(p_whatsapp, '')), ''), whatsapp) end,
    origem      = case when 'origem'   = any (v_limpar) then null
                       else coalesce(nullif(btrim(coalesce(p_origem, '')), ''), origem) end,
    notas       = case when 'notas'    = any (v_limpar) then null
                       else coalesce(nullif(btrim(coalesce(p_notas, '')), ''), notas) end,
    valor_estimado_centavos = case when 'valor' = any (v_limpar) then null
                       else coalesce(p_valor_centavos, valor_estimado_centavos) end,
    reuniao_em  = case when 'reuniao'  = any (v_limpar) then null
                       else coalesce(p_reuniao_em, reuniao_em) end,
    score       = coalesce(p_score, score),
    atualizado_em = now()
  where id = p_lead;

  if not found then
    raise exception 'Lead nao encontrado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- REGISTRAR O QUE FOI CONVERSADO
--
-- E a funcao central do modulo, e a que faltava inteira.
--
-- Ela faz tres coisas de uma vez, de proposito: guarda o que aconteceu,
-- carimba a data da ultima conversa, e marca o proximo passo com data. Separar
-- em tres botoes seria garantir que o terceiro nunca e apertado — e lead sem
-- proximo passo e lead esquecido, que e como funil vira cemiterio.
--
-- O historico e append, com a data na frente. Nunca sobrescreve: o que foi
-- conversado em marco explica a proposta de abril.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_interacao_do_lead(
  p_lead          uuid,
  p_oque          text,
  p_proximo_passo text default null,
  p_proximo_em    date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quem  text;
  v_linha text;
begin
  if not public.usuario_financeiro() then
    raise exception 'O comercial e de quem cuida do dinheiro.';
  end if;
  if length(btrim(coalesce(p_oque, ''))) = 0 then
    raise exception 'Escreva o que foi conversado.';
  end if;

  select coalesce(p.nome, 'alguem da equipe') into v_quem
    from public.perfis p where p.user_id = auth.uid();

  v_linha := to_char(current_date, 'DD/MM/YYYY') || ' · ' ||
             coalesce(v_quem, 'alguem da equipe') || ': ' || btrim(p_oque);

  update public.leads set
    historico = case when historico is null or btrim(historico) = ''
                     then v_linha else historico || E'\n' || v_linha end,
    ultima_interacao_em = current_date,
    proximo_passo       = coalesce(nullif(btrim(coalesce(p_proximo_passo, '')), ''), proximo_passo),
    proximo_followup_em = coalesce(p_proximo_em, proximo_followup_em),
    -- Falou com a pessoa: o lead sai de "novo" sozinho. Uma etapa que a
    -- pessoa teria de lembrar de mudar na mao e uma etapa que fica errada.
    etapa               = case when etapa = 'novo' then 'conversando'::public.etapa_lead
                               else etapa end,
    atualizado_em       = now()
  where id = p_lead;

  if not found then
    raise exception 'Lead nao encontrado.';
  end if;

  return jsonb_build_object('lead', p_lead, 'anotado', v_linha);
end;
$$;

-- ---------------------------------------------------------------------------
-- MOVER, de volta com o tipo novo
-- ---------------------------------------------------------------------------
create or replace function public.mover_lead(
  p_lead   uuid,
  p_etapa  public.etapa_lead,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_financeiro() then
    raise exception 'O comercial e de quem cuida do dinheiro.';
  end if;

  -- Perdido SEM motivo e a pior linha do funil: daqui a seis meses ninguem
  -- sabe se o preco estava alto, se sumiu, ou se fechou com outro.
  if p_etapa = 'perdido' and length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Lead perdido precisa de motivo — daqui a seis meses ninguem lembra por que.';
  end if;

  update public.leads
     set etapa = p_etapa,
         motivo_desqualificacao = case when p_etapa = 'perdido'
           then nullif(btrim(coalesce(p_motivo, '')), '') else motivo_desqualificacao end,
         ultima_interacao_em = current_date,
         atualizado_em = now()
   where id = p_lead;

  if not found then
    raise exception 'Lead nao encontrado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- CONVERTER: o lead virou cliente
--
-- Nao cria o cliente — a `criar_cliente` ja faz isso, com contrato e modulos.
-- Aqui so amarra os dois, para o historico da venda nao se perder quando o
-- cliente comeca.
-- ---------------------------------------------------------------------------
create or replace function public.converter_lead(p_lead uuid, p_cliente uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_financeiro() then
    raise exception 'O comercial e de quem cuida do dinheiro.';
  end if;
  if not exists (select 1 from public.clientes c where c.id = p_cliente) then
    raise exception 'Cliente % nao encontrado. Cadastre o cliente antes de converter.', p_cliente;
  end if;

  update public.leads
     set etapa         = 'fechado',
         cliente_id    = p_cliente,
         convertido_em = now(),
         ultima_interacao_em = current_date,
         proximo_passo = null,
         proximo_followup_em = null,
         atualizado_em = now()
   where id = p_lead;

  if not found then
    raise exception 'Lead nao encontrado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- APAGAR: so para desfazer engano
--
-- Lead que virou cliente NAO sai: ele e o comeco da historia daquele contrato.
-- Para tirar da frente, o caminho e "perdido" com motivo, que preserva.
-- ---------------------------------------------------------------------------
create or replace function public.apagar_lead(p_lead uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_admin() then
    raise exception 'So a direcao apaga lead.';
  end if;
  if exists (select 1 from public.leads l where l.id = p_lead and l.convertido_em is not null) then
    raise exception 'Este lead virou cliente — ele e o comeco daquele contrato. Nao apague.';
  end if;

  delete from public.leads where id = p_lead;
  if not found then
    raise exception 'Lead nao encontrado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- O QUE EU PRECISO FAZER HOJE
--
-- A resposta que a tela existe para dar. Tres listas, na ordem em que doem:
--
--   atrasados  o follow-up era para ontem ou antes
--   hoje       e para hoje
--   semana     os proximos sete dias, para nao ser surpresa
--
-- E `semFollowup`: os leads abertos sem proxima data marcada. Essa lista e a
-- mais importante das quatro e a que ninguem pensa em fazer — e exatamente
-- onde o lead morre, sem ninguem decidir que morreu.
-- ---------------------------------------------------------------------------
create or replace function public.agenda_comercial()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with abertos as (
    select l.* from public.leads l where l.etapa not in ('fechado', 'perdido')
  ),
  cartao as (
    select a.id,
           jsonb_build_object(
             'id', a.id, 'nome', a.nome, 'empresa', a.empresa, 'etapa', a.etapa,
             'whatsapp', a.whatsapp, 'proximoPasso', a.proximo_passo,
             'proximoEm', a.proximo_followup_em, 'ultimaEm', a.ultima_interacao_em,
             'valorCentavos', a.valor_estimado_centavos) as j,
           a.proximo_followup_em as quando
      from abertos a
  )
  select case when not public.usuario_financeiro() then null::jsonb else jsonb_build_object(
    'atrasados', coalesce((select jsonb_agg(j order by quando)
                             from cartao where quando < current_date), '[]'::jsonb),
    'hoje',      coalesce((select jsonb_agg(j order by quando)
                             from cartao where quando = current_date), '[]'::jsonb),
    'semana',    coalesce((select jsonb_agg(j order by quando)
                             from cartao
                            where quando > current_date
                              and quando <= current_date + 7), '[]'::jsonb),
    'semFollowup', coalesce((select jsonb_agg(j order by j->>'nome')
                             from cartao where quando is null), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.agenda_comercial() from public, anon;
grant execute on function public.agenda_comercial() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- O funil, com o que o cartao precisa
-- ---------------------------------------------------------------------------
create or replace function public.funil()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_financeiro() then null::jsonb else jsonb_build_object(
    'abertos', (select count(*) from public.leads where etapa not in ('fechado', 'perdido')),
    'valorAbertoCentavos', coalesce((select sum(valor_estimado_centavos) from public.leads
       where etapa not in ('fechado', 'perdido')), 0),
    'fechadosNoMes', (select count(*) from public.leads
       where convertido_em >= date_trunc('month', current_date)),
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'nome', l.nome, 'empresa', l.empresa, 'etapa', l.etapa,
        'valorCentavos', l.valor_estimado_centavos, 'origem', l.origem,
        'whatsapp', l.whatsapp, 'score', l.score, 'notas', l.notas,
        'historico', l.historico, 'motivo', l.motivo_desqualificacao,
        'clienteId', l.cliente_id, 'convertidoEm', l.convertido_em,
        'proximoPasso', l.proximo_passo, 'proximoEm', l.proximo_followup_em,
        'reuniaoEm', l.reuniao_em,
        'responsavelNome', (select p.nome from public.perfis p where p.user_id = l.responsavel_id),
        'ultimaEm', l.ultima_interacao_em)
        order by l.proximo_followup_em nulls last, l.atualizado_em desc)
      from public.leads l), '[]'::jsonb)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- Permissoes
-- ---------------------------------------------------------------------------
revoke all on function public.criar_lead(text, text, text, text, bigint, text, date, text)
  from public, anon;
grant execute on function public.criar_lead(text, text, text, text, bigint, text, date, text)
  to authenticated, service_role;

revoke all on function public.editar_lead(
  uuid, text, text, text, text, bigint, text, public.score_lead, timestamptz, text[]) from public, anon;
grant execute on function public.editar_lead(
  uuid, text, text, text, text, bigint, text, public.score_lead, timestamptz, text[])
  to authenticated, service_role;

revoke all on function public.registrar_interacao_do_lead(uuid, text, text, date) from public, anon;
grant execute on function public.registrar_interacao_do_lead(uuid, text, text, date)
  to authenticated, service_role;

revoke all on function public.mover_lead(uuid, public.etapa_lead, text) from public, anon;
grant execute on function public.mover_lead(uuid, public.etapa_lead, text)
  to authenticated, service_role;

revoke all on function public.converter_lead(uuid, uuid) from public, anon;
grant execute on function public.converter_lead(uuid, uuid) to authenticated, service_role;

revoke all on function public.apagar_lead(uuid) from public, anon;
grant execute on function public.apagar_lead(uuid) to authenticated, service_role;
