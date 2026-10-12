// A equipe manda duas etapas do projeto; o cliente ve as duas no portal e
// responde; a volta aparece na ficha. Sem recarregar a pagina: em modo exemplo
// os itens vivem na memoria dela, como viveriam no banco.
import { abrirNavegador } from './navegador.mjs';
const SAIDA = './tiros';
const b = await abrirNavegador();
const problemas = [];
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => problemas.push(`erro: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error') problemas.push(`console: ${m.text()}`); });
const limpo = async () => (await p.locator('body').innerText()).toLowerCase().replace(/ /g, ' ');

async function entrar(email) {
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', 'x');
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle');
}

await p.goto('http://localhost:4178', { waitUntil: 'networkidle' });
await entrar('layana@astartstudio.com.br');
await p.getByRole('link', { name: 'Clientes', exact: true }).click();
await p.locator('.font-bold:has-text("Mor Marcas"):visible').first().click();
await p.getByRole('link', { name: 'Entregáveis' }).first().click();
await p.waitForLoadState('networkidle');
await p.screenshot({ path: `${SAIDA}/proj-01-a-fazer.png`, fullPage: true });

const texto = await limpo();
for (const esperado of ['briefing e arquitetura', 'layout mobile', 'descoberta', 'publicação']) {
  if (!texto.includes(esperado)) problemas.push(`a aba nao mostra "${esperado}"`);
}

// Marca duas etapas e manda.
await p.getByLabel('Enviar Briefing e arquitetura').check();
await p.getByLabel('Enviar Wireframe').check();
await p.fill('input[aria-label="Recado para o cliente"]', 'Primeira leva, olha o fluxo das páginas.');
await p.screenshot({ path: `${SAIDA}/proj-02-marcadas.png`, fullPage: true });
await p.getByRole('button', { name: 'Enviar ao cliente' }).click();
await p.waitForTimeout(600);
const depois = await limpo();
if (!depois.includes('2 itens foram para o cliente')) {
  problemas.push('nao confirmou o envio');
}
if ((await p.locator('text=ESPERANDO O CLIENTE').count()) === 0) {
  problemas.push('as etapas nao passaram para "esperando o cliente"');
}
await p.screenshot({ path: `${SAIDA}/proj-03-enviadas.png`, fullPage: true });

// Reenviar o que ja esta na mao do cliente nao passa.
await p.getByLabel('Enviar Briefing e arquitetura').isDisabled()
  .then((d) => { if (!d) problemas.push('da pra remarcar etapa que ja esta esperando o cliente'); });

// A fila da equipe tem de mostrar as duas.
await p.getByRole('link', { name: 'Aprovações' }).click();
await p.waitForLoadState('networkidle');
const fila = await limpo();
for (const esperado of ['briefing e arquitetura', 'wireframe']) {
  if (!fila.includes(esperado)) problemas.push(`a fila nao recebeu "${esperado}"`);
}

// O cliente ve as duas no portal.
await p.locator('button:has-text("sair"):visible').first().click();
await p.waitForTimeout(300);
await entrar('bruna@mormarcas.com.br');
await p.getByRole('link', { name: /Para aprovar/ }).click();
await p.waitForLoadState('networkidle');
const portal = await limpo();
for (const esperado of ['briefing e arquitetura', 'wireframe']) {
  if (!portal.includes(esperado)) problemas.push(`o portal nao recebeu "${esperado}"`);
}
await p.screenshot({ path: `${SAIDA}/proj-04-portal.png`, fullPage: true });

// E "Meu projeto" mostra o andamento sem botao de enviar.
await p.getByRole('link', { name: 'Meu projeto' }).click();
await p.waitForLoadState('networkidle');
if (await p.getByRole('button', { name: 'Enviar ao cliente' }).count()) {
  problemas.push('o cliente ve o botao de enviar');
}
if ((await p.locator('input[type="checkbox"]').count()) > 0) {
  problemas.push('o cliente ve as caixas de marcar do lado da equipe');
}
await p.screenshot({ path: `${SAIDA}/proj-05-meu-projeto.png`, fullPage: true });

// O cliente pede ajuste numa e aprova a outra.
await p.getByRole('link', { name: /Para aprovar/ }).click();
// O portal ja tinha pecas na fila; o cartao certo e o do briefing.
const cartao = p.locator('li.bloco', { hasText: 'Briefing e arquitetura' });
await cartao.getByRole('button', { name: 'Pedir ajuste' }).click();
await cartao.locator('textarea').fill('O fluxo da home está invertido.');
await cartao.getByRole('button', { name: 'Enviar o ajuste' }).click();
await p.waitForTimeout(500);

// Volta para a equipe: a etapa tem de estar como "pediu ajuste" e reenviavel.
await p.locator('button:has-text("sair"):visible').first().click();
await p.waitForTimeout(300);
await entrar('layana@astartstudio.com.br');
await p.getByRole('link', { name: 'Clientes', exact: true }).click();
await p.locator('.font-bold:has-text("Mor Marcas"):visible').first().click();
await p.getByRole('link', { name: 'Entregáveis' }).first().click();
await p.waitForLoadState('networkidle');
const volta = await limpo();
if (!volta.includes('pediu ajuste')) problemas.push('a ficha nao mostra a etapa que voltou');
const remarcavel = await p.getByLabel('Enviar Briefing e arquitetura').isDisabled();
if (remarcavel) problemas.push('etapa que voltou com ajuste nao pode ser reenviada');
await p.screenshot({ path: `${SAIDA}/proj-06-volta.png`, fullPage: true });

await b.close();
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('projeto: tudo o que foi checado passou');
