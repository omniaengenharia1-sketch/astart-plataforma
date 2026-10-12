// Abre TODAS as telas novas, dos dois lados, e cobra o basico de cada uma:
// um h1, nenhum erro de console, nada rolando na horizontal, e um pedaco de
// texto que so aparece se a tela de fato carregou os dados.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const SAIDA = process.env.SAIDA ?? './tiros';

const navegador = await abrirNavegador();
const problemas = [];

async function pagina(ctx, nome) {
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') problemas.push(`[console ${nome}] ${m.text()}`); });
  p.on('pageerror', (e) => problemas.push(`[erro ${nome}] ${e.message}`));
  return p;
}

// Preenche a tela de entrada que JA esta aberta. Sem `goto`: recarregar zera o
// estado do modo exemplo, e e exatamente a continuidade entre a sessao do
// cliente e a da equipe que este roteiro precisa provar.
async function entrar(p, email) {
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', 'qualquer');
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle');
}

async function abrir(p, email) {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await entrar(p, email);
}

const vis = (p, sel) => p.locator(`${sel}:visible`).first();

// Os dois menus tem itens de mesmo nome ("Financeiro" no topo e na ficha do
// cliente). Sem dizer de qual menu, o clique e ambiguo.
const menu = (p) => p.getByRole('navigation', { name: 'Seções', exact: true });
const abas = (p) => p.getByRole('navigation', { name: 'Seções do cliente' });

/** Confere uma tela aberta: h1, textos esperados, rolagem horizontal, tiro. */
async function conferir(p, nome, esperados, arquivo) {
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(250);

  const h1 = await p.locator('h1').count();
  if (h1 !== 1) problemas.push(`[${nome}] tem ${h1} h1 na pagina (tem de ter 1)`);

  const cru = await p.locator('body').innerText();
  const corpo = cru.toLowerCase();
  for (const e of esperados) {
    if (!corpo.includes(e.toLowerCase())) problemas.push(`[${nome}] nao mostra "${e}"`);
  }
  if (corpo.includes('em breve')) problemas.push(`[${nome}] ainda diz "Em breve"`);
  for (const sujeira of [/\bNaN\b/, /\bundefined\b/, /\bnull\b/, /\[object /, /Invalid Date/]) {
    if (sujeira.test(cru)) problemas.push(`[${nome}] tem ${sujeira.source} cru na tela`);
  }

  const rola = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (rola) problemas.push(`[${nome}] a pagina rola na horizontal`);

  await p.screenshot({ path: `${SAIDA}/${arquivo}.png`, fullPage: true });
}

// --- equipe ------------------------------------------------------------------
for (const [larg, alt, largura] of [[1440, 900, 'desktop'], [390, 844, 'celular']]) {
  const ctx = await navegador.newContext({ viewport: { width: larg, height: alt } });
  const p = await pagina(ctx, largura);
  await abrir(p, 'layana@astartstudio.com.br');

  const equipe = [
    ['Financeiro', ['atrasado', 'entrou', 'lançamentos', 'por cliente', 'karla bernardo'], 'financeiro'],
    ['Fila', ['travou', 'saindo agora', 'chopp do barbudo', 'token do instagram venceu'], 'fila'],
    ['Agenda', ['publicações', 'captações', 'cobranças'], 'agenda'],
    ['Comercial', ['em aberto', 'na mesa', 'renata alves', 'proposta enviada'], 'comercial'],
    ['Feedbacks', ['nps', 'respostas', 'reclamando', 'pamela dantas'], 'feedbacks'],
  ];

  for (const [item, esperados, arquivo] of equipe) {
    await menu(p).getByRole('link', { name: item, exact: true }).click();
    await conferir(p, `${largura} ${item}`, esperados, `${largura}-${arquivo}`);
  }

  // As abas novas da ficha, no cliente que tem contrato de tudo.
  await menu(p).getByRole('link', { name: 'Clientes', exact: true }).click();
  await p.waitForLoadState('networkidle');
  await vis(p, '.font-bold:has-text("Mor Marcas")').click();
  await p.waitForLoadState('networkidle');

  for (const [aba, esperados, arquivo] of [
    ['Grid', ['no grid', 'no ar', 'como o perfil vai ficar'], 'ficha-grid'],
    ['Financeiro', ['a vencer', 'em aberto', 'website — parcela 2 de 3'], 'ficha-financeiro'],
    ['Contrato', ['o que você contratou', 'gestão digital', 'o que o contrato libera'], 'ficha-contrato'],
    ['Ambientes e acessos', ['onde o site mora', 'mormarcas.com.br', 'domínios'], 'ficha-ambientes'],
    ['Feedbacks e NPS', ['as notas deste cliente'], 'ficha-nps'],
  ]) {
    await abas(p).getByRole('link', { name: aba, exact: true }).click();
    await conferir(p, `${largura} ficha/${aba}`, esperados, `${largura}-${arquivo}`);
  }

  // Campanhas so existe para quem contratou: Publika.ai.
  await menu(p).getByRole('link', { name: 'Clientes', exact: true }).click();
  await p.waitForLoadState('networkidle');
  await vis(p, '.font-bold:has-text("Publika.ai")').click();
  await p.waitForLoadState('networkidle');
  await abas(p).getByRole('link', { name: 'Campanhas', exact: true }).click();
  await conferir(p, `${largura} ficha/Campanhas`, ['alcance', 'meta ads', 'último período'], `${largura}-ficha-campanhas`);

  await ctx.close();
}

// --- portal do cliente -------------------------------------------------------
for (const [larg, alt, largura] of [[1280, 900, 'portal'], [390, 844, 'portal-celular']]) {
  const ctx = await navegador.newContext({ viewport: { width: larg, height: alt } });
  const p = await pagina(ctx, largura);
  await abrir(p, 'bruna@mormarcas.com.br');

  for (const [item, esperados, arquivo] of [
    ['Grid', ['no grid', 'a caminho'], 'grid'],
    ['Financeiro', ['a vencer', 'para pagar', 'copiar pix'], 'financeiro'],
    ['Contrato', ['o que você contratou', 'website'], 'contrato'],
    ['Meu site', ['onde o site mora', 'pedir ajuda'], 'site'],
    ['Feedback', ['como fomos este mês', 'de 0 a 10'], 'feedback'],
  ]) {
    await menu(p).getByRole('link', { name: item, exact: true }).click();
    await conferir(p, `${largura} ${item}`, esperados, `${largura}-${arquivo}`);
  }

  // A nota do NPS: escolher, enviar, e a pergunta sai da tela.
  await p.getByRole('button', { name: '9', exact: true }).click();
  const enviar = p.getByRole('button', { name: 'Enviar nota' });
  if (await enviar.isDisabled()) problemas.push(`[${largura}] o botao de enviar a nota ficou travado com nota escolhida`);
  await p.locator('#nps-comentario').fill('Entrega no prazo e material no ponto.');
  await enviar.click();
  await p.waitForTimeout(400);
  const depois = (await p.locator('body').innerText()).toLowerCase();
  if (depois.includes('como fomos este mês')) problemas.push(`[${largura}] a pergunta do NPS continuou depois de responder`);
  if (!depois.includes('obrigado')) problemas.push(`[${largura}] nao agradeceu depois da nota`);
  await p.screenshot({ path: `${SAIDA}/${largura}-feedback-respondido.png`, fullPage: true });

  // E a equipe tem de ver a nota que acabou de entrar.
  await vis(p, 'button:has-text("sair")').click();
  await p.waitForTimeout(300);
  await entrar(p, 'layana@astartstudio.com.br');
  await menu(p).getByRole('link', { name: 'Feedbacks', exact: true }).click();
  await p.waitForLoadState('networkidle');
  const naEquipe = (await p.locator('body').innerText()).toLowerCase();
  if (!naEquipe.includes('entrega no prazo e material no ponto')) {
    problemas.push(`[${largura}] o comentario do NPS nao chegou na tela da equipe`);
  }
  await p.screenshot({ path: `${SAIDA}/${largura}-nps-na-equipe.png`, fullPage: true });

  await ctx.close();
}

await navegador.close();
if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('telas novas: tudo o que foi checado passou');
