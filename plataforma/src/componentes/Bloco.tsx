import type { ReactNode } from 'react';

/**
 * A caixa padrao. `alerta` troca o fundo pelo pink chapado — e o unico jeito de
 * uma caixa gritar, entao so uma por tela deveria usar.
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
        (alerta ? 'bg-pink text-sobre-pink ' : 'bg-superficie ') +
        (sombra ? 'sombra-dura-p ' : '') +
        className
      }
    >
      {rotulo && (
        <div className={alerta ? 'rotulo-forte text-sobre-pink' : 'rotulo'}>{rotulo}</div>
      )}
      {destaque && <div className="titulao mt-2 text-[clamp(1.4rem,4vw,2rem)]">{destaque}</div>}
      {children}
    </section>
  );
}

/** Barra chapada que abre uma seção. Preta, com o texto do papel. */
export function Fita({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-0 flex items-center justify-between gap-3">
      <h2 className="fita">{children}</h2>
      {acao}
    </div>
  );
}

/** Etiqueta de estado. Sem paleta de semáforo: peso e caixa fazem o trabalho. */
export function Marca({ children, forte }: { children: ReactNode; forte?: boolean }) {
  return (
    <span
      className={
        'inline-block border-2 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold tracking-[0.16em] uppercase whitespace-nowrap ' +
        (forte ? 'border-linha bg-pink text-sobre-pink' : 'border-linha-fraca text-tinta-3')
      }
    >
      {children}
    </span>
  );
}
