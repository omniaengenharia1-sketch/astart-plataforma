// O Chromium deste ambiente.
//
// O playwright-core procura um numero de build exato e, quando a imagem traz
// outro, morre pedindo `npx playwright install` — que nao e o que queremos
// (baixar 150 MB a cada container). Entao achamos o binario que existe.
//
// A ordem: CHROME no ambiente, depois o que estiver em PLAYWRIGHT_BROWSERS_PATH,
// depois nada — e aí o playwright usa o caminho dele e falha com a mensagem
// dele, que e melhor que uma nossa.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

function acharChrome() {
  if (process.env['CHROME'] && existsSync(process.env['CHROME'])) return process.env['CHROME'];

  const raiz = process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? '/opt/pw-browsers';
  if (!existsSync(raiz)) return undefined;

  const candidatos = readdirSync(raiz)
    .filter((d) => d.startsWith('chromium') && !d.includes('headless'))
    .sort()
    .reverse()
    .map((d) => join(raiz, d, 'chrome-linux', 'chrome'));

  return candidatos.find((c) => existsSync(c));
}

export async function abrirNavegador() {
  const executablePath = acharChrome();
  return chromium.launch({
    args: ['--no-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  });
}
