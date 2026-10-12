import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

export interface Coluna<T> {
  chave: string;
  titulo: string;
  render: (linha: T) => ReactNode;
  /** Texto usado pela busca. Sem isto, a coluna não é pesquisável. */
  busca?: (linha: T) => string;
  larguraMin?: string;
}

interface Props<T> {
  linhas: T[];
  colunas: Coluna<T>[];
  chaveDe: (linha: T) => string;
  /**
   * Como a linha aparece no celular. Sem isto, o cartão repete coluna por
   * coluna com o título em cima — honesto, mas comprido: sete rótulos por
   * cliente viram uma rolagem que ninguém lê.
   */
  resumo?: (linha: T) => ReactNode;
  aoClicar?: (linha: T) => void;
  selecionada?: string | null;
  vazio?: string;
  placeholderBusca?: string;
  acoes?: ReactNode;
}

export function Tabela<T>({
  linhas,
  colunas,
  chaveDe,
  resumo,
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
    return linhas.filter((l) => colunas.some((c) => c.busca?.(l).toLowerCase().includes(t)));
  }, [linhas, colunas, termo]);

  return (
    <div className="flex flex-col gap-3">
      {(placeholderBusca || acoes) && (
        <div className="flex flex-wrap items-center gap-3">
          {placeholderBusca && (
            <input
              type="search"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder={placeholderBusca}
              aria-label={placeholderBusca}
              className="min-h-10 w-full max-w-72 border-2 border-linha bg-superficie px-3 font-mono text-[12px] placeholder:text-tinta-3 focus:outline-none"
            />
          )}
          {acoes && <div className="ml-auto flex flex-wrap items-center gap-2">{acoes}</div>}
        </div>
      )}

      {/* No celular a tabela vira lista de blocos: rolagem horizontal é o
          jeito mais rápido de uma tabela virar inútil no telefone. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {colunas.map((c) => (
                <th
                  key={c.chave}
                  scope="col"
                  className="rotulo-forte border-b-4 border-linha px-3 py-2.5 text-left first:pl-0"
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
                    'border-b-2 border-linha-fraca ' +
                    (aoClicar ? 'empurra cursor-pointer ' : '') +
                    (ativa ? 'bg-pink text-sobre-pink' : 'hover:bg-superficie-2')
                  }
                >
                  {colunas.map((c) => (
                    <td key={c.chave} className="px-3 py-3.5 align-top text-[13px] first:pl-0">
                      {c.render(l)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={colunas.length} className="rotulo px-3 py-12 text-center">
                  {termo ? `nada encontrado para “${termo}”` : vazio}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {filtradas.map((l) => (
          <div
            key={chaveDe(l)}
            onClick={aoClicar ? () => aoClicar(l) : undefined}
            className={'bloco bg-superficie p-4 ' + (aoClicar ? 'erguer cursor-pointer' : '')}
          >
            {resumo
              ? resumo(l)
              : colunas.map((c) => (
                  <div key={c.chave} className="border-b border-linha-fraca py-2 last:border-0">
                    <div className="rotulo">{c.titulo}</div>
                    <div className="mt-1 text-[13px]">{c.render(l)}</div>
                  </div>
                ))}
          </div>
        ))}
        {filtradas.length === 0 && (
          <p className="rotulo py-10 text-center">
            {termo ? `nada encontrado para “${termo}”` : vazio}
          </p>
        )}
      </div>
    </div>
  );
}
