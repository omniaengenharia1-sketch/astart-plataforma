// O arquivo da peça, do jeito que a pessoa faz: abre a peça e arrasta.
//
// Este roteiro existe porque o caminho da mídia tem regras que só aparecem na
// hora: reel pede vídeo, imagem aceita um arquivo, carrossel aceita dez, e peça
// no ar não muda mais. Cada uma dessas é uma mensagem na tela, e mensagem que
// ninguém exercita é mensagem que envelhece errada.
//
// Duas coisas que ele cobra e que eu errei ao escrever à mão:
//   - a peça precisa ACEITAR foto antes de eu reclamar de uma recusa: a
//     primeira da lista era um reel, e recusar foto ali é o comportamento certo;
//   - peça no ar tem a mídia congelada, e a tela NÃO pode oferecer a área de
//     arrastar — formulário que vai ser recusado não deve aparecer.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = process.env.SAIDA ?? './tiros';
const falhas = [];
const cobrar = (ok, o) => { if (!ok) falhas.push(o); console.log(`${ok ? 'OK  ' : 'FALHOU  '}${o}`); };

// Um JPEG 1x1 de verdade.
//
// Era PNG, e a 0047 passou a recusar: a Meta publica imagem so em JPEG. O
// roteiro quebrou no mesmo instante em que a regra entrou — que e exatamente o
// que um roteiro serve para fazer.
const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDP/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVEAEBAAAAAAAAAAAAAAAAAAAAAf/EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFREBAQAAAAAAAAAAAAAAAAAAAAH/2gAMAwEAAhEDEQA/AJQA/9k=',
  'base64',
);
const foto = (nome) => ({ name: nome, mimeType: 'image/jpeg', buffer: JPG });

const navegador = await abrirNavegador();
const ctx = await navegador.newContext({ viewport: { width: 1280, height: 1400 } });
const p = await ctx.newPage();
const problemas = [];
p.on('pageerror', (e) => problemas.push(e.message));

const corpo = () => p.locator('body').innerText();
const imagens = () => p.locator('img[alt*="Arquivo"]').count();

await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.getByText('entrar como direção').click();
await p.waitForTimeout(400);
await p.goto(`${BASE}/clientes/exemplo-mor/calendario`, { waitUntil: 'domcontentloaded' });
await p.getByText('onde publica').waitFor({ timeout: 20000 });

const pecas = p.locator('button[aria-expanded]');
const quantas = await pecas.count();
cobrar(quantas > 0, `a agenda mostra peca clicavel em largura de desktop (${quantas})`);

/** Abre a peça de índice i e devolve o texto do painel. */
async function abrir(i) {
  await pecas.nth(i).scrollIntoViewIfNeeded();
  await pecas.nth(i).click({ force: true });
  await p.waitForTimeout(350);
  return corpo();
}

// --- 1. peca no ar: a midia esta congelada ----------------------------------
let achouNoAr = false;
for (let i = 0; i < quantas; i += 1) {
  if (!/NO AR/i.test(await pecas.nth(i).innerText())) continue;
  const painel = await abrir(i);
  // Com acento: o texto na tela diz "já foi publicada". Procurar sem acento
  // falhava, e isso ja me pegou no SQL nesta mesma semana.
  cobrar(
    /já foi publicada/i.test(painel),
    'peca no ar diz que a midia nao muda mais',
  );
  cobrar(
    !/arraste o arquivo aqui/i.test(painel),
    'e NAO oferece a area de arrastar, que o banco recusaria',
  );
  await pecas.nth(i).click({ force: true });
  achouNoAr = true;
  break;
}
cobrar(achouNoAr, 'o exemplo tem peca no ar para exercitar o congelamento');

// --- 2. reel recusa foto ----------------------------------------------------
let achouReel = false;
for (let i = 0; i < quantas; i += 1) {
  if (/NO AR|SAINDO|PARCIAL/i.test(await pecas.nth(i).innerText())) continue;
  const painel = await abrir(i);
  if (!/PEDE 1 VÍDEO/i.test(painel)) {
    await pecas.nth(i).click({ force: true });
    continue;
  }
  await p.locator('input[type=file]').first().setInputFiles(foto('nao-e-video.jpg'));
  await p.waitForTimeout(700);
  cobrar(
    /Reel aceita video/i.test(await corpo()),
    'reel recusa foto, dizendo o que ele aceita',
  );
  cobrar((await imagens()) === 0, 'e a foto recusada nao entra na peca');
  await pecas.nth(i).click({ force: true });
  achouReel = true;
  break;
}
cobrar(achouReel, 'o exemplo tem reel para exercitar a recusa por tipo');

// --- 3. carrossel aceita mais de um, e devolver tira ------------------------
let achouCarrossel = false;
for (let i = 0; i < quantas; i += 1) {
  if (/NO AR|SAINDO|PARCIAL/i.test(await pecas.nth(i).innerText())) continue;
  const painel = await abrir(i);
  if (!/DE 2 A 10/i.test(painel)) {
    await pecas.nth(i).click({ force: true });
    continue;
  }

  cobrar(/não publica/i.test(painel), 'peca sem arquivo diz a consequencia, nao o estado');

  const entrada = p.locator('input[type=file]').first();
  await entrada.setInputFiles(foto('uma.jpg'));
  await p.waitForTimeout(800);
  cobrar((await imagens()) === 1, 'o primeiro arquivo aparece na peca');

  await entrada.setInputFiles(foto('duas.jpg'));
  await p.waitForTimeout(800);
  cobrar((await imagens()) === 2, 'carrossel aceita o segundo arquivo (ate dez)');

  await p.screenshot({ path: `${SAIDA}/midia-carrossel.png` });

  await p.getByRole('button', { name: /Tirar arquivo/ }).first().click();
  await p.waitForTimeout(700);
  cobrar((await imagens()) === 1, 'tirar um arquivo deixa o outro');

  achouCarrossel = true;
  break;
}
cobrar(achouCarrossel, 'o exemplo tem carrossel para exercitar varios arquivos');

cobrar(problemas.length === 0, `nenhum erro de pagina (${problemas.length})`);
if (problemas.length) console.log(problemas.map((x) => `    ${x}`).join('\n'));

await navegador.close();
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nO arquivo da peca esta de pe.');
process.exit(falhas.length ? 1 : 0);
