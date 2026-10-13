// Tira foto de ONDE fica o botao de conferir o token, nos dois lugares.
//
// Escrito porque a dona perguntou "onde isso?" depois de eu dizer "em Ajustes →
// Integrações → Meta". Descricao de caminho e pior que imagem: eu escrevi o
// caminho certo e ela nao achou, porque a secao fica no fim da pagina.
//
// Roda contra o build em MODO EXEMPLO, na porta 4178.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = process.env.SAIDA ?? './tiros';

const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
const p = await ctx.newPage();

await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.getByText('entrar como direção').click();
await p.waitForTimeout(500);

// --- 1. No calendario do cliente, no proprio bloco "onde publica" ----------
await p.goto(`${BASE}/clientes/exemplo-mor/calendario`, { waitUntil: 'domcontentloaded' });
await p.getByText('onde publica').waitFor({ timeout: 20000 });

const bloco = p.locator('section', { hasText: 'onde publica' }).first();
await bloco.screenshot({ path: `${SAIDA}/onde-01-calendario.png` });
console.log('OK  tirei o bloco "onde publica" do calendario');

await p.getByRole('button', { name: 'Conferir token' }).click();
await p.getByText('token da meta').waitFor({ timeout: 10000 });
await p.waitForTimeout(300);
await bloco.screenshot({ path: `${SAIDA}/onde-02-resultado.png` });
console.log('OK  e o resultado da conferencia');

// --- 2. Em Ajustes, no card da Meta ----------------------------------------
await p.goto(`${BASE}/ajustes`, { waitUntil: 'domcontentloaded' });
await p.getByText('integrações').waitFor({ timeout: 20000 });

const card = p.locator('article', { hasText: 'META' }).first();
await card.scrollIntoViewIfNeeded();
await p.waitForTimeout(300);
await card.screenshot({ path: `${SAIDA}/onde-03-ajustes.png` });
console.log('OK  tirei o card da Meta em Ajustes');

await b.close();
console.log('as tres fotos estao em ' + SAIDA);
