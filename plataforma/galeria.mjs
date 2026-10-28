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
// "8 itens" e nao "7 fotos": o cartao passou a contar foto e video juntos, como
// na referencia do Pixieset que a dona mandou. A contagem continua cobrada —
// trocar o rotulo sem continuar conferindo o numero seria afrouxar o teste.
for (const esperado of ['captação na fábrica', 'nova galeria', '8 itens']) {
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
// O link encolheu na 0057: era 64 caracteres de hexadecimal, agora e o nome da
// galeria mais 16 de segredo. No modo exemplo o token e fixo, entao o que se
// cobra aqui e que o endereco nao volte a ser uma parede de hex.
if (/\/g\/[0-9a-f]{64}\b/.test(comLink)) problemas.push('o link voltou a ser 64 caracteres de hex');
await p.screenshot({ path: `${SAIDA}/20-galeria-link.png`, fullPage: true });

// --- o menu "⋯" da colecao, como na referencia do Pixieset
// O menu existe para as acoes da entrega ficarem num lugar so, em vez de
// espalhadas pelo cartao. Com link criado, ele tem copiar e visualizar.
const menu = p.getByRole('button', { name: 'Ações desta coleção' }).first();
if (!(await menu.count())) problemas.push('o cartao da colecao nao tem o menu de acoes');
await menu.click();
await p.waitForTimeout(300);
for (const esperado of ['Copiar link do cliente', 'Visualizar como cliente', 'Mover para a lixeira']) {
  if (!(await p.getByRole('menuitem', { name: esperado }).count())) {
    problemas.push(`o menu da colecao nao oferece "${esperado}"`);
  }
}
// Layana e 'operacao': move para a lixeira, mas nao apaga. O portao de verdade
// e o `usuario_admin()` no banco; isto cobra que a tela nao OFEREÇA o que seria
// recusado — botao que so falha ensina a pessoa a desconfiar da tela.
if (await p.getByRole('menuitem', { name: /Apagar de vez/ }).count()) {
  problemas.push('quem nao e direcao esta vendo o apagar no menu');
}
// Esc fecha: menu que so fecha clicando de novo fica aberto por engano.
await p.keyboard.press('Escape');
await p.waitForTimeout(250);
if (await p.getByRole('menu').count()) problemas.push('Esc nao fechou o menu da colecao');

// --- a lixeira (0058)
await p.getByRole('button', { name: 'Ações desta coleção' }).first().click();
await p.waitForTimeout(250);
await p.getByRole('menuitem', { name: 'Mover para a lixeira' }).click();
await p.waitForTimeout(800);

// Saiu da aba "Coleções": a entrega fora do ar nao fica junto com as que estao
// no ar, senao a equipe manda link de galeria arquivada.
if ((await limpo()).includes('captação na fábrica')) {
  problemas.push('a galeria na lixeira continua aparecendo entre as colecoes');
}
if (!(await p.getByRole('button', { name: /Lixeira/ }).count())) {
  problemas.push('a aba da lixeira nao apareceu');
}
await p.getByRole('button', { name: /Lixeira/ }).first().click();
await p.waitForTimeout(600);
const naLixeira = await limpo();
if (!naLixeira.includes('captação na fábrica')) problemas.push('a galeria nao esta na lixeira');
if (!naLixeira.includes('na lixeira')) problemas.push('a lixeira nao marca a galeria');

await p.getByRole('button', { name: 'Ações desta coleção' }).first().click();
await p.waitForTimeout(250);
if (!(await p.getByRole('menuitem', { name: 'Restaurar' }).count())) {
  problemas.push('nao da para restaurar o que foi para a lixeira');
}
await p.getByRole('menuitem', { name: 'Restaurar' }).click();
await p.waitForTimeout(800);
await p.getByRole('button', { name: /Coleções/ }).first().click();
await p.waitForTimeout(500);
if (!(await limpo()).includes('captação na fábrica')) {
  problemas.push('restaurar nao devolveu a galeria para as colecoes');
}
await ctx.close();

// --- e a direcao, que apaga, mas tem de digitar o nome
const ctxD = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
const d = await ctxD.newPage();
d.on('pageerror', (e) => problemas.push('erro(direcao): ' + e.message));
await d.goto('http://localhost:4178/', { waitUntil: 'networkidle' });
await d.fill('input[type="email"]', 'viviane@astartstudio.com.br');
await d.fill('input[type="password"]', 'x');
await d.click('button[type="submit"]');
await d.waitForLoadState('networkidle');
await d.getByRole('link', { name: 'Clientes', exact: true }).click();
await d.locator('.font-bold:has-text("Chopp do Barbudo"):visible').first().click();
await d.waitForTimeout(300);
await d.getByRole('link', { name: 'Galeria' }).first().click();
await d.waitForLoadState('networkidle');
await d.getByRole('button', { name: /Captação na fábrica/ }).first().click();
await d.waitForTimeout(500);

if (!(await d.getByRole('button', { name: /Apagar de vez/ }).count())) {
  problemas.push('a direcao nao ve o botao de apagar');
}
await d.getByRole('button', { name: /Apagar de vez/ }).first().click();
await d.waitForTimeout(400);
// Apagar a captacao de um cliente nao tem desfazer. O botao so libera depois
// do nome digitado — confirmacao de um clique e a diferenca entre engano e
// catastrofe.
const confirmar = d.getByRole('button', { name: /Apagar de vez/ }).last();
if (!(await confirmar.isDisabled())) {
  problemas.push('apagar liberou antes de digitar o nome da galeria');
}
await d.getByLabel('Digite o nome da galeria para confirmar').fill('nome errado');
await d.waitForTimeout(250);
if (!(await confirmar.isDisabled())) problemas.push('apagar liberou com o nome errado');
await ctxD.close();

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

// A grade e <figure>, nao mais `li.bloco`: o cartao branco com barra de
// "0 MB · BAIXAR" embaixo de cada foto saiu na 0057. Este seletor ja estava
// velho quando quebrou — e um roteiro que aponta para marcacao que nao existe
// mais nao testa nada.
if ((await q.locator('figure img').count()) < 6) problemas.push('o album nao carregou as fotos');

// A capa: uma imagem grande ANTES da primeira foto da grade. Sem ela a entrega
// abre numa parede branca, que foi a queixa que originou tudo isto.
if ((await q.locator('header img').count()) < 1) problemas.push('o album abriu sem capa');

// O peso saia "0 MB" em toda foto de menos de meio mega, com 185 delas na tela
// do cliente. `Math.round(0,5)` e 0.
if (/\b0 MB\b/.test(await q.locator('body').innerText())) {
  problemas.push('ainda tem foto marcada como "0 MB"');
}

// Pelo LINK nao se troca capa: isso e da equipe. Se este botao vazar para o
// cliente, ele muda a capa da propria entrega.
await q.locator('button[aria-label^="Abrir"]').first().click();
await q.waitForTimeout(400);
if (await q.getByRole('button', { name: /capa/i }).count()) {
  problemas.push('o cliente ve o botao de trocar a capa');
}
await q.keyboard.press('Escape');
await q.waitForTimeout(250);

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
