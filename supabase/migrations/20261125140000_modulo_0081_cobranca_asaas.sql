-- =============================================================================
-- 0081 — cobrança pela Asaas: o lado do banco
--
-- A dona: "vamos montar a estrutura asaas agora?".
--
-- O TERRENO JA ESTAVA PREPARADO, E UMA PARTE DELE MENTIA
--
-- A tabela `cobrancas` existe desde a 0020, de proposito generica (provedor,
-- externo_id, boleto_url, pix_payload) e vazia ate hoje. O conector `asaas`
-- esta registrado na 0043 com as tres chaves que ele precisa. Ate ai, bem.
--
-- Mas o PORTAL DO CLIENTE ja mostra botao de boleto e codigo pix, lendo
-- dessa tabela vazia — desde a 0036. Ou seja: mais um motor que nao existe
-- atras de uma tela que promete. E o mesmo padrao que a varredura achou no
-- financeiro, e vale escrever para nao repetir: tela que le de tabela vazia
-- nao da erro, nao aparece em teste, e so quem abre o portal descobre.
--
-- AS DECISOES DELA, E O QUE CADA UMA MUDOU AQUI
--
--   emite 10 DIAS ANTES do vencimento. A decisao antiga dizia "no dia do
--     vencimento", o que da ao cliente zero dia para pagar; ela corrigiu
--     quando eu mostrei a conta. Vira `p_dias_antes` com padrao 10;
--   SEM multa e juros. Nenhum campo de acrescimo entra, e a Asaas nao
--     recebe `fine` nem `interest`;
--   nota fiscal DEPOIS, mas com o lugar guardado: tres colunas nascem
--     vazias aqui para que ligar a emissao um dia nao exija mexer em tabela
--     com dinheiro de verdade dentro;
--   SANDBOX primeiro, ate um ciclo fechar.
--
-- O PIOR BUG POSSIVEL DESTE MODULO
--
-- Cobrar o cliente de outra pessoa duas vezes. Ele tem dois caminhos, e os
-- dois estao fechados aqui:
--
--   1. emitir duas vezes — `cobrancas.lancamento_id` e UNIQUE desde a 0020,
--      entao um lancamento tem no maximo uma cobranca, por construcao;
--   2. processar o mesmo aviso duas vezes — a Asaas REENVIA o webhook
--      quando nao recebe 200, entao receber o mesmo evento duas vezes e o
--      caso normal, nao a excecao. `cobranca_eventos.evento_externo_id` e
--      unique, e o registro acontece na MESMA transacao da baixa.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. O CLIENTE GANHA DADOS DE COBRANCA
--
-- A Asaas nao cria cobranca solta: ela cobra um "customer" dela, e esse
-- customer exige CPF ou CNPJ. Hoje `clientes` tem nome, slug e fuso — nada
-- com que emitir um boleto.
--
-- Guardo SO DIGITOS. Mascara e coisa de tela: no banco, "12.345.678/0001-90"
-- e "12345678000190" seriam dois clientes diferentes para qualquer busca.
-- ---------------------------------------------------------------------------
alter table public.clientes
  add column if not exists cnpj_cpf text,
  add column if not exists email_cobranca text,
  add column if not exists telefone text,
  -- O espelho do cadastro na Asaas. Nulo = ainda nao foi criado la.
  add column if not exists asaas_customer_id text,
  -- DE QUAL AMBIENTE veio esse codigo.
  --
  -- Sandbox e producao nao compartilham NADA: o cliente criado num nao
  -- existe no outro. Sem esta coluna, no dia da virada a plataforma tentaria
  -- cobrar codigos fantasmas e erraria de um jeito confuso — "customer not
  -- found" para todo mundo, sem dizer por que. Com ela, o emissor ve que o
  -- codigo e de outro ambiente e simplesmente cria o cliente de novo.
  add column if not exists asaas_ambiente text;

do $$ begin
  alter table public.clientes
    add constraint clientes_asaas_ambiente_coerente
    check ((asaas_customer_id is null) = (asaas_ambiente is null)
           and (asaas_ambiente is null or asaas_ambiente in ('sandbox', 'producao')));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.clientes
    add constraint clientes_cnpj_cpf_digitos
    check (cnpj_cpf is null or cnpj_cpf ~ '^[0-9]{11}$' or cnpj_cpf ~ '^[0-9]{14}$');
exception when duplicate_object then null; end $$;

create unique index if not exists clientes_asaas_customer_idx
  on public.clientes (asaas_customer_id) where asaas_customer_id is not null;

comment on column public.clientes.cnpj_cpf is
  'So digitos: 11 para CPF, 14 para CNPJ. A mascara e da tela.';

-- ---------------------------------------------------------------------------
-- 2. A COBRANCA GANHA ESTADO
--
-- Ela so guardava os links. Sem estado nao ha como saber que uma emissao
-- falhou — e falha silenciosa e proibida. `ultimo_erro` em portugues porque
-- e ele que aparece na tela.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.estado_cobranca as enum
    ('a_emitir', 'emitida', 'paga', 'cancelada', 'falhou');
exception when duplicate_object then null; end $$;

alter table public.cobrancas
  add column if not exists status public.estado_cobranca not null default 'a_emitir',
  add column if not exists valor_centavos bigint,
  add column if not exists vencimento date,
  add column if not exists tentativas smallint not null default 0,
  add column if not exists ultimo_erro text,
  add column if not exists erro_em timestamptz,
  add column if not exists pago_em date,
  add column if not exists valor_pago_centavos bigint,
  add column if not exists forma_paga text,
  add column if not exists atualizado_em timestamptz not null default now(),
  -- O LUGAR DA NOTA FISCAL, vazio de proposito. Decisao dela: "depois, mas
  -- ja deixe o lugar". Acrescentar coluna numa tabela com dinheiro dentro e
  -- mais caro do que deixar tres colunas nulas agora.
  add column if not exists nota_fiscal_id text,
  add column if not exists nota_fiscal_url text,
  add column if not exists nota_fiscal_status text,
  -- Mesmo motivo da coluna no cliente: um `externo_id` de sandbox nao
  -- significa nada em producao, e sem saber de onde ele veio a tela mostraria
  -- um boleto que nao existe mais.
  add column if not exists ambiente text;

drop trigger if exists cobrancas_atualizado_em on public.cobrancas;
create trigger cobrancas_atualizado_em
  before update on public.cobrancas
  for each row execute function public.tg_set_atualizado_em();

create index if not exists cobrancas_status_idx on public.cobrancas (status, vencimento);

-- ---------------------------------------------------------------------------
-- 3. OS AVISOS DA ASAAS, APPEND-ONLY
--
-- A Asaas reenvia o webhook ate receber 200. Receber o mesmo evento duas
-- vezes e o caso NORMAL. `evento_externo_id` unique e o que transforma o
-- reenvio em no-op em vez de baixa dupla.
--
-- Append-only pelo mesmo gatilho das outras tabelas de evento: o historico
-- de dinheiro nao se corrige, se acrescenta.
-- ---------------------------------------------------------------------------
create table if not exists public.cobranca_eventos (
  id                 bigint generated always as identity primary key,
  /** O id do evento NA ASAAS. E a chave da idempotencia. */
  evento_externo_id  text not null unique,
  cobranca_id        uuid references public.cobrancas(id) on delete set null,
  tipo               text not null,
  carga              jsonb not null default '{}'::jsonb,
  recebido_em        timestamptz not null default now()
);

create index if not exists cobranca_eventos_cobranca_idx
  on public.cobranca_eventos (cobranca_id, recebido_em desc);

create or replace function public.tg_cobranca_eventos_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'cobranca_eventos e append-only: % nao e permitido', tg_op;
end;
$$;
revoke all on function public.tg_cobranca_eventos_append_only()
  from public, anon, authenticated;

drop trigger if exists cobranca_eventos_append_only on public.cobranca_eventos;
create trigger cobranca_eventos_append_only
  before update or delete on public.cobranca_eventos
  for each row execute function public.tg_cobranca_eventos_append_only();

alter table public.cobranca_eventos enable row level security;
revoke all on public.cobranca_eventos from anon;

drop policy if exists cobranca_eventos_dinheiro_le on public.cobranca_eventos;
create policy cobranca_eventos_dinheiro_le on public.cobranca_eventos
  for select to authenticated
  using (public.usuario_financeiro() or public.usuario_admin());
grant select on public.cobranca_eventos to authenticated;

-- ---------------------------------------------------------------------------
-- 4. CADASTRAR OS DADOS DE COBRANCA — pela tela
-- ---------------------------------------------------------------------------
create or replace function public.salvar_dados_de_cobranca(
  p_cliente  uuid,
  p_cnpj_cpf text default null,
  p_email    text default null,
  p_telefone text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_digitos text;
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'Dados de cobranca sao de quem cuida do dinheiro.';
  end if;

  -- Tira mascara aqui, uma vez, em vez de confiar em toda tela que escrever.
  v_digitos := nullif(regexp_replace(coalesce(p_cnpj_cpf, ''), '[^0-9]', '', 'g'), '');
  if v_digitos is not null and length(v_digitos) not in (11, 14) then
    raise exception 'CPF tem 11 digitos e CNPJ tem 14. Vieram %.', length(v_digitos);
  end if;

  update public.clientes set
    cnpj_cpf       = coalesce(v_digitos, cnpj_cpf),
    email_cobranca = coalesce(nullif(btrim(coalesce(p_email, '')), ''), email_cobranca),
    telefone       = coalesce(
      nullif(regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'), ''), telefone)
  where id = p_cliente;

  if not found then raise exception 'Cliente nao encontrado.'; end if;
end;
$$;

revoke all on function public.salvar_dados_de_cobranca(uuid, text, text, text)
  from public, anon;
grant execute on function public.salvar_dados_de_cobranca(uuid, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. O QUE A RODADA TEM DE EMITIR
--
-- Dez dias antes do vencimento, decisao dela. Entra o lancamento de RECEITA
-- que ainda nao foi pago, de cliente que tem CPF/CNPJ, e que ainda nao tem
-- cobranca viva.
--
-- Repare no `left join`: a cobranca que FALHOU volta para a fila, porque
-- erro de rede nao e motivo para o cliente nunca receber o boleto. A que
-- esta `emitida` ou `paga` nao volta — e essa e a trava contra cobrar duas
-- vezes.
-- ---------------------------------------------------------------------------
create or replace function public.cobrancas_para_emitir(
  p_ambiente   text default 'sandbox',
  p_dias_antes int default 10,
  p_limite     int default 100
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object(
      'lancamentoId',  l.id,
      'clienteId',     c.id,
      'clienteNome',   c.nome,
      'cnpjCpf',       c.cnpj_cpf,
      'email',         c.email_cobranca,
      'telefone',      c.telefone,
      -- So devolve o codigo se ele for DESTE ambiente. De outro, volta nulo
      -- e o emissor cria o cliente de novo, em vez de cobrar um fantasma.
      'asaasCustomer', case when c.asaas_ambiente = p_ambiente
                           then c.asaas_customer_id end,
      'descricao',     l.descricao,
      'valorCentavos', l.valor_centavos,
      'vencimento',    l.vencimento,
      'tentativas',    coalesce(cb.tentativas, 0)) as x
      from public.lancamentos l
      join public.clientes c on c.id = l.cliente_id
      join public.financeiro_subcategorias sub on sub.id = l.subcategoria_id
      join public.financeiro_categorias cat on cat.id = sub.categoria_id
      join public.financeiro_grupos g on g.id = cat.grupo_id
      left join public.cobrancas cb on cb.lancamento_id = l.id
     where g.natureza = 'receita'
       and l.status = 'previsto'
       and l.vencimento is not null
       and l.vencimento <= current_date + greatest(0, coalesce(p_dias_antes, 10))
       and c.cnpj_cpf is not null
       -- Nunca emitida, ou emitida e falhou. Emitida com sucesso e paga NAO
       -- voltam: e aqui que mora a trava contra a cobranca em duplicata.
       and (cb.id is null or cb.status = 'falhou')
       -- Tres tentativas e o suficiente para separar queda de rede de
       -- cadastro errado. Depois disso alguem tem de olhar.
       and coalesce(cb.tentativas, 0) < 3
     order by l.vencimento
     limit greatest(1, least(coalesce(p_limite, 100), 500))
  ) y;
$$;

revoke all on function public.cobrancas_para_emitir(text, int, int)
  from public, anon, authenticated;
grant execute on function public.cobrancas_para_emitir(text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 6. O QUE A RODADA GRAVA DE VOLTA
-- ---------------------------------------------------------------------------
create or replace function public.casar_cliente_com_asaas(
  p_cliente     uuid,
  p_customer_id text,
  p_ambiente    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_ambiente not in ('sandbox', 'producao') then
    raise exception 'Ambiente da Asaas tem de ser sandbox ou producao, veio "%".', p_ambiente;
  end if;
  update public.clientes
     set asaas_customer_id = p_customer_id, asaas_ambiente = p_ambiente
   where id = p_cliente;
  if not found then raise exception 'Cliente nao encontrado.'; end if;
end;
$$;

revoke all on function public.casar_cliente_com_asaas(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.casar_cliente_com_asaas(uuid, text, text) to service_role;

create or replace function public.cobranca_emitida(
  p_lancamento    uuid,
  p_externo_id    text,
  p_boleto_url    text default null,
  p_pix           text default null,
  p_vencimento    date default null,
  p_valor_centavos bigint default null,
  p_ambiente      text default 'sandbox'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  -- `lancamento_id` e UNIQUE: o `on conflict` abaixo e o que faz uma rodada
  -- repetida atualizar em vez de criar uma segunda cobranca.
  insert into public.cobrancas
    (lancamento_id, provedor, externo_id, boleto_url, pix_payload,
     status, vencimento, valor_centavos, emitida_em, tentativas, ultimo_erro, erro_em,
     ambiente)
  values
    (p_lancamento, 'asaas', p_externo_id, p_boleto_url, p_pix,
     'emitida', p_vencimento, p_valor_centavos, now(), 0, null, null,
     p_ambiente)
  on conflict (lancamento_id) do update set
    provedor      = 'asaas',
    externo_id    = excluded.externo_id,
    boleto_url    = excluded.boleto_url,
    pix_payload   = excluded.pix_payload,
    status        = 'emitida',
    vencimento    = excluded.vencimento,
    valor_centavos = excluded.valor_centavos,
    emitida_em    = now(),
    ambiente      = excluded.ambiente,
    ultimo_erro   = null,
    erro_em       = null
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.cobranca_emitida(uuid, text, text, text, date, bigint, text)
  from public, anon, authenticated;
grant execute on function public.cobranca_emitida(uuid, text, text, text, date, bigint, text)
  to service_role;

create or replace function public.cobranca_falhou(p_lancamento uuid, p_erro text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.cobrancas (lancamento_id, provedor, status, tentativas, ultimo_erro, erro_em)
  values (p_lancamento, 'asaas', 'falhou', 1, p_erro, now())
  on conflict (lancamento_id) do update set
    status      = 'falhou',
    tentativas  = public.cobrancas.tentativas + 1,
    ultimo_erro = p_erro,
    erro_em     = now();
end;
$$;

revoke all on function public.cobranca_falhou(uuid, text) from public, anon, authenticated;
grant execute on function public.cobranca_falhou(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. O AVISO DE PAGAMENTO
--
-- Idempotencia de verdade: o registro do evento e a baixa acontecem na MESMA
-- transacao. Se o `insert` em `cobranca_eventos` esbarrar no unique, nada
-- disto roda e a funcao devolve `false` — reenvio vira no-op, nao baixa
-- dupla nem erro.
--
-- Por que nao chamo `liquidar_lancamento`: aquela funcao exige
-- `usuario_financeiro()`, e quem chega aqui e a Edge Function com service
-- role, sem `auth.uid()`. Duplicar as tres linhas do update e melhor do que
-- afrouxar a trava daquela, que protege a tela.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_evento_de_cobranca(
  p_evento_id    text,
  p_tipo         text,
  p_externo_id   text,
  p_carga        jsonb default '{}'::jsonb,
  p_pago_em      date default null,
  p_valor_pago_centavos bigint default null,
  p_forma        text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cobranca public.cobrancas;
  v_pago     boolean;
begin
  if p_evento_id is null or length(btrim(p_evento_id)) = 0 then
    raise exception 'O aviso da Asaas veio sem id de evento.';
  end if;

  select * into v_cobranca from public.cobrancas
   where provedor = 'asaas' and externo_id = p_externo_id;

  begin
    insert into public.cobranca_eventos (evento_externo_id, cobranca_id, tipo, carga)
    values (btrim(p_evento_id), v_cobranca.id, p_tipo, coalesce(p_carga, '{}'::jsonb));
  exception when unique_violation then
    -- Ja processado. A Asaas reenvia ate receber 200; dizer "ja vi este" e a
    -- resposta certa, nao um erro.
    return false;
  end;

  if v_cobranca.id is null then
    -- Evento de uma cobranca que nao e nossa (ou de antes da integracao).
    -- Fica registrado e nao mexe em dinheiro nenhum.
    return true;
  end if;

  v_pago := p_tipo in ('PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED');

  if v_pago then
    update public.cobrancas set
      status = 'paga',
      pago_em = coalesce(p_pago_em, current_date),
      valor_pago_centavos = coalesce(p_valor_pago_centavos, valor_centavos),
      forma_paga = p_forma
    where id = v_cobranca.id;

    -- E o lancamento e liquidado junto: cobranca paga com lancamento em
    -- aberto faria o painel mentir no numero que ela mais olha.
    update public.lancamentos set
      status       = 'liquidado',
      liquidado_em = coalesce(p_pago_em, current_date)
    where id = v_cobranca.lancamento_id
      and status <> 'liquidado';

  elsif p_tipo in ('PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED') then
    update public.cobrancas set status = 'cancelada' where id = v_cobranca.id;
    update public.lancamentos set status = 'previsto', liquidado_em = null
     where id = v_cobranca.lancamento_id and status = 'liquidado';
  end if;

  return true;
end;
$$;

revoke all on function public.registrar_evento_de_cobranca(
  text, text, text, jsonb, date, bigint, text) from public, anon, authenticated;
grant execute on function public.registrar_evento_de_cobranca(
  text, text, text, jsonb, date, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. O QUE A TELA DO FINANCEIRO MOSTRA
-- ---------------------------------------------------------------------------
create or replace function public.cobrancas_do_mes(p_mes date default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.usuario_financeiro() or public.usuario_admin() then
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'lancamentoId', l.id,
        'descricao',    l.descricao,
        'cliente',      c.nome,
        'temCnpjCpf',   c.cnpj_cpf is not null,
        'status',       coalesce(cb.status::text, 'sem_cobranca'),
        'vencimento',   l.vencimento,
        'boletoUrl',    cb.boleto_url,
        'pix',          cb.pix_payload,
        'tentativas',   coalesce(cb.tentativas, 0),
        'ultimoErro',   cb.ultimo_erro)
        order by l.vencimento, l.descricao)
        from public.lancamentos l
        join public.clientes c on c.id = l.cliente_id
        join public.financeiro_subcategorias sub on sub.id = l.subcategoria_id
        join public.financeiro_categorias cat on cat.id = sub.categoria_id
        join public.financeiro_grupos g on g.id = cat.grupo_id
        left join public.cobrancas cb on cb.lancamento_id = l.id
       where g.natureza = 'receita'
         and l.competencia = date_trunc('month', coalesce(p_mes, current_date))::date
    ), '[]'::jsonb)
  end;
$$;

revoke all on function public.cobrancas_do_mes(date) from public, anon;
grant execute on function public.cobrancas_do_mes(date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. O CONECTOR CONTINUA MARCADO COMO NAO CONSTRUIDO — de proposito
--
-- Eu tinha escrito `update conectores set construida = true` aqui, e o teste
-- 24 me derrubou com razao. `construida` separa "falta a chave" de "falta eu
-- escrever o codigo", e o que existe ate agora e so o lado do BANCO: nao ha
-- Edge Function que fale com a Asaas. Marcar como construida agora faria a
-- tela de Ajustes dizer a ela "e so cadastrar a chave" — e cadastrar nao
-- emitiria cobranca nenhuma.
--
-- A virada acontece na migration que acompanhar a Edge Function.
-- ---------------------------------------------------------------------------
