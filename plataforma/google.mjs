// Ligar a agenda do Google, no navegador.
//
// A dona: "a agenda eu preciso que vc deixe ela integrada no google agenda",
// nos dois sentidos e com a conta de cada pessoa da equipe.
//
// POR QUE A TELA ENSINA ANTES DE PEDIR
//
// Isto não é "entrar com o Google". Os e-mails da agência são de cPanel, não
// de Google Workspace, e nesse caso o Google só libera o acesso à agenda
// depois de uma análise de semanas — ou a autorização expira a cada sete dias
// e cada pessoa religa toda semana.
//
// O caminho que evita a análise inteira: a pessoa compartilha a própria
// agenda com o endereço robô da plataforma, uma vez, dentro do Google
// Agenda. Então a tela tem de ensinar esse passo ANTES de pedir o ID. Pedir
// primeiro e explicar depois é o jeito de alguém colar o e-mail errado,
// apertar ligar, e achar que ligou.
//
// O que este roteiro cobra:
//
//   1. a seção existe em Ajustes;
//   2. o endereço do robô aparece INTEIRO e dá para copiar — se ele estiver
//      cortado na tela, a pessoa cola pela metade e nada funciona;
//   3. a tela diz, com todas as letras, que a permissão tem de ser "fazer
//      alterações" — com "ver detalhes" a ponte só funciona de um lado, e
//      essa é a diferença que ninguém adivinha;
//   4. o botão de ligar nasce desligado sem o ID;
//   5. ligar mostra o estado ligado, com o ID que foi dado;
//   6. e desligar volta ao começo, avisando que o que já foi continua lá.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const falhas = [];
const cobrar = (ok, o) => { console.log(`${ok ? 'OK ' : 'FALHA'}  ${o}`); if (!ok) falhas.push(o); };

const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 }, colorScheme: 'dark' });
const p = await ctx.newPage();
const problemas = [];
p.on('pageerror', (e) => problemas.push(e.message));

const corpo = async () => (await p.locator('body').innerText()).toLowerCase();

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'layana@astartstudio.com.br');
await p.fill('input[type="password"]', 'x');
await p.click('button[type="submit"]');
await p.waitForLoadState('networkidle');
await p.goto(`${BASE}/ajustes`, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);

// --- 1 e 2: a seção, e o endereço inteiro
const texto = await corpo();
cobrar(texto.includes('minha agenda do google'), 'Ajustes oferece ligar a agenda do Google');
cobrar(
  texto.includes('agenda-astart@astart-propostas.iam.gserviceaccount.com'),
  'o endereço do robô aparece INTEIRO — cortado, a pessoa cola pela metade',
);
cobrar(
  await p.getByRole('button', { name: 'copiar' }).count() > 0,
  'e dá para copiar, em vez de digitar 52 caracteres à mão',
);

// --- 3: a permissão certa, dita com todas as letras
cobrar(
  texto.includes('fazer alterações e ver todos os detalhes'),
  'a tela diz QUAL permissão escolher no Google',
);
cobrar(
  texto.includes('só funciona de um lado'),
  'e diz o que acontece se escolher a errada — é a diferença que ninguém adivinha',
);
// A assercao ingenua ("a pagina nao contem 'entrar com o google'") falhava
// pelo motivo errado: a tela DIZ a frase, negando-a. O que importa e que ela
// nao OFERECA esse caminho — entao cobro a negacao, e que nao haja botao.
cobrar(
  texto.includes('não é “entrar com o google”') || texto.includes('não é "entrar com o google"'),
  'a tela avisa que isto NAO e "entrar com o Google" — o caminho que expira em 7 dias',
);
cobrar(
  await p.getByRole('button', { name: /entrar com o google/i }).count() === 0,
  'e nao existe botao nenhum oferecendo aquele caminho',
);

// --- 4: o botão cobra o ID
const ligar = p.getByRole('button', { name: /Ligar minha agenda/ });
cobrar(await ligar.count() > 0, 'há um botão para ligar');
cobrar(await ligar.isDisabled(), 'que nasce desligado, sem o ID da agenda');

// --- 5: ligar
await p.fill('#g-calendario', 'Layana.Astart@gmail.com');
await p.waitForTimeout(200);
cobrar(!(await ligar.isDisabled()), 'e libera com o ID preenchido');
await ligar.click();
await p.waitForTimeout(1200);

const depois = await corpo();
cobrar(depois.includes('ligada'), 'depois de ligar, a tela diz que está ligada');
cobrar(
  depois.includes('layana.astart@gmail.com'),
  'mostrando qual agenda — e em minúsculas, como o banco guarda',
);
cobrar(
  depois.includes('ainda não sincronizou'),
  'e é honesta: ainda não sincronizou, em vez de fingir que já está tudo lá',
);
await p.screenshot({ path: './tiros/google-01-ligada.png', fullPage: true });

// --- 6: desligar
await p.getByRole('button', { name: 'Desligar' }).click();
await p.waitForTimeout(1200);
const fim = await corpo();
cobrar(
  fim.includes('continua lá'),
  'desligar avisa que o que já foi para o Google continua lá',
);
cobrar(
  await p.locator('#g-calendario').count() > 0,
  'e a tela volta a oferecer ligar',
);

cobrar(problemas.length === 0, `nenhum erro de pagina (${problemas.length})`);
if (problemas.length) console.log(problemas.map((x) => `    ${x}`).join('\n'));

await b.close();
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nA ponte com o Google esta de pe.');
process.exit(falhas.length ? 1 : 0);
