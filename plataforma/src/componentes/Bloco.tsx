import type { ReactNode } from 'react';

/**
 * A lâmina padrão. `alerta` troca o vidro pelo pink chapado — é o único jeito
 * de uma caixa gritar, então uma por tela já é muito.
 */
export function Bloco({
  rotulo,
  destaque,
  alerta,
  sombra,
  className = '',
  children,
}: {
  rotulo?: string;
  destaque?: string;
  alerta?: boolean;
  sombra?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={
        'bloco p-4 sm:p-5 ' +
        (alerta
          ? 'lamina-pink bg-[linear-gradient(160deg,var(--pink-topo),var(--pink-base))] text-sobre-pink '
          : '') +
        (sombra || alerta ? 'brilho-p ' : '') +
        className
      }
    >
      {rotulo && (
        <div className={alerta ? 'rotulo-forte text-sobre-pink' : 'rotulo'}>{rotulo}</div>
      )}
      {destaque && (
        <div className="titulao mt-2 text-[clamp(1.5rem,4vw,2.1rem)]">{destaque}</div>
      )}
      {children}
    </section>
  );
}

/** Abertura de seção: um fio iridescente e o nome, em caixa alta. */
export function Fita({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-3">
      <h2 className="fita">{children}</h2>
      {acao}
    </div>
  );
}

/** Etiqueta de estado. Cápsula de vidro; `forte` acende em pink. */
export function Marca({ children, forte }: { children: ReactNode; forte?: boolean }) {
  return (
    <span
      className={
        'inline-block rounded-full border px-2.5 py-[3px] font-mono text-[10px] font-semibold ' +
        'tracking-[0.12em] uppercase whitespace-nowrap ' +
        (forte
          ? 'border-transparent bg-[linear-gradient(180deg,var(--pink-topo),var(--pink-base))] text-sobre-pink shadow-[0_6px_18px_-8px_rgb(255_61_154/0.9)]'
          : 'border-linha bg-superficie text-tinta-2')
      }
    >
      {children}
    </span>
  );
}
