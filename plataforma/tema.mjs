// O tema segue o aparelho, como no iPhone: escuro no escuro, claro no claro,
// sem botão. Este roteiro cobra isso tela por tela, nos dois lados.
//
// Por que um roteiro só para o tema: o `contraste.mjs` mede a cor do texto
// contra o fundo e o `acessibilidade.mjs` roda o axe — nenhum dos dois vê
// "a tela ficou em branco" nem "o painel continuou escuro no tema claro".
// Luminância é o que separa um tema do outro, então é ela que o teste olha.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = process.env.SAIDA ?? './tiros';

const navegador = await abrirNavegador();
const problemas = [];

/**
 * Luminância relativa da cor pintada, lida do próprio navegador.
 *
 * O mesmo truque do contraste.mjs: pinto a cor num canvas 1x1 sobre branco e
 * sobre preto e deduzo RGBA da diferença. Regex em `getComputedStyle` quebra —
 * o navegador devolve `oklab(...)` resolvido, e "oklab(0.98 ...)" lido como
 * RGB vira preto.
 */
const LUMINANCIA = `(cor) => {
  const tela = document.createElement('canvas');
  tela.width = tela.height = 1;
  const pincel = tela.getContext('2d', { willReadFrequently: true });
  const pinta = (base) => {
    pincel.clearRect(0, 0, 1, 1);
    pincel.fillStyle = base; pincel.fillRect(0, 0, 1, 1);
    pincel.fillStyle = cor;  pincel.fillRect(0, 0, 1, 1);
    return pincel.getImageData(0, 0, 1, 1).data;
  };
  const claro = pinta('#ffffff');
  const escuro = pinta('#000000');
  const a = Math.max(0, Math.min(1, 1 - (claro[0] - escuro[0]) / 255));
  const rgb = a < 0.004 ? [0, 0, 0] : [0, 1, 2].map((i) => Math.min(255, escuro[i] / a));
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}`;

async function luminanciaDe(p, seletor, prop) {
  return p.evaluate(
    ([sel, prp, fonte]) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      // eslint-disable-next-line no-eval
      const lum = eval(fonte);
      return lum(getComputedStyle(el)[prp]);
    },
    [seletor, prop, LUMINANCIA],
  );
}

async function entrar(p, email) {
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', 'x');
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle');
}

/** O que o teste chama de "visível": é a mesma conta em dois lugares. */
const AINDA_SUMIDO = `() => {
  const main = document.querySelector('main');
  if (!main) return ['sem <main>'];
  return [...main.querySelectorAll('*')]
    // Controle desabilitado fica fosco de propósito — é como ele diz que ainda
    // falta algo. O que o teste procura é o que deveria estar visível.
    .filter((e) => !e.closest('[disabled], [aria-disabled="true"]'))
    .filter((e) => e.offsetHeight > 40 && Number(getComputedStyle(e).opacity) < 0.9)
    .map((e) => e.tagName + '.' + String(e.className).slice(0, 30));
}`;

/**
 * Espera a animação de entrada terminar — esperando a CONDIÇÃO, não o relógio.
 *
 * A primeira versão disto dormia 900ms, porque a escada vai até 820ms (520 de
 * animação mais 300 de atraso no último cartão). Passou dez vezes e falhou na
 * décima primeira, quando a máquina estava ocupada com os outros roteiros: a
 * aba Contrato ainda tinha três cartões a meio caminho. Teste que depende de a
 * máquina estar folgada não é teste, é sorte — e o falso positivo custa mais
 * caro que o bug, porque ensina a ignorar o vermelho.
 *
 * Se nunca assentar, quem acusa é o `conferir()`, que diz qual elemento ficou.
 */
async function assentar(p) {
  await p.waitForLoadState('networkidle');
  try {
    await p.waitForFunction(`(${AINDA_SUMIDO})().length === 0`, null, { timeout: 8000 });
  } catch {
    /* segue: a asserção abaixo nomeia o que sobrou */
  }
}

async function conferir(p, tema, onde) {
  await assentar(p);
  const escuro = tema === 'dark';

  const fundo = await luminanciaDe(p, 'body', 'backgroundColor');
  // O fundo do body no tema claro é um degradê sobre --papel; a cor chapada por
  // baixo é o que vale para dizer de que lado estamos.
  if (escuro && fundo > 0.2) problemas.push(`[${tema} ${onde}] o fundo não está escuro (lum ${fundo?.toFixed(2)})`);
  if (!escuro && fundo < 0.7) problemas.push(`[${tema} ${onde}] o fundo não está claro (lum ${fundo?.toFixed(2)})`);

  const texto = await luminanciaDe(p, 'h1', 'color');
  if (texto === null) {
    problemas.push(`[${tema} ${onde}] não achei h1 para medir`);
  } else if (escuro && texto < 0.5) {
    problemas.push(`[${tema} ${onde}] texto escuro sobre fundo escuro (lum ${texto.toFixed(2)})`);
  } else if (!escuro && texto > 0.5) {
    problemas.push(`[${tema} ${onde}] texto claro sobre fundo claro (lum ${texto.toFixed(2)})`);
  }

  // Nada grande pode continuar invisível depois de assentar: pega o painel com
  // opacidade zero e a animação que travou de verdade.
  const sumidos = await p.evaluate(`(${AINDA_SUMIDO})()`);
  if (sumidos.length) {
    problemas.push(`[${tema} ${onde}] ficou invisível: ${sumidos.slice(0, 3).join(', ')}`);
  }

  await p.screenshot({ path: `${SAIDA}/tema-${tema}-${onde}.png`, fullPage: true });
}

for (const tema of ['dark', 'light']) {
  const ctx = await navegador.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: tema,
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problemas.push(`[${tema}] erro: ${e.message}`));

  await p.goto(BASE, { waitUntil: 'networkidle' });

  // A logo tem dois arquivos, não um com filtro: inverter comeria o quadradinho
  // verde da marca. Quem troca é o CSS, e é isso que se cobra aqui.
  const logo = await p.evaluate(() => {
    const vis = (s) => {
      const e = document.querySelector(s);
      return !!e && getComputedStyle(e).display !== 'none';
    };
    return { papel: vis('.marca-papel'), tinta: vis('.marca-tinta') };
  });
  const esperada = tema === 'dark' ? 'papel' : 'tinta';
  if (!logo[esperada]) problemas.push(`[${tema}] a logo ${esperada} não apareceu`);
  if (logo[esperada === 'papel' ? 'tinta' : 'papel']) {
    problemas.push(`[${tema}] as duas logos apareceram juntas`);
  }

  await conferir(p, tema, 'entrar');

  await entrar(p, 'viviane@astartstudio.com.br');
  await conferir(p, tema, 'inicio-equipe');

  const menu = p.getByRole('navigation', { name: 'Seções', exact: true });
  for (const item of ['Clientes', 'Aprovações', 'Agenda', 'Fila', 'Financeiro', 'Comercial', 'Feedbacks', 'Ajustes']) {
    await menu.getByRole('link', { name: item, exact: true }).click();
    await conferir(p, tema, item.toLowerCase().replace(/ç|õ/g, (c) => ({ 'ç': 'c', 'õ': 'o' }[c])));
  }

  // E o portal, que é o lado que o cliente abre do celular dele.
  await p.locator('button:has-text("sair"):visible').first().click();
  await p.waitForTimeout(300);
  await entrar(p, 'bruna@mormarcas.com.br');
  await conferir(p, tema, 'portal-inicio');

  const menuCliente = p.getByRole('navigation', { name: 'Seções', exact: true });
  for (const item of ['Para aprovar', 'Grid', 'Financeiro', 'Contrato', 'Meu site', 'Feedback']) {
    // "Para aprovar" carrega o selo com a contagem, entao o nome acessivel dele
    // e "Para aprovar 3": casar exato nao acha.
    await menuCliente.getByRole('link', { name: new RegExp(`^${item}`) }).first().click();
    await conferir(p, tema, `portal-${item.toLowerCase().replace(/ /g, '-')}`);
  }

  await ctx.close();
}

// A barra do navegador acompanha: no iPhone é ela que deixa o topo da tela
// preto ou branco junto com a página.
{
  const ctx = await navegador.newContext();
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'networkidle' });
  const metas = await p.evaluate(() =>
    [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('media')));
  if (!metas.some((m) => m?.includes('dark')) || !metas.some((m) => m?.includes('light'))) {
    problemas.push(`faltou theme-color para um dos temas: ${JSON.stringify(metas)}`);
  }
  const esquema = await p.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  if (!esquema.includes('dark') || !esquema.includes('light')) {
    problemas.push(`color-scheme não declara os dois temas: ${esquema}`);
  }
  await ctx.close();
}

await navegador.close();
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('tema: os dois lados, nos dois temas, tudo o que foi checado passou');
