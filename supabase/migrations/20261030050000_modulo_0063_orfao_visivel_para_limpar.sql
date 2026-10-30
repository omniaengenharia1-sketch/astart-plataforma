-- 0063 — quem apaga precisa enxergar.
--
-- A dona apertou "apagar" na faxina nova e nada saiu: continuaram 369
-- arquivos, 175 MB. Fui ver por que, e o motivo e mais grave que o lixo.
--
-- A POLITICA DE LEITURA DO BALDE PERGUNTA SE A GALERIA E SUA
--
--   galerias_le: bucket_id = 'galerias'
--                AND usuario_ve_galeria(galeria_do_caminho(name))
--
-- e `usuario_ve_galeria` e um `exists` contra `public.galerias`. Para arquivo
-- orfao a galeria NAO EXISTE MAIS, entao o exists e falso e ninguem enxerga o
-- arquivo. Medido: a direcao, logada, via ZERO dos 369.
--
-- O Storage precisa ENCONTRAR o objeto para apagar. Sem leitura, o `remove`
-- nao acha nada, nao da erro, e nao apaga nada.
--
-- E ISSO NAO E SO SOBRE O LIXO QUE JA EXISTE
--
-- `excluir_galeria` apaga a LINHA primeiro e manda o navegador tirar os
-- arquivos depois. A ordem foi escolhida de proposito, e o motivo continua
-- certo: ao contrario, uma falha no meio deixaria a galeria mostrando item
-- cujo arquivo nao existe — miniatura quebrada na cara do cliente.
--
-- Mas no instante em que a linha morre, TODOS os arquivos daquela galeria
-- ficam invisiveis para a politica. O navegador entao tenta apagar arquivos
-- que, para ele, nao existem mais.
--
-- Ou seja: nao era uma falha ocasional de rede. TODA galeria apagada vazava
-- 100% dos arquivos, sempre, deterministicamente. Os 175 MB nao foram azar —
-- foram o comportamento normal do sistema desde a 0058.
--
-- O CONSERTO
--
-- A equipe passa a enxergar o que sobrou sem dono. Nada mais: cliente nao
-- entra aqui, porque o ramo novo exige `usuario_edita()`, que e admin ou
-- operacao. E so vale para caminho cuja galeria sumiu — galeria viva continua
-- decidindo quem ve pelo caminho de sempre.
--
-- Caminho torto (que `galeria_do_caminho` devolve nulo) tambem entra no ramo
-- novo, e e o certo: arquivo com nome fora do padrao nao pertence a galeria
-- nenhuma e e exatamente o tipo de lixo que a equipe precisa poder varrer.
-- ---------------------------------------------------------------------------

drop policy if exists galerias_le on storage.objects;

create policy galerias_le on storage.objects
for select
using (
  bucket_id = 'galerias'
  and (
    -- O caminho de sempre: a galeria existe e esta pessoa pode ve-la.
    public.usuario_ve_galeria(public.galeria_do_caminho(name))
    or
    -- O arquivo ficou sem dono. So a equipe ve, e so para poder limpar.
    (
      public.usuario_edita()
      and not exists (
        select 1 from public.galerias g
         where g.id = public.galeria_do_caminho(name)
      )
    )
  )
);
