// Prova o CORS das Edge Functions publicadas, do jeito que o NAVEGADOR cobra.
//
// Este verificador existe porque eu testei as cinco funções com `curl` e disse
// que estavam no ar — e estavam. Só que curl não aplica regra de CORS: manda o
// POST direto, sem preflight. O primeiro convite de verdade, de um navegador
// real, mostrou "Failed to send a request to the Edge Function", que não é
// erro da função: é a chamada não chegar nela.
//
// Então aqui o preflight é feito de propósito, com Origin, como o navegador
// faz antes de qualquer POST que leve cabeçalho de autorização.
//
// Uso:  node scripts/provar-cors.mjs [projeto-ref]
const REF = process.argv[2] ?? process.env['SUPABASE_PROJECT_REF'] ?? 'tcgffzkvhyrvttshyhty';
const BASE = `https://${REF}.supabase.co/functions/v1`;

const NOSSA = 'https://astart-plataforma.pages.dev';
const PREVIA = 'https://a1b2c3d4.astart-plataforma.pages.dev';
const LOCAL = 'http://localhost:5173';
const DE_FORA = 'https://site-que-nao-e-nosso.example.com';

// As duas de fundo NÃO levam CORS, e é deliberado: quem as chama é o pg_cron,
// com o cabeçalho x-tick-secret. Navegador nenhum fala com elas, então abrir
// CORS ali seria superfície sem uso — e superfície sem uso é o que ninguém
// revisa depois.
const DO_NAVEGADOR = ['convidar', 'aprovar', 'galeria'];
const DO_CRON = ['publicar-tick', 'renovar-tokens'];

const falhas = [];
const cobrar = (ok, o) => {
  if (!ok) falhas.push(o);
  console.log(`${ok ? 'OK  ' : 'FALHOU  '}${o}`);
};

async function preflight(fn, origem) {
  const r = await fetch(`${BASE}/${fn}`, {
    method: 'OPTIONS',
    headers: {
      Origin: origem,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,apikey,x-client-info',
    },
  });
  return { status: r.status, permite: r.headers.get('access-control-allow-origin'), vary: r.headers.get('vary') };
}

for (const fn of DO_NAVEGADOR) {
  for (const [rotulo, origem] of [['o site', NOSSA], ['uma prévia', PREVIA], ['o localhost', LOCAL]]) {
    const r = await preflight(fn, origem);
    cobrar(
      r.status === 204 && r.permite === origem,
      `${fn}: ${rotulo} passa o preflight (http ${r.status}, allow-origin ${r.permite ?? 'nenhum'})`,
    );
    // Sem `Vary: Origin` um cache pode servir a liberação de uma origem para
    // outra, e aí a lista deixa de valer.
    cobrar(
      (r.vary ?? '').toLowerCase().includes('origin'),
      `${fn}: a resposta varia por Origin (vary: ${r.vary ?? 'nenhum'})`,
    );
  }

  const fora = await preflight(fn, DE_FORA);
  cobrar(
    fora.permite === null,
    `${fn}: site de fora NAO recebe liberacao (http ${fora.status}, allow-origin ${fora.permite ?? 'nenhum'})`,
  );
}

for (const fn of DO_CRON) {
  const r = await preflight(fn, NOSSA);
  cobrar(
    r.permite === null,
    `${fn}: segue sem CORS, porque navegador nenhum a chama (allow-origin ${r.permite ?? 'nenhum'})`,
  );
}

// E a prova de que as funções continuam RESPONDENDO, não só liberando: cada uma
// recusa um pedido inválido com a própria mensagem, em vez do 404 do gateway.
for (const [fn, espera] of [
  ['aprovar', 404],
  ['galeria', 404],
  ['convidar', 401],
]) {
  const r = await fetch(`${BASE}/${fn}`, {
    method: 'POST',
    headers: { Origin: NOSSA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ acao: 'abrir', token: 'invalido' }),
  });
  const corpo = await r.text();
  cobrar(
    r.status === espera && corpo.includes('erro') && r.headers.get('access-control-allow-origin') === NOSSA,
    `${fn}: recusa com a propria mensagem E com CORS (http ${r.status})`,
  );
}

console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nCORS conferido nas cinco.');
process.exit(falhas.length ? 1 : 0);
