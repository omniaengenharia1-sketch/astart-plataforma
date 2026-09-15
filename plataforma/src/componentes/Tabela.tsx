import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

export interface Coluna<T> {
  chave: string;
  titulo: string;
  /** Conteúdo da célula. Recebe a linha inteira. */
  render: (linha: T) => ReactNode;
  /** Texto usado pela busca. Sem isto, a coluna não é pesquisável. */
  busca?: (linha: T) => string;
  larguraMin?: string;
}

interface Props<T> {
  linhas: T[];
  colunas: Coluna<T>[];
  chaveDe: (linha: T) => string;
  aoClicar?: (linha: T) => void;
  selecionada?: string | null;
  vazio?: string;
  /** Barra de busca acima da tabela. */
  placeholderBusca?: string;
  /** Nó extra à direita da barra (filtros, botão de ação). */
  acoes?: ReactNode;
}

export function Tabela<T>({
  linhas,
  colunas,
  chaveDe,
  aoClicar,
  selecionada,
  vazio = 'Nada por aqui.',
  placeholderBusca,
  acoes,
}: Props<T>) {
  const [termo, setTermo] = useState('');

  const filtradas = useMemo(() => {
    const t = termo.trim().toLowerCase();
    if (!t) return linhas;
    return linhas.filter((l) =>
      colunas.some((c) => (c.busca ? c.busca(l).toLowerCase().includes(t) : false)),
    );
  }, [linhas, colunas, termo]);

  return (
    <div className="flex flex-col gap-3">
      {(placeholderBusca || acoes) && (
        <div className="flex flex-wrap items-center gap-2.5">
          {placeholderBusca && (
            <input
              type="search"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder={placeholderBusca}
              aria-label={placeholderBusca}
              className="w-full max-w-64 border-0 border-b border-linha-forte bg-transparent px-0 py-1.5 text-[12px] text-tinta placeholder:text-tinta-3 focus:border-pink focus:outline-none"
            />
          )}
          {acoes && <div className="ml-auto flex flex-wrap items-center gap-2">{acoes}</div>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr>
              {colunas.map((c) => (
                <th
                  key={c.chave}
                  scope="col"
                  className="rotulo border-b border-tinta px-3 py-2.5 text-left first:pl-0"
                  style={c.larguraMin ? { minWidth: c.larguraMin } : undefined}
                >
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtradas.map((l) => {
              const k = chaveDe(l);
              const ativa = selecionada === k;
              return (
                <tr
                  key={k}
                  aria-selected={ativa}
                  onClick={aoClicar ? () => aoClicar(l) : undefined}
                  className={
                    'border-b border-linha ' +
                    (aoClicar ? 'cursor-pointer ' : '') +
                    (ativa ? 'bg-pink-suave' : 'hover:bg-superficie-2')
                  }
                >
                  {colunas.map((c) => (
                    <td key={c.chave} className="px-3 py-3 align-top text-[12.5px] first:pl-0">
                      {c.render(l)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={colunas.length} className="px-3 py-9 text-center text-[13px] text-tinta-3">
                  {termo ? `Nada encontrado para "${termo}".` : vazio}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
