// =============================================================================
// As derivadas são feitas AQUI, no navegador, antes de subir.
//
// O arquivo já está na mão de quem envia. Mandar 8 MB de foto para o servidor
// devolver um quadrado de 40 KB gasta banda duas vezes e obriga a manter
// processamento de mídia no servidor — ffmpeg, fila, memória. Para vídeo seria
// pior ainda: 1,2 GB subindo só para alguém pegar o primeiro quadro.
//
// O navegador faz os dois de graça: canvas para a foto, e <video> + canvas
// para o primeiro quadro do vídeo.
// =============================================================================

export interface Derivadas {
  miniatura: Blob;
  /** Só vídeo: o quadro que aparece antes de dar play. */
  poster: Blob | null;
  largura: number | null;
  altura: number | null;
  duracao: number | null;
}

const LADO_MINIATURA = 640;

/**
 * `toBlob` NÃO avisa quando não sabe o formato pedido — ele devolve PNG.
 *
 * Isto custou caro e ficou invisível. O código pedia `('image/webp', 0.82)`; o
 * navegador que subiu a galeria "Confraria 23/09" não sabia codificar webp,
 * devolveu PNG, e o 0.82 foi ignorado (PNG é sem perda, não tem qualidade).
 * Medido nessa galeria: 185 "miniaturas" de **404 KB em PNG**, contra originais
 * de 514 KB. A miniatura tinha 85% do peso do original, e a grade do cliente
 * baixava 77 MB para desenhar 185 quadradinhos.
 *
 * Pior: a linha de upload mandava `contentType: 'image/webp'` fixo, então o
 * arquivo subia mentindo sobre o que era.
 *
 * Nada disso deu erro em lugar nenhum. É o padrão que este projeto já pagou
 * várias vezes: pedir e não conferir o que voltou.
 *
 * Agora confere. Tenta webp; se o que voltar não for webp, tenta JPEG, que todo
 * navegador codifica desde sempre. PNG de fotografia é recusado de propósito —
 * é o pior dos dois mundos, pesado e sem ganho que alguém veja numa miniatura.
 */
async function paraBlob(tela: HTMLCanvasElement): Promise<Blob> {
  const tentar = (tipo: string, qualidade: number): Promise<Blob | null> =>
    new Promise((resolve) => tela.toBlob((b) => resolve(b), tipo, qualidade));

  for (const [tipo, qualidade] of [
    ['image/webp', 0.82],
    ['image/jpeg', 0.82],
  ] as const) {
    const b = await tentar(tipo, qualidade);
    // `b.type` é o que o navegador REALMENTE produziu, não o que foi pedido.
    if (b && b.type === tipo) return b;
  }

  throw new Error('Nao consegui gerar a miniatura neste navegador.');
}

// ---------------------------------------------------------------------------
// PNG vira JPG aqui, no navegador, antes de subir
//
// A dona: "na hora de enviar a arte ele precisa aceitar png tbm". Ela exporta
// a arte em PNG e o seletor de arquivos nem deixava escolher.
//
// Conferido na documentacao da Meta em 16/11, e nao de memoria, porque a regra
// antiga podia ter envelhecido: "JPEG is the only image format supported.
// Extended JPEG formats such as MPO and JPS are not supported." Imagem: 8 MB,
// 320 a 1440 px de largura, sRGB.
//
// Entao aceitar PNG e mandar como PNG so empurraria a falha para a hora de
// publicar — de madrugada, na conta do cliente, que e o pior lugar possivel.
// O que ela quer e enviar PNG; o que a Meta precisa e JPEG. Converter aqui
// resolve os dois.
//
// O MOTIVO DE ISTO NAO TER SIDO FEITO ANTES estava escrito na propria recusa:
// "nao converto sozinho porque fundo transparente viraria preto sem voce ver".
// A objecao e real e continua valendo — o que ela nao justifica e recusar. Um
// JPEG nao tem canal alfa, entao o transparente VAI virar alguma cor. Aqui ele
// vira branco (nao preto, que era o medo), e quem enviou fica sabendo, com a
// frase na tela. Converter calado seria trocar um problema visivel por um
// invisivel.
// ---------------------------------------------------------------------------

/** O que a Meta documenta para imagem publicada: 1440 px de largura, 8 MB. */
const LARGURA_META = 1440;
const BYTES_META = 8 * 1024 * 1024;

export interface Convertida {
  arquivo: File;
  /** O original tinha pixel transparente, e o fundo virou branco. */
  achatou: boolean;
  /** Falso quando o arquivo ja era JPEG e nada foi feito. */
  converteu: boolean;
}

/**
 * O original tem pixel transparente?
 *
 * Só serve para decidir se avisa. Mede numa cópia pequena porque ler os pixels
 * de uma arte de 4000px custa caro e não muda a resposta: reduzir nunca
 * transforma opaco em transparente — a média de 255 com 255 é 255 — então
 * alfa < 255 aqui significa alfa < 255 lá.
 */
function temTransparencia(bitmap: ImageBitmap): boolean {
  const escala = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
  const l = Math.max(1, Math.round(bitmap.width * escala));
  const a = Math.max(1, Math.round(bitmap.height * escala));
  const tela = document.createElement('canvas');
  tela.width = l;
  tela.height = a;
  const ctx = tela.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0, l, a);
  try {
    const dados = ctx.getImageData(0, 0, l, a).data;
    for (let i = 3; i < dados.length; i += 4) {
      if (dados[i] < 255) return true;
    }
    return false;
  } catch {
    // Canvas sujo por imagem de outra origem. Aqui o arquivo é local, então
    // isto não deveria acontecer — e se acontecer, não avisar é melhor do que
    // derrubar o envio por causa do aviso.
    return false;
  }
}

/**
 * JPEG de verdade, e abaixo dos 8 MB.
 *
 * A mesma desconfiança do `paraBlob`: confere `b.type`, porque `toBlob` não
 * avisa quando não sabe o formato pedido — devolve PNG calado. Um "JPEG" que
 * na verdade é PNG passaria por tudo aqui e seria recusado pela Meta.
 */
async function jpegDaTela(tela: HTMLCanvasElement, nome: string): Promise<Blob> {
  let ultima: Blob | null = null;

  for (const qualidade of [0.92, 0.85, 0.75, 0.6]) {
    const b = await new Promise<Blob | null>((r) => tela.toBlob(r, 'image/jpeg', qualidade));
    if (!b || b.type !== 'image/jpeg') {
      throw new Error(
        `Este navegador nao sabe gerar JPG. Exporte ${nome} como JPG e anexe de novo.`,
      );
    }
    ultima = b;
    if (b.size <= BYTES_META) return b;
  }

  const mb = (ultima?.size ?? 0) / 1024 / 1024;
  throw new Error(
    `${nome} ficou com ${mb.toFixed(1)} MB depois de comprimir, e a Meta aceita 8 MB. ` +
    'Reduza as dimensoes da arte e anexe de novo.',
  );
}

/**
 * O arquivo que vai para a Meta, em JPEG.
 *
 * JPEG entra e sai igual — reencodar o que já está certo só perderia qualidade
 * a cada envio.
 */
export async function paraJpegDaMeta(arquivo: File): Promise<Convertida> {
  if (arquivo.type === 'image/jpeg' || arquivo.type === 'image/jpg') {
    return { arquivo, achatou: false, converteu: false };
  }

  let bitmap: ImageBitmap;
  try {
    // `from-image` explícito: sem isso, um arquivo com orientação em EXIF pode
    // ser desenhado deitado, e a arte chegaria girada na conta do cliente.
    bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      `Nao consegui abrir ${arquivo.name} para converter em JPG. ` +
      'Exporte como JPG no programa onde a arte foi feita e anexe de novo.',
    );
  }

  try {
    const achatou = temTransparencia(bitmap);

    // 1440 é o máximo que a Meta documenta. Acima disso ela redimensiona com
    // critério dela; abaixo, nada é tocado — a arte de 1080 continua 1080.
    const escala = Math.min(1, LARGURA_META / bitmap.width);
    const l = Math.max(1, Math.round(bitmap.width * escala));
    const a = Math.max(1, Math.round(bitmap.height * escala));

    const tela = document.createElement('canvas');
    tela.width = l;
    tela.height = a;
    const ctx = tela.getContext('2d');
    if (!ctx) throw new Error('Este navegador nao deixou converter a imagem.');

    // BRANCO PRIMEIRO. A tela nasce transparente; sem esta demão, o que era
    // transparente vira PRETO no JPEG — exatamente o estrago que a recusa
    // antiga temia.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, l, a);
    ctx.drawImage(bitmap, 0, 0, l, a);

    const blob = await jpegDaTela(tela, arquivo.name);
    return {
      arquivo: new File([blob], arquivo.name.replace(/\.[^.]+$/, '') + '.jpg', {
        type: 'image/jpeg',
        lastModified: arquivo.lastModified,
      }),
      achatou,
      converteu: true,
    };
  } finally {
    bitmap.close();
  }
}

function encolher(largura: number, altura: number): [number, number] {
  const escala = Math.min(1, LADO_MINIATURA / Math.max(largura, altura));
  return [Math.max(1, Math.round(largura * escala)), Math.max(1, Math.round(altura * escala))];
}

async function deFoto(arquivo: File): Promise<Derivadas> {
  // createImageBitmap decodifica fora da thread principal: com 300 fotos na
  // fila, decodificar no <img> trava a aba inteira.
  const bitmap = await createImageBitmap(arquivo);
  const [l, a] = encolher(bitmap.width, bitmap.height);
  const tela = document.createElement('canvas');
  tela.width = l;
  tela.height = a;
  tela.getContext('2d')?.drawImage(bitmap, 0, 0, l, a);
  const miniatura = await paraBlob(tela);
  const saida: Derivadas = {
    miniatura,
    poster: null,
    largura: bitmap.width,
    altura: bitmap.height,
    duracao: null,
  };
  bitmap.close();
  return saida;
}

function deVideo(arquivo: File): Promise<Derivadas> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;

    const desistir = (motivo: string) => {
      URL.revokeObjectURL(url);
      reject(new Error(motivo));
    };

    v.onerror = () => desistir('Não consegui ler este vídeo.');

    v.onloadedmetadata = () => {
      // Um segundo adentro: o primeiro quadro costuma ser preto.
      v.currentTime = Math.min(1, (v.duration || 1) / 2);
    };

    v.onseeked = () => {
      try {
        const [l, a] = encolher(v.videoWidth, v.videoHeight);
        const tela = document.createElement('canvas');
        tela.width = l;
        tela.height = a;
        tela.getContext('2d')?.drawImage(v, 0, 0, l, a);
        void paraBlob(tela).then((quadro) => {
          URL.revokeObjectURL(url);
          resolve({
            miniatura: quadro,
            // O poster é o mesmo quadro: não vale subir dois arquivos iguais.
            poster: quadro,
            largura: v.videoWidth,
            altura: v.videoHeight,
            duracao: Number.isFinite(v.duration) ? Number(v.duration.toFixed(2)) : null,
          });
        });
      } catch {
        desistir('Não consegui gerar a capa deste vídeo.');
      }
    };

    v.src = url;
  });
}

export function ehVideo(arquivo: File): boolean {
  return arquivo.type.startsWith('video/');
}

/**
 * Nunca derruba o envio: se a derivada falhar (formato raro, HEIC sem
 * suporte), o arquivo sobe assim mesmo e a grade mostra o nome. Melhor uma
 * galeria sem miniatura do que uma foto que o cliente nunca recebe.
 */
export async function derivadasDe(arquivo: File): Promise<Derivadas | null> {
  try {
    return ehVideo(arquivo) ? await deVideo(arquivo) : await deFoto(arquivo);
  } catch {
    return null;
  }
}
