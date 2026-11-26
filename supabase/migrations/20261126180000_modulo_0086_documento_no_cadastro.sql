-- =============================================================================
-- 0086 — o documento entra no cadastro, nao numa segunda tela
--
-- A cobranca da Asaas so olha cliente que tem CPF ou CNPJ: `cobrancas_para_emitir`
-- filtra `c.cnpj_cpf is not null`. E o cadastro de cliente nao pedia o documento.
-- Resultado: todo cliente novo nascia invisivel para a cobranca, sem nenhum
-- erro na tela — o pior tipo de defeito, o que nao reclama.
--
-- `salvar_dados_de_cobranca` (0081) ja existia para consertar depois, pela ficha.
-- Mas "consertar depois" e uma tarefa que ninguem lembra de fazer. O documento
-- entra agora, na hora em que a pessoa tem o contrato na mao.
--
-- POR QUE O `drop` ANTES
--
-- Os tres campos novos entram com `default null`, para nao quebrar chamada
-- antiga. Mas uma funcao de 7 parametros com defaults e uma de 4 convivem no
-- Postgres como duas funcoes diferentes — e uma chamada com 4 argumentos
-- passa a ser ambigua ("function is not unique"). Entao a de 4 sai.
--
-- O CORPO VEM DA 0070, PALAVRA POR PALAVRA
--
-- Tudo abaixo e a `criar_cliente` da 0070 extraida do arquivo, com tres
-- mudancas e nada mais: a assinatura, o bloco que valida o documento, e o
-- `insert` em `clientes`. Reescrever de memoria uma funcao de cem linhas e
-- como apagar as partes que a gente nao lembra.
--
-- De passagem, os acentos das mensagens desta funcao: elas aparecem na tela
-- dela, e "Ja existe um cliente no endereco" e um texto que a plataforma
-- escreve errado na frente do cliente.
-- =============================================================================

drop function if exists public.criar_cliente(text, jsonb, text, text);

create or replace function public.criar_cliente(
  p_nome           text,
  p_servicos       jsonb,
  p_slug           text default null,
  p_fuso           text default 'America/Sao_Paulo',
  -- Os tres de cobranca entram aqui porque e no cadastro que a pessoa tem o
  -- documento na mao. Pedir depois, numa segunda tela, e como garantir que
  -- ninguem preenche — e sem documento o cliente nunca entra na fila da
  -- Asaas, em silencio.
  p_cnpj_cpf       text default null,
  p_email_cobranca text default null,
  p_telefone       text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
      inicio, entrega_em, data_evento, observacao)
    values (
      v_cliente, v_servico.id, v_formato, v_valor, v_coer.dia_vencimento, v_coer.parcelas,
      coalesce(nullif(v_item->>'inicio', '')::date, current_date),
      nullif(v_item->>'entregaEm', '')::date,
      case when v_formato = 'recorrente' then null
           else nullif(v_item->>'dataEvento', '')::date end,
      nullif(btrim(coalesce(v_item->>'observacao', '')), ''))
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
$$;
revoke all on function
  public.criar_cliente(text, jsonb, text, text, text, text, text) from public, anon;
grant execute on function
  public.criar_cliente(text, jsonb, text, text, text, text, text) to authenticated;

comment on function public.criar_cliente(text, jsonb, text, text, text, text, text) is
  'Cadastra cliente com contrato. CPF/CNPJ, e-mail e telefone de cobranca entram '
  'aqui porque sem documento o cliente nunca entra na fila da Asaas, em silencio.';
