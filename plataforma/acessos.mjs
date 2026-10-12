// Convida alguem para a equipe, cancela o convite, tira e devolve acesso — e
// da acesso a um contato do cliente pela ficha.
import { abrirNavegador } from './navegador.mjs';
const SAIDA = './tiros';
const b = await abrirNavegador();
const problemas = [];
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => problemas.push(`erro: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error') problemas.push(`console: ${m.text()}`); });
const limpo = async () => (await p.locator('body').innerText()).toLowerCase().replace(/ /g, ' ');

await p.goto('http://localhost:4178', { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'layana@astartstudio.com.br');
await p.fill('input[type="password"]', 'x');
await p.click('button[type="submit"]');
await p.waitForLoadState('networkidle');

await p.getByRole('link', { name: 'Ajustes' }).click();
await p.waitForLoadState('networkidle');
const inicio = await limpo();
for (const esperado of ['viviane', 'camila', 'sem acesso', 'convite aberto']) {
  if (!inicio.includes(esperado)) problemas.push(`a tela de equipe nao mostra "${esperado}"`);
}
await p.screenshot({ path: `${SAIDA}/acesso-01-equipe.png`, fullPage: true });

// Convidar.
await p.getByRole('button', { name: 'Convidar pessoa' }).click();
await p.fill('#conv-nome', 'Marina');
await p.fill('#conv-email', 'marina@astartstudio.com.br');
await p.fill('#conv-cargo', 'Designer');
await p.selectOption('#conv-papel', 'operacao');
await p.screenshot({ path: `${SAIDA}/acesso-02-convite.png`, fullPage: true });
await p.getByRole('button', { name: 'Enviar convite' }).click();
await p.waitForTimeout(500);
const depois = await limpo();
if (!depois.includes('convite enviado para marina@astartstudio.com.br')) {
  problemas.push('nao confirmou o convite');
}
if (!depois.includes('marina@astartstudio.com.br')) problemas.push('o convite nao entrou na lista');

// Convidar o mesmo e-mail de novo tem de recusar.
await p.getByRole('button', { name: 'Convidar pessoa' }).click();
await p.fill('#conv-email', 'marina@astartstudio.com.br');
await p.getByRole('button', { name: 'Enviar convite' }).click();
await p.waitForTimeout(400);
if (!(await limpo()).includes('já existe um convite aberto')) {
  problemas.push('deixou convidar duas vezes o mesmo e-mail');
}
await p.screenshot({ path: `${SAIDA}/acesso-03-repetido.png`, fullPage: true });
await p.getByRole('button', { name: 'Cancelar', exact: true }).first().click();

// Cancelar o convite.
const linhaConvite = p.locator('li', { hasText: 'marina@astartstudio.com.br' });
await linhaConvite.getByRole('button', { name: 'Cancelar' }).click();
await p.waitForTimeout(400);
if ((await limpo()).includes('marina@astartstudio.com.br')) {
  problemas.push('o convite cancelado continua na lista');
}

// Tirar e devolver acesso.
const linhaCamila = p.locator('li', { hasText: 'camila@astartstudio.com.br' });
await linhaCamila.getByRole('button', { name: 'Tirar acesso' }).click();
await p.waitForTimeout(400);
if (!(await linhaCamila.innerText()).toLowerCase().includes('sem acesso')) {
  problemas.push('tirar o acesso nao marcou a pessoa');
}
await p.screenshot({ path: `${SAIDA}/acesso-04-sem-acesso.png`, fullPage: true });
await linhaCamila.getByRole('button', { name: 'Devolver' }).click();
await p.waitForTimeout(400);
if ((await linhaCamila.innerText()).toLowerCase().includes('sem acesso')) {
  problemas.push('devolver o acesso nao funcionou');
}

// Dar acesso a um contato do cliente, pela ficha.
await p.getByRole('link', { name: 'Clientes', exact: true }).click();
await p.locator('.font-bold:has-text("Mor Marcas"):visible').first().click();
await p.waitForLoadState('networkidle');
await p.getByRole('button', { name: 'Dar acesso' }).click();
await p.fill('#ac-nome', 'Sócio da Mor');
await p.fill('#ac-email', 'socio@mormarcas.com.br');
await p.selectOption('#ac-papel', 'leitura');
await p.getByRole('button', { name: 'Enviar convite' }).click();
await p.waitForTimeout(500);
const ficha = await limpo();
if (!ficha.includes('convite enviado para socio@mormarcas.com.br')) {
  problemas.push('nao confirmou o convite do cliente');
}
if (!ficha.includes('sócio da mor')) problemas.push('o contato novo nao apareceu na ficha');
await p.screenshot({ path: `${SAIDA}/acesso-05-cliente.png`, fullPage: true });

// Tirar o acesso de um contato.
const contato = p.locator('li', { hasText: 'bruna@mormarcas.com.br' });
await contato.getByRole('button', { name: 'Tirar' }).click();
await p.waitForTimeout(400);
if (!(await contato.innerText()).toLowerCase().includes('sem acesso')) {
  problemas.push('tirar o acesso do contato nao marcou nada');
}

await b.close();
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('acessos: tudo o que foi checado passou');
