import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variante = 'primario' | 'secundario' | 'texto';
type Tamanho = 'normal' | 'pequeno';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
  children: ReactNode;
}

// Retangular e de canto vivo: o botão-pílula é a marca do template genérico.
const BASE =
  'inline-flex items-center justify-center gap-2 font-semibold uppercase tracking-[0.13em] ' +
  'transition-colors disabled:opacity-40 disabled:pointer-events-none';

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-pink text-white border border-pink hover:bg-tinta hover:border-tinta',
  secundario: 'bg-transparent text-tinta border border-tinta hover:bg-tinta hover:text-papel',
  texto: 'bg-transparent text-tinta-2 border-0 underline underline-offset-4 hover:text-pink-tinta',
};

const TAMANHOS: Record<Tamanho, string> = {
  normal: 'px-4 py-2 text-[10.5px]',
  pequeno: 'px-3 py-1.5 text-[9.5px]',
};

export function Botao({ variante = 'secundario', tamanho = 'normal', className = '', children, ...resto }: Props) {
  return (
    <button className={`${BASE} ${VARIANTES[variante]} ${TAMANHOS[tamanho]} ${className}`} {...resto}>
      {children}
    </button>
  );
}
