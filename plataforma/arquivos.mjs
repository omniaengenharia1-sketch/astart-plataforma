// Os arquivos do cliente: contrato, proposta, relatório de campanha.
//
// O que este roteiro cobra é a corrente que o banco não alcança: que o TIPO
// escolhido antes de arrastar decide quem vê o arquivo, que a proposta com
// preço de custo NÃO aparece no portal do cliente, e que o relatório aparece
// para ele na hora.
//
// A regra da visibilidade está escrita em dois lugares — na função do banco
// (0053) e no modo exemplo. Se as duas discordarem, é aqui que aparece.
import { abrirNavegador } from './navegador.mjs';
import { readFileSync } from 'node:fs';

const AXE = readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = process.env.SAIDA ?? './tiros';
const falhas = [];
const cobrar = (ok, o) => { if (!ok) falhas.push(o); console.log(`${ok ? 'OK  ' : 'FALHOU  '}${o}`); };

// Um PDF minúsculo e válido. O bucket aceita application/pdf, e o modo exemplo
// confere o MIME igual: arquivo de mentira com extensão certa serve.
const PDF = Buffer.from(
  'JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAw' +
  'IG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8' +
  'PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA5OSA5OV0+PgplbmRvYmoKdHJh' +
  'aWxlcgo8PC9Sb290IDEgMCBSPj4K',
  'base64',
);
const pdf = (nome) => ({ name: nome, mimeType: 'application/pdf', buffer: PDF });

const navegador = await abrirNavegador();
const ctx = await navegador.newContext({ viewport: { width: 1400, height: 1400 } });
const p = await ctx.newPage();
const problemas = [];
p.on('pageerror', (e) => problemas.push(e.message));

const limpo = async () => (await p.locator('body').innerText()).toLowerCase();

await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.getByText('entrar como direção').click();
await p.waitForTimeout(400);

// ---------------------------------------------------------------------------
// A equipe, na aba Contrato
// ---------------------------------------------------------------------------
await p.goto(`${BASE}/clientes/exemplo-mor/contrato`, { waitUntil: 'domcontentloaded' });
await p.getByText('documentos').first().waitFor({ timeout: 20000 });

const painel = () => p.locator('section', { hasText: 'documentos' }).first().innerText();

cobrar((await painel()).includes('Contrato Mor Marcas'), 'a equipe vê o contrato anexado');
cobrar(
  (await painel()).includes('Proposta com margem'),
  'e vê a proposta interna também',
);
cobrar(
  /o cliente vê/i.test(await painel()) && /só a equipe/i.test(await painel()),
  'cada linha diz QUEM vê — contrato e proposta não têm a mesma regra',
);

// O tipo vem antes do arquivo, e a dica muda com ele.
await p.getByRole('button', { name: 'Proposta', exact: true }).click();
cobrar(
  (await painel()).includes('fica só com a equipe'),
  'escolher "proposta" avisa que fica só com a equipe',
);
await p.getByRole('button', { name: 'Contrato', exact: true }).click();
cobrar(
  (await painel()).includes('o cliente vê no portal dele'),
  'e escolher "contrato" avisa que o cliente vê',
);

await p.screenshot({ path: `${SAIDA}/arq-01-documentos.png`, fullPage: true });

// Anexar um contrato: nasce VISÍVEL, que foi a decisão da dona.
await p.locator('section', { hasText: 'documentos' }).first()
  .locator('input[type=file]')
  .setInputFiles(pdf('Contrato 2027 assinado.pdf'));
await p.waitForTimeout(600);
cobrar((await painel()).includes('Contrato 2027'), 'o contrato anexado aparece na lista');

// `innerText` devolve o texto COMO A TELA MOSTRA, e a etiqueta usa
// `uppercase` no CSS — entao a comparacao e sem caixa. Comparar com caixa aqui
// foi o que fez este roteiro acusar um erro que nao existia.
const linhaNova = p.locator('li', { hasText: 'Contrato 2027' }).first();
cobrar(
  /o cliente vê/i.test(await linhaNova.innerText()),
  'contrato nasce VISÍVEL ao cliente — anexar um contrato já é entregar',
);

// Anexar uma proposta: nasce FECHADA.
await p.getByRole('button', { name: 'Proposta', exact: true }).click();
await p.locator('section', { hasText: 'documentos' }).first()
  .locator('input[type=file]')
  .setInputFiles(pdf('Proposta 2027 com margem.pdf'));
await p.waitForTimeout(600);
const linhaProposta = p.locator('li', { hasText: 'Proposta 2027' }).first();
cobrar(
  /só a equipe/i.test(await linhaProposta.innerText()),
  'proposta nasce FECHADA — ela tem preço de custo',
);

await p.screenshot({ path: `${SAIDA}/arq-02-anexados.png`, fullPage: true });

// ---------------------------------------------------------------------------
// O relatório de campanha
// ---------------------------------------------------------------------------
await p.goto(`${BASE}/clientes/exemplo-pub/campanhas`, { waitUntil: 'domcontentloaded' });
await p.getByText('anexar relatório').waitFor({ timeout: 20000 });

cobrar(
  (await limpo()).includes('o cliente vê assim que você sobe'),
  'o painel avisa que o relatório vai para o cliente na hora',
);
cobrar(
  (await limpo()).includes('reenviar o mesmo período troca o arquivo'),
  'e avisa que reenviar troca, em vez de duplicar',
);

await p.locator('section', { hasText: 'anexar relatório' })
  .locator('input[type=file]')
  .setInputFiles(pdf('Resultado de outubro.pdf'));
await p.waitForTimeout(700);
cobrar(
  (await limpo()).includes('no ar. o cliente já consegue abrir'),
  'confirma o envio dizendo o que mudou para o cliente',
);

await p.screenshot({ path: `${SAIDA}/arq-03-relatorio.png`, fullPage: true });

// ---------------------------------------------------------------------------
// O PORTAL DO CLIENTE — a cobrança que mais importa deste arquivo
// ---------------------------------------------------------------------------
await p.locator('button:has-text("sair"):visible').first().click();
await p.waitForTimeout(300);
await p.getByText('entrar como cliente').click();
await p.waitForTimeout(500);

// O portal do cliente mora em /portal, e as abas dele sao /portal/<aba>.
// Pedir /contrato cai no inicio do portal, e o roteiro acusava "o cliente nao
// ve o contrato" quando o que acontecia era eu nunca ter aberto a aba.
await p.goto(`${BASE}/portal/contrato`, { waitUntil: 'domcontentloaded' });
await p.getByText('documentos').first().waitFor({ timeout: 20000 });
const doCliente = await limpo();

cobrar(
  doCliente.includes('contrato mor marcas') || doCliente.includes('contrato 2027'),
  'o cliente vê o contrato dele',
);
// A linha que justifica a chave de visibilidade existir.
cobrar(
  !doCliente.includes('margem'),
  'e NAO vê nenhuma proposta com margem — nem a antiga, nem a que acabou de subir',
);
cobrar(
  !/mostrar ao cliente|esconder|tirar/i.test(doCliente),
  'o cliente não vê os botões de mexer nos documentos',
);

await p.screenshot({ path: `${SAIDA}/arq-04-portal-cliente.png`, fullPage: true });

// ---------------------------------------------------------------------------
// Acessibilidade, nos dois temas
// ---------------------------------------------------------------------------
await p.goto(`${BASE}/clientes/exemplo-mor/contrato`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(400);
await p.addScriptTag({ content: AXE });
for (const tema of ['dark', 'light']) {
  await p.emulateMedia({ colorScheme: tema });
  await p.waitForTimeout(250);
  const r = await p.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
  const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  cobrar(graves.length === 0, `axe sem violacao grave nos documentos, tema ${tema === 'dark' ? 'escuro' : 'claro'}`
    + (graves.length ? `: ${graves.map((v) => v.id).join(', ')}` : ''));
}

cobrar(problemas.length === 0, `nenhum erro de pagina (${problemas.length})`);
if (problemas.length) console.log(problemas.join('\n'));

await navegador.close();
if (falhas.length) {
  console.log(`\nPROBLEMAS (${falhas.length}):\n` + falhas.join('\n'));
  process.exit(1);
}
console.log('\nOs arquivos do cliente estao de pe.');
