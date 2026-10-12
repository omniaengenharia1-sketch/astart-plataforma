// O ciclo do link sem conta, ponta a ponta:
//   a equipe copia o link -> alguem SEM LOGIN abre e responde -> a resposta
//   aparece na fila da equipe, com o nome que a pessoa digitou.
//
// A parte que importa deste roteiro: a pagina do link e aberta num contexto
// LIMPO, sem a sessao da equipe. Reaproveitar a aba logada provaria o caminho
// errado — o do portal, que ja tem teste.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = process.env.SAIDA ?? './tiros';

const navegador = await abrirNavegador();
const problemas = [];

async function pagina(ctx, nome) {
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') problemas.push(`[console ${nome}] ${m.text()}`); });
  p.on('pageerror', (e) => problemas.push(`[erro ${nome}] ${e.message}`));
  return p;
}

const vis = (p, sel) => p.locator(`${sel}:visible`).first();

// --- 1. a equipe pega o link -------------------------------------------------
const equipe = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
// A area de transferencia nao e necessaria: a tela mostra o endereco inteiro,
// justamente para o caso de o navegador recusar o clipboard.
const pe = await pagina(equipe, 'equipe');
await pe.goto(BASE, { waitUntil: 'networkidle' });
await pe.fill('input[type="email"]', 'layana@astartstudio.com.br');
await pe.fill('input[type="password"]', 'x');
await pe.click('button[type="submit"]');
await pe.waitForLoadState('networkidle');

await pe.getByRole('navigation', { name: 'Seções', exact: true })
  .getByRole('link', { name: 'Clientes', exact: true }).click();
await pe.waitForLoadState('networkidle');
await vis(pe, '.font-bold:has-text("Mor Marcas")').click();
await pe.waitForLoadState('networkidle');
await pe.waitForTimeout(500);

const corpoFicha = (await pe.locator('body').innerText()).toLowerCase();
if (!corpoFicha.includes('enviados')) problemas.push('[equipe] a ficha nao tem a secao de enviados');
if (!corpoFicha.includes('na mão dele')) problemas.push('[equipe] nao diz quantos estao na mao do cliente');
if (!corpoFicha.includes('aberto 2 vezes')) problemas.push('[equipe] nao diz quantas vezes o link foi aberto');

await pe.getByRole('button', { name: 'Outro link' }).first().click();
await pe.waitForTimeout(500);
const endereco = (await pe.locator('.select-all').first().innerText()).trim();
if (!/\/a\/[a-z0-9-]+$/i.test(endereco)) problemas.push(`[equipe] o endereco saiu torto: ${endereco}`);
await pe.screenshot({ path: `${SAIDA}/link-01-equipe.png`, fullPage: true });

// --- 2. alguem sem conta abre e responde -------------------------------------
//
// Aqui vai o token SEMEADO, nao o que acabou de ser criado acima, e o motivo e
// o modo exemplo: nele os dados vivem na memoria DA PAGINA. Um link criado na
// aba da equipe nao existe na aba do visitante, que e outra pagina. Com o banco
// de verdade os dois enderecos valem igual — e e a migration 0041, testada no
// `21_smoke_aprovar_sem_conta.sql`, que garante isso.
//
// O contexto e limpo de proposito: reaproveitar a aba logada provaria o caminho
// do portal, que ja tem teste proprio.
const visitante = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const pv = await pagina(visitante, 'visitante');
await pv.goto(`${BASE}/a/exemplo`, { waitUntil: 'networkidle' });
await pv.waitForTimeout(600);

const corpo = (await pv.locator('body').innerText()).toLowerCase();
for (const esperado of ['para aprovar', 'mor marcas', 'quem está respondendo', 'esperam você']) {
  if (!corpo.includes(esperado)) problemas.push(`[visitante] a pagina nao mostra "${esperado}"`);
}
// Sem casca da plataforma: quem abriu nao e usuario de nada.
for (const naoDeveria of ['plataforma interna', 'clientes', 'aprovações', 'ajustes', 'sair']) {
  if (corpo.includes(naoDeveria)) problemas.push(`[visitante] vazou "${naoDeveria}" da casca da equipe`);
}
if (await pv.locator('input[type="password"]').count() > 0) {
  problemas.push('[visitante] a pagina do link pediu senha');
}
await pv.screenshot({ path: `${SAIDA}/link-02-visitante.png`, fullPage: true });

// Antes do nome, nenhum item aparece para responder.
if (await pv.getByRole('button', { name: 'Aprovar', exact: true }).count() > 0) {
  problemas.push('[visitante] da pra responder sem dizer quem e');
}

// Falha com mensagem, nao com pilha: um timeout de `fill` conta menos do que
// dizer qual pedaco da pagina sumiu.
if (await pv.locator('#quem').count() === 0) {
  problemas.push('[visitante] a pagina nao pede o nome de quem esta respondendo');
  console.log('PROBLEMAS:\n' + problemas.join('\n'));
  process.exit(1);
}
await pv.fill('#quem', 'Bruna Melo');
await pv.getByRole('button', { name: 'Começar' }).click();
await pv.waitForTimeout(400);

const itens = pv.locator('li.bloco');
const antes = await itens.count();
if (antes === 0) problemas.push('[visitante] nenhum item para responder');

// Pedir ajuste sem escrever nada: o botao fica travado, igual ao portal.
await itens.first().getByRole('button', { name: 'Pedir ajuste' }).click();
const enviar = itens.first().getByRole('button', { name: 'Enviar o ajuste' });
if (!(await enviar.isDisabled())) problemas.push('[visitante] da pra pedir ajuste sem dizer o que mudar');
await itens.first().locator('textarea').fill('O primeiro quadro ficou escuro, trocar pela da bancada.');
if (await enviar.isDisabled()) problemas.push('[visitante] o botao ficou travado mesmo com texto');
await enviar.click();
await pv.waitForTimeout(700);
await pv.screenshot({ path: `${SAIDA}/link-03-respondido.png`, fullPage: true });

const depois = (await pv.locator('body').innerText()).toLowerCase();
if (!depois.includes('o que você já respondeu')) {
  problemas.push('[visitante] o item respondido nao foi para a lista de respondidos');
}
if (!depois.includes('bruna melo')) problemas.push('[visitante] nao registrou quem respondeu');

// --- 3. a resposta chega na fila da equipe -----------------------------------
// Mesma aba da equipe, sem recarregar: em modo exemplo os itens vivem na
// memoria da PAGINA, entao esta checagem so vale no banco de verdade. Aqui
// confere que a tela do visitante nao quebrou a da equipe.
await pe.reload({ waitUntil: 'networkidle' });
await pe.waitForTimeout(500);
if (!(await pe.locator('body').innerText()).toLowerCase().includes('mor marcas')) {
  problemas.push('[equipe] a ficha nao reabriu depois da resposta');
}

// --- 4. link torto e link revogado -------------------------------------------
const pt = await pagina(visitante, 'torto');
await pt.goto(`${BASE}/a/naoexiste123456789012345678901234567890`, { waitUntil: 'networkidle' });
await pt.waitForTimeout(500);
const tortoTexto = (await pt.locator('body').innerText()).toLowerCase();
if (!tortoTexto.includes('não vale mais') && !tortoTexto.includes('nao vale mais')) {
  problemas.push('[torto] link errado nao disse que nao vale');
}
if (tortoTexto.includes('mor marcas')) problemas.push('[torto] link errado vazou nome de cliente');
await pt.screenshot({ path: `${SAIDA}/link-04-torto.png`, fullPage: true });

// Revogar atravessa duas paginas (a equipe tira do ar, o visitante tenta abrir),
// e em modo exemplo isso nao existe: cada pagina tem a sua memoria. Quem cobra
// essa regra e o `21_smoke_aprovar_sem_conta.sql`, no banco, onde ela mora.
// Aqui confere so que o botao existe e nao explode.
await pe.getByRole('button', { name: 'Tirar do ar' }).first().click();
await pe.waitForTimeout(600);
if ((await pe.locator('body').innerText()).toLowerCase().includes('não deu certo')) {
  problemas.push('[equipe] tirar o link do ar deu erro');
}

await navegador.close();
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('link sem conta: tudo o que foi checado passou');
