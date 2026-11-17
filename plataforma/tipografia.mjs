// Fotografa as superficies de texto que a dona apontou, para comparar
// antes/depois. Nao cobra nada: e uma regua, nao um teste.
import { abrirNavegador, esperarAnimacoes } from './navegador.mjs';
const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = process.env.SAIDA ?? './tiros';
const MARCA = process.env.MARCA ?? 'antes';

const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.getByText('entrar como direção').click();
await p.waitForTimeout(500);

await p.goto(`${BASE}/clientes/exemplo-mor`, { waitUntil: 'networkidle' });
await esperarAnimacoes(p);
await p.screenshot({ path: `${SAIDA}/tipo-${MARCA}-1-cliente.png`, clip: { x: 0, y: 0, width: 1440, height: 560 } });

await p.goto(`${BASE}/clientes`, { waitUntil: 'networkidle' });
await esperarAnimacoes(p);
await p.screenshot({ path: `${SAIDA}/tipo-${MARCA}-2-clientes.png`, clip: { x: 0, y: 0, width: 1440, height: 700 } });
await ctx.close();

const cel = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const m = await cel.newPage();
await m.goto(BASE, { waitUntil: 'domcontentloaded' });
await m.getByText('entrar como direção').click();
await m.waitForTimeout(500);
await m.goto(`${BASE}/clientes/exemplo-mor`, { waitUntil: 'networkidle' });
await esperarAnimacoes(m);
await m.screenshot({ path: `${SAIDA}/tipo-${MARCA}-3-celular.png`, fullPage: false });
await b.close();
console.log(`fotos "${MARCA}" prontas em ${SAIDA}`);
