/**
 * Teste de unidade do adaptador e do registro de chamada.
 *
 * Este arquivo existe porque o lado TypeScript deste sistema não tinha nenhum.
 * Tinha `deno check`, que prova tipos, e `provar-cors.mjs`, que bate na função
 * publicada — e um buraco exatamente do tamanho dos dois erros de hoje:
 *
 *   1. o adaptador publicava SÓ imagem e a tela oferecia quatro formatos, o
 *      que só apareceria de madrugada, no post que não sai;
 *   2. `registro.url` levava o `input_token` para o log, e `publicacao_eventos`
 *      gravaria o token da agência em texto.
 *
 * Nenhum dos dois é erro de tipo, e nenhum dos dois aparece numa chamada real
 * bem-sucedida. São erros de COMPORTAMENTO, e é isto que se cobra aqui.
 *
 * Roda com:  deno test --allow-env supabase/functions/_shared/meta/instagram.test.ts
 */
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { adaptadorInstagram } from './instagram.ts';
import { chamarGraph } from '../graph.ts';
import type { ContextoConta } from '../tipos.ts';
import type { MidiaEntrada } from '../adaptador.ts';

Deno.env.set('META_API_VERSION', 'v26.0');

const CTX: ContextoConta = {
  conta_social_id: 'conta-1',
  plataforma: 'instagram',
  ig_user_id: '17841400000001',
  page_id: '1010',
  access_token: 'TOKEN-DA-ASTART-NAO-PODE-VAZAR',
};

function midia(ordem: number, mime = 'image/jpeg'): MidiaEntrada {
  return {
    ordem,
    url: `https://exemplo/${ordem}`,
    mime,
    largura: 1080,
    altura: 1080,
    duracao_segundos: mime.startsWith('video/') ? 12 : null,
  };
}

interface Pedido {
  url: string;
  corpo: Record<string, string>;
}

/**
 * Troca o `fetch` por um que anota o que foi pedido. Devolve os pedidos para o
 * teste conferir — é o único jeito de provar QUAL chamada o adaptador faz, sem
 * falar com a Meta.
 */
function espiar(respostas: unknown[]): { pedidos: Pedido[]; restaurar: () => void } {
  const pedidos: Pedido[] = [];
  const original = globalThis.fetch;
  let n = 0;

  globalThis.fetch = (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const corpo: Record<string, string> = {};
    if (init?.body instanceof URLSearchParams) {
      for (const [k, v] of init.body) corpo[k] = v;
    }
    pedidos.push({ url: String(entrada), corpo });
    const resposta = respostas[Math.min(n++, respostas.length - 1)];
    return Promise.resolve(
      new Response(JSON.stringify(resposta), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return { pedidos, restaurar: () => { globalThis.fetch = original; } };
}

async function recusa(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('deveria ter recusado, e nao recusou');
}

// ---------------------------------------------------------------------------
// O registro de chamada não pode levar segredo
// ---------------------------------------------------------------------------
Deno.test('a URL do log apaga parametro sensivel', async () => {
  const espiao = espiar([{ data: { is_valid: true, type: 'SYSTEM_USER' } }]);
  try {
    const { registro } = await chamarGraph({
      metodo: 'GET',
      caminho: 'debug_token',
      token: 'APP-TOKEN',
      operacao: 'conferir_token',
      params: { input_token: 'TOKEN-DA-ASTART-NAO-PODE-VAZAR' },
    });

    // A chamada DE VERDADE leva o token: é o que a Meta precisa receber.
    assertStringIncludes(espiao.pedidos[0].url, 'TOKEN-DA-ASTART-NAO-PODE-VAZAR');
    // O registro que vai para `publicacao_eventos`, não.
    assertEquals(registro.url.includes('TOKEN-DA-ASTART-NAO-PODE-VAZAR'), false);
    assertEquals(registro.url.includes('APP-TOKEN'), false);
    assertStringIncludes(registro.url, 'input_token=%5Bredigido%5D');
  } finally {
    espiao.restaurar();
  }
});

Deno.test('o corpo do log apaga parametro sensivel', async () => {
  const espiao = espiar([{ id: 'c1' }]);
  try {
    const { registro } = await chamarGraph({
      metodo: 'POST',
      caminho: 'me/media',
      token: 'TOKEN-DA-ASTART-NAO-PODE-VAZAR',
      operacao: 'teste',
      corpo: { image_url: 'https://exemplo/1' },
    });
    assertEquals(registro.corpo?.image_url, 'https://exemplo/1');
    assertEquals(JSON.stringify(registro).includes('TOKEN-DA-ASTART'), false);
  } finally {
    espiao.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Imagem única
// ---------------------------------------------------------------------------
Deno.test('imagem unica: image_url, legenda, e nasce pronta', async () => {
  const espiao = espiar([{ id: 'c1' }]);
  try {
    const r = await adaptadorInstagram.criarContainer(CTX, {
      tipo: 'imagem',
      legenda: 'olha o estudio',
      midias: [midia(0)],
    });

    assertEquals(espiao.pedidos.length, 1);
    assertEquals(espiao.pedidos[0].corpo.image_url, 'https://exemplo/0');
    assertEquals(espiao.pedidos[0].corpo.caption, 'olha o estudio');
    assertEquals(espiao.pedidos[0].corpo.media_type, undefined);
    assertEquals(r.containerId, 'c1');
    assertEquals(r.aguardarProcessamento, false);
  } finally {
    espiao.restaurar();
  }
});

Deno.test('imagem PNG e recusada — a Meta publica so JPEG', async () => {
  const espiao = espiar([{ id: 'c1' }]);
  try {
    const m = await recusa(() =>
      adaptadorInstagram.criarContainer(CTX, {
        tipo: 'imagem',
        legenda: '',
        midias: [midia(0, 'image/png')],
      })
    );
    assertStringIncludes(m, 'JPEG');
    // E recusa ANTES de gastar chamada na Meta.
    assertEquals(espiao.pedidos.length, 0);
  } finally {
    espiao.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Carrossel — a parte com mais jeito de dar errado
// ---------------------------------------------------------------------------
Deno.test('carrossel: filhos na ordem, pai com children, legenda SO no pai', async () => {
  const espiao = espiar([{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'pai' }]);
  try {
    const r = await adaptadorInstagram.criarContainer(CTX, {
      tipo: 'carrossel',
      legenda: 'tres fotos',
      // Fora de ordem de propósito: a ordem do carrossel no feed é a de
      // `ordem`, não a da lista que chegou.
      midias: [midia(2), midia(0), midia(1)],
    });

    assertEquals(espiao.pedidos.length, 4);

    const filhos = espiao.pedidos.slice(0, 3);
    assertEquals(filhos.map((p) => p.corpo.image_url), [
      'https://exemplo/0',
      'https://exemplo/1',
      'https://exemplo/2',
    ]);
    for (const f of filhos) {
      assertEquals(f.corpo.is_carousel_item, 'true');
      // A Meta ignora legenda em filho de carrossel. Mandar sujaria o log com
      // um parâmetro que não faz nada.
      assertEquals(f.corpo.caption, undefined);
    }

    const pai = espiao.pedidos[3];
    assertEquals(pai.corpo.media_type, 'CAROUSEL');
    assertEquals(pai.corpo.children, 'f1,f2,f3');
    assertEquals(pai.corpo.caption, 'tres fotos');

    assertEquals(r.containerId, 'pai');
    assertEquals(r.children, ['f1', 'f2', 'f3']);
    assertEquals(r.aguardarProcessamento, false);
  } finally {
    espiao.restaurar();
  }
});

Deno.test('carrossel com uma foto so e recusado: minimo e 2', async () => {
  const espiao = espiar([{ id: 'f1' }]);
  try {
    const m = await recusa(() =>
      adaptadorInstagram.criarContainer(CTX, { tipo: 'carrossel', legenda: '', midias: [midia(0)] })
    );
    assertStringIncludes(m, '2 a 10');
    assertEquals(espiao.pedidos.length, 0);
  } finally {
    espiao.restaurar();
  }
});

Deno.test('carrossel com video e recusado nesta versao', async () => {
  const espiao = espiar([{ id: 'f1' }]);
  try {
    const m = await recusa(() =>
      adaptadorInstagram.criarContainer(CTX, {
        tipo: 'carrossel',
        legenda: '',
        midias: [midia(0), midia(1, 'video/mp4')],
      })
    );
    assertStringIncludes(m, 'so imagem');
    assertEquals(espiao.pedidos.length, 0);
  } finally {
    espiao.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Reel e Story
// ---------------------------------------------------------------------------
Deno.test('reel: media_type REELS, video_url, e AGUARDA processamento', async () => {
  const espiao = espiar([{ id: 'c1' }]);
  try {
    const r = await adaptadorInstagram.criarContainer(CTX, {
      tipo: 'reel',
      legenda: 'bastidor',
      midias: [midia(0, 'video/mp4')],
    });

    assertEquals(espiao.pedidos[0].corpo.media_type, 'REELS');
    assertEquals(espiao.pedidos[0].corpo.video_url, 'https://exemplo/0');
    assertEquals(espiao.pedidos[0].corpo.caption, 'bastidor');
    // Sem isto o media_publish sai antes da hora e a Meta recusa.
    assert(r.aguardarProcessamento, 'video SEMPRE aguarda');
  } finally {
    espiao.restaurar();
  }
});

Deno.test('reel com imagem e recusado', async () => {
  const espiao = espiar([{ id: 'c1' }]);
  try {
    const m = await recusa(() =>
      adaptadorInstagram.criarContainer(CTX, { tipo: 'reel', legenda: '', midias: [midia(0)] })
    );
    assertStringIncludes(m, 'so video');
  } finally {
    espiao.restaurar();
  }
});

Deno.test('story de imagem: STORIES, sem legenda, nasce pronto', async () => {
  const espiao = espiar([{ id: 'c1' }]);
  try {
    const r = await adaptadorInstagram.criarContainer(CTX, {
      tipo: 'story',
      legenda: 'esta legenda a Meta joga fora',
      midias: [midia(0)],
    });

    assertEquals(espiao.pedidos[0].corpo.media_type, 'STORIES');
    assertEquals(espiao.pedidos[0].corpo.image_url, 'https://exemplo/0');
    assertEquals(espiao.pedidos[0].corpo.caption, undefined);
    assertEquals(r.aguardarProcessamento, false);
  } finally {
    espiao.restaurar();
  }
});

Deno.test('story de video: video_url e AGUARDA', async () => {
  const espiao = espiar([{ id: 'c1' }]);
  try {
    const r = await adaptadorInstagram.criarContainer(CTX, {
      tipo: 'story',
      legenda: '',
      midias: [midia(0, 'video/mp4')],
    });

    assertEquals(espiao.pedidos[0].corpo.media_type, 'STORIES');
    assertEquals(espiao.pedidos[0].corpo.video_url, 'https://exemplo/0');
    assertEquals(espiao.pedidos[0].corpo.image_url, undefined);
    assert(r.aguardarProcessamento, 'story de video aguarda');
  } finally {
    espiao.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Container sem id: a Meta aceitou e não devolveu o que precisávamos
// ---------------------------------------------------------------------------
Deno.test('resposta sem id vira recusa com motivo, nao undefined adiante', async () => {
  const espiao = espiar([{ nao_tem_id: true }]);
  try {
    const m = await recusa(() =>
      adaptadorInstagram.criarContainer(CTX, { tipo: 'imagem', legenda: '', midias: [midia(0)] })
    );
    assertStringIncludes(m, 'nao devolveu o ID');
  } finally {
    espiao.restaurar();
  }
});
