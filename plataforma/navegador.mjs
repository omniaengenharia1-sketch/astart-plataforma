// O Chromium deste ambiente.
//
// O playwright-core procura um numero de build exato e, quando a imagem traz
// outro, morre pedindo `npx playwright install` — que nao e o que queremos
// (baixar 150 MB a cada container). Entao achamos o binario que existe.
//
// A ordem: CHROME no ambiente, depois o que estiver em PLAYWRIGHT_BROWSERS_PATH,
// depois nada — e aí o playwright usa o caminho dele e falha com a mensagem
// dele, que e melhor que uma nossa.
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

function acharChrome() {
  if (process.env['CHROME'] && existsSync(process.env['CHROME'])) return process.env['CHROME'];

  const raiz = process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? '/opt/pw-browsers';
  if (!existsSync(raiz)) return undefined;

  // `chrome-linux` E `chrome-linux64`: a pasta muda entre versoes da imagem.
  //
  // Estava fixo em `chrome-linux`, e um contêiner novo trouxe `chrome-linux64`
  // — todos os roteiros morreram de uma vez com a mensagem do Playwright
  // pedindo `npx playwright install`, que e o conselho errado aqui: o
  // navegador existe, so nao esta onde este arquivo procurava.
  const pastas = ['chrome-linux64', 'chrome-linux', 'chrome-headless-shell-linux64'];
  const candidatos = readdirSync(raiz)
    .filter((d) => d.startsWith('chromium') && !d.includes('headless'))
    .sort()
    .reverse()
    .flatMap((d) => pastas.map((sub) => join(raiz, d, sub, 'chrome')));

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
/**
 * O `dist` e mais novo que o codigo-fonte?
 *
 * O buraco que esta funcao fecha: a conferencia de baixo compara o que o
 * servidor entrega com o que o `dist` aponta. Quando o BUILD FALHA, nenhum dos
 * dois se move — e os dois concordam, em cima do bundle anterior. O roteiro
 * fica verde contra codigo que nunca compilou.
 *
 * Nao e teoria, de novo: foi o que aconteceu ao sabotar a lista "sem data
 * marcada" de proposito para provar que o roteiro do comercial morde. O
 * typecheck recusou a sabotagem, o `&&` cortou o resto da linha, o preview
 * velho continuou no ar, e o roteiro imprimiu "tudo o que foi checado passou".
 * A sabotagem nao chegou a existir, mas o aviso tambem nao — e no dia em que a
 * sabotagem compilar, o verde vai estar mentindo.
 *
 * Entao: o arquivo mais novo em `src`, mais o `index.html` e as configuracoes
 * de build, contra o `dist/index.html`. Fonte mais nova = build velho.
 */
function conferirIdade() {
  const nascimento = (p) => (existsSync(p) ? statSync(p).mtimeMs : 0);

  const maisNovo = (dir) => {
    let q = 0;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, e.name);
      q = Math.max(q, e.isDirectory() ? maisNovo(caminho) : nascimento(caminho));
    }
    return q;
  };

  const dist = nascimento('dist/index.html');
  if (!dist) return;

  const fonte = Math.max(
    existsSync('src') ? maisNovo('src') : 0,
    ...['index.html', 'vite.config.ts', 'tailwind.config.ts', 'package.json'].map(nascimento),
  );
  // Um segundo de folga: build e escrita de arquivo nao sao instantaneos.
  if (fonte <= dist + 1000) return;

  const atraso = Math.round((fonte - dist) / 1000);
  console.log(
    'PARE: o `dist` e mais velho que o codigo-fonte.\n' +
      `  a fonte mudou ${atraso}s depois do ultimo build\n` +
      'O build provavelmente FALHOU (typecheck?). Rode `npm run build:exemplo` e\n' +
      'leia a saida: rodar assim testa o bundle anterior e fica verde de mentira.',
  );
  process.exit(1);
}

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
  conferirIdade();
  await conferirPreview();
  const executablePath = acharChrome();
  return chromium.launch({
    args: ['--no-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  });
}

/**
 * Espera as animacoes TERMINAREM — nao um tanto de milissegundos.
 *
 * O defeito que trouxe isto: o roteiro de arquivos trocava o tema, esperava
 * 250ms fixos e mandava o axe medir contraste. As animacoes da interface duram
 * 320ms e 520ms. Quando a troca demorava um pouco mais, o axe media a cor NO
 * MEIO da transicao, quando ela ainda nao e a cor final — e acusava contraste
 * insuficiente numa tela que, parada, passa.
 *
 * Falhou uma vez em quatro execucoes. Era facil chamar de azar, e azar nao e
 * diagnostico: um teste que reprova as vezes ensina a equipe a rodar de novo
 * ate passar, e esse habito e o que deixa defeito de verdade entrar.
 *
 * Aumentar o numero so empurraria o problema para a proxima maquina lenta. O
 * conserto e esperar a CONDICAO: `document.getAnimations()` devolve o que esta
 * correndo agora, e `finished` resolve quando cada uma acaba.
 *
 * As infinitas ficam de fora de proposito — a classe `piscando` do "carregando"
 * nunca termina, e esperar por ela travaria o roteiro para sempre.
 */
export async function esperarAnimacoes(pagina, limiteMs = 3000) {
  await pagina.evaluate(async (limite) => {
    const correndo = document.getAnimations().filter((a) => {
      try {
        return a.effect?.getTiming().iterations !== Infinity;
      } catch {
        return false;
      }
    });
    if (correndo.length === 0) return;
    await Promise.race([
      Promise.all(correndo.map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, limite)),
    ]);
  }, limiteMs);
  // Um quadro a mais: `finished` resolve quando a animacao acaba, e o pintor
  // ainda precisa desenhar o estado final antes de alguem medir a cor dele.
  await pagina.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
}
