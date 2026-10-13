/**
 * A regra de formato, do lado da tela. UMA cópia, não quatro.
 *
 * Esta é a quarta cópia da mesma regra neste projeto, e as outras três já
 * existiam:
 *
 *   `supabase/functions/_shared/meta/formatos.ts` — o adaptador, que decide o
 *   que vai para a Meta. É a fonte da verdade: a Meta aceita coisa que a gente
 *   não implementou.
 *
 *   `public.limites_de_midia` + `public.formatos_suportados` — o banco, que
 *   recusa na hora de anexar e na hora de criar.
 *
 *   e AQUI, a tela. Até hoje a tela tinha DUAS cópias escondidas, as duas
 *   erradas depois da 0056:
 *
 *     `PEDE.carrossel = 'de 2 a 10 fotos JPG ou vídeos'` — prometia vídeo em
 *     carrossel, que o banco recusa.
 *
 *     `LIMITES.carrossel = { aceita: 'os_dois' }` no modo exemplo — pior: o
 *     modo exemplo ACEITAVA o vídeo. É o modo em que os roteiros de navegador
 *     rodam, então nenhum roteiro podia pegar a mentira. Ambiente de teste mais
 *     generoso que a realidade testa só o caminho fácil — a mesma armadilha,
 *     pela quinta vez nesta semana.
 *
 * Então as duas foram apagadas e derivam daqui, e `scripts/provar-canais.mjs`
 * passou a comparar TRÊS listas em vez de duas: adaptador, tela e banco.
 * Divergir é erro de build.
 *
 * Mexer aqui sem mexer no adaptador e numa migration nova faz o prover falhar,
 * e é de propósito.
 */
import type { TipoPeca } from './tipos';

export type PlataformaSocial = 'instagram' | 'facebook';

/** O que cada arquivo pode ser. Espelha `limites_de_midia.natureza`. */
export type Natureza = 'imagem' | 'video' | 'imagem_ou_video';

export interface RegraDeFormato {
  /** O nome que a pessoa usa, não o do banco. */
  rotulo: string;
  /** Uma linha embaixo do chip, para quem nunca usou. */
  explica: string;
  minimo: number;
  maximo: number;
  natureza: Natureza;
}

/**
 * Os quatro formatos. `minimo`, `maximo` e `natureza` espelham
 * `public.limites_de_midia`; `rotulo` e `explica` são só da tela e o prover
 * ignora.
 */
export const FORMATOS: Record<TipoPeca, RegraDeFormato> = {
  imagem: {
    rotulo: 'Post',
    explica: 'uma foto no feed',
    minimo: 1,
    maximo: 1,
    natureza: 'imagem',
  },
  carrossel: {
    rotulo: 'Carrossel',
    explica: 'várias fotos no feed',
    minimo: 2,
    maximo: 10,
    // Só imagem, e não é limitação da Meta: o adaptador ainda não sabe fazer
    // filho de vídeo (0056). Enquanto não souber, a tela não promete.
    natureza: 'imagem',
  },
  reel: {
    rotulo: 'Reel',
    explica: 'um vídeo',
    minimo: 1,
    maximo: 1,
    natureza: 'video',
  },
  story: {
    rotulo: 'Story',
    explica: 'foto ou vídeo, 24h',
    minimo: 1,
    maximo: 1,
    natureza: 'imagem_ou_video',
  },
};

/** A ordem em que a agência pensa, e a mesma da `canais_do_cliente`. */
export const ORDEM_FORMATOS: TipoPeca[] = ['imagem', 'carrossel', 'reel', 'story'];

/**
 * Quais (rede × formato) saem de verdade. Espelha `public.formatos_suportados`,
 * linha por linha — inclusive o motivo, porque chip apagado sem motivo é a pior
 * tela possível: a pessoa não sabe se é defeito ou se falta recurso.
 */
const FALTA_FACEBOOK =
  'O Facebook ainda não publica por aqui — falta o adaptador da Página. Já está na fila.';

export const CANAIS: {
  plataforma: PlataformaSocial;
  tipo: TipoPeca;
  publicavel: boolean;
  motivo: string | null;
}[] = [
  { plataforma: 'instagram', tipo: 'imagem', publicavel: true, motivo: null },
  { plataforma: 'instagram', tipo: 'carrossel', publicavel: true, motivo: null },
  { plataforma: 'instagram', tipo: 'reel', publicavel: true, motivo: null },
  { plataforma: 'instagram', tipo: 'story', publicavel: true, motivo: null },
  { plataforma: 'facebook', tipo: 'imagem', publicavel: false, motivo: FALTA_FACEBOOK },
  { plataforma: 'facebook', tipo: 'carrossel', publicavel: false, motivo: FALTA_FACEBOOK },
  { plataforma: 'facebook', tipo: 'reel', publicavel: false, motivo: FALTA_FACEBOOK },
  { plataforma: 'facebook', tipo: 'story', publicavel: false, motivo: FALTA_FACEBOOK },
];

/** Como se escreve o que o formato pede. Uma frase, não um número solto. */
const SUBSTANTIVO: Record<Natureza, { um: string; varios: string }> = {
  imagem: { um: 'foto JPG', varios: 'fotos JPG' },
  video: { um: 'vídeo', varios: 'vídeos' },
  imagem_ou_video: { um: 'foto JPG ou vídeo', varios: 'fotos JPG ou vídeos' },
};

/**
 * "1 foto JPG", "de 2 a 10 fotos JPG", "1 vídeo".
 *
 * Derivada, não escrita: era uma frase à mão que envelheceu sozinha quando a
 * 0056 estreitou o carrossel.
 */
export function pede(r: Pick<RegraDeFormato, 'minimo' | 'maximo' | 'natureza'>): string {
  const n = SUBSTANTIVO[r.natureza];
  if (r.minimo === r.maximo) return `${r.minimo} ${r.minimo === 1 ? n.um : n.varios}`;
  return `de ${r.minimo} a ${r.maximo} ${n.varios}`;
}

/** Quantos arquivos cada tipo pede, em palavras. O banco cobra; a tela avisa. */
export const PEDE: Record<TipoPeca, string> = {
  imagem: pede(FORMATOS.imagem),
  carrossel: pede(FORMATOS.carrossel),
  reel: pede(FORMATOS.reel),
  story: pede(FORMATOS.story),
};

/**
 * Este arquivo serve para este formato?
 *
 * As mensagens são as mesmas da `registrar_midia_post` (0045, 0047, 0056) de
 * propósito: o modo exemplo tem de recusar com a frase que o banco recusaria,
 * senão o roteiro de navegador aprova um caminho que a produção reprova.
 */
export function recusaDoArquivo(tipo: TipoPeca, mime: string): string | null {
  const r = FORMATOS[tipo];
  const ehImagem = mime.startsWith('image/');
  const ehVideo = mime.startsWith('video/');

  // O carrossel primeiro, porque a recusa genérica não explicaria por que o
  // Instagram aceita e a plataforma não.
  if (tipo === 'carrossel' && ehVideo) {
    return (
      'Carrossel com video ainda nao sai por aqui — e limitacao nossa, nao da Meta. ' +
      'Cada video de um carrossel precisa terminar de processar antes de o carrossel ser ' +
      'montado, e o agendador ainda nao sabe esperar por isso. Ja esta na fila. ' +
      'Por enquanto: carrossel de fotos JPG, ou um Reel para o video.'
    );
  }
  if (r.natureza === 'imagem' && !ehImagem) return `Peca de imagem aceita foto, nao ${mime}.`;
  if (r.natureza === 'video' && !ehVideo) return `Reel aceita video, nao ${mime}.`;
  if (r.natureza === 'imagem_ou_video' && !(ehImagem || ehVideo)) {
    return `Esta peca aceita foto ou video, nao ${mime}.`;
  }
  // A Meta publica imagem só em JPEG (0047).
  if (ehImagem && mime !== 'image/jpeg' && mime !== 'image/jpg') {
    return (
      `A Meta publica imagem so em JPEG, e este arquivo e ${mime}. ` +
      'Exporte como JPG e anexe de novo — nao converto sozinho porque fundo ' +
      'transparente viraria preto sem voce ver.'
    );
  }
  return null;
}
