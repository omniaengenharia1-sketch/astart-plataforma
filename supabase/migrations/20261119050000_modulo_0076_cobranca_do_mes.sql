-- =============================================================================
-- 0076 — a cobranca do mes ganha uma porta
--
-- A varredura que a dona cobrou achou isto, e e o mais caro dos achados:
-- OITO contratos ativos e ZERO lancamentos. `gerar_cobrancas_do_contrato`
-- existe desde a 0020, foi corrigida na 0064, tem teste verde no 06 e no 35,
-- e NUNCA FOI CHAMADA. Nao ha tela, nao ha gatilho, nao ha cron. A tela do
-- financeiro ainda dizia, no vazio, "as mensalidades entram sozinhas quando o
-- contrato comeca" — uma frase que ninguem implementou.
--
-- Entao: o faturamento da agencia inteira nunca entrou no sistema. Nao e um
-- bug de borda; e o modulo financeiro sem a entrada de dinheiro.
--
-- O que esta migration acrescenta e UMA funcao, `gerar_cobrancas_do_mes`, que
-- percorre os contratos ativos e chama a funcao que ja existe. Deliberadamente
-- nao mexo em `gerar_cobrancas_do_contrato`: ela esta certa e testada, e
-- reescrever o corpo inteiro (que e o que `create or replace` obriga) para
-- acrescentar um laco seria trocar codigo provado por codigo novo sem motivo.
--
-- DECISOES, e por que:
--
--   1. NAO e automatica. Nada de cron. A cobranca de oito clientes e dinheiro
--      de verdade saindo na conta de alguem; quem aperta e a dona, olhando a
--      tela, e o resultado diz linha por linha o que foi criado. Automatizar
--      vem depois, quando o numero de um mes tiver batido com o extrato.
--
--   2. UM contrato que falha NAO derruba os outros. Cada um roda no seu
--      bloco, e a falha vira uma linha no resultado com a mensagem em
--      portugues — em vez de sete cobrancas perdidas por causa da oitava.
--      (O caso real: `lancamentos` exige valor > 0 e `cliente_servicos`
--      aceita valor = 0. Contrato de cortesia derrubaria a rodada inteira.)
--
--   3. Idempotencia e a rede. `gerar_cobrancas_do_contrato` ja recusa
--      duplicata, e o resultado separa "criadas" de "ja existiam": apertar
--      duas vezes nao cobra duas vezes, e a tela mostra que nao cobrou.
--
--   4. Recorrente usa a competencia pedida. Projeto e pontual usam o mes de
--      INICIO do contrato, porque as parcelas sao uma fila ancorada no comeco
--      e nao no mes em que alguem apertou o botao. Por isso gerar "marco"
--      pode criar parcelas datadas de janeiro — e certo, e o resultado diz.
-- =============================================================================

create or replace function public.gerar_cobrancas_do_mes(p_competencia date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    raise exception 'Gerar cobranca e de quem cuida do dinheiro.';
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
$$;

revoke all on function public.gerar_cobrancas_do_mes(date) from public, anon;
grant execute on function public.gerar_cobrancas_do_mes(date) to authenticated, service_role;

comment on function public.gerar_cobrancas_do_mes(date) is
  'Lanca as mensalidades do mes e as parcelas de projeto ainda nao lancadas, '
  'contrato ativo por contrato ativo. Idempotente: apertar duas vezes nao '
  'cobra duas vezes. Chamada pela tela do Financeiro, nunca por cron.';

-- ---------------------------------------------------------------------------
-- QUANTOS CONTRATOS ESTAO EM JOGO
--
-- O botao precisa dizer o tamanho do que vai fazer ANTES de ser apertado.
-- Nao e uma previa do que sera criado (isso exigiria duplicar a regra de
-- duplicata da outra funcao, e duas copias da mesma regra divergem): e so a
-- contagem de contratos ativos em vigor no mes. A prova de que apertar sem
-- querer nao machuca e a idempotencia, nao esta contagem.
-- ---------------------------------------------------------------------------
create or replace function public.contratos_a_cobrar(p_competencia date default null)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.usuario_financeiro() or public.usuario_admin() then
    (select count(*)::integer
       from public.cliente_servicos cs
      where cs.status = 'ativo'
        and cs.inicio <= (date_trunc('month', coalesce(p_competencia, current_date))
                          + interval '1 month - 1 day')::date
        and (cs.fim is null
             or cs.fim >= date_trunc('month', coalesce(p_competencia, current_date))::date))
  end;
$$;

revoke all on function public.contratos_a_cobrar(date) from public, anon;
grant execute on function public.contratos_a_cobrar(date) to authenticated, service_role;
