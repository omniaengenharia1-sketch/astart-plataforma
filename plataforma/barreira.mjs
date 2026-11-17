// A barreira de erro, no navegador.
//
// POR QUE ESTE ROTEIRO EXISTE
//
// A dona apagou um cliente e a plataforma inteira virou uma tela em branco:
// sem menu, sem mensagem, sem caminho de volta. Ela mandou a captura duas
// vezes, com doze minutos de diferenca, e nas duas a tela era o fundo da
// pagina e mais nada.
//
// O conserto e a `BarreiraDeErro`. Mas barreira que ninguem exercita e
// barreira que a gente descobre quebrada no proximo incidente — e o proximo
// incidente e, de novo, uma tela branca na frente dela.
//
// O QUE ESTE ROTEIRO COBRA
//   1. a pagina NAO fica em branco quando um componente estoura;
//   2. aparece texto legivel em portugues, nao um "Something went wrong";
//   3. ha uma SAIDA clicavel — a tela branca nao tinha, e e por isso que ela
//      prende;
//   4. o erro tecnico fica disponivel, recolhido. Sem ele, socorrer alguem
//      exige pedir que a pessoa abra o console — que e pedir para quem esta no
//      celular, no meio de uma entrega, virar programadora;
//   5. a barreira ABAIXA ao sair da tela quebrada. Sem isso ela vira muro: a
//      pessoa fica presa na tela de erro ate recarregar na mao.
//
// O 1 e o que importa: e exatamente o sintoma que ela viu.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = process.env.SAIDA ?? './tiros';
const falhas = [];
const cobrar = (ok, o) => { if (!ok) falhas.push(o); console.log(`${ok ? 'OK  ' : 'FALHOU  '}${o}`); };

const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();

// A barreira manda o erro para o console de proposito. Aqui isso e esperado,
// entao nao conta como problema — o que conta e o que aparece NA TELA.
const problemas = [];
p.on('pageerror', (e) => problemas.push(e.message));

await p.goto(`${BASE}/estourar`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(900);

// 1. NAO FICOU EM BRANCO.
const texto = (await p.locator('body').innerText()).trim();
cobrar(texto.length > 0, `a pagina nao fica em branco quando algo estoura (${texto.length} caracteres)`);

// 2. Em portugues, dizendo o que aconteceu.
cobrar(
  /não conseguiu abrir|algo quebrou/i.test(texto),
  'a tela diz o que aconteceu, em portugues',
);
// E diz que o resto esta de pe: quem ve tela quebrada acha que perdeu trabalho.
cobrar(
  /nada do seu trabalho se perdeu|resto da plataforma/i.test(texto),
  'e tranquiliza sobre o que NAO se perdeu',
);

// 3. Uma saida clicavel.
const voltar = p.getByRole('button', { name: /Voltar para o início/i });
cobrar(await voltar.count() > 0, 'ha um botao de saida — a tela branca nao tinha nenhuma');

// 4. O erro tecnico, disponivel mas recolhido.
const detalhe = p.locator('details');
cobrar(await detalhe.count() > 0, 'o erro tecnico fica disponivel para quem for consertar');
if (await detalhe.count()) {
  cobrar(
    !(await detalhe.locator('pre').first().isVisible()),
    'e comeca RECOLHIDO: aberto, assustaria sem ajudar',
  );
  await detalhe.locator('summary').first().click();
  await p.waitForTimeout(250);
  const aberto = await detalhe.innerText();
  cobrar(
    /Tela de teste da barreira/i.test(aberto),
    'e, aberto, mostra a mensagem de verdade do erro',
  );
}

await p.screenshot({ path: `${SAIDA}/barreira-01-erro.png`, fullPage: false });

// 5. A BARREIRA ABAIXA ao sair da tela quebrada.
//
// Sem isto ela seria um muro. Cobra navegando por dentro da aplicacao, e nao
// recarregando a pagina: recarregar limpa tudo e passaria mesmo com o defeito.
await voltar.click();
await p.waitForTimeout(1200);
const depois = (await p.locator('body').innerText()).trim();
cobrar(
  !/não conseguiu abrir/i.test(depois),
  'sair da tela quebrada desfaz a barreira, sem recarregar na mao',
);
cobrar(depois.length > 0, 'e o que vem depois dela desenha de verdade');

await p.screenshot({ path: `${SAIDA}/barreira-02-saiu.png`, fullPage: false });

await b.close();

// O erro no console e esperado: e a propria barreira registrando. O que nao
// pode acontecer e ele chegar ao console SEM a tela ter aparecido, e isso o
// item 1 ja cobra.
if (problemas.length > 1) {
  console.log(`(${problemas.length} erros no console, esperado 1 — o da propria barreira)`);
}

if (falhas.length) { console.log(`\n${falhas.length} falha(s)`); process.exit(1); }
console.log('\nA barreira de erro esta de pe: tela quebrada fala, e tem saida.');
