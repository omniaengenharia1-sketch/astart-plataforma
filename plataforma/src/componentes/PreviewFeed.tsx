/** Preview fiel do feed do Instagram. O recorte segue a proporção do arquivo. */
export function PreviewFeed({
  conta,
  cliente,
  legenda,
  arquivo,
  proporcao,
  quando,
  primeiroComentario,
  src,
}: {
  conta: string;
  cliente: string;
  legenda: string;
  arquivo: string;
  proporcao: string;
  quando: string;
  primeiroComentario: string;
  /** URL local do arquivo escolhido. Sem ela, mostra um bloco de cor. */
  src?: string;
}) {
  const partes = legenda.split(/(#[\wÀ-ÿ]+)/g);

  return (
    <div className="sticky top-4 overflow-hidden rounded-xl border border-linha-forte bg-superficie shadow-lg">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="size-8 rounded-full bg-[conic-gradient(from_210deg,#F0A030,#D6357F,#7B3FE4,#F0A030)] p-0.5">
          <i className="block size-full rounded-full bg-superficie" />
        </span>
        <span>
          <span className="block text-[12.5px] leading-tight font-semibold">{conta}</span>
          <span className="block text-[10.5px] text-tinta-3">{cliente}</span>
        </span>
      </div>

      <div
        className="relative flex items-end overflow-hidden bg-[linear-gradient(145deg,#243B6B_0%,#3E6FA8_45%,#C7935B_100%)] p-2.5"
        style={{ aspectRatio: proporcao }}
      >
        {src && (
          <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
        )}
        <span className="relative rounded-[3px] bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white backdrop-blur-[2px]">
          {arquivo}
        </span>
      </div>

      <div className="flex gap-3.5 px-3 pt-2.5 pb-1 text-tinta">
        <IconeCoracao />
        <IconeComentario />
        <IconeEnviar />
        <IconeSalvar />
      </div>

      <div className="px-3 pt-0.5 pb-3 text-[12.5px] leading-relaxed">
        <p className="m-0 break-words whitespace-pre-wrap">
          <b className="font-semibold">{conta.replace('@', '')} </b>
          {partes.map((t, i) =>
            t.startsWith('#') ? (
              <span key={i} className="text-pink-tinta">
                {t}
              </span>
            ) : (
              <span key={i}>{t}</span>
            ),
          )}
        </p>
        <p className="numeros mt-2 text-[10px] tracking-wide text-tinta-3 uppercase">Publica em {quando}</p>
        {primeiroComentario.trim() && (
          <p className="mt-2 flex gap-1.5 border-t border-linha pt-2 text-[11.5px] text-tinta-2">
            <b className="font-semibold">{conta}</b>
            {primeiroComentario}
          </p>
        )}
      </div>
    </div>
  );
}

const svg = 'size-5 stroke-current fill-none stroke-[1.7]';
const IconeCoracao = () => (
  <svg viewBox="0 0 24 24" className={svg} aria-hidden>
    <path d="M12 20.5S3.5 15 3.5 9.2A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 8.5 2.2c0 5.8-8.5 11.3-8.5 11.3z" />
  </svg>
);
const IconeComentario = () => (
  <svg viewBox="0 0 24 24" className={svg} aria-hidden>
    <path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 20.5l1.5-5.4A8.5 8.5 0 1 1 21 11.5z" />
  </svg>
);
const IconeEnviar = () => (
  <svg viewBox="0 0 24 24" className={svg} aria-hidden>
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
  </svg>
);
const IconeSalvar = () => (
  <svg viewBox="0 0 24 24" className={`${svg} ml-auto`} aria-hidden>
    <path d="M6 3h12v18l-6-4.5L6 21z" />
  </svg>
);
