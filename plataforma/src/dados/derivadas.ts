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
