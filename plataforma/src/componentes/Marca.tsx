/**
 * A logo da Astart. São dois arquivos, não um com filtro: a versão clara não é
 * a escura invertida — inverter comeria o quadradinho verde da marca.
 *
 * Qual aparece é decidido no CSS (`.marca-papel` / `.marca-tinta`), porque o
 * tema pode vir do sistema ou do atributo data-tema, e um `if` em JavaScript
 * não enxerga a preferência do sistema sem virar estado.
 */
export function Logo({ altura = 30, className = '' }: { altura?: number; className?: string }) {
  const estilo = { height: altura, width: 'auto' } as const;
  return (
    <span className={'inline-flex items-center ' + className}>
      <img
        src="marca/astart-papel.png"
        alt="Astart Studio"
        style={estilo}
        className="marca-papel"
      />
      <img
        src="marca/astart-tinta.png"
        alt="Astart Studio"
        style={estilo}
        className="marca-tinta"
      />
    </span>
  );
}
