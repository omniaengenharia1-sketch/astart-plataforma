// =============================================================================
// galeria — a porta do link sem conta.
//
// O cliente de fotos recebe um endereço e abre a galeria. Ele não tem conta,
// não vai criar uma, e o bucket é privado. Então esta função é a única que
// pode: ela troca o token por dados, e caminho por URL assinada de vida curta.
//
// O que ela NÃO faz, de propósito: servir arquivo. O download aponta direto
// para o storage por URL assinada. Passar 1,2 GB de vídeo pelo corpo de uma
// Edge Function é a forma mais cara e mais frágil de entregar um arquivo que
// já está num CDN.
//
// A validação do token mora no banco (`galeria_por_token`), não aqui: é lá que
// está o hash, e é lá que `revogado_em` é conferido. Esta função só carrega o
// token até lá.
// =============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const BALDE = 'galerias';
/** Miniatura dura pouco: a página recarrega e pede de novo sem dor. */
const SEGUNDOS_MINIATURA = 60 * 60;
/** O original dura o bastante para um download grande terminar. */
const SEGUNDOS_ORIGINAL = 60 * 60 * 6;

interface ItemBruto {
  id: string;
  tipo: 'foto' | 'video';
  nome: string;
  caminho: string;
  miniatura: string | null;
  poster: string | null;
  largura: number | null;
  altura: number | null;
  duracao: number | null;
  bytes: number | null;
}

interface GaleriaBruta {
  galeriaId: string;
  titulo: string;
  recado: string | null;
  permiteDownload: boolean;
  cliente: string | null;
  quando: string | null;
  itens: ItemBruto[];
  favoritos: string[];
}

const CABECALHOS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function erro(mensagem: string, status: number): Response {
  return new Response(JSON.stringify({ erro: mensagem }), { status, headers: CABECALHOS });
}

function exigir(nome: string): string {
  const v = Deno.env.get(nome);
  if (!v) throw new Error(`Variavel de ambiente ${nome} nao configurada.`);
  return v;
}

/** Assina vários caminhos de uma vez; os que falharem voltam nulos. */
async function assinar(
  sb: SupabaseClient,
  caminhos: string[],
  segundos: number,
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const limpos = [...new Set(caminhos.filter((c): c is string => !!c))];
  if (limpos.length === 0) return mapa;

  const { data, error } = await sb.storage.from(BALDE).createSignedUrls(limpos, segundos);
  if (error) return mapa;
  for (const linha of data ?? []) {
    if (linha.signedUrl && linha.path) mapa.set(linha.path, linha.signedUrl);
  }
  return mapa;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return erro('Use POST.', 405);

  let pedido: { token?: string; acao?: string; item?: string; quem?: string; ligado?: boolean };
  try {
    pedido = await req.json();
  } catch {
    return erro('Corpo invalido: esperava JSON.', 400);
  }

  const token = (pedido.token ?? '').trim();
  if (token.length < 32) return erro('Link invalido.', 404);

  const sb = createClient(exigir('SUPABASE_URL'), exigir('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  // Toda ação começa resolvendo o token. Se ele não abre nada, a resposta é a
  // mesma para link revogado, token errado e galeria arquivada: 404. Dizer
  // "esta galeria existe, mas foi revogada" já é contar demais.
  const { data, error } = await sb.rpc('galeria_por_token', { p_token: token });
  if (error) return erro('Nao consegui abrir a galeria.', 500);
  const galeria = data as GaleriaBruta | null;
  if (!galeria) return erro('Este link nao abre nenhuma galeria.', 404);

  const acao = pedido.acao ?? 'abrir';

  if (acao === 'favorito') {
    if (!pedido.item) return erro('Faltou dizer qual item.', 400);
    const { error: e } = await sb.rpc('favoritar_por_token', {
      p_token: token,
      p_item: pedido.item,
      p_quem: pedido.quem ?? 'cliente',
      p_ligado: pedido.ligado !== false,
    });
    if (e) return erro(e.message, 400);
    return new Response(JSON.stringify({ ok: true }), { headers: CABECALHOS });
  }

  if (acao === 'baixar') {
    if (!galeria.permiteDownload) return erro('Esta galeria esta sem download.', 403);

    const alvos = pedido.item ? galeria.itens.filter((i) => i.id === pedido.item) : galeria.itens;
    if (alvos.length === 0) return erro('Item nao encontrado.', 404);

    const urls = await assinar(sb, alvos.map((i) => i.caminho), SEGUNDOS_ORIGINAL);
    await sb.rpc('registrar_download_galeria', {
      p_token: token,
      p_item: pedido.item ?? null,
      p_quem: pedido.quem ?? null,
    });

    return new Response(
      JSON.stringify({
        arquivos: alvos.map((i) => ({
          id: i.id,
          nome: i.nome,
          bytes: i.bytes,
          url: urls.get(i.caminho) ?? null,
        })),
      }),
      { headers: CABECALHOS },
    );
  }

  // acao = abrir: a página da galeria.
  const caminhos = galeria.itens.flatMap((i) =>
    [i.miniatura, i.tipo === 'video' ? i.poster : null].filter((c): c is string => !!c)
  );
  const urls = await assinar(sb, caminhos, SEGUNDOS_MINIATURA);

  return new Response(
    JSON.stringify({
      titulo: galeria.titulo,
      recado: galeria.recado,
      cliente: galeria.cliente,
      quando: galeria.quando,
      permiteDownload: galeria.permiteDownload,
      favoritos: galeria.favoritos,
      itens: galeria.itens.map((i) => ({
        id: i.id,
        tipo: i.tipo,
        nome: i.nome,
        largura: i.largura,
        altura: i.altura,
        duracao: i.duracao,
        bytes: i.bytes,
        // O caminho do original NÃO sai daqui. Ele só vira URL na ação de
        // baixar, que fica registrada. Senão o link vira hotlink eterno.
        miniatura: i.miniatura ? (urls.get(i.miniatura) ?? null) : null,
        poster: i.poster ? (urls.get(i.poster) ?? null) : null,
      })),
    }),
    { headers: CABECALHOS },
  );
});
