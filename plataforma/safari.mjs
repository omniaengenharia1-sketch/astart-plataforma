// O que o Safari da dona faz — e que o Chromium escondia.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// A dona: "aqui eu queria poder arrastar as tarefas entre os kanbans". O
// arrastar JA ESTAVA escrito, com `draggable` do HTML, e eu tinha rodado o
// roteiro do quadro vinte vezes — no Chromium, sempre. Quando finalmente
// rodei o mesmo gesto no WebKit, que e o motor do Safari, o resultado foi:
//
//   chromium:  dragstart, dragover, drop   -> o cartao muda de coluna
//   webkit:    NENHUM evento               -> nada acontece
//
// Ou seja: o recurso nunca funcionou para a unica pessoa que usa o sistema
// todo dia. Nao foi um bug de borda; foi eu testar so no navegador que eu
// escolhi. Toda a minha cadeia de roteiros tinha esse buraco.
//
// Entao este roteiro roda no WebKit de proposito, e cobra os gestos que
// dependem do motor — os que uma biblioteca nao normaliza por mim.
//
// SE O WEBKIT NAO ESTIVER INSTALADO, ESTE ARQUIVO FALHA, nao pula. Teste que
// nao roda e pior que teste que falha: foi exatamente o silencio que deixou o
// arrastar quebrado por meses. Para instalar:
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 \
//   npx playwright-core@1.64.0 install webkit
//   apt-get install -y libgles2 libavif16 libenchant-2-2 libevent-2.1-7 \
//     libgraphene-1.0-0 libgstreamer-plugins-bad1.0-0 libgtk-4-1 \
//     libmanette-0.2-0 libsecret-1-0 libwayland-server0
import { existsSync } from 'node:fs';
import { webkit } from 'playwright-core';

const WEBKIT = '/opt/pw-browsers/webkit-2370/pw_run.sh';
const BASE = process.env.BASE ?? 'http://localhost:4178';
const falhas = [];
const cobrar = (ok, o) => { console.log(`${ok ? 'OK ' : 'FALHA'}  ${o}`); if (!ok) falhas.push(o); };

if (!existsSync(WEBKIT)) {
  console.log('PARE: o WebKit nao esta instalado, entao o motor do Safari nao');
  console.log('foi testado. O cabecalho deste arquivo tem o comando. Nao pulo');
  console.log('este teste: foi o silencio dele que deixou o arrastar quebrado.');
  process.exit(1);
}

const b = await webkit.launch({ executablePath: WEBKIT });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
const p = await ctx.newPage();
const problemas = [];
p.on('pageerror', (e) => problemas.push(e.message));

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'layana@astartstudio.com.br');
await p.fill('input[type="password"]', 'x');
await p.click('button[type="submit"]');
await p.waitForLoadState('networkidle');
await p.goto(`${BASE}/tarefas`, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);

const colunas = p.locator('section[data-coluna]');
cobrar(await colunas.count() >= 2, 'o quadro abre no Safari com as colunas');

const cartao = p.locator('article.bloco').first();
if (!(await cartao.count())) {
  cobrar(false, 'o quadro abriu sem nenhum cartao para arrastar');
  console.log(`\n${falhas.length} falha(s)`);
  await b.close();
  process.exit(1);
}

const titulo = (await cartao.innerText()).split('\n')[0];
const destino = colunas.nth(1);
const antesDestino = await destino.innerText();
cobrar(!antesDestino.includes(titulo), `"${titulo}" comeca fora da coluna de destino`);

// O gesto, com o mouse de verdade: aperta, anda um pouco, atravessa, solta.
const a = await cartao.boundingBox();
const z = await destino.boundingBox();
await p.mouse.move(a.x + a.width / 2, a.y + 20);
await p.mouse.down();
// Os primeiros 30px provam de quebra a folga: menos que isso e clique.
await p.mouse.move(a.x + a.width / 2 + 30, a.y + 40, { steps: 5 });

// Enquanto arrasta, a tela tem de MOSTRAR que esta arrastando. Sem isso o
// gesto e cego: a pessoa nao sabe onde vai soltar.
await p.mouse.move(z.x + z.width / 2, z.y + 120, { steps: 12 });
await p.waitForTimeout(250);
// Procura pelo CONTEUDO, nao pela classe: assercao presa a uma classe de
// CSS passa a medir a folha de estilo em vez do comportamento.
cobrar(
  await p.locator(`div.fixed:has-text("${titulo}")`).count() > 0,
  'enquanto arrasta, um cartao com o titulo segue o ponteiro',
);
cobrar(
  (await destino.getAttribute('class') ?? '').includes('outline-pink'),
  'e a coluna de destino acende, para a pessoa saber onde vai soltar',
);

await p.mouse.up();
await p.waitForTimeout(1500);

cobrar(
  (await destino.innerText()).includes(titulo),
  `"${titulo}" mudou de coluna arrastando NO SAFARI — era isto que nao funcionava`,
);

// A FOLGA DE SEIS PIXELS.
//
// Sem ela, a mao que treme ao clicar arrasta o cartao para a coluna vizinha.
// Entao: apertar, andar TRES pixels e soltar tem de ser um clique — o cartao
// nao sai do lugar E o cartao abre.
{
  const vizinho = p.locator('article.bloco').first();
  const onde = await vizinho.boundingBox();
  const nome = (await vizinho.innerText()).split('\n')[0];
  const coluna = await p.locator(`section[data-coluna]:has-text("${nome}")`).first()
    .getAttribute('data-coluna');

  await p.mouse.move(onde.x + onde.width / 2, onde.y + 20);
  await p.mouse.down();
  await p.mouse.move(onde.x + onde.width / 2 + 3, onde.y + 22, { steps: 3 });
  await p.mouse.up();
  await p.waitForTimeout(900);

  const aindaLa = await p.locator(`section[data-coluna="${coluna}"]`).innerText();
  cobrar(aindaLa.includes(nome), 'tremer tres pixels NAO move o cartao de coluna');
  cobrar(
    (await p.locator('body').innerText()).toLowerCase().includes('apagar tarefa')
      || (await p.locator('textarea').count()) > 0,
    'e clicar sem arrastar continua abrindo o cartao',
  );
}

await p.screenshot({ path: './tiros/safari-01-arrastou.png', fullPage: true });

cobrar(problemas.length === 0, `nenhum erro de pagina no Safari (${problemas.length})`);
if (problemas.length) console.log(problemas.map((x) => `    ${x}`).join('\n'));

await b.close();
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nO Safari arrasta.');
process.exit(falhas.length ? 1 : 0);
