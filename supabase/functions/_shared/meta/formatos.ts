/**
 * O que o adaptador do Instagram REALMENTE publica hoje.
 *
 * Este arquivo existe porque a tela e o banco precisam saber a mesma coisa que
 * o adaptador sabe, e ate agora nao sabiam. O compositor oferecia quatro
 * formatos; o adaptador publicava um. Os outros tres agendavam bonito e
 * falhavam na hora de publicar, de madrugada, com o cliente sem receber nada —
 * exatamente o erro que a 0047 foi escrita para evitar, um nivel acima.
 *
 * A regra desta pasta: quem decide o que da para publicar e o ADAPTADOR, nao a
 * documentacao da Meta. A Meta aceita coisas que a gente ainda nao implementou,
 * e prometer na tela o que o codigo nao faz e pior que nao oferecer.
 *
 * `scripts/provar-canais.mjs` compara esta lista com a do banco (migration
 * 0048) e falha quando as duas discordam. Sem isso, a divergencia volta no
 * primeiro formato que alguem implementar e esquecer de liberar — ou pior, no
 * primeiro que alguem liberar sem implementar.
 */

export type NaturezaMidia = 'imagem' | 'video' | 'imagem_ou_video';

export interface RegraDeFormato {
  /** Quantos arquivos o formato pede, no minimo e no maximo. */
  minimo: number;
  maximo: number;
  natureza: NaturezaMidia;
  /** Falso = o adaptador ainda nao faz. A tela mostra desligado, com o motivo. */
  publicavel: boolean;
  /** Por que nao da, em portugues, para aparecer na tela do lado do chip. */
  motivo?: string;
}

/**
 * A Meta publica imagem so em JPEG — nem PNG, nem WebP, nem as variantes MPO e
 * JPS. Esta constante e a mesma regra da 0047, do lado de ca.
 */
export const MIMES_IMAGEM = new Set(['image/jpeg', 'image/jpg']);

export function ehVideo(mime: string): boolean {
  return mime.toLowerCase().startsWith('video/');
}

export function ehImagem(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/');
}

/**
 * Instagram. As quatro linhas descrevem o que `instagram.ts` faz de verdade.
 *
 * Carrossel aceita so imagem, e isso e uma limitacao NOSSA, nao da Meta: filho
 * de video precisa terminar de processar antes de o container pai ser criado, e
 * esperar por isso exigiria um estado novo na maquina do worker — a regra do
 * projeto proibe dormir dentro de uma invocacao. Entra quando o estado existir.
 */
export const FORMATOS_INSTAGRAM: Record<string, RegraDeFormato> = {
  imagem: { minimo: 1, maximo: 1, natureza: 'imagem', publicavel: true },
  carrossel: {
    minimo: 2,
    maximo: 10,
    natureza: 'imagem',
    publicavel: true,
  },
  reel: { minimo: 1, maximo: 1, natureza: 'video', publicavel: true },
  story: { minimo: 1, maximo: 1, natureza: 'imagem_ou_video', publicavel: true },
};

/**
 * Facebook. Foto e album de fotos publicam; video nao.
 *
 * O corte nao e preguica, e protocolo: foto entra por `POST /{page}/photos`
 * com a URL do arquivo, que e o mesmo feitio do Instagram e usa o mesmo
 * `chamarGraph`. Reel e story da Pagina sobem por `rupload.facebook.com`, em
 * upload retomavel de tres fases — outro host, outro protocolo, e um estado
 * novo na maquina do worker. Entra quando esse estado existir.
 *
 * As quatro linhas continuam aqui, duas ligadas e duas desligadas com motivo,
 * porque "nao aparece" e pior que "aparece apagado dizendo por que": a pessoa
 * fica procurando o que nao existe.
 */
const SO_FOTO = 'O Facebook ainda publica so foto por aqui — video da Pagina usa outro protocolo de envio. Ja esta na fila.';

export const FORMATOS_FACEBOOK: Record<string, RegraDeFormato> = {
  imagem: { minimo: 1, maximo: 1, natureza: 'imagem', publicavel: true },
  // Ate 10, o mesmo teto do carrossel do Instagram. A referencia da Pagina nao
  // publica um limite de `attached_media`; na duvida, o numero que a equipe ja
  // conhece, e nao um palpite mais alto.
  carrossel: { minimo: 2, maximo: 10, natureza: 'imagem', publicavel: true },
  reel: { minimo: 1, maximo: 1, natureza: 'video', publicavel: false, motivo: SO_FOTO },
  story: { minimo: 1, maximo: 1, natureza: 'imagem_ou_video', publicavel: false, motivo: SO_FOTO },
};

export const FORMATOS_POR_PLATAFORMA: Record<string, Record<string, RegraDeFormato>> = {
  instagram: FORMATOS_INSTAGRAM,
  facebook: FORMATOS_FACEBOOK,
};
