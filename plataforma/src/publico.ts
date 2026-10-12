/**
 * Endereço de um arquivo da pasta `public/`.
 *
 * Existe porque escrever 'marca/logo.png' na mão quebra em rota funda: numa
 * página servida em /g/<token>, o caminho relativo vira /g/marca/logo.png.
 * `BASE_URL` é '/' no build de produção (resolve em qualquer profundidade) e
 * './' na prévia estática, que é servida da raiz e roteia por #.
 */
export function publico(caminho: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.endsWith('/') ? base : `${base}/`}${caminho.replace(/^\//, '')}`;
}
