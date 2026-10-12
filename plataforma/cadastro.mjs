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
  await p.fill('input[type="email"]', 'viviane@astartstudio.com.br');
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

  if (await enviar.isDisabled()) problemas.push(`[${nome}] o botao continua travado com tudo preenchido`);
  await enviar.click();
  await p.waitForTimeout(600);
  if (!p.url().includes('/clientes/')) problemas.push(`[${nome}] nao foi para a ficha: ${p.url()}`);
  // toLocaleString de moeda usa espaco nao separavel entre R$ e o numero.
  const ficha = (await p.locator('body').innerText()).toLowerCase().replace(/\u00a0/g, ' ');
  for (const esperado of ['café do bairro', 'gestão digital', 'audiovisual', 'r$ 1.950,00']) {
    if (!ficha.includes(esperado)) problemas.push(`[${nome}] a ficha nova nao mostra "${esperado}"`);
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
  await p.fill('input[type="email"]', 'layana@astartstudio.com.br');
  await p.fill('input[type="password"]', 'x');
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle');
  await p.getByRole('link', { name: 'Clientes', exact: true }).click();
  await p.getByRole('button', { name: 'Novo cliente' }).click();
  await p.fill('#nome', 'Bar da Esquina');
  await p.getByRole('button', { name: /escolher serviço/i }).click();
  await p.getByRole('button', { name: 'Gestão Digital por mês' }).click();
  await p.locator('#srv-gestao_digital-valor').type('250000');
  await p.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await p.waitForTimeout(600);

  if (!p.url().includes('/clientes/')) {
    problemas.push(`[cad-operacao] a operacao nao conseguiu cadastrar: ${p.url()}`);
  }
  const ficha = (await p.locator('body').innerText()).toLowerCase().replace(/\u00a0/g, ' ');
  if (!ficha.includes('bar da esquina')) problemas.push('[cad-operacao] o cliente novo nao abriu');
  if (!ficha.includes('gestão digital')) problemas.push('[cad-operacao] o serviço nao apareceu');
  if (ficha.includes('2.500,00')) problemas.push('[cad-operacao] ela le de volta o valor que digitou');
  if (ficha.includes('r$')) problemas.push('[cad-operacao] tem valor em reais na ficha dela');
  await p.screenshot({ path: `${SAIDA}/cad-operacao.png`, fullPage: true });
  await ctx.close();
}

await b.close();
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('cadastro: tudo o que foi checado passou');
