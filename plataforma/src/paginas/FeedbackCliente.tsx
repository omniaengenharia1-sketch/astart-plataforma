import { useCallback, useEffect, useState } from 'react';
import { Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo } from '../componentes/Campo';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { npsDoCliente, responderNps } from '../dados/api';
import { diaMes, haQuanto } from '../formato';
import type { NpsDoCliente } from '../dados/tipos';

const NOTAS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** O que a nota quer dizer, para a pessoa não ficar adivinhando a escala. */
function legenda(nota: number | null): string {
  if (nota === null) return 'de 0 a 10';
  if (nota >= 9) return 'indicaria com certeza';
  if (nota >= 7) return 'indicaria, com ressalva';
  if (nota >= 5) return 'não indicaria agora';
  return 'não indicaria';
}

/**
 * A nota do cliente. A mesma tela dos dois lados: o cliente responde, a equipe
 * lê o histórico. Quem não é o cliente não vê o formulário — a função do banco
 * recusaria de todo jeito, e botão que não funciona é pior que botão ausente.
 */
export function FeedbackCliente({ clienteId, equipe }: { clienteId: string; equipe: boolean }) {
  const [dados, setDados] = useState<NpsDoCliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [obrigado, setObrigado] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await npsDoCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir o feedback.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function enviar() {
    if (nota === null || !dados?.pendente || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await responderNps(dados.pendente.id, nota, comentario);
      setObrigado(true);
      setNota(null);
      setComentario('');
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui registrar a sua nota.');
    } finally {
      setEnviando(false);
    }
  }

  if (erro && !dados) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!dados) return <Carregando oQue={equipe ? 'o feedback' : 'o seu feedback'} />;

  const podeResponder = !equipe && dados.pendente !== null;

  return (
    <div className="mt-7">
      <div>
        <h2 className="titulao text-[clamp(1.3rem,3.5vw,1.8rem)]">
          {equipe
            ? dados.pendente
              ? `Esperando a nota de ${dados.pendente.competencia.slice(0, 7)}.`
              : 'Nota do mês já respondida.'
            : dados.pendente
              ? 'Como fomos este mês?'
              : 'Obrigado pela sua nota.'}
        </h2>
        <p className="mt-3 max-w-xl text-tinta-2">
          {equipe
            ? 'A pesquisa sai todo mês para quem tem contrato ativo.'
            : dados.pendente
              ? 'Uma pergunta só, e some. A nota vai direto para quem cuida da sua conta.'
              : 'Quando abrir o mês novo, a pergunta volta aqui.'}
        </p>
      </div>

      {obrigado && (
        <p role="status" className="rotulo-forte mt-6 text-pink-texto">
          nota registrada · obrigado
        </p>
      )}

      {erro && (
        <div role="alert" className="bloco mt-6 bg-alerta-fundo p-3.5">
          <span className="rotulo-forte text-pink-texto">não deu certo</span>
          <p className="mt-1 text-[13.5px] font-medium">{erro}</p>
        </div>
      )}

      {podeResponder && dados.pendente && (
        <div className="bloco brilho mt-7 overflow-hidden">
          <div className="aurora h-16" />
          <div className="p-5 sm:p-7">
            <div className="rotulo">
              {dados.pendente.competencia.slice(0, 7)} · quanto você nos indicaria
            </div>

            <div
              role="group"
              aria-label="Nota de 0 a 10"
              className="mt-4 flex flex-wrap gap-2"
            >
              {NOTAS.map((n) => {
                const ativo = nota === n;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => setNota(n)}
                    className={
                      'numeros min-h-12 w-12 rounded-[var(--raio-p)] border text-[15px] font-bold ' +
                      'transition-[transform,background-color,box-shadow] duration-150 hover:-translate-y-px ' +
                      (ativo
                        ? 'border-transparent bg-[linear-gradient(180deg,var(--pink-topo),var(--pink-base))] text-sobre-pink shadow-[0_10px_26px_-12px_rgb(255_61_154/0.95)]'
                        : 'border-linha bg-superficie text-tinta hover:bg-superficie-2')
                    }
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <p className="rotulo mt-3">{legenda(nota)}</p>

            <Campo
              id="nps-comentario"
              rotulo="Quer escrever algo?"
              dica="opcional"
              className="mt-6"
            >
              <textarea
                id="nps-comentario"
                rows={3}
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder="o que foi bom, o que incomodou…"
                className="w-full rounded-[var(--raio-p)] border border-linha bg-superficie px-3.5 py-3 text-[14px] backdrop-blur-xl placeholder:text-tinta-3 focus:outline-none"
              />
            </Campo>

            <Botao
              variante="primario"
              className="mt-5"
              disabled={nota === null || enviando}
              onClick={() => void enviar()}
            >
              {enviando ? 'Enviando…' : 'Enviar nota'}
            </Botao>
          </div>
        </div>
      )}

      <div className="mt-10">
        <Fita>{equipe ? 'As notas deste cliente' : 'O que você já respondeu'}</Fita>
        {dados.respondidas.length === 0 ? (
          <Vazio titulo="Nenhuma nota ainda." explica="A primeira pergunta chega no fim do mês." />
        ) : (
          <ul className="border-t border-linha-fraca">
            {dados.respondidas.map((r) => (
              <li
                key={r.competencia}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-3 py-3.5"
              >
                <span className="numeros w-10 shrink-0 text-[20px] font-extrabold">{r.nota}</span>
                <Marca>{r.competencia.slice(0, 7)}</Marca>
                <span className="min-w-48 flex-1">{r.comentario ? `“${r.comentario}”` : '—'}</span>
                <span className="rotulo shrink-0">
                  {r.quando ? haQuanto(r.quando) : diaMes(r.competencia)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
