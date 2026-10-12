// Abre a plataforma em modo exemplo e exercita o ciclo de aprovacao inteiro.
// Navega clicando, nao por goto: em modo exemplo os itens moram na memoria da
// pagina, e recarregar comeca de novo — como recomecaria no banco de verdade.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = './tiros';

const navegador = await abrirNavegador();

const problemas = [];
async function pagina(ctx, nome) {
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') problemas.push(`[console ${nome}] ${m.text()}`); });
  p.on('pageerror', (e) => problemas.push(`[erro ${nome}] ${e.message}`));
  return p;
}

async function entrar(p, email) {
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', 'qualquer');
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle');
}

const vis = (p, sel) => p.locator(`${sel}:visible`).first();

// --- as tres larguras, do lado da equipe -------------------------------------
for (const [larg, alt, nome] of [[1440, 900, 'desktop'], [820, 1180, 'tablet'], [390, 844, 'celular']]) {
  const ctx = await navegador.newContext({ viewport: { width: larg, height: alt } });
  const p = await pagina(ctx, nome);

  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.screenshot({ path: `${SAIDA}/${nome}-01-entrar.png`, fullPage: true });

  await entrar(p, 'layana@astartstudio.com.br');
  await p.screenshot({ path: `${SAIDA}/${nome}-02-inicio-equipe.png`, fullPage: true });

  await p.getByRole('link', { name: 'Clientes' }).click();
  await p.waitForLoadState('networkidle');
  if (!(await p.getByRole('heading', { name: 'Clientes' }).first().isVisible())) {
    problemas.push(`[${nome}] a tela Clientes nao abriu`);
  }
  await p.screenshot({ path: `${SAIDA}/${nome}-03-clientes.png`, fullPage: true });

  // No celular a tabela vira lista de blocos: a linha de desktop fica no DOM,
  // escondida. Sem :visible o clique mira a invisivel.
  await vis(p, '.font-bold:has-text("Mor Marcas")').click();
  await p.waitForLoadState('networkidle');
  if (!(await p.getByRole('heading', { name: 'Mor Marcas' }).first().isVisible())) {
    problemas.push(`[${nome}] a ficha do cliente nao abriu`);
  }
  // innerText respeita text-transform: metade da interface e caixa alta por
  // CSS, entao a comparacao tem de ignorar caixa.
  const corpoFicha = (await p.locator('body').innerText()).toLowerCase();
  for (const esperado of ['Gestão Digital', 'Website', 'Bruna Melo', 'Visão geral']) {
    if (!corpoFicha.includes(esperado.toLowerCase())) problemas.push(`[${nome}] a ficha nao mostra "${esperado}"`);
  }
  await p.screenshot({ path: `${SAIDA}/${nome}-04-ficha.png`, fullPage: true });

  // Uma aba de modulo do cliente.
  await p.getByRole('link', { name: 'Calendário' }).first().click();
  await p.waitForLoadState('networkidle');
  await p.screenshot({ path: `${SAIDA}/${nome}-05-ficha-aba.png`, fullPage: true });

  await p.getByRole('link', { name: 'Aprovações' }).click();
  await p.waitForLoadState('networkidle');
  const corpoFila = (await p.locator('body').innerText()).toLowerCase();
  for (const esperado of ['Precisa de você', 'Esperando o cliente', 'Karla Bernardo']) {
    if (!corpoFila.includes(esperado.toLowerCase())) problemas.push(`[${nome}] a fila nao mostra "${esperado}"`);
  }
  await p.screenshot({ path: `${SAIDA}/${nome}-06-aprovacoes.png`, fullPage: true });

  const rolaH = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (rolaH) problemas.push(`[${nome}] a pagina rola na horizontal`);

  await ctx.close();
}

// --- o ciclo: cliente responde, equipe recebe --------------------------------
for (const [larg, alt, nome] of [[1280, 900, 'ciclo'], [390, 844, 'ciclo-celular']]) {
  const ctx = await navegador.newContext({ viewport: { width: larg, height: alt } });
  const p = await pagina(ctx, nome);
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await entrar(p, 'bruna@mormarcas.com.br');
  await p.screenshot({ path: `${SAIDA}/${nome}-01-portal.png`, fullPage: true });

  await p.getByRole('link', { name: /Para aprovar/ }).click();
  await p.waitForLoadState('networkidle');
  const itens = p.locator('li.bloco');
  const antes = await itens.count();
  if (antes === 0) problemas.push(`[${nome}] o portal abriu sem nenhum item para aprovar`);
  await p.screenshot({ path: `${SAIDA}/${nome}-02-aprovar.png`, fullPage: true });

  // Pedir ajuste sem escrever nada: o botao fica travado.
  await itens.first().getByRole('button', { name: 'Pedir ajuste' }).click();
  const enviar = itens.first().getByRole('button', { name: 'Enviar o ajuste' });
  if (!(await enviar.isDisabled())) {
    problemas.push(`[${nome}] da pra pedir ajuste sem escrever o que mudar`);
  }
  await p.screenshot({ path: `${SAIDA}/${nome}-03-ajuste.png`, fullPage: true });

  await itens.first().locator('textarea')
    .fill('A foto do primeiro quadro ficou escura, trocar pela da bancada.');
  if (await enviar.isDisabled()) problemas.push(`[${nome}] o botao continua travado mesmo com texto`);
  await enviar.click();
  await p.waitForTimeout(500);
  const depois = await itens.count();
  if (depois !== antes - 1) problemas.push(`[${nome}] o item nao saiu da fila: ${antes} -> ${depois}`);
  await p.screenshot({ path: `${SAIDA}/${nome}-04-depois-do-ajuste.png`, fullPage: true });

  // Aprovar direto.
  await itens.first().getByRole('button', { name: 'Aprovar', exact: true }).click();
  await p.waitForTimeout(500);
  const depois2 = await itens.count();
  if (depois2 !== depois - 1) problemas.push(`[${nome}] aprovar nao tirou o item: ${depois} -> ${depois2}`);
  await p.screenshot({ path: `${SAIDA}/${nome}-05-depois-da-aprovacao.png`, fullPage: true });

  // Sair sem recarregar: os itens continuam na memoria da pagina, entao a fila
  // da equipe tem de mostrar o que o cliente acabou de responder.
  await vis(p, 'button:has-text("sair")').click();
  await p.waitForTimeout(300);
  await entrar(p, 'layana@astartstudio.com.br');
  await p.getByRole('link', { name: 'Aprovações' }).click();
  await p.waitForLoadState('networkidle');
  const corpo = (await p.locator('body').innerText()).toLowerCase();
  if (!corpo.includes('a foto do primeiro quadro ficou escura')) {
    problemas.push(`[${nome}] o comentario do cliente nao chegou na fila da equipe`);
  }
  await p.screenshot({ path: `${SAIDA}/${nome}-06-fila-da-equipe.png`, fullPage: true });
  await ctx.close();
}

await navegador.close();
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('tudo o que foi checado passou');
