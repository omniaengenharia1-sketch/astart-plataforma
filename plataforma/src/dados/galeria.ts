// =============================================================================
// Subir, baixar e abrir galeria.
//
// O upload vai DIRETO do navegador para o storage, com o JWT de quem está
// logado — o RLS do bucket é quem autoriza. Não há função no meio: um vídeo de
// 1,2 GB passando pelo corpo de uma Edge Function é a forma mais cara e mais
// frágil de mover um arquivo.
// =============================================================================
import { Zip, ZipPassThrough } from 'fflate';
import { ligado, sb } from './supabase';
import { derivadasDe, ehVideo } from './derivadas';
import { registrarItemExemplo } from './mock';
import type { Album, EnvioEmCurso, ItemGaleria } from './tipos';

const BALDE = 'galerias';

/**
 * De onde o álbum vem. São duas portas para a mesma sala: quem tem o link não
 * tem conta e passa pela Edge Function; quem está logado lê direto, porque o
 * RLS já sabe quem ele é.
 */
export type FonteAlbum =
  | { tipo: 'token'; token: string }
  | { tipo: 'galeria'; galeriaId: string };

export class FalhaEnvio extends Error {}

const extensaoDe = (nome: string) => {
  const p = nome.lastIndexOf('.');
  return p > 0 ? nome.slice(p + 1).toLowerCase() : 'bin';
};

/**
 * Sobe um arquivo e registra o item. A ordem importa: o arquivo primeiro, a
 * linha depois. Registrar antes deixaria a galeria mostrando um item cujo
 * arquivo ainda não existe se o upload falhar no meio.
 */
export async function subirItem(
  galeriaId: string,
  arquivo: File,
  aoProgredir: (fracao: number) => void,
): Promise<void> {
  if (!sb) {
    await registrarItemExemplo(galeriaId, arquivo, aoProgredir);
    return;
  }

  const id = crypto.randomUUID();
  const tipo = ehVideo(arquivo) ? 'video' : 'foto';
  const caminho = `${galeriaId}/orig/${id}.${extensaoDe(arquivo.name)}`;

  aoProgredir(0.02);
  const derivadas = await derivadasDe(arquivo);
  aoProgredir(0.08);

  const { error: erroArquivo } = await sb.storage.from(BALDE).upload(caminho, arquivo, {
    contentType: arquivo.type || 'application/octet-stream',
    upsert: false,
  });
  if (erroArquivo) throw new FalhaEnvio(`${arquivo.name}: ${erroArquivo.message}`);
  aoProgredir(0.8);

  let miniatura: string | null = null;
  let poster: string | null = null;
  if (derivadas) {
    // A extensão e o content-type saem do BLOB, não de uma constante. Eram
    // `.webp` e `'image/webp'` escritos à mão enquanto o navegador entregava
    // PNG — o arquivo subia mentindo sobre o que era, e nada acusava. Ver o
    // cabeçalho de `paraBlob`, em `derivadas.ts`.
    const tipoMini = derivadas.miniatura.type || 'image/jpeg';
    miniatura = `${galeriaId}/mini/${id}.${tipoMini === 'image/webp' ? 'webp' : 'jpg'}`;
    const { error } = await sb.storage.from(BALDE).upload(miniatura, derivadas.miniatura, {
      contentType: tipoMini,
      upsert: true,
    });
    if (error) miniatura = null;
    // O poster do vídeo é o mesmo arquivo da miniatura: não subo duas vezes.
    if (tipo === 'video' && miniatura) poster = miniatura;
  }
  aoProgredir(0.92);

  const { error: erroLinha } = await sb.rpc('registrar_item_galeria', {
    p_galeria: galeriaId,
    p_nome: arquivo.name,
    p_tipo: tipo,
    p_caminho: caminho,
    p_mime: arquivo.type || null,
    p_bytes: arquivo.size,
    p_miniatura: miniatura,
    p_poster: poster,
    p_largura: derivadas?.largura ?? null,
    p_altura: derivadas?.altura ?? null,
    p_duracao: derivadas?.duracao ?? null,
  });
  if (erroLinha) throw new FalhaEnvio(`${arquivo.name}: ${erroLinha.message}`);
  aoProgredir(1);
}

/** Estado inicial de um arquivo na fila de envio. */
export function naFila(arquivo: File): EnvioEmCurso {
  return {
    id: crypto.randomUUID(),
    nome: arquivo.name,
    bytes: arquivo.size,
    tipo: ehVideo(arquivo) ? 'video' : 'foto',
    progresso: 0,
    erro: null,
    pronto: false,
  };
}

// ---------------------------------------------------------------------------
// O lado de quem recebe
// ---------------------------------------------------------------------------

async function chamarFuncao<T>(corpo: Record<string, unknown>): Promise<T> {
  if (!sb) throw new FalhaEnvio('Sem Supabase configurado.');
  const { data, error } = await sb.functions.invoke('galeria', { body: corpo });
  if (error) {
    let mensagem = error.message;
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const j = (await ctx.json()) as { erro?: string };
        if (j?.erro) mensagem = j.erro;
      } catch {
        /* fica a mensagem bruta */
      }
    }
    throw new FalhaEnvio(mensagem);
  }
  return data as T;
}

export async function albumPorToken(token: string): Promise<Album> {
  if (!sb) {
    const { albumExemplo } = await import('./mock');
    return albumExemplo(token);
  }
  return chamarFuncao<Album>({ token, acao: 'abrir' });
}

/**
 * O original de UMA foto, assinado para OLHAR — não para baixar.
 *
 * A lupa mostrava a miniatura esticada: 640px de lado numa tela de 1440, o que
 * dá uma foto pequena no meio de um fundo preto. A dona mandou a captura e
 * parecia a tela quebrada.
 *
 * Não dá para reaproveitar o caminho de baixar: ele registra o download, e a
 * agência usa esse registro para saber se o cliente já pegou as fotos. Abrir
 * para olhar não é pegar.
 */
export async function verItem(fonte: FonteAlbum, item: string): Promise<string | null> {
  if (!sb) {
    // No modo exemplo não há original separado: a "miniatura" é o arquivo.
    const { albumExemplo } = await import('./mock');
    const a = albumExemplo(fonte.tipo === 'token' ? fonte.token : fonte.galeriaId);
    return a.itens.find((i) => i.id === item)?.miniatura ?? null;
  }

  if (fonte.tipo === 'token') {
    const r = await chamarFuncao<{ url: string | null }>({
      token: fonte.token,
      acao: 'ver',
      item,
    });
    return r.url;
  }

  // A equipe está logada e o RLS já sabe quem é: assina direto, sem função.
  const { urlsDosOriginais } = await import('./api');
  const [arquivo] = await urlsDosOriginais(fonte.galeriaId, item);
  return arquivo?.url ?? null;
}

export async function favoritarPorToken(
  token: string,
  item: string,
  quem: string,
  ligadoAgora: boolean,
): Promise<void> {
  if (!sb) {
    const { favoritarExemplo } = await import('./mock');
    favoritarExemplo(item, ligadoAgora);
    return;
  }
  await chamarFuncao({ token, acao: 'favorito', item, quem, ligado: ligadoAgora });
}

interface ArquivoParaBaixar {
  id: string;
  nome: string;
  bytes: number | null;
  url: string | null;
}

async function urlsParaBaixar(token: string, item?: string): Promise<ArquivoParaBaixar[]> {
  if (!sb) {
    const { urlsExemplo } = await import('./mock');
    return urlsExemplo(item);
  }
  const r = await chamarFuncao<{ arquivos: ArquivoParaBaixar[] }>({
    token,
    acao: 'baixar',
    item: item ?? null,
  });
  return r.arquivos;
}

async function urlsDaFonte(fonte: FonteAlbum): Promise<ArquivoParaBaixar[]> {
  if (fonte.tipo === 'token') return urlsParaBaixar(fonte.token);
  const { urlsDosOriginais } = await import('./api');
  return urlsDosOriginais(fonte.galeriaId);
}

function baixarUm(url: string, nome: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function baixarItem(token: string, item: string, nome: string): Promise<void> {
  const [arquivo] = await urlsParaBaixar(token, item);
  if (!arquivo?.url) throw new FalhaEnvio('Não consegui gerar o link deste arquivo.');
  baixarUm(arquivo.url, nome);
}

/**
 * Baixar a galeria inteira.
 *
 * Quando o navegador tem `showSaveFilePicker` (Chrome e Edge no computador),
 * o zip é escrito DIRETO no disco, arquivo a arquivo, sem nunca existir
 * inteiro na memória — é assim que 40 GB de captação cabem num download. Sem
 * essa API, cai para um arquivo de cada vez, que funciona em todo lugar.
 *
 * O zip é "store", sem compressão: foto e vídeo já estão comprimidos, e
 * tentar comprimir de novo só gasta processador para ganhar 1%.
 */
export async function baixarTudo(
  fonte: FonteAlbum,
  nomeDoZip: string,
  aoProgredir: (feitos: number, total: number) => void,
): Promise<'zip' | 'um-a-um'> {
  const arquivos = (await urlsDaFonte(fonte)).filter((a) => a.url);
  if (arquivos.length === 0) throw new FalhaEnvio('Não há nada para baixar.');

  const podeStream =
    typeof window !== 'undefined' &&
    'showSaveFilePicker' in window &&
    window.isSecureContext;

  if (!podeStream) {
    for (const [i, a] of arquivos.entries()) {
      if (a.url) baixarUm(a.url, a.nome);
      aoProgredir(i + 1, arquivos.length);
      // Sem respiro o navegador descarta os downloads seguintes.
      await new Promise((r) => setTimeout(r, 400));
    }
    return 'um-a-um';
  }

  const escolher = (
    window as unknown as {
      showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  const destino = await escolher({
    suggestedName: `${nomeDoZip}.zip`,
    types: [{ description: 'Arquivo zip', accept: { 'application/zip': ['.zip'] } }],
  });
  const saida = await destino.createWritable();

  const zip = new Zip();
  const fila: Uint8Array[] = [];
  let erroZip: Error | null = null;
  zip.ondata = (err, dados, fim) => {
    if (err) erroZip = err;
    else if (dados.length) fila.push(dados);
    if (fim) fila.push(new Uint8Array(0));
  };

  const drenar = async () => {
    while (fila.length) {
      const bloco = fila.shift();
      // O cast existe porque o tipo do File System Access exige um
      // ArrayBuffer "puro", e o fflate devolve Uint8Array genérico.
      if (bloco && bloco.length) await saida.write(bloco as unknown as BufferSource);
    }
  };

  try {
    for (const [i, a] of arquivos.entries()) {
      const resposta = await fetch(a.url as string);
      if (!resposta.ok || !resposta.body) throw new FalhaEnvio(`Falhou ao baixar ${a.nome}.`);

      const entrada = new ZipPassThrough(a.nome);
      zip.add(entrada);
      const leitor = resposta.body.getReader();
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        entrada.push(value, false);
        await drenar();
        if (erroZip) throw erroZip;
      }
      entrada.push(new Uint8Array(0), true);
      await drenar();
      aoProgredir(i + 1, arquivos.length);
    }
    zip.end();
    await drenar();
  } finally {
    await saida.close();
  }
  if (erroZip) throw erroZip;
  return 'zip';
}

export const temSupabase = ligado;
export type { ItemGaleria };
