import type { ReactNode } from 'react';

export type TomPilula = 'ok' | 'espera' | 'falha' | 'acao' | 'neutro';

/**
 * Estado em mono, como num quadro de horários — não em pílula colorida.
 * Falha é a exceção: bloco pink chapado, para não se confundir com nada.
 */
const TONS: Record<TomPilula, string> = {
  ok: 'text-ok',
  espera: 'text-espera',
  falha: 'bg-pink px-2 py-0.5 text-white font-semibold',
  acao: 'text-pink-tinta',
  neutro: 'text-tinta-3',
};

export function Pilula({ tom = 'neutro', children }: { tom?: TomPilula; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center font-mono text-[10.5px] tracking-[0.13em] whitespace-nowrap uppercase ${TONS[tom]}`}
    >
      {children}
    </span>
  );
}
