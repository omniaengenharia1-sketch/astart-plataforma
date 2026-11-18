/**
 * Teste de unidade do adaptador da Página do Facebook.
 *
 * O adaptador do Instagram tem um porque os dois erros que ele pagou — formato
 * oferecido e não implementado, token indo para o log — não eram erros de
 * tipo e não apareciam numa chamada bem-sucedida. Este arquivo existe pelo
 * mesmo motivo, e tem um a mais: a Página NÃO é o Instagram com outro
 * endereço, e tudo que é diferente nela é diferente em silêncio.
 *
 * O que se cobra aqui, e por quê:
 *
 *   1. O TOKEN DA PÁGINA é buscado e é ELE que assina a publicação. Usar o
 *      token do System User direto nos endpoints da Página devolve erro da
 *      Meta no meio da madrugada, e o `deno check` não vê diferença entre as
 *      duas strings.
 *   2. A ORDEM das fotos é a ordem do post. Trocar `for` por `Promise.all`
 *      continua compilando e embaralha o álbum do cliente.
 *   3. `publicar` SEM LEGENDA é recusado. Esta é a diferença estrutural com
 *      o Instagram: lá a legenda viajou junto na criação do container; aqui o
 *      post nasce na hora de publicar. Se alguém chamar sem passar a legenda,
 *      o post sai MUDO na conta de um cliente — e nada na assinatura obriga a
 *      passar, porque o parâmetro é opcional (o Instagram ignora).
 *   4. Vídeo é recusado, com o motivo escrito.
 *   5. A reconciliação descarta post NÃO publicado. `/feed` devolve os dois,
 *      e dar por publicado o que não saiu é o erro mais caro desta função.
 *
 * Roda com:  deno test --allow-env supabase/functions/_shared/meta/facebook.test.ts
 */
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { adaptadorFacebook } from './facebook.ts';
import type { ContextoConta } from '../tipos.ts';
import type { MidiaEntrada } from '../adaptador.ts';

Deno.env.set('META_API_VERSION', 'v26.0');

const TOKEN_AGENCIA = 'TOKEN-DO-SYSTEM-USER-DA-ASTART';
const TOKEN_PAGINA = 'TOKEN-DA-PAGINA-DO-CLIENTE';

const CTX: ContextoConta = {
  conta_social_id: 'conta-1',
  plataforma: 'facebook',
  ig_user_id: null,
  page_id: '778899',
  access_token: TOKEN_AGENCIA,
};

function midia(ordem: number, mime = 'image/jpeg'): MidiaEntrada {
  return {
    ordem,
    url: `https://exemplo/${ordem}.jpg`,
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
// 1 e 2. O token da Página, e a ordem das fotos
// ---------------------------------------------------------------------------
Deno.test('album: busca o token da Pagina e sobe as fotos na ordem, desligadas', async () => {
  const espiao = espiar([
    { access_token: TOKEN_PAGINA },
    { id: 'foto-A' },
    { id: 'foto-B' },
    { id: 'foto-C' },
  ]);
  try {
    const r = await adaptadorFacebook.criarContainer(CTX, {
      tipo: 'carrossel',
      legenda: 'uma legenda',
      // Fora de ordem de proposito: quem ordena e o adaptador.
      midias: [midia(2), midia(0), midia(1)],
    });

    // A primeira chamada pergunta o token da Pagina, com o token da agencia.
    assertStringIncludes(espiao.pedidos[0]!.url, '/778899');
    assertStringIncludes(espiao.pedidos[0]!.url, 'fields=access_token');

    const envios = espiao.pedidos.slice(1);
    assertEquals(envios.length, 3, 'uma chamada por foto');

    for (const p of envios) {
      assertStringIncludes(p.url, '/778899/photos');
      assertEquals(p.corpo['published'], 'false', 'a foto nasce desligada');
      // O TOKEN CERTO. Com o da agencia a Meta recusa, e nada aqui falha
      // antes de chegar nela.
      assertEquals(p.corpo['access_token'], TOKEN_PAGINA);
    }

    // A ORDEM. `[2,0,1]` entra e tem de sair ordenado — e a ordem das fotos
    // no post do cliente.
    assertEquals(envios.map((p) => p.corpo['url']), [
      'https://exemplo/0.jpg',
      'https://exemplo/1.jpg',
      'https://exemplo/2.jpg',
    ]);

    assertEquals(r.containerId, 'foto-A,foto-B,foto-C');
    assertEquals(r.aguardarProcessamento, false, 'foto nao processa como video');
  } finally {
    espiao.restaurar();
  }
});

// ---------------------------------------------------------------------------
// 3. A diferença estrutural com o Instagram
// ---------------------------------------------------------------------------
Deno.test('publicar manda message e attached_media na ordem, com o token da Pagina', async () => {
  const espiao = espiar([{ access_token: TOKEN_PAGINA }, { id: 'post-1' }]);
  try {
    const r = await adaptadorFacebook.publicar(CTX, 'foto-A,foto-B', {
      legenda: 'bom dia',
    });

    const envio = espiao.pedidos[1]!;
    assertStringIncludes(envio.url, '/778899/feed');
    assertEquals(envio.corpo['message'], 'bom dia');
    assertEquals(envio.corpo['attached_media[0]'], '{"media_fbid":"foto-A"}');
    assertEquals(envio.corpo['attached_media[1]'], '{"media_fbid":"foto-B"}');
    assertEquals(envio.corpo['access_token'], TOKEN_PAGINA);
    assertEquals(r.mediaId, 'post-1');
  } finally {
    espiao.restaurar();
  }
});

Deno.test('publicar SEM legenda e recusado, em vez de sair um post mudo', async () => {
  const espiao = espiar([{ access_token: TOKEN_PAGINA }, { id: 'post-1' }]);
  try {
    // O parametro e opcional na interface porque o Instagram o ignora. Esta e
    // a unica coisa que impede um post vazio na conta de um cliente.
    const msg = await recusa(() => adaptadorFacebook.publicar(CTX, 'foto-A'));
    assertStringIncludes(msg, 'legenda');
  } finally {
    espiao.restaurar();
  }
});

// ---------------------------------------------------------------------------
// 4. O que o adaptador ainda não faz, ele recusa dizendo por quê
// ---------------------------------------------------------------------------
Deno.test('reel na Pagina e recusado, falando de protocolo', async () => {
  const espiao = espiar([{ access_token: TOKEN_PAGINA }]);
  try {
    const msg = await recusa(() =>
      adaptadorFacebook.criarContainer(CTX, {
        tipo: 'reel',
        legenda: '',
        midias: [midia(0, 'video/mp4')],
      })
    );
    assertStringIncludes(msg, 'protocolo');
    assertEquals(espiao.pedidos.length, 0, 'recusa ANTES de gastar chamada na Meta');
  } finally {
    espiao.restaurar();
  }
});

Deno.test('imagem que nao e JPEG e recusada', async () => {
  const espiao = espiar([{ access_token: TOKEN_PAGINA }]);
  try {
    const msg = await recusa(() =>
      adaptadorFacebook.criarContainer(CTX, {
        tipo: 'imagem',
        legenda: '',
        midias: [midia(0, 'image/png')],
      })
    );
    assertStringIncludes(msg, 'JPEG');
  } finally {
    espiao.restaurar();
  }
});

Deno.test('conta sem page_id e recusada dizendo o que falta', async () => {
  const msg = await recusa(() =>
    adaptadorFacebook.criarContainer(
      { ...CTX, page_id: null },
      { tipo: 'imagem', legenda: '', midias: [midia(0)] },
    )
  );
  assertStringIncludes(msg, 'page_id');
});

Deno.test('Pagina que o usuario do sistema nao alcanca diz o que fazer', async () => {
  // A Meta responde 200 e SEM o campo quando o ativo nao esta atribuido.
  // "undefined" no lugar do token nao ajuda ninguem.
  const espiao = espiar([{ id: '778899' }]);
  try {
    const msg = await recusa(() =>
      adaptadorFacebook.criarContainer(CTX, { tipo: 'imagem', legenda: '', midias: [midia(0)] })
    );
    assertStringIncludes(msg, 'ativo');
  } finally {
    espiao.restaurar();
  }
});

// ---------------------------------------------------------------------------
// 5. A reconciliação não pode dar por publicado o que não saiu
// ---------------------------------------------------------------------------
Deno.test('reconciliacao descarta post nao publicado e post velho', async () => {
  const agora = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  const espiao = espiar([
    { access_token: TOKEN_PAGINA },
    {
      data: [
        { id: 'novo-publicado', created_time: iso(agora), is_published: true },
        { id: 'novo-NAO-publicado', created_time: iso(agora), is_published: false },
        { id: 'velho', created_time: iso(agora - 3 * 3600_000), is_published: true },
      ],
    },
  ]);
  try {
    const { candidatos } = await adaptadorFacebook.midiasPublicadasApos(
      CTX,
      new Date(agora - 60_000),
    );
    assertEquals(candidatos.map((c) => c.id), ['novo-publicado']);
  } finally {
    espiao.restaurar();
  }
});

Deno.test('a Pagina nao tem cota, e isso e "nao existe", nao "nao sei"', async () => {
  const cota = await adaptadorFacebook.consultarCota(CTX);
  // `total = 0` e o combinado com o worker: ele so barra quando `total > 0`.
  assertEquals(cota.total, 0);
  assert(cota.registros.length === 0, 'e nao gasta chamada na Meta para descobrir isso');
});
