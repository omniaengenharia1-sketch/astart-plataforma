// axe-core em cada tela, nos dois temas e em duas larguras.
// O contraste fica de fora aqui: o axe não sabe compor vidro translúcido sobre
// campo com aurora, e dá falso positivo em tudo. Quem mede contraste é o
// contraste.mjs, que compõe as camadas de verdade.
import { abrirNavegador } from './navegador.mjs';
import { readFileSync } from 'node:fs';

const AXE = readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const BASE = 'http://localhost:4178';
const b = await abrirNavegador();

const CONFIG = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  rules: { 'color-contrast': { enabled: false } },
};

const achados = new Map();

async function varre(p, onde) {
  await p.evaluate(AXE);
  const r = await p.evaluate((cfg) => window.axe.run(document, cfg), CONFIG);
  for (const v of r.violations) {
    const chave = `${v.id}|${v.nodes[0]?.target?.join(' ')}`;
    if (!achados.has(chave)) {
      achados.set(chave, {
        id: v.id, impacto: v.impact, onde,
        descricao: v.help,
        alvo: v.nodes[0]?.target?.join(' ')?.slice(0, 80),
        quantos: v.nodes.length,
      });
    }
  }
}

for (const [larg, alt, nome] of [[1440, 980, 'desktop'], [390, 844, 'celular']]) {
  for (const claro of [false, true]) {
    for (const [papel, email, abas] of [
      ['equipe', 'layana@astartstudio.com.br',
        ['Clientes', 'Aprovações', 'Agenda', 'Fila', 'Financeiro', 'Comercial', 'Feedbacks', 'Ajustes']],
      ['cliente', 'bruna@mormarcas.com.br',
        ['Para aprovar', 'Meu projeto', 'Calendário', 'Grid', 'Financeiro', 'Contrato', 'Meu site', 'Feedback']],
    ]) {
      const ctx = await b.newContext({ viewport: { width: larg, height: alt }, colorScheme: claro ? 'light' : 'dark' });
      const p = await ctx.newPage();
      const tag = `${nome}/${claro ? 'claro' : 'escuro'}/${papel}`;
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await varre(p, `${tag}/entrar`);
      await p.fill('input[type="email"]', email);
      await p.fill('input[type="password"]', 'x');
      await p.click('button[type="submit"]');
      await p.waitForLoadState('networkidle');
      await varre(p, `${tag}/início`);
      for (const aba of abas) {
        await p.getByRole('link', { name: new RegExp('^' + aba) }).first().click();
        await p.waitForTimeout(350);
        await varre(p, `${tag}/${aba}`);
      }
      // Uma tela de formulário, que é onde mais aparece erro de rótulo.
      if (papel === 'equipe') {
        await p.getByRole('link', { name: 'Clientes', exact: true }).first().click();
        await p.getByRole('button', { name: 'Novo cliente' }).click();
        await p.waitForTimeout(300);
        await varre(p, `${tag}/novo cliente`);
      }
      await ctx.close();
    }
  }
}
await b.close();

const lista = [...achados.values()].sort((a, b) =>
  ['critical', 'serious', 'moderate', 'minor'].indexOf(a.impacto) -
  ['critical', 'serious', 'moderate', 'minor'].indexOf(b.impacto));
for (const a of lista) {
  console.log(`[${a.impacto}] ${a.id} (${a.quantos}x) em ${a.onde}\n    ${a.descricao}\n    → ${a.alvo}`);
}
console.log(lista.length === 0 ? 'axe: nenhuma violação' : `axe: ${lista.length} violações distintas`);
