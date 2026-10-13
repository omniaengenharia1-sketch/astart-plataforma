/**
 * A mídia da peça — arrastar a foto ou o vídeo na própria peça do calendário.
 *
 * Irmão do `galeria.ts`, e de propósito: mesmo bucket privado, mesma ordem de
 * operações, mesmo cuidado com o arquivo órfão. O que muda é o destino e as
 * regras — aqui a Meta tem opinião sobre quantos arquivos e de que tipo, e
 * essas regras são cobradas pelo banco no momento de anexar, não no minuto do
 * post.
 *
 * O caminho do arquivo COMEÇA pelo id do cliente, e isso não é organização: é
 * o que a política do bucket (0038) lê para decidir quem pode abrir o arquivo.
 * Caminho fora da convenção cria um arquivo que nem a equipe nem o cliente
 * conseguem ver — e a `registrar_midia_post` recusa por isso.
 */
import { derivadasDe, ehVideo } from './derivadas';
import { FalhaDados } from './api';
import { sb } from './supabase';
import type { MidiaDaPeca } from './tipos';

const BALDE = 'midias-posts';

export class FalhaDeMidia extends Error {}

/**
 * Modo exemplo: o arquivo fica no navegador, com `URL.createObjectURL`.
 *
 * Isto nao e enfeite de demonstracao. Sem ele, o roteiro de tela nao consegue
 * exercitar a subida — ele roda em modo exemplo, e o caminho inteiro
 * (arrastar, aparecer, tirar) ficaria sem teste de navegador nenhum. Ja levei
 * essa licao duas vezes nesta semana: ambiente de teste que nao chega onde a
 * realidade chega testa so o caminho facil.
 *
 * As regras da Meta sao repetidas aqui de proposito, e ficam proximas das do
 * banco: se as duas discordarem, o roteiro acusa.
 */
const LIMITES: Record<string, { max: number; aceita: 'imagem' | 'video' | 'os_dois' }> = {
  imagem: { max: 1, aceita: 'imagem' },
  carrossel: { max: 10, aceita: 'os_dois' },
  reel: { max: 1, aceita: 'video' },
  story: { max: 1, aceita: 'os_dois' },
};

const EXEMPLO = new Map<string, MidiaDaPeca[]>();

function exemploDaPeca(postId: string): MidiaDaPeca[] {
  return EXEMPLO.get(postId) ?? [];
}

function subirExemplo(postId: string, tipo: string, arquivo: File): void {
  const regra = LIMITES[tipo] ?? { max: 1, aceita: 'os_dois' as const };
  const lista = exemploDaPeca(postId);
  const ehImagem = arquivo.type.startsWith('image/');
  const video = arquivo.type.startsWith('video/');

  if (lista.length >= regra.max) {
    throw new FalhaDeMidia(`Esta peca (${tipo}) aceita no maximo ${regra.max} arquivo(s), e ja tem ${lista.length}.`);
  }
  if (regra.aceita === 'imagem' && !ehImagem) {
    throw new FalhaDeMidia(`Peca de imagem aceita foto, nao ${arquivo.type}.`);
  }
  if (regra.aceita === 'video' && !video) {
    throw new FalhaDeMidia(`Reel aceita video, nao ${arquivo.type}.`);
  }

  lista.push({
    id: crypto.randomUUID(),
    ordem: lista.length,
    caminho: `exemplo/${arquivo.name}`,
    mime: arquivo.type || 'image/jpeg',
    bytes: arquivo.size,
    url: URL.createObjectURL(arquivo),
  });
  EXEMPLO.set(postId, lista);
}

function extensaoDe(nome: string): string {
  const ext = nome.includes('.') ? nome.split('.').pop() : '';
  return (ext ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
}

/** Os arquivos da peça, com endereço assinado de validade curta. */
export async function midiasDaPeca(postId: string): Promise<MidiaDaPeca[]> {
  if (!sb) return exemploDaPeca(postId);

  const { data, error } = await sb.rpc('midias_do_post', { p_post: postId });
  if (error) throw new FalhaDados(`Não consegui ler os arquivos: ${error.message}`);

  const midias = (data as MidiaDaPeca[] | null) ?? [];
  if (midias.length === 0) return midias;

  const { data: urls } = await sb.storage
    .from(BALDE)
    .createSignedUrls(midias.map((m) => m.caminho), 3600);
  const mapa = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));

  // Arquivo que não assinou vira `url: null`, não endereço quebrado: a tela
  // mostra o lugar do arquivo em vez de um ícone de imagem partida.
  return midias.map((m) => ({ ...m, url: mapa.get(m.caminho) ?? null }));
}

/**
 * Sobe o arquivo e registra a linha, nessa ordem.
 *
 * Registrar antes deixaria a peça mostrando um arquivo que não existe se o
 * upload falhasse no meio. Se o registro falhar depois do upload, o arquivo é
 * apagado aqui mesmo — fica caro deixar lixo num bucket que ninguém varre.
 */
export async function subirMidiaDaPeca(
  postId: string,
  clienteId: string,
  arquivo: File,
  aoProgredir: (fracao: number) => void,
  tipo = 'imagem',
): Promise<void> {
  if (!sb) {
    aoProgredir(0.4);
    subirExemplo(postId, tipo, arquivo);
    aoProgredir(1);
    return;
  }

  const id = crypto.randomUUID();
  const caminho = `${clienteId}/${postId}/${id}.${extensaoDe(arquivo.name)}`;
  const mime = arquivo.type || (ehVideo(arquivo) ? 'video/mp4' : 'image/jpeg');

  aoProgredir(0.05);

  // As dimensões vêm daqui porque o navegador já tem o arquivo aberto. O banco
  // guarda, e o adaptador da Meta usa para recusar proporção impossível antes
  // de gastar uma chamada de API.
  const derivadas = await derivadasDe(arquivo);
  aoProgredir(0.12);

  const { error: erroArquivo } = await sb.storage.from(BALDE).upload(caminho, arquivo, {
    contentType: mime,
    upsert: false,
  });
  if (erroArquivo) throw new FalhaDeMidia(`${arquivo.name}: ${erroArquivo.message}`);
  aoProgredir(0.85);

  const { error: erroLinha } = await sb.rpc('registrar_midia_post', {
    p_post: postId,
    p_caminho: caminho,
    p_mime: mime,
    p_largura: derivadas?.largura ?? null,
    p_altura: derivadas?.altura ?? null,
    p_duracao: derivadas?.duracao ?? null,
    p_bytes: arquivo.size,
  });

  if (erroLinha) {
    // O banco recusou — tipo errado, peça cheia, peça já publicada. O arquivo
    // não serve para nada: sai agora, antes de alguém ter de limpar à mão.
    await sb.storage.from(BALDE).remove([caminho]);
    throw new FalhaDeMidia(erroLinha.message);
  }

  aoProgredir(1);
}

/** Tira o arquivo da peça: a linha primeiro, o arquivo depois. */
export async function removerMidiaDaPeca(midiaId: string): Promise<void> {
  if (!sb) {
    for (const [post, lista] of EXEMPLO) {
      const i = lista.findIndex((m) => m.id === midiaId);
      if (i >= 0) {
        const [fora] = lista.splice(i, 1);
        if (fora?.url) URL.revokeObjectURL(fora.url);
        // A ordem e reescrita, como o banco faz: senao a segunda subida
        // reclamaria de posicao ocupada.
        lista.forEach((m, n) => { m.ordem = n; });
        EXEMPLO.set(post, lista);
        return;
      }
    }
    return;
  }

  const { data, error } = await sb.rpc('remover_midia_post', { p_midia: midiaId });
  if (error) throw new FalhaDeMidia(error.message);

  const caminho = (data as { caminho?: string } | null)?.caminho;
  // Arquivo que sobra no bucket é desperdício; linha apontando para arquivo que
  // não existe é imagem quebrada na cara de quem olha. A linha sai primeiro.
  if (caminho) await sb.storage.from(BALDE).remove([caminho]);
}
