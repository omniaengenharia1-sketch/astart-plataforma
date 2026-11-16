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
import { derivadasDe, ehVideo, paraJpegDaMeta } from './derivadas';
import { FalhaDados } from './api';
import { FORMATOS, recusaDoArquivo } from './formatos';
import { anotarMidiaExemplo } from './mock';
import { sb } from './supabase';
import type { MidiaDaPeca, TipoPeca } from './tipos';

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
 * As regras vem de `./formatos`, nao reescritas aqui. Reescritas, era onde
 * elas apodreciam: este arquivo tinha a sua propria tabela de limites, e nela
 * carrossel aceitava `os_dois` — ou seja, o modo exemplo APROVAVA video em
 * carrossel, que o banco recusa desde a 0056. Como os roteiros de navegador
 * rodam justamente no modo exemplo, nenhum deles podia pegar a divergencia.
 * Ambiente de teste mais generoso que a producao testa so o caminho facil.
 */
const EXEMPLO = new Map<string, MidiaDaPeca[]>();

function exemploDaPeca(postId: string): MidiaDaPeca[] {
  return EXEMPLO.get(postId) ?? [];
}

function subirExemplo(postId: string, tipo: TipoPeca, arquivo: File): void {
  const regra = FORMATOS[tipo];
  const lista = exemploDaPeca(postId);

  if (lista.length >= regra.maximo) {
    throw new FalhaDeMidia(`Esta peca (${tipo}) aceita no maximo ${regra.maximo} arquivo(s), e ja tem ${lista.length}.`);
  }

  // A mesma recusa que a `registrar_midia_post` daria, com a mesma frase.
  const recusa = recusaDoArquivo(tipo, arquivo.type);
  if (recusa) throw new FalhaDeMidia(recusa);

  lista.push({
    id: crypto.randomUUID(),
    ordem: lista.length,
    caminho: `exemplo/${arquivo.name}`,
    mime: arquivo.type || 'image/jpeg',
    bytes: arquivo.size,
    url: URL.createObjectURL(arquivo),
  });
  EXEMPLO.set(postId, lista);
  // Os dois armazens do modo exemplo tem de concordar: a midia vive AQUI e
  // `agendar_publicacao` do exemplo precisa saber quantas sao para recusar
  // agendamento sem arquivo. Avisar e mais seguro que duplicar a contagem — o
  // roteiro pegou justamente essa divergencia.
  anotarMidiaExemplo(postId, lista);
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

/** `image/png` → `PNG`. Para a frase dizer o formato que a pessoa reconhece. */
function sigla(mime: string): string {
  return (mime.split('/')[1] ?? mime).toUpperCase();
}

/**
 * Sobe o arquivo e registra a linha, nessa ordem.
 *
 * Registrar antes deixaria a peça mostrando um arquivo que não existe se o
 * upload falhasse no meio. Se o registro falhar depois do upload, o arquivo é
 * apagado aqui mesmo — fica caro deixar lixo num bucket que ninguém varre.
 *
 * Devolve o aviso que a tela tem de mostrar, ou `null`. Hoje é só um: o
 * arquivo não era JPEG e foi convertido. Isso não cabia no `aoProgredir`, que
 * só sabe falar em porcentagem, e não podia virar exceção — nada deu errado.
 */
export async function subirMidiaDaPeca(
  postId: string,
  clienteId: string,
  original: File,
  aoProgredir: (fracao: number) => void,
  tipo: TipoPeca = 'imagem',
): Promise<string | null> {
  // A CONVERSÃO VEM ANTES DO `if (!sb)`, de propósito: é o caminho real e o
  // modo exemplo têm de passar pela mesma régua. Modo exemplo mais generoso
  // que a produção já custou caro neste arquivo (ver o comentário do EXEMPLO).
  const convertida = original.type.startsWith('image/')
    ? await paraJpegDaMeta(original)
    : { arquivo: original, achatou: false, converteu: false };

  const arquivo = convertida.arquivo;
  const aviso = !convertida.converteu
    ? null
    : `${sigla(original.type)} convertido para JPG — a Meta publica imagem só em JPEG.` +
      (convertida.achatou
        ? ' A arte tinha fundo transparente, e ele virou branco. Se era para ter outra cor,' +
          ' exporte com o fundo e anexe de novo.'
        : '');

  if (!sb) {
    aoProgredir(0.4);
    subirExemplo(postId, tipo, arquivo);
    aoProgredir(1);
    return aviso;
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
  return aviso;
}

/**
 * Muda a posição do arquivo no carrossel.
 *
 * Pedido da dona depois de subir um carrossel da Mor: "falta eu poder
 * movimentar o carrossel, tipo: colocar uma imagem em segundo outra em
 * terceiro". Até a 0069 a ordem era a ordem em que os arquivos subiram, e
 * mudar exigia tirar tudo e subir de novo na ordem certa.
 *
 * `para` é a posição de destino contada do zero. Fora da faixa é PRESO, e não
 * recusado — a tela manda "um para trás" no primeiro arquivo o tempo todo, e
 * isso não é erro de ninguém.
 */
export async function moverMidiaDaPeca(midiaId: string, para: number): Promise<void> {
  if (!sb) {
    for (const [post, lista] of EXEMPLO) {
      const de = lista.findIndex((m) => m.id === midiaId);
      if (de < 0) continue;
      // O MESMO limite do banco, de propósito. Modo exemplo que se comporta
      // diferente da produção faz o roteiro aprovar o que a produção reprova
      // — já aconteceu neste arquivo, e está escrito no topo dele.
      const destino = Math.min(Math.max(para, 0), lista.length - 1);
      const item = lista[de];
      if (!item || de === destino) return;
      lista.splice(de, 1);
      lista.splice(destino, 0, item);
      lista.forEach((m, n) => { m.ordem = n; });
      EXEMPLO.set(post, lista);
      anotarMidiaExemplo(post, lista);
      return;
    }
    return;
  }

  const { error } = await sb.rpc('mover_midia_do_post', {
    p_midia: midiaId,
    p_para: para,
  });
  if (error) throw new FalhaDeMidia(error.message);
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
        anotarMidiaExemplo(post, lista);
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
