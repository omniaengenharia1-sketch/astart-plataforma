import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Bloco, Fita } from '../componentes/Bloco';
import { Campo, Entrada } from '../componentes/Campo';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { ItemAprovavel } from '../componentes/ItemAprovavel';
import { Logo } from '../componentes/Marca';
import { lotePorToken, responderPorToken } from '../dados/aprovacao';
import { porExtenso } from '../formato';
import type { LoteDoLink } from '../dados/tipos';

/**
 * A página de quem recebeu o link no WhatsApp. Sem login, sem casca da
 * plataforma, sem menu: ela não é usuária de nada, é alguém que recebeu um
 * endereço. A marca grande é a DELA; a nossa assina pequeno no rodapé.
 *
 * O nome é pedido uma vez, antes de qualquer botão funcionar. Sem conta não há
 * de onde tirar quem respondeu — e "respondido por: alguém" não serve para a
 * equipe que vai refazer o material.
 */
const CHAVE_NOME = 'astart.link.quem';

export function Aprovar() {
  const { token = '' } = useParams();
  const [lote, setLote] = useState<LoteDoLink | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [quem, setQuem] = useState('');
  const [confirmado, setConfirmado] = useState(false);

  useEffect(() => {
    try {
      const guardado = sessionStorage.getItem(CHAVE_NOME);
      if (guardado) {
        setQuem(guardado);
        setConfirmado(true);
      }
    } catch {
      // Navegador com armazenamento bloqueado: ela digita o nome de novo, e
      // nada mais que isso quebra.
    }
  }, []);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setLote(await lotePorToken(token));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Este link não vale mais.');
    }
  }, [token]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function guardarNome(valor: string) {
    setQuem(valor);
    try {
      sessionStorage.setItem(CHAVE_NOME, valor);
    } catch {
      /* idem */
    }
  }

  const abertos = (lote?.itens ?? []).filter((i) => i.estado === 'em_aprovacao');
  const respondidos = (lote?.itens ?? []).filter((i) => i.estado !== 'em_aprovacao');

  return (
    <div className="min-h-dvh text-tinta">
      <main id="conteudo" className="entra px-5 pb-16 sm:px-8 lg:px-12">
        {erro && !lote ? (
          // Link errado, revogado e lote apagado dizem a mesma coisa: quem
          // tenta adivinhar endereço não descobre nada aqui.
          <div className="mx-auto max-w-lg pt-16">
            <Falhou mensagem={erro} />
            <p className="rotulo mt-4 normal-case">
              Se você recebeu este link da Astart, peça um novo para quem te mandou.
            </p>
          </div>
        ) : !lote ? (
          <Carregando oQue="o material" />
        ) : (
          <>
            <div className="pt-9">
              <div className="rotulo">para aprovar · {porExtenso(lote.quando)}</div>
              <h1 className="titulao mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">
                {lote.fechado
                  ? 'Tudo respondido. Obrigado!'
                  : abertos.length === 1
                    ? 'Um item espera você.'
                    : `${abertos.length} itens esperam você.`}
              </h1>
              <div className="rotulo mt-2">{lote.cliente}</div>
              {lote.mensagem && (
                <p className="mt-4 max-w-xl rounded-[var(--raio-p)] border-l-2 border-pink bg-superficie-2 px-4 py-3 text-[14.5px]">
                  {lote.mensagem}
                </p>
              )}
            </div>

            {!lote.fechado && (
              <div className="escada mt-7 grid grid-cols-3 gap-4">
                <Bloco rotulo="Esperando você" destaque={String(abertos.length)} alerta sombra />
                <Bloco rotulo="Já respondidos" destaque={String(respondidos.length)} />
                <Bloco rotulo="No total" destaque={String(lote.itens.length)} />
              </div>
            )}

            {/* Sem conta, quem responde tem de se apresentar — e é esse nome
                que a equipe lê na fila quando for refazer. */}
            {!lote.fechado && !confirmado && (
              <div className="bloco brilho mt-7 max-w-md overflow-hidden">
                <div className="aurora h-14" />
                <div className="p-5">
                  <Campo
                    id="quem"
                    rotulo="Quem está respondendo?"
                    dica="a equipe vê este nome"
                  >
                    <Entrada
                      id="quem"
                      value={quem}
                      onChange={(e) => setQuem(e.target.value)}
                      placeholder="seu nome"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && quem.trim()) {
                          guardarNome(quem.trim());
                          setConfirmado(true);
                        }
                      }}
                    />
                  </Campo>
                  <button
                    type="button"
                    disabled={!quem.trim()}
                    onClick={() => {
                      guardarNome(quem.trim());
                      setConfirmado(true);
                    }}
                    className="mt-4 min-h-11 w-full rounded-full bg-[linear-gradient(180deg,var(--pink-topo),var(--pink-base))]
 px-5 font-mono text-[10.5px] font-semibold tracking-[0.14em] uppercase text-sobre-pink
 disabled:pointer-events-none disabled:opacity-40"
                  >
                    Começar
                  </button>
                </div>
              </div>
            )}

            {abertos.length > 0 && confirmado && (
              <>
                <div className="mt-9 flex flex-wrap items-baseline justify-between gap-2">
                  <Fita>Um por um</Fita>
                  <button
                    type="button"
                    onClick={() => setConfirmado(false)}
                    className="rotulo risca hover:text-pink-texto"
                  >
                    respondendo como {quem} · trocar
                  </button>
                </div>
                <ul className="escada mt-4 grid gap-5 xl:grid-cols-2">
                  {abertos.map((i) => (
                    <ItemAprovavel
                      key={i.id}
                      id={i.id}
                      tipo={i.tipo}
                      titulo={i.titulo}
                      enviadoEm={lote.quando}
                      responder={async (decisao, texto) => {
                        setLote(await responderPorToken(token, i.id, decisao, quem, texto));
                      }}
                    />
                  ))}
                </ul>
              </>
            )}

            {respondidos.length > 0 && (
              <>
                <div className="mt-10">
                  <Fita>O que você já respondeu</Fita>
                </div>
                <ul className="mt-4 grid gap-5 xl:grid-cols-2">
                  {respondidos.map((i) => (
                    <ItemAprovavel
                      key={i.id}
                      id={i.id}
                      tipo={i.tipo}
                      titulo={i.titulo}
                      enviadoEm={i.respondidoEm}
                      estado={i.estado}
                      respondidoPor={i.respondidoPor}
                      comentario={i.comentario}
                      responder={async () => {}}
                    />
                  ))}
                </ul>
              </>
            )}

            {lote.itens.length === 0 && (
              <Vazio titulo="Nada neste link." explica="Peça um novo para quem te mandou." />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-linha-fraca px-5 py-7 text-center sm:px-8 lg:px-12">
        <div className="flex items-center justify-center gap-2">
          <span className="rotulo">feito por</span>
          <Logo altura={16} />
        </div>
      </footer>
    </div>
  );
}
