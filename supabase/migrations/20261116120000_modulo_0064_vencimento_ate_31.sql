-- 0064 — vencimento pode ser 29, 30 ou 31.
--
-- A dona viu e disse: "os vencimentos dos clientes vao ate dia 28, sendo que a
-- maioria dos clientes pagam dia 30".
--
-- POR QUE ERA 28
--
-- A cobranca recorrente monta a data assim (0020):
--
--   v_venc := make_date(ano, mes, dia_vencimento);
--
-- e `make_date(2026, 2, 30)` nao devolve 28 de fevereiro: ESTOURA, com "date
-- field value out of range". Travar em 28 fazia o estouro nunca acontecer, e o
-- comentario da coluna dizia a verdade pela metade — "29, 30 e 31 nao existem
-- em todo mes" — como se isso impedisse alguem de combinar dia 30 com um
-- cliente. Nao impede. So impede o sistema de registrar o que foi combinado.
--
-- O LIMITE ESTAVA NO LUGAR ERRADO
--
-- Quem cobra todo dia 30 em fevereiro cobra no ultimo dia do mes. E assim que
-- banco, boleto e assinatura fazem, e e o que a agencia ja faz na pratica — o
-- sistema e que nao sabia escrever isso.
--
-- Entao o dia vai ate 31 e a DATA e que se ajusta:
--
--   dia 30, marco     -> 30/03
--   dia 30, fevereiro -> 28/02  (ou 29 em ano bissexto)
--   dia 31, abril     -> 30/04
--   dia 31, fevereiro -> 28/02
--
-- `least(dia, ultimo_dia_do_mes)` faz isso sem ramo nenhum, e sem precisar
-- saber quais meses tem 30 ou 31 nem o que e ano bissexto: quem sabe e o
-- Postgres, no `date_trunc` mais um mes menos um dia.
--
-- NAO MEXE EM COBRANCA JA GERADA
--
-- Isto muda como novas cobrancas nascem. Lancamento que ja existe tem data
-- propria e fica como esta — reescrever vencimento de cobranca emitida mudaria
-- o que ja foi combinado e possivelmente ja pago.
-- ---------------------------------------------------------------------------

-- 1. O limite da coluna
alter table public.cliente_servicos
  drop constraint if exists cliente_servicos_dia_vencimento_check;

alter table public.cliente_servicos
  add constraint cliente_servicos_dia_vencimento_check
  check (dia_vencimento between 1 and 31);

comment on column public.cliente_servicos.dia_vencimento is
  'De 1 a 31. Mes que nao tem o dia escolhido cobra no ultimo dia: dia 30 em '
  'fevereiro vence em 28 (ou 29). Ver `dia_do_mes` e a 0064.';

-- ---------------------------------------------------------------------------
-- 2. A data, que passa a se ajustar ao mes
--
-- Em funcao propria, e nao embutida na geracao, porque sao duas chamadas hoje
-- (gerar a cobranca e mostrar a previsao na tela) e seriam duas copias da
-- mesma regra, que e exatamente como uma delas fica para tras.
-- ---------------------------------------------------------------------------
-- `int`, nao `smallint`: um literal como 30 e integer, e o Postgres nao
-- estreita sozinho — `dia_do_mes(mes, 30)` nao acharia a funcao. A coluna e
-- smallint e alarga para int sem esforco, entao int serve aos dois.
create or replace function public.dia_do_mes(p_mes date, p_dia int)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  -- `least` contra o ultimo dia do mes. Quem sabe quantos dias tem fevereiro
  -- de 2028 e o Postgres, nao esta funcao.
  select (date_trunc('month', p_mes)::date
          + (least(
               p_dia::int,
               extract(day from (date_trunc('month', p_mes) + interval '1 month - 1 day'))::int
             ) - 1));
$$;

comment on function public.dia_do_mes(date, int) is
  'O dia escolhido dentro do mes, ou o ultimo dia quando o mes e mais curto. '
  'Existe porque make_date(2026, 2, 30) estoura em vez de cair para 28.';

revoke all on function public.dia_do_mes(date, int) from public, anon;
grant execute on function public.dia_do_mes(date, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A recusa que mentia
--
-- `coerir_contrato` recusava 29, 30 e 31 dizendo que "nao existem em todo mes".
-- Existir, nao existem; combinar, se combina — e agora o sistema sabe escrever.
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
      raise exception 'Diga o dia de vencimento de % (1 a 31).', p_nome_servico;
    end if;
    if p_dia < 1 or p_dia > 31 then
      raise exception
        'Dia de vencimento de % precisa estar entre 1 e 31.', p_nome_servico;
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
-- 4. A geracao da cobranca, que e onde o estouro morava
--
-- Trocado `make_date(ano, mes, dia)` por `dia_do_mes(mes, dia)`. Era esta
-- linha, e so ela, que obrigava o limite de 28 na tela, no CHECK e na recusa
-- do `coerir_contrato` — tres lugares travados por causa de um.
--
-- O resto da funcao vem igual da 0020: `create or replace` substitui o corpo
-- inteiro, entao recriar so a linha mudada nao e uma opcao.
-- ---------------------------------------------------------------------------
create or replace function public.gerar_cobrancas_do_contrato(
  p_cliente_servico_id uuid,
  p_competencia        date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    raise exception 'Sem permissao para gerar cobranca.';
  end if;

  select * into v_cs from public.cliente_servicos where id = p_cliente_servico_id;
  if v_cs.id is null then raise exception 'Contrato nao encontrado.'; end if;

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
$$;

revoke all on function public.gerar_cobrancas_do_contrato(uuid, date) from public, anon;
grant execute on function public.gerar_cobrancas_do_contrato(uuid, date)
  to authenticated, service_role;
