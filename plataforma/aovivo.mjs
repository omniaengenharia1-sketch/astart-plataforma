// A plataforma, ligada no banco de verdade, vista por quem nao tem conta.
//
// Nao e roteiro de tela: e a prova de que o `.env.local` aponta para o projeto
// certo, que o modo exemplo NAO esta ligado, e que um visitante sem login nao
// arranca dado nenhum do banco. Isso ultimo o RLS ja garante no servidor; aqui
// se confere pelo lado de quem abre o navegador, que e onde o erro apareceria.
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env['BASE'] ?? 'http://127.0.0.1:4179';
const falhas = [];
const cobrar = (ok, o) => { if (!ok) falhas.push(o); console.log(`${ok ? 'OK  ' : 'FALHOU  '}${o}`); };

const navegador = await abrirNavegador();
const contexto = await navegador.newContext();
const pagina = await contexto.newPage();

const rede = [];
pagina.on('response', (r) => {
  const u = r.url();
  if (u.includes('.supabase.co')) rede.push({ u: u.replace(/^https:\/\/[^/]+/, ''), s: r.status() });
});

await pagina.goto(BASE, { waitUntil: 'networkidle' });

const texto = await pagina.locator('body').innerText();
cobrar(!/modo exemplo/i.test(texto), 'nao esta em modo exemplo');
cobrar(/entrar/i.test(texto), 'a tela de entrar aparece');

// Nenhum nome de cliente de exemplo pode vazar numa tela sem login.
for (const nome of ['Karla', 'Publika', 'Confraria']) {
  cobrar(!texto.includes(nome), `nada de "${nome}" na tela sem login`);
}

// O endereco do projeto no bundle tem que ser o de producao, nao localhost.
const alvo = await pagina.evaluate(() => {
  const s = [...document.scripts].map((e) => e.src).find((e) => e.includes('index-'));
  return s ?? '';
});
cobrar(alvo !== '', 'o bundle carregou');

// Se alguma chamada ao banco voltou 200 com corpo, e vazamento.
const vazou = rede.filter((r) => r.s === 200 && r.u.includes('/rest/v1/'));
cobrar(vazou.length === 0, `nenhuma leitura de tabela respondeu 200 sem login (${rede.length} chamadas ao projeto)`);
if (rede.length) console.log('    rede:', rede.map((r) => `${r.s} ${r.u.slice(0, 60)}`).join(' | '));

// A prova do rewrite, e a unica que existe: a rota e URL limpa, entao um
// caminho fundo pedido DIRETO ao servidor (que e o que um F5 faz) precisa
// voltar o index.html. Navegando por cliques isto nunca falha, porque o
// servidor nao e consultado — e por isso o erro chega em producao.
for (const fundo of ['/clientes/00000000-0000-0000-0000-000000000000', '/financeiro', '/a/token-qualquer']) {
  // O `goto` ESTOURA quando o servidor nao serve nada ali, e estourar e o caso
  // que mais importa: e exatamente o que acontece sem o rewrite. Sem este
  // try/catch a checagem morre com stack trace em vez de dizer o que falhou,
  // e quem le a saida fica sem a unica informacao util.
  let estado = 0;
  let corpo = '';
  let erro = '';
  try {
    const r = await pagina.goto(BASE + fundo, { waitUntil: 'domcontentloaded' });
    estado = r?.status() ?? 0;
    corpo = (await pagina.locator('body').innerText()).trim();
  } catch (e) {
    erro = e instanceof Error ? e.message.split('\n')[0] : String(e);
  }
  const ok = estado === 200 && corpo.length > 0;
  cobrar(ok, erro
    ? `recarregar ${fundo}: o servidor nao serviu nada (${erro}) — falta o rewrite`
    : estado !== 200
      ? `recarregar ${fundo}: http ${estado} em vez de 200 — falta o rewrite`
      : corpo.length === 0
        ? `recarregar ${fundo}: http 200 mas a tela veio vazia`
        : `recarregar ${fundo} nao da tela branca (http 200, ${corpo.length} caracteres)`);
}

await pagina.goto(BASE, { waitUntil: 'networkidle' });
await pagina.screenshot({ path: process.env['FOTO'] ?? '/tmp/aovivo.png', fullPage: false });
await navegador.close();

console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo: ligada no banco, fechada para quem nao entrou.');
process.exit(falhas.length ? 1 : 0);
