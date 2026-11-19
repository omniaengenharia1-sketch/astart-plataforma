// A agenda em calendário de mês, no navegador.
//
// A dona: "pq nao consigo colocar coisas na agenda, vc precisa fazer a agenda
// estilo calendário. CALENDÁRIO BRASILEIRO".
//
// A Agenda mostrava quatro tipos de evento e TODOS nasciam em outro módulo —
// peça agendada, captação, marco, cobrança. Não existia tabela de compromisso
// avulso: reunião, gravação, visita. A tela se chamava agenda e não aceitava
// nada. Era uma vitrine.
//
// O que este roteiro cobra:
//
//   1. a grade é de MÊS e a semana começa no DOMINGO — é o calendário de
//      parede do Brasil, e foi o que ela pediu com todas as letras;
//   2. o dia de hoje aparece marcado, senão a grade não responde "onde eu
//      estou";
//   3. dá para marcar, e o compromisso aparece NO DIA CERTO da grade, com a
//      hora. Não basta a mensagem de sucesso;
//   4. abrir um compromisso traz o que está valendo, preenchido — abrir vazio
//      e salvar por cima apagaria local e hora sem ninguém pedir;
//   5. hora de fim antes do começo é recusada, com a recusa NA TELA e o
//      formulário ainda aberto;
//   6. desmarcar fica atrás de confirmação e some da grade;
//   7. só compromisso é clicável: publicação, captação, marco e cobrança
//      pertencem ao módulo que os criou, e um botão que não faz nada é pior
//      que botão nenhum;
//   8. e o cliente não chega nesta tela — é nela que aparece o nome dos
//      outros clientes.
//
// O 3 e o 7 são os que justificam o arquivo.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const falhas = [];
const cobrar = (ok, o) => { console.log(`${ok ? 'OK ' : 'FALHA'}  ${o}`); if (!ok) falhas.push(o); };

const b = await abrirNavegador();
const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 }, colorScheme: 'dark' });
const p = await ctx.newPage();
const problemas = [];
p.on('pageerror', (e) => problemas.push(e.message));

const corpo = async () => (await p.locator('body').innerText()).toLowerCase();

async function entrar(pg, email) {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.fill('input[type="email"]', email);
  await pg.fill('input[type="password"]', 'x');
  await pg.click('button[type="submit"]');
  await pg.waitForLoadState('networkidle');
}

await entrar(p, 'layana@astartstudio.com.br');
await p.goto(`${BASE}/agenda`, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);

// --- 1: calendário de mês, domingo primeiro
const celulas = await p.locator('[data-dia]').count();
cobrar(celulas === 35 || celulas === 42, `a grade é de mês inteiro (${celulas} dias)`);

const cabeca = (await p.locator('.grid-cols-7').first().innerText()).toLowerCase().replace(/\s+/g, ' ').trim();
cobrar(
  cabeca.startsWith('dom seg ter qua qui sex sáb'),
  `a semana começa no domingo, como o calendário brasileiro (leu "${cabeca}")`,
);

// --- 2: hoje está marcado
const hoje = new Date();
const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
const celulaHoje = p.locator(`[data-dia="${hojeISO}"]`);
cobrar(await celulaHoje.count() === 1, 'o dia de hoje está na grade');
cobrar(
  (await celulaHoje.getAttribute('class') ?? '').includes('outline-pink'),
  'e aparece marcado — a grade responde "onde eu estou"',
);

// --- 3: marcar, e aparecer no dia certo
const dia = `${hojeISO.slice(0, 8)}15`;          // dia 15 deste mês
await p.locator(`[data-dia="${dia}"] button[aria-label^="Marcar"]`).click();
await p.waitForTimeout(400);

cobrar(await p.locator('#k-titulo').count() > 0, 'o "+" do dia abre o formulário de marcar');
cobrar(
  (await p.locator('#k-dia').inputValue()) === dia,
  'já com o dia em que se clicou — ninguém devia digitar a data de novo',
);

const marcar = p.getByRole('button', { name: 'Marcar', exact: true });
cobrar(await marcar.isDisabled(), 'e o botão nasce desligado, sem título');

await p.fill('#k-titulo', 'Reunião com a Publika');
await p.fill('#k-hora', '15:30');
await p.fill('#k-local', 'Sala da agência');
await p.waitForTimeout(200);
await marcar.click();
await p.waitForTimeout(1400);

const naGrade = p.locator(`[data-dia="${dia}"]`);
const textoDoDia = (await naGrade.innerText()).toLowerCase();
cobrar(textoDoDia.includes('reunião com a publika'), 'o compromisso aparece no dia 15 da grade');
cobrar(textoDoDia.includes('15:30'), 'com a hora, que é o que faz a grade servir');
cobrar((await corpo()).includes('entrou na agenda'), 'e a tela confirma');
await p.screenshot({ path: './tiros/agenda-01-marcado.png', fullPage: true });

// --- 4: abrir traz o que está valendo
await naGrade.getByRole('button', { name: /Reunião com a Publika/ }).click();
await p.waitForTimeout(700);
cobrar(
  (await p.locator('#k-titulo').inputValue()) === 'Reunião com a Publika',
  'abrir o compromisso traz o título que está valendo',
);
cobrar(
  (await p.locator('#k-hora').inputValue()) === '15:30',
  'e a hora — abrir vazio e salvar por cima apagaria tudo',
);
cobrar(
  (await p.locator('#k-local').inputValue()) === 'Sala da agência',
  'e o local',
);

// --- 5: fim antes do começo é recusado, sem fechar o formulário
await p.fill('#k-hora-fim', '14:00');
await p.getByRole('button', { name: 'Salvar' }).click();
await p.waitForTimeout(1200);
cobrar(
  (await corpo()).includes('depois do começo') || (await corpo()).includes('depois do comeco'),
  'terminar antes de começar é recusado, com o motivo na tela',
);
cobrar(
  await p.locator('#k-titulo').count() > 0,
  'e o formulário CONTINUA ABERTO — erro não pode engolir o que foi digitado',
);

// Pelo caminho certo.
await p.fill('#k-hora-fim', '17:00');
await p.getByRole('button', { name: 'Salvar' }).click();
await p.waitForTimeout(1400);
cobrar((await corpo()).includes('corrigido'), 'com a hora certa, salva');

// --- 7: só compromisso é clicável
{
  const naoEditaveis = await p.locator('[data-dia] div[title]').count();
  cobrar(naoEditaveis > 0, `a grade mostra os eventos dos outros módulos (${naoEditaveis})`);
  const botoes = await p.locator('[data-dia] ul button').count();
  cobrar(
    botoes >= 1 && botoes <= naoEditaveis,
    'mas só o compromisso é botão: os outros pertencem ao módulo que os criou',
  );
}

// --- 6: desmarcar
await p.locator(`[data-dia="${dia}"]`).getByRole('button', { name: /Reunião com a Publika/ }).click();
await p.waitForTimeout(700);
await p.getByRole('button', { name: 'Desmarcar', exact: true }).click();
await p.waitForTimeout(300);
cobrar(
  (await corpo()).includes('tira da agenda de todo mundo'),
  'desmarcar avisa antes, porque a agenda é de todo mundo',
);
await p.getByRole('button', { name: 'Desmarcar mesmo' }).click();
await p.waitForTimeout(1400);
cobrar(
  !(await p.locator(`[data-dia="${dia}"]`).innerText()).toLowerCase().includes('reunião com a publika'),
  'e o compromisso sai da grade',
);

cobrar(problemas.length === 0, `nenhum erro de pagina (${problemas.length})`);
if (problemas.length) console.log(problemas.map((x) => `    ${x}`).join('\n'));
await ctx.close();

// --- 8: o cliente não vê a agenda interna
{
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
  const o = await ctx2.newPage();
  await entrar(o, 'bruna@mormarcas.com.br');
  await o.waitForTimeout(600);
  // Confere que ela ENTROU mesmo. Sem isto, um e-mail errado deixaria a tela
  // de login na frente e o teste passaria pelo motivo errado — ja cai nessa
  // armadilha antes neste projeto.
  const entrou = (await o.locator('body').innerText()).toLowerCase();
  cobrar(
    !entrou.includes('entrar') || entrou.includes('bruna'),
    'a cliente entrou mesmo no portal (senao o teste passaria de graca)',
  );
  await o.goto(`${BASE}/agenda`, { waitUntil: 'networkidle' });
  await o.waitForTimeout(700);
  const visto = (await o.locator('body').innerText()).toLowerCase();
  cobrar(
    !visto.includes('+ marcar') && !visto.includes('o mês escrito'),
    'e mesmo assim nao chega na agenda interna da agência',
  );
  await ctx2.close();
}

await b.close();
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nA agenda em calendário esta de pe.');
process.exit(falhas.length ? 1 : 0);
