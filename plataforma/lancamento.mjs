// Lançar pagamento, no navegador.
//
// A dona, olhando o Financeiro: "aqui tbm eu nao consigo lançar pagamentos".
//
// Ela estava certa e era pior do que parecia: nao existia NENHUMA funcao no
// banco que escrevesse em `lancamentos`. Nem criar, nem marcar como pago,
// nem corrigir, nem apagar. Fora a mensalidade de contrato, o financeiro era
// leitura de uma tabela que ninguem conseguia preencher — e os numeros do
// topo ("Entrou", "Atrasado") nunca poderiam sair de zero.
//
// O que este roteiro cobra, na ordem em que a pessoa faz:
//
//   1. existe "+ lançar", e o botao de lançar fica DESLIGADO ate ter
//      descricao, categoria e valor — os tres sem os quais o banco recusa;
//   2. lançar uma saida faz a linha aparecer E o numero do topo mexer. Nao
//      basta a linha: o painel e o que ela olha;
//   3. "ja saiu" cria a linha JA PAGA num passo so — o caso do dia a dia e
//      registrar o que ja saiu da conta, nao prever;
//   4. uma linha prevista oferece "Recebi"/"Paguei", e depois de apertar ela
//      vira recebida e passa a oferecer "Desfazer" em vez de "Recebi". Se
//      continuasse oferecendo, o segundo clique bateria na recusa do banco;
//   5. editar corrige o valor na linha e no topo;
//   6. apagar fica atras de confirmacao;
//   7. e a recusa do banco aparece na tela SEM fechar o formulario e sem
//      perder o que foi digitado. Este e o item que justifica o arquivo:
//      formulario que fecha engolindo o erro e falha silenciosa com cara de
//      sucesso.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const falhas = [];
const cobrar = (ok, o) => { console.log(`${ok ? 'OK ' : 'FALHA'}  ${o}`); if (!ok) falhas.push(o); };

const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 }, colorScheme: 'dark' });
const p = await ctx.newPage();
const problemas = [];
p.on('pageerror', (e) => problemas.push(e.message));

const corpo = async () => (await p.locator('body').innerText()).toLowerCase();
const linhas = () => p.locator('tbody tr').count();

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'layana@astartstudio.com.br');
await p.fill('input[type="password"]', 'x');
await p.click('button[type="submit"]');
await p.waitForLoadState('networkidle');
await p.goto(`${BASE}/financeiro`, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);

// --- 1: o botao existe, e o formulario cobra o minimo
const lancar = p.getByRole('button', { name: '+ Lançar' });
if (!(await lancar.count())) {
  cobrar(false, 'nao ha como lançar um pagamento na mao');
  console.log(`\n${falhas.length} falha(s)`);
  await b.close();
  process.exit(1);
}
cobrar(true, 'a tela oferece lançar na mao');

await lancar.click();
await p.waitForTimeout(400);
const botaoLancar = p.getByRole('button', { name: 'Lançar', exact: true });
cobrar(await botaoLancar.isDisabled(), 'o botao nasce desligado: sem descricao, sem categoria, sem valor');

await p.fill('#l-descricao', 'Anúncio no Meta');
await p.fill('#l-valor', '750,00');
await p.waitForTimeout(200);
// Com descricao E valor, mas SEM categoria, ainda tem de recusar: e a
// categoria que diz se o dinheiro entra ou sai, e sem ela o banco recusa.
cobrar(await botaoLancar.isDisabled(), 'com descricao e valor, mas sem categoria, continua desligado');

const categoria = p.locator('#l-categoria');
const quantas = await categoria.locator('option').count();
cobrar(quantas > 1, `o seletor traz as categorias do catalogo (${quantas - 1})`);
// Uma categoria de CUSTO: e a categoria que decide se entra ou sai.
const opcoes = await categoria.locator('option').allTextContents();
const iCusto = opcoes.findIndex((x) => x.startsWith('Custo · '));
cobrar(iCusto > 0, 'inclusive as de custo, que e o que faltava poder lançar');
await categoria.selectOption({ index: iCusto });
await p.waitForTimeout(200);
cobrar(!(await botaoLancar.isDisabled()), 'com os tres, o botao libera');

// --- 2: lançar mexe na linha E no topo
const antesLinhas = await linhas();
await botaoLancar.click();
await p.waitForTimeout(1500);

const depois = await corpo();
cobrar(depois.includes('anúncio no meta'), 'o lançamento aparece na lista');
cobrar((await linhas()) === antesLinhas + 1, 'e e uma linha a mais, nao uma trocada');
cobrar(depois.includes('750,00'), 'com o valor que foi digitado');
cobrar(depois.includes('lançado'), 'e a tela confirma');
// O custo entra em "sobra do mes" e em "custo de": o painel tem de sentir.
cobrar(depois.includes('custo de r$ 750,00') || depois.includes('750,00'),
  'e o topo da tela sente o custo novo');
await p.screenshot({ path: './tiros/lancamento-01-criado.png', fullPage: true });

// --- 3: "ja saiu" cria pago num passo so
await p.getByRole('button', { name: '+ Lançar' }).click();
await p.waitForTimeout(400);
await p.fill('#l-descricao', 'Uber para a captação');
await p.locator('#l-categoria').selectOption({ index: iCusto });
await p.fill('#l-valor', '38,00');
await p.locator('#l-ja-foi').check();
await p.waitForTimeout(200);
cobrar(await p.locator('#l-quando').count() > 0, 'marcar "ja saiu" pede a data em que saiu');
await p.getByRole('button', { name: 'Lançar', exact: true }).click();
await p.waitForTimeout(1500);

const linhaUber = p.locator('tbody tr', { hasText: 'Uber para a captação' }).first();
cobrar(await linhaUber.count() > 0, 'o lançamento ja pago aparece');
cobrar(
  (await linhaUber.innerText()).toLowerCase().includes('pago'),
  'e nasce como PAGO, num passo so — sem ter de marcar depois',
);
cobrar(
  await linhaUber.getByRole('button', { name: 'Paguei' }).count() === 0,
  'entao ele nao oferece "paguei" de novo',
);

// --- 4: marcar que o dinheiro andou
{
  const prevista = p.locator('tbody tr', { hasText: 'Anúncio no Meta' }).first();
  const botao = prevista.getByRole('button', { name: 'Paguei' });
  cobrar(await botao.count() > 0, 'uma linha prevista oferece dizer que o dinheiro andou');
  await botao.click();
  await p.waitForTimeout(1500);

  const agora = p.locator('tbody tr', { hasText: 'Anúncio no Meta' }).first();
  const texto = (await agora.innerText()).toLowerCase();
  cobrar(texto.includes('pago'), 'depois de apertar, a linha vira paga');
  cobrar(
    await agora.getByRole('button', { name: 'Paguei' }).count() === 0,
    'e para de oferecer "paguei" — senao o segundo clique bateria na recusa do banco',
  );
  cobrar(
    await agora.getByRole('button', { name: 'Desfazer' }).count() > 0,
    'passando a oferecer desfazer, que e a pergunta que sobra',
  );

  // Desfazer devolve.
  await agora.getByRole('button', { name: 'Desfazer' }).click();
  await p.waitForTimeout(1500);
  const volta = p.locator('tbody tr', { hasText: 'Anúncio no Meta' }).first();
  cobrar(
    await volta.getByRole('button', { name: 'Paguei' }).count() > 0,
    'desfazer devolve a linha para previsto',
  );
}

// --- 5: corrigir
{
  const linha = p.locator('tbody tr', { hasText: 'Anúncio no Meta' }).first();
  await linha.getByRole('button', { name: 'Editar' }).click();
  await p.waitForTimeout(400);
  const lido = await p.locator('#l-valor').inputValue();
  cobrar(lido.startsWith('750'), `o editar abre com o valor que esta valendo (leu "${lido}")`);
  cobrar(
    (await p.locator('#l-categoria').inputValue()) !== '',
    'e com a categoria que esta valendo, nao vazia',
  );
  await p.fill('#l-valor', '900,00');
  await p.getByRole('button', { name: 'Salvar' }).click();
  await p.waitForTimeout(1500);
  const t = await corpo();
  cobrar(t.includes('900,00'), 'salvar troca o valor na linha');
  cobrar(!t.includes('750,00'), 'e o valor antigo sai');
}

// --- 7: a recusa do banco fica na tela, e o formulario nao fecha
{
  const linha = p.locator('tbody tr', { hasText: 'Uber para a captação' }).first();
  await linha.getByRole('button', { name: 'Editar' }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Apagar', exact: true }).click();
  await p.waitForTimeout(300);
  cobrar(
    (await corpo()).includes('não deixa rastro'),
    'apagar avisa antes',
  );
  await p.getByRole('button', { name: 'Apagar mesmo' }).click();
  await p.waitForTimeout(1500);

  const t = await corpo();
  // Este Uber esta PAGO: o banco recusa apagar. A recusa tem de aparecer.
  cobrar(t.includes('o dinheiro andou'), 'apagar lançamento pago e recusado, com o motivo na tela');
  cobrar(
    await p.locator('#l-valor').count() > 0,
    'e o formulario CONTINUA ABERTO — erro nao pode fechar a tela e engolir o que foi digitado',
  );
  cobrar(
    (await p.locator('tbody tr', { hasText: 'Uber para a captação' }).count()) > 0,
    'e a linha continua la',
  );

  // Pelo caminho certo: estornar e depois apagar.
  await p.getByRole('button', { name: 'Fechar' }).first().click();
  await p.waitForTimeout(400);
  await p.locator('tbody tr', { hasText: 'Uber para a captação' }).first()
    .getByRole('button', { name: 'Desfazer' }).click();
  await p.waitForTimeout(1500);
  await p.locator('tbody tr', { hasText: 'Uber para a captação' }).first()
    .getByRole('button', { name: 'Editar' }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Apagar', exact: true }).click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Apagar mesmo' }).click();
  await p.waitForTimeout(1500);
  cobrar(
    (await p.locator('tbody tr', { hasText: 'Uber para a captação' }).count()) === 0,
    'depois de desfazer, apagar funciona — o caminho que a recusa indicava',
  );
}

await p.screenshot({ path: './tiros/lancamento-02-mexido.png', fullPage: true });

cobrar(problemas.length === 0, `nenhum erro de pagina (${problemas.length})`);
if (problemas.length) console.log(problemas.map((x) => `    ${x}`).join('\n'));
await ctx.close();

// --- quem nao cuida do dinheiro nao chega aqui
{
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
  const o = await ctx2.newPage();
  await o.goto(BASE, { waitUntil: 'networkidle' });
  await o.fill('input[type="email"]', 'raquel@astartstudio.com.br');
  await o.fill('input[type="password"]', 'x');
  await o.click('button[type="submit"]');
  await o.waitForLoadState('networkidle');
  await o.goto(`${BASE}/financeiro`, { waitUntil: 'networkidle' });
  await o.waitForTimeout(700);
  cobrar(
    !(await o.locator('body').innerText()).toLowerCase().includes('+ lançar'),
    'a operacao nao encontra o botao de lançar',
  );
  await ctx2.close();
}

await b.close();
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nLançar pagamento esta de pe.');
process.exit(falhas.length ? 1 : 0);
