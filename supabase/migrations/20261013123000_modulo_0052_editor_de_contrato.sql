-- 0052 — o contrato de um cliente que JÁ EXISTE.
--
-- A dona perguntou onde se coloca o relatório de campanhas, o NPS e o
-- contrato. Fui olhar antes de responder, e a resposta honesta era "em lugar
-- nenhum": `cliente_servicos` tem um único escritor em todo o sistema, o
-- `criar_cliente()` da 0028. Depois do cadastro, o contrato é só leitura.
--
-- O que isso significa na prática: errou o valor, mudou o dia de vencimento,
-- o cliente contratou um serviço novo, ou encerrou um — e o único caminho é
-- recadastrar o cliente. A tela da ficha ainda dizia, quando não havia
-- serviço: "Adicione um serviço para liberar as abas." Apontando para uma
-- porta que não existe. Foi isso que ela leu e por isso foi procurar.
--
-- E, ao abrir a tabela, um problema maior que a porta faltando:
--
--   A política da 0006 é `for all using (usuario_edita())` — e `for all`
--   INCLUI DELETE. Qualquer pessoa de operação podia apagar uma linha de
--   contrato, e o cascade leva `entregaveis`, `marcos`, `planos_conteudo`,
--   `ambientes`, `acessos`, `integracoes` e `cliente_servico_modulos` com
--   ela. Some o histórico de aprovação do cliente, somem os acessos
--   cadastrados, some o plano de conteúdo.
--
-- É a armadilha nº 9 desta documentação, a mesma que a 0039 consertou em
-- `clientes` — e que eu não fui conferir nas tabelas vizinhas no mesmo dia.
-- Consertar uma ocorrência de um padrão e não varrer as outras é meio
-- conserto.
--
-- Decisões desta migration:
--
-- 1. ENCERRAR, NÃO APAGAR. Serviço encerrado fica na tabela com `status` e
--    `fim`. O registro do que foi entregue e do que foi cobrado é o que
--    protege as duas partes numa divergência; apagar isso para "limpar a
--    tela" é destruir prova. Apagar existe só para desfazer engano, e a
--    função recusa quando já há história — igual ao `remover_cliente()`.
--
-- 2. FORMATO NÃO MUDA. O CHECK da tabela exige colunas diferentes por
--    formato, e os entregáveis já nasceram do modelo do serviço. Virar um
--    recorrente em projeto deixaria entregável órfão e cobrança sem sentido.
--    Recusa alto e manda encerrar e adicionar de novo — a mesma regra do
--    `atualizar_publicacao()`, que recusa trocar o formato da peça com
--    arquivo anexado.
--
-- 3. VALOR SÓ PARA QUEM VÊ VALOR. `valor_centavos` não tem SELECT para
--    `authenticated` (a 0039 escondeu o dinheiro), mas tem UPDATE. Ou seja:
--    operação podia escrever um valor de contrato que não consegue ler. O
--    portão aqui é `ve_valor_do_contrato()`, e quem não vê dinheiro altera o
--    resto do contrato sem tocar no valor.
--
-- 4. VALIDAÇÃO EM UM LUGAR SÓ. As regras de formato (recorrente pede dia de
--    vencimento; projeto e pontual pedem parcelas) estavam escritas em
--    português dentro do `criar_cliente`. Copiá-las para cá criaria duas
--    guardas que um dia discordariam — e a que divergisse seria a menos
--    usada, descoberta por último. Então elas saem para
--    `coerir_contrato()`, e o `criar_cliente` passa a usar a mesma.

-- ---------------------------------------------------------------------------
-- 1. A validação, num lugar só
--
-- Devolve o trio já normalizado: formato, dia e parcelas. Normalizar aqui e
-- não no chamador é de propósito — `recorrente` zera `parcelas` e os outros
-- zeram `dia_vencimento`, e esquecer isso bate no CHECK com uma mensagem do
-- Postgres em vez de uma frase que explica.
-- ---------------------------------------------------------------------------
create or replace function public.coerir_contrato(
  p_nome_servico text,
  p_formato      public.formato_contrato,
  p_dia          smallint,
  p_parcelas     smallint
)
returns table (dia_vencimento smallint, parcelas smallint)
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_formato is null then
    raise exception 'Diga se % e recorrente, projeto ou pontual.', p_nome_servico;
  end if;

  if p_formato = 'recorrente' then
    if p_dia is null then
      raise exception 'Diga o dia de vencimento de % (1 a 28).', p_nome_servico;
    end if;
    if p_dia < 1 or p_dia > 28 then
      raise exception
        'Dia de vencimento de % precisa estar entre 1 e 28: dia 29, 30 e 31 nao existem '
        'em todo mes.', p_nome_servico;
    end if;
    return query select p_dia, null::smallint;
  end if;

  if coalesce(p_parcelas, 1) < 1 then
    raise exception 'O numero de parcelas de % precisa ser pelo menos 1.', p_nome_servico;
  end if;
  return query select null::smallint, coalesce(p_parcelas, 1)::smallint;
end;
$$;

revoke all on function public.coerir_contrato(text, public.formato_contrato, smallint, smallint)
  from public, anon;
grant execute on function public.coerir_contrato(text, public.formato_contrato, smallint, smallint)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Delete sai do `for all`
--
-- Três políticas no lugar de uma. O delete fica só com a direção, e mesmo ela
-- passa pelo `remover_servico_do_cliente()`, que recusa quando há história.
-- ---------------------------------------------------------------------------
drop policy if exists cliente_servicos_escreve on public.cliente_servicos;

create policy cliente_servicos_insere on public.cliente_servicos
  for insert to authenticated with check (public.usuario_edita());

create policy cliente_servicos_atualiza on public.cliente_servicos
  for update to authenticated using (public.usuario_edita()) with check (public.usuario_edita());

create policy cliente_servicos_apaga on public.cliente_servicos
  for delete to authenticated using (public.usuario_admin());

-- A mesma varredura na tabela das chaves de módulo: ela também nasceu com
-- `for all`, e apagar uma chave aqui desliga um módulo sem registro nenhum.
drop policy if exists cliente_servico_modulos_escreve on public.cliente_servico_modulos;

create policy cliente_servico_modulos_insere on public.cliente_servico_modulos
  for insert to authenticated with check (public.usuario_edita());

create policy cliente_servico_modulos_atualiza on public.cliente_servico_modulos
  for update to authenticated using (public.usuario_edita()) with check (public.usuario_edita());

create policy cliente_servico_modulos_apaga on public.cliente_servico_modulos
  for delete to authenticated using (public.usuario_admin());

-- ---------------------------------------------------------------------------
-- 3. O que ainda dá para adicionar
--
-- A tabela tem `unique (cliente_id, servico_id)`: um serviço entra uma vez por
-- cliente. Então a tela não pode oferecer o que já está lá — ela mostraria uma
-- opção que vira erro de unicidade no clique. `jaTem` diz o estado, para a
-- tela saber oferecer "reativar" em vez de "adicionar".
-- ---------------------------------------------------------------------------
create or replace function public.servicos_para_adicionar(p_cliente uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
             'jaTem',         cs.id is not null,
             'estado',        cs.status,
             'clienteServicoId', cs.id,
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
    left join public.cliente_servicos cs
           on cs.servico_id = s.id and cs.cliente_id = p_cliente;

  return coalesce(v, '[]'::jsonb);
end;
$$;

revoke all on function public.servicos_para_adicionar(uuid) from public, anon;
grant execute on function public.servicos_para_adicionar(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Adicionar
--
-- Serviço que já existe ENCERRADO volta a valer em vez de estourar unicidade:
-- é o caso do cliente que parou a gestão por três meses e voltou. A linha é a
-- mesma, com `fim` limpo e `inicio` novo — e os entregáveis antigos continuam
-- pendurados nela, que é o histórico que se quer.
--
-- Serviço já ATIVO recusa, dizendo que para mudar valor é outra função. Criar
-- uma segunda linha seria dobrar a cobrança do cliente.
-- ---------------------------------------------------------------------------
create or replace function public.adicionar_servico_ao_cliente(
  p_cliente      uuid,
  p_servico      text,
  p_formato      text default null,
  p_valor_centavos bigint default null,
  p_dia_vencimento smallint default null,
  p_parcelas     smallint default null,
  p_inicio       date default null,
  p_entrega_em   date default null,
  p_data_evento  date default null,
  p_responsavel  uuid default null,
  p_observacao   text default null,
  p_modulos      text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    raise exception 'Voce nao tem permissao para mexer no contrato.';
  end if;
  if not public.usuario_ve_cliente(p_cliente) then
    raise exception 'Cliente % nao encontrado.', p_cliente;
  end if;

  select * into v_servico from public.servicos s where s.chave = p_servico;
  if not found then
    raise exception 'Servico desconhecido: %.', coalesce(p_servico, '(vazio)');
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
      'Seu acesso nao mexe em valor de contrato. Peca para a direcao ou o financeiro '
      'lancar o valor.';
  end if;
  if v_valor < 0 then
    raise exception 'O valor de % nao pode ser negativo.', v_servico.nome;
  end if;

  select * into v_existe
    from public.cliente_servicos cs
   where cs.cliente_id = p_cliente and cs.servico_id = v_servico.id;

  if found and v_existe.status <> 'encerrado' then
    raise exception
      'Este cliente ja tem % no contrato (%). Para mudar valor ou vencimento use a '
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
           responsavel_id = coalesce(p_responsavel, responsavel_id),
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
      inicio, entrega_em, data_evento, responsavel_id, observacao)
    values (
      p_cliente, v_servico.id, v_formato, v_valor, v_coer.dia_vencimento, v_coer.parcelas,
      coalesce(p_inicio, current_date), p_entrega_em,
      case when v_formato = 'recorrente' then null else p_data_evento end,
      p_responsavel, nullif(btrim(coalesce(p_observacao, '')), ''))
    returning id into v_cs;
  end if;

  -- Chaves de módulo opcional. O gatilho da 0015 recusa override de módulo
  -- que o serviço sempre liga, e a mensagem aqui diz isso antes de bater nele.
  foreach v_modulo in array coalesce(p_modulos, array[]::text[]) loop
    select m.id into v_mid
      from public.modulos m
      join public.servico_modulos sm on sm.modulo_id = m.id
     where m.chave = v_modulo and sm.servico_id = v_servico.id and sm.opcional;
    if v_mid is null then
      raise exception 'O modulo "%" nao e uma opcao de %.', v_modulo, v_servico.nome;
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
$$;

revoke all on function public.adicionar_servico_ao_cliente(
  uuid, text, text, bigint, smallint, smallint, date, date, date, uuid, text, text[]
) from public, anon;
grant execute on function public.adicionar_servico_ao_cliente(
  uuid, text, text, bigint, smallint, smallint, date, date, date, uuid, text, text[]
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Alterar
--
-- Nulo quer dizer "não mexe", em todos os campos. É o que permite a tela de
-- quem não vê dinheiro mandar a alteração sem apagar o valor por omissão — e é
-- o mesmo contrato do `atualizar_publicacao()`.
--
-- Formato e serviço não entram: trocar formato deixaria entregável órfão e
-- cobrança sem sentido, e trocar o serviço é outro contrato.
-- ---------------------------------------------------------------------------
create or replace function public.alterar_servico_do_cliente(
  p_cliente_servico uuid,
  p_valor_centavos  bigint default null,
  p_dia_vencimento  smallint default null,
  p_parcelas        smallint default null,
  p_entrega_em      date default null,
  p_data_evento     date default null,
  p_responsavel     uuid default null,
  p_observacao      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cs      public.cliente_servicos;
  v_nome    text;
  v_coer    record;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para mexer no contrato.';
  end if;

  select * into v_cs from public.cliente_servicos cs where cs.id = p_cliente_servico;
  if not found or not public.usuario_ve_cliente(v_cs.cliente_id) then
    raise exception 'Servico do contrato % nao encontrado.', p_cliente_servico;
  end if;

  select s.nome into v_nome from public.servicos s where s.id = v_cs.servico_id;

  if p_valor_centavos is not null then
    if not public.ve_valor_do_contrato(v_cs.cliente_id) then
      raise exception
        'Seu acesso nao mexe em valor de contrato. Peca para a direcao ou o financeiro.';
    end if;
    if p_valor_centavos < 0 then
      raise exception 'O valor de % nao pode ser negativo.', v_nome;
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
         responsavel_id = coalesce(p_responsavel, responsavel_id),
         observacao     = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao),
         atualizado_em  = now()
   where id = p_cliente_servico;

  return jsonb_build_object('id', p_cliente_servico, 'servico', v_nome);
end;
$$;

revoke all on function public.alterar_servico_do_cliente(
  uuid, bigint, smallint, smallint, date, date, uuid, text
) from public, anon;
grant execute on function public.alterar_servico_do_cliente(
  uuid, bigint, smallint, smallint, date, date, uuid, text
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Encerrar, pausar e reativar
--
-- Encerrar é o caminho normal de tirar um serviço. Ele NÃO apaga nada: a
-- linha fica com `status = 'encerrado'` e `fim` preenchido, e o histórico de
-- entrega e cobrança continua lá — é ele que protege as duas partes quando
-- alguém pergunta, seis meses depois, o que foi entregue.
--
-- Pausar existe separado porque é outra coisa: contrato parado que volta, sem
-- data de fim. Os dois mexem só no `status`, que o portão de módulo já lê: a
-- `cliente_tem_modulo()` conta serviço ATIVO, então pausar e encerrar fecham
-- as abas do cliente na hora, sem mais nenhuma linha de código.
-- ---------------------------------------------------------------------------
create or replace function public.encerrar_servico_do_cliente(
  p_cliente_servico uuid,
  p_fim             date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cs   public.cliente_servicos;
  v_nome text;
  v_fim  date;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para mexer no contrato.';
  end if;

  select * into v_cs from public.cliente_servicos cs where cs.id = p_cliente_servico;
  if not found or not public.usuario_ve_cliente(v_cs.cliente_id) then
    raise exception 'Servico do contrato % nao encontrado.', p_cliente_servico;
  end if;

  v_fim := coalesce(p_fim, current_date);
  if v_fim < v_cs.inicio then
    raise exception
      'A data de fim (%) e anterior ao inicio do servico (%). Confira a data.',
      v_fim, v_cs.inicio;
  end if;

  select s.nome into v_nome from public.servicos s where s.id = v_cs.servico_id;

  update public.cliente_servicos
     set status = 'encerrado', fim = v_fim, atualizado_em = now()
   where id = p_cliente_servico;

  return jsonb_build_object('id', p_cliente_servico, 'servico', v_nome, 'fim', v_fim);
end;
$$;

revoke all on function public.encerrar_servico_do_cliente(uuid, date) from public, anon;
grant execute on function public.encerrar_servico_do_cliente(uuid, date)
  to authenticated, service_role;

create or replace function public.mudar_estado_do_servico(
  p_cliente_servico uuid,
  p_estado          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cs   public.cliente_servicos;
  v_nome text;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para mexer no contrato.';
  end if;
  if p_estado not in ('ativo', 'pausado') then
    raise exception
      'Estado "%" nao serve aqui: use "ativo" ou "pausado". Para encerrar, use '
      'encerrar_servico_do_cliente, que grava a data de fim.', p_estado;
  end if;

  select * into v_cs from public.cliente_servicos cs where cs.id = p_cliente_servico;
  if not found or not public.usuario_ve_cliente(v_cs.cliente_id) then
    raise exception 'Servico do contrato % nao encontrado.', p_cliente_servico;
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
$$;

revoke all on function public.mudar_estado_do_servico(uuid, text) from public, anon;
grant execute on function public.mudar_estado_do_servico(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Apagar — só para desfazer engano
--
-- Irmã do `remover_cliente()` da 0039, e pela mesma razão: o delete existe
-- para o serviço adicionado por engano, não para limpar histórico. Recusa
-- quando há qualquer coisa pendurada e manda encerrar.
--
-- A lista de dependências é lida do CATÁLOGO, não escrita à mão: quem
-- adicionar uma tabela nova apontando para `cliente_servicos` amanhã ganha a
-- proteção sem alterar esta função. Lista à mão é lista que envelhece.
-- ---------------------------------------------------------------------------
create or replace function public.remover_servico_do_cliente(p_cliente_servico uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cs     public.cliente_servicos;
  v_nome   text;
  v_tabela record;
  v_quantas bigint;
  v_presas text[] := array[]::text[];
begin
  if not public.usuario_admin() then
    raise exception 'So a direcao apaga servico do contrato.';
  end if;

  select * into v_cs from public.cliente_servicos cs where cs.id = p_cliente_servico;
  if not found or not public.usuario_ve_cliente(v_cs.cliente_id) then
    raise exception 'Servico do contrato % nao encontrado.', p_cliente_servico;
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
      'Este servico ja tem historico (%) e nao se apaga: o registro do que foi entregue e '
      'cobrado e o que protege as duas partes. Use encerrar, que guarda a data de fim.',
      array_to_string(v_presas, ', ');
  end if;

  delete from public.cliente_servicos where id = p_cliente_servico;

  return jsonb_build_object('apagado', p_cliente_servico, 'servico', v_nome);
end;
$$;

revoke all on function public.remover_servico_do_cliente(uuid) from public, anon;
grant execute on function public.remover_servico_do_cliente(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. O cadastro passa a usar a MESMA validação
--
-- As regras de formato estavam escritas em português dentro do `criar_cliente`
-- e eu acabei de reescrevê-las em `coerir_contrato()`. Duas cópias da mesma
-- regra é a armadilha que esta documentação repete desde a primeira semana: um
-- dia elas discordam, e a que divergir será a menos usada — descoberta por
-- último, pelo cliente.
--
-- Então o cadastro passa a chamar a função. O corpo inteiro é repetido porque
-- `create or replace` não aceita remendo; o que muda é só o bloco de validação,
-- que virou duas linhas.
-- ---------------------------------------------------------------------------
create or replace function public.criar_cliente(
  p_nome     text,
  p_servicos jsonb,
  p_slug     text default null,
  p_fuso     text default 'America/Sao_Paulo'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_slug     text;
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
    raise exception 'Nao consegui montar um endereco a partir de "%". Escreva um.', p_nome;
  end if;
  if exists (select 1 from public.clientes c where c.slug = v_slug) then
    raise exception 'Ja existe um cliente no endereco "%". Escolha outro.', v_slug;
  end if;

  if p_servicos is null or jsonb_typeof(p_servicos) <> 'array'
     or jsonb_array_length(p_servicos) = 0 then
    raise exception 'Escolha pelo menos um servico: e o contrato que liga as telas do cliente.';
  end if;

  insert into public.clientes (nome, slug, fuso_horario)
  values (btrim(p_nome), v_slug, coalesce(nullif(btrim(p_fuso), ''), 'America/Sao_Paulo'))
  returning id into v_cliente;

  for v_item in select * from jsonb_array_elements(p_servicos) loop
    select * into v_servico from public.servicos s where s.chave = v_item->>'servico';
    if v_servico.id is null then
      raise exception 'Servico desconhecido: %.', coalesce(v_item->>'servico', '(vazio)');
    end if;

    v_formato := coalesce(nullif(v_item->>'formato', '')::public.formato_contrato,
                          v_servico.formato_padrao);

    v_valor := coalesce(nullif(v_item->>'valorCentavos', '')::bigint, 0);
    if v_valor < 0 then
      raise exception 'O valor de % nao pode ser negativo.', v_servico.nome;
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
      inicio, entrega_em, data_evento, responsavel_id, observacao)
    values (
      v_cliente, v_servico.id, v_formato, v_valor, v_coer.dia_vencimento, v_coer.parcelas,
      coalesce(nullif(v_item->>'inicio', '')::date, current_date),
      nullif(v_item->>'entregaEm', '')::date,
      case when v_formato = 'recorrente' then null
           else nullif(v_item->>'dataEvento', '')::date end,
      nullif(v_item->>'responsavelId', '')::uuid,
      nullif(btrim(coalesce(v_item->>'observacao', '')), ''))
    returning id into v_cs;

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
        raise exception 'O modulo "%" nao e uma opcao de %.', v_modulo, v_servico.nome;
      end if;
      insert into public.cliente_servico_modulos (cliente_servico_id, modulo_id, ligado)
      values (v_cs, v_mid, true)
      on conflict (cliente_servico_id, modulo_id) do update set ligado = true;
    end loop;
  end loop;

  return jsonb_build_object('id', v_cliente, 'slug', v_slug, 'nome', btrim(p_nome));
end;
$$;

revoke all on function public.criar_cliente(text, jsonb, text, text) from public, anon;
grant execute on function public.criar_cliente(text, jsonb, text, text) to authenticated;
