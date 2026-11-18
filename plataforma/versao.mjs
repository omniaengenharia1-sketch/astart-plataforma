// O aviso de versão, no navegador.
//
// Ele existe porque a dona abriu o Comercial e não achou o "+ Novo lead". O
// código estava certo, o roteiro provava o botão, e o servidor entregava o
// arquivo novo — ela via um arquivo velho, guardado pelo Safari. Um
// `Cmd+Option+R` resolveu, e depender disso é não ter resolvido.
//
// Das duas coisas que este roteiro cobra, a SEGUNDA é a que importa:
//
//   1. quando sai código novo, a barra aparece e o botão recarrega;
//   2. quando NÃO sai, ela fica calada.
//
// O 2 é o teste de verdade. Uma barra que acende sozinha de vez em quando é
// pior que não existir: em uma semana ninguém mais lê, e no dia em que a
// versão estiver velha de fato ela vai estar lá, ignorada, igual a sempre.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const falhas = [];
const cobrar = (ok, o) => { console.log(`${ok ? 'OK ' : 'FALHA'}  ${o}`); if (!ok) falhas.push(o); };

const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
const p = await ctx.newPage();

async function entrar() {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'layana@astartstudio.com.br');
  await p.fill('input[type="password"]', 'x');
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle');
}

const barra = () => p.getByText('Saiu uma versão nova da plataforma.');

// ---------------------------------------------------------------------------
// 2 primeiro, de propósito: o estado normal é "não mudou nada".
// ---------------------------------------------------------------------------
await entrar();
// O aviso confere ao focar a aba; força o evento em vez de esperar relógio.
await p.evaluate(() => window.dispatchEvent(new Event('focus')));
await p.waitForTimeout(900);
cobrar(
  (await barra().count()) === 0,
  'com o mesmo codigo no ar, a barra NAO aparece — e o caso de todo dia',
);

// E continua calada depois de várias conferências seguidas.
for (let i = 0; i < 3; i++) {
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(300);
}
cobrar((await barra().count()) === 0, 'e continua calada depois de conferir varias vezes');

// ---------------------------------------------------------------------------
// 1. Agora sai código novo de verdade.
//
// Não se finge trocando estado do React: o que se mede é a comparação entre o
// arquivo que ESTA aba carregou e o que o servidor entrega AGORA. Então o que
// muda é a resposta do servidor — interceptada aqui, que é o mais perto de um
// deploy sem fazer um.
// ---------------------------------------------------------------------------
await p.route('**/', async (rota) => {
  if (rota.request().method() !== 'GET') return rota.continue();
  const r = await rota.fetch();
  const html = await r.text();
  // Troca o nome do arquivo por outro: é exatamente o que um deploy faz, já
  // que o Vite põe o hash do conteúdo no nome.
  await rota.fulfill({
    response: r,
    body: html.replace(/\/assets\/index-[^."]+\.js/, '/assets/index-OUTROHASH.js'),
  });
});

await p.evaluate(() => window.dispatchEvent(new Event('focus')));
await p.waitForTimeout(1200);
cobrar(await barra().count() > 0, 'quando o servidor passa a entregar outro arquivo, a barra acende');

const recarregar = p.getByRole('button', { name: 'Recarregar' });
cobrar(await recarregar.count() > 0, 'e oferece recarregar, em vez de so avisar');

await p.screenshot({ path: './tiros/versao-01-barra.png', fullPage: false });

// O botão recarrega de verdade. Sem a rota falsa, a barra some junto.
await p.unroute('**/');
await recarregar.click();
await p.waitForLoadState('networkidle');
await p.waitForTimeout(800);
cobrar(
  (await barra().count()) === 0,
  'e depois de recarregar com o arquivo certo, a barra some',
);

await b.close();
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nO aviso de versao esta de pe.');
process.exit(falhas.length ? 1 : 0);
