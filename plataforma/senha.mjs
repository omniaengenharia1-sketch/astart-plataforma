// O caminho da senha, que era o buraco: nao existia tela para criar uma.
//
// Tres entradas, uma tela:
//   convite       -> primeira senha de quem a agencia convidou
//   recuperacao   -> quem esqueceu e pediu link
//   link expirado -> nao mostra formulario que vai falhar, mostra o pedido
//
// O que este roteiro cobra de verdade e o que a tela NAO pode fazer: oferecer
// campo de senha para um link morto, aceitar senha curta, aceitar duas senhas
// diferentes, e dizer se um e-mail existe ou nao.
import { abrirNavegador } from './navegador.mjs';
import { readFileSync } from 'node:fs';

const AXE = readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');

const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = process.env.SAIDA ?? './tiros';
const falhas = [];
const cobrar = (ok, o) => { if (!ok) falhas.push(o); console.log(`${ok ? 'OK  ' : 'FALHOU  '}${o}`); };

const navegador = await abrirNavegador();
const ctx = await navegador.newContext({ viewport: { width: 1280, height: 980 } });
const p = await ctx.newPage();
const problemas = [];
p.on('pageerror', (e) => problemas.push(e.message));

// --- 1. esqueci minha senha, da tela de entrada ------------------------------
await p.goto(BASE, { waitUntil: 'networkidle' });

// Modo exemplo ou projeto de verdade? A diferenca nao e cosmetica: sem cliente
// Supabase nada consome o hash do endereco, e foi exatamente isso que escondeu
// um bug de producao — o roteiro passava no exemplo e a tela errava no ar.
// Entao o roteiro diz em que mundo esta, e cobra o que cabe em cada um.
const exemplo = await p.getByText('entrar como direção').isVisible().catch(() => false);
console.log(`    modo: ${exemplo ? 'exemplo' : 'projeto de verdade'} (${BASE})`);

cobrar(await p.getByText('Esqueci minha senha').isVisible(), 'a entrada oferece "Esqueci minha senha"');

await p.getByText('Esqueci minha senha').click();
cobrar(await p.getByRole('heading', { name: 'Recuperar acesso' }).isVisible(), 'o modo de recuperacao abre');
cobrar(
  (await p.locator('input[type=password]').count()) === 0,
  'o campo de senha sai de cena quando so o e-mail importa',
);

await p.locator('input[type=email]').fill('ninguem@exemplo.com');
await p.getByRole('button', { name: 'Mandar link' }).click();
const resposta = await p.locator('body').innerText();
cobrar(/Se existe conta com esse e-mail/.test(resposta), 'a resposta fala no condicional');
cobrar(
  !/nao existe|não existe|nao encontrei|não encontrei|nao cadastrado/i.test(resposta),
  'a tela NAO conta se o e-mail existe',
);
await p.screenshot({ path: `${SAIDA}/senha-1-esqueci.png` });

// --- 2. link expirado: pedido, nao formulario --------------------------------
//
// Esta e a cobranca que vale nos DOIS mundos, e foi a que achou o bug: com
// `detectSessionInUrl` o supabase-js limpa o hash antes da tela ler, entao no
// site de verdade a pessoa com link vencido via "precisa de um link" em vez de
// "este link nao serve mais" — perdia a unica informacao que explicava por que
// o dela nao funcionou. Em modo exemplo nao ha cliente, ninguem limpa o hash, e
// a cobranca passava sem tocar no caminho que quebrava.
await p.goto(`${BASE}/nova-senha#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`, {
  waitUntil: 'networkidle',
});
cobrar(
  await p.getByRole('heading', { name: 'Este link não serve mais' }).isVisible(),
  'link expirado e reconhecido pelo que o Supabase devolve no endereco',
);
cobrar(
  (await p.locator('input[type=password]').count()) === 0,
  'link morto NAO ganha campo de senha que falharia ao salvar',
);
cobrar(await p.getByRole('button', { name: 'Mandar link' }).isVisible(), 'oferece pedir outro link');
await p.screenshot({ path: `${SAIDA}/senha-2-expirado.png` });

// --- 3. /nova-senha sem link nenhum ------------------------------------------
//
// No projeto de verdade, quem digita o endereco na mao nao tem sessao de link:
// tem de ver o pedido, nao um formulario de senha. No exemplo nao existe link
// possivel, entao a tela mostra o caso do convite — e e o unico jeito de
// exercitar as validacoes do formulario sem um e-mail real no caminho.
await p.goto(`${BASE}/nova-senha`, { waitUntil: 'networkidle' });

if (!exemplo) {
  cobrar(
    await p.getByRole('heading', { name: 'Este endereço precisa de um link' }).isVisible(),
    'sem link, a tela pede o link em vez de oferecer campo de senha',
  );
  cobrar((await p.locator('input[type=password]').count()) === 0, 'e nao oferece campo de senha');
  cobrar(await p.getByRole('button', { name: 'Mandar link' }).isVisible(), 'oferece pedir um link');
} else {
  cobrar(await p.getByRole('heading', { name: 'Crie sua senha' }).isVisible(), 'o convite pede a primeira senha');
  cobrar((await p.locator('input[type=password]').count()) === 2, 'pede a senha duas vezes');

  const senhas = p.locator('input[type=password]');
  await senhas.nth(0).fill('curta');
  await senhas.nth(1).fill('curta');
  await p.getByRole('button', { name: 'Salvar e entrar' }).click();
  cobrar(/pelo menos 8 caracteres/i.test(await p.locator('body').innerText()), 'senha curta e recusada, com o numero na mensagem');

  await senhas.nth(0).fill('umaSenhaBoa123');
  await senhas.nth(1).fill('outraSenhaBoa123');
  await p.getByRole('button', { name: 'Salvar e entrar' }).click();
  cobrar(/não são iguais/i.test(await p.locator('body').innerText()), 'duas senhas diferentes sao recusadas');
}
await p.screenshot({ path: `${SAIDA}/senha-3-sem-link.png` });

// --- 4. axe nos tres estados, nos dois temas ---------------------------------
//
// O acessibilidade.mjs varre as telas DEPOIS do login, e esta e de antes: ela
// ficaria fora de toda auditoria se nao fosse aqui. Contraste fica de fora pelo
// mesmo motivo de sempre: o axe nao compoe vidro translucido e acusa tudo.
const CONFIG = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  rules: { 'color-contrast': { enabled: false } },
};

for (const claro of [false, true]) {
  const c2 = await navegador.newContext({ viewport: { width: 390, height: 844 }, colorScheme: claro ? 'light' : 'dark' });
  const p2 = await c2.newPage();
  for (const [onde, endereco] of [
    ['entrada', BASE],
    ['convite', `${BASE}/nova-senha`],
    ['expirado', `${BASE}/nova-senha#error=access_denied&error_code=otp_expired`],
  ]) {
    await p2.goto(endereco, { waitUntil: 'networkidle' });
    await p2.evaluate(AXE);
    const r = await p2.evaluate((cfg) => window.axe.run(document, cfg), CONFIG);
    const graves = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    cobrar(
      graves.length === 0,
      `axe sem violacao grave em ${onde}, tema ${claro ? 'claro' : 'escuro'}${graves.length ? ': ' + graves.map((v) => v.id).join(', ') : ''}`,
    );
  }
  await c2.close();
}

cobrar(problemas.length === 0, `nenhum erro de pagina (${problemas.length})`);
if (problemas.length) console.log(problemas.map((x) => `    ${x}`).join('\n'));

await navegador.close();
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nO caminho da senha esta de pe.');
process.exit(falhas.length ? 1 : 0);
