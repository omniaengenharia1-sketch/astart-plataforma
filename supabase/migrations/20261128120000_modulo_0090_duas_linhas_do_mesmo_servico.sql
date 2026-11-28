-- =============================================================================
-- 0090 — o mesmo serviço mais de uma vez no mesmo cliente
--
-- A dona: "igual a dona Zilda, né? Que eu fiz um ensaio pra ela, eu dei um
-- ensaio pra ela de graça. E aí eu vou fazer as fotos do aniversário dela, que
-- aí vai ser R$ 500. Aí eu queria ver se dá pra colocar, tipo, no cliente,
-- colocar 2 cobranças. [...] Porque muitas vezes o cliente faz a gestão
-- digital comigo, mas aí depois fecha uma captação".
--
-- A segunda metade — gestão digital mais captação — JÁ FUNCIONAVA: são
-- serviços diferentes. O que não funcionava era a primeira: o ensaio e o
-- aniversário são os dois audiovisual, e a tabela tinha
-- `unique (cliente_id, servico_id)`. Um serviço por cliente, uma vez só.
--
-- O SEGUNDO DEFEITO, ESCONDIDO ATRÁS DO PRIMEIRO
--
-- Tirar só a trava não resolveria, e o jeito como não resolveria é o pior
-- possível: `gerar_cobrancas_do_contrato` conferia se a cobrança já existia
-- procurando a DESCRIÇÃO (`Audiovisual — parcela 1 de 1`) no cliente. Duas
-- captações do mesmo cliente escreveriam a mesma descrição, a segunda seria
-- lida como repetida, e os R$ 500 simplesmente não apareceriam. Sem erro, sem
-- log, sem nada.
--
-- Por isso o `lancamentos.cliente_servico_id`: o lançamento passa a saber de
-- QUAL linha do contrato ele nasceu, e a conferência de repetido é por linha.
-- Um índice único faz a mesma trava no banco, para o caso de duas rodadas
-- correndo juntas — cobrar o cliente duas vezes é o pior bug deste sistema.
--
-- O BACKFILL É COMPLETO, e isso foi medido, não suposto
--
-- Lançamento de contrato que ficasse sem vínculo seria cobrado DE NOVO pela
-- regra nova. Conferi na produção antes de escrever: 10 lançamentos, 9 batem
-- com uma linha de contrato pela descrição antiga, 0 ambíguos. O décimo é um
-- lançamento feito à mão, que não deve ter vínculo mesmo.
--
-- CORTESIA
--
-- Decisão dela, perguntada: a linha de R$ 0 fica no contrato e NÃO aparece no
-- Financeiro. Uma linha de R$ 0 que virasse lançamento entraria na fila da
-- Asaas, que recusa cobrança de valor zero — a rodada passaria a falhar todo
-- dia por causa de um presente.
--
-- O APELIDO
--
-- Cada linha ganha um nome curto que ela escreve: "Ensaio cortesia",
-- "Aniversário da Zilda". Aparece no contrato, no financeiro e — decisão dela
-- também — NO BOLETO que o cliente recebe, no lugar de "Audiovisual — parcela
-- 1 de 1". Com dois trabalhos no mesmo cliente, é o que evita a ligação
-- perguntando de qual cobrança se trata.
--
-- O que vem depois do bloco de DDL são oito funções recriadas. Os corpos
-- saíram de `pg_get_functiondef()` do banco construído por estas migrations,
-- palavra por palavra; só o que está comentado mudou.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. AS ASSINATURAS ANTIGAS SAEM ANTES
--
-- Uma funcao de N parametros e outra de N+1 com default convivem no Postgres
-- como duas funcoes diferentes, e a chamada de N vira ambigua ("function is
-- not unique"). Foi a licao da 0086, e vale igual aqui.
-- ---------------------------------------------------------------------------
drop function if exists public.adicionar_servico_ao_cliente(
  uuid, text, text, bigint, smallint, smallint, date, date, date, uuid[], text, text[]);
drop function if exists public.alterar_servico_do_cliente(
  uuid, bigint, smallint, smallint, date, date, uuid[], text);

-- ---------------------------------------------------------------------------
-- 1. O NOME DE CADA LINHA
-- ---------------------------------------------------------------------------
alter table public.cliente_servicos add column if not exists apelido text;

alter table public.cliente_servicos drop constraint if exists cliente_servicos_apelido_curto;
alter table public.cliente_servicos add constraint cliente_servicos_apelido_curto
  -- Sessenta caracteres porque ele vai no boleto, e boleto com um parágrafo
  -- na descrição e um boleto que o banco do cliente corta no meio.
  check (apelido is null or length(btrim(apelido)) between 1 and 60);

-- COLUNA NOVA NASCE SEM GRANT, e esta tabela e por COLUNA.
--
-- `cliente_servicos` nao tem `select` de tabela para `authenticated`: tem
-- `select` em 12 das 16 colunas, de proposito — `valor_centavos`,
-- `dia_vencimento` e `parcelas` ficam de fora porque dinheiro so passa pelas
-- funcoes que conferem quem esta lendo.
--
-- Entao a coluna nova precisa do grant explicito, senao a `ficha_cliente`
-- (que e `security invoker`) para de abrir com "permission denied for table
-- cliente_servicos" — para TODO MUNDO, e nao so para quem nao ve dinheiro.
-- Foi o que quatro testes da bateria apontaram no primeiro rodar.
--
-- O apelido nao e dinheiro: ele acompanha `observacao`, que tem os quatro.
grant select (apelido), insert (apelido), update (apelido), references (apelido)
  on public.cliente_servicos to authenticated;
grant select (apelido), insert (apelido), update (apelido), references (apelido)
  on public.cliente_servicos to service_role;

comment on column public.cliente_servicos.apelido is
  'O nome desta linha do contrato: "Ensaio cortesia", "Aniversario da Zilda". '
  'Nulo quer dizer "chame pelo nome do servico". Vai no boleto.';

-- ---------------------------------------------------------------------------
-- 2. A TRAVA DE UM SERVIÇO POR CLIENTE SAI
-- ---------------------------------------------------------------------------
alter table public.cliente_servicos
  drop constraint if exists cliente_servicos_cliente_id_servico_id_key;

-- ---------------------------------------------------------------------------
-- 3. O LANÇAMENTO SABE DE ONDE VEIO
--
-- `on delete set null`, e não cascade: apagar uma linha do contrato não pode
-- sumir com o dinheiro que já foi lançado. Conferido antes de escrever, que é
-- a lição da 0085: `lancamentos` não é append-only, os dois gatilhos dela são
-- o de `atualizado_em` e o do rateio, e nenhum barra este UPDATE.
-- ---------------------------------------------------------------------------
alter table public.lancamentos add column if not exists cliente_servico_id uuid
  references public.cliente_servicos(id) on delete set null;

create index if not exists lancamentos_contrato_idx
  on public.lancamentos (cliente_servico_id) where cliente_servico_id is not null;

-- O BACKFILL. Casa pela descrição que a função antiga escrevia, que começa
-- sempre com o nome do serviço seguido de " — ". Enquanto a trava única
-- existiu havia no máximo UMA linha por (cliente, serviço), então o casamento
-- é exato: medido em produção, 9 de 9, nenhum ambíguo.
update public.lancamentos l
   set cliente_servico_id = cs.id
  from public.cliente_servicos cs
  join public.servicos s on s.id = cs.servico_id
 where l.cliente_servico_id is null
   and cs.cliente_id = l.cliente_id
   and l.descricao like s.nome || ' — %';

-- E A TRAVA DE VERDADE CONTRA COBRAR DUAS VEZES.
--
-- A conferência em plpgsql resolve a rodada normal; este índice resolve duas
-- rodadas ao mesmo tempo, que é quando a conferência de aplicação perde. Uma
-- linha de contrato tem no máximo um lançamento por competência: recorrente é
-- um por mês, e as parcelas caem cada uma num mês diferente.
create unique index if not exists lancamentos_uma_vez_por_competencia
  on public.lancamentos (cliente_servico_id, competencia)
  where cliente_servico_id is not null;

CREATE OR REPLACE FUNCTION public.adicionar_servico_ao_cliente(p_cliente uuid, p_servico text, p_formato text DEFAULT NULL::text, p_valor_centavos bigint DEFAULT NULL::bigint, p_dia_vencimento smallint DEFAULT NULL::smallint, p_parcelas smallint DEFAULT NULL::smallint, p_inicio date DEFAULT NULL::date, p_entrega_em date DEFAULT NULL::date, p_data_evento date DEFAULT NULL::date, p_responsaveis uuid[] DEFAULT NULL::uuid[], p_observacao text DEFAULT NULL::text, p_apelido text DEFAULT NULL::text, p_modulos text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_servico  public.servicos;
  v_formato  public.formato_contrato;
  v_coer     record;
  v_valor    bigint;
  v_cs       uuid;
  v_modulo   text;
  v_mid      uuid;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para mexer no contrato.';
  end if;
  if not public.usuario_ve_cliente(p_cliente) then
    raise exception 'Cliente % não encontrado.', p_cliente;
  end if;

  select * into v_servico from public.servicos s where s.chave = p_servico;
  if not found then
    raise exception 'Serviço desconhecido: %.', coalesce(p_servico, '(vazio)');
  end if;

  v_formato := coalesce(nullif(btrim(coalesce(p_formato, '')), '')::public.formato_contrato,
                        v_servico.formato_padrao);
  select * into v_coer
    from public.coerir_contrato(v_servico.nome, v_formato, p_dia_vencimento, p_parcelas);

  -- Valor é dinheiro: quem não vê não escreve. Nulo vindo de quem não vê é
  -- tratado como "não mexer", e não como zero — zero seria um contrato de
  -- graça criado por quem não podia nem ler o campo.
  v_valor := coalesce(p_valor_centavos, 0);
  if p_valor_centavos is not null and not public.ve_valor_do_contrato(p_cliente) then
    raise exception
      'Seu acesso não mexe em valor de contrato. Peça para a direção ou o financeiro '
      'lançar o valor.';
  end if;
  if v_valor < 0 then
    raise exception 'O valor de % não pode ser negativo.', v_servico.nome;
  end if;

  -- A TRAVA DE "JA TEM" SAIU AQUI (0090).
  --
  -- A dona: "igual a dona Zilda, eu dei um ensaio pra ela de graca. E aí eu
  -- vou fazer as fotos do aniversario dela, que aí vai ser R$ 500".
  --
  -- Os dois sao audiovisual. Com `unique (cliente_id, servico_id)` o segundo
  -- era recusado com "este cliente ja tem Audiovisual no contrato", e a saida
  -- dela seria escrever por cima do primeiro — perdendo o ensaio.
  --
  -- Junto com a trava foi embora a REATIVACAO automatica: antes, adicionar um
  -- servico encerrado fazia a MESMA linha voltar a valer. Com varias linhas
  -- possiveis isso virou ambiguo (voltar qual?), e a resposta certa para o
  -- caso dela e justamente NAO voltar: o ensaio fica encerrado, com a galeria
  -- e o historico pendurados nele, e o aniversario nasce como linha nova.
  -- Retomar uma linha especifica continua existindo, em
  -- `mudar_estado_do_servico`.
  insert into public.cliente_servicos (
    cliente_id, servico_id, formato, valor_centavos, dia_vencimento, parcelas,
    inicio, entrega_em, data_evento, observacao, apelido)
  values (
    p_cliente, v_servico.id, v_formato, v_valor, v_coer.dia_vencimento, v_coer.parcelas,
    coalesce(p_inicio, current_date), p_entrega_em,
    case when v_formato = 'recorrente' then null else p_data_evento end,
    nullif(btrim(coalesce(p_observacao, '')), ''),
    nullif(btrim(coalesce(p_apelido, '')), ''))
  returning id into v_cs;

  -- Nulo quer dizer "nao mexe"; lista vazia quer dizer "tire todos".
  if p_responsaveis is not null then
    perform public.definir_responsaveis_do_servico(v_cs, p_responsaveis);
  end if;

  -- Chaves de módulo opcional. O gatilho da 0015 recusa override de módulo
  -- que o serviço sempre liga, e a mensagem aqui diz isso antes de bater nele.
  foreach v_modulo in array coalesce(p_modulos, array[]::text[]) loop
    select m.id into v_mid
      from public.modulos m
      join public.servico_modulos sm on sm.modulo_id = m.id
     where m.chave = v_modulo and sm.servico_id = v_servico.id and sm.opcional;
    if v_mid is null then
      raise exception 'O módulo "%" não é uma opção de %.', v_modulo, v_servico.nome;
    end if;
    insert into public.cliente_servico_modulos (cliente_servico_id, modulo_id, ligado)
    values (v_cs, v_mid, true)
    on conflict (cliente_servico_id, modulo_id) do update set ligado = true;
  end loop;

  return jsonb_build_object(
    'id', v_cs,
    'servico', v_servico.nome,
    'reativou', false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.alterar_servico_do_cliente(p_cliente_servico uuid, p_valor_centavos bigint DEFAULT NULL::bigint, p_dia_vencimento smallint DEFAULT NULL::smallint, p_parcelas smallint DEFAULT NULL::smallint, p_entrega_em date DEFAULT NULL::date, p_data_evento date DEFAULT NULL::date, p_responsaveis uuid[] DEFAULT NULL::uuid[], p_observacao text DEFAULT NULL::text, p_apelido text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cs      public.cliente_servicos;
  v_nome    text;
  v_coer    record;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para mexer no contrato.';
  end if;

  select * into v_cs from public.cliente_servicos cs where cs.id = p_cliente_servico;
  if not found or not public.usuario_ve_cliente(v_cs.cliente_id) then
    raise exception 'Serviço do contrato % não encontrado.', p_cliente_servico;
  end if;

  select s.nome into v_nome from public.servicos s where s.id = v_cs.servico_id;

  if p_valor_centavos is not null then
    if not public.ve_valor_do_contrato(v_cs.cliente_id) then
      raise exception
        'Seu acesso não mexe em valor de contrato. Peça para a direção ou o financeiro.';
    end if;
    if p_valor_centavos < 0 then
      raise exception 'O valor de % não pode ser negativo.', v_nome;
    end if;
  end if;

  -- As regras de formato valem na alteração também: um recorrente não pode
  -- ficar sem dia de vencimento porque alguém mandou nulo de propósito.
  select * into v_coer from public.coerir_contrato(
    v_nome,
    v_cs.formato,
    coalesce(p_dia_vencimento, v_cs.dia_vencimento),
    coalesce(p_parcelas, v_cs.parcelas)
  );

  update public.cliente_servicos
     set valor_centavos = coalesce(p_valor_centavos, valor_centavos),
         dia_vencimento = v_coer.dia_vencimento,
         parcelas       = v_coer.parcelas,
         entrega_em     = coalesce(p_entrega_em, entrega_em),
         data_evento    = case when v_cs.formato = 'recorrente' then null
                               else coalesce(p_data_evento, data_evento) end,
         observacao     = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao),
         -- O apelido da linha. Vazio NAO apaga: nulo aqui quer dizer "nao
         -- mexe", como no resto desta funcao. Para tirar o apelido, a tela
         -- manda um espaco — e `btrim` devolve vazio, que vira nulo.
         apelido        = case when p_apelido is null then apelido
                               else nullif(btrim(p_apelido), '') end,
         atualizado_em  = now()
   where id = p_cliente_servico;

  -- Nulo quer dizer "nao mexe"; lista vazia quer dizer "tire todos".
  if p_responsaveis is not null then
    perform public.definir_responsaveis_do_servico(p_cliente_servico, p_responsaveis);
  end if;

  return jsonb_build_object('id', p_cliente_servico, 'servico', v_nome);
end;
$function$;

CREATE OR REPLACE FUNCTION public.gerar_cobrancas_do_contrato(p_cliente_servico_id uuid, p_competencia date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cs    public.cliente_servicos;
  v_sub   uuid;
  v_nome  text;
  v_mes   date := date_trunc('month', p_competencia)::date;
  v_venc  date;
  v_n     integer := 0;
  v_i     smallint;
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'Sem permissão para gerar cobrança.';
  end if;

  select * into v_cs from public.cliente_servicos where id = p_cliente_servico_id;
  if v_cs.id is null then raise exception 'Contrato não encontrado.'; end if;

  -- O NOME QUE VAI NA COBRANCA e o apelido da linha, quando ela tem um.
  --
  -- Com duas captacoes no mesmo cliente, "Audiovisual — parcela 1 de 1" nas
  -- duas faz o cliente ligar perguntando de qual se trata. A dona escreve
  -- "Aniversario da Zilda" e e isso que ele le no boleto.
  select coalesce(nullif(btrim(coalesce(v_cs.apelido, '')), ''), s.nome) into v_nome
    from public.servicos s where s.id = v_cs.servico_id;

  -- CORTESIA NAO VIRA COBRANCA.
  --
  -- A dona deu o ensaio de graca para a dona Zilda e quer a linha no
  -- contrato assim mesmo, "so pra deixar tudo organizado". Uma linha de
  -- R$ 0 nao pode gerar lancamento: ele entraria na fila da Asaas, que
  -- recusa cobranca de valor zero, e a rodada passaria a falhar todo dia
  -- por causa de um presente.
  if coalesce(v_cs.valor_centavos, 0) = 0 then
    return 0;
  end if;

  select sub.id into v_sub
    from public.financeiro_subcategorias sub
    join public.financeiro_categorias cat on cat.id = sub.categoria_id
    join public.financeiro_grupos       g on g.id = cat.grupo_id
   where g.chave = 'receita' and cat.nome = 'Contrato'
     and sub.nome = case v_cs.formato
                      when 'recorrente' then 'Recorrente'
                      when 'projeto'    then 'Projeto'
                      else 'Pontual' end;

  if v_cs.formato = 'recorrente' then
    -- AQUI. `make_date(2026, 2, 30)` estourava; `dia_do_mes` cai para 28.
    v_venc := public.dia_do_mes(v_mes, v_cs.dia_vencimento);
    -- A CONFERENCIA DE REPETIDO E POR LINHA DO CONTRATO, nao por descricao.
    --
    -- Era `descricao = nome do servico || mes`, e isso quebrava exatamente no
    -- caso de duas linhas do mesmo servico: a segunda seria lida como ja
    -- gerada e nao cobraria NADA — sem erro em lugar nenhum. O indice unico
    -- criado nesta migration faz a mesma trava no banco, para o caso de duas
    -- rodadas ao mesmo tempo.
    if exists (select 1 from public.lancamentos
                where cliente_servico_id = v_cs.id and competencia = v_mes) then
      return 0;
    end if;
    insert into public.lancamentos
      (descricao, subcategoria_id, cliente_id, valor_centavos, competencia, vencimento,
       criado_por, cliente_servico_id)
    values (v_nome || ' — ' || to_char(v_mes, 'MM/YYYY'), v_sub, v_cs.cliente_id,
            v_cs.valor_centavos, v_mes, v_venc, auth.uid(), v_cs.id);
    return 1;
  end if;

  -- projeto e pontual: uma linha por parcela, mes a mes a partir da competencia
  -- Mesma coisa para as parcelas: por LINHA. O `like` por nome do servico
  -- fazia a segunda captacao do mesmo cliente nascer sem cobranca nenhuma.
  if exists (select 1 from public.lancamentos where cliente_servico_id = v_cs.id) then
    return 0;
  end if;

  for v_i in 1 .. v_cs.parcelas loop
    insert into public.lancamentos
      (descricao, subcategoria_id, cliente_id, valor_centavos, competencia, vencimento,
       criado_por, cliente_servico_id)
    values (format('%s — parcela %s de %s', v_nome, v_i, v_cs.parcelas), v_sub, v_cs.cliente_id,
            -- a ultima parcela absorve o centavo que a divisao deixou
            case when v_i < v_cs.parcelas
                 then v_cs.valor_centavos / v_cs.parcelas
                 else v_cs.valor_centavos - (v_cs.valor_centavos / v_cs.parcelas) * (v_cs.parcelas - 1)
            end,
            (v_mes + make_interval(months => v_i - 1))::date,
            (v_mes + make_interval(months => v_i - 1))::date + 14,
            auth.uid(), v_cs.id);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;
CREATE OR REPLACE FUNCTION public.gerar_cobrancas_do_mes(p_competencia date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_mes   date := date_trunc('month', coalesce(p_competencia, current_date))::date;
  v_fim   date := (v_mes + interval '1 month - 1 day')::date;
  r       record;
  v_n     integer;
  v_comp  date;
  v_crii  integer := 0;
  v_ja    integer := 0;
  v_cort  integer := 0;
  v_erros integer := 0;
  v_linhas jsonb := '[]'::jsonb;
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'Gerar cobrança é de quem cuida do dinheiro.';
  end if;

  for r in
    select cs.id,
           cs.formato,
           cs.valor_centavos,
           cs.apelido,
           cs.parcelas,
           cs.inicio,
           c.nome  as cliente,
           s.nome  as servico
      from public.cliente_servicos cs
      join public.clientes c on c.id = cs.cliente_id
      join public.servicos  s on s.id = cs.servico_id
     where cs.status = 'ativo'
       -- Em vigor no mes pedido: comecou ate o fim dele e nao terminou antes
       -- do comeco. Contrato que entra no dia 20 e cobrado no mes em que
       -- entrou; contrato encerrado em marco nao e cobrado em abril.
       and cs.inicio <= v_fim
       and (cs.fim is null or cs.fim >= v_mes)
     order by c.nome, s.nome
  loop
    -- Projeto e pontual: a fila de parcelas nasce no mes de inicio.
    v_comp := case when r.formato = 'recorrente'
                   then v_mes
                   else date_trunc('month', r.inicio)::date end;
    begin
      v_n := public.gerar_cobrancas_do_contrato(r.id, v_comp);
      -- CORTESIA tem contagem propria. Somada em "ja existiam", a dona leria
      -- "essa ja foi cobrada" sobre uma linha que nunca sera cobrada — e e
      -- justamente o presente que ela quer ver registrado.
      if v_n > 0 then v_crii := v_crii + v_n;
      elsif coalesce(r.valor_centavos, 0) = 0 then v_cort := v_cort + 1;
      else v_ja := v_ja + 1; end if;
      v_linhas := v_linhas || jsonb_build_object(
        'cliente',   r.cliente,
        'servico',   coalesce(nullif(btrim(coalesce(r.apelido, '')), ''), r.servico),
        'formato',   r.formato::text,
        'competencia', to_char(v_comp, 'MM/YYYY'),
        'criadas',   v_n,
        'erro',      null);
    exception when others then
      -- Falha silenciosa e proibida: a linha que nao deu certo aparece no
      -- resultado, com o motivo, e as outras seguem.
      v_erros := v_erros + 1;
      v_linhas := v_linhas || jsonb_build_object(
        'cliente',   r.cliente,
        'servico',   coalesce(nullif(btrim(coalesce(r.apelido, '')), ''), r.servico),
        'formato',   r.formato::text,
        'competencia', to_char(v_comp, 'MM/YYYY'),
        'criadas',   0,
        'erro',      sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'competencia', to_char(v_mes, 'MM/YYYY'),
    'contratos',   jsonb_array_length(v_linhas),
    'criadas',     v_crii,
    'jaExistiam',  v_ja,
    'cortesias',   v_cort,
    'erros',       v_erros,
    'linhas',      v_linhas);
end;
$function$;

CREATE OR REPLACE FUNCTION public.contratos_a_cobrar(p_competencia date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when public.usuario_financeiro() or public.usuario_admin() then
    (select count(*)::integer
       from public.cliente_servicos cs
      -- Cortesia nao entra na conta: prometer uma cobranca que nunca vai
      -- acontecer e o numero da tela mentindo.
      where cs.status = 'ativo'
        and coalesce(cs.valor_centavos, 0) > 0
        and cs.inicio <= (date_trunc('month', coalesce(p_competencia, current_date))
                          + interval '1 month - 1 day')::date
        and (cs.fim is null
             or cs.fim >= date_trunc('month', coalesce(p_competencia, current_date))::date))
  end;
$function$;

CREATE OR REPLACE FUNCTION public.servicos_para_adicionar(p_cliente uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v jsonb;
begin
  if not public.usuario_ve_cliente(p_cliente) then
    return null;
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'chave',         s.chave,
             'nome',          s.nome,
             'formatoPadrao', s.formato_padrao,
             -- QUANTAS linhas ativas, nao "tem ou nao tem" (0090).
             --
             -- O `left join` por servico devolvia uma linha por contrato
             -- existente: com duas captacoes, "Audiovisual" aparecia DUAS
             -- vezes na lista de adicionar. E `jaTem` nao impede mais nada —
             -- adicionar de novo e exatamente o que a dona pediu.
             'jaTem',         coalesce(j.ativas, 0) > 0,
             'ativas',        coalesce(j.ativas, 0),
             'modulos', coalesce((
               select jsonb_agg(
                        jsonb_build_object('chave', m.chave, 'nome', m.nome, 'opcional', sm.opcional)
                        order by m.ordem)
                 from public.servico_modulos sm
                 join public.modulos m on m.id = sm.modulo_id
                where sm.servico_id = s.id), '[]'::jsonb)
           )
           order by s.nome
         )
    into v
    from public.servicos s
    left join lateral (
      select count(*) filter (where cs.status = 'ativo') as ativas
        from public.cliente_servicos cs
       where cs.servico_id = s.id and cs.cliente_id = p_cliente
    ) j on true;

  return coalesce(v, '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.ficha_cliente(p_cliente uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when not public.usuario_ve_cliente(p_cliente) then null::jsonb else jsonb_build_object(

    'cliente', (select jsonb_build_object('id', c.id, 'nome', c.nome, 'slug', c.slug,
                  'fusoHorario', c.fuso_horario, 'ativo', c.ativo)
                  from public.clientes c where c.id = p_cliente),

    'modulos', coalesce((select jsonb_agg(m) from public.modulos_do_cliente(p_cliente) m), '[]'::jsonb),

    'servicos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cs.id, 'clienteId', cs.cliente_id, 'servico', s.chave, 'servicoNome', s.nome,
        'formato', cs.formato, 'status', cs.status,
        -- Lista, nao nome: um servico pode ser cuidado por mais de uma
        -- pessoa desde a 0070.
        'responsaveis', public.responsaveis_do_servico(cs.id),
        'valorCentavos', v.valor_centavos, 'diaVencimento', v.dia_vencimento,
        'parcelas', v.parcelas, 'inicio', cs.inicio, 'entregaEm', cs.entrega_em,
        -- A PARTIR DA 0075, o que a EDICAO precisa para abrir preenchida.
        --
        -- Faltavam tres, e a falta so apareceu quando a tela de editar
        -- nasceu: sem `dataEvento` e `observacao` o formulario abriria
        -- vazio e salvaria por cima; sem os IDS de quem cuida, as caixas de
        -- marcar nao teriam como vir marcadas — os nomes nao servem, porque
        -- duas pessoas podem se chamar igual.
        'dataEvento', cs.data_evento, 'observacao', cs.observacao,
        -- O nome que a dona deu a ESTA linha (0090): "Ensaio cortesia",
        -- "Aniversario da Zilda". Nulo quer dizer "chame pelo nome do
        -- servico", e a tela faz isso.
        'apelido', cs.apelido,
        'responsaveisIds', coalesce((
          select jsonb_agg(csr.perfil_id)
            from public.cliente_servico_responsaveis csr
           where csr.cliente_servico_id = cs.id), '[]'::jsonb),
        'fim', cs.fim)
        -- `s.ordem` sozinho era empate garantido assim que o mesmo servico
        -- pode entrar duas vezes, e empate em `order by` e ordem que muda
        -- sozinha entre uma leitura e outra.
        order by s.ordem, cs.inicio, cs.criado_em)
      from public.cliente_servicos cs
      join public.servicos s on s.id = cs.servico_id
      -- Sem permissao a funcao devolve zero linhas e o valor fica nulo; o
      -- servico, o responsavel e o prazo continuam na tela.
      left join public.contrato_valores(p_cliente) v on v.cliente_servico_id = cs.id
     where cs.cliente_id = p_cliente), '[]'::jsonb),

    'contatos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', cu.user_id,
        'nome', cu.nome, 'email', cu.email, 'papel', cu.papel_cliente, 'ativo', cu.ativo)
        order by cu.papel_cliente)
      from public.clientes_usuarios cu where cu.cliente_id = p_cliente), '[]'::jsonb),

    'pendencias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'tipo', i.tipo, 'titulo', i.titulo, 'quando', i.respondido_em)
        order by i.respondido_em desc)
      from public.itens_aprovacao i
     where i.cliente_id = p_cliente and i.estado = 'com_ajustes'), '[]'::jsonb),

    'movimentos', coalesce((
      select jsonb_agg(x order by x->>'quando' desc)
      from (
        select jsonb_build_object(
          'quando', i.respondido_em,
          'oQue', coalesce(i.respondido_por, 'O cliente') || ' ' ||
                  case i.estado when 'aprovado' then 'aprovou'
                                when 'com_ajustes' then 'pediu ajuste em'
                                else 'declinou' end || ' “' || i.titulo || '”') as x
          from public.itens_aprovacao i
         where i.cliente_id = p_cliente and i.respondido_em is not null
         order by i.respondido_em desc limit 8
      ) z), '[]'::jsonb),

    'mensalCentavos', (select mensal_centavos from public.contrato_totais(p_cliente)),
    'unicoCentavos', (select unico_centavos from public.contrato_totais(p_cliente))
  ) end;
$function$;
CREATE OR REPLACE FUNCTION public.criar_cliente(p_nome text, p_servicos jsonb, p_slug text DEFAULT NULL::text, p_fuso text DEFAULT 'America/Sao_Paulo'::text, p_cnpj_cpf text DEFAULT NULL::text, p_email_cobranca text DEFAULT NULL::text, p_telefone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_slug     text;
  v_digitos  text;
  v_cliente  uuid;
  v_item     jsonb;
  v_servico  public.servicos;
  v_formato  public.formato_contrato;
  v_valor    bigint;
  v_coer     record;
  v_cs       uuid;
  v_modulo   text;
  v_mid      uuid;
begin
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'O cliente precisa de um nome.';
  end if;

  v_slug := public.sluguificar(coalesce(nullif(btrim(p_slug), ''), p_nome));
  if v_slug = '' then
    raise exception 'Não consegui montar um endereço a partir de "%". Escreva um.', p_nome;
  end if;
  if exists (select 1 from public.clientes c where c.slug = v_slug) then
    raise exception 'Já existe um cliente no endereço "%". Escolha outro.', v_slug;
  end if;

  if p_servicos is null or jsonb_typeof(p_servicos) <> 'array'
     or jsonb_array_length(p_servicos) = 0 then
    raise exception 'Escolha pelo menos um serviço: é o contrato que liga as telas do cliente.';
  end if;

  -- Tira a mascara aqui, uma vez. No banco, "12.345.678/0001-90" e
  -- "12345678000190" seriam dois clientes diferentes para qualquer busca.
  v_digitos := nullif(regexp_replace(coalesce(p_cnpj_cpf, ''), '[^0-9]', '', 'g'), '');
  if v_digitos is not null and length(v_digitos) not in (11, 14) then
    raise exception 'CPF tem 11 dígitos e CNPJ tem 14. Vieram %.', length(v_digitos);
  end if;

  insert into public.clientes
    (nome, slug, fuso_horario, cnpj_cpf, email_cobranca, telefone)
  values (btrim(p_nome), v_slug, coalesce(nullif(btrim(p_fuso), ''), 'America/Sao_Paulo'),
          v_digitos,
          nullif(btrim(coalesce(p_email_cobranca, '')), ''),
          nullif(regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'), ''))
  returning id into v_cliente;

  for v_item in select * from jsonb_array_elements(p_servicos) loop
    select * into v_servico from public.servicos s where s.chave = v_item->>'servico';
    if v_servico.id is null then
      raise exception 'Serviço desconhecido: %.', coalesce(v_item->>'servico', '(vazio)');
    end if;

    v_formato := coalesce(nullif(v_item->>'formato', '')::public.formato_contrato,
                          v_servico.formato_padrao);

    v_valor := coalesce(nullif(v_item->>'valorCentavos', '')::bigint, 0);
    if v_valor < 0 then
      raise exception 'O valor de % não pode ser negativo.', v_servico.nome;
    end if;

    -- A validação que antes estava escrita aqui, e agora mora num lugar só.
    select * into v_coer from public.coerir_contrato(
      v_servico.nome,
      v_formato,
      nullif(v_item->>'diaVencimento', '')::smallint,
      nullif(v_item->>'parcelas', '')::smallint
    );

    insert into public.cliente_servicos (
      cliente_id, servico_id, formato, valor_centavos, dia_vencimento, parcelas,
      inicio, entrega_em, data_evento, observacao, apelido)
    values (
      v_cliente, v_servico.id, v_formato, v_valor, v_coer.dia_vencimento, v_coer.parcelas,
      coalesce(nullif(v_item->>'inicio', '')::date, current_date),
      nullif(v_item->>'entregaEm', '')::date,
      case when v_formato = 'recorrente' then null
           else nullif(v_item->>'dataEvento', '')::date end,
      nullif(btrim(coalesce(v_item->>'observacao', '')), ''),
      -- O nome desta linha, se a tela mandou um (0090).
      nullif(btrim(coalesce(v_item->>'apelido', '')), ''))
    returning id into v_cs;

    -- Quem cuida, agora em lista. Aceita a chave nova (`responsaveisIds`) e
    -- a antiga de um so (`responsavelId`), porque cadastro antigo guardado
    -- no navegador ainda manda a antiga.
    perform public.definir_responsaveis_do_servico(
      v_cs,
      coalesce(
        (select array_agg(x::uuid) from jsonb_array_elements_text(
           case when jsonb_typeof(v_item->'responsaveisIds') = 'array'
                then v_item->'responsaveisIds' else '[]'::jsonb end) x),
        case when nullif(v_item->>'responsavelId', '') is null then array[]::uuid[]
             else array[(v_item->>'responsavelId')::uuid] end));

    -- Chave opcional marcada no contrato. Obrigatoria nao entra aqui: o gatilho
    -- da 0015 recusa override de modulo que o servico sempre liga.
    for v_modulo in
      select jsonb_array_elements_text(coalesce(v_item->'modulos', '[]'::jsonb))
    loop
      select m.id into v_mid
        from public.modulos m
        join public.servico_modulos sm on sm.modulo_id = m.id
       where m.chave = v_modulo and sm.servico_id = v_servico.id and sm.opcional;
      if v_mid is null then
        raise exception 'O módulo "%" não é uma opção de %.', v_modulo, v_servico.nome;
      end if;
      insert into public.cliente_servico_modulos (cliente_servico_id, modulo_id, ligado)
      values (v_cs, v_mid, true)
      on conflict (cliente_servico_id, modulo_id) do update set ligado = true;
    end loop;
  end loop;

  return jsonb_build_object('id', v_cliente, 'slug', v_slug, 'nome', btrim(p_nome));
end;
$function$;

-- ---------------------------------------------------------------------------
-- As assinaturas mudaram, então os grants voltam explicitamente.
-- ---------------------------------------------------------------------------
revoke all on function public.adicionar_servico_ao_cliente(
  uuid, text, text, bigint, smallint, smallint, date, date, date, uuid[], text, text, text[])
  from public, anon;
grant execute on function public.adicionar_servico_ao_cliente(
  uuid, text, text, bigint, smallint, smallint, date, date, date, uuid[], text, text, text[])
  to authenticated;

revoke all on function public.alterar_servico_do_cliente(
  uuid, bigint, smallint, smallint, date, date, uuid[], text, text) from public, anon;
grant execute on function public.alterar_servico_do_cliente(
  uuid, bigint, smallint, smallint, date, date, uuid[], text, text) to authenticated;
