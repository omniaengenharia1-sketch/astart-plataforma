import type { ReactNode } from 'react';

export function Cartao({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border border-linha bg-superficie p-4 ${className}`}>{children}</div>
  );
}

type TomAviso = 'ok' | 'espera' | 'falha';

const TONS: Record<TomAviso, string> = {
  ok: 'bg-ok-suave text-ok',
  espera: 'bg-espera-suave text-espera',
  falha: 'bg-falha-suave text-falha',
};

export function Aviso({ tom = 'espera', children }: { tom?: TomAviso; children: ReactNode }) {
  return (
    <p className={`border-l-2 border-current/40 px-3 py-2 text-[12px] leading-relaxed ${TONS[tom]}`}>{children}</p>
  );
}

export function Definicoes({ pares }: { pares: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3.5 gap-y-1.5 text-[12.5px]">
      {pares.map(([rot, val]) => (
        <div key={rot} className="contents">
          <dt className="text-[11px] text-tinta-3">{rot}</dt>
          <dd className="m-0 font-medium text-tinta">{val}</dd>
        </div>
      ))}
    </dl>
  );
}
