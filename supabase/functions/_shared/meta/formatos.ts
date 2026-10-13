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
 * Facebook. Nenhum formato: a Page nao tem adaptador nenhum ainda.
 *
 * Escrito como quatro recusas em vez de uma lista vazia de proposito — a tela
 * mostra os chips desligados com o motivo, e "nao aparece" e pior que "aparece
 * apagado dizendo por que": a pessoa fica procurando o que nao existe.
 */
const SEM_ADAPTADOR = 'O Facebook ainda nao publica por aqui — so o Instagram. Falta o adaptador da Page.';

export const FORMATOS_FACEBOOK: Record<string, RegraDeFormato> = {
  imagem: { minimo: 1, maximo: 1, natureza: 'imagem', publicavel: false, motivo: SEM_ADAPTADOR },
  carrossel: { minimo: 2, maximo: 10, natureza: 'imagem', publicavel: false, motivo: SEM_ADAPTADOR },
  reel: { minimo: 1, maximo: 1, natureza: 'video', publicavel: false, motivo: SEM_ADAPTADOR },
  story: { minimo: 1, maximo: 1, natureza: 'imagem_ou_video', publicavel: false, motivo: SEM_ADAPTADOR },
};

export const FORMATOS_POR_PLATAFORMA: Record<string, Record<string, RegraDeFormato>> = {
  instagram: FORMATOS_INSTAGRAM,
  facebook: FORMATOS_FACEBOOK,
};
