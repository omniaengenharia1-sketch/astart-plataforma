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
//   8. e quem nao cuida do dinheiro nao encontra esta tela;
//   9. da para EDITAR o lead, e esvaziar um campo apaga de verdade;
//  10. da para amarrar o lead ao cliente quando a venda fecha;
//  11. e apagar engano de cadastro, atras de confirmacao — mas nunca um lead
//      que virou cliente.
//
// Os tres ultimos entraram depois, quando a dona cobrou: "eu te falei pra
// fazer uma varredura e dectar erros e bugs e tem todos esses erros e vc nao
// viu". As tres funcoes existiam no banco, verdes nos testes de SQL, sem
// nenhuma tela que as chamasse. Defeito por AUSENCIA nao levanta excecao em
// lugar nenhum — so um roteiro que abre a tela e procura o botao pega.
//
// O QUE ESTE ROTEIRO NAO ALCANCA: a recusa de apagar um lead que virou
// cliente. Ela existe no banco e tem teste de SQL, mas pela tela nao da para
// chegar nela — lead convertido sai do funil e nao tem mais cartao. O botao
// de converter so aparece em lead aberto pelo mesmo motivo. Deixo escrito em
// vez de fingir que o roteiro cobre.
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

// --- 9: EDITAR o lead
//
// `editar_lead` existia desde a 0071, com teste de SQL verde, e nenhuma tela
// a chamava: o telefone digitado errado so saia do funil apagando o lead
// inteiro — e apagar leva o historico junto. Este bloco e dos que a varredura
// deveria ter pego e nao pegou, porque o defeito era uma AUSENCIA.
{
  const alvo = p.locator('li.bloco', { hasText: 'Padaria do Teste' }).first();
  const editar = alvo.getByRole('button', { name: 'Editar' });
  if (!(await editar.count())) {
    // Sem o botao nao da para seguir: os blocos abaixo clicariam no vazio e
    // o roteiro morreria de timeout em vez de dizer o que faltou.
    problemas.push('o cartao do lead nao oferece EDITAR');
    console.log('PROBLEMAS:\n' + problemas.join('\n'));
    process.exit(1);
  } else {
    await editar.click();
    await p.waitForTimeout(300);
    // Abrir PREENCHIDO: vazio, salvar por cima apagaria o que estava valendo.
    const nome = alvo.locator('input[id^="ed-nome-"]');
    const lido = await nome.inputValue();
    if (lido !== 'Padaria do Teste') {
      problemas.push(`o editar abre com o nome errado (leu "${lido}")`);
    }
    const zapLido = await alvo.locator('input[id^="ed-whatsapp-"]').inputValue();
    if (!zapLido.includes('8888')) {
      problemas.push(`o editar nao trouxe o whatsapp que esta valendo (leu "${zapLido}")`);
    }
    await alvo.locator('input[id^="ed-empresa-"]').fill('Padaria LTDA');
    await alvo.locator('input[id^="ed-valor-"]').fill('2500,00');
    await alvo.getByRole('button', { name: 'Salvar' }).click();
    await p.waitForTimeout(900);

    const texto = await limpo();
    if (!texto.includes('padaria ltda')) problemas.push('a empresa editada nao apareceu no cartao');
    if (!texto.includes('2.500,00')) problemas.push('o valor editado nao apareceu no cartao');
  }
}

// ESVAZIAR UM CAMPO TEM DE APAGAR DE VERDADE.
//
// `editar_lead` trata nulo como "nao mexe": sem mandar o nome do campo em
// `p_limpar`, apagar a empresa errada seria impossivel e a tela nao daria
// erro nenhum. Silencioso. Cobra tambem a chave do valor, que no banco se
// chama `valor` e nao `valor_centavos` — errar o nome nao levanta excecao.
{
  const alvo = p.locator('li.bloco', { hasText: 'Padaria do Teste' }).first();
  await alvo.getByRole('button', { name: 'Editar' }).click();
  await p.waitForTimeout(300);
  await alvo.locator('input[id^="ed-empresa-"]').fill('');
  await alvo.locator('input[id^="ed-valor-"]').fill('');
  await alvo.getByRole('button', { name: 'Salvar' }).click();
  await p.waitForTimeout(900);

  const texto = await limpo();
  if (texto.includes('padaria ltda')) {
    problemas.push('esvaziar a empresa nao apagou nada — a convencao de limpar nao chegou');
  }
  if (texto.includes('2.500,00')) {
    problemas.push('esvaziar o valor nao apagou — a chave de limpar do valor esta errada');
  }
}
// DESISTIR NAO DEIXA RASCUNHO.
//
// O cartao e o mesmo componente entre um recarregamento e outro, entao o que
// foi digitado sobrevive. Sem reler do lead ao abrir, quem digita e fecha sem
// salvar encontra o rascunho na proxima vez — e o salvar seguinte gravaria
// uma alteracao que ninguem pediu.
{
  const alvo = p.locator('li.bloco', { hasText: 'Padaria do Teste' }).first();
  await alvo.getByRole('button', { name: 'Editar' }).click();
  await p.waitForTimeout(300);
  await alvo.locator('input[id^="ed-empresa-"]').fill('Rascunho Abandonado');
  await alvo.getByRole('button', { name: 'Fechar' }).first().click();
  await p.waitForTimeout(300);
  await alvo.getByRole('button', { name: 'Editar' }).click();
  await p.waitForTimeout(300);
  const voltou = await alvo.locator('input[id^="ed-empresa-"]').inputValue();
  if (voltou !== '') {
    problemas.push(`reabrir o editar trouxe o rascunho de volta ("${voltou}")`);
  }
  await alvo.getByRole('button', { name: 'Fechar' }).first().click();
  await p.waitForTimeout(300);
}

await p.screenshot({ path: `${SAIDA}/comercial-04-editado.png`, fullPage: true });

// --- 10: VIROU CLIENTE
//
// `converter_lead` tambem estava sem porta. E a amarracao que faz a historia
// da venda sobreviver ao comeco do contrato.
{
  await p.getByRole('button', { name: '+ Novo lead' }).click();
  await p.waitForTimeout(300);
  await p.fill('#lead-nome', 'Mercado Convertido');
  await p.getByRole('button', { name: /Cadastrar lead/ }).click();
  await p.waitForTimeout(900);

  const m = p.locator('li.bloco', { hasText: 'Mercado Convertido' }).first();
  const virou = m.getByRole('button', { name: 'Virou cliente' });
  if (!(await virou.count())) {
    problemas.push('o cartao nao oferece amarrar o lead a um cliente');
  } else {
    await virou.click();
    await p.waitForTimeout(300);
    const sel = m.locator('select[id^="conv-"]');
    const quantos = await sel.locator('option').count();
    if (quantos < 2) {
      problemas.push('o seletor de cliente veio vazio — nao da para amarrar a ninguem');
    } else {
      await sel.selectOption({ index: 1 });
      await m.getByRole('button', { name: 'Amarrar ao cliente' }).click();
      await p.waitForTimeout(900);
      if (!(await limpo()).includes('agora é')) {
        problemas.push('a tela nao confirmou que o lead virou cliente');
      }
    }
  }

  // CONVERTIDO SAI DO FUNIL: `funil` so devolve lead aberto. Entao a prova
  // de que a conversao aconteceu e dupla — a tela confirmou, e o cartao
  // saiu da coluna. Se so sumisse, poderia ter sumido por erro.
  // Conta CARTAO, nao texto da pagina: o recado de confirmacao tambem diz o
  // nome do lead, e procurar no corpo inteiro daria verde de graca.
  if (await p.locator('li.bloco', { hasText: 'Mercado Convertido' }).count()) {
    problemas.push('o lead convertido continua no funil — a conversao nao pegou');
  }
  if (await p.locator('[role="alert"]').count()) {
    problemas.push('converter deixou um erro na tela');
  }
}

// --- 11: APAGAR engano de cadastro
{
  await p.getByRole('button', { name: '+ Novo lead' }).click();
  await p.waitForTimeout(300);
  await p.fill('#lead-nome', 'Engano De Cadastro');
  await p.getByRole('button', { name: /Cadastrar lead/ }).click();
  await p.waitForTimeout(900);

  const e = p.locator('li.bloco', { hasText: 'Engano De Cadastro' }).first();
  const apagar = e.getByRole('button', { name: 'Apagar', exact: true });
  if (!(await apagar.count())) {
    problemas.push('o cartao nao oferece apagar');
  } else {
    await apagar.click();
    await p.waitForTimeout(300);
    // Atras de confirmacao, porque leva o historico junto.
    if (!(await e.innerText()).toLowerCase().includes('leva o histórico junto')) {
      problemas.push('apagar nao avisa que leva o historico junto');
    }
    await e.getByRole('button', { name: 'Apagar mesmo' }).click();
    await p.waitForTimeout(900);
    if (await p.locator('li.bloco', { hasText: 'Engano De Cadastro' }).count()) {
      problemas.push('o lead apagado continua na tela');
    }
    if (!(await limpo()).includes('foi apagado')) {
      problemas.push('a tela nao confirmou que apagou');
    }
  }
}

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
