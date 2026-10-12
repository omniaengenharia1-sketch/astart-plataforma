// Cria uma peca no calendario, manda para o cliente e confere que ela chega la.
import { abrirNavegador } from './navegador.mjs';
const SAIDA = './tiros';
const b = await abrirNavegador();
const problemas = [];

async function sessao(larg, alt, nome) {
  const ctx = await b.newContext({ viewport: { width: larg, height: alt } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problemas.push(`[${nome}] erro: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') problemas.push(`[${nome}] console: ${m.text()}`); });
  return { ctx, p };
}
const limpo = async (p) => (await p.locator('body').innerText()).toLowerCase().replace(/ /g, ' ');
async function entrar(p, email) {
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', 'x');
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle');
}

const { ctx, p } = await sessao(1440, 1000, 'cal');
await p.goto('http://localhost:4178', { waitUntil: 'networkidle' });
await entrar(p, 'layana@astartstudio.com.br');
await p.getByRole('link', { name: 'Clientes', exact: true }).click();
await p.locator('.font-bold:has-text("Mor Marcas"):visible').first().click();
await p.getByRole('link', { name: 'Calendário' }).first().click();
await p.waitForLoadState('networkidle');
await p.screenshot({ path: `${SAIDA}/cal-01-mes.png`, fullPage: true });

const mes = await limpo(p);
for (const esperado of ['making of da campanha', 'bastidores do estúdio', 'pronto para mandar']) {
  if (!mes.includes(esperado)) problemas.push(`o mes nao mostra "${esperado}"`);
}
if (!mes.includes('no ar')) problemas.push('peca publicada nao aparece como no ar');

// Navegar de mes e voltar.
await p.getByRole('button', { name: 'Próximo mês' }).click();
await p.waitForTimeout(300);
if ((await limpo(p)).includes('making of da campanha')) {
  problemas.push('o mes seguinte mostra peca do mes anterior');
}
await p.getByRole('button', { name: 'Mês anterior' }).click();
await p.waitForTimeout(300);

// Nova peca.
await p.getByRole('button', { name: 'Nova peça' }).click();
await p.fill('#peca-titulo', 'Receita do mês em 15 segundos');
await p.selectOption('#peca-tipo', 'reel');
await p.fill('#peca-hora', '19:30');
await p.screenshot({ path: `${SAIDA}/cal-02-nova.png`, fullPage: true });
await p.getByRole('button', { name: 'Criar peça', exact: true }).click();
await p.waitForTimeout(500);
const criada = await limpo(p);
if (!criada.includes('receita do mês em 15 segundos')) problemas.push('a peca criada nao apareceu no mes');
if (!criada.includes('19:30')) problemas.push('a hora digitada nao apareceu');

// Mandar a peca nova para o cliente.
await p.getByLabel('Enviar Receita do mês em 15 segundos').check();
await p.getByRole('button', { name: 'Enviar ao cliente' }).click();
await p.waitForTimeout(600);
const enviada = await limpo(p);
if (!enviada.includes('1 peça foi para o cliente')) problemas.push('nao confirmou o envio da peca');
await p.screenshot({ path: `${SAIDA}/cal-03-enviada.png`, fullPage: true });

// O cliente ve a peca.
await p.locator('button:has-text("sair"):visible').first().click();
await p.waitForTimeout(300);
await entrar(p, 'bruna@mormarcas.com.br');
await p.getByRole('link', { name: /Para aprovar/ }).click();
await p.waitForLoadState('networkidle');
if (!(await limpo(p)).includes('receita do mês em 15 segundos')) {
  problemas.push('a peca nova nao chegou no portal do cliente');
}

// E o calendario do cliente mostra o mes sem botao de criar.
await p.getByRole('link', { name: 'Calendário' }).click();
await p.waitForLoadState('networkidle');
if (await p.getByRole('button', { name: 'Nova peça' }).count()) {
  problemas.push('o cliente ve o botao de criar peca');
}
if ((await limpo(p)).includes('pronto para mandar')) {
  problemas.push('o cliente ve a lista de envio da equipe');
}
await p.screenshot({ path: `${SAIDA}/cal-04-cliente.png`, fullPage: true });
await ctx.close();

// Celular: a grade vira agenda.
const { ctx: c2, p: m } = await sessao(390, 844, 'cal-celular');
await m.goto('http://localhost:4178', { waitUntil: 'networkidle' });
await entrar(m, 'layana@astartstudio.com.br');
await m.getByRole('link', { name: 'Clientes', exact: true }).click();
await m.locator('.font-bold:has-text("Mor Marcas"):visible').first().click();
await m.getByRole('link', { name: 'Calendário' }).first().click();
await m.waitForLoadState('networkidle');
if (await m.locator('.grid-cols-7:visible').count()) {
  problemas.push('[celular] a grade de 7 colunas aparece no telefone');
}
if (await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) {
  problemas.push('[celular] a pagina rola na horizontal');
}
await m.screenshot({ path: `${SAIDA}/cal-05-celular.png`, fullPage: true });
await c2.close();

await b.close();
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('calendario: tudo o que foi checado passou');
