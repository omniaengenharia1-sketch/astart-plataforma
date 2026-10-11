-- =============================================================================
-- Modulo — 0028: o cadastro de cliente
--
-- Duas funcoes: catalogo(), que a tela le para montar o formulario, e
-- criar_cliente(), que grava cliente e contrato numa transacao so.
--
-- SECURITY INVOKER: quem nao pode escrever em clientes esbarra no RLS, e nao
-- numa checagem escrita na mao aqui dentro.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- sluguificar — o endereco do cliente sai do nome, nao da digitacao
-- ---------------------------------------------------------------------------
create or replace function public.sluguificar(p_texto text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select btrim(
    regexp_replace(
      translate(
        lower(coalesce(p_texto, '')),
        'áàâãäéèêëíìîïóòôõöúùûüçñ',
        'aaaaaeeeeiiiiooooouuuucn'),
      '[^a-z0-9]+', '-', 'g'),
    '-');
$$;

revoke all on function public.sluguificar(text) from public, anon;
grant execute on function public.sluguificar(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- catalogo — servicos, os modulos que cada um liga, e quem pode ser responsavel
-- ---------------------------------------------------------------------------
create or replace function public.catalogo()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ativo() then null::jsonb else jsonb_build_object(

    'servicos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', s.chave,
        'nome', s.nome,
        -- Nulo = o cadastro pergunta o formato. Hoje so o Audiovisual.
        'formatoPadrao', s.formato_padrao,
        'modulos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'chave', m.chave, 'nome', m.nome, 'opcional', sm.opcional)
            order by m.ordem)
          from public.servico_modulos sm
          join public.modulos m on m.id = sm.modulo_id
         where sm.servico_id = s.id), '[]'::jsonb))
        order by s.ordem)
      from public.servicos s where s.ativo), '[]'::jsonb),

    'modulosSempre', coalesce((
      select jsonb_agg(jsonb_build_object('chave', m.chave, 'nome', m.nome) order by m.ordem)
        from public.modulos m where m.sempre), '[]'::jsonb),

    'equipe', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', p.user_id, 'nome', p.nome, 'papel', p.papel)
        order by p.nome)
      from public.perfis p where p.ativo), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.catalogo() from public, anon;
grant execute on function public.catalogo() to authenticated;

-- ---------------------------------------------------------------------------
-- criar_cliente — cliente e contrato de uma vez
--
-- p_servicos e um array de objetos:
--   { "servico": "gestao_digital", "formato": "recorrente", "valorCentavos": 280000,
--     "diaVencimento": 10, "parcelas": null, "inicio": "2026-10-01",
--     "entregaEm": null, "dataEvento": null, "responsavelId": "uuid",
--     "modulos": ["campanhas"] }        <- so os OPCIONAIS que ficam ligados
--
-- Clique duplo nao cria dois clientes: o slug e unico, e a segunda chamada cai
-- na mensagem de endereco ja usado em vez de abrir um cliente gemeo.
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
  v_dia      smallint;
  v_parcelas smallint;
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
    if v_formato is null then
      raise exception 'Diga se % e recorrente ou pontual.', v_servico.nome;
    end if;

    v_valor := coalesce(nullif(v_item->>'valorCentavos', '')::bigint, 0);
    if v_valor < 0 then
      raise exception 'O valor de % nao pode ser negativo.', v_servico.nome;
    end if;

    v_dia      := nullif(v_item->>'diaVencimento', '')::smallint;
    v_parcelas := nullif(v_item->>'parcelas', '')::smallint;

    -- As mesmas regras do CHECK da tabela, ditas em portugues antes de bater nele.
    if v_formato = 'recorrente' then
      if v_dia is null then
        raise exception 'Diga o dia de vencimento de % (1 a 28).', v_servico.nome;
      end if;
      if v_dia < 1 or v_dia > 28 then
        raise exception 'Dia de vencimento de % precisa estar entre 1 e 28: dia 29, 30 e 31 '
                        'nao existem em todo mes.', v_servico.nome;
      end if;
      v_parcelas := null;
    else
      v_parcelas := coalesce(v_parcelas, 1);
      if v_parcelas < 1 then
        raise exception 'O numero de parcelas de % precisa ser pelo menos 1.', v_servico.nome;
      end if;
      v_dia := null;
    end if;

    insert into public.cliente_servicos (
      cliente_id, servico_id, formato, valor_centavos, dia_vencimento, parcelas,
      inicio, entrega_em, data_evento, responsavel_id, observacao)
    values (
      v_cliente, v_servico.id, v_formato, v_valor, v_dia, v_parcelas,
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
