// Cadastra um cliente pela tela, em duas larguras, e confere que ele aparece
// na lista com o contrato que foi digitado.
import { abrirNavegador } from './navegador.mjs';
const SAIDA = './tiros';
const b = await abrirNavegador();
const problemas = [];

for (const [larg, alt, nome] of [[1440, 900, 'cad'], [390, 844, 'cad-celular']]) {
  const ctx = await b.newContext({ viewport: { width: larg, height: alt } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problemas.push(`[${nome}] erro: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') problemas.push(`[${nome}] console: ${m.text()}`); });

  await p.goto('http://localhost:4178', { waitUntil: 'networkidle' });
  // Direcao, nao operacao: o cadastro DIGITA o valor do contrato, e desde a
  // 0039 quem nao cuida do dinheiro grava e nao le de volta. Entrar como
  // operacao aqui testaria o cadastro contra uma ficha que esconde o preco.
  await p.fill('input[type="email"]', 'layana@astartstudio.com.br');
  await p.fill('input[type="password"]', 'x');
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle');
  await p.getByRole('link', { name: 'Clientes', exact: true }).click();
  await p.getByRole('button', { name: 'Novo cliente' }).click();
  await p.waitForLoadState('networkidle');
  await p.screenshot({ path: `${SAIDA}/${nome}-01-vazio.png`, fullPage: true });

  // A aba da proposta diz o que falta em vez de fingir que funciona.
  await p.getByRole('button', { name: 'Pela proposta' }).click();
  const prop = (await p.locator('body').innerText()).toLowerCase();
  if (!prop.includes('chave da ia')) problemas.push(`[${nome}] a aba da proposta nao diz o que falta`);
  await p.screenshot({ path: `${SAIDA}/${nome}-02-proposta.png`, fullPage: true });
  await p.getByRole('button', { name: 'Preencher à mão', exact: true }).click();

  // Sem nada preenchido o botao nao envia.
  const enviar = p.getByRole('button', { name: 'Cadastrar cliente' });
  if (!(await enviar.isDisabled())) problemas.push(`[${nome}] da pra cadastrar sem nome nem servico`);

  await p.fill('#nome', 'Café do Bairro & Cia');
  const endereco = await p.locator('#slug, .numeros').first().innerText();
  if (!endereco.includes('cafe-do-bairro-cia')) {
    problemas.push(`[${nome}] o endereco saiu errado: ${endereco}`);
  }

  // A barrinha dos servicos.
  await p.getByRole('button', { name: /escolher serviço/i }).click();
  await p.getByRole('button', { name: 'Gestão Digital por mês' }).click();
  await p.waitForTimeout(150);
  // Valor: so digito, montado da direita para a esquerda.
  // De proposito sem limpar o campo antes: e o que a pessoa faz.
  await p.locator('#srv-gestao_digital-valor').type('195000');
  const mostrado = await p.locator('#srv-gestao_digital-valor').inputValue();
  if (mostrado !== '1.950,00') problemas.push(`[${nome}] o campo de dinheiro mostrou ${mostrado}`);
  await p.locator('#srv-gestao_digital-dia').selectOption('15');
  await p.getByLabel('Campanhas').check();

  // QUEM CUIDA, no plural (0070).
  //
  // A dona: "as vezes o cliente e cuidado por mais de uma pessoa". Antes era
  // um seletor de um so, e a unica forma de dois nomes era cadastrar dois
  // servicos.
  //
  // Sao caixas de marcar, e nao `<select multiple>`: no telefone o seletor de
  // varios exige segurar e arrastar, e quase ninguem descobre que da para
  // marcar o segundo. Mesmo motivo do quadro de tarefas nao usar arrastar.
  {
    const bloco = p.locator('#srv-gestao_digital-resp');
    const pessoas = bloco.locator('button');
    const quantas = await pessoas.count();
    if (quantas < 2) {
      problemas.push(`[${nome}] so ha ${quantas} pessoa(s) para marcar como responsavel`);
    } else {
      await pessoas.nth(0).click();
      await pessoas.nth(1).click();
      await p.waitForTimeout(150);
      const marcadas = await bloco.locator('button[aria-pressed="true"]').count();
      if (marcadas !== 2) {
        problemas.push(`[${nome}] marquei duas pessoas e ficaram ${marcadas}`);
      }
      // Desmarcar tem de desmarcar: botao que so liga vira armadilha.
      await pessoas.nth(1).click();
      await p.waitForTimeout(150);
      if ((await bloco.locator('button[aria-pressed="true"]').count()) !== 1) {
        problemas.push(`[${nome}] clicar de novo nao desmarcou a pessoa`);
      }
      await pessoas.nth(1).click();
      await p.waitForTimeout(150);
    }
  }

  // Audiovisual: o unico que pergunta o formato.
  await p.getByRole('button', { name: /adicionar outro serviço/i }).click();
  await p.getByRole('button', { name: 'Audiovisual mensal ou pontual' }).click();
  await p.waitForTimeout(150);
  if (!(await enviar.isDisabled())) {
    problemas.push(`[${nome}] deixou cadastrar com o audiovisual sem formato`);
  }
  await p.screenshot({ path: `${SAIDA}/${nome}-03-falta-formato.png`, fullPage: true });
  await p.locator('div[aria-label="Formato de Audiovisual"]').getByRole('button', { name: 'Pontual' }).click();
  await p.locator('#srv-audiovisual-valor').type('240000');
  await p.waitForTimeout(150);

  const lateral = (await p.getByRole('complementary', { name: 'Resumo do contrato' }).innerText()).toLowerCase().replace(/\u00a0/g, ' ');
  for (const esperado of ['1.950,00', '2.400,00', 'campanhas', 'galeria', 'grid']) {
    if (!lateral.includes(esperado)) problemas.push(`[${nome}] o resumo nao mostra "${esperado}"`);
  }
  if (lateral.includes('integrações')) problemas.push(`[${nome}] o resumo liga modulo que nao foi contratado`);
  await p.screenshot({ path: `${SAIDA}/${nome}-04-preenchido.png`, fullPage: true });

  // CPF/CNPJ (0086).
  //
  // A dona: "na tela do cliente quando for cadastrar precisa do campo do
  // cnpj/cpf pra eu cadastrar". Nao e capricho de formulario: a fila da
  // cobranca so olha cliente com documento (`c.cnpj_cpf is not null` em
  // `cobrancas_para_emitir`), e quem nasce sem ele nunca e cobrado — sem erro,
  // sem log, sem nada. Cliente invisivel para o dinheiro.
  //
  // O digito verificador e conferido AQUI porque a Asaas recusa documento
  // invalido horas depois, numa rodada de madrugada, longe de quem digitou.
  await p.fill('#documento', '12345678000190'); // CNPJ com digito errado
  await p.waitForTimeout(150);
  const comDocErrado = (await p.locator('body').innerText()).toLowerCase();
  if (!comDocErrado.includes('não fecha')) {
    problemas.push(`[${nome}] aceitou CNPJ com digito errado sem reclamar`);
  }
  if (!(await enviar.isDisabled())) {
    problemas.push(`[${nome}] deixou cadastrar com o documento invalido`);
  }
  await p.screenshot({ path: `${SAIDA}/${nome}-04b-documento-invalido.png`, fullPage: true });

  // A mascara monta sozinha: quem digita so numero ve a pontuacao aparecer.
  await p.fill('#documento', '');
  await p.locator('#documento').type('11222333000181');
  const doc = await p.locator('#documento').inputValue();
  if (doc !== '11.222.333/0001-81') problemas.push(`[${nome}] a mascara do CNPJ saiu "${doc}"`);
  await p.fill('#email-cobranca', 'financeiro@cafedobairro.com.br');
  await p.locator('#telefone').type('11988887777');
  const tel = await p.locator('#telefone').inputValue();
  if (tel !== '(11) 98888-7777') problemas.push(`[${nome}] a mascara do telefone saiu "${tel}"`);
  await p.waitForTimeout(150);

  if (await enviar.isDisabled()) problemas.push(`[${nome}] o botao continua travado com tudo preenchido`);
  await enviar.click();
  await p.waitForTimeout(600);
  if (!p.url().includes('/clientes/')) problemas.push(`[${nome}] nao foi para a ficha: ${p.url()}`);
  // toLocaleString de moeda usa espaco nao separavel entre R$ e o numero.
  const ficha = (await p.locator('body').innerText()).toLowerCase().replace(/\u00a0/g, ' ');
  for (const esperado of ['café do bairro', 'gestão digital', 'audiovisual', 'r$ 1.950,00']) {
    if (!ficha.includes(esperado)) problemas.push(`[${nome}] a ficha nova nao mostra "${esperado}"`);
  }
  // O documento chegou na ficha, e a direcao le de volta (0087).
  for (const esperado of ['para cobrar', '11.222.333/0001-81', 'financeiro@cafedobairro.com.br']) {
    if (!ficha.includes(esperado)) problemas.push(`[${nome}] a ficha nao mostra "${esperado}"`);
  }
  await p.screenshot({ path: `${SAIDA}/${nome}-05-ficha-nova.png`, fullPage: true });

  // Cadastrar de novo com o mesmo nome tem de bater na trava do endereco.
  await p.getByRole('link', { name: 'Clientes', exact: true }).click();
  await p.getByRole('button', { name: 'Novo cliente' }).click();
  await p.fill('#nome', 'Café do Bairro & Cia');
  await p.getByRole('button', { name: /escolher serviço/i }).click();
  await p.getByRole('button', { name: 'Gestão Digital por mês' }).click();
  await p.locator('#srv-gestao_digital-valor').type('100000');
  await p.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await p.waitForTimeout(400);
  const aviso = (await p.locator('body').innerText()).toLowerCase();
  if (!aviso.includes('já existe um cliente')) {
    problemas.push(`[${nome}] cadastrou o mesmo endereco duas vezes`);
  }
  await p.screenshot({ path: `${SAIDA}/${nome}-06-endereco-repetido.png`, fullPage: true });

  const rolaH = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (rolaH) problemas.push(`[${nome}] a pagina rola na horizontal`);
  await ctx.close();
}

// E o inverso, uma vez: a operacao cadastra e nao le o valor de volta.
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problemas.push(`[cad-operacao] erro: ${e.message}`));

  await p.goto('http://localhost:4178', { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'raquel@astartstudio.com.br');
  await p.fill('input[type="password"]', 'x');
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle');
  await p.getByRole('link', { name: 'Clientes', exact: true }).click();
  await p.getByRole('button', { name: 'Novo cliente' }).click();
  await p.fill('#nome', 'Bar da Esquina');
  await p.getByRole('button', { name: /escolher serviço/i }).click();
  await p.getByRole('button', { name: 'Gestão Digital por mês' }).click();
  await p.locator('#srv-gestao_digital-valor').type('250000');
  // A operacao TEM o campo do documento: se ela cadastra o cliente, e ela que
  // tem o contrato na mao. Sem isto, todo cliente que a operacao cadastra
  // nasce fora da cobranca.
  if ((await p.locator('#documento').count()) !== 1) {
    problemas.push('[cad-operacao] a operacao nao tem onde digitar o CPF/CNPJ');
  }
  await p.locator('#documento').type('11144477735'); // CPF valido de teste
  await p.waitForTimeout(150);
  await p.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await p.waitForTimeout(600);

  if (!p.url().includes('/clientes/')) {
    problemas.push(`[cad-operacao] a operacao nao conseguiu cadastrar: ${p.url()}`);
  }
  const ficha = (await p.locator('body').innerText()).toLowerCase().replace(/\u00a0/g, ' ');
  if (!ficha.includes('bar da esquina')) problemas.push('[cad-operacao] o cliente novo nao abriu');
  if (!ficha.includes('gestão digital')) problemas.push('[cad-operacao] o serviço nao apareceu');
  if (ficha.includes('2.500,00')) problemas.push('[cad-operacao] ela le de volta o valor que digitou');
  // Mesma regra do dinheiro para o documento: a operacao DIGITA no cadastro
  // (senao o cliente nasce invisivel para a cobranca) e nao le de volta na
  // ficha. CPF de cliente nao e preciso para fazer um carrossel.
  if (ficha.includes('para cobrar')) {
    problemas.push('[cad-operacao] a operacao ve o painel de cobranca na ficha');
  }
  if (ficha.includes('r$')) problemas.push('[cad-operacao] tem valor em reais na ficha dela');
  await p.screenshot({ path: `${SAIDA}/cad-operacao.png`, fullPage: true });
  await ctx.close();
}

await b.close();
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('cadastro: tudo o que foi checado passou');
