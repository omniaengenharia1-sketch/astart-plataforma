// O caminho inteiro da galeria: a equipe abre, o cliente abre pelo portal, e
// o link sem conta abre a mesma coisa sem login nenhum.
import { abrirNavegador } from './navegador.mjs';
const SAIDA = './tiros';
const b = await abrirNavegador();
const problemas = [];
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => problemas.push('erro: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') problemas.push('console: ' + m.text()); });
const limpo = async () => (await p.locator('body').innerText()).toLowerCase().replace(/ /g, ' ');
async function entrar(email) {
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', 'x');
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle');
}

// --- equipe
await p.goto('http://localhost:4178/', { waitUntil: 'networkidle' });
await entrar('layana@astartstudio.com.br');
await p.getByRole('link', { name: 'Clientes', exact: true }).click();
await p.locator('.font-bold:has-text("Chopp do Barbudo"):visible').first().click();
await p.waitForTimeout(300);
await p.getByRole('link', { name: 'Galeria' }).first().click();
await p.waitForLoadState('networkidle');
const equipe = await limpo();
for (const esperado of ['captação na fábrica', 'nova galeria', '7 fotos']) {
  if (!equipe.includes(esperado)) problemas.push(`a aba da equipe nao mostra "${esperado}"`);
}
await p.screenshot({ path: `${SAIDA}/18-galeria-equipe.png`, fullPage: true });

// abre a galeria: grade de conferencia + envio + link
await p.getByRole('button', { name: /Captação na fábrica/ }).first().click();
await p.waitForTimeout(500);
const aberta = await limpo();
for (const esperado of ['subir arquivos', 'link do cliente', 'arraste fotos e vídeos aqui']) {
  if (!aberta.includes(esperado)) problemas.push(`a galeria aberta nao mostra "${esperado}"`);
}
if ((await p.locator('img[alt^="ASTART_padaria"]').count()) < 5) {
  problemas.push('a grade de conferencia nao carregou as miniaturas');
}
await p.screenshot({ path: `${SAIDA}/19-galeria-aberta.png`, fullPage: true });

// cria o link
await p.getByRole('button', { name: /Criar (outro )?link/ }).click();
await p.waitForTimeout(400);
const comLink = await limpo();
if (!comLink.includes('/g/')) problemas.push('o endereco do cliente nao apareceu');
await p.screenshot({ path: `${SAIDA}/20-galeria-link.png`, fullPage: true });
await ctx.close();

// --- o link, sem conta nenhuma
const ctx2 = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', deviceScaleFactor: 2 });
const q = await ctx2.newPage();
q.on('pageerror', (e) => problemas.push('erro(link): ' + e.message));
await q.goto('http://localhost:4178/g/exemplo-gal-1', { waitUntil: 'networkidle' });
await q.waitForTimeout(600);
const albumTxt = (await q.locator('body').innerText()).toLowerCase();
if (albumTxt.includes('entrar')) problemas.push('o link pediu login');
for (const esperado of ['captação na fábrica', 'baixar tudo em alta', '7 fotos']) {
  if (!albumTxt.includes(esperado)) problemas.push(`o album nao mostra "${esperado}"`);
}
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
if ((await q.locator('li.bloco img').count()) < 6) problemas.push('o album nao carregou as fotos');
await q.screenshot({ path: `${SAIDA}/21-album-link.png`, fullPage: true });

// escolher uma foto
const antes = await q.locator('button[aria-pressed="true"]').count();
await q.locator('button[aria-label^="Escolher"]').first().click();
await q.waitForTimeout(300);
const depois = await q.locator('button[aria-pressed="true"]').count();
if (depois <= antes) problemas.push('marcar a escolhida nao funcionou');

// abrir a lupa e andar com o teclado
await q.locator('button[aria-label^="Abrir"]').first().click();
await q.waitForTimeout(400);
if (!(await q.getByRole('dialog').isVisible())) problemas.push('a lupa nao abriu');
await q.keyboard.press('ArrowRight');
await q.waitForTimeout(250);
await q.screenshot({ path: `${SAIDA}/22-album-lupa.png`, fullPage: false });
await q.keyboard.press('Escape');
await q.waitForTimeout(250);
if (await q.getByRole('dialog').count()) problemas.push('Esc nao fechou a lupa');
await ctx2.close();

// --- o cliente logado, pelo portal
const ctx3 = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
const m = await ctx3.newPage();
m.on('pageerror', (e) => problemas.push('erro(portal): ' + e.message));
await m.goto('http://localhost:4178/', { waitUntil: 'networkidle' });
await m.fill('input[type="email"]', 'ana@choppdobarbudo.com.br');
await m.fill('input[type="password"]', 'x');
await m.click('button[type="submit"]');
await m.waitForLoadState('networkidle');
await m.getByRole('link', { name: 'Galeria' }).first().click();
await m.waitForTimeout(500);
await m.screenshot({ path: `${SAIDA}/23-celular-galeria.png`, fullPage: true });
await ctx3.close();

await b.close();
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('galeria: tudo o que foi checado passou');
