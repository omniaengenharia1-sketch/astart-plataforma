// Convida alguem para a equipe, cancela o convite, tira e devolve acesso — e
// da acesso a um contato do cliente pela ficha.
import { abrirNavegador } from './navegador.mjs';
const SAIDA = './tiros';
const b = await abrirNavegador();
const problemas = [];
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => problemas.push(`erro: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error') problemas.push(`console: ${m.text()}`); });
const limpo = async () => (await p.locator('body').innerText()).toLowerCase().replace(/ /g, ' ');

await p.goto('http://localhost:4178', { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'layana@astartstudio.com.br');
await p.fill('input[type="password"]', 'x');
await p.click('button[type="submit"]');
await p.waitForLoadState('networkidle');

await p.getByRole('link', { name: 'Ajustes' }).click();
await p.waitForLoadState('networkidle');
const inicio = await limpo();
for (const esperado of ['viviane', 'camila', 'sem acesso', 'convite aberto']) {
  if (!inicio.includes(esperado)) problemas.push(`a tela de equipe nao mostra "${esperado}"`);
}
await p.screenshot({ path: `${SAIDA}/acesso-01-equipe.png`, fullPage: true });

// Convidar.
await p.getByRole('button', { name: 'Convidar pessoa' }).click();
await p.fill('#conv-nome', 'Marina');
await p.fill('#conv-email', 'marina@astartstudio.com.br');
await p.fill('#conv-cargo', 'Designer');
await p.selectOption('#conv-papel', 'operacao');
await p.screenshot({ path: `${SAIDA}/acesso-02-convite.png`, fullPage: true });
await p.getByRole('button', { name: 'Enviar convite' }).click();
await p.waitForTimeout(500);
const depois = await limpo();
if (!depois.includes('convite enviado para marina@astartstudio.com.br')) {
  problemas.push('nao confirmou o convite');
}
if (!depois.includes('marina@astartstudio.com.br')) problemas.push('o convite nao entrou na lista');

// Convidar o mesmo e-mail de novo tem de recusar.
await p.getByRole('button', { name: 'Convidar pessoa' }).click();
await p.fill('#conv-email', 'marina@astartstudio.com.br');
await p.getByRole('button', { name: 'Enviar convite' }).click();
await p.waitForTimeout(400);
if (!(await limpo()).includes('já existe um convite aberto')) {
  problemas.push('deixou convidar duas vezes o mesmo e-mail');
}
await p.screenshot({ path: `${SAIDA}/acesso-03-repetido.png`, fullPage: true });
await p.getByRole('button', { name: 'Cancelar', exact: true }).first().click();

// Cancelar o convite.
const linhaConvite = p.locator('li', { hasText: 'marina@astartstudio.com.br' });
await linhaConvite.getByRole('button', { name: 'Cancelar' }).click();
await p.waitForTimeout(400);
if ((await limpo()).includes('marina@astartstudio.com.br')) {
  problemas.push('o convite cancelado continua na lista');
}

// Tirar e devolver acesso.
const linhaCamila = p.locator('li', { hasText: 'camila@astartstudio.com.br' });
await linhaCamila.getByRole('button', { name: 'Tirar acesso' }).click();
await p.waitForTimeout(400);
if (!(await linhaCamila.innerText()).toLowerCase().includes('sem acesso')) {
  problemas.push('tirar o acesso nao marcou a pessoa');
}
await p.screenshot({ path: `${SAIDA}/acesso-04-sem-acesso.png`, fullPage: true });
await linhaCamila.getByRole('button', { name: 'Devolver' }).click();
await p.waitForTimeout(400);
if ((await linhaCamila.innerText()).toLowerCase().includes('sem acesso')) {
  problemas.push('devolver o acesso nao funcionou');
}

// Dar acesso a um contato do cliente, pela ficha.
await p.getByRole('link', { name: 'Clientes', exact: true }).click();
await p.locator('.font-bold:has-text("Mor Marcas"):visible').first().click();
await p.waitForLoadState('networkidle');
await p.getByRole('button', { name: 'Dar acesso' }).click();
await p.fill('#ac-nome', 'Sócio da Mor');
await p.fill('#ac-email', 'socio@mormarcas.com.br');
await p.selectOption('#ac-papel', 'leitura');
await p.getByRole('button', { name: 'Enviar convite' }).click();
await p.waitForTimeout(500);
const ficha = await limpo();
if (!ficha.includes('convite enviado para socio@mormarcas.com.br')) {
  problemas.push('nao confirmou o convite do cliente');
}
if (!ficha.includes('sócio da mor')) problemas.push('o contato novo nao apareceu na ficha');
await p.screenshot({ path: `${SAIDA}/acesso-05-cliente.png`, fullPage: true });

// Tirar o acesso de um contato.
const contato = p.locator('li', { hasText: 'bruna@mormarcas.com.br' });
await contato.getByRole('button', { name: 'Tirar' }).click();
await p.waitForTimeout(400);
if (!(await contato.innerText()).toLowerCase().includes('sem acesso')) {
  problemas.push('tirar o acesso do contato nao marcou nada');
}

// --- a faxina do balde (0062)
//
// Existe porque 60% do balde da Astart era lixo e ninguem sabia: 369 arquivos,
// 175 MB, de uma galeria apagada cujos arquivos ficaram. O apagar galeria
// engolia a falha em silencio — "o resto e lixo no balde, nao defeito na
// tela", escrito por mim.
//
// LIMITE HONESTO: em modo exemplo nao ha balde, entao a procura devolve zero
// sempre. O que se cobra aqui e que a tela EXISTA, que o botao responda e que
// ela nao ofereca apagar quando nao ha o que apagar. Se o numero bate com o
// balde de verdade, so o Supabase de verdade diz — e o teste de SQL 33 cobra
// a regra que importa (arquivo recem-subido nao e orfao).
await p.getByRole('link', { name: 'Ajustes' }).click();
await p.waitForLoadState('networkidle');
const comFaxina = await limpo();
if (!comFaxina.includes('arquivos sem dono')) {
  problemas.push('a tela de ajustes nao tem a faxina do balde');
}
const procurar = p.getByRole('button', { name: 'Procurar' });
if (!(await procurar.count())) {
  problemas.push('a faxina nao tem botao de procurar');
} else {
  await procurar.click();
  await p.waitForTimeout(700);
  const achou = await limpo();
  if (!achou.includes('servidor está limpo') && !/\d+ arquivos? ·/.test(achou)) {
    problemas.push('procurar nao disse o que achou');
  }
  // Sem nada sobrando, nao se oferece apagar: botao que so falha ensina a
  // pessoa a desconfiar da tela.
  if (achou.includes('servidor está limpo')
      && (await p.getByRole('button', { name: 'Apagar do servidor' }).count())) {
    problemas.push('oferece apagar mesmo sem nada para apagar');
  }
}
await p.screenshot({ path: `${SAIDA}/acesso-05-faxina.png`, fullPage: true });

await b.close();
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('acessos: tudo o que foi checado passou');
