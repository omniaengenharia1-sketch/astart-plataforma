-- =============================================================================
-- 0088 — o português das mensagens de erro
--
-- A dona: "ajuste o português".
--
-- As mensagens que o banco mostra na tela dela estavam sem acento: "Nao
-- consegui montar um endereco", "Voce nao tem permissao", "So a direcao apaga
-- lancamento", "Ja existe um cliente no endereco". Não é detalhe de estilo: é
-- o texto que a plataforma escreve para ela e, em alguns casos, para o
-- cliente dela.
--
-- POR QUE 99 FUNÇÕES NUMA MIGRATION SÓ
--
-- Mensagem de erro em plpgsql mora dentro do corpo da função. Trocar uma
-- palavra exige recriar a função inteira, e são 99 funções envolvidas.
--
-- COMO ISTO FOI FEITO — importa, porque reescrever 99 funções de memória
-- seria apagar as partes que eu não lembro
--
--   1. cada corpo saiu de `pg_get_functiondef()` do banco construído pelas
--      migrations deste repositório, palavra por palavra;
--   2. a troca foi só de LITERAIS de texto: 272 linhas mudaram e nenhuma
--      mudança caiu fora de uma string entre aspas simples. Isso foi
--      conferido apagando os literais das duas versões e exigindo que o
--      resto ficasse idêntico — se um identificador tivesse sido tocado, a
--      conferência apontaria;
--   3. as palavras que só a frase resolve foram decididas uma por uma: "e"
--      virou "é" onde é verbo e ficou "e" onde é conjunção ("este arquivo é
--      %" contra "e o registro dessas tentativas"); "esta" virou "está" onde
--      é verbo; "da" virou "dá" em "não dá para" e ficou "da" em "não da
--      Meta"; "De um nome" virou "Dê um nome"; "apaga-la" virou "apagá-la";
--   4. as 30 mensagens que já estavam corretas não foram tocadas.
--
-- A SEGUNDA PASSADA, QUE QUASE NÃO ACONTECEU
--
-- Em plpgsql, `raise exception 'parte um ' 'parte dois'` junta os dois
-- literais numa mensagem só. A primeira varredura pegava só o literal
-- imediatamente depois do `raise` — e deixava de fora a continuação de vinte
-- mensagens, as mais longas, que são justamente as que explicam o que fazer:
-- "ser apagado — o log de publicacao e permanente de proposito".
--
-- Metade das mensagens arrumadas e metade não seria pior que nenhuma: pareceria
-- escolha. A segunda passada varreu cada `raise` até o `;` e pegou todos os
-- literais do caminho. Esses vinte foram escolhidos a mão, um por um, porque
-- na mesma lista havia VALOR junto de texto — 'servico', 'meta_app_id',
-- '(vazio)' e 'conta escolhida' são argumentos de `format`, não mensagem, e
-- acentuar um deles trocaria o nome de uma chave.
--
-- E DE PASSAGEM, TRÊS FUNÇÕES VOLTAM A SER O QUE OS ARQUIVOS DIZEM
--
-- Comparando o banco de produção com o banco construído a partir destas
-- migrations, quatro funções diferiam. Em todas, a diferença era comentário e
-- linha em branco — nenhuma linha de código. Mas o desvio existia:
--
--   · `dados_de_cobranca` — minha, de hoje: ao aplicar a 0087 eu colei o
--     corpo sem um comentário que está no arquivo;
--   · `credenciais_do_app_meta` e `token_do_sistema` — desvio antigo, de
--     sessões anteriores, pelo mesmo motivo;
--   · `registrar_interacao_do_lead` — idem, e já entra corrigida acima
--     porque tinha mensagem sem acento.
--
-- O arquivo é a verdade. As três que não tinham acento a corrigir entram aqui
-- só para o banco voltar a bater com o repositório.
--
-- OS TESTES QUE CASAVAM NO TEXTO SEM ACENTO
--
-- Setenta asserções batiam em pedaços como `position('11 digitos' in sqlerrm)`
-- e ficaram vermelhas com esta mudança — do jeito certo: foi assim que eu
-- soube que as mensagens chegam mesmo até a tela. Elas foram acertadas junto.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.abrir_chamado(p_cliente uuid, p_titulo text, p_descricao text DEFAULT NULL::text, p_prioridade prioridade_chamado DEFAULT 'media'::prioridade_chamado)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id   uuid;
  v_quem text;
  v_tipo public.autor_tipo;
begin
  if length(btrim(coalesce(p_titulo, ''))) = 0 then
    raise exception 'Diga em uma linha o que está acontecendo.';
  end if;
  if not public.usuario_ve_cliente(p_cliente) then
    raise exception 'Sem permissão neste cliente.';
  end if;
  -- SECURITY DEFINER pula a politica, e a politica era quem exigia o modulo.
  -- Sem esta linha, um cliente sem manutencao contratada abriria chamado —
  -- a funcao daria de presente o que o RLS recusava.
  if not public.cliente_tem_modulo(p_cliente, 'manutencao') then
    raise exception 'Este cliente não tem manutenção no contrato.';
  end if;

  select cu.nome into v_quem from public.clientes_usuarios cu
   where cu.user_id = auth.uid() and cu.cliente_id = p_cliente;
  if v_quem is null then
    select pe.nome into v_quem from public.perfis pe where pe.user_id = auth.uid();
    v_tipo := 'equipe';
  else
    v_tipo := 'cliente';
  end if;

  insert into public.chamados (cliente_id, titulo, descricao, prioridade,
                               aberto_por_tipo, aberto_por_nome)
  values (p_cliente, btrim(p_titulo), nullif(btrim(coalesce(p_descricao, '')), ''),
          p_prioridade, v_tipo, coalesce(v_quem, 'cliente'))
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.adicionar_servico_ao_cliente(p_cliente uuid, p_servico text, p_formato text DEFAULT NULL::text, p_valor_centavos bigint DEFAULT NULL::bigint, p_dia_vencimento smallint DEFAULT NULL::smallint, p_parcelas smallint DEFAULT NULL::smallint, p_inicio date DEFAULT NULL::date, p_entrega_em date DEFAULT NULL::date, p_data_evento date DEFAULT NULL::date, p_responsaveis uuid[] DEFAULT NULL::uuid[], p_observacao text DEFAULT NULL::text, p_modulos text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_servico  public.servicos;
  v_existe   public.cliente_servicos;
  v_formato  public.formato_contrato;
  v_coer     record;
  v_valor    bigint;
  v_cs       uuid;
  v_modulo   text;
  v_mid      uuid;
  v_reativou boolean := false;
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

  select * into v_existe
    from public.cliente_servicos cs
   where cs.cliente_id = p_cliente and cs.servico_id = v_servico.id;

  if found and v_existe.status <> 'encerrado' then
    raise exception
      'Este cliente já tem % no contrato (%). Para mudar valor ou vencimento use a '
      'alteracao; para tirar, encerre.', v_servico.nome, v_existe.status;
  end if;

  if found then
    -- Reativação: a MESMA linha volta a valer, com o histórico pendurado nela.
    update public.cliente_servicos
       set status         = 'ativo',
           formato        = v_formato,
           dia_vencimento = v_coer.dia_vencimento,
           parcelas       = v_coer.parcelas,
           inicio         = coalesce(p_inicio, current_date),
           fim            = null,
           entrega_em     = p_entrega_em,
           data_evento    = case when v_formato = 'recorrente' then null else p_data_evento end,
           observacao     = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao),
           valor_centavos = case when p_valor_centavos is null then valor_centavos
                                 else p_valor_centavos end,
           atualizado_em  = now()
     where id = v_existe.id;
    v_cs := v_existe.id;
    v_reativou := true;
  else
    insert into public.cliente_servicos (
      cliente_id, servico_id, formato, valor_centavos, dia_vencimento, parcelas,
      inicio, entrega_em, data_evento, observacao)
    values (
      p_cliente, v_servico.id, v_formato, v_valor, v_coer.dia_vencimento, v_coer.parcelas,
      coalesce(p_inicio, current_date), p_entrega_em,
      case when v_formato = 'recorrente' then null else p_data_evento end,
      nullif(btrim(coalesce(p_observacao, '')), ''))
    returning id into v_cs;
  end if;

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
    'reativou', v_reativou
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.agendar_avisos_de_tarefa()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_falta text;
begin
  if not public.usuario_admin() then
    raise exception 'Só a direção agenda o envio de avisos.';
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
$function$;

CREATE OR REPLACE FUNCTION public.agendar_cobranca()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'cron'
AS $function$
declare v_falta text;
begin
  -- Pela plataforma, só a direção. Direto no banco, quem já está dentro — o
  -- SQL editor não tem `auth.uid()`, e exigir papel ali é trancar a porta
  -- por onde se entra. (A lição é da 0080, onde eu tranquei.)
  if auth.uid() is not null and not public.usuario_admin() then
    raise exception 'Só a direção agenda a cobrança.';
  end if;

  select string_agg(c.nome, ', ') into v_falta
    from (values ('cobrar_tick_url'), ('tick_secret'),
                 ('asaas_api_key'), ('asaas_base_url')) as c(nome)
   where not exists (select 1 from vault.decrypted_secrets v where v.name = c.nome);

  if v_falta is not null then
    return format(
      'Falta %s no Vault. Cadastre e rode select public.agendar_cobranca() de novo.',
      v_falta);
  end if;

  if exists (select 1 from cron.job where jobname = 'cobrar-tick') then
    perform cron.unschedule('cobrar-tick');
  end if;

  perform cron.schedule(
    'cobrar-tick',
    '17 12 * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'cobrar_tick_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-tick-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'tick_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );

  return 'Agendado: a cobranca sai uma vez por dia, as 9h17 de Sao Paulo.';
end;
$function$;

CREATE OR REPLACE FUNCTION public.agendar_ponte_google()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'cron'
AS $function$
declare v_falta text;
begin
  -- Pela plataforma, so a direcao. Direto no banco, quem ja esta dentro: o
  -- SQL editor nao tem `auth.uid()`, e exigir papel ali e trancar a porta
  -- por onde se entra.
  if auth.uid() is not null and not public.usuario_admin() then
    raise exception 'Só a direção agenda a ponte.';
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
$function$;

CREATE OR REPLACE FUNCTION public.agendar_publicacao(p_post uuid, p_quando timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_post    public.posts%rowtype;
  v_lim     record;
  v_midias  int;
  v_contas  int;
  v_quando  timestamptz;
  v_ruim    record;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para agendar.';
  end if;

  select * into v_post from public.posts p where p.id = p_post;
  if not found or not public.usuario_ve_cliente(v_post.cliente_id) then
    raise exception 'Publicação % não encontrada.', p_post;
  end if;
  if v_post.status in ('publicando', 'publicado', 'publicado_parcial') then
    raise exception 'Esta publicação está em % — não dá para agendar de novo.', v_post.status;
  end if;

  -- O ULTIMO ponto onde ainda da para avisar. Depois disto a peca e do worker,
  -- e um erro aqui aparece de madrugada, com o cliente sem receber nada.
  select * into v_lim from public.limites_de_midia(v_post.tipo);
  select count(*) into v_midias from public.post_midias m where m.post_id = p_post;

  if v_midias < v_lim.minimo then
    raise exception
      'Falta arquivo: % pede % e tem %. Anexe antes de agendar.',
      v_post.tipo, v_lim.minimo, v_midias;
  end if;

  -- Canal que nao publica, entre os alvos ja gravados. Acontece quando a conta
  -- muda de estado depois de a peca ser criada: o acesso de parceiro expira, a
  -- conta e desligada. A peca ficaria agendada e falharia sozinha.
  select a.conta_social_id, c.nome_exibicao, p.motivo into v_ruim
    from public.post_alvos a
    join public.contas_sociais c on c.id = a.conta_social_id
    cross join lateral public.canal_publicavel(a.conta_social_id, v_post.tipo) p
   where a.post_id = p_post
     and not p.publicavel
   limit 1;

  if found then
    raise exception '% em @%: %', v_post.tipo, v_ruim.nome_exibicao, v_ruim.motivo;
  end if;

  -- Sem destino, o worker marca a peca com erro e ninguem ve nada publicado.
  -- Melhor recusar agora, com o motivo.
  select count(*) into v_contas
    from public.contas_sociais c
   where c.cliente_id = v_post.cliente_id
     and c.ativo
     and c.acesso_parceiro = 'concedido'
     and public.conta_tem_identificador(c.plataforma, c.ig_user_id, c.page_id);

  if v_contas = 0 and not exists (select 1 from public.post_alvos a where a.post_id = p_post) then
    raise exception
      'Este cliente não tem conta conectada. Conecte em "onde publica", no calendário, '
      'senão nada sai no ar.';
  end if;

  v_quando := coalesce(p_quando, now());

  update public.posts
     set status        = 'agendado',
         agendado_para = v_quando,
         erro_mensagem = null,
         atualizado_em = now()
   where id = p_post;

  return jsonb_build_object(
    'id', p_post,
    'quando', v_quando,
    'agora', v_quando <= now() + interval '70 seconds'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.alterar_servico_do_cliente(p_cliente_servico uuid, p_valor_centavos bigint DEFAULT NULL::bigint, p_dia_vencimento smallint DEFAULT NULL::smallint, p_parcelas smallint DEFAULT NULL::smallint, p_entrega_em date DEFAULT NULL::date, p_data_evento date DEFAULT NULL::date, p_responsaveis uuid[] DEFAULT NULL::uuid[], p_observacao text DEFAULT NULL::text)
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
         atualizado_em  = now()
   where id = p_cliente_servico;

  -- Nulo quer dizer "nao mexe"; lista vazia quer dizer "tire todos".
  if p_responsaveis is not null then
    perform public.definir_responsaveis_do_servico(p_cliente_servico, p_responsaveis);
  end if;

  return jsonb_build_object('id', p_cliente_servico, 'servico', v_nome);
end;
$function$;

CREATE OR REPLACE FUNCTION public.apagar_coluna_de_tarefa(p_coluna uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cartoes integer;
  v_restam  integer;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para mexer nas colunas.';
  end if;

  select count(*) into v_cartoes from public.tarefas where coluna_id = p_coluna;
  if v_cartoes > 0 then
    raise exception
      'Esta coluna ainda tem % tarefa(s). Mova para outra coluna antes de apagar — '
      'apagar a coluna não apaga o trabalho que está nela.', v_cartoes;
  end if;

  select count(*) into v_restam from public.tarefa_colunas;
  if v_restam <= 1 then
    raise exception 'O quadro precisa de pelo menos uma coluna.';
  end if;

  delete from public.tarefa_colunas where id = p_coluna;
  if not found then raise exception 'Coluna não encontrada.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apagar_compromisso(p_compromisso uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para mexer na agenda.';
  end if;
  delete from public.compromissos where id = p_compromisso;
  if not found then raise exception 'Compromisso não encontrado.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apagar_lancamento(p_lancamento uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_admin() then
    raise exception 'Só a direção apaga lançamento.';
  end if;
  if exists (select 1 from public.lancamentos
              where id = p_lancamento and status = 'liquidado') then
    raise exception
      'Este lançamento já foi liquidado — o dinheiro andou. Estorne ou cancele.';
  end if;
  if exists (select 1 from public.cobrancas
              where lancamento_id = p_lancamento and status = 'emitida') then
    raise exception
      'Este lançamento tem cobrança emitida na Asaas. Cancele a cobrança lá antes, '
      'senão o cliente recebe um boleto de algo que aqui não existe mais.';
  end if;

  delete from public.lancamentos where id = p_lancamento;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apagar_lead(p_lead uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_admin() then
    raise exception 'Só a direção apaga lead.';
  end if;
  if exists (select 1 from public.leads l where l.id = p_lead and l.convertido_em is not null) then
    raise exception 'Este lead virou cliente — ele é o começo daquele contrato. Não apague.';
  end if;

  delete from public.leads where id = p_lead;
  if not found then
    raise exception 'Lead não encontrado.';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apagar_publicacao(p_post uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_post     record;
  v_caminhos text[];
  v_estado   text;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para apagar peça.';
  end if;

  select p.id, p.titulo_interno, p.cliente_id into v_post
    from public.posts p
   where p.id = p_post
     and public.usuario_ve_cliente(p.cliente_id);

  if not found then
    raise exception 'Peça não encontrada.';
  end if;

  -- Já publicado em ALGUM destino: não apaga, nem o destino que falhou.
  -- A peça é uma coisa só; apagar metade dela deixaria um post no ar sem
  -- registro nenhum deste lado.
  select a.estado::text into v_estado
    from public.post_alvos a
   where a.post_id = p_post and a.estado = 'publicado'
   limit 1;

  if found then
    raise exception
      'Esta peça já foi publicada — apagar aqui não tira o post do ar, só '
      'apaga o registro de que a agência publicou. Se o post precisa sair, '
      'apague na conta do cliente.';
  end if;

  select a.estado::text into v_estado
    from public.post_alvos a
   where a.post_id = p_post and a.estado = 'publicando'
   limit 1;

  if found then
    raise exception
      'Esta peça está publicando agora e ainda não se sabe se saiu. Espere o '
      'próximo ciclo decidir, e apague depois se não tiver ido ao ar.';
  end if;

  select array_agg(m.storage_path) into v_caminhos
    from public.post_midias m
   where m.post_id = p_post;

  -- O LOG MANDA AQUI. Ele e append-only desde a 0004, entao nem apagar nem
  -- soltar: se existe, a peca fica. A chave estrangeira NO ACTION barraria o
  -- delete de baixo de qualquer jeito — a diferenca e que assim a pessoa le
  -- um motivo em portugues em vez de "violates foreign key constraint".
  if exists (
    select 1 from public.publicacao_eventos e
      join public.post_alvos a on a.id = e.post_alvo_id
     where a.post_id = p_post
  ) then
    raise exception
      'Esta peça já tentou publicar, e o registro dessas tentativas não pode '
      'ser apagado — o log de publicação é permanente de propósito. Use '
      'cancelar: ela para de tentar e sai da fila, e o histórico fica.';
  end if;

  -- A IDEIA PRECISA SER SOLTA NA MAO, e isto o teste 43 me ensinou.
  --
  -- `ideias.post_id` e ON DELETE SET NULL, entao eu achei que o banco
  -- resolvia sozinho. Nao resolve: a tabela tem a restricao
  -- `ideias_uso_coerente` — `(post_id is null) = (usada_em is null)` — e o
  -- SET NULL e um UPDATE, que a restricao confere. Zerar so o `post_id`
  -- deixaria a linha com "usada em tal dia" apontando para peca nenhuma, e o
  -- delete inteiro falharia com um erro que nao fala de post nem de peca.
  --
  -- Soltar as duas colunas e o certo tambem no significado: a peca deixou de
  -- existir, entao a ideia voltou a NAO ter sido usada, e pode virar outra
  -- peca amanha.
  update public.ideias
     set post_id = null, usada_em = null
   where post_id = p_post;

  -- O cascade da 0003 leva alvos e midias.
  delete from public.posts where id = p_post;

  return jsonb_build_object(
    'titulo',   v_post.titulo_interno,
    'caminhos', coalesce(to_jsonb(v_caminhos), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.apagar_tarefa(p_tarefa uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caminhos text[];
begin
  if not exists (
    select 1 from public.tarefas
     where id = p_tarefa and (public.usuario_admin() or criado_por = auth.uid())
  ) then
    raise exception
      'Só quem criou a tarefa (ou a direção) pode apagá-la. Se ela não é mais '
      'para fazer, mova para a coluna final.';
  end if;

  select array_agg(caminho) into v_caminhos
    from public.tarefa_arquivos where tarefa_id = p_tarefa;

  delete from public.tarefas where id = p_tarefa;

  return jsonb_build_object('caminhos', coalesce(to_jsonb(v_caminhos), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.arquivar_galeria(p_galeria uuid, p_arquivar boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_quando timestamptz;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para arquivar galeria.';
  end if;
  if not exists (select 1 from public.galerias g where g.id = p_galeria) then
    raise exception 'Galeria não encontrada.';
  end if;

  v_quando := case when coalesce(p_arquivar, true) then now() else null end;
  update public.galerias set arquivada_em = v_quando where id = p_galeria;

  return jsonb_build_object('arquivadaEm', v_quando);
end;
$function$;

CREATE OR REPLACE FUNCTION public.arquivos_orfaos(p_minutos integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_resposta jsonb;
begin
  -- Direcao, nao equipe: a lista mistura caminhos de TODOS os clientes, e
  -- apagar em massa nao tem desfazer. Mesma porta de `excluir_galeria`.
  if not public.usuario_admin() then
    raise exception 'Só a direção vê os arquivos órfãos.';
  end if;

  if p_minutos < 10 then
    raise exception
      'Margem curta demais (%). Arquivo recém-subido ainda não tem linha no '
      'banco e seria confundido com órfão — isso apagaria foto no meio do '
      'upload.', p_minutos;
  end if;

  with referenciados as (
    select c
      from public.galeria_itens i
      cross join lateral unnest(array[i.caminho, i.miniatura_caminho, i.poster_caminho]) as c
     where c is not null
  ),
  soltos as (
    select o.name,
           coalesce((o.metadata->>'size')::bigint, 0) as bytes
      from storage.objects o
     where o.bucket_id = 'galerias'
       and o.created_at < now() - make_interval(mins => p_minutos)
       and not exists (select 1 from referenciados r where r.c = o.name)
  )
  select jsonb_build_object(
    'arquivos', (select count(*) from soltos),
    'bytes',    (select coalesce(sum(bytes), 0) from soltos),
    -- Teto de mil por chamada: o navegador apaga em lotes de cem, e uma lista
    -- de dez mil caminhos num corpo JSON nao ajuda ninguem. Sobrando mais, a
    -- tela chama de novo depois de apagar — o que sobrou continua sobrando.
    'caminhos', coalesce((select jsonb_agg(s.name) from (
                  select name from soltos order by name limit 1000) s), '[]'::jsonb),
    'margemMinutos', p_minutos
  ) into v_resposta;

  return v_resposta;
end;
$function$;

CREATE OR REPLACE FUNCTION public.atualizar_publicacao(p_post uuid, p_titulo text DEFAULT NULL::text, p_legenda text DEFAULT NULL::text, p_hashtags text DEFAULT NULL::text, p_no_comentario boolean DEFAULT NULL::boolean, p_tipo tipo_post DEFAULT NULL::tipo_post, p_contas uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_post public.posts%rowtype;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para editar publicação.';
  end if;

  select * into v_post from public.posts p where p.id = p_post;
  if not found or not public.usuario_ve_cliente(v_post.cliente_id) then
    raise exception 'Publicação % não encontrada.', p_post;
  end if;
  if v_post.status in ('publicando', 'publicado', 'publicado_parcial') then
    raise exception 'Esta publicação está em % — não muda mais.', v_post.status;
  end if;

  -- Trocar o formato com mídia anexada quebraria a regra do novo formato: um
  -- carrossel de cinco fotos virando reel não tem vídeo nenhum. Recusa alto
  -- em vez de deixar a peça num estado que não publica.
  if p_tipo is not null and p_tipo <> v_post.tipo
     and exists (select 1 from public.post_midias m where m.post_id = p_post) then
    raise exception
      'Tire os arquivos antes de trocar o formato: o que serve para % pode não servir para %.',
      v_post.tipo, p_tipo;
  end if;

  update public.posts
     set titulo_interno = coalesce(nullif(btrim(coalesce(p_titulo, '')), ''), titulo_interno),
         legenda        = coalesce(p_legenda, legenda),
         hashtags       = coalesce(btrim(p_hashtags), hashtags),
         hashtags_no_comentario = coalesce(p_no_comentario, hashtags_no_comentario),
         tipo           = coalesce(p_tipo, tipo),
         atualizado_em  = now()
   where id = p_post;

  if p_contas is not null then
    -- Alvo que já tentou publicar não se apaga: é histórico do que aconteceu.
    delete from public.post_alvos a
     where a.post_id = p_post
       and a.estado = 'pendente'
       and not (a.conta_social_id = any(p_contas));

    insert into public.post_alvos (post_id, conta_social_id, estado, proxima_tentativa_em)
    select p_post, c.id, 'pendente', now()
      from public.contas_sociais c
     where c.id = any(p_contas)
       and c.cliente_id = v_post.cliente_id
       and c.ativo
    on conflict (post_id, conta_social_id) do nothing;
  end if;

  return jsonb_build_object('id', p_post);
end;
$function$;

CREATE OR REPLACE FUNCTION public.atualizar_token_conta(p_conta_social_id uuid, p_token text, p_expira_em timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
declare
  v_conta public.contas_sociais%rowtype;
  v_ref   text;
  v_id    uuid;
begin
  select * into v_conta from public.contas_sociais c where c.id = p_conta_social_id;
  if not found then
    raise exception 'Conta social % não encontrada.', p_conta_social_id;
  end if;

  if v_conta.origem_token <> 'oauth' then
    raise exception
      'A conta "%" usa o System User do Business Manager da Astart, que não expira. '
      'Não há token para renovar.', v_conta.nome_exibicao;
  end if;

  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'Token vazio para a conta "%".', v_conta.nome_exibicao;
  end if;
  if p_expira_em is null or p_expira_em <= now() then
    raise exception
      'Vencimento inválido para a conta "%": a Meta devolveu uma data que já passou.',
      v_conta.nome_exibicao;
  end if;

  -- Uma chave por conta, estavel entre renovacoes.
  v_ref := coalesce(
    nullif(btrim(v_conta.token_ref), ''),
    'token_conta_' || replace(p_conta_social_id::text, '-', '')
  );

  select s.id into v_id from vault.secrets s where s.name = v_ref;

  if v_id is null then
    perform vault.create_secret(p_token, v_ref, 'Token OAuth da conta ' || v_conta.nome_exibicao);
  else
    perform vault.update_secret(v_id, p_token);
  end if;

  update public.contas_sociais
     set token_ref = v_ref,
         token_expira_em = p_expira_em
   where id = p_conta_social_id;

  return v_ref;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_lancamento(p_lancamento uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'O financeiro é de quem cuida do dinheiro.';
  end if;
  update public.lancamentos
     set status = 'cancelado', liquidado_em = null
   where id = p_lancamento;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_publicacao(p_post uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cliente   uuid;
  v_parados   int;
  v_publicados int;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para cancelar peça.';
  end if;

  select p.cliente_id into v_cliente
    from public.posts p
   where p.id = p_post and public.usuario_ve_cliente(p.cliente_id);
  if not found then
    raise exception 'Peça não encontrada.';
  end if;

  -- `publicando` fica de fora junto com `publicado`: nesse estado a resposta
  -- da Meta ainda esta em aberto, e carimbar 'cancelado' por cima faria a
  -- reconciliacao do worker perder o alvo de um post que pode estar no ar.
  update public.post_alvos
     set estado = 'cancelado',
         proxima_tentativa_em = null,
         lock_token = null,
         bloqueado_ate = null,
         atualizado_em = now()
   where post_id = p_post
     and estado not in ('publicado', 'publicando', 'cancelado');
  get diagnostics v_parados = row_count;

  select count(*) into v_publicados
    from public.post_alvos a
   where a.post_id = p_post and a.estado = 'publicado';

  update public.posts
     set status = case when v_publicados > 0 then 'publicado_parcial'::public.status_post
                       else 'cancelado'::public.status_post end,
         atualizado_em = now()
   where id = p_post;

  return jsonb_build_object('parados', v_parados, 'jaPublicados', v_publicados);
end;
$function$;

CREATE OR REPLACE FUNCTION public.casar_cliente_com_asaas(p_cliente uuid, p_customer_id text, p_ambiente text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_ambiente not in ('sandbox', 'producao') then
    raise exception 'Ambiente da Asaas tem de ser sandbox ou produção, veio "%".', p_ambiente;
  end if;
  update public.clientes
     set asaas_customer_id = p_customer_id, asaas_ambiente = p_ambiente
   where id = p_cliente;
  if not found then raise exception 'Cliente não encontrado.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.casar_compromisso_com_google(p_compromisso uuid, p_calendar_id text, p_event_id text, p_visto_em timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.compromissos set
    google_calendar_id     = p_calendar_id,
    google_event_id        = p_event_id,
    google_sincronizado_em = coalesce(p_visto_em, now())
  where id = p_compromisso;
  if not found then raise exception 'Compromisso não encontrado.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cobranca_ganhou_pix(p_lancamento uuid, p_pix text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_pix is null or length(btrim(p_pix)) = 0 then
    raise exception 'Pix vazio não é pix.';
  end if;

  update public.cobrancas
     set pix_payload = btrim(p_pix)
   where lancamento_id = p_lancamento
     -- So preenche o que esta vazio. Reescrever o pix de uma cobranca que ja
     -- tem um trocaria o codigo que o cliente talvez ja tenha copiado.
     and pix_payload is null;

  if not found then
    raise exception 'Esta cobrança não existe ou já tem pix.';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.coerir_contrato(p_nome_servico text, p_formato formato_contrato, p_dia smallint, p_parcelas smallint)
 RETURNS TABLE(dia_vencimento smallint, parcelas smallint)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_formato is null then
    raise exception 'Diga se % é recorrente, projeto ou pontual.', p_nome_servico;
  end if;

  if p_formato = 'recorrente' then
    if p_dia is null then
      raise exception 'Diga o dia de vencimento de % (1 a 31).', p_nome_servico;
    end if;
    if p_dia < 1 or p_dia > 31 then
      raise exception
        'Dia de vencimento de % precisa estar entre 1 e 31.', p_nome_servico;
    end if;
    return query select p_dia, null::smallint;
  end if;

  if coalesce(p_parcelas, 1) < 1 then
    raise exception 'O número de parcelas de % precisa ser pelo menos 1.', p_nome_servico;
  end if;
  return query select null::smallint, coalesce(p_parcelas, 1)::smallint;
end;
$function$;

CREATE OR REPLACE FUNCTION public.config_asaas()
 RETURNS TABLE(chave text, base_url text, ambiente text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
declare
  v_chave text;
  v_base  text;
begin
  select decrypted_secret into v_chave
    from vault.decrypted_secrets where name = 'asaas_api_key';
  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'asaas_base_url';

  if v_chave is null or v_base is null then
    raise exception
      'Faltam asaas_api_key e/ou asaas_base_url no cofre. Sem elas não há como emitir cobrança.';
  end if;

  -- O ambiente sai do PROPRIO endereco, nao de uma variavel a parte: duas
  -- fontes para a mesma verdade divergem, e a que erra e sempre a que
  -- ninguem lembra de mudar.
  return query select
    v_chave,
    rtrim(v_base, '/'),
    case when position('sandbox' in lower(v_base)) > 0 then 'sandbox' else 'producao' end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.converter_lead(p_lead uuid, p_cliente uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_financeiro() then
    raise exception 'O comercial é de quem cuida do dinheiro.';
  end if;
  if not exists (select 1 from public.clientes c where c.id = p_cliente) then
    raise exception 'Cliente % não encontrado. Cadastre o cliente antes de converter.', p_cliente;
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
    raise exception 'Lead não encontrado.';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.credenciais_do_app_meta()
 RETURNS TABLE(app_id text, app_secret text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
declare
  v_id     text;
  v_segredo text;
begin
  select btrim(s.decrypted_secret) into v_id
    from vault.decrypted_secrets s where s.name = 'meta_app_id' limit 1;
  select btrim(s.decrypted_secret) into v_segredo
    from vault.decrypted_secrets s where s.name = 'meta_app_secret' limit 1;

  v_id      := nullif(v_id, '');
  v_segredo := nullif(v_segredo, '');

  if v_id is null and v_segredo is null then
    return;  -- nenhuma linha: a função chamadora usa o caminho degradado
  end if;

  if v_id is null or v_segredo is null then
    raise exception
      'Configuração da Meta pela metade: % está no Vault e % não. '
      'Cadastre as duas, senão não dá para formar o app token.',
      case when v_id is null then 'meta_app_secret' else 'meta_app_id' end,
      case when v_id is null then 'meta_app_id'     else 'meta_app_secret' end;
  end if;

  return query select v_id, v_segredo;
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_coluna_de_tarefa(p_nome text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_id uuid;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para mexer nas colunas.';
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
$function$;

CREATE OR REPLACE FUNCTION public.criar_compromisso(p_titulo text, p_quando timestamp with time zone, p_termina_em timestamp with time zone DEFAULT NULL::timestamp with time zone, p_dia_inteiro boolean DEFAULT false, p_cliente uuid DEFAULT NULL::uuid, p_responsavel uuid DEFAULT NULL::uuid, p_local text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_fuso text DEFAULT 'America/Sao_Paulo'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_id uuid;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para marcar na agenda.';
  end if;
  if p_titulo is null or length(btrim(p_titulo)) = 0 then
    raise exception 'O compromisso precisa de um título.';
  end if;
  if p_quando is null then
    raise exception 'O compromisso precisa de uma data.';
  end if;
  if p_termina_em is not null and p_termina_em <= p_quando then
    raise exception 'O fim do compromisso tem de ser depois do começo.';
  end if;
  if p_cliente is not null
     and not exists (select 1 from public.clientes where id = p_cliente) then
    raise exception 'Cliente não encontrado.';
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
$function$;

CREATE OR REPLACE FUNCTION public.criar_entregaveis_do_modelo(p_cliente_servico_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_servico uuid;
  v_qtd     integer;
begin
  select cs.servico_id into v_servico
    from public.cliente_servicos cs where cs.id = p_cliente_servico_id;
  if v_servico is null then
    raise exception 'Serviço contratado não encontrado.';
  end if;

  -- Nao sobrescreve o que ja existe: a proposta pode ter mandado outro escopo.
  if exists (select 1 from public.entregaveis
              where cliente_servico_id = p_cliente_servico_id) then
    return 0;
  end if;

  insert into public.entregaveis (cliente_servico_id, fase, titulo, ordem)
  select p_cliente_servico_id, m.fase, m.titulo, m.ordem
    from public.modelos_entregavel m
   where m.servico_id = v_servico
   order by m.ordem;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_galeria(p_sessao uuid, p_titulo text DEFAULT NULL::text, p_recado text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id     uuid;
  v_sessao public.sessoes_captacao;
begin
  select * into v_sessao from public.sessoes_captacao where id = p_sessao;
  if v_sessao.id is null then
    raise exception 'Captação não encontrada.';
  end if;

  insert into public.galerias (sessao_id, provedor, titulo, recado)
  values (p_sessao, 'storage',
          coalesce(nullif(btrim(p_titulo), ''), v_sessao.titulo),
          nullif(btrim(coalesce(p_recado, '')), ''))
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_lancamento(p_descricao text, p_subcategoria uuid, p_valor_centavos bigint, p_vencimento date DEFAULT NULL::date, p_competencia date DEFAULT NULL::date, p_cliente uuid DEFAULT NULL::uuid, p_contraparte text DEFAULT NULL::text, p_forma forma_pagamento DEFAULT NULL::forma_pagamento, p_liquidado_em date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id   uuid;
  v_comp date;
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'O financeiro é de quem cuida do dinheiro.';
  end if;
  if p_descricao is null or length(btrim(p_descricao)) = 0 then
    raise exception 'O lançamento precisa de uma descrição.';
  end if;
  if p_valor_centavos is null or p_valor_centavos <= 0 then
    raise exception 'O valor precisa ser maior que zero.';
  end if;
  if not exists (select 1 from public.financeiro_subcategorias where id = p_subcategoria) then
    raise exception 'Escolha uma categoria.';
  end if;
  if p_cliente is not null
     and not exists (select 1 from public.clientes where id = p_cliente) then
    raise exception 'Cliente não encontrado.';
  end if;

  -- A competencia e o mes a que o dinheiro PERTENCE. Sem ela dita, segue o
  -- vencimento; sem vencimento, o mes de hoje.
  v_comp := date_trunc('month',
              coalesce(p_competencia, p_vencimento, p_liquidado_em, current_date))::date;

  insert into public.lancamentos
    (descricao, subcategoria_id, cliente_id, contraparte, valor_centavos,
     competencia, vencimento, forma, status, liquidado_em, criado_por)
  values
    (btrim(p_descricao), p_subcategoria, p_cliente, nullif(btrim(coalesce(p_contraparte, '')), ''),
     p_valor_centavos, v_comp, p_vencimento, p_forma,
     (case when p_liquidado_em is null then 'previsto' else 'liquidado' end)::public.status_lancamento,
     p_liquidado_em, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_lead(p_nome text, p_empresa text DEFAULT NULL::text, p_whatsapp text DEFAULT NULL::text, p_origem text DEFAULT NULL::text, p_valor_centavos bigint DEFAULT NULL::bigint, p_proximo_passo text DEFAULT NULL::text, p_proximo_em date DEFAULT NULL::date, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid;
begin
  if not public.usuario_financeiro() then
    raise exception 'O comercial é de quem cuida do dinheiro.';
  end if;
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'O lead precisa de um nome.';
  end if;
  if p_valor_centavos is not null and p_valor_centavos < 0 then
    raise exception 'O valor estimado não pode ser negativo.';
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
$function$;

CREATE OR REPLACE FUNCTION public.criar_link_aprovacao(p_envio_id uuid)
 RETURNS TABLE(link_id uuid, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_token   text;
  v_cliente uuid;
  v_id      uuid;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para criar link de aprovação.';
  end if;

  select e.cliente_id into v_cliente
    from public.envios_aprovacao e where e.id = p_envio_id;
  if v_cliente is null then
    raise exception 'Envio não encontrado.';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.links_aprovacao (cliente_id, envio_id, token_hash, criado_por)
  values (v_cliente, p_envio_id,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;

  return query select v_id, v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_link_galeria(p_galeria uuid)
 RETURNS TABLE(link_id uuid, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_token  text;
  v_id     uuid;
  v_nome   text;
  v_segredo text;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para criar link de galeria.';
  end if;
  if not exists (select 1 from public.galerias where id = p_galeria) then
    raise exception 'Galeria não encontrada.';
  end if;

  -- O nome da galeria na frente, para o link dizer o que é. Cai para a sessão
  -- quando a galeria não tem título, e para 'galeria' quando nem isso — nunca
  -- vazio, senão o token começaria com um hífen.
  select nullif(public.sluguificar(coalesce(g.titulo, s.titulo, '')), '')
    into v_nome
    from public.galerias g
    left join public.sessoes_captacao s on s.id = g.sessao_id
   where g.id = p_galeria;
  v_nome := left(coalesce(v_nome, 'galeria'), 40);

  -- 12 bytes = 96 bits = exatamente 16 caracteres de base64, sem '=' de sobra.
  -- O `translate` faz base64url: '+' e '/' não sobrevivem a uma URL colada no
  -- WhatsApp. O `replace` da quebra de linha é cinto e suspensório — o
  -- `encode` só quebra acima de 76 caracteres, e aqui são 16.
  v_segredo := translate(
    replace(encode(extensions.gen_random_bytes(12), 'base64'), E'\n', ''),
    '+/', '-_');

  v_token := v_nome || '-' || v_segredo;

  insert into public.links_galeria (galeria_id, token_hash, criado_por)
  values (p_galeria, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;

  update public.galerias
     set publicada_em = coalesce(publicada_em, now())
   where id = p_galeria;

  -- O token sai UMA vez, aqui. Depois disto so existe o hash.
  return query select v_id, v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_peca(p_cliente uuid, p_titulo text, p_tipo tipo_post, p_dia date, p_hora time without time zone DEFAULT '12:00:00'::time without time zone, p_legenda text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_fuso text;
  v_post public.posts;
begin
  if length(btrim(coalesce(p_titulo, ''))) = 0 then
    raise exception 'A peça precisa de um nome interno — é por ele que a equipe acha ela.';
  end if;
  if p_dia is null then
    raise exception 'Diga que dia a peça sai.';
  end if;

  select c.fuso_horario into v_fuso from public.clientes c where c.id = p_cliente;
  if v_fuso is null then
    raise exception 'Cliente não encontrado.';
  end if;

  insert into public.posts (cliente_id, titulo_interno, tipo, legenda, agendado_para, criado_por)
  values (p_cliente, btrim(p_titulo), p_tipo, coalesce(p_legenda, ''),
          ((p_dia + coalesce(p_hora, time '12:00'))::timestamp at time zone v_fuso),
          auth.uid())
  returning * into v_post;

  return jsonb_build_object('id', v_post.id, 'itemId', v_post.item_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_publicacao(p_cliente uuid, p_titulo text, p_tipo tipo_post, p_legenda text DEFAULT ''::text, p_hashtags text DEFAULT ''::text, p_no_comentario boolean DEFAULT false, p_contas uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_post    uuid;
  v_quantas int;
  v_conta   uuid;
  v_pub     record;
  v_nome    text;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para criar publicação.';
  end if;
  if not public.usuario_ve_cliente(p_cliente) then
    raise exception 'Cliente % não encontrado.', p_cliente;
  end if;
  if not public.cliente_tem_modulo(p_cliente, 'publicacao') then
    raise exception 'Este cliente não tem publicação no contrato.';
  end if;
  if length(btrim(coalesce(p_titulo, ''))) = 0 then
    raise exception 'Dê um nome interno para a publicação, para a equipe achar depois.';
  end if;

  -- O canal, conta por conta, ANTES de criar a linha. Recusar depois deixaria
  -- um rascunho que nunca publica, e a pessoa descobriria no botao de agendar.
  if p_contas is not null and array_length(p_contas, 1) > 0 then
    foreach v_conta in array p_contas loop
      select * into v_pub from public.canal_publicavel(v_conta, p_tipo);
      if not v_pub.publicavel then
        select c.nome_exibicao into v_nome from public.contas_sociais c where c.id = v_conta;
        raise exception '% em %: %',
          p_tipo, coalesce('@' || v_nome, 'conta escolhida'), v_pub.motivo;
      end if;
    end loop;
  end if;

  insert into public.posts
    (cliente_id, titulo_interno, tipo, legenda, hashtags, hashtags_no_comentario, criado_por)
  values
    (p_cliente, btrim(p_titulo), p_tipo, coalesce(p_legenda, ''),
     btrim(coalesce(p_hashtags, '')), coalesce(p_no_comentario, false), auth.uid())
  returning id into v_post;

  if p_contas is not null and array_length(p_contas, 1) > 0 then
    insert into public.post_alvos (post_id, conta_social_id, estado, proxima_tentativa_em)
    select v_post, c.id, 'pendente', now()
      from public.contas_sociais c
     where c.id = any(p_contas)
       and c.cliente_id = p_cliente
       and c.ativo;

    select count(*) into v_quantas from public.post_alvos a where a.post_id = v_post;
    if v_quantas = 0 then
      raise exception
        'Nenhuma das contas escolhidas serve para este cliente. '
        'Conecte a conta no calendário antes de agendar.';
    end if;
  end if;

  return jsonb_build_object('id', v_post);
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_tarefa(p_titulo text, p_coluna uuid DEFAULT NULL::uuid, p_responsavel uuid DEFAULT NULL::uuid, p_cliente uuid DEFAULT NULL::uuid, p_prazo date DEFAULT NULL::date, p_detalhe text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_coluna uuid := p_coluna;
  v_id     uuid;
  v_ordem  integer;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para criar tarefa.';
  end if;
  if length(btrim(coalesce(p_titulo, ''))) = 0 then
    raise exception 'A tarefa precisa de um título.';
  end if;

  -- Sem coluna dita, vai para a primeira. A tela manda; a API nao exige.
  if v_coluna is null then
    select id into v_coluna from public.tarefa_colunas order by ordem, criado_em limit 1;
  end if;
  if v_coluna is null then
    raise exception 'Não há nenhuma coluna no quadro.';
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
$function$;

CREATE OR REPLACE FUNCTION public.dados_de_cobranca(p_cliente uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_linha record;
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'Dados de cobrança são de quem cuida do dinheiro.';
  end if;

  select c.nome, c.cnpj_cpf, c.email_cobranca, c.telefone,
         c.asaas_customer_id, c.asaas_ambiente
    into v_linha
    from public.clientes c
   where c.id = p_cliente;

  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  return jsonb_build_object(
    'nome',     v_linha.nome,
    'cnpjCpf',  v_linha.cnpj_cpf,
    'email',    v_linha.email_cobranca,
    'telefone', v_linha.telefone,
    -- Se ele ja existe la, a tela diz em qual ambiente. Trocar o documento de
    -- um cliente que a Asaas ja conhece nao renomeia o cadastro de la, e e bom
    -- que quem mexe saiba disso antes de mexer.
    'naAsaas',  v_linha.asaas_customer_id is not null,
    'ambiente', v_linha.asaas_ambiente);
end;
$function$;

CREATE OR REPLACE FUNCTION public.definir_capa_galeria(p_galeria uuid, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item public.galeria_itens%rowtype;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para trocar a capa da galeria.';
  end if;

  if not exists (select 1 from public.galerias g where g.id = p_galeria) then
    raise exception 'Galeria não encontrada.';
  end if;

  -- `null` tira a capa e volta ao comportamento da 0034 (a primeira foto).
  if p_item is null then
    update public.galerias set capa_item_id = null where id = p_galeria;
    return jsonb_build_object('capaItemId', null);
  end if;

  select * into v_item from public.galeria_itens i where i.id = p_item;
  if not found then
    raise exception 'Esta foto não existe mais. Recarregue a galeria.';
  end if;

  -- O item tem de ser DESTA galeria. Sem isto, a capa de uma entrega poderia
  -- apontar para a foto de outro cliente — e o caminho assinado sairia junto.
  if v_item.galeria_id is distinct from p_galeria then
    raise exception 'Esta foto é de outra galeria.';
  end if;

  if v_item.tipo <> 'foto' then
    raise exception 'A capa tem de ser uma foto. Vídeo não vira capa parado.';
  end if;

  if not v_item.pronto then
    raise exception 'Esta foto ainda está subindo. Espere terminar para usar de capa.';
  end if;

  update public.galerias set capa_item_id = p_item where id = p_galeria;
  return jsonb_build_object('capaItemId', p_item);
end;
$function$;

CREATE OR REPLACE FUNCTION public.definir_responsaveis_do_servico(p_cliente_servico uuid, p_perfis uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cs     public.cliente_servicos;
  v_perfis uuid[];
  v_fora   text;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para mexer no contrato.';
  end if;

  select * into v_cs from public.cliente_servicos cs where cs.id = p_cliente_servico;
  if not found or not public.usuario_ve_cliente(v_cs.cliente_id) then
    raise exception 'Serviço do contrato % não encontrado.', p_cliente_servico;
  end if;

  -- Sem repetido, sem nulo: a tela pode mandar os dois sem querer.
  select coalesce(array_agg(distinct x), array[]::uuid[]) into v_perfis
    from unnest(coalesce(p_perfis, array[]::uuid[])) x where x is not null;

  -- So gente da equipe que esta ativa. Nome de quem saiu da agencia pendurado
  -- num contrato e pior do que contrato sem responsavel: parece que alguem
  -- esta cuidando.
  select string_agg(x::text, ', ') into v_fora
    from unnest(v_perfis) x
   where not exists (select 1 from public.perfis p where p.user_id = x and p.ativo);
  if v_fora is not null then
    raise exception 'Perfil % não está na equipe ativa.', v_fora;
  end if;

  delete from public.cliente_servico_responsaveis
   where cliente_servico_id = p_cliente_servico
     and perfil_id <> all (v_perfis);

  insert into public.cliente_servico_responsaveis (cliente_servico_id, perfil_id)
  select p_cliente_servico, x from unnest(v_perfis) x
  on conflict do nothing;

  return jsonb_build_object(
    'id', p_cliente_servico,
    'responsaveis', public.responsaveis_do_servico(p_cliente_servico));
end;
$function$;

CREATE OR REPLACE FUNCTION public.desativar_cliente(p_cliente uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_admin() then
    raise exception 'Só quem administra a plataforma tira um cliente do ar.';
  end if;
  update public.clientes set ativo = false where id = p_cliente;
  if not found then raise exception 'Cliente não encontrado.'; end if;

  update public.cliente_servicos set status = 'encerrado'
   where cliente_id = p_cliente and status = 'ativo';
  -- O acesso dele cai junto: contrato encerrado e portal aberto e a pior
  -- combinacao — ele continua vendo tudo e ninguem esta cuidando.
  update public.clientes_usuarios set ativo = false
   where cliente_id = p_cliente and ativo;
end;
$function$;

CREATE OR REPLACE FUNCTION public.desativar_pessoa(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_user_id = auth.uid() then
    raise exception 'Você não pode tirar o próprio acesso.';
  end if;
  if not exists (select 1 from public.perfis p where p.user_id = p_user_id) then
    raise exception 'Pessoa não encontrada.';
  end if;

  update public.perfis
     set ativo = false, desativado_em = now()
   where user_id = p_user_id and ativo;
end;
$function$;

CREATE OR REPLACE FUNCTION public.desligar_agenda_google()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão.';
  end if;
  -- Desligar NAO apaga o vinculo dos compromissos ja empurrados: se religar,
  -- eles continuam sendo os mesmos eventos la, em vez de virarem duplicatas.
  update public.agendas_google set ativo = false where user_id = auth.uid();
  if not found then raise exception 'Você não tem agenda ligada.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.editar_compromisso(p_compromisso uuid, p_titulo text DEFAULT NULL::text, p_quando timestamp with time zone DEFAULT NULL::timestamp with time zone, p_termina_em timestamp with time zone DEFAULT NULL::timestamp with time zone, p_dia_inteiro boolean DEFAULT NULL::boolean, p_cliente uuid DEFAULT NULL::uuid, p_responsavel uuid DEFAULT NULL::uuid, p_local text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_limpar text[] DEFAULT NULL::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_limpar text[] := coalesce(p_limpar, array[]::text[]);
  v_ini timestamptz;
  v_fim timestamptz;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para mexer na agenda.';
  end if;
  if p_titulo is not null and length(btrim(p_titulo)) = 0 then
    raise exception 'O compromisso precisa de um título.';
  end if;

  -- O periodo e conferido com os valores que VAO FICAR, nao so com os que
  -- vieram: mudar so o comeco para depois do fim tem de ser recusado.
  select coalesce(p_quando, quando),
         case when 'fim' = any (v_limpar) then null
              else coalesce(p_termina_em, termina_em) end
    into v_ini, v_fim
    from public.compromissos where id = p_compromisso;
  if v_ini is null then raise exception 'Compromisso não encontrado.'; end if;
  if v_fim is not null and v_fim <= v_ini then
    raise exception 'O fim do compromisso tem de ser depois do começo.';
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

  if not found then raise exception 'Compromisso não encontrado.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.editar_lancamento(p_lancamento uuid, p_descricao text DEFAULT NULL::text, p_subcategoria uuid DEFAULT NULL::uuid, p_valor_centavos bigint DEFAULT NULL::bigint, p_vencimento date DEFAULT NULL::date, p_competencia date DEFAULT NULL::date, p_cliente uuid DEFAULT NULL::uuid, p_contraparte text DEFAULT NULL::text, p_forma forma_pagamento DEFAULT NULL::forma_pagamento, p_limpar text[] DEFAULT NULL::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_limpar text[] := coalesce(p_limpar, array[]::text[]);
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'O financeiro é de quem cuida do dinheiro.';
  end if;
  if p_descricao is not null and length(btrim(p_descricao)) = 0 then
    raise exception 'O lançamento precisa de uma descrição.';
  end if;
  if p_valor_centavos is not null and p_valor_centavos <= 0 then
    raise exception 'O valor precisa ser maior que zero.';
  end if;
  if p_subcategoria is not null
     and not exists (select 1 from public.financeiro_subcategorias where id = p_subcategoria) then
    raise exception 'Categoria não encontrada.';
  end if;

  update public.lancamentos set
    descricao       = coalesce(nullif(btrim(coalesce(p_descricao, '')), ''), descricao),
    subcategoria_id = coalesce(p_subcategoria, subcategoria_id),
    valor_centavos  = coalesce(p_valor_centavos, valor_centavos),
    vencimento      = case when 'vencimento'  = any (v_limpar) then null
                           else coalesce(p_vencimento, vencimento) end,
    competencia     = coalesce(date_trunc('month', p_competencia)::date, competencia),
    cliente_id      = case when 'cliente'     = any (v_limpar) then null
                           else coalesce(p_cliente, cliente_id) end,
    contraparte     = case when 'contraparte' = any (v_limpar) then null
                           else coalesce(nullif(btrim(coalesce(p_contraparte, '')), ''), contraparte) end,
    forma           = case when 'forma'       = any (v_limpar) then null
                           else coalesce(p_forma, forma) end
  where id = p_lancamento;

  if not found then raise exception 'Lançamento não encontrado.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.editar_lead(p_lead uuid, p_nome text DEFAULT NULL::text, p_empresa text DEFAULT NULL::text, p_whatsapp text DEFAULT NULL::text, p_origem text DEFAULT NULL::text, p_valor_centavos bigint DEFAULT NULL::bigint, p_notas text DEFAULT NULL::text, p_score score_lead DEFAULT NULL::score_lead, p_reuniao_em timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limpar text[] DEFAULT NULL::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_limpar text[] := coalesce(p_limpar, array[]::text[]);
begin
  if not public.usuario_financeiro() then
    raise exception 'O comercial é de quem cuida do dinheiro.';
  end if;
  if p_nome is not null and length(btrim(p_nome)) = 0 then
    raise exception 'O lead precisa de um nome.';
  end if;
  if p_valor_centavos is not null and p_valor_centavos < 0 then
    raise exception 'O valor estimado não pode ser negativo.';
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
    raise exception 'Lead não encontrado.';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.editar_tarefa(p_tarefa uuid, p_titulo text DEFAULT NULL::text, p_detalhe text DEFAULT NULL::text, p_responsavel uuid DEFAULT NULL::uuid, p_cliente uuid DEFAULT NULL::uuid, p_prazo date DEFAULT NULL::date, p_limpar text[] DEFAULT '{}'::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_antes uuid;
begin
  if not public.usuario_ve_tarefa(p_tarefa) then
    raise exception 'Esta tarefa não é sua.';
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
$function$;

CREATE OR REPLACE FUNCTION public.encerrar_servico_do_cliente(p_cliente_servico uuid, p_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cs   public.cliente_servicos;
  v_nome text;
  v_fim  date;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para mexer no contrato.';
  end if;

  select * into v_cs from public.cliente_servicos cs where cs.id = p_cliente_servico;
  if not found or not public.usuario_ve_cliente(v_cs.cliente_id) then
    raise exception 'Serviço do contrato % não encontrado.', p_cliente_servico;
  end if;

  v_fim := coalesce(p_fim, current_date);
  if v_fim < v_cs.inicio then
    raise exception
      'A data de fim (%) é anterior ao início do serviço (%). Confira a data.',
      v_fim, v_cs.inicio;
  end if;

  select s.nome into v_nome from public.servicos s where s.id = v_cs.servico_id;

  update public.cliente_servicos
     set status = 'encerrado', fim = v_fim, atualizado_em = now()
   where id = p_cliente_servico;

  return jsonb_build_object('id', p_cliente_servico, 'servico', v_nome, 'fim', v_fim);
end;
$function$;

CREATE OR REPLACE FUNCTION public.enviar_para_aprovacao(p_item_ids uuid[], p_mensagem text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cliente uuid;
  v_envio   uuid;
  v_item    public.itens_aprovacao;
  v_n       integer := 0;
begin
  if not public.usuario_edita() then
    raise exception 'Seu acesso não envia material para o cliente.';
  end if;
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    raise exception 'Escolha o que enviar.';
  end if;

  -- Um lote e de um cliente so: dois clientes no mesmo envio virariam um link
  -- que mostra material de um para o outro.
  select distinct i.cliente_id into v_cliente
    from public.itens_aprovacao i where i.id = any(p_item_ids);
  if v_cliente is null then
    raise exception 'Item não encontrado.';
  end if;
  if (select count(distinct i.cliente_id) from public.itens_aprovacao i
       where i.id = any(p_item_ids)) > 1 then
    raise exception 'Um envio é de um cliente só. Separe em dois.';
  end if;
  if (select count(*) from public.itens_aprovacao i where i.id = any(p_item_ids))
     <> cardinality(p_item_ids) then
    raise exception 'Item não encontrado.';
  end if;

  insert into public.envios_aprovacao (cliente_id, criado_por, mensagem)
  values (v_cliente, auth.uid(), nullif(btrim(coalesce(p_mensagem, '')), ''))
  returning id into v_envio;

  for v_item in
    select * from public.itens_aprovacao where id = any(p_item_ids) order by criado_em for update
  loop
    if v_item.estado = 'em_aprovacao' then
      raise exception '"%" já está esperando o cliente desde %.',
        v_item.titulo, to_char(v_item.enviado_em, 'DD/MM HH24:MI');
    end if;
    if v_item.estado = 'aprovado' then
      raise exception '"%" já foi aprovado. Para mandar de novo, crie uma nova versão.',
        v_item.titulo;
    end if;

    update public.itens_aprovacao
       set estado = 'em_aprovacao',
           enviado_em = now(),
           -- A resposta anterior fica no historico de comentarios; o item volta
           -- a esperar, e nao pode parecer respondido.
           respondido_em = null,
           respondido_por = null,
           atualizado_em = now()
     where id = v_item.id;

    insert into public.envio_itens (envio_id, item_id) values (v_envio, v_item.id)
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('envioId', v_envio, 'enviados', v_n, 'clienteId', v_cliente);
end;
$function$;

CREATE OR REPLACE FUNCTION public.estornar_lancamento(p_lancamento uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'O financeiro é de quem cuida do dinheiro.';
  end if;
  update public.lancamentos
     set status = 'previsto', liquidado_em = null
   where id = p_lancamento;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.excluir_galeria(p_galeria uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caminhos text[];
  v_titulo   text;
  v_itens    int;
begin
  -- Direção, não equipe. Apagar a captação de um cliente não tem desfazer.
  if not public.usuario_admin() then
    raise exception
      'Só a direção exclui galeria. Para tirar do ar sem apagar, use arquivar — '
      'o link para de abrir e os arquivos ficam.';
  end if;

  select coalesce(g.titulo, s.titulo) into v_titulo
    from public.galerias g
    left join public.sessoes_captacao s on s.id = g.sessao_id
   where g.id = p_galeria;
  if not found then
    raise exception 'Galeria não encontrada.';
  end if;

  select array_agg(c) , count(distinct i.id)
    into v_caminhos, v_itens
    from public.galeria_itens i
    cross join lateral unnest(array[i.caminho, i.miniatura_caminho, i.poster_caminho]) as c
   where i.galeria_id = p_galeria and c is not null;

  -- O cascade da 0022/0034 leva itens, links, favoritos e downloads junto.
  delete from public.galerias where id = p_galeria;

  return jsonb_build_object(
    'titulo', v_titulo,
    'itens', coalesce(v_itens, 0),
    'caminhos', coalesce(to_jsonb(v_caminhos), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.favoritar_item(p_item uuid, p_ligado boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_galeria uuid;
  v_cliente uuid;
  v_quem    text;
begin
  select g.id, s.cliente_id into v_galeria, v_cliente
    from public.galeria_itens i
    join public.galerias g on g.id = i.galeria_id
    join public.sessoes_captacao s on s.id = g.sessao_id
   where i.id = p_item;
  if v_galeria is null then
    raise exception 'Item não encontrado.';
  end if;
  if not public.usuario_ve_cliente(v_cliente) then
    raise exception 'Sem permissão nesta galeria.';
  end if;

  select coalesce(cu.nome, pe.nome, 'cliente') into v_quem
    from (select 1) um
    left join public.clientes_usuarios cu
           on cu.user_id = auth.uid() and cu.cliente_id = v_cliente
    left join public.perfis pe on pe.user_id = auth.uid();

  if p_ligado then
    insert into public.galeria_favoritos (galeria_id, item_id, quem)
    values (v_galeria, p_item, v_quem)
    on conflict do nothing;
  else
    delete from public.galeria_favoritos
     where galeria_id = v_galeria and item_id = p_item and quem = v_quem;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.favoritar_por_token(p_token text, p_item uuid, p_quem text, p_ligado boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_link public.links_galeria;
begin
  select * into v_link from public.links_galeria
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and revogado_em is null;
  if v_link.id is null then
    raise exception 'Link inválido ou revogado.';
  end if;
  if not exists (select 1 from public.galeria_itens
                  where id = p_item and galeria_id = v_link.galeria_id) then
    raise exception 'Este item não é desta galeria.';
  end if;

  if p_ligado then
    insert into public.galeria_favoritos (galeria_id, item_id, quem)
    values (v_link.galeria_id, p_item, coalesce(nullif(btrim(p_quem), ''), 'cliente'))
    on conflict do nothing;
  else
    delete from public.galeria_favoritos
     where galeria_id = v_link.galeria_id and item_id = p_item
       and quem = coalesce(nullif(btrim(p_quem), ''), 'cliente');
  end if;
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

  select s.nome into v_nome from public.servicos s where s.id = v_cs.servico_id;

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
    if exists (select 1 from public.lancamentos
                where cliente_id = v_cs.cliente_id and competencia = v_mes
                  and descricao = v_nome || ' — ' || to_char(v_mes, 'MM/YYYY')) then
      return 0;
    end if;
    insert into public.lancamentos
      (descricao, subcategoria_id, cliente_id, valor_centavos, competencia, vencimento, criado_por)
    values (v_nome || ' — ' || to_char(v_mes, 'MM/YYYY'), v_sub, v_cs.cliente_id,
            v_cs.valor_centavos, v_mes, v_venc, auth.uid());
    return 1;
  end if;

  -- projeto e pontual: uma linha por parcela, mes a mes a partir da competencia
  if exists (select 1 from public.lancamentos
              where cliente_id = v_cs.cliente_id
                and descricao like v_nome || ' — parcela%') then
    return 0;
  end if;

  for v_i in 1 .. v_cs.parcelas loop
    insert into public.lancamentos
      (descricao, subcategoria_id, cliente_id, valor_centavos, competencia, vencimento, criado_por)
    values (format('%s — parcela %s de %s', v_nome, v_i, v_cs.parcelas), v_sub, v_cs.cliente_id,
            -- a ultima parcela absorve o centavo que a divisao deixou
            case when v_i < v_cs.parcelas
                 then v_cs.valor_centavos / v_cs.parcelas
                 else v_cs.valor_centavos - (v_cs.valor_centavos / v_cs.parcelas) * (v_cs.parcelas - 1)
            end,
            (v_mes + make_interval(months => v_i - 1))::date,
            (v_mes + make_interval(months => v_i - 1))::date + 14,
            auth.uid());
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
      if v_n > 0 then v_crii := v_crii + v_n; else v_ja := v_ja + 1; end if;
      v_linhas := v_linhas || jsonb_build_object(
        'cliente',   r.cliente,
        'servico',   r.servico,
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
        'servico',   r.servico,
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
    'erros',       v_erros,
    'linhas',      v_linhas);
end;
$function$;

CREATE OR REPLACE FUNCTION public.gerar_slots(p_cliente_servico_id uuid, p_mes date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    raise exception 'Sem permissão para gerar o mês.';
  end if;

  select * into v_plano from public.planos_conteudo
   where cliente_servico_id = p_cliente_servico_id;
  if v_plano.cliente_servico_id is null then
    raise exception 'Este contrato ainda não tem plano de conteúdo.';
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
$function$;

CREATE OR REPLACE FUNCTION public.item_do_entregavel(p_entregavel_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_e  public.entregaveis;
  v_cl uuid;
  v_id uuid;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para mexer neste entregável.';
  end if;

  select * into v_e from public.entregaveis where id = p_entregavel_id for update;
  if v_e.id is null then
    raise exception 'Entregável não encontrado.';
  end if;
  if v_e.item_id is not null then
    return v_e.item_id;
  end if;

  select cs.cliente_id into v_cl
    from public.cliente_servicos cs where cs.id = v_e.cliente_servico_id;

  insert into public.itens_aprovacao (cliente_id, tipo, estado, titulo)
  values (v_cl, 'entregavel', 'produzindo', v_e.titulo)
  returning id into v_id;

  update public.entregaveis set item_id = v_id, atualizado_em = now()
   where id = p_entregavel_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ligar_agenda_google(p_calendar_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para ligar agenda.';
  end if;
  if p_calendar_id is null or length(btrim(p_calendar_id)) = 0 then
    raise exception 'Diga qual é a sua agenda do Google (normalmente o seu e-mail).';
  end if;
  if exists (select 1 from public.agendas_google
              where calendar_id = btrim(lower(p_calendar_id)) and user_id <> auth.uid()) then
    raise exception
      'Esta agenda já está ligada em outra pessoa. Cada agenda é de uma pessoa só.';
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
$function$;

CREATE OR REPLACE FUNCTION public.liquidar_lancamento(p_lancamento uuid, p_em date DEFAULT NULL::date, p_forma forma_pagamento DEFAULT NULL::forma_pagamento)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_l public.lancamentos;
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'O financeiro é de quem cuida do dinheiro.';
  end if;

  select * into v_l from public.lancamentos where id = p_lancamento;
  if v_l.id is null then raise exception 'Lançamento não encontrado.'; end if;

  -- Recusa dizendo QUANDO foi a primeira vez. Dois cliques no mesmo botao
  -- trocariam a data do pagamento em silencio.
  if v_l.status = 'liquidado' then
    raise exception 'Este lançamento já foi liquidado em %.',
      to_char(coalesce(v_l.liquidado_em, current_date), 'DD/MM/YYYY');
  end if;
  if v_l.status = 'cancelado' then
    raise exception 'Este lançamento está cancelado. Reabra antes de liquidar.';
  end if;

  update public.lancamentos
     set status       = 'liquidado',
         liquidado_em = coalesce(p_em, current_date),
         forma        = coalesce(p_forma, forma)
   where id = p_lancamento;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mencionar_na_tarefa(p_tarefa uuid, p_perfil uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_ve_tarefa(p_tarefa) then
    raise exception 'Esta tarefa não é sua.';
  end if;
  if not exists (select 1 from public.perfis where user_id = p_perfil and ativo) then
    raise exception 'Essa pessoa não está na equipe.';
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
$function$;

CREATE OR REPLACE FUNCTION public.mover_coluna_de_tarefa(p_coluna uuid, p_para integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para mexer nas colunas.';
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
  if not found then raise exception 'Coluna não encontrada.'; end if;

  with nova as (
    select id, row_number() over (order by ordem, criado_em) as n
      from public.tarefa_colunas
  )
  update public.tarefa_colunas c set ordem = nova.n
    from nova where nova.id = c.id and c.ordem <> nova.n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mover_lead(p_lead uuid, p_etapa etapa_lead, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_financeiro() then
    raise exception 'O comercial é de quem cuida do dinheiro.';
  end if;

  -- Perdido SEM motivo e a pior linha do funil: daqui a seis meses ninguem
  -- sabe se o preco estava alto, se sumiu, ou se fechou com outro.
  if p_etapa = 'perdido' and length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Lead perdido precisa de motivo — daqui a seis meses ninguém lembra por que.';
  end if;

  update public.leads
     set etapa = p_etapa,
         motivo_desqualificacao = case when p_etapa = 'perdido'
           then nullif(btrim(coalesce(p_motivo, '')), '') else motivo_desqualificacao end,
         ultima_interacao_em = current_date,
         atualizado_em = now()
   where id = p_lead;

  if not found then
    raise exception 'Lead não encontrado.';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mover_midia_do_post(p_midia uuid, p_para smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_post_id uuid;
  v_post    public.posts%rowtype;
  v_ids     uuid[];
  v_n       int;
  v_de      int;
  v_para    int;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para mudar a ordem dos arquivos.';
  end if;

  select m.post_id into v_post_id from public.post_midias m where m.id = p_midia;
  if v_post_id is null then
    raise exception 'Arquivo % não encontrado.', p_midia;
  end if;

  select * into v_post from public.posts p where p.id = v_post_id;
  -- "Nao encontrado" e nao "sem permissao", de proposito: quem nao ve o
  -- cliente nao pode nem descobrir que a peca existe.
  if not found or not public.usuario_ve_cliente(v_post.cliente_id) then
    raise exception 'Arquivo % não encontrado.', p_midia;
  end if;

  -- Peca no ar e historico. A mesma regra de anexar e de tirar: o que foi
  -- publicado nao muda, nem na ordem — o carrossel que esta na conta do
  -- cliente tem uma ordem, e o banco nao pode discordar dela.
  if v_post.status in ('publicando', 'publicado', 'publicado_parcial') then
    raise exception
      'Esta peça está em % — a ordem do que foi publicado não muda. '
      'Duplique a peça se quiser outra ordem.',
      v_post.status;
  end if;

  select array_agg(m.id order by m.ordem) into v_ids
    from public.post_midias m where m.post_id = v_post_id;

  v_n  := coalesce(array_length(v_ids, 1), 0);
  v_de := array_position(v_ids, p_midia);

  -- O destino e PRESO na faixa em vez de recusado: a tela manda "um para
  -- tras" no primeiro arquivo o tempo todo, e isso nao e erro de ninguem —
  -- e so nao ter para onde ir.
  v_para := least(greatest(p_para::int + 1, 1), v_n);

  if v_n < 2 or v_de = v_para then
    return jsonb_build_object('mudou', false, 'quantas', v_n);
  end if;

  -- Tira da posicao atual e poe na nova. As fatias vazias (`v_ids[1:0]`)
  -- devolvem array vazio, entao as pontas nao precisam de caso especial.
  v_ids := v_ids[1:v_de - 1] || v_ids[v_de + 1:v_n];
  v_ids := v_ids[1:v_para - 1] || p_midia || v_ids[v_para:array_length(v_ids, 1)];

  -- FASE 1: todo mundo sai do caminho. Sem isto, a restricao unica reclama no
  -- meio da renumeracao. +1000 cabe no smallint com folga — o carrossel maior
  -- que a Meta aceita tem 10 arquivos.
  update public.post_midias set ordem = ordem + 1000 where post_id = v_post_id;

  -- FASE 2: cada um assume a posicao final, denso, de 0 a n-1.
  for i in 1..v_n loop
    update public.post_midias set ordem = (i - 1)::smallint where id = v_ids[i];
  end loop;

  return jsonb_build_object('mudou', true, 'quantas', v_n);
end;
$function$;

CREATE OR REPLACE FUNCTION public.mover_peca(p_post uuid, p_dia date, p_hora time without time zone DEFAULT NULL::time without time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_fuso text;
  v_post public.posts;
  v_hora time;
begin
  select p.* into v_post from public.posts p where p.id = p_post;
  if v_post.id is null then
    raise exception 'Peça não encontrada.';
  end if;
  if v_post.status in ('publicando', 'publicado') then
    raise exception 'Esta peça já saiu. Não dá para mudar a data dela.';
  end if;

  select c.fuso_horario into v_fuso from public.clientes c where c.id = v_post.cliente_id;
  v_hora := coalesce(p_hora, (v_post.agendado_para at time zone v_fuso)::time, time '12:00');

  update public.posts
     set agendado_para = ((p_dia + v_hora)::timestamp at time zone v_fuso),
         atualizado_em = now()
   where id = p_post;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mover_tarefa(p_tarefa uuid, p_coluna uuid, p_para integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_final boolean;
  v_pos   integer;
begin
  if not public.usuario_ve_tarefa(p_tarefa) then
    raise exception 'Esta tarefa não é sua.';
  end if;
  if not exists (select 1 from public.tarefa_colunas where id = p_coluna) then
    raise exception 'Coluna não encontrada.';
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
$function$;

CREATE OR REPLACE FUNCTION public.mudar_estado_do_servico(p_cliente_servico uuid, p_estado text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cs   public.cliente_servicos;
  v_nome text;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para mexer no contrato.';
  end if;
  if p_estado not in ('ativo', 'pausado') then
    raise exception
      'Estado "%" não serve aqui: use "ativo" ou "pausado". Para encerrar, use '
      'encerrar_servico_do_cliente, que grava a data de fim.', p_estado;
  end if;

  select * into v_cs from public.cliente_servicos cs where cs.id = p_cliente_servico;
  if not found or not public.usuario_ve_cliente(v_cs.cliente_id) then
    raise exception 'Serviço do contrato % não encontrado.', p_cliente_servico;
  end if;

  select s.nome into v_nome from public.servicos s where s.id = v_cs.servico_id;

  update public.cliente_servicos
     set status = p_estado::public.status_servico,
         -- Voltar a valer limpa a data de fim: serviço ativo com fim no
         -- passado é um estado que não quer dizer nada.
         fim = case when p_estado = 'ativo' then null else fim end,
         atualizado_em = now()
   where id = p_cliente_servico;

  return jsonb_build_object('id', p_cliente_servico, 'servico', v_nome, 'estado', p_estado);
end;
$function$;

CREATE OR REPLACE FUNCTION public.mudar_papel(p_user_id uuid, p_papel papel_perfil)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_antes public.papel_perfil;
begin
  if not public.usuario_admin() then
    raise exception 'Só quem administra a plataforma muda papel.';
  end if;

  -- 'social' e lixo da fase do agendador: o enum ainda tem o valor, a
  -- plataforma nao usa. Deixar entrar criaria gente com papel que nenhuma
  -- funcao reconhece — nem equipe, nem leitura, nem nada.
  if p_papel not in ('admin', 'operacao', 'financeiro', 'leitura') then
    raise exception 'Papel inválido: %', p_papel;
  end if;

  select papel into v_antes from public.perfis where user_id = p_user_id;
  if v_antes is null then
    raise exception 'Essa pessoa não está na equipe.';
  end if;
  if v_antes = p_papel then
    return;  -- idempotente: pedir o mesmo papel duas vezes nao e erro
  end if;

  if v_antes = 'admin' and p_papel <> 'admin'
     and (select count(*) from public.perfis where papel = 'admin' and ativo) <= 1 then
    raise exception 'Precisa de outra pessoa administrando antes de sair.';
  end if;

  update public.perfis set papel = p_papel where user_id = p_user_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mudar_visibilidade_do_documento(p_documento uuid, p_visivel boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_doc public.cliente_documentos;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para mexer em documento.';
  end if;

  select * into v_doc from public.cliente_documentos d where d.id = p_documento;
  if not found or not public.usuario_ve_cliente(v_doc.cliente_id) then
    raise exception 'Documento % não encontrado.', p_documento;
  end if;

  update public.cliente_documentos
     set visivel_ao_cliente = coalesce(p_visivel, false)
   where id = p_documento;

  return jsonb_build_object('id', p_documento, 'visivelAoCliente', coalesce(p_visivel, false));
end;
$function$;

CREATE OR REPLACE FUNCTION public.nova_versao_entregavel(p_entregavel_id uuid, p_nota text DEFAULT NULL::text)
 RETURNS entregavel_versoes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_num smallint;
  v_row public.entregavel_versoes;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para subir versão.';
  end if;

  perform 1 from public.entregaveis where id = p_entregavel_id for update;
  if not found then
    raise exception 'Entregável não encontrado.';
  end if;

  select coalesce(max(numero), 0) + 1 into v_num
    from public.entregavel_versoes where entregavel_id = p_entregavel_id;

  insert into public.entregavel_versoes (entregavel_id, numero, nota, criado_por)
  values (p_entregavel_id, v_num, p_nota, auth.uid())
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.obter_token_conta(p_conta_social_id uuid)
 RETURNS TABLE(conta_social_id uuid, plataforma plataforma_social, ig_user_id text, page_id text, access_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
declare
  v_conta public.contas_sociais%rowtype;
  v_ref   text;
  v_token text;
begin
  select * into v_conta from public.contas_sociais c where c.id = p_conta_social_id;

  if not found then
    raise exception 'Conta social % não encontrada.', p_conta_social_id;
  end if;
  if not v_conta.ativo then
    raise exception 'A conta "%" está inativa.', v_conta.nome_exibicao;
  end if;

  if v_conta.acesso_parceiro = 'pendente' then
    raise exception
      'A conta "%" ainda não aceitou o convite de parceiro no Business Manager da Astart. '
      'Peça ao cliente para aceitar antes de reagendar.', v_conta.nome_exibicao;
  end if;
  if v_conta.acesso_parceiro = 'expirado' then
    raise exception
      'O acesso de parceiro à conta "%" foi removido no Business Manager. '
      'Reative antes de reagendar.', v_conta.nome_exibicao;
  end if;

  if v_conta.origem_token = 'oauth' and v_conta.token_expira_em <= now() then
    raise exception
      'O token de acesso da conta "%" venceu em %. Reconecte a conta.',
      v_conta.nome_exibicao, to_char(v_conta.token_expira_em, 'DD/MM/YYYY');
  end if;

  -- Sem token_ref => token de System User do BM da Astart.
  v_ref := coalesce(nullif(btrim(v_conta.token_ref), ''), 'meta_system_user_token');

  select s.decrypted_secret into v_token
    from vault.decrypted_secrets s
   where s.name = v_ref
   limit 1;

  if v_token is null or length(btrim(v_token)) = 0 then
    raise exception 'Token da Meta ausente no Vault (chave "%"). Cadastre o token antes de publicar.', v_ref;
  end if;

  return query
    select v_conta.id, v_conta.plataforma, v_conta.ig_user_id, v_conta.page_id, v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.primeiro_admin(p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user  uuid;
begin
  if v_email = '' then
    raise exception 'Diga o e-mail da conta que vai administrar.';
  end if;

  -- A trava que faz esta funcao ser segura: ela so existe enquanto a casa esta
  -- vazia. Com um admin ativo, quem da acesso e o convite — e e ele que grava
  -- quem convidou quem.
  if exists (select 1 from public.perfis where papel = 'admin' and ativo) then
    raise exception 'Já existe alguém administrando a plataforma. Use o convite.';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is null then
    raise exception 'Não achei a conta %. Crie ela em Authentication > Users primeiro.', v_email;
  end if;

  -- Ninguem e equipe e cliente ao mesmo tempo (gatilho da 0013); se o e-mail
  -- ja for de cliente, o gatilho recusa e a mensagem dele e a resposta certa.
  insert into public.perfis (user_id, nome, email, papel, ativo)
  values (v_user, initcap(split_part(v_email, '@', 1)), v_email, 'admin', true)
  on conflict (user_id) do update
    set papel = 'admin', ativo = true, email = excluded.email;

  return v_user;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reativar_cliente(p_cliente uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_admin() then
    raise exception 'Só quem administra a plataforma reativa um cliente.';
  end if;
  update public.clientes set ativo = true where id = p_cliente;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  -- Os servicos e os acessos NAO voltam sozinhos: qual servico volta, e por
  -- quanto, e decisao de contrato. Voltar tudo no automatico reabriria um
  -- contrato encerrado sem ninguem ter dito o preco.
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_arquivo_da_tarefa(p_tarefa uuid, p_nome text, p_caminho text, p_tipo text DEFAULT NULL::text, p_bytes bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_id uuid;
begin
  if not public.usuario_ve_tarefa(p_tarefa) then
    raise exception 'Esta tarefa não é sua.';
  end if;
  -- O caminho tem de ser DESTA tarefa. Sem isto um anexo poderia apontar para
  -- a pasta de outro cartao e aparecer para quem nao deveria ve-lo.
  if public.tarefa_do_caminho(p_caminho) is distinct from p_tarefa then
    raise exception 'O arquivo precisa estar na pasta desta tarefa.';
  end if;

  insert into public.tarefa_arquivos (tarefa_id, nome, caminho, tipo, bytes, subido_por)
  values (p_tarefa, p_nome, p_caminho, p_tipo, p_bytes, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_documento_do_cliente(p_cliente uuid, p_tipo text, p_nome text, p_caminho text, p_visivel boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id      uuid;
  v_visivel boolean;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para anexar documento.';
  end if;
  if not public.usuario_ve_cliente(p_cliente) then
    raise exception 'Cliente % não encontrado.', p_cliente;
  end if;
  if p_tipo not in ('proposta', 'contrato', 'outro') then
    raise exception
      'Tipo de documento "%" não existe: use proposta, contrato ou outro.', p_tipo;
  end if;
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'Dê um nome ao documento, para a equipe achar depois.';
  end if;
  if public.cliente_do_caminho_midia(p_caminho) is distinct from p_cliente then
    raise exception
      'O caminho do arquivo tem de começar pelo id do cliente (%), senão ninguém '
      'consegue lê-lo.', p_cliente;
  end if;

  -- O padrao do TIPO. Contrato assinado e dos dois lados: esconder o documento
  -- que a pessoa assinou e burocracia, nao cuidado.
  v_visivel := coalesce(p_visivel, p_tipo = 'contrato');

  insert into public.cliente_documentos
    (cliente_id, tipo, nome, caminho, enviado_por, visivel_ao_cliente)
  values
    (p_cliente, p_tipo::public.tipo_documento, btrim(p_nome), p_caminho, auth.uid(),
     v_visivel)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'visivelAoCliente', v_visivel);
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_interacao_do_lead(p_lead uuid, p_oque text, p_proximo_passo text DEFAULT NULL::text, p_proximo_em date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_quem  text;
  v_linha text;
begin
  if not public.usuario_financeiro() then
    raise exception 'O comercial é de quem cuida do dinheiro.';
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
    raise exception 'Lead não encontrado.';
  end if;

  return jsonb_build_object('lead', p_lead, 'anotado', v_linha);
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_midia_post(p_post uuid, p_caminho text, p_mime text, p_largura integer DEFAULT NULL::integer, p_altura integer DEFAULT NULL::integer, p_duracao numeric DEFAULT NULL::numeric, p_bytes bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_post     public.posts%rowtype;
  v_lim      record;
  v_quantas  smallint;
  v_ordem    smallint;
  v_id       uuid;
  v_ehVideo  boolean;
  v_ehImagem boolean;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para anexar mídia.';
  end if;

  select * into v_post from public.posts p where p.id = p_post;
  if not found then
    raise exception 'Peça % não encontrada.', p_post;
  end if;
  if not public.usuario_ve_cliente(v_post.cliente_id) then
    raise exception 'Peça % não encontrada.', p_post;
  end if;

  if v_post.status in ('publicando', 'publicado', 'publicado_parcial') then
    raise exception
      'Esta peça está em % — a mídia não muda mais. Duplique a peça se quiser outra imagem.',
      v_post.status;
  end if;

  if public.cliente_do_caminho_midia(p_caminho) is distinct from v_post.cliente_id then
    raise exception
      'O caminho do arquivo tem de começar pelo id do cliente (%), senão ninguém consegue lê-lo.',
      v_post.cliente_id;
  end if;

  select * into v_lim from public.limites_de_midia(v_post.tipo);
  if not found then
    raise exception 'Tipo de peça % não tem regra de mídia.', v_post.tipo;
  end if;

  v_ehVideo  := p_mime like 'video/%';
  v_ehImagem := p_mime like 'image/%';

  -- O carrossel primeiro, porque a recusa generica abaixo nao explicaria por
  -- que o Instagram aceita e a plataforma nao.
  if v_post.tipo = 'carrossel' and v_ehVideo then
    raise exception
      'Carrossel com vídeo ainda não sai por aqui — é limitação nossa, não da Meta. '
      'Cada vídeo de um carrossel precisa terminar de processar antes de o carrossel ser '
      'montado, e o agendador ainda não sabe esperar por isso. Já está na fila. '
      'Por enquanto: carrossel de fotos, ou um Reel para o vídeo.';
  end if;

  if v_lim.natureza = 'imagem' and not v_ehImagem then
    raise exception 'Peça de imagem aceita foto, não %.', p_mime;
  end if;
  if v_lim.natureza = 'video' and not v_ehVideo then
    raise exception 'Reel aceita vídeo, não %.', p_mime;
  end if;
  if v_lim.natureza = 'imagem_ou_video' and not (v_ehImagem or v_ehVideo) then
    raise exception 'Esta peça aceita foto ou vídeo, não %.', p_mime;
  end if;

  -- A Meta publica imagem so em JPEG (0047). A frase e a da 0068.
  if v_ehImagem and p_mime not in ('image/jpeg', 'image/jpg') then
    raise exception
      'A Meta publica imagem só em JPEG, e este arquivo é %. '
      'A plataforma converte sozinha no envio — PNG e afins viram JPG com fundo '
      'branco. Este chegou sem passar por essa conversão: anexe pela tela da peça.',
      p_mime;
  end if;

  select count(*) into v_quantas from public.post_midias m where m.post_id = p_post;

  if v_quantas >= v_lim.maximo then
    raise exception
      'Esta peça (%) aceita no máximo % arquivo(s), e já tem %.',
      v_post.tipo, v_lim.maximo, v_quantas;
  end if;

  select coalesce(min(g.n), v_quantas)::smallint into v_ordem
    from generate_series(0, v_lim.maximo - 1) as g(n)
   where not exists (select 1 from public.post_midias m where m.post_id = p_post and m.ordem = g.n);

  insert into public.post_midias
    (post_id, ordem, storage_path, mime, largura, altura, duracao_segundos, tamanho_bytes)
  values
    (p_post, v_ordem, p_caminho, p_mime, p_largura, p_altura, p_duracao, p_bytes)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'ordem', v_ordem,
    'quantas', v_quantas + 1,
    'minimo', v_lim.minimo,
    'maximo', v_lim.maximo,
    'completa', (v_quantas + 1) >= v_lim.minimo
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_relatorio_de_campanha(p_cliente uuid, p_de date, p_ate date, p_nome text, p_caminho text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id       uuid;
  v_antigo   text;
  v_trocou   boolean := false;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para anexar relatório.';
  end if;
  if not public.usuario_ve_cliente(p_cliente) then
    raise exception 'Cliente % não encontrado.', p_cliente;
  end if;
  if not public.cliente_tem_modulo(p_cliente, 'campanhas') then
    raise exception
      'Este cliente não tem tráfego pago no contrato, então a aba de campanhas '
      'não existe para ele. Ligue o módulo no contrato antes.';
  end if;
  if p_de is null or p_ate is null then
    raise exception 'Diga o período do relatório: de quando até quando.';
  end if;
  if p_ate < p_de then
    raise exception 'O fim do período (%) é antes do início (%). Confira as datas.', p_ate, p_de;
  end if;
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'Dê um nome ao relatório.';
  end if;
  if public.cliente_do_caminho_midia(p_caminho) is distinct from p_cliente then
    raise exception
      'O caminho do arquivo tem de começar pelo id do cliente (%), senão ninguém '
      'consegue lê-lo.', p_cliente;
  end if;

  select r.id, r.arquivo_caminho into v_id, v_antigo
    from public.relatorios_campanha r
   where r.cliente_id = p_cliente
     and r.periodo_inicio = p_de
     and r.periodo_fim = p_ate;

  if found then
    update public.relatorios_campanha
       set arquivo_nome = btrim(p_nome),
           arquivo_caminho = p_caminho,
           enviado_por = auth.uid(),
           enviado_em = now()
     where id = v_id;
    v_trocou := v_antigo is not null and v_antigo <> p_caminho;
  else
    insert into public.relatorios_campanha
      (cliente_id, periodo_inicio, periodo_fim, arquivo_nome, arquivo_caminho, enviado_por)
    values
      (p_cliente, p_de, p_ate, btrim(p_nome), p_caminho, auth.uid())
    returning id into v_id;
    v_antigo := null;
  end if;

  return jsonb_build_object(
    'id', v_id,
    -- Quem chamou apaga este arquivo do bucket. Nulo quando nada foi trocado.
    'caminhoAntigo', case when v_trocou then v_antigo else null end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.remover_cliente(p_cliente uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nome       text;
  v_galerias   text[];
  v_midias     text[];
  v_documentos text[];
  v_resumo     jsonb;
begin
  if not public.usuario_admin() then
    raise exception 'Só quem administra a plataforma remove um cliente.';
  end if;

  select nome into v_nome from public.clientes where id = p_cliente;
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  -- O que vai embora, contado ANTES de apagar — e o que a tela confirma de
  -- volta para quem clicou. "Apagado" sem numero nao da para conferir.
  v_resumo := jsonb_build_object(
    'nome', v_nome,
    'publicacoes',  (select count(*) from public.posts            where cliente_id = p_cliente),
    'aprovacoes',   (select count(*) from public.itens_aprovacao  where cliente_id = p_cliente),
    'lancamentos',  (select count(*) from public.lancamentos      where cliente_id = p_cliente),
    'captacoes',    (select count(*) from public.sessoes_captacao where cliente_id = p_cliente),
    'contas',       (select count(*) from public.contas_sociais   where cliente_id = p_cliente),
    'documentos',   (select count(*) from public.cliente_documentos where cliente_id = p_cliente)
  );

  -- --- os arquivos, balde por balde ----------------------------------------
  -- `galerias`: original, miniatura e poster de cada item de cada galeria do
  -- cliente. O caminho e nulo quando o item e link externo (provedor antigo).
  select array_agg(c) into v_galerias
    from public.galeria_itens i
    join public.galerias g on g.id = i.galeria_id
    join public.sessoes_captacao s on s.id = g.sessao_id
    cross join lateral unnest(array[i.caminho, i.miniatura_caminho, i.poster_caminho]) as c
   where s.cliente_id = p_cliente and c is not null;

  select array_agg(m.storage_path) into v_midias
    from public.post_midias m
    join public.posts p on p.id = m.post_id
   where p.cliente_id = p_cliente and m.storage_path is not null;

  -- O balde `documentos` guarda contrato/proposta e tambem os relatorios de
  -- campanha. Os dois saem na mesma lista porque saem do mesmo balde.
  select array_agg(c) into v_documentos
    from (
      select d.caminho as c from public.cliente_documentos d where d.cliente_id = p_cliente
      union all
      select r.arquivo_caminho from public.relatorios_campanha r where r.cliente_id = p_cliente
    ) t
   where c is not null;

  -- --- e as linhas ----------------------------------------------------------
  -- Um delete so: o cascade da fundacao leva tudo que pendura em cliente_id.
  delete from public.clientes where id = p_cliente;

  return v_resumo || jsonb_build_object(
    'arquivos', jsonb_build_object(
      'galerias',   coalesce(to_jsonb(v_galerias),   '[]'::jsonb),
      'midias',     coalesce(to_jsonb(v_midias),     '[]'::jsonb),
      'documentos', coalesce(to_jsonb(v_documentos), '[]'::jsonb)
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.remover_documento_do_cliente(p_documento uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_doc public.cliente_documentos;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para tirar documento.';
  end if;

  select * into v_doc from public.cliente_documentos d where d.id = p_documento;
  if not found or not public.usuario_ve_cliente(v_doc.cliente_id) then
    raise exception 'Documento % não encontrado.', p_documento;
  end if;

  delete from public.cliente_documentos where id = p_documento;

  return jsonb_build_object('caminho', v_doc.caminho, 'nome', v_doc.nome);
end;
$function$;

CREATE OR REPLACE FUNCTION public.remover_midia_post(p_midia uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_post     public.posts%rowtype;
  v_post_id  uuid;
  v_caminho  text;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para tirar mídia.';
  end if;

  -- Um `%rowtype` nao pode dividir a lista do INTO com outra variavel.
  select m.storage_path, m.post_id into v_caminho, v_post_id
    from public.post_midias m
   where m.id = p_midia;

  if v_caminho is null then
    raise exception 'Arquivo % não encontrado.', p_midia;
  end if;

  select * into v_post from public.posts p where p.id = v_post_id;

  if not found or not public.usuario_ve_cliente(v_post.cliente_id) then
    raise exception 'Arquivo % não encontrado.', p_midia;
  end if;
  if v_post.status in ('publicando', 'publicado', 'publicado_parcial') then
    raise exception 'Esta peça está em % — a mídia não muda mais.', v_post.status;
  end if;

  delete from public.post_midias where id = p_midia;

  -- Devolve o caminho para a tela apagar o arquivo do bucket. A linha sai
  -- primeiro: arquivo orfao no storage e desperdicio, linha apontando para
  -- arquivo que nao existe e imagem quebrada na cara de quem olha.
  return jsonb_build_object('caminho', v_caminho);
end;
$function$;

CREATE OR REPLACE FUNCTION public.remover_relatorio_de_campanha(p_relatorio uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_rel public.relatorios_campanha;
begin
  if not public.usuario_edita() then
    raise exception 'Você não tem permissão para tirar relatório.';
  end if;

  select * into v_rel from public.relatorios_campanha r where r.id = p_relatorio;
  if not found or not public.usuario_ve_cliente(v_rel.cliente_id) then
    raise exception 'Relatório % não encontrado.', p_relatorio;
  end if;

  -- As campanhas detalhadas vao com ele: `on delete cascade` da 0021. Elas sao
  -- o detalhe DAQUELE relatorio, nao historico independente.
  delete from public.relatorios_campanha where id = p_relatorio;

  return jsonb_build_object('caminho', v_rel.arquivo_caminho, 'nome', v_rel.arquivo_nome);
end;
$function$;

CREATE OR REPLACE FUNCTION public.remover_servico_do_cliente(p_cliente_servico uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cs     public.cliente_servicos;
  v_nome   text;
  v_tabela record;
  v_quantas bigint;
  v_presas text[] := array[]::text[];
begin
  if not public.usuario_admin() then
    raise exception 'Só a direção apaga serviço do contrato.';
  end if;

  select * into v_cs from public.cliente_servicos cs where cs.id = p_cliente_servico;
  if not found or not public.usuario_ve_cliente(v_cs.cliente_id) then
    raise exception 'Serviço do contrato % não encontrado.', p_cliente_servico;
  end if;

  select s.nome into v_nome from public.servicos s where s.id = v_cs.servico_id;

  for v_tabela in
    select c.conrelid::regclass::text as tabela, a.attname as coluna
      from pg_constraint c
      join unnest(c.conkey) k on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
     where c.confrelid = 'public.cliente_servicos'::regclass
       and c.contype = 'f'
       -- As chaves de módulo são configuração deste serviço, não história: vão
       -- junto, e por isso não contam como impedimento.
       and c.conrelid <> 'public.cliente_servico_modulos'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', v_tabela.tabela, v_tabela.coluna)
       into v_quantas using p_cliente_servico;
    if v_quantas > 0 then
      v_presas := v_presas || format('%s (%s)', v_tabela.tabela, v_quantas);
    end if;
  end loop;

  if array_length(v_presas, 1) > 0 then
    raise exception
      'Este serviço já tem histórico (%) e não se apaga: o registro do que foi entregue é '
      'cobrado é o que protege as duas partes. Use encerrar, que guarda a data de fim.',
      array_to_string(v_presas, ', ');
  end if;

  delete from public.cliente_servicos where id = p_cliente_servico;

  return jsonb_build_object('apagado', p_cliente_servico, 'servico', v_nome);
end;
$function$;

CREATE OR REPLACE FUNCTION public.renomear_coluna_de_tarefa(p_coluna uuid, p_nome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissão para mexer nas colunas.';
  end if;
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'A coluna precisa de um nome.';
  end if;
  update public.tarefa_colunas set nome = btrim(p_nome) where id = p_coluna;
  if not found then raise exception 'Coluna não encontrada.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.responder_item(p_item_id uuid, p_decisao estado_aprovacao, p_autor_nome text, p_autor_tipo autor_tipo DEFAULT 'cliente'::autor_tipo, p_comentario text DEFAULT NULL::text)
 RETURNS itens_aprovacao
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item   public.itens_aprovacao;
  v_restam integer;
begin
  if p_decisao not in ('aprovado', 'com_ajustes', 'declinado') then
    raise exception 'Decisão inválida: use aprovado, com_ajustes ou declinado.';
  end if;

  if p_decisao = 'com_ajustes' and length(btrim(coalesce(p_comentario, ''))) = 0 then
    raise exception 'Pedido de ajuste exige um comentário dizendo o que mudar.';
  end if;

  if length(btrim(coalesce(p_autor_nome, ''))) = 0 then
    raise exception 'A resposta precisa de um autor.';
  end if;

  select * into v_item from public.itens_aprovacao where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'Item não encontrado.';
  end if;
  if v_item.estado <> 'em_aprovacao' then
    raise exception 'Este item não está em aprovação (está em %).', v_item.estado;
  end if;

  -- Quem esta logado so responde item de cliente que ele enxerga. Sem isso,
  -- qualquer autenticado aprovaria peca alheia adivinhando um uuid.
  -- auth.uid() nulo = chamada de service_role (Edge Function), que e o caminho
  -- do link sem conta: ali quem valida o token e a funcao, antes de chegar aqui.
  if auth.uid() is not null and not public.usuario_ve_cliente(v_item.cliente_id) then
    raise exception 'Sem permissão para responder este item.';
  end if;

  update public.itens_aprovacao
     set estado = p_decisao,
         respondido_em = now(),
         respondido_por = p_autor_nome
   where id = p_item_id
  returning * into v_item;

  if p_comentario is not null and length(btrim(p_comentario)) > 0 then
    insert into public.aprovacao_comentarios (item_id, autor_tipo, autor_nome, texto)
    values (p_item_id, p_autor_tipo, p_autor_nome, btrim(p_comentario));
  end if;

  -- Fecha todo envio deste item cujos itens ja foram todos respondidos.
  update public.envios_aprovacao e
     set fechado_em = now()
   where e.fechado_em is null
     and exists (select 1 from public.envio_itens ei
                  where ei.envio_id = e.id and ei.item_id = p_item_id)
     and not exists (
       select 1 from public.envio_itens ei
         join public.itens_aprovacao i on i.id = ei.item_id
        where ei.envio_id = e.id and i.estado = 'em_aprovacao');

  return v_item;
end;
$function$;

CREATE OR REPLACE FUNCTION public.responder_nps(p_pesquisa uuid, p_nota smallint, p_comentario text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cliente uuid;
  v_quem    text;
begin
  if p_nota is null or p_nota < 0 or p_nota > 10 then
    raise exception 'A nota vai de 0 a 10.';
  end if;

  select cliente_id into v_cliente from public.nps_pesquisas where id = p_pesquisa;
  if v_cliente is null then
    raise exception 'Pesquisa não encontrada.';
  end if;
  if not public.usuario_ve_cliente(v_cliente) then
    raise exception 'Sem permissão para responder esta pesquisa.';
  end if;
  if exists (select 1 from public.nps_respostas where pesquisa_id = p_pesquisa) then
    raise exception 'Esta pesquisa já foi respondida.';
  end if;

  select coalesce(cu.nome, 'cliente') into v_quem
    from public.clientes_usuarios cu
   where cu.user_id = auth.uid() and cu.cliente_id = v_cliente;

  insert into public.nps_respostas (pesquisa_id, nota, comentario, autor_nome)
  values (p_pesquisa, p_nota, nullif(btrim(coalesce(p_comentario, '')), ''),
          coalesce(v_quem, 'cliente'));
end;
$function$;

CREATE OR REPLACE FUNCTION public.revogar_convite(p_convite uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_cv public.convites;
begin
  select * into v_cv from public.convites where id = p_convite;
  if v_cv.id is null then
    raise exception 'Convite não encontrado.';
  end if;
  if v_cv.aceito_em is not null then
    raise exception 'Este convite já foi aceito. Para tirar o acesso, desative a pessoa.';
  end if;
  if v_cv.revogado_em is not null then
    return;  -- Ja estava revogado: repetir a acao nao e erro.
  end if;

  update public.convites set revogado_em = now() where id = p_convite;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revogar_link_aprovacao(p_link uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.links_aprovacao set revogado = true where id = p_link;
  if not found then
    raise exception 'Link não encontrado.';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_conta_social(p_cliente uuid, p_plataforma plataforma_social, p_nome text, p_ig_user_id text DEFAULT NULL::text, p_page_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.clientes c where c.id = p_cliente) then
    raise exception 'Cliente % não encontrado.', p_cliente;
  end if;
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'A conta precisa de um nome para aparecer na tela.';
  end if;

  -- O CHECK da tabela já cobra isto, e dizer antes é mais gentil que o erro do
  -- Postgres para quem está olhando a tela.
  if p_plataforma = 'instagram' and nullif(btrim(coalesce(p_ig_user_id, '')), '') is null then
    raise exception 'Conta de Instagram precisa do ig_user_id.';
  end if;
  if p_plataforma = 'facebook' and nullif(btrim(coalesce(p_page_id, '')), '') is null then
    raise exception 'Página do Facebook precisa do page_id.';
  end if;

  -- A BUSCA É POR PLATAFORMA, e cada uma pela identidade dela.
  --
  -- Antes um `or` solto casava o `page_id` da Pagina com o `page_id` guardado
  -- na linha do Instagram, e o `update` abaixo renomeava a conta errada. O
  -- `page_id` numa linha de Instagram e vinculo, nao identidade: so a linha
  -- de Facebook e identificada por ele.
  select c.id into v_id
    from public.contas_sociais c
   where c.plataforma = p_plataforma
     and case p_plataforma
           when 'instagram' then c.ig_user_id = p_ig_user_id
           when 'facebook'  then c.page_id    = p_page_id
         end
   limit 1;

  if v_id is not null then
    -- Conta que já existe pode estar em OUTRO cliente: trocar de cliente por
    -- engano moveria a publicação de lugar. Recusa alto.
    if exists (select 1 from public.contas_sociais c where c.id = v_id and c.cliente_id <> p_cliente) then
      raise exception
        'Esta conta da Meta já está ligada a outro cliente. '
        'Desligue lá antes de ligar aqui, para nao publicar no lugar errado.';
    end if;

    update public.contas_sociais
       set nome_exibicao = btrim(p_nome),
           ig_user_id    = coalesce(p_ig_user_id, ig_user_id),
           page_id       = coalesce(p_page_id, page_id),
           ativo         = true,
           atualizado_em = now()
     where id = v_id;

    return jsonb_build_object('id', v_id, 'novo', false, 'nome', btrim(p_nome));
  end if;

  insert into public.contas_sociais (cliente_id, plataforma, nome_exibicao, ig_user_id, page_id)
  values (p_cliente, p_plataforma, btrim(p_nome),
          nullif(btrim(coalesce(p_ig_user_id, '')), ''),
          nullif(btrim(coalesce(p_page_id, '')), ''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'novo', true, 'nome', btrim(p_nome));
end;
$function$;

CREATE OR REPLACE FUNCTION public.segredo_do_cofre(p_nome text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_valor text;
begin
  if p_nome is null or p_nome not in ('resend_api_key') then
    raise exception 'Segredo "%" não está na lista que esta função pode ler.', p_nome;
  end if;

  select s.decrypted_secret into v_valor
    from vault.decrypted_secrets s
   where s.name = p_nome
   limit 1;

  return v_valor;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_bloquear_mutacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  raise exception 'publicacao_eventos é append-only: % não é permitido', tg_op;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_chave_so_em_modulo_opcional()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_opcional boolean;
begin
  select sm.opcional into v_opcional
    from public.cliente_servicos cs
    join public.servico_modulos sm
      on sm.servico_id = cs.servico_id and sm.modulo_id = new.modulo_id
   where cs.id = new.cliente_servico_id;

  if v_opcional is null then
    raise exception 'Este módulo não pertence ao serviço contratado.';
  elsif not v_opcional then
    raise exception 'Este módulo é obrigatório no serviço e não pode ser desligado.';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_cobranca_eventos_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  raise exception 'cobranca_eventos é append-only: % não é permitido', tg_op;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_nao_e_cliente()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if exists (select 1 from public.clientes_usuarios c where c.user_id = new.user_id) then
    raise exception 'Este usuário já tem acesso de cliente e não pode entrar na equipe.';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_nao_e_equipe()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if exists (select 1 from public.perfis p where p.user_id = new.user_id) then
    raise exception 'Este usuário já faz parte da equipe da Astart e não pode virar acesso de cliente.';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_perfil_protege_privilegio()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or public.usuario_admin() then
    return new;
  end if;

  if new.papel is distinct from old.papel then
    raise exception 'Papel só quem administra a plataforma muda.';
  end if;
  if new.ativo is distinct from old.ativo
     or new.desativado_em is distinct from old.desativado_em then
    raise exception 'Acesso só quem administra a plataforma muda.';
  end if;
  if new.user_id is distinct from old.user_id or new.email is distinct from old.email then
    raise exception 'E-mail e conta não se trocam por aqui.';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_rateio_fecha_exato()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_lanc  uuid := coalesce(new.lancamento_id, old.lancamento_id);
  v_total bigint;
  v_soma  bigint;
begin
  select valor_centavos into v_total from public.lancamentos where id = v_lanc;
  if v_total is null then
    return null; -- lancamento foi apagado junto; nada a conferir
  end if;

  select coalesce(sum(valor_centavos), 0) into v_soma
    from public.lancamento_rateios where lancamento_id = v_lanc;

  if v_soma <> 0 and v_soma <> v_total then
    raise exception
      'O rateio soma % e o lançamento é de %. Tem que bater exato.',
      (v_soma::numeric / 100)::money, (v_total::numeric / 100)::money;
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tirar_arquivo_da_tarefa(p_arquivo uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_caminho text;
begin
  select a.caminho into v_caminho
    from public.tarefa_arquivos a
   where a.id = p_arquivo and public.usuario_ve_tarefa(a.tarefa_id);
  if v_caminho is null then
    raise exception 'Anexo não encontrado.';
  end if;
  delete from public.tarefa_arquivos where id = p_arquivo;
  -- Devolve o caminho para o navegador tirar do balde. Mesma razao do apagar
  -- tarefa: SQL nao alcanca o storage.
  return v_caminho;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tirar_mencao_da_tarefa(p_tarefa uuid, p_perfil uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.usuario_ve_tarefa(p_tarefa) then
    raise exception 'Esta tarefa não é sua.';
  end if;
  delete from public.tarefa_mencoes where tarefa_id = p_tarefa and perfil_id = p_perfil;
end;
$function$;

CREATE OR REPLACE FUNCTION public.token_do_sistema()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
declare v_token text;
begin
  select s.decrypted_secret into v_token
    from vault.decrypted_secrets s
   where s.name = 'meta_system_user_token'
   limit 1;

  if v_token is null or length(btrim(v_token)) = 0 then
    raise exception
      'Token da Meta ausente no Vault (chave "meta_system_user_token"). '
      'Cadastre em Ajustes > Integrações antes de conectar contas.';
  end if;

  -- O `btrim` que faltava. Espaço e quebra de linha nas pontas de um valor
  -- colado são invisíveis na tela e viram recusa 190 na Meta.
  return btrim(v_token, E' \t\r\n');
end;
$function$;
