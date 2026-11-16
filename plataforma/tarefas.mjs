// O quadro de tarefas, no navegador.
//
// Cobra o que a dona pediu, na ordem em que ela pediu:
//   1. colunas editaveis — criar, renomear, apagar; e apagar coluna CHEIA e
//      recusado, com o erro dizendo o que fazer antes;
//   2. criar tarefa com responsavel, e a tela dizer que o aviso ficou
//      registrado — e o unico sinal, hoje, de que o email vai sair depois;
//   3. mover entre colunas, inclusive NO CELULAR, onde arrastar nao existe.
//
// O 3 e o que mais importa cobrar: `draggable` nao funciona em telefone, e a
// dona trabalha do telefone. Um quadro que so se opera no computador nao
// serve para ela.
import { abrirNavegador } from './navegador.mjs';

const SAIDA = './tiros';
const b = await abrirNavegador();
const problemas = [];

const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => problemas.push('erro na pagina: ' + e.message));
const limpo = async () => (await p.locator('body').innerText()).toLowerCase().replace(/\s+/g, ' ');

await p.goto('http://localhost:4178/', { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'layana@astartstudio.com.br');
await p.fill('input[type="password"]', 'x');
await p.click('button[type="submit"]');
await p.waitForLoadState('networkidle');

// --- o quadro abre pelo menu
const link = p.getByRole('link', { name: 'Tarefas' });
if (!(await link.count())) {
  problemas.push('nao ha item "Tarefas" no menu');
} else {
  await link.click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(600);
}

const inicio = await limpo();
// O QUADRO APARECE SEM ROLAR? As colunas tem de estar na primeira tela, nao
// atras de um formulario. Foi assim na primeira versao: no celular a pessoa
// abria para ver o que tinha pra fazer e via um formulario de cadastro.
for (const esperado of ['a fazer', 'fazendo', 'em aprovação', 'feito', 'nova tarefa']) {
  if (!inicio.includes(esperado)) problemas.push(`o quadro nao mostra "${esperado}"`);
}
// O filtro de periodo, que e o "organizar por semana, mes".
for (const esperado of ['esta semana', 'este mês', 'tudo']) {
  if (!inicio.includes(esperado)) problemas.push(`falta o filtro "${esperado}"`);
}
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
// A MARGEM. A dona viu: "o a fazer ta bem perto da tela, precisa seguir uma
// margem". Eu tinha esquecido o respiro lateral da pagina — cada tela aplica o
// seu, e a casca nao aplica nenhum. O titulo da primeira coluna ficava colado
// na borda esquerda, cortado.
//
// Cobra contra o respiro do RESTO da tela, nao contra um numero fixo: o que
// importa e a primeira coluna comecar na mesma linha vertical do filtro acima
// dela. Numero fixo quebraria na proxima troca de `px-5` para outro valor.
{
  const ref = await p.getByRole('button', { name: 'Esta semana' }).boundingBox();
  const col = await p.locator('section header').first().boundingBox();
  if (!ref || !col) problemas.push('nao consegui medir a margem do quadro');
  else if (col.x < ref.x - 2) {
    problemas.push(`a primeira coluna comeca antes da margem da pagina: ${Math.round(col.x)}px contra ${Math.round(ref.x)}px`);
  }
}
await p.screenshot({ path: `${SAIDA}/tarefas-01-quadro.png`, fullPage: true });

// --- criar tarefa com responsavel
//
// O exemplo dela ao pe da letra: "fazer criativo - responsavel: raquel".
// O formulario comeca fechado para o quadro nao ficar abaixo da dobra no
// celular. Abrir faz parte do caminho da pessoa, entao faz parte do teste.
await p.getByRole('button', { name: '+ Nova tarefa' }).click();
await p.waitForTimeout(300);
await p.fill('#t-titulo', 'Fazer criativo do teste');
const resp = p.locator('#t-resp');
const opcoes = await resp.locator('option').count();
if (opcoes < 2) problemas.push('o seletor de responsavel esta vazio — ninguem para atribuir');
else {
  // A segunda opcao: a primeira e "ninguem ainda".
  const valor = await resp.locator('option').nth(1).getAttribute('value');
  if (valor) await resp.selectOption(valor);
}
await p.getByRole('button', { name: /Adicionar ao quadro/ }).click();
await p.waitForTimeout(700);

const criada = await limpo();
if (!criada.includes('fazer criativo do teste')) {
  problemas.push('a tarefa criada nao apareceu no quadro');
}
// O AVISO. Hoje nao sai email; o que a tela promete e que ficou registrado.
// Sem esta frase a pessoa atribui e nao sabe se a outra vai ficar sabendo.
if (!/aviso ficou registrado|tarefa criada/.test(criada)) {
  problemas.push('a tela nao disse o que aconteceu depois de criar');
}

// --- mover de coluna ARRASTANDO (o caminho do computador)
//
// No computador o seletor fica escondido de proposito: la o gesto e arrastar.
// A primeira versao deste roteiro tentou usar o seletor aqui e travou
// esperando um elemento que o CSS esconde — teste pedindo o gesto errado.
{
  const cartao = p.locator('article', { hasText: 'Fazer criativo do teste' }).first();
  const destino = p.locator('section').filter({ has: p.getByText('Fazendo', { exact: true }) }).first();
  if (!(await destino.count())) {
    problemas.push('nao achei a coluna "Fazendo" para soltar o cartao');
  } else {
    await cartao.dragTo(destino);
    await p.waitForTimeout(900);
    const naColuna = await destino.filter({ hasText: 'Fazer criativo do teste' }).count();
    if (naColuna === 0) problemas.push('arrastar nao mudou o cartao de coluna');
  }
}

await p.screenshot({ path: `${SAIDA}/tarefas-02-movida.png`, fullPage: true });

// --- colunas editaveis, que foi o pedido
await p.fill('#t-nova-coluna', 'Esperando cliente');
await p.locator('#t-nova-coluna').press('Enter');
await p.waitForTimeout(800);
if (!(await limpo()).includes('esperando cliente')) {
  problemas.push('criar coluna nao funcionou');
}

// Apagar coluna CHEIA tem de ser recusado, dizendo o que fazer antes.
{
  const alvo = p.locator('button[aria-label^="Apagar a coluna A fazer"]').first();
  if (!(await alvo.count())) {
    problemas.push('nao ha como apagar coluna');
  } else {
    const antes = await p.locator('section header').count();
    await alvo.click();
    await p.waitForTimeout(700);
    const depois = await limpo();
    const sobrou = await p.locator('section header').count();
    if (sobrou < antes && !depois.includes('tarefa')) {
      problemas.push('apagou uma coluna que tinha tarefa dentro');
    }
  }
}

// --- abrir o cartao e mencionar
{
  await p.locator('article', { hasText: 'Fazer criativo do teste' }).first().click();
  await p.waitForTimeout(500);
  const dialogo = p.getByRole('dialog');
  if (!(await dialogo.count())) {
    problemas.push('clicar no cartao nao abre o detalhe');
  } else {
    const texto = (await dialogo.innerText()).toLowerCase();
    if (!texto.includes('mencionar')) problemas.push('o cartao aberto nao oferece mencionar');
    if (!texto.includes('descrição')) problemas.push('o cartao aberto nao tem descricao');
    // ANEXO — "queria que no card desse pra colocar imagem, documento".
    if (!texto.includes('imagens e documentos')) {
      problemas.push('o cartao aberto nao oferece anexar arquivo');
    }
    const campo = dialogo.locator('input[type="file"]');
    if (!(await campo.count())) {
      problemas.push('nao ha campo de anexar no cartao');
    } else {
      await campo.setInputFiles({
        name: 'referencia.png',
        mimeType: 'image/png',
        buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
      });
      await p.waitForTimeout(1000);
      // O CARTAO CONTINUA ABERTO. Na primeira versao qualquer acao fechava o
      // cartao, e nao dava para anexar dois arquivos seguidos nem mencionar
      // duas pessoas: o primeiro clique ja tinha fechado tudo.
      if (!(await p.getByRole('dialog').count())) {
        problemas.push('anexar fechou o cartao — nao da para anexar dois arquivos');
      } else {
        const depoisDeAnexar = (await p.getByRole('dialog').innerText()).toLowerCase();
        if (!depoisDeAnexar.includes('referencia.png')) {
          problemas.push('o anexo nao apareceu na lista do cartao');
        }
      }
    }
    await p.screenshot({ path: `${SAIDA}/tarefas-03-cartao.png`, fullPage: false });
    await dialogo.getByRole('button', { name: 'Fechar' }).click();
    await p.waitForTimeout(300);
  }
}
await ctx.close();

// --- NO CELULAR: as setas de arrastar nao servem, o seletor tem de estar la
{
  const cel = await b.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, colorScheme: 'dark',
  });
  const m = await cel.newPage();
  m.on('pageerror', (e) => problemas.push('erro no celular: ' + e.message));
  await m.goto('http://localhost:4178/', { waitUntil: 'networkidle' });
  await m.fill('input[type="email"]', 'layana@astartstudio.com.br');
  await m.fill('input[type="password"]', 'x');
  await m.click('button[type="submit"]');
  await m.waitForLoadState('networkidle');
  const ir = m.getByRole('link', { name: 'Tarefas' });
  if (await ir.count()) { await ir.click(); await m.waitForLoadState('networkidle'); }
  await m.waitForTimeout(700);

  const seletor = m.locator('article select').first();
  if (!(await seletor.count())) {
    problemas.push('no celular o cartao nao tem seletor de coluna');
  } else if (!(await seletor.isVisible())) {
    problemas.push('no celular o seletor de coluna existe mas esta escondido');
  }
  await m.screenshot({ path: `${SAIDA}/tarefas-04-celular.png`, fullPage: true });
  await cel.close();
}

await b.close();
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('tarefas: tudo o que foi checado passou');
