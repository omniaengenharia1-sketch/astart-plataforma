// O comercial, no navegador.
//
// A dona: "a parte comercial ta um pouco vaga ali, eu nao consigo mexer em
// nada. (...) ela tem que ter um fundamento, um objetivo."
//
// O objetivo e responder, ao abrir: COM QUEM EU PRECISO FALAR HOJE, e O QUE EU
// COMBINEI DA ULTIMA VEZ. Entao e isso que este roteiro cobra, na ordem em que
// a pessoa encontra:
//
//   1. a agenda esta ACIMA do funil, e sem rolar — o funil e consulta, a
//      agenda e trabalho; se ela nasce embaixo, a tela volta a ser um quadro
//      de enfeite, que foi a reclamacao;
//   2. a lista "sem data marcada" existe — e a que ninguem pensa em fazer, e e
//      exatamente onde o lead morre sem ninguem decidir que morreu;
//   3. cadastrar lead pede SO O NOME — formulario de dez campos nao se enche;
//   4. anotar faz as tres coisas juntas (o que foi conversado, o proximo passo
//      e QUANDO) e tira o lead de "novo" sozinho;
//   5. o historico acumula e fica visivel;
//   6. o WhatsApp abre com wa.me e com o 55 na frente;
//   7. perdido pede o motivo ANTES, na tela, em vez de deixar o banco recusar;
//   8. e quem nao cuida do dinheiro nao encontra esta tela.
//
// O 1 e o 8 sao os que justificam o arquivo. O 1 porque e literalmente a
// reclamacao. O 8 porque "so eu e quem eu cadastrar como financeiro" foi
// pedido duas vezes, e uma tela de carteira de clientes aberta para a equipe
// toda e o tipo de vazamento que ninguem percebe olhando a tela certa.
import { abrirNavegador } from './navegador.mjs';

const SAIDA = './tiros';
const b = await abrirNavegador();
const problemas = [];

const amanha = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

async function entrar(p, email) {
  await p.goto('http://localhost:4178/', { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', 'x');
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle');
}

// ---------------------------------------------------------------------------
// A DONA (direcao): tem de poder mexer em tudo.
// ---------------------------------------------------------------------------
const ctx = await b.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'dark',
  deviceScaleFactor: 2,
});
const p = await ctx.newPage();
p.on('pageerror', (e) => problemas.push('erro na pagina: ' + e.message));
const limpo = async () => (await p.locator('body').innerText()).toLowerCase().replace(/\s+/g, ' ');

await entrar(p, 'layana@astartstudio.com.br');

const link = p.getByRole('link', { name: 'Comercial' });
if (!(await link.count())) {
  problemas.push('nao ha item "Comercial" no menu da direcao');
  console.log('PROBLEMAS:\n' + problemas.join('\n'));
  process.exit(1);
}
await link.click();
await p.waitForLoadState('networkidle');
await p.waitForTimeout(700);

// --- 1 e 2: a agenda, e onde ela esta
const inicio = await limpo();
for (const esperado of ['passou da data', 'para hoje', 'próximos 7 dias', 'sem data marcada']) {
  if (!inicio.includes(esperado)) problemas.push(`a agenda nao mostra "${esperado}"`);
}
if (!inicio.includes('+ novo lead')) problemas.push('nao ha como cadastrar um lead');

if (problemas.length) {
  console.log('PROBLEMAS:\n' + problemas.join('\n'));
  process.exit(1);
}

// A AGENDA ACIMA DO FUNIL, E DENTRO DA PRIMEIRA TELA.
//
// Nao basta existir: se nasce abaixo do funil, a pessoa abre a tela e ve a
// mesma parede de cartoes de antes. Cobra contra a posicao do funil, nao
// contra um numero fixo de pixels, que quebraria no proximo ajuste de espaco.
{
  const ag = await p.locator('section[aria-label="Passou da data"]').boundingBox();
  const fun = await p.locator('section[aria-label^="Funil:"]').first().boundingBox();
  if (!ag) problemas.push('nao consegui medir a agenda');
  else {
    if (ag.y > 1000) problemas.push(`a agenda nasce fora da primeira tela (${Math.round(ag.y)}px)`);
    if (fun && ag.y > fun.y) problemas.push('a agenda esta DEPOIS do funil — o trabalho tem de vir antes da consulta');
  }
}
await p.screenshot({ path: `${SAIDA}/comercial-01-agenda.png`, fullPage: true });

// --- 3: cadastrar com so o nome
await p.getByRole('button', { name: '+ Novo lead' }).click();
await p.waitForTimeout(300);

// O botao fica DESLIGADO sem nome: nome e o unico campo obrigatorio, e a tela
// tem de dizer isso sem um erro vermelho.
const cadastrar = p.getByRole('button', { name: /Cadastrar lead/ });
if (!(await cadastrar.isDisabled())) {
  problemas.push('da para cadastrar lead sem nome');
}
await p.fill('#lead-nome', 'Padaria do Teste');
await p.fill('#lead-whatsapp', '11 98888 7777');
await cadastrar.click();
await p.waitForTimeout(900);

const depoisDeCriar = await limpo();
if (!depoisDeCriar.includes('padaria do teste')) {
  problemas.push('o lead cadastrado nao apareceu');
}
if (!depoisDeCriar.includes('entrou no funil')) {
  problemas.push('a tela nao disse que o lead entrou');
}
// Lead novo nasce SEM proxima data: tem de cair na lista que cobra isso.
{
  const semData = p.locator('section[aria-label="Sem data marcada"]');
  if (!(await semData.filter({ hasText: 'Padaria do Teste' }).count())) {
    problemas.push('lead novo, sem proxima data, nao entrou em "sem data marcada"');
  }
}

const cartao = p.locator('li.bloco', { hasText: 'Padaria do Teste' }).first();

// --- 6: o WhatsApp
{
  const zap = cartao.getByRole('link', { name: 'WhatsApp' });
  if (!(await zap.count())) {
    problemas.push('o cartao nao oferece abrir o WhatsApp');
  } else {
    const href = await zap.getAttribute('href');
    if (!href?.startsWith('https://wa.me/5511988887777')) {
      problemas.push(`o link do WhatsApp saiu errado: ${href}`);
    }
  }
}

// --- 4 e 5: anotar as tres coisas de uma vez
await cartao.getByRole('button', { name: 'Anotar' }).click();
await p.waitForTimeout(300);
await cartao.locator('input[id^="oque-"]').fill('Liguei, quer orçamento de redes');
await cartao.locator('input[id^="passo-"]').fill('Mandar proposta');
await cartao.locator('input[id^="quando-"]').fill(amanha());
await cartao.getByRole('button', { name: 'Anotar', exact: true }).last().click();
await p.waitForTimeout(900);

{
  const agora = p.locator('li.bloco', { hasText: 'Padaria do Teste' }).first();
  const texto = (await agora.innerText()).toLowerCase();
  if (!texto.includes('mandar proposta')) problemas.push('o proximo passo nao ficou no cartao');
  if (!texto.includes('conversando')) {
    problemas.push('anotar nao tirou o lead de "novo" — etapa que depende de lembrar fica errada');
  }
  if (!texto.includes('histórico')) problemas.push('o historico nao aparece no cartao');

  // Segunda anotacao: o historico tem de ACUMULAR, nao sobrescrever.
  await agora.getByRole('button', { name: 'Anotar' }).first().click();
  await p.waitForTimeout(300);
  await agora.locator('input[id^="oque-"]').fill('Mandei por email');
  await agora.getByRole('button', { name: 'Anotar', exact: true }).last().click();
  await p.waitForTimeout(900);

  const dois = p.locator('li.bloco', { hasText: 'Padaria do Teste' }).first();
  await dois.locator('details summary').click();
  await p.waitForTimeout(300);
  const hist = (await dois.innerText()).toLowerCase();
  if (!hist.includes('quer orçamento')) problemas.push('a primeira conversa saiu do historico');
  if (!hist.includes('mandei por email')) problemas.push('a segunda conversa nao entrou');
  if (!hist.includes('layana')) problemas.push('o historico nao diz quem falou');

  // Com data marcada, sai de "sem data marcada" e entra na agenda da semana.
  if (await p.locator('section[aria-label="Sem data marcada"]').filter({ hasText: 'Padaria do Teste' }).count()) {
    problemas.push('o lead continua em "sem data marcada" depois de marcar a data');
  }
}
await p.screenshot({ path: `${SAIDA}/comercial-02-anotado.png`, fullPage: true });

// --- 7: perdido pede o motivo na TELA, nao no erro
{
  const alvo = p.locator('li.bloco', { hasText: 'Padaria do Teste' }).first();
  await alvo.getByRole('button', { name: 'Mover' }).click();
  await p.waitForTimeout(300);
  await alvo.locator('select[id^="etapa-"]').selectOption('perdido');
  await p.waitForTimeout(300);
  const mover = alvo.getByRole('button', { name: 'Mover', exact: true }).last();
  if (!(await mover.isDisabled())) {
    problemas.push('da para marcar perdido sem motivo — a regra do banco nao chegou na tela');
  }
  await alvo.locator('input[id^="motivo-"]').fill('Achou caro');
  await p.waitForTimeout(200);
  await mover.click();
  await p.waitForTimeout(900);
  if (!(await limpo()).includes('perdido')) {
    problemas.push('mover para perdido nao funcionou');
  }
}
await ctx.close();

// ---------------------------------------------------------------------------
// 8. A OPERACAO: nao encontra esta tela.
//
// "eu quero que apenas eu que tenho acesso proprietario possa ver a parte
// financeira ou alguem que eu cadastre como financeiro" — e a carteira de
// leads, com valor na mesa, e parte disso.
// ---------------------------------------------------------------------------
{
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
  const o = await ctx2.newPage();
  o.on('pageerror', (e) => problemas.push('erro como operacao: ' + e.message));
  await entrar(o, 'raquel@astartstudio.com.br');
  await o.waitForTimeout(500);

  if (await o.getByRole('link', { name: 'Comercial' }).count()) {
    problemas.push('a operacao tem "Comercial" no menu');
  }
  // E digitar o endereco na barra tambem nao passa: menu escondido nao e
  // permissao.
  await o.goto('http://localhost:4178/comercial', { waitUntil: 'networkidle' });
  await o.waitForTimeout(700);
  const visto = (await o.locator('body').innerText()).toLowerCase();
  if (visto.includes('passou da data') || visto.includes('+ novo lead')) {
    problemas.push('a operacao abriu o comercial pelo endereco direto');
  }
  await o.screenshot({ path: `${SAIDA}/comercial-03-operacao.png`, fullPage: true });
  await ctx2.close();
}

await b.close();
if (problemas.length) {
  console.log('PROBLEMAS:\n' + problemas.join('\n'));
  process.exit(1);
}
console.log('comercial: tudo o que foi checado passou');
