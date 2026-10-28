// O Chromium deste ambiente.
//
// O playwright-core procura um numero de build exato e, quando a imagem traz
// outro, morre pedindo `npx playwright install` — que nao e o que queremos
// (baixar 150 MB a cada container). Entao achamos o binario que existe.
//
// A ordem: CHROME no ambiente, depois o que estiver em PLAYWRIGHT_BROWSERS_PATH,
// depois nada — e aí o playwright usa o caminho dele e falha com a mensagem
// dele, que e melhor que uma nossa.
import { readdirSync, existsSync, readFileSync } from 'node:fs';
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

/**
 * O `vite preview` esta servindo o build que esta no disco?
 *
 * ELE GUARDA O `index.html` EM MEMORIA NA PARTIDA. Quem roda `npm run build` e
 * depois um roteiro, sem reiniciar o preview, testa o bundle ANTERIOR — a
 * pagina abre, a tela parece certa, e o roteiro fica verde contra codigo que
 * nao existe mais.
 *
 * Isto nao e teoria. Aconteceu duas vezes no mesmo dia:
 *
 *   · quinze roteiros verdes enquanto o `npm run build` estava vermelho, e
 *     quatro commits nunca chegaram em producao;
 *   · o roteiro da galeria passou com o conserto do download REMOVIDO de
 *     proposito, e eu quase concluí que a verificacao nova nao servia —
 *     quando o que nao servia era o servidor.
 *
 * Disciplina ("lembrar de reiniciar") ja falhou duas vezes. Entao a conta e
 * feita aqui: o nome do bundle que o servidor entrega contra o que o
 * `dist/index.html` aponta. Sao hashes do conteudo, logo diferentes = codigo
 * diferente.
 *
 * Servidor que nao responde nao e tratado como erro: ha roteiro que nao usa
 * preview, e quem precisa dele falha sozinho ao navegar.
 */
async function conferirPreview() {
  if (!existsSync('dist/index.html')) return;

  const bundle = (html) => html.match(/src="([^"]*\.js)"/)?.[1] ?? null;
  const noDisco = bundle(readFileSync('dist/index.html', 'utf8'));
  if (!noDisco) return;

  let servido;
  try {
    const r = await fetch('http://localhost:4178/', { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return;
    servido = bundle(await r.text());
  } catch {
    return;
  }
  if (!servido || servido === noDisco) return;

  console.log(
    'PARE: o preview esta servindo um build velho.\n' +
      `  o servidor entrega  ${servido}\n` +
      `  o disco tem         ${noDisco}\n` +
      'Reinicie o `vite preview` depois do build. Rodar assim testa o codigo anterior.',
  );
  process.exit(1);
}

export async function abrirNavegador() {
  await conferirPreview();
  const executablePath = acharChrome();
  return chromium.launch({
    args: ['--no-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  });
}
