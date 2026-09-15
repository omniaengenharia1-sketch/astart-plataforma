interface Props<T extends string> {
  valor: T;
  opcoes: { valor: T; texto: string }[];
  aoTrocar: (v: T) => void;
  rotuloGrupo: string;
}

export function Segmentado<T extends string>({ valor, opcoes, aoTrocar, rotuloGrupo }: Props<T>) {
  return (
    <div role="group" aria-label={rotuloGrupo} className="flex overflow-hidden border border-tinta">
      {opcoes.map((o, i) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => aoTrocar(o.valor)}
          className={
            'px-3 py-1 text-[9.5px] font-semibold tracking-[0.13em] uppercase transition-colors ' +
            (i > 0 ? 'border-l border-tinta ' : '') +
            (valor === o.valor ? 'bg-tinta text-papel' : 'bg-transparent text-tinta-2 hover:bg-superficie-2')
          }
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}
