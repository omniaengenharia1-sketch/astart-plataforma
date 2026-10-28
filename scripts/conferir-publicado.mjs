#!/usr/bin/env node
// O que está no ar é o que está na `main`?
//
// Esta pergunta me custou duas horas e a confiança da dona num mesmo dia. O
// build de produção é `npm run build`, que começa com `tsc -b`; eu vinha
// conferindo com `tsc --noEmit`, que usa outro escopo de projeto e passava.
// O `tsc -b` falhava com sete erros de tipo, o Cloudflare Pages abortava cada
// build em silêncio, e QUATRO commits ficaram só no repositório. Enquanto isso
// eu dizia "subi, pode testar", e ela testava o código velho e via o mesmo
// defeito — três vezes seguidas.
//
// A esteira do GitHub não cobre isto: ela publica as funções e as migrations,
// mas quem constrói o site é o Cloudflare, fora do alcance dela. Por isso o
// `conferir-esteiras.mjs` dizia verde com o site parado duas horas atrás.
//
// O `prerender.mjs` carimba o commit no `index.html`. Aqui se compara.
//
//   node scripts/conferir-publicado.mjs
//
// Sai 1 quando o site está atrasado — e aí "subi" é mentira, por mais que o
// push tenha funcionado.
import { execFileSync } from 'node:child_process';

const SITE = process.env['SITE'] ?? 'https://astart-plataforma.pages.dev';
const RAMO = process.env['RAMO'] ?? 'main';

const naMain = execFileSync('git', ['rev-parse', `origin/${RAMO}`], { encoding: 'utf8' }).trim();

const html = await fetch(SITE, { headers: { 'cache-control': 'no-cache' } }).then((r) => {
  if (!r.ok) throw new Error(`o site respondeu ${r.status}`);
  return r.text();
});

const noAr = /<meta\s+name="versao"\s+content="([a-f0-9]{7,40})"/.exec(html)?.[1] ?? null;

console.log(`site:  ${SITE}`);
console.log(`na main:    ${naMain.slice(0, 12)}`);
console.log(`publicado:  ${noAr ? noAr.slice(0, 12) : '(sem marca de versão)'}`);

if (!noAr) {
  console.log(
    '\nO site publicado não tem marca de versão. Ou o build é anterior a ela, ou o\n' +
      'Cloudflare não está rodando `npm run build` — confira em Settings > Builds.',
  );
  process.exit(1);
}

if (!naMain.startsWith(noAr) && !noAr.startsWith(naMain.slice(0, noAr.length))) {
  // Quantos commits de atraso, para a frase dizer o tamanho do buraco.
  let atraso = '';
  try {
    const n = execFileSync('git', ['rev-list', '--count', `${noAr}..origin/${RAMO}`], {
      encoding: 'utf8',
    }).trim();
    atraso = ` — ${n} commit(s) atrás`;
  } catch {
    atraso = '';
  }
  console.log(`\nO SITE ESTÁ ATRASADO${atraso}.`);
  console.log(
    'Rode `npm run build` dentro de `plataforma/` para ver o erro que o Cloudflare\n' +
      'está vendo. `tsc --noEmit` NÃO serve: o build usa `tsc -b`, que lê outro\n' +
      'escopo de projeto e reprova coisas que o outro deixa passar.',
  );
  process.exit(1);
}

console.log('\nO que está no ar é o que está na main.');
