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

// DUAS TELAS, e a do celular nao e enfeite: a "tela preta" que a dona viu
// quatro vezes aparecia no celular dela enquanto o computador parecia certo,
// porque a foto caia logo abaixo da dobra. Testar so em 1440x900 foi o que
// deixou isso passar.
const TELAS = [
  { nome: 'COMPUTADOR', opcoes: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  {
    nome: 'CELULAR',
    opcoes: {
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
        '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    },
  },
];

const b = await abrirNavegador();
const problemas = [];
const linha = (n, o, v) => console.log(`${n}. ${o.padEnd(28, '.')} ${v}`);

for (const tela of TELAS) {
console.log(`\n--- ${tela.nome} ---`);
const ctx = await b.newContext({ colorScheme: 'dark', acceptDownloads: true, ...tela.opcoes });
const p = await ctx.newPage();
p.on('pageerror', (e) => problemas.push(`erro na pagina (${tela.nome}): ` + e.message));

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
// `.last()`: ha dois <header> na pagina — o da marca, com a logo pequena, e o
// do album, com a capa. O `.first()` pegava a LOGO, e media a logo achando que
// media a capa.
const capa = p.locator('header img').last();
let capaOk = false;
if (!(await capa.count())) {
  linha(2, 'a capa aparece', 'NAO HA IMAGEM DE CAPA');
  problemas.push('a capa nao carregou');
} else {
  await capa.evaluate((e) => (e.complete ? null : new Promise((r) => { e.onload = r; e.onerror = r; }))).catch(() => {});
  const m = await capa.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { nat: e.naturalWidth, caixa: Math.round(r.width) };
  });
  capaOk = m.nat > 0;
  linha(2, 'a capa aparece', capaOk ? `imagem de ${m.nat}px numa caixa de ${m.caixa}px` : 'NAO');
  if (!capaOk) problemas.push('a capa nao carregou');

  // A CAPA ESTA SENDO AMPLIADA?
  //
  // A dona escreveu "a qualidade da capa ta ruim", e estava: a capa saia da
  // MINIATURA de 640px, esticada para a largura da tela. Nenhum
  // redimensionador inventa detalhe que nao esta no arquivo — pedir 1800 de
  // uma imagem de 640 devolve 1800 borrados.
  //
  // "A capa carregou" passava com o defeito. "A capa tem pixel suficiente"
  // nao passa.
  //
  // Cobro contra a caixa em CSS, e nao contra a caixa vezes o dpr: o original
  // tem 2048 de lado e numa tela retina de 1440 faltaria sempre. Teste que nao
  // da para satisfazer nao e teste, e barulho.
  if (capaOk && m.nat < m.caixa) {
    problemas.push(`a capa esta sendo ampliada: ${m.nat}px numa caixa de ${m.caixa}px`);
  }
}

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
const escolher = p.locator('button[aria-label^="Escolher"]').first();
await escolher.click();
await p.waitForTimeout(900);
const depois = await p.locator('button[aria-pressed="true"]').count();
linha(5, 'favoritar', depois > antes ? 'funciona' : 'NAO funciona');
if (depois <= antes) problemas.push('favoritar nao marcou');
// DESMARCA. O favorito e da cliente: e com ele que ela diz quais fotos quer.
// Teste que deixa coracao marcado faz a agencia revelar foto que ninguem
// escolheu. A primeira versao disto deixou tres.
await p.locator('button[aria-label^="Tirar"]').first().click().catch(() => {});
await p.waitForTimeout(700);

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
      topo: Math.round(r.top), base: Math.round(r.bottom),
      nl: e.naturalWidth, na: e.naturalHeight,
      jl: innerWidth, ja: innerHeight,
    };
  });
  const cabe = m.a <= m.ja + 2 && m.l <= m.jl + 2;
  // DO TAMANHO CERTO *E* NA TELA. Medir so o tamanho foi o erro que deixou a
  // "tela preta" passar quatro vezes: a foto estava carregada, do tamanho
  // exato, e desenhada a 4341px do topo — fora da janela, atras do fundo
  // escuro. Ver o comentario do `.entra` em global.css.
  const naTela = m.topo >= -2 && m.base <= m.ja + 2;
  linha(6, 'a lupa', `foto ${m.nl}x${m.na} em ${m.l}x${m.a}, topo ${m.topo}px (janela ${m.jl}x${m.ja}) — ${cabe && naTela ? 'aparece inteira' : 'NAO APARECE'}`);
  if (!cabe) problemas.push(`a foto da lupa nao cabe: ${m.l}x${m.a} em ${m.jl}x${m.ja}`);
  if (!naTela) problemas.push(`a foto da lupa esta fora da tela: topo ${m.topo}px, base ${m.base}px, janela ${m.ja}px`);
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

await ctx.close();
}

await b.close();
console.log('');
if (problemas.length) {
  console.log('PROBLEMAS:\n' + problemas.map((x) => '  · ' + x).join('\n'));
  process.exit(1);
}
console.log('A entrega funciona do inicio ao fim.');
