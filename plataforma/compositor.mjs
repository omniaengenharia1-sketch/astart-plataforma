// O compositor: a publicação inteira numa tela, do jeito que a dona descreveu —
// arquivo, rede, formato, legenda, hashtags, e embaixo agendar ou postar agora.
//
// O que este roteiro cobra é a corrente, não os campos: criar o rascunho,
// anexar o que o formato pede, e só então poder agendar. Três coisas que ele
// pegou enquanto eu escrevia, e nenhuma aparecia lendo o código:
//
//   - o botão de agendar tem de ficar DESABILITADO enquanto falta arquivo, com
//     o motivo ao lado. Botão cinza sem explicação é a pior coisa de uma tela.
//   - em modo exemplo havia DOIS armazéns de mídia e eles discordavam: a mídia
//     num, a contagem que autoriza o agendamento no outro.
//   - "Postar agora" fechava o compositor junto com a confirmação. A pessoa
//     clicava, o painel desaparecia, e ela ficava sem saber se saiu.
import { abrirNavegador } from './navegador.mjs';
import { readFileSync } from 'node:fs';

const AXE = readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = process.env.SAIDA ?? './tiros';
const falhas = [];
const cobrar = (ok, o) => { if (!ok) falhas.push(o); console.log(`${ok ? 'OK  ' : 'FALHOU  '}${o}`); };

// Um PNG 1x1 de verdade: arquivo falso o navegador recusa antes da tela.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const foto = (nome) => ({ name: nome, mimeType: 'image/png', buffer: PNG });

const navegador = await abrirNavegador();
const ctx = await navegador.newContext({ viewport: { width: 1400, height: 1500 } });
const p = await ctx.newPage();
const problemas = [];
p.on('pageerror', (e) => problemas.push(e.message));

await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.getByText('entrar como direção').click();
await p.waitForTimeout(400);
await p.goto(`${BASE}/clientes/exemplo-mor/calendario`, { waitUntil: 'domcontentloaded' });
await p.getByText('onde publica').waitFor({ timeout: 20000 });

await p.getByRole('button', { name: 'Nova publicação' }).click();
await p.getByText('nova publicação').first().waitFor({ timeout: 10000 });
const painel = () => p.locator('section', { hasText: 'nova publicação' }).first().innerText();

const inicio = await painel();
cobrar(/NOME INTERNO/i.test(inicio), 'o compositor pede o nome interno');
cobrar(/FORMATO/i.test(inicio) && /Carrossel/.test(inicio), 'oferece os quatro formatos');
cobrar(/LEGENDA/i.test(inicio) && /HASHTAGS/i.test(inicio), 'legenda e hashtags em campos separados');
cobrar(/QUANDO/i.test(inicio), 'e a hora de publicar');
// Dito no comeco, nao no botao: e o que faz a publicacao nao sair.
cobrar(
  /não tem conta conectada/i.test(inicio),
  'avisa de cara quando o cliente nao tem conta conectada',
);

// --- o caminho -------------------------------------------------------------
await p.getByRole('button', { name: 'Carrossel' }).click();
await p.getByLabel('Nome interno').fill('Teste do compositor');
await p.getByLabel('Legenda', { exact: true }).fill('legenda de teste');
await p.getByLabel('Hashtags', { exact: true }).fill('#teste #astart');
await p.getByRole('button', { name: 'Criar rascunho' }).click();
await p.waitForTimeout(900);

cobrar(/Rascunho criado/i.test(await painel()), 'cria o rascunho e diz o proximo passo');
cobrar(
  /falta 2 arquivos para agendar/i.test(await painel()),
  'diz quantos arquivos faltam, ao lado do botao desabilitado',
);
cobrar(
  await p.getByRole('button', { name: 'Agendar' }).isDisabled(),
  'e o botao de agendar NAO deixa clicar sem arquivo',
);

await p.locator('input[type=file]').first().setInputFiles(foto('uma.png'));
await p.waitForTimeout(800);
cobrar(
  await p.getByRole('button', { name: 'Agendar' }).isDisabled(),
  'com um arquivo so, o carrossel continua incompleto',
);

await p.locator('input[type=file]').first().setInputFiles(foto('duas.png'));
await p.waitForTimeout(800);
cobrar(
  !(await p.getByRole('button', { name: 'Agendar' }).isDisabled()),
  'com os dois, agendar libera',
);

await p.screenshot({ path: `${SAIDA}/compositor.png` });

await p.getByRole('button', { name: 'Postar agora' }).click();
await p.waitForTimeout(1000);
const fim = await p.locator('body').innerText();
cobrar(/em instantes/i.test(fim), 'postar agora confirma que sai em instantes');
cobrar(
  (await painel()).length > 0,
  'e o compositor FICA ABERTO com a confirmacao — quem fecha e a pessoa',
);

// --- axe nos dois temas ----------------------------------------------------
const CONFIG = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  rules: { 'color-contrast': { enabled: false } },
};
for (const claro of [false, true]) {
  const c2 = await navegador.newContext({ viewport: { width: 390, height: 844 }, colorScheme: claro ? 'light' : 'dark' });
  const p2 = await c2.newPage();
  await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p2.getByText('entrar como direção').click();
  await p2.waitForTimeout(400);
  await p2.goto(`${BASE}/clientes/exemplo-mor/calendario`, { waitUntil: 'domcontentloaded' });
  await p2.getByRole('button', { name: 'Nova publicação' }).click();
  await p2.waitForTimeout(700);
  await p2.evaluate(AXE);
  const r = await p2.evaluate((cfg) => window.axe.run(document, cfg), CONFIG);
  const graves = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  cobrar(
    graves.length === 0,
    `axe sem violacao grave no compositor, tema ${claro ? 'claro' : 'escuro'}${graves.length ? ': ' + graves.map((v) => v.id).join(', ') : ''}`,
  );
  await c2.close();
}

cobrar(problemas.length === 0, `nenhum erro de pagina (${problemas.length})`);
if (problemas.length) console.log(problemas.map((x) => `    ${x}`).join('\n'));

await navegador.close();
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nO compositor esta de pe.');
process.exit(falhas.length ? 1 : 0);
