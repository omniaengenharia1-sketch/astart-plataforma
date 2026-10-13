// Foto das duas telas novas, para a dona ver onde cada campo ficou.
import { abrirNavegador } from './navegador.mjs';
const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = process.env.SAIDA ?? './tiros';
const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1180, height: 1400 } });
const p = await ctx.newPage();
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.getByText('entrar como direção').click();
await p.waitForTimeout(400);

await p.goto(`${BASE}/clientes/exemplo-mor/contrato`, { waitUntil: 'domcontentloaded' });
await p.getByText('documentos').first().waitFor({ timeout: 20000 });
await p.waitForTimeout(400);
await p.locator('section', { hasText: 'documentos' }).first()
  .screenshot({ path: `${SAIDA}/novo-01-documentos.png` });
console.log('OK  documentos');

await p.goto(`${BASE}/clientes/exemplo-pub/campanhas`, { waitUntil: 'domcontentloaded' });
await p.getByText('anexar relatório').waitFor({ timeout: 20000 });
await p.waitForTimeout(400);
await p.locator('section', { hasText: 'anexar relatório' })
  .screenshot({ path: `${SAIDA}/novo-02-relatorio.png` });
console.log('OK  relatorio');
await b.close();
