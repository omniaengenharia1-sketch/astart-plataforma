import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variante = 'primario' | 'secundario' | 'texto';
type Tamanho = 'normal' | 'pequeno';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
  children: ReactNode;
}

// A sombra dura encolhe quando o botao e pressionado: o bloco afunda no lugar.
const BASE =
  'inline-flex items-center justify-center gap-2 border-2 border-linha font-mono font-semibold ' +
  'uppercase tracking-[0.16em] transition-[transform,box-shadow] duration-75 ' +
  'disabled:opacity-35 disabled:pointer-events-none select-none';

const COM_SOMBRA =
  'shadow-[3px_3px_0_var(--sombra)] hover:translate-x-[1px] hover:translate-y-[1px] ' +
  'hover:shadow-[2px_2px_0_var(--sombra)] active:translate-x-[3px] active:translate-y-[3px] ' +
  'active:shadow-none';

const VARIANTES: Record<Variante, string> = {
  // Preto sobre o pink: 4,87:1. Branco sobre o pink seria 4,31:1 e reprovaria.
  primario: `bg-pink text-sobre-pink ${COM_SOMBRA}`,
  secundario: `bg-superficie text-tinta ${COM_SOMBRA}`,
  texto: 'border-0 border-b-2 bg-transparent px-0 text-tinta hover:text-pink',
};

const TAMANHOS: Record<Tamanho, string> = {
  normal: 'min-h-11 px-4 text-[10px]',
  pequeno: 'min-h-9 px-3 text-[9.5px]',
};

export function Botao({
  variante = 'secundario',
  tamanho = 'normal',
  className = '',
  children,
  ...resto
}: Props) {
  return (
    <button className={`${BASE} ${VARIANTES[variante]} ${TAMANHOS[tamanho]} ${className}`} {...resto}>
      {children}
    </button>
  );
}
