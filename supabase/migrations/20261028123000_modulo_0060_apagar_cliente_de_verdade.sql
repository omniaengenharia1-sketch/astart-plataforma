-- 0060 — apagar cliente passa a apagar de verdade, arquivos inclusive.
--
-- A 0039 recusava cliente com qualquer historico:
--
--   "Este cliente ja tem 1 registros. Tire do ar em vez de apagar."
--
-- A dona bateu na frase e depois na regra, nessa ordem, e nas duas tinha razao
-- por motivos diferentes.
--
-- A FRASE era ruim em tres camadas: "1 registros" nao concorda; "registros"
-- nao diz do que; e "tire do ar" manda fazer algo sem dizer onde fica. A
-- mensagem do banco E a mensagem da tela, entao isso aparecia exatamente assim
-- para quem usa.
--
-- A REGRA eu defendi — cascade levaria publicacoes, cobrancas e galerias junto
-- — e ela respondeu: *"mas pode apagar, nao deixa em historico que sobrecarrega
-- a memoria. apagou apagou"*. E decisao dela, e esta tomada. Historico de
-- cliente que saiu ocupa espaco e aparece em relatorio sem ninguem querer.
--
-- Entao a recusa sai. Mas apagar as LINHAS nao e apagar: as fotos das galerias,
-- as midias dos posts e os documentos vivem no Storage, e o cascade nao alcanca
-- balde nenhum. Sem tratar isso, "apagar o cliente" deixaria centenas de MB
-- orfaos — exatamente a sobrecarga que ela quer evitar, agora sem nenhuma linha
-- que os aponte para alguem limpar depois.
--
-- Entao a funcao devolve os CAMINHOS, agrupados por balde, e quem tira do
-- Storage e o navegador de quem clicou — com o proprio JWT, porque funcao SQL
-- nao alcanca o Storage. A ordem e a mesma do resto do projeto e da
-- `excluir_galeria`: linha primeiro, arquivo depois. Ao contrario, uma falha no
-- meio deixaria tela apontando para arquivo que nao existe. Do jeito certo,
-- deixa arquivo orfao — desperdicio, nao defeito.
--
-- Continua sendo so da DIRECAO, e a tela passa a pedir o nome digitado. "Apagou
-- apagou" pede confirmacao a altura: um clique nao desfaz 185 fotos de cliente.

-- Ela devolvia `void` e passa a devolver o resumo com os caminhos, e o Postgres
-- nao troca o tipo de retorno num `create or replace`. O `drop` e seguro: nao
-- ha view nem trigger pendurada nela, so a tela chamando por RPC.
drop function if exists public.remover_cliente(uuid);

create or replace function public.remover_cliente(p_cliente uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nome       text;
  v_galerias   text[];
  v_midias     text[];
  v_documentos text[];
  v_resumo     jsonb;
begin
  if not public.usuario_admin() then
    raise exception 'So quem administra a plataforma remove um cliente.';
  end if;

  select nome into v_nome from public.clientes where id = p_cliente;
  if not found then
    raise exception 'Cliente nao encontrado.';
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
$$;

revoke all on function public.remover_cliente(uuid) from public, anon;
grant execute on function public.remover_cliente(uuid) to authenticated;
