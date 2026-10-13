/**
 * Os arquivos do cliente: contrato, proposta, relatório de campanha, NPS.
 *
 * Irmão do `pecaMidia.ts` e do `galeria.ts`, e de propósito: mesmo bucket
 * privado, mesma ordem de operações, mesmo cuidado com o arquivo órfão. O que
 * muda é o destino e quem pode ver.
 *
 * O caminho COMEÇA pelo id do cliente, e isso não é organização: é o que a
 * função do banco cobra (0053), e arquivo fora da convenção fica num lugar que
 * ninguém varre.
 *
 * Duas regras que vêm do banco e são repetidas aqui de propósito — se as duas
 * discordarem, o roteiro de tela acusa:
 *   - contrato nasce VISÍVEL ao cliente; proposta e outro nascem fechados;
 *   - reenviar o relatório do mesmo período TROCA o arquivo, e o antigo tem de
 *     sair do bucket, senão cada correção deixa lixo lá dentro.
 */
import { FalhaDados } from './api';
import {
  documentosExemplo, registrarDocumentoExemplo, removerDocumentoExemplo,
  mudarVisibilidadeExemplo, relatorioExemplo, removerRelatorioExemplo,
} from './mock';
import { sb } from './supabase';
import type { DocumentoDoCliente, TipoDocumento } from './tipos';

const BALDE = 'documentos';

export class FalhaDeArquivo extends Error {}

/** Os tipos que o banco aceita, com o nome que a tela usa. */
export const TIPOS_DE_DOCUMENTO: { valor: TipoDocumento; rotulo: string; dica: string }[] = [
  { valor: 'contrato', rotulo: 'Contrato', dica: 'o cliente vê no portal dele' },
  { valor: 'proposta', rotulo: 'Proposta', dica: 'fica só com a equipe' },
  { valor: 'outro', rotulo: 'Outro', dica: 'NPS, ata, briefing — fica só com a equipe' },
];

/**
 * O que o bucket aceita (0053). Repetido no `accept` do input e conferido aqui
 * antes de subir: o navegador trata `accept` como sugestão, e arrastar um
 * arquivo contorna ele inteiro. O bucket recusaria de qualquer jeito, com uma
 * mensagem em inglês que não diz o que fazer.
 */
const ACEITOS = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
]);

export const ACEITA_NO_INPUT = [
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.xlsx', '.docx', '.pptx', '.csv',
].join(',');

const LIMITE_BYTES = 200 * 1024 * 1024;

function conferir(arquivo: File): void {
  // Tipo vazio acontece: alguns sistemas não preenchem o MIME ao arrastar. Aí
  // a extensão decide, porque recusar um PDF legítimo por falta de metadado
  // seria recusar o caso comum.
  const tipo = arquivo.type || porExtensao(arquivo.name);
  if (!ACEITOS.has(tipo)) {
    throw new FalhaDeArquivo(
      `"${arquivo.name}" é ${arquivo.type || 'de tipo desconhecido'}. ` +
        'Aqui entram PDF, imagem, planilha, documento, apresentação e CSV.',
    );
  }
  if (arquivo.size > LIMITE_BYTES) {
    throw new FalhaDeArquivo(
      `"${arquivo.name}" tem ${(arquivo.size / 1048576).toFixed(0)} MB, e o limite é 200 MB. ` +
        'Se for um PDF com muitas imagens, exporte comprimido.',
    );
  }
}

function porExtensao(nome: string): string {
  const ext = (nome.includes('.') ? nome.split('.').pop() : '')?.toLowerCase() ?? '';
  return {
    pdf: 'application/pdf',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv',
  }[ext] ?? '';
}

function extensaoDe(nome: string): string {
  const ext = nome.includes('.') ? nome.split('.').pop() : '';
  return (ext ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
}

/**
 * Endereço assinado de validade curta, para o navegador abrir o arquivo.
 *
 * O `createSignedUrls` devolve `path` e `signedUrl` como possivelmente nulos —
 * é o que acontece com o item que ele não conseguiu assinar. Então os nulos
 * saem aqui, e quem chamou trata a ausência como ausência, em vez de montar um
 * link para `null`.
 */
async function assinar(caminhos: string[]): Promise<Map<string, string>> {
  if (!sb || caminhos.length === 0) return new Map();
  const { data } = await sb.storage.from(BALDE).createSignedUrls(caminhos, 3600);
  const pares: [string, string][] = [];
  for (const u of data ?? []) {
    if (u.path && u.signedUrl) pares.push([u.path, u.signedUrl]);
  }
  return new Map(pares);
}

export async function documentosDoCliente(clienteId: string): Promise<DocumentoDoCliente[]> {
  if (!sb) return documentosExemplo(clienteId);

  const { data, error } = await sb.rpc('documentos_do_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Não consegui ler os documentos: ${error.message}`);

  const docs = (data as DocumentoDoCliente[] | null) ?? [];
  const urls = await assinar(docs.map((d) => d.caminho));
  // Arquivo que não assinou vira `url: null`, não endereço quebrado: a tela
  // mostra o documento sem o botão de abrir, em vez de um link que dá erro.
  return docs.map((d) => ({ ...d, url: urls.get(d.caminho) ?? null }));
}

/** Endereço assinado de um caminho só — o relatório de campanha usa. */
export async function enderecoDoArquivo(caminho: string | null): Promise<string | null> {
  if (!caminho) return null;
  if (!sb) return caminho;
  return (await assinar([caminho])).get(caminho) ?? null;
}

/**
 * Sobe o arquivo e registra a linha, nessa ordem.
 *
 * Registrar antes deixaria um documento na lista apontando para um arquivo que
 * não existe, se a subida falhasse no meio. Se o registro falhar depois da
 * subida, o arquivo é apagado aqui mesmo — fica caro deixar lixo num bucket que
 * ninguém varre.
 */
export async function subirDocumento(
  clienteId: string,
  tipo: TipoDocumento,
  nome: string,
  arquivo: File,
  aoProgredir: (fracao: number) => void,
): Promise<{ visivelAoCliente: boolean }> {
  conferir(arquivo);

  if (!sb) {
    aoProgredir(0.4);
    const r = registrarDocumentoExemplo(clienteId, tipo, nome || arquivo.name, arquivo);
    aoProgredir(1);
    return r;
  }

  const id = crypto.randomUUID();
  const caminho = `${clienteId}/documentos/${id}.${extensaoDe(arquivo.name)}`;
  const mime = arquivo.type || porExtensao(arquivo.name);

  aoProgredir(0.08);
  const { error: erroArquivo } = await sb.storage.from(BALDE).upload(caminho, arquivo, {
    contentType: mime,
    upsert: false,
  });
  if (erroArquivo) throw new FalhaDeArquivo(`${arquivo.name}: ${erroArquivo.message}`);
  aoProgredir(0.85);

  const { data, error: erroLinha } = await sb.rpc('registrar_documento_do_cliente', {
    p_cliente: clienteId,
    p_tipo: tipo,
    p_nome: (nome || arquivo.name).trim(),
    p_caminho: caminho,
    // Nulo = use o padrão do tipo. Mandar `false` aqui esconderia o contrato,
    // que é o contrário do que a dona decidiu.
    p_visivel: null,
  });

  if (erroLinha) {
    await sb.storage.from(BALDE).remove([caminho]);
    throw new FalhaDeArquivo(erroLinha.message);
  }

  aoProgredir(1);
  return { visivelAoCliente: (data as { visivelAoCliente: boolean }).visivelAoCliente };
}

/** Tira o documento: a linha primeiro, o arquivo depois. */
export async function removerDocumento(id: string): Promise<void> {
  if (!sb) {
    removerDocumentoExemplo(id);
    return;
  }

  const { data, error } = await sb.rpc('remover_documento_do_cliente', { p_documento: id });
  if (error) throw new FalhaDeArquivo(error.message);

  const caminho = (data as { caminho?: string } | null)?.caminho;
  if (caminho) await sb.storage.from(BALDE).remove([caminho]);
}

export async function mudarVisibilidade(id: string, visivel: boolean): Promise<void> {
  if (!sb) {
    mudarVisibilidadeExemplo(id, visivel);
    return;
  }
  const { error } = await sb.rpc('mudar_visibilidade_do_documento', {
    p_documento: id,
    p_visivel: visivel,
  });
  if (error) throw new FalhaDeArquivo(error.message);
}

/**
 * O relatório de campanha de um período.
 *
 * Reenviar o mesmo período TROCA o arquivo, e o banco devolve o caminho do
 * antigo para ser apagado aqui. Sem isso, cada correção de relatório deixaria
 * um arquivo morto no bucket — e corrigir relatório é rotina, não exceção.
 */
export async function subirRelatorioDeCampanha(
  clienteId: string,
  de: string,
  ate: string,
  nome: string,
  arquivo: File,
  aoProgredir: (fracao: number) => void,
): Promise<void> {
  conferir(arquivo);

  if (!sb) {
    aoProgredir(0.4);
    relatorioExemplo(clienteId, de, ate, nome || arquivo.name, arquivo);
    aoProgredir(1);
    return;
  }

  const id = crypto.randomUUID();
  const caminho = `${clienteId}/campanhas/${id}.${extensaoDe(arquivo.name)}`;
  const mime = arquivo.type || porExtensao(arquivo.name);

  aoProgredir(0.08);
  const { error: erroArquivo } = await sb.storage.from(BALDE).upload(caminho, arquivo, {
    contentType: mime,
    upsert: false,
  });
  if (erroArquivo) throw new FalhaDeArquivo(`${arquivo.name}: ${erroArquivo.message}`);
  aoProgredir(0.85);

  const { data, error: erroLinha } = await sb.rpc('registrar_relatorio_de_campanha', {
    p_cliente: clienteId,
    p_de: de,
    p_ate: ate,
    p_nome: (nome || arquivo.name).trim(),
    p_caminho: caminho,
  });

  if (erroLinha) {
    await sb.storage.from(BALDE).remove([caminho]);
    throw new FalhaDeArquivo(erroLinha.message);
  }

  // O arquivo que acabou de ser substituído. Falhar aqui não desfaz o envio —
  // o relatório novo já está valendo —, então o erro não sobe: no pior caso
  // sobra um arquivo no bucket, e isso é melhor que a pessoa achar que o
  // envio falhou e mandar de novo.
  const antigo = (data as { caminhoAntigo?: string | null } | null)?.caminhoAntigo;
  if (antigo) await sb.storage.from(BALDE).remove([antigo]).catch(() => {});

  aoProgredir(1);
}

export async function removerRelatorioDeCampanha(id: string): Promise<void> {
  if (!sb) {
    removerRelatorioExemplo(id);
    return;
  }
  const { data, error } = await sb.rpc('remover_relatorio_de_campanha', { p_relatorio: id });
  if (error) throw new FalhaDeArquivo(error.message);

  const caminho = (data as { caminho?: string | null } | null)?.caminho;
  if (caminho) await sb.storage.from(BALDE).remove([caminho]);
}
