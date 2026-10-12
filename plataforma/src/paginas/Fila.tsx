import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { filaPublicacao } from '../dados/api';
import { diaMes, plural } from '../formato';
import { STATUS_PUBLICACAO, TIPO_PECA } from '../rotulos';
import type { PecaNaFila } from '../dados/tipos';

/** Hora no fuso de quem está lendo. O dia vem separado para não repetir. */
function hora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Peca({ p }: { p: PecaNaFila }) {
  const falhou = p.status === 'falhou';
  return (
    <li className={'bloco p-4 ' + (falhou ? 'brilho-p border-l-2 border-l-pink' : '')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              to={`/clientes/${p.clienteId}`}
              className="risca font-bold uppercase hover:text-pink-texto"
            >
              {p.clienteNome}
            </Link>
            <Marca>{TIPO_PECA[p.tipo]}</Marca>
            <Marca forte={falhou}>{STATUS_PUBLICACAO[p.status]}</Marca>
          </div>
          <p className="mt-1.5 font-medium">{p.titulo}</p>
        </div>
        <div className="text-right">
          <div className="numeros text-[15px] font-bold">{hora(p.quando)}</div>
          <div className="rotulo mt-0.5">{diaMes(p.quando)}</div>
        </div>
      </div>

      {/* Erro em português, na linha da peça. Quem abre esta tela abriu para
          resolver uma falha — ela não pode estar atrás de um clique. */}
      {p.erro && (
        <p className="mt-3 rounded-[var(--raio-p)] border-l-2 border-pink bg-superficie-2 px-3.5 py-2.5 text-[13px]">
          {p.erro}
        </p>
      )}

      {p.alvos.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {p.alvos.map((a) => (
            <li
              key={`${a.conta}-${a.plataforma}`}
              className="flex items-center gap-2 rounded-full border border-linha bg-superficie px-3 py-1.5"
            >
              <span className="font-mono text-[11.5px] font-semibold">{a.conta}</span>
              <span className="rotulo">{a.estado}</span>
              {a.tentativas > 1 && (
                <span className="rotulo">· {plural(a.tentativas, 'tentativa', 'tentativas')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Fila() {
  const [fila, setFila] = useState<PecaNaFila[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setFila(await filaPublicacao());
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui carregar a fila.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!fila) return <Carregando oQue="a fila de publicação" />;

  const falhas = fila.filter((p) => p.status === 'falhou');
  const saindo = fila.filter((p) => p.status === 'publicando');
  const proximas = fila.filter((p) => p.status === 'agendado' || p.status === 'aprovado');
  const noAr = fila.filter((p) => p.status === 'publicado');

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <div className="rotulo">fila de publicação</div>
        <h1 className="titulao mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">
          {falhas.length === 0
            ? 'Tudo saindo no horário.'
            : `${plural(falhas.length, 'peça travou', 'peças travaram')}.`}
        </h1>
      </div>

      <div className="escada mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Bloco
          rotulo="Travou"
          destaque={String(falhas.length)}
          alerta={falhas.length > 0}
          sombra={falhas.length > 0}
        />
        <Bloco rotulo="Saindo agora" destaque={String(saindo.length)} />
        <Bloco rotulo="Na fila" destaque={String(proximas.length)} />
        <Bloco rotulo="No ar (2 dias)" destaque={String(noAr.length)} />
      </div>

      {fila.length === 0 ? (
        <Vazio
          titulo="Fila vazia."
          explica="Peça aprovada entra aqui sozinha, na data que você marcou."
          acao={<Botao onClick={() => void carregar()}>Atualizar</Botao>}
        />
      ) : (
        <div className="mt-9 grid items-start gap-9 xl:grid-cols-2">
          <section>
            <Fita acao={<Botao tamanho="pequeno" onClick={() => void carregar()}>Atualizar</Botao>}>
              Precisa de você
            </Fita>
            {falhas.length === 0 && saindo.length === 0 ? (
              <p className="py-4 text-tinta-3">Nada travado.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {[...falhas, ...saindo].map((p) => (
                  <Peca key={p.id} p={p} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <Fita>Próximas</Fita>
            {proximas.length === 0 && noAr.length === 0 ? (
              <p className="py-4 text-tinta-3">Nada agendado.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {[...proximas, ...noAr].map((p) => (
                  <Peca key={p.id} p={p} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
