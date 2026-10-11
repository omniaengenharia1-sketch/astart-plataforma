import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { valor as formatarValor } from '../formato';

const CAIXA =
  'min-h-11 w-full border-2 border-linha bg-superficie px-3 text-[14px] ' +
  'placeholder:text-tinta-3 focus:outline-none';

/** Rótulo em cima, dica embaixo. A dica explica a regra antes do erro aparecer. */
export function Campo({
  id,
  rotulo,
  dica,
  children,
  className = '',
}: {
  id?: string;
  rotulo: string;
  dica?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="rotulo-forte">
        {rotulo}
      </label>
      <div className="mt-1.5">{children}</div>
      {dica && <p className="rotulo mt-1.5 normal-case">{dica}</p>}
    </div>
  );
}

export function Entrada(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...resto } = props;
  return <input {...resto} className={`${CAIXA} ${className}`} />;
}

export function Escolha(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...resto } = props;
  return <select {...resto} className={`${CAIXA} font-mono text-[12.5px] ${className}`} />;
}

/**
 * Dinheiro em centavos, sempre. O campo aceita só dígito e monta o valor da
 * direita para a esquerda — digitar "280000" dá 2.800,00. Nunca existe um
 * número com vírgula flutuando por aqui: centavo perdido vira ligação de cliente.
 *
 * Zero aparece como campo vazio, não como "0,00". Com "0,00" dentro, quem
 * clicasse e digitasse sem apagar somava os zeros do formato ao próprio número
 * e cadastrava 2.400.000,00 achando que tinha digitado 2.400,00.
 */
export function CampoDinheiro({
  id,
  centavos,
  aoMudar,
}: {
  id?: string;
  centavos: number;
  aoMudar: (centavos: number) => void;
}) {
  return (
    <div className="flex items-stretch">
      <span className="rotulo-forte flex min-h-11 items-center border-2 border-r-0 border-linha bg-superficie-2 px-3">
        R$
      </span>
      <input
        id={id}
        inputMode="numeric"
        placeholder="0,00"
        value={centavos === 0 ? '' : formatarValor(centavos)}
        onChange={(e) => {
          const so = e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);
          aoMudar(so === '' ? 0 : Number(so));
        }}
        className={`${CAIXA} numeros text-right`}
      />
    </div>
  );
}

/** Escolha entre poucas opções, como botão. Mais rápido que um select de dois. */
export function Segmento<T extends string>({
  opcoes,
  valor,
  aoEscolher,
  rotuloGrupo,
}: {
  opcoes: { valor: T; rotulo: string }[];
  valor: T | null;
  aoEscolher: (v: T) => void;
  rotuloGrupo: string;
}) {
  return (
    <div role="group" aria-label={rotuloGrupo} className="flex flex-wrap gap-2">
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={ativo}
            onClick={() => aoEscolher(o.valor)}
            className={
              'min-h-11 border-2 border-linha px-3 font-mono text-[10px] font-semibold ' +
              'tracking-[0.16em] uppercase ' +
              (ativo ? 'bg-pink text-sobre-pink shadow-[3px_3px_0_var(--sombra)]' : 'bg-superficie text-tinta-2')
            }
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}
