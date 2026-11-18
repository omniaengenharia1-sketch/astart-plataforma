// A cobranca do mes, no navegador.
//
// O achado mais caro da varredura que a dona cobrou: OITO contratos ativos e
// ZERO lancamentos. `gerar_cobrancas_do_contrato` existe desde a 0020, foi
// corrigida na 0064, tem teste verde em dois arquivos — e nunca foi chamada
// por ninguem. Sem tela, sem gatilho, sem cron. O financeiro estava montado
// sem a entrada de dinheiro.
//
// Pior: a tela de exemplo SEMPRE mostrou mensalidade, porque o mock as
// inventava a partir dos contratos. Entao tudo parecia certo em todo lugar
// onde eu olhava, e so a producao estava vazia. E por isso que este roteiro
// comeca indo para um mes SEM lancamento nenhum: e la que a ausencia
// aparece.
//
// O que ele cobra:
//
//   1. o mes vazio nao mente mais. A frase antiga era "as mensalidades
//      entram sozinhas quando o contrato comeca" — ninguem nunca escreveu
//      isso em codigo. Texto que promete o que o sistema nao faz e pior que
//      tela vazia;
//   2. o botao existe, e diz QUANTOS contratos vai lancar antes de ser
//      apertado;
//   3. o primeiro clique so pergunta. Dinheiro de cliente nao sai de um
//      clique unico;
//   4. confirmar cria os lancamentos, e eles APARECEM na tabela — nao basta
//      a mensagem de sucesso;
//   5. apertar de novo NAO cobra de novo, e a tela DIZ que nao cobrou. Este
//      e o item que justifica o arquivo: cobrar duas vezes o cliente de
//      outra pessoa e o pior erro que este modulo pode cometer;
//   6. e quem nao cuida do dinheiro nao chega aqui.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const falhas = [];
const cobrar = (ok, o) => { console.log(`${ok ? 'OK ' : 'FALHA'}  ${o}`); if (!ok) falhas.push(o); };

const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: 'dark' });
const p = await ctx.newPage();
const problemas = [];
p.on('pageerror', (e) => problemas.push(e.message));

async function entrar(pg, email) {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.fill('input[type="email"]', email);
  await pg.fill('input[type="password"]', 'x');
  await pg.click('button[type="submit"]');
  await pg.waitForLoadState('networkidle');
}

const corpo = async () => (await p.locator('body').innerText()).toLowerCase();
const linhas = () => p.locator('tbody tr').count();

await entrar(p, 'layana@astartstudio.com.br');
await p.goto(`${BASE}/financeiro`, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);

// Vai para o mes que vem, que no exemplo nasce sem lancamento nenhum. E ali
// que a falta do gerador aparece: no mes corrente o mock ja tinha inventado
// as mensalidades.
await p.getByRole('button', { name: 'mês >' }).click();
await p.waitForTimeout(900);

// --- 1: o vazio nao promete o que ninguem implementou
const vazio = await corpo();
cobrar(
  vazio.includes('mês sem lançamento'),
  'o mes que vem comeca sem lancamento (e onde a ausencia aparece)',
);
cobrar(
  !vazio.includes('entram sozinhas'),
  'e a tela NAO promete que as mensalidades entram sozinhas — nunca entraram',
);

// --- 2: o botao, com o tamanho do que vai fazer
const botao = p.getByRole('button', { name: /Gerar mensalidades de/ });
if (!(await botao.count())) {
  cobrar(false, 'nao ha como gerar as mensalidades do mes');
  console.log(`\n${falhas.length} falha(s)`);
  await b.close();
  process.exit(1);
}
cobrar(true, 'a tela oferece gerar as mensalidades do mes');

// --- 3: o primeiro clique so pergunta
await botao.click();
await p.waitForTimeout(400);
const pergunta = await corpo();
cobrar(
  /\d+ contratos ativos|contrato ativo/.test(pergunta),
  'e pergunta antes, dizendo quantos contratos vai lancar',
);
cobrar(
  pergunta.includes('ninguém é cobrado duas vezes'),
  'avisando que quem ja esta lancado fica como esta',
);
cobrar(
  (await linhas()) === 0,
  'o primeiro clique NAO lancou nada — dinheiro de cliente nao sai de um clique',
);

// --- 4: confirmar cria, e aparece
await p.getByRole('button', { name: 'Lançar', exact: true }).click();
await p.waitForTimeout(1500);

const criadas = await linhas();
cobrar(criadas > 0, `as mensalidades aparecem na tabela depois de lancar (${criadas})`);
const depois = await corpo();
cobrar(
  /lançamentos criados|lançamento criado/.test(depois),
  'e a tela diz quantos lancamentos criou, em que mes',
);
await p.screenshot({ path: './tiros/cobranca-01-lancado.png', fullPage: true });

// --- 5: a segunda rodada nao cobra de novo, E DIZ ISSO
await p.getByRole('button', { name: /Gerar mensalidades de/ }).click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: 'Lançar', exact: true }).click();
await p.waitForTimeout(1500);

cobrar(
  (await linhas()) === criadas,
  'apertar de novo nao criou nenhum lancamento a mais',
);
cobrar(
  (await corpo()).includes('nada novo'),
  'e a tela DIZ que nao cobrou de novo, em vez de ficar calada',
);
await p.screenshot({ path: './tiros/cobranca-02-de-novo.png', fullPage: true });

cobrar(problemas.length === 0, `nenhum erro de pagina (${problemas.length})`);
if (problemas.length) console.log(problemas.map((x) => `    ${x}`).join('\n'));
await ctx.close();

// --- 6: quem nao cuida do dinheiro nao chega aqui
{
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
  const o = await ctx2.newPage();
  await entrar(o, 'raquel@astartstudio.com.br');
  await o.goto(`${BASE}/financeiro`, { waitUntil: 'networkidle' });
  await o.waitForTimeout(700);
  const visto = (await o.locator('body').innerText()).toLowerCase();
  cobrar(
    !visto.includes('gerar mensalidades'),
    'a operacao nao encontra o botao de gerar cobranca',
  );
  await ctx2.close();
}

await b.close();
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nA cobranca do mes esta de pe.');
process.exit(falhas.length ? 1 : 0);
