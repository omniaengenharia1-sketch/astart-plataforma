#!/usr/bin/env node
// Prova que as três páginas públicas chegam COM TEXTO para quem não roda
// JavaScript — que é exatamente quem decide a homologação.
//
// Este prover existe porque o defeito que ele cobra passou por tudo. As três
// URLs respondiam 200, abriam bonitas no navegador, e os quinze roteiros de
// tela liam o texto inteiro — porque roteiro de tela usa Playwright, e
// Playwright roda JavaScript. Um `curl` nas mesmas URLs trazia 1.115 bytes de
// casca e **19 caracteres de texto**: só o `<title>`.
//
// A checagem automática da Meta no App Review faz o `curl`, não abre navegador.
// "Política de privacidade vazia" é dos motivos mais citados de reprovação.
//
// Então aqui não há navegador de propósito. É `fetch` puro, sem JavaScript, sem
// cookie, sem sessão — a visão de um robô. A verificação tem de ser tão
// exigente quanto a realidade, e a realidade aqui é um GET simples.
//
//   node provar-politicas.mjs                        # o site publicado
//   BASE=http://localhost:4178 node provar-politicas.mjs   # um preview local
//
// Roda sozinho (não entra no `rodar-telas.sh`): depende de rede e de deploy, e
// misturar os dois faria uma falha de internet parecer defeito de tela.

const BASE = (process.env['BASE'] ?? 'https://astart-plataforma.pages.dev').replace(/\/$/, '');

// O endereço para onde o titular dos dados — e o revisor da Meta — escrevem.
//
// Escrito à mão aqui, e não lido do `Politicas.tsx`, de propósito: prover que lê
// o valor da fonte que está conferindo não prova nada, ele só confirma que a
// fonte é igual a si mesma. Trocar o endereço passa a exigir mexer nos dois,
// que é exatamente a fricção que se quer.
//
// Existe porque o endereço anterior (`contato@`) era um palpite meu, escrito à
// mão em quatro lugares. Endereço errado numa política promete um canal que não
// existe.
const CONTATO = 'projetos@astartstudio.com.br';

// Espelha `src/prerender.tsx`. Pouca coisa e de propósito: o que esta lista
// cobra é "chegou texto com o título certo", não o texto inteiro — senão
// corrigir uma vírgula na política quebraria o prover.
const PAGINAS = [
  { caminho: 'privacidade', titulo: 'Política de privacidade' },
  { caminho: 'termos', titulo: 'Termos de uso' },
  { caminho: 'exclusao-de-dados', titulo: 'Exclusão de dados' },
];

const falhas = [];
const cobrar = (ok, o) => {
  if (!ok) falhas.push(o);
  console.log(`${ok ? 'OK  ' : 'FALHOU  '}${o}`);
};

const soTexto = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

console.log(`conferindo ${BASE} sem navegador e sem JavaScript\n`);

for (const p of PAGINAS) {
  const url = `${BASE}/${p.caminho}`;
  let r;
  let html = '';
  try {
    r = await fetch(url, { redirect: 'follow' });
    html = await r.text();
  } catch (e) {
    cobrar(false, `${p.caminho}: nem respondeu (${e instanceof Error ? e.message : e})`);
    continue;
  }

  cobrar(r.status === 200, `${p.caminho}: responde 200 (veio ${r.status})`);

  const texto = soTexto(html);
  // 800 caracteres separa prosa de casca com folga: a casca da SPA dava 19, e a
  // menor das três páginas dá ~1.340.
  cobrar(
    texto.length > 800,
    `${p.caminho}: chega com texto, nao com casca (${texto.length} caracteres)`,
  );
  cobrar(texto.includes(p.titulo), `${p.caminho}: o texto traz "${p.titulo}"`);
  // O endereço EXATO, não "existe um mailto". A versão frouxa passaria com um
  // endereço errado, que é o estado em que estas páginas ficaram por dias.
  cobrar(
    html.includes(`mailto:${CONTATO}`) && texto.includes(CONTATO),
    `${p.caminho}: o contato e ${CONTATO}, clicavel e escrito`,
  );
  cobrar(
    !/contato@astartstudio/.test(html),
    `${p.caminho}: o endereco antigo (palpite) sumiu da pagina`,
  );
  // O revisor da Meta precisa do aviso de que a plataforma publica em nome do
  // cliente. Se este trecho sumir da política, some o motivo de ela existir.
  if (p.caminho === 'privacidade') {
    cobrar(
      /token/i.test(texto) && /Meta/.test(texto),
      'privacidade: continua dizendo que guarda token e publica pela Meta',
    );
  }
}

// E a plataforma em si continua de pé: um prover que só olha as três páginas
// não notaria o site inteiro fora do ar.
try {
  const r = await fetch(`${BASE}/`, { redirect: 'follow' });
  cobrar(r.status === 200, `a plataforma responde na raiz (${r.status})`);
} catch (e) {
  cobrar(false, `a raiz nem respondeu (${e instanceof Error ? e.message : e})`);
}

if (falhas.length > 0) {
  console.log(`\nPROBLEMAS (${falhas.length}):\n${falhas.join('\n')}`);
  console.log(
    '\nSe o texto nao chega, o build publicado nao rodou o `prerender.mjs`. ' +
      'Confira que o comando de build do Cloudflare Pages e `npm run build` ' +
      '(e nao `vite build` sozinho) e publique de novo.',
  );
  process.exit(1);
}
console.log('\nAs tres paginas publicas chegam com texto, sem depender de JavaScript.');
