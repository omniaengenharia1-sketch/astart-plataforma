import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variante = 'primario' | 'secundario' | 'texto';
type Tamanho = 'normal' | 'pequeno';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
  children: ReactNode;
}

// A sombra dura encolhe quando o botao e pressionado: o bloco afunda no lugar.
//
// Borda e preenchimento NAO entram aqui. Entravam, e a variante 'texto' tentava
// desfazer com border-0 e px-0: duas classes da mesma familia no mesmo elemento
// nao se resolvem pela ordem que a gente escreve, e a borda do BASE vencia em
// silencio — o botao terciario virava um secundario sem sombra.
const BASE =
  'inline-flex items-center justify-center gap-2 font-mono font-semibold ' +
  'uppercase tracking-[0.16em] transition-[transform,box-shadow] duration-75 ' +
  'disabled:opacity-35 disabled:pointer-events-none select-none';

const COM_SOMBRA =
  'shadow-[3px_3px_0_var(--sombra)] hover:translate-x-[1px] hover:translate-y-[1px] ' +
  'hover:shadow-[2px_2px_0_var(--sombra)] active:translate-x-[3px] active:translate-y-[3px] ' +
  'active:shadow-none';

const VARIANTES: Record<Variante, string> = {
  // Preto sobre o pink: 4,87:1. Branco sobre o pink seria 4,31:1 e reprovaria.
  primario: `border-2 border-linha bg-pink text-sobre-pink ${COM_SOMBRA}`,
  secundario: `border-2 border-linha bg-superficie text-tinta ${COM_SOMBRA}`,
  texto: 'border-b-2 border-linha bg-transparent text-tinta hover:border-pink hover:text-pink',
};

const TAMANHOS: Record<Tamanho, string> = {
  normal: 'min-h-11 text-[10px]',
  pequeno: 'min-h-9 text-[9.5px]',
};

// O terciario nao tem caixa, entao tambem nao tem respiro lateral.
const LADOS: Record<Variante, Record<Tamanho, string>> = {
  primario: { normal: 'px-4', pequeno: 'px-3' },
  secundario: { normal: 'px-4', pequeno: 'px-3' },
  texto: { normal: 'px-0', pequeno: 'px-0' },
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
