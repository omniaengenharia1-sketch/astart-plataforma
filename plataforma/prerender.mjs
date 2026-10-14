#!/usr/bin/env node
// Escreve as três páginas públicas como HTML estático, depois do `vite build`.
//
// Por que existe: as três URLs que a Meta vai conferir respondiam 200 com
// **19 caracteres de texto** — só o `<title>`. O conteúdo é React, e React
// precisa de JavaScript. Abrir no navegador mostrava a política inteira; um GET
// simples mostrava uma página em branco. Quem faz o GET é a checagem automática
// do App Review. Ver o cabeçalho de `src/prerender.tsx`.
//
// Como funciona: um build SSR separado só da `src/prerender.tsx`, que devolve o
// markup das três páginas; o markup entra no `dist/index.html` já construído
// (que é onde moram os endereços do CSS e da fonte) e sai como
// `dist/<caminho>.html`. O Pages casa a rota com o arquivo antes de cair no
// `/* /index.html 200` do `_redirects`, então `/privacidade` passa a devolver a
// política em vez da casca da SPA.
//
// Arquivo solto e não `<caminho>/index.html` de propósito: o Pages serve arquivo
// solto sem barra no fim e índice de pasta com barra. As três URLs já estão
// escritas sem barra no `docs/homologacao-meta.md` e vão para o painel da Meta,
// então assim elas entregam a página direto, sem um 301 no caminho.
//
// O JavaScript continua carregando por cima: `createRoot` substitui o conteúdo
// e a página fica igual à de antes para quem usa navegador. O que muda é que
// agora o texto chega mesmo sem ele.
//
// NO FIM ELE CONFERE O QUE ESCREVEU. Gerador que não relê o arquivo é gerador
// que um dia escreve casca vazia e ninguém vê — foi exatamente assim que este
// defeito nasceu.
//
//   node prerender.mjs            # depois do vite build
//   npm run build                 # faz os dois
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const DIST = join(RAIZ, 'dist');
const TEMP = join(RAIZ, '.prerender');

const falhas = [];
const cobrar = (ok, o) => {
  if (!ok) falhas.push(o);
  console.log(`${ok ? 'OK  ' : 'FALHOU  '}${o}`);
};

// --- 1. o markup -----------------------------------------------------------
execFileSync(
  'npx',
  ['vite', 'build', '--ssr', 'src/prerender.tsx', '--outDir', '.prerender', '--logLevel', 'warn'],
  { cwd: RAIZ, stdio: 'inherit' },
);

const { paginas } = await import(join(TEMP, 'prerender.js'));
const lista = paginas();

// --- 2. a casca ------------------------------------------------------------
const casca = readFileSync(join(DIST, 'index.html'), 'utf8');

// Se a casca mudar de forma, isto para aqui em vez de escrever três arquivos
// sem conteúdo — que é o estado que este script existe para consertar.
if (!casca.includes('<div id="root"></div>')) {
  console.error(
    'FALHOU: nao achei <div id="root"></div> no dist/index.html. ' +
      'O prerender nao sabe onde por o conteudo — conserte este script antes de publicar.',
  );
  process.exit(1);
}

// --- 3. os arquivos --------------------------------------------------------
for (const p of lista) {
  const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const html = casca
    .replace('<div id="root"></div>', `<div id="root">${p.html}</div>`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapar(p.titulo)}</title>`)
    // A descrição da casca é a da plataforma inteira; aqui ela vira a da página,
    // que é o que aparece em busca e em pré-visualização de link.
    .replace(
      /<meta\s+name="description"[\s\S]*?\/>/,
      `<meta name="description" content="${escapar(p.descricao)}" />`,
    );

  writeFileSync(join(DIST, `${p.caminho}.html`), html);
}

rmSync(TEMP, { recursive: true, force: true });

// --- 4. e a conferência, relendo o que foi escrito -------------------------
console.log();
cobrar(lista.length === 3, `as tres paginas publicas foram geradas (${lista.length})`);

for (const p of lista) {
  const arquivo = join(DIST, `${p.caminho}.html`);
  let html;
  try {
    html = readFileSync(arquivo, 'utf8');
  } catch {
    cobrar(false, `${p.caminho}: o arquivo nem existe`);
    continue;
  }

  // Texto, não bytes: a casca sozinha já tem mais de mil bytes de `<head>`.
  const texto = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 800 caracteres separa prosa de casca com folga para os dois lados: a casca
  // vazia dava 19, e a menor das três páginas (exclusão de dados) dá ~1.340.
  // Limiar colado no tamanho atual quebraria ao cortar um parágrafo; limiar alto
  // demais reprovaria a página curta que está certa.
  cobrar(
    texto.length > 800,
    `${p.caminho}: tem texto de verdade sem JavaScript (${texto.length} caracteres)`,
  );
  cobrar(html.includes(p.prova), `${p.caminho}: o titulo da pagina aparece no corpo ("${p.prova}")`);
  cobrar(
    html.includes(`<title>${p.titulo}</title>`),
    `${p.caminho}: o <title> e o da pagina, nao o da plataforma`,
  );
  cobrar(
    html.includes('/assets/') && html.includes('.css'),
    `${p.caminho}: continua com o CSS da plataforma`,
  );
  // O endereço de contato é o que a Meta usa para falar com a agência. Página de
  // política sem para onde escrever é motivo de reprovação por si só.
  cobrar(
    /mailto:[^"']+@/.test(html),
    `${p.caminho}: tem endereco de contato clicavel`,
  );
}

if (falhas.length > 0) {
  console.log(`\nPROBLEMAS (${falhas.length}):\n${falhas.join('\n')}`);
  process.exit(1);
}
console.log(`\nAs tres paginas publicas saem em HTML, sem depender de JavaScript.`);
