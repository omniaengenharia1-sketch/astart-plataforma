-- 0062 — achar arquivo que ficou no balde sem dono.
--
-- A dona perguntou onde as fotos ficam guardadas. Fui medir para responder com
-- numero em vez de descricao, e o numero contou outra coisa:
--
--   Confraria 23/10 ......... 370 arquivos ... 105 MB
--   Vida Ativa 28/10 ........  47 arquivos ...  19 MB
--   (galeria que nao existe)  369 arquivos ... 175 MB   <-- 60% do balde
--
-- A pasta `ddca5d2f-…` subiu em 28/10 as 19:02 e tem 184 miniaturas em PNG —
-- e a primeira subida da Confraria, de antes do conserto do gerador de
-- miniaturas. A galeria foi apagada e os arquivos ficaram.
--
-- POR QUE NINGUEM VIU
--
-- `excluirGaleria` apaga as linhas, recebe os caminhos e tira os arquivos do
-- balde pelo navegador de quem clicou. Quando um lote falha, ela conta o que
-- saiu e segue — com este comentario, que eu mesmo escrevi:
--
--   "Arquivo que nao sai nao desfaz a exclusao — a linha ja foi. Conta o que
--    saiu e segue: o resto e lixo no balde, nao defeito na tela."
--
-- A primeira metade esta certa: nao da para desfazer a exclusao, e deixar
-- arquivo orfao e melhor que deixar galeria apontando para arquivo que sumiu.
-- A segunda metade e falha silenciosa, que e proibida aqui. "Nao e defeito na
-- tela" virou "ninguem nunca fica sabendo", e o lixo cresce sem limite.
--
-- Esta funcao e o olho que faltava. Quem apaga continua sendo o navegador —
-- SQL nao alcanca o storage — mas agora da para PERGUNTAR o que sobrou.
--
-- O CUIDADO QUE IMPORTA: ARQUIVO A CAMINHO NAO E ORFAO
--
-- O upload sobe o arquivo PRIMEIRO e grava a linha depois (`subirItem`), e e
-- a ordem certa: ao contrario, uma falha no meio deixaria a galeria mostrando
-- item cujo arquivo nao existe. Mas isso significa que, durante uma subida, ha
-- arquivos no balde sem linha — e eles sao exatamente iguais a um orfao.
--
-- Descobri isso medindo: entre duas consultas minhas, a Vida Ativa foi de 47
-- para 108 arquivos, porque a dona estava subindo fotos naquele instante. Um
-- faxineiro ingenuo teria apagado as fotos dela no meio do upload.
--
-- Por isso `p_minutos`: so conta como orfao o arquivo parado ha mais tempo que
-- isso. Uma hora e muito mais que qualquer upload, e o erro de esperar demais
-- custa espaco; o de esperar de menos custa foto de cliente.
-- ---------------------------------------------------------------------------

create or replace function public.arquivos_orfaos(p_minutos int default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_resposta jsonb;
begin
  -- Direcao, nao equipe: a lista mistura caminhos de TODOS os clientes, e
  -- apagar em massa nao tem desfazer. Mesma porta de `excluir_galeria`.
  if not public.usuario_admin() then
    raise exception 'So a direcao ve os arquivos orfaos.';
  end if;

  if p_minutos < 10 then
    raise exception
      'Margem curta demais (%). Arquivo recem-subido ainda nao tem linha no '
      'banco e seria confundido com orfao — isso apagaria foto no meio do '
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
$$;

revoke all on function public.arquivos_orfaos(int) from public, anon;
grant execute on function public.arquivos_orfaos(int) to authenticated, service_role;
