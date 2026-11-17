-- 0070 — um servico pode ser cuidado por MAIS DE UMA pessoa.
--
-- A dona: "na parte que cadastro cliente pra colocar quem cuidara disso, deve
-- ser multipla escolha, as vezes o cliente e cuidado por mais de uma pessoa".
--
-- ONDE O RESPONSAVEL MORAVA, E POR QUE CONTINUA MORANDO LA
--
-- Desde a 0015 o responsavel e do SERVICO contratado, nao do cliente. Entao a
-- Mor Marcas ja podia ter a Raquel na Gestao Digital e a Layana no
-- Audiovisual. O que faltava era DUAS pessoas no mesmo servico.
--
-- Perguntei a ela qual dos dois desenhos queria, e ela escolheu manter no
-- servico: e mais preciso, e a informacao de quem cuida de cada frente ja esta
-- preenchida — mudar para o cliente inteiro jogaria isso fora. Tambem escolheu
-- que ninguem e "o principal": a lista e uma lista.
--
-- UMA FONTE SO
--
-- A coluna `responsavel_id` SAI. Nao fica como "o principal" ao lado da tabela
-- nova: duas fontes para a mesma informacao e o tipo de coisa que apodrece em
-- silencio, e um dia as duas discordam sem ninguem notar. O que existe hoje e
-- copiado para a tabela antes de a coluna cair.
-- ---------------------------------------------------------------------------

create table if not exists public.cliente_servico_responsaveis (
  cliente_servico_id uuid not null references public.cliente_servicos(id) on delete cascade,
  perfil_id          uuid not null references public.perfis(user_id)      on delete cascade,
  criado_em          timestamptz not null default now(),
  primary key (cliente_servico_id, perfil_id)
);

-- Para a pergunta "de que o Fulano cuida?", que a tela de equipe faz.
create index if not exists cliente_servico_responsaveis_perfil
  on public.cliente_servico_responsaveis (perfil_id);

-- O QUE JA EXISTE ENTRA ANTES DE A COLUNA CAIR. Sem isto, a migration
-- apagaria em silencio quem cuida de cada contrato.
insert into public.cliente_servico_responsaveis (cliente_servico_id, perfil_id)
select cs.id, cs.responsavel_id
  from public.cliente_servicos cs
 where cs.responsavel_id is not null
on conflict do nothing;

alter table public.cliente_servico_responsaveis enable row level security;

-- Quem ve o cliente ve quem cuida dele. Isso inclui o proprio cliente: na aba
-- Contrato ele le quem responde pelo que contratou.
drop policy if exists cliente_servico_responsaveis_le on public.cliente_servico_responsaveis;
create policy cliente_servico_responsaveis_le on public.cliente_servico_responsaveis
  for select to authenticated
  using (exists (
    select 1 from public.cliente_servicos cs
     where cs.id = cliente_servico_id
       and public.usuario_ve_cliente(cs.cliente_id)
  ));

-- Escrever e pela funcao, que valida. A politica existe para a equipe nao
-- depender de service role, e nao para a tela escrever direto.
drop policy if exists cliente_servico_responsaveis_escreve on public.cliente_servico_responsaveis;
create policy cliente_servico_responsaveis_escreve on public.cliente_servico_responsaveis
  for all to authenticated
  using (public.usuario_edita()) with check (public.usuario_edita());

revoke all on public.cliente_servico_responsaveis from anon;
grant select, insert, update, delete on public.cliente_servico_responsaveis to authenticated;

-- ---------------------------------------------------------------------------
-- Ler: os nomes, em ordem, para a tela
-- ---------------------------------------------------------------------------
create or replace function public.responsaveis_do_servico(p_cs uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(p.nome order by p.nome), array[]::text[])
    from public.cliente_servico_responsaveis r
    join public.perfis p on p.user_id = r.perfil_id
   where r.cliente_servico_id = p_cs;
$$;

revoke all on function public.responsaveis_do_servico(uuid) from public, anon;
grant execute on function public.responsaveis_do_servico(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Escrever: a lista inteira de uma vez
--
-- Recebe a lista final e faz o banco chegar nela. E mais simples de acertar do
-- que "adiciona um" e "remove um" separados: a tela manda o que ficou marcado,
-- e nao precisa saber o que mudou.
-- ---------------------------------------------------------------------------
create or replace function public.definir_responsaveis_do_servico(
  p_cliente_servico uuid,
  p_perfis          uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cs     public.cliente_servicos;
  v_perfis uuid[];
  v_fora   text;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para mexer no contrato.';
  end if;

  select * into v_cs from public.cliente_servicos cs where cs.id = p_cliente_servico;
  if not found or not public.usuario_ve_cliente(v_cs.cliente_id) then
    raise exception 'Servico do contrato % nao encontrado.', p_cliente_servico;
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
    raise exception 'Perfil % nao esta na equipe ativa.', v_fora;
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
$$;

revoke all on function public.definir_responsaveis_do_servico(uuid, uuid[]) from public, anon;
grant execute on function public.definir_responsaveis_do_servico(uuid, uuid[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- As assinaturas antigas saem. `create or replace` com outro tipo de parametro
-- criaria uma SEGUNDA funcao com o mesmo nome, e o PostgREST escolheria uma
-- delas sem ninguem mandar.
-- ---------------------------------------------------------------------------
drop function if exists public.adicionar_servico_ao_cliente(
  uuid, text, text, bigint, smallint, smallint, date, date, date, uuid, text, text[]);
drop function if exists public.alterar_servico_do_cliente(
  uuid, bigint, smallint, smallint, date, date, uuid, text);

-- ---------------------------------------------------------------------------
-- As cinco funcoes que liam ou escreviam a coluna, agora pela tabela
-- ---------------------------------------------------------------------------
create or replace function public.lista_clientes()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ativo() then null::jsonb else
    coalesce(jsonb_agg(x order by x->>'nome'), '[]'::jsonb) end from (
    select jsonb_build_object(
      'id', c.id,
      'nome', c.nome,
      'slug', c.slug,
      'servicos', coalesce((
        select jsonb_agg(s.nome order by s.ordem)
          from public.cliente_servicos cs
          join public.servicos s on s.id = cs.servico_id
         where cs.cliente_id = c.id and cs.status = 'ativo'), '[]'::jsonb),
      'responsaveis', coalesce((
        select jsonb_agg(distinct pe.nome)
          from public.cliente_servicos cs
          join public.cliente_servico_responsaveis csr on csr.cliente_servico_id = cs.id
          join public.perfis pe on pe.user_id = csr.perfil_id
         where cs.cliente_id = c.id and cs.status = 'ativo'), '[]'::jsonb),
      'precisaDeVoce', (
        select count(*) from public.itens_aprovacao i
         where i.cliente_id = c.id and i.estado = 'com_ajustes'),
      'esperandoCliente', (
        select count(*) from public.itens_aprovacao i
         where i.cliente_id = c.id and i.estado = 'em_aprovacao'),
      -- Nulo, nao zero: a coluna desaparece da tabela em vez de mostrar
      -- "R$ 0,00" ao lado de um cliente que paga 2.800 por mes.
      'mensalCentavos', t.mensal_centavos,
      'unicoCentavos', t.unico_centavos
    ) as x
      from public.clientes c
      left join lateral public.contrato_totais(c.id) t on true
     where c.ativo
  ) y;
$$;


create or replace function public.ficha_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
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
        'parcelas', v.parcelas, 'inicio', cs.inicio, 'entregaEm', cs.entrega_em)
        order by s.ordem)
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
$$;


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
  p_responsaveis uuid[] default null,
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


create or replace function public.alterar_servico_do_cliente(
  p_cliente_servico uuid,
  p_valor_centavos  bigint default null,
  p_dia_vencimento  smallint default null,
  p_parcelas        smallint default null,
  p_entrega_em      date default null,
  p_data_evento     date default null,
  p_responsaveis    uuid[] default null,
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
         observacao     = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao),
         atualizado_em  = now()
   where id = p_cliente_servico;

  -- Nulo quer dizer "nao mexe"; lista vazia quer dizer "tire todos".
  if p_responsaveis is not null then
    perform public.definir_responsaveis_do_servico(p_cliente_servico, p_responsaveis);
  end if;

  return jsonb_build_object('id', p_cliente_servico, 'servico', v_nome);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissoes das assinaturas novas
-- ---------------------------------------------------------------------------
revoke all on function public.adicionar_servico_ao_cliente(
  uuid, text, text, bigint, smallint, smallint, date, date, date, uuid[], text, text[]
) from public, anon;
grant execute on function public.adicionar_servico_ao_cliente(
  uuid, text, text, bigint, smallint, smallint, date, date, date, uuid[], text, text[]
) to authenticated, service_role;

revoke all on function public.alterar_servico_do_cliente(
  uuid, bigint, smallint, smallint, date, date, uuid[], text
) from public, anon;
grant execute on function public.alterar_servico_do_cliente(
  uuid, bigint, smallint, smallint, date, date, uuid[], text
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- E so agora a coluna sai, com as cinco funcoes ja sem ela.
-- ---------------------------------------------------------------------------
alter table public.cliente_servicos drop column if exists responsavel_id;
