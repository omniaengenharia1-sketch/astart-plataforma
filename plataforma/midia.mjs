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

  // --- a ORDEM do carrossel ------------------------------------------------
  //
  // A dona, depois de subir um carrossel da Mor: "falta eu poder movimentar o
  // carrossel, tipo: colocar uma imagem em segundo outra em terceiro".
  //
  // Num carrossel a ordem E o conteudo: a primeira imagem e a capa do post no
  // feed. Errar a ordem e refazer o post.
  //
  // O QUE ESTE PEDACO COBRA
  //   a. as setas existem e a primeira nao tem "para antes" (nem a ultima
  //      "para depois") — botao que nao leva a lugar nenhum e armadilha;
  //   b. mover TROCA mesmo: confere a ordem dos NOMES dos arquivos, nao so o
  //      numero embaixo. O numero sozinho passaria com a lista inteira errada
  //      atras dele — foi esse o furo que o teste 39 fechou no banco.
  {
    const nomes = async () =>
      (await p.locator('img[alt*="Arquivo"]').evaluateAll((fotos) =>
        fotos.map((f) => f.getAttribute('src') ?? ''),
      ));

    const antes = await nomes();
    if (antes.length !== 2) {
      problemas.push(`esperava dois arquivos para ordenar, tem ${antes.length}`);
    } else {
      const primeira = p.getByRole('button', { name: 'Mover o arquivo 1 para antes' });
      const segunda = p.getByRole('button', { name: 'Mover o arquivo 2 para antes' });

      if (!(await primeira.count())) {
        problemas.push('nao ha como mudar a ordem do carrossel');
      } else {
        cobrar(
          await primeira.isDisabled(),
          'o primeiro arquivo nao oferece "para antes" — nao ha para onde ir',
        );
        cobrar(
          await p.getByRole('button', { name: 'Mover o arquivo 2 para depois' }).isDisabled(),
          'nem o ultimo oferece "para depois"',
        );

        await segunda.click();
        await p.waitForTimeout(900);
        const depois = await nomes();
        cobrar(
          depois.length === 2 && depois[0] === antes[1] && depois[1] === antes[0],
          'mover o segundo para antes troca os dois de lugar de verdade',
        );
        // E o aviso que diz o que a ordem significa.
        cobrar(
          /a 1 é a capa do post|1 é a capa/i.test(await corpo()),
          'a tela diz que a primeira e a capa do post no feed',
        );
        await p.screenshot({ path: `${SAIDA}/midia-ordem.png` });
      }
    }
  }

  await p.getByRole('button', { name: /Tirar arquivo/ }).first().click();
  await p.waitForTimeout(700);
  cobrar((await imagens()) === 1, 'tirar um arquivo deixa o outro');

  achouCarrossel = true;
  break;
}
cobrar(achouCarrossel, 'o exemplo tem carrossel para exercitar varios arquivos');

// --- 4. PNG entra, virando JPG, e a tela diz que virou ----------------------
//
// A dona: "achei um erro, na hora de enviar a arte ele precisa aceitar png
// tbm". Ela exporta a arte em PNG, e o `accept` do campo era `image/jpeg` — o
// arquivo nem aparecia como clicavel no seletor do sistema.
//
// A Meta publica imagem so em JPEG (conferido na documentacao dela em 16/11),
// entao aceitar e GUARDAR PNG so mudaria o lugar da falha: a peca pareceria
// pronta e quebraria de madrugada, na conta do cliente. O envio converte.
//
// O QUE ESTE PEDACO COBRA, e por que cada um importa:
//   a. o PNG ENTRA — se o `accept` voltar a `image/jpeg`, o arquivo nao entra;
//   b. a tela DIZ que converteu — converter calado troca um problema visivel
//      por um invisivel;
//   c. a frase do fundo branco aparece QUANDO o PNG tem transparencia e NAO
//      aparece quando nao tem. Sem a segunda metade, um detector quebrado que
//      respondesse "sim" sempre passaria no teste.
//
// A conversao roda no canvas de um navegador de verdade — e por isso que isto
// e roteiro de navegador, e nao teste de unidade.
{
  // Fecha o que ficou aberto: `imagens()` conta a pagina inteira, e a peca do
  // carrossel ficou com um arquivo dentro.
  for (const aberta of await p.locator('button[aria-expanded="true"]').all()) {
    await aberta.click({ force: true });
  }
  await p.waitForTimeout(300);

  const png = (nome, base64) => ({
    name: nome,
    mimeType: 'image/png',
    buffer: Buffer.from(base64, 'base64'),
  });
  // 2x2 RGBA, com um pixel de alfa 0.
  const COM_ALFA =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR4nGO4I5f3/45cHgPD' +
    '////QYz/AFXLCjNmGbC9AAAAAElFTkSuQmCC';
  // O mesmo PNG, sem nenhum pixel transparente.
  const OPACO =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGO4I5f3H4QZ/v//' +
    'D2YAAF/BCzIgfQ6yAAAAAElFTkSuQmCC';

  let achouFoto = false;
  for (let i = 0; i < quantas; i += 1) {
    if (/NO AR|SAINDO|PARCIAL/i.test(await pecas.nth(i).innerText())) continue;
    const painel = await abrir(i);
    if (!/PEDE 1 FOTO/i.test(painel)) {
      await pecas.nth(i).click({ force: true });
      continue;
    }

    const entrada = p.locator('input[type=file]').first();
    const antes = await imagens();

    // O `accept` E COBRADO A PARTE, e isto nao e redundancia.
    //
    // `setInputFiles` entrega o arquivo direto ao input: ele NAO respeita o
    // `accept`. Ou seja, todo o resto deste pedaco passaria intacto com o
    // `accept="image/jpeg"` de volta no lugar — que e exatamente o bug que a
    // dona encontrou, porque e no seletor do sistema que o PNG sumia.
    //
    // Mais uma do padrao que este projeto ja pagou varias vezes: o caminho de
    // teste e mais permissivo que o caminho da pessoa, e testa so o facil.
    const aceita = (await entrada.getAttribute('accept')) ?? '';
    cobrar(
      aceita.includes('image/*'),
      `o seletor de arquivos deixa escolher PNG (accept="${aceita}")`,
    );
    // E a etiqueta nao pode mandar exportar em JPG o que a plataforma converte.
    cobrar(
      !/FOTOS? JPG/i.test(painel),
      'a peca nao pede "foto JPG" — quem le isso exporta de novo a toa',
    );

    await entrada.setInputFiles(png('arte-com-fundo-transparente.png', COM_ALFA));
    await p.waitForTimeout(900);
    cobrar((await imagens()) === antes + 1, 'o PNG entra na peca em vez de ser recusado');
    const depoisDoAlfa = await corpo();
    cobrar(
      /PNG convertido para JPG/i.test(depoisDoAlfa),
      'e a tela diz que converteu, em vez de converter calada',
    );
    cobrar(
      /fundo transparente/i.test(depoisDoAlfa),
      'avisa que o fundo transparente virou branco — JPEG nao tem transparencia',
    );
    await p.screenshot({ path: `${SAIDA}/midia-png-virou-jpg.png` });

    await p.getByRole('button', { name: /Tirar arquivo/ }).first().click();
    await p.waitForTimeout(700);

    await entrada.setInputFiles(png('arte-sem-transparencia.png', OPACO));
    await p.waitForTimeout(900);
    const depoisDoOpaco = await corpo();
    cobrar(
      /PNG convertido para JPG/i.test(depoisDoOpaco),
      'PNG opaco tambem e convertido',
    );
    cobrar(
      !/fundo transparente/i.test(depoisDoOpaco),
      'mas sem a frase do fundo branco, que aqui nao aconteceu',
    );

    achouFoto = true;
    break;
  }
  cobrar(achouFoto, 'o exemplo tem peca de foto para exercitar a conversao de PNG');
}

cobrar(problemas.length === 0, `nenhum erro de pagina (${problemas.length})`);
if (problemas.length) console.log(problemas.map((x) => `    ${x}`).join('\n'));

await navegador.close();
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nO arquivo da peca esta de pe.');
process.exit(falhas.length ? 1 : 0);
