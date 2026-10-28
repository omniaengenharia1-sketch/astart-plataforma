// A jornada da cliente, em PRODUCAO, pelo link de verdade.
//
// Nao substitui `galeria.mjs`: aquele roda em modo exemplo, e e la que estao os
// defeitos de regra (quem ve qual botao, a lixeira, o menu). Este cobre o que
// SO existe contra o Supabase de verdade — foto grande, bucket privado, URL
// assinada em outro dominio — que foi exatamente onde os tres ultimos defeitos
// da entrega se esconderam.
//
// Rode com o link de diagnostico, nunca com o da cliente:
//   node entrega-producao.mjs https://astart-plataforma.pages.dev/g/<token>

import { abrirNavegador } from './navegador.mjs';

const ENDERECO = process.argv[2];
if (!ENDERECO) {
  console.log('Falta o endereco da galeria. Ex.: node entrega-producao.mjs https://.../g/<token>');
  process.exit(1);
}

const b = await abrirNavegador();
const ctx = await b.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
  deviceScaleFactor: 2,
  acceptDownloads: true,
});
const p = await ctx.newPage();
const problemas = [];
p.on('pageerror', (e) => problemas.push('erro na pagina: ' + e.message));

const linha = (n, o, v) => console.log(`${n}. ${o.padEnd(28, '.')} ${v}`);

// 1 — abre, e em quanto tempo
const t0 = Date.now();
await p.goto(ENDERECO, { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(800);
const segundos = ((Date.now() - t0) / 1000).toFixed(1);
linha(1, 'a pagina abre', `${segundos}s`);
if (Number(segundos) > 12) problemas.push(`a pagina levou ${segundos}s para abrir`);

const txt = await p.locator('body').innerText();
if (/não abre nenhuma galeria|link inválido|não consegui/i.test(txt)) {
  console.log('\nO link nao abriu:\n' + txt.slice(0, 300));
  await b.close();
  process.exit(1);
}

// 2 — a capa CARREGOU? `naturalWidth` e a unica pergunta que pega capa
// assinada errado: ela e 0 quando a imagem nao carregou, qualquer que seja o
// motivo. Foi assim que a capa ficou quebrada desde a 0034.
const capa = p.locator('header img').first();
let capaOk = false;
if (await capa.count()) {
  await capa.evaluate((e) => (e.complete ? null : new Promise((r) => { e.onload = r; e.onerror = r; }))).catch(() => {});
  capaOk = await capa.evaluate((e) => e.naturalWidth > 0);
}
linha(2, 'a capa aparece', capaOk ? 'sim' : 'NAO');
if (!capaOk) problemas.push('a capa nao carregou');

// 3 — o titulo
const titulo = (await p.locator('h1, h2').first().innerText().catch(() => '')).trim();
linha(3, 'o titulo', `"${titulo}"`);
if (!titulo) problemas.push('a galeria abriu sem titulo');

// 4 — as fotos
const fotos = await p.locator('figure img').count();
linha(4, 'fotos na grade', String(fotos));
if (fotos < 1) problemas.push('a grade abriu sem foto');

// 5 — favoritar
const antes = await p.locator('button[aria-pressed="true"]').count();
await p.locator('button[aria-label^="Escolher"]').first().click();
await p.waitForTimeout(900);
const depois = await p.locator('button[aria-pressed="true"]').count();
linha(5, 'favoritar', depois > antes ? 'funciona' : 'NAO funciona');
if (depois <= antes) problemas.push('favoritar nao marcou');

// 6 — a lupa: a foto CABE? Era o "fundo preto" que a dona viu tres vezes. A
// janela de 1440x900 e menor que a foto (1365x2048), entao a altura tem de
// limitar; se nao limitar, transborda e sobra fundo preto na tela.
await p.locator('button[aria-label^="Abrir"]').first().click();
await p.waitForTimeout(2500);
const naLupa = p.locator('div[role="dialog"] img').first();
if (!(await naLupa.count())) {
  linha(6, 'a lupa', 'ABRIU SEM IMAGEM');
  problemas.push('a lupa abriu sem imagem');
} else {
  const m = await naLupa.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return {
      l: Math.round(r.width), a: Math.round(r.height),
      nl: e.naturalWidth, na: e.naturalHeight,
      jl: innerWidth, ja: innerHeight,
    };
  });
  const cabe = m.a <= m.ja + 2 && m.l <= m.jl + 2;
  linha(6, 'a lupa', `foto ${m.nl}x${m.na} desenhada em ${m.l}x${m.a} (janela ${m.jl}x${m.ja}) — ${cabe ? 'cabe' : 'NAO CABE'}`);
  if (!cabe) problemas.push(`a foto da lupa nao cabe: ${m.l}x${m.a} em ${m.jl}x${m.ja}`);
  if (m.nl === 0) problemas.push('a foto da lupa nao carregou');
}
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

// 7 — BAIXAR. O passo que estava quebrado: o navegador abria a foto numa aba
// porque `<a download>` nao vale para outro dominio. Aqui a foto ESTA em outro
// dominio, entao esta e a verificacao que vale.
const botao = p.locator('figure button', { hasText: /^baixar$/ }).first();
if (!(await botao.count())) {
  linha(7, 'baixar uma foto', 'SEM BOTAO DE BAIXAR');
  problemas.push('nao ha botao de baixar na grade');
} else {
  await botao.scrollIntoViewIfNeeded();
  await botao.hover();
  try {
    const [baixa] = await Promise.all([
      p.waitForEvent('download', { timeout: 30000 }),
      botao.click(),
    ]);
    const nome = await baixa.suggestedFilename();
    const pediu = baixa.url().includes('download=');
    linha(7, 'baixar uma foto', `baixou "${nome}"${pediu ? '' : ' (sem pedir attachment!)'}`);
    if (!nome) problemas.push('o download veio sem nome');
    // Sem `download=` na URL o arquivo so baixou por sorte do navegador do dia.
    if (!pediu) problemas.push('a URL do download nao pede attachment');
    await baixa.delete();
  } catch {
    linha(7, 'baixar uma foto', 'NAO BAIXOU');
    problemas.push('clicar em baixar nao baixou nada');
  }
}

await b.close();
console.log('');
if (problemas.length) {
  console.log('PROBLEMAS:\n' + problemas.map((x) => '  · ' + x).join('\n'));
  process.exit(1);
}
console.log('A entrega funciona do inicio ao fim.');
