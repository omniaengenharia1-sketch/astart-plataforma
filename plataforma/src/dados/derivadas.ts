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

function paraBlob(tela: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    tela.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Não consegui gerar a miniatura.'))),
      'image/webp',
      0.82,
    );
  });
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
