// Contraste medido na tela, não no token.
//
// Em vidro o token mente: "--tinta-3 sobre --superficie" não diz nada, porque
// a superfície é translúcida e o que vale é a COMPOSIÇÃO dela com o campo.
// Então o teste pergunta ao navegador a cor real de cada texto e empilha as
// camadas de fundo até achar a primeira opaca, compondo alfa por alfa.
//
// Duas regras que custaram uma rodada errada cada:
//   1. Parada de degradê com alfa é camada translúcida, não cor chapada.
//      Tratar rgba(255,61,154,.3) como pink puro reprovava meia interface.
//   2. O fundo de um texto é a primeira camada opaca ABAIXO dele. Somar todas
//      as camadas do caminho como candidatas mede o texto do botão contra o
//      painel atrás do botão — que ninguém vê.
import { abrirNavegador } from './navegador.mjs';

const BASE = 'http://localhost:4178';
const b = await abrirNavegador();

const MEDIDA = `(() => {
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const razao = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  // Ler a cor com regex quebrou aqui: o navegador devolve oklab(...) e
  // color-mix(...) resolvidos, e "oklab(0.98 0.006 -0.005 / 0.62)" vira
  // [0.98, 0.006, -0.005] — preto, em vez de quase branco. Então quem converte
  // é o próprio navegador: pinto a cor sobre branco e sobre preto e deduzo
  // RGBA da diferença. Funciona para qualquer sintaxe que o CSS aceitar.
  const tela = document.createElement('canvas');
  tela.width = tela.height = 1;
  const pincel = tela.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const cor = (s) => {
    if (cache.has(s)) return cache.get(s);
    const pinta = (base) => {
      pincel.globalCompositeOperation = 'source-over';
      pincel.clearRect(0, 0, 1, 1);
      pincel.fillStyle = base;
      pincel.fillRect(0, 0, 1, 1);
      pincel.fillStyle = s;
      pincel.fillRect(0, 0, 1, 1);
      return pincel.getImageData(0, 0, 1, 1).data;
    };
    const claro = pinta('#ffffff');
    const escuro = pinta('#000000');
    const a = Math.max(0, Math.min(1, 1 - (claro[0] - escuro[0]) / 255));
    const rgb = a < 0.004 ? [0, 0, 0] : [0, 1, 2].map((i) => Math.min(255, escuro[i] / a));
    const saida = [...rgb, a];
    cache.set(s, saida);
    return saida;
  };
  const sobre = (c, base) =>
    c[3] >= 1 ? c.slice(0, 3) : c.slice(0, 3).map((v, i) => v * c[3] + base[i] * (1 - c[3]));

  const CAMPO = [6, 6, 11];

  /** As camadas entre o texto e o opaco, de cima para baixo. */
  const camadasDe = (el) => {
    const camadas = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const img = cs.backgroundImage;
      const bg = cor(cs.backgroundColor);
      let opacou = false;
      if (img && img !== 'none' && /gradient/.test(img)) {
        const paradas = (img.match(/rgba?\\([^)]+\\)/g) || []).map(cor);
        if (paradas.length) {
          camadas.push({ paradas });
          opacou = paradas.every((p) => p[3] >= 1);
        }
      }
      if (bg[3] > 0) {
        camadas.push({ paradas: [bg] });
        if (bg[3] >= 1) opacou = true;
      }
      if (opacou) return { camadas, base: null };
    }
    return { camadas, base: CAMPO };
  };

  /** Todos os fundos possíveis (um por parada de degradê), já compostos. */
  const fundosDe = (el) => {
    const { camadas, base } = camadasDe(el);
    let fundos = [base ?? camadas[camadas.length - 1].paradas[0].slice(0, 3)];
    if (base === null) {
      const ultima = camadas.pop();
      fundos = ultima.paradas.map((p) => p.slice(0, 3));
    }
    for (let i = camadas.length - 1; i >= 0; i--) {
      const prox = [];
      for (const f of fundos) for (const p of camadas[i].paradas) prox.push(sobre(p, f));
      fundos = prox;
    }
    return fundos;
  };

  const achados = [];
  for (const el of document.querySelectorAll('body *')) {
    const texto = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim())
      .join(' ');
    if (!texto) continue;
    const e = getComputedStyle(el);
    if (e.visibility === 'hidden' || e.display === 'none' || Number(e.opacity) < 0.1) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;

    const fundos = fundosDe(el);
    const frente = cor(e.color);
    const px = parseFloat(e.fontSize);
    const peso = Number(e.fontWeight) || 400;
    const grande = px >= 24 || (px >= 18.66 && peso >= 700);
    const exigido = grande ? 3 : 4.5;
    const medido = Math.min(...fundos.map((f) => razao(sobre(frente, f), f)));
    if (medido < exigido) {
      achados.push({
        texto: texto.slice(0, 44),
        classe: (el.className?.toString() || el.tagName).slice(0, 52),
        px, medido: Math.round(medido * 100) / 100, exigido,
      });
    }
  }
  return achados;
})()`;

const TELAS = [
  ['equipe', 'layana@astartstudio.com.br',
    ['Clientes', 'Aprovações', 'Agenda', 'Fila', 'Financeiro', 'Comercial', 'Feedbacks', 'Ajustes']],
  ['cliente', 'bruna@mormarcas.com.br',
    ['Para aprovar', 'Meu projeto', 'Grid', 'Financeiro', 'Contrato', 'Meu site', 'Feedback']],
];

const vistos = new Map();
for (const claro of [false, true]) {
  for (const [nome, email, abas] of TELAS) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 980 }, colorScheme: claro ? 'light' : 'dark' });
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'networkidle' });
    const tema = claro ? 'claro' : 'escuro';

    const guarda = (onde, lista) => {
      for (const a of lista) {
        const chave = `${tema}|${a.classe}|${a.medido}`;
        if (!vistos.has(chave)) vistos.set(chave, { ...a, tema, onde });
      }
    };

    guarda('entrar', await p.evaluate(MEDIDA));
    await p.fill('input[type="email"]', email);
    await p.fill('input[type="password"]', 'x');
    await p.click('button[type="submit"]');
    await p.waitForLoadState('networkidle');

    for (const aba of ['início', ...abas]) {
      if (aba !== 'início') {
        await p.getByRole('link', { name: new RegExp('^' + aba) }).first().click();
        await p.waitForTimeout(350);
      }
      guarda(`${nome}/${aba}`, await p.evaluate(MEDIDA));
    }
    await ctx.close();
  }
}
await b.close();

const lista = [...vistos.values()].sort((a, b) => a.medido - b.medido);
for (const a of lista) {
  console.log(`[${a.tema} · ${a.onde}] ${a.medido}:1 (precisa ${a.exigido}) ${a.px}px "${a.texto}" — ${a.classe}`);
}
console.log(lista.length === 0
  ? 'contraste: nenhum texto abaixo do mínimo'
  : `contraste: ${lista.length} casos distintos abaixo do mínimo`);
