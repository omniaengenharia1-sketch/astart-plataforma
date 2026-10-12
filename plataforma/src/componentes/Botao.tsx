import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variante = 'primario' | 'secundario' | 'texto' | 'inverso';
type Tamanho = 'normal' | 'pequeno';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
  children: ReactNode;
}

const BASE =
  'relative inline-flex items-center justify-center gap-2 rounded-full font-mono font-semibold ' +
  'uppercase tracking-[0.14em] select-none transition-[transform,box-shadow,background-color] ' +
  'duration-200 ease-out disabled:opacity-40 disabled:pointer-events-none ' +
  'active:translate-y-px';

const VARIANTES: Record<Variante, string> = {
  // Pink chapado com brilho por baixo. Texto escuro sobre o pink: 6,4:1.
  primario:
    'bg-[linear-gradient(180deg,var(--pink-topo),var(--pink-base))] text-sobre-pink ' +
    'shadow-[inset_0_1px_0_rgb(255_255_255/0.45),0_14px_34px_-14px_rgb(255_61_154/0.85)] ' +
    'hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_18px_42px_-14px_rgb(255_61_154/0.95)] ' +
    'hover:-translate-y-px',
  // Lâmina de vidro.
  secundario:
    'bg-superficie-2 text-tinta border border-linha backdrop-blur-xl ' +
    'shadow-[inset_0_1px_0_rgb(255_255_255/0.22)] hover:bg-superficie-3 hover:-translate-y-px',
  texto: 'bg-transparent text-tinta-2 hover:text-pink-texto risca rounded-none',
  // Para usar SOBRE o pink: inverte. Pink sobre pink não é botão, é mancha.
  inverso:
    'bg-sobre-pink text-pink shadow-[0_10px_26px_-12px_rgb(0_0_0/0.6)] hover:-translate-y-px',
};

const TAMANHOS: Record<Tamanho, string> = {
  normal: 'min-h-11 text-[10.5px]',
  pequeno: 'min-h-9 text-[10px]',
};

const LADOS: Record<Variante, Record<Tamanho, string>> = {
  primario: { normal: 'px-5', pequeno: 'px-4' },
  secundario: { normal: 'px-5', pequeno: 'px-4' },
  inverso: { normal: 'px-5', pequeno: 'px-4' },
  texto: { normal: 'px-1', pequeno: 'px-1' },
};

export function Botao({
  variante = 'secundario',
  tamanho = 'normal',
  className = '',
  children,
  ...resto
}: Props) {
  return (
    <button
      className={`${BASE} ${VARIANTES[variante]} ${TAMANHOS[tamanho]} ${LADOS[variante][tamanho]} ${className}`}
      {...resto}
    >
      {children}
    </button>
  );
}
