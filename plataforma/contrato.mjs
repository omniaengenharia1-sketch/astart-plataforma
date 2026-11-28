// Editar o contrato de um cliente que já existe.
//
// A dona pediu isto em voz alta — "preciso tbm ficar liberada para alterar o
// valor e informacoes de clientes cadastrados" — e eu entreguei o banco sem a
// tela. O valor da Publika teve de ser corrigido por SQL na produção, por
// mim, porque ela não tinha onde clicar. Este roteiro existe para que o botão
// nunca mais suma sem alguém perceber.
//
// O que ele cobra, e por quê:
//
//   1. o botão EXISTE na ficha. É o item que estava faltando o tempo todo, e
//      um teste de função nunca pegaria: `alterar_servico_do_cliente` passava
//      verde nos testes de SQL enquanto a tela não a chamava;
//   2. o formulário abre PREENCHIDO com o que está valendo. Abrir vazio e
//      salvar por cima apaga valor e prazo sem ninguém pedir — foi por isso
//      que a 0075 precisou acrescentar três campos à ficha;
//   3. salvar MUDA o que a tela mostra. Não basta não dar erro: a linha tem
//      de passar a exibir o valor novo;
//   4. dá para adicionar um serviço que o cliente ainda não tem;
//   5. remover fica atrás de confirmação, porque apaga o histórico.
//
// O QUE ESTE ROTEIRO NÃO ALCANÇA, e vale saber antes de confiar demais nele:
// ele roda em modo exemplo, onde o mock altera o objeto NO LUGAR. Isso faz o
// item 3 passar mesmo se a tela esquecer de recarregar depois de salvar — o
// objeto é o mesmo, então o texto muda sozinho. Contra o banco de verdade
// não mudaria. Testei tirando o `aoMudar()` de propósito e o roteiro ficou
// verde; deixo escrito em vez de fingir cobertura que não existe.
//
// O que ele PEGA, provado por sabotagem: o botão sumir da ficha, e o
// formulário abrir vazio — que é o defeito caro, porque salvar por cima
// apagaria valor e prazo sem ninguém pedir.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const falhas = [];
const cobrar = (ok, o) => { console.log(`${ok ? 'OK ' : 'FALHA'}  ${o}`); if (!ok) falhas.push(o); };

const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
const p = await ctx.newPage();
const problemas = [];
p.on('pageerror', (e) => problemas.push(e.message));

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'layana@astartstudio.com.br');
await p.fill('input[type="password"]', 'x');
await p.click('button[type="submit"]');
await p.waitForLoadState('networkidle');
await p.goto(`${BASE}/clientes/exemplo-mor`, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);

const corpo = () => p.locator('body').innerText();

// --- 1. o botão existe -----------------------------------------------------
const editar = p.getByRole('button', { name: 'Editar' }).first();
cobrar(await editar.count() > 0, 'a ficha oferece EDITAR o contrato');
if (await editar.count() === 0) {
  console.log('\nsem o botao nao da para seguir');
  await b.close();
  process.exit(1);
}

await editar.click();
await p.waitForTimeout(400);

// --- 2. abre preenchido ----------------------------------------------------
const valor = p.locator('#c-valor');
const antes = await valor.inputValue();
cobrar(
  antes.trim() !== '',
  `o formulario abre com o valor que esta valendo (leu "${antes}")`,
);
cobrar(
  (await corpo()).toLowerCase().includes('quem cuida'),
  'e oferece trocar quem cuida, que era outra funcao sem tela',
);

// --- 3. salvar muda o que a tela mostra ------------------------------------
await valor.fill('4321,00');
await p.getByRole('button', { name: 'Salvar' }).click();
await p.waitForTimeout(1200);

const depois = await corpo();
cobrar(
  depois.includes('4.321,00'),
  'salvar troca o valor NA TELA — nao basta nao dar erro',
);
cobrar(
  !depois.includes(antes.replace(',', '.')) || antes === '4321,00',
  'e o valor antigo sai da linha',
);

// Reabrir mostra o novo, não o que estava quando a página carregou.
await p.getByRole('button', { name: 'Editar' }).first().click();
await p.waitForTimeout(400);
cobrar(
  (await p.locator('#c-valor').inputValue()).startsWith('4321'),
  'e reabrir mostra o novo, nao o antigo guardado na memoria da tela',
);

// --- 5. remover pede confirmação -------------------------------------------
const remover = p.getByRole('button', { name: 'Remover', exact: true }).first();
cobrar(await remover.count() > 0, 'oferece remover o serviço');
await remover.click();
await p.waitForTimeout(300);
cobrar(
  (await corpo()).includes('remover apaga o histórico junto'),
  'e remover avisa antes, porque apaga o passado junto',
);
await p.getByRole('button', { name: 'Deixa' }).click();
await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Fechar' }).first().click();
await p.waitForTimeout(300);

// --- 4. adicionar serviço ---------------------------------------------------
await p.getByRole('button', { name: '+ Adicionar serviço' }).click();
await p.waitForTimeout(400);
const seletor = p.locator('#c-servico');
cobrar(await seletor.count() > 0, 'da para adicionar um servico novo ao contrato');

const quantas = await seletor.locator('option').count();
if (quantas > 1) {
  const chave = await seletor.locator('option').nth(1).getAttribute('value');
  await seletor.selectOption(chave);
  await p.locator('#c-valor').fill('900,00');
  await p.getByRole('button', { name: 'Adicionar ao contrato' }).click();
  await p.waitForTimeout(1200);
  cobrar(
    (await corpo()).includes('900,00'),
    'e o servico novo aparece no contrato depois de adicionar',
  );
} else {
  cobrar(
    (await corpo()).includes('todos os serviços do catálogo'),
    'ou diz que nao sobrou servico para adicionar, em vez de um seletor vazio',
  );
}

// --- 5. O MESMO SERVICO DUAS VEZES, com nome (0090) -------------------------
//
// A dona: "eu dei um ensaio pra ela de graca. E aí eu vou fazer as fotos do
// aniversario dela, que aí vai ser R$ 500". Os dois sao audiovisual, e ate
// agora o segundo era RECUSADO: "este cliente ja tem Audiovisual no
// contrato".
//
// A verificacao e pela CONTA de linhas na tela, e nao pela ausencia de erro:
// uma tela que aceita e nao mostra a linha nova e o mesmo defeito com outra
// cara.
{
  const linhas = () => p.locator('li', { has: p.locator('button', { hasText: 'Editar' }) }).count();
  const antes = await linhas();

  await p.getByRole('button', { name: '+ Adicionar serviço' }).click();
  await p.waitForTimeout(400);
  const sel = p.locator('#c-servico');
  // O MESMO servico que ja esta no contrato: a primeira opcao da lista, que
  // antes da 0090 nem aparecia duas vezes.
  const jaTem = await sel.locator('option').nth(1).getAttribute('value');
  await sel.selectOption(jaTem);
  await p.locator('#c-apelido').fill('Aniversário da Zilda');
  await p.locator('#c-valor').fill('500,00');
  await p.getByRole('button', { name: 'Adicionar ao contrato' }).click();
  await p.waitForTimeout(1200);

  const depois = await linhas();
  if (depois !== antes + 1) {
    falhas.push(`depois de adicionar o mesmo servico de novo ha ${depois} linhas, esperava ${antes + 1}`);
  }
  cobrar((await corpo()).includes('Aniversário da Zilda'),
    'o nome que ela deu a linha aparece no contrato');
  cobrar((await corpo()).includes('500,00'),
    'e o valor da segunda linha tambem');
}

await p.screenshot({ path: './tiros/contrato-01-editar.png', fullPage: true });

cobrar(problemas.length === 0, `nenhum erro de pagina (${problemas.length})`);
if (problemas.length) console.log(problemas.map((x) => `    ${x}`).join('\n'));

await b.close();
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nO editor de contrato esta de pe.');
process.exit(falhas.length ? 1 : 0);
