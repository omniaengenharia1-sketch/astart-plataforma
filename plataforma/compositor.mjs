// O compositor: a publicação inteira numa tela, do jeito que a dona descreveu —
// arquivo, canal, legenda, hashtags, e embaixo agendar ou postar agora.
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
//
// Depois da 0055 ele cobra mais duas, e as duas são sobre a tela mentir:
//
//   - o canal é UMA escolha (conta × formato), e a fileira de chips aparece por
//     perfil, com o @ em cima. Duas perguntas separadas deixavam montar Reel
//     numa Página do Facebook.
//   - carrossel com vídeo é RECUSADO no anexo, com a frase que diz que a
//     limitação é nossa. O modo exemplo aceitava — e é nele que este roteiro
//     roda, então a mentira era invisível para todos os roteiros.
import { abrirNavegador } from './navegador.mjs';
import { readFileSync } from 'node:fs';

const AXE = readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = process.env.SAIDA ?? './tiros';
const falhas = [];
const cobrar = (ok, o) => { if (!ok) falhas.push(o); console.log(`${ok ? 'OK  ' : 'FALHOU  '}${o}`); };

// Um JPEG 1x1 de verdade: a 0047 recusa PNG, porque a Meta so publica JPEG.
const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDP/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVEAEBAAAAAAAAAAAAAAAAAAAAAf/EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFREBAQAAAAAAAAAAAAAAAAAAAAH/2gAMAwEAAhEDEQA/AJQA/9k=',
  'base64',
);
const foto = (nome) => ({ name: nome, mimeType: 'image/jpeg', buffer: JPG });
// Um "vídeo" de um byte: o que importa aqui é o mime, que é o que a regra lê.
const video = (nome) => ({ name: nome, mimeType: 'video/mp4', buffer: Buffer.from([0]) });

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
cobrar(
  /ONDE E EM QUE FORMATO/i.test(inicio) && /Carrossel/.test(inicio),
  'pergunta o canal — rede e formato juntos — e oferece os quatro formatos',
);
cobrar(/LEGENDA/i.test(inicio) && /HASHTAGS/i.test(inicio), 'legenda e hashtags em campos separados');
cobrar(/QUANDO/i.test(inicio), 'e a hora de publicar');
// Dito no comeco, nao no botao: e o que faz a publicacao nao sair.
cobrar(
  /não tem conta conectada/i.test(inicio),
  'avisa de cara quando o cliente nao tem conta conectada',
);
// Sem conta nao ha canal, e sem canal nao haveria como escolher formato: a
// publicacao nasceria sempre "Post". Escrever e guardar sem conta e caminho de
// proposito, entao os quatro chips de formato continuam de pe.
cobrar(
  !(await p.getByRole('button', { name: 'Carrossel' }).isDisabled()),
  'e sem conta conectada ainda da para escolher o formato e guardar o rascunho',
);

// --- o canal: uma escolha, por perfil (0055) -------------------------------
//
// Conecta uma conta de verdade pelo caminho da tela e volta ao compositor. Sem
// isto, este roteiro so veria o compositor no estado em que ele tem MENOS a
// dizer — o estado sem conta, que e justamente o que a fileira de chips nao
// exercita.
await p.getByRole('button', { name: 'Fechar' }).first().click();
await p.getByRole('button', { name: 'Conectar conta' }).click();
await p.getByText('o que o token da agência alcança').waitFor({ timeout: 10000 });
await p.getByRole('button', { name: 'Ligar a este cliente' }).first().click();
await p.waitForTimeout(700);

await p.getByRole('button', { name: 'Nova publicação' }).click();
await p.getByText('nova publicação').first().waitFor({ timeout: 10000 });
const comConta = await painel();
cobrar(
  /@mormarcas/i.test(comConta),
  'com a conta ligada, a fileira de chips vem com o @ do perfil em cima',
);
cobrar(
  !/não tem conta conectada/i.test(comConta),
  'e o aviso de "sem conta" sai da tela',
);
cobrar(
  (await p.locator('button[aria-pressed]').count()) >= 4,
  'os chips de canal sao botoes de alternancia, nao caixas de marcar',
);
// Sem conta o padrao era Post; com conta, o primeiro canal que publica manda —
// e ele e o Post do Instagram. Quem tem um perfil so nao marca nada.
cobrar(
  (await p.locator('button[aria-pressed=true]').count()) === 1,
  'um canal ja vem marcado: quem tem um perfil so nao precisa marcar nada',
);

// --- carrossel com video e recusado NO ANEXO (0056) ------------------------
await p.getByLabel('Nome interno').fill('Carrossel de teste');
await p.getByRole('button', { name: 'Carrossel' }).click();
await p.getByRole('button', { name: 'Criar rascunho' }).click();
await p.waitForTimeout(800);
await p.locator('input[type=file]').first().setInputFiles(video('clipe.mp4'));
await p.waitForTimeout(800);
const recusa = await painel();
cobrar(
  /limitacao nossa/i.test(recusa) && /nao da Meta/i.test(recusa),
  'carrossel com video e recusado no anexo, dizendo que a limitacao e NOSSA',
);
// A frase inteira, nao so a palavra "Reel": "Reel" aparece tambem no chip do
// formato, entao a versao curta desta verificacao passava mesmo com a recusa
// ausente. Verificacao que nao morde e pior que verificacao nenhuma — ela da
// confianca.
cobrar(
  /ou um Reel para o video/i.test(recusa),
  'e a recusa diz o que fazer em vez de so dizer que nao pode',
);

// --- e o caminho que funciona ---------------------------------------------
await p.getByRole('button', { name: 'Fechar' }).first().click();
await p.getByRole('button', { name: 'Nova publicação' }).click();
await p.getByText('nova publicação').first().waitFor({ timeout: 10000 });
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

await p.locator('input[type=file]').first().setInputFiles(foto('uma.jpg'));
await p.waitForTimeout(800);
cobrar(
  await p.getByRole('button', { name: 'Agendar' }).isDisabled(),
  'com um arquivo so, o carrossel continua incompleto',
);

await p.locator('input[type=file]').first().setInputFiles(foto('duas.jpg'));
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
