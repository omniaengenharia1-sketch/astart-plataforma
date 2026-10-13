/**
 * CORS para as funções que o NAVEGADOR chama.
 *
 * Isto faltava inteiro, e o primeiro convite de verdade descobriu: a tela
 * mostrou "Failed to send a request to the Edge Function", que não é erro da
 * função — é a chamada não chegar nela. O preflight `OPTIONS` voltava 405 sem
 * nenhum `Access-Control-Allow-Origin`, e o navegador bloqueava o POST antes de
 * sair.
 *
 * Por que 22 testes de banco e 12 roteiros de tela não pegaram: eu testei as
 * funções com `curl`, e curl não aplica regra de CORS — manda o POST direto,
 * sem preflight. Os roteiros abrem navegador de verdade, mas nenhum deles
 * clicava em algo que chamasse Edge Function. Cada caminho de verificação
 * estava cego justamente onde o outro veria.
 *
 * ---
 *
 * Lista de origens, não `*`.
 *
 * Com `*` qualquer site do mundo poderia fazer o navegador de quem está logado
 * bater aqui. O token vai no cabeçalho `Authorization`, que um site de fora não
 * consegue preencher, então o estrago direto é pequeno — mas "pequeno" não é
 * motivo para abrir, e a `galeria` e a `aprovar` são abertas por token, onde o
 * raciocínio não se repete.
 *
 * As origens são públicas (o endereço do site é público), então ficam no
 * código em vez de em variável de ambiente. Esta sessão já mostrou que o passo
 * de configuração manual é a parte caraa: uma variável esquecida no painel
 * seria exatamente este bug de novo, só mais difícil de achar.
 */
const EXATAS = new Set([
  'https://astart-plataforma.pages.dev',
  // Desenvolvimento: `npm run dev` e as prévias estáticas dos roteiros.
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4178',
  'http://127.0.0.1:4178',
  'http://localhost:4179',
  'http://127.0.0.1:4179',
]);

/**
 * As prévias do Cloudflare Pages nascem com subdomínio aleatório
 * (`a1b2c3d4.astart-plataforma.pages.dev`). São o MESMO código, na mesma conta,
 * então liberar o padrão é honesto — e sem isso toda prévia de branch vira um
 * bug de CORS que ninguém entende.
 */
const PREVIA = /^https:\/\/[a-z0-9-]+\.astart-plataforma\.pages\.dev$/;

export function origemPermitida(req: Request): string | null {
  const origem = req.headers.get('Origin');
  if (!origem) return null; // Sem Origin não é navegador: cron, curl, servidor.
  if (EXATAS.has(origem)) return origem;
  return PREVIA.test(origem) ? origem : null;
}

export function cabecalhosCors(origem: string | null): Record<string, string> {
  if (!origem) return {};
  return {
    'access-control-allow-origin': origem,
    // `Vary` não é detalhe: sem ele um cache intermediário pode servir a
    // resposta de uma origem para outra, e aí a liberação vaza.
    vary: 'Origin',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
  };
}

/**
 * Responde o preflight. Origem de fora da lista recebe 403 SEM os cabeçalhos
 * — o navegador bloqueia, que é o certo, e quem está depurando vê 403 em vez
 * de um erro genérico de rede.
 */
export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  const origem = origemPermitida(req);
  return origem
    ? new Response(null, { status: 204, headers: cabecalhosCors(origem) })
    : new Response(null, { status: 403 });
}
