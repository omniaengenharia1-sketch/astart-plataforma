import { useState } from 'react';
import { Bloco, Fita } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Falhou, Vazio } from '../componentes/Estado';
import { ItemAprovavel } from '../componentes/ItemAprovavel';
import { responderItem } from '../dados/api';
import type { ItemAprovacao } from '../dados/tipos';

export function PortalAprovar({
  itens,
  nome,
  recarregar,
}: {
  itens: ItemAprovacao[];
  nome: string;
  recarregar: () => Promise<void>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [lote, setLote] = useState(false);
  const [erroLote, setErroLote] = useState<string | null>(null);

  async function aprovarTudo() {
    if (lote) return;
    setLote(true);
    setErroLote(null);
    try {
      // Uma por uma, em sequência. Se a terceira falhar, as duas primeiras
      // valem: a função do banco recusa responder item já respondido, então
      // repetir a ação não aprova nada duas vezes.
      for (const i of itens) {
        await responderItem(i.id, 'aprovado', nome);
      }
      setConfirmando(false);
      await recarregar();
    } catch (x) {
      setErroLote(x instanceof Error ? x.message : 'Não consegui aprovar tudo.');
      await recarregar();
    } finally {
      setLote(false);
    }
  }

  const n = itens.length;

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        
        <h1 className="titulao mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">
          {n === 0 ? 'Nada esperando você.' : `${n} ${n === 1 ? 'item espera' : 'itens esperam'} você.`}
        </h1>
        {n > 0 && (
          <p className="mt-3 max-w-xl text-tinta-2">
            Aprove o que estiver bom. Se precisar mudar, escreva o que mudar.
          </p>
        )}
      </div>

      {n === 0 ? (
        <Vazio
          titulo="Tudo respondido."
          explica="A gente avisa quando chegar material novo."
        />
      ) : (
        <>
          <div className="escada mt-7 grid grid-cols-3 gap-4">
            <Bloco rotulo="Esperando você" destaque={String(n)} alerta sombra />
            <Bloco
              rotulo="Peças"
              destaque={String(itens.filter((i) => i.tipo === 'peca').length)}
            />
            <Bloco
              rotulo="Entregáveis"
              destaque={String(itens.filter((i) => i.tipo === 'entregavel').length)}
            />
          </div>

          {n > 1 && (
            <div className="mt-7 flex flex-wrap items-center gap-3">
              {confirmando ? (
                <>
                  <span className="rotulo-forte">aprovar os {n}?</span>
                  <Botao variante="primario" disabled={lote} onClick={() => void aprovarTudo()}>
                    {lote ? 'Aprovando…' : 'Sim, aprovar'}
                  </Botao>
                  <Botao variante="texto" disabled={lote} onClick={() => setConfirmando(false)}>
                    Ver um por um
                  </Botao>
                </>
              ) : (
                <Botao onClick={() => setConfirmando(true)}>Aprovar tudo</Botao>
              )}
            </div>
          )}

          {erroLote && <Falhou mensagem={erroLote} />}

          <div className="mt-8">
            <Fita>Um por um</Fita>
          </div>
          <ul className="escada mt-4 grid gap-5 xl:grid-cols-2">
            {itens.map((i) => (
              <ItemAprovavel
                key={i.id}
                id={i.id}
                tipo={i.tipo}
                titulo={i.titulo}
                enviadoEm={i.enviadoEm}
                responder={async (decisao, texto) => {
                  await responderItem(i.id, decisao, nome, texto);
                  await recarregar();
                }}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
