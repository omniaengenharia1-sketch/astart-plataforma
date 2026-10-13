#!/usr/bin/env node
// Prova que as TRÊS cópias da regra de formato concordam.
//
// A regra existe em três lugares, em duas linguagens, e não dá para ser em um
// só:
//
//   `supabase/functions/_shared/meta/formatos.ts` — o adaptador lê esta para
//   decidir o que manda para a Meta. Roda em Deno, dentro da Edge Function.
//   É a FONTE DA VERDADE: a Meta aceita coisa que a gente não implementou.
//
//   `public.formatos_suportados` + `public.limites_de_midia` (0055, 0056) — o
//   banco, que recusa na hora de criar a publicação e na hora de anexar o
//   arquivo. Roda em Postgres.
//
//   `plataforma/src/dados/formatos.ts` — a tela, que desenha os chips, escreve
//   "pede 1 foto JPG" embaixo, limita o seletor de arquivos e recusa no modo
//   exemplo. Roda no navegador.
//
// Cópias da mesma regra em linguagens diferentes é a armadilha que este projeto
// já pagou CINCO vezes: a tela oferecia quatro formatos e o adaptador publicava
// um; o front aceitava PNG e a Meta só publica JPEG; o teste cobrava uma
// mensagem que escondia o terceiro formato de contrato; o banco aceitava vídeo
// em carrossel e o adaptador não (achado por este prover, na primeira vez que
// rodou); e a tela prometia vídeo em carrossel em DOIS lugares — inclusive no
// modo exemplo, que é onde os roteiros de navegador rodam, então nenhum roteiro
// podia pegar. Em todas, a cópia que divergiu era a menos olhada, e quem pagou
// foi quem leu a tela.
//
// Então a divergência passa a ser um erro de build, não uma descoberta de
// madrugada. É o mesmo papel do `provar-cors.mjs`: fazer a verificação tão
// exigente quanto a realidade.
//
// O banco é o eixo da comparação, não porque manda, mas porque é o único dos
// três que as duas pontas têm de respeitar: o adaptador é comparado com ele e a
// tela é comparada com ele. Divergência em qualquer ponta aparece.
//
// Uso:
//   node scripts/provar-canais.mjs            # compara com o banco de teste local
//   node scripts/provar-canais.mjs --producao # compara com o banco de produção
//
// Local precisa do Postgres de teste de pé (veja supabase/tests/rodar.sh).
// Produção precisa de SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCAO = process.argv.includes('--producao');

const falhas = [];
const cobrar = (ok, o) => {
  if (!ok) falhas.push(o);
  console.log(`${ok ? 'OK  ' : 'FALHOU  '}${o}`);
};

/**
 * Se a entrada tem motivo escrito. 'escrito', nao a frase: nos dois arquivos
 * TypeScript o motivo e uma constante nomeada (`SEM_ADAPTADOR`,
 * `FALTA_FACEBOOK`), entao daqui so se ve o nome. A frase em si e cobrada no
 * lado do banco, que e de onde a tela le o texto que mostra.
 *
 * `null` quando a chave nao existe E quando existe valendo null — as duas
 * coisas significam "nao explica por que".
 */
const motivoDe = (corpo) => (/motivo:\s*(?!null\b)\S/.test(corpo) ? 'escrito' : null);

// ---------------------------------------------------------------------------
// O lado TypeScript
//
// Lido do ARQUIVO, com regex, em vez de importado. Importar exigiria Deno (o
// módulo usa especificadores `jsr:` nos vizinhos) e um passo de build só para
// este prover. A regex é frágil de um jeito seguro: se o formato do arquivo
// mudar, ela acha zero linhas e o prover falha alto, em vez de comparar lista
// vazia com lista vazia e dizer que está tudo bem.
// ---------------------------------------------------------------------------
function doTypeScript() {
  const texto = readFileSync(
    join(RAIZ, 'supabase', 'functions', '_shared', 'meta', 'formatos.ts'),
    'utf8',
  );

  const regras = [];
  for (const [plataforma, constante] of [
    ['instagram', 'FORMATOS_INSTAGRAM'],
    ['facebook', 'FORMATOS_FACEBOOK'],
  ]) {
    const bloco = new RegExp(`${constante}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(texto);
    if (!bloco) {
      console.error(`FALHOU: nao achei a constante ${constante} em formatos.ts.`);
      process.exit(1);
    }
    // Cada entrada é `nome: { ... }`, com o corpo possivelmente em várias linhas.
    for (const m of bloco[1].matchAll(/(\w+):\s*\{([\s\S]*?)\}/g)) {
      const corpo = m[2];
      const num = (chave) => {
        const v = new RegExp(`${chave}:\\s*(\\d+)`).exec(corpo);
        return v ? Number(v[1]) : null;
      };
      regras.push({
        plataforma,
        tipo: m[1],
        minimo: num('minimo'),
        maximo: num('maximo'),
        natureza: /natureza:\s*'([a-z_]+)'/.exec(corpo)?.[1] ?? null,
        // Sem `publicavel: false` escrito, é true — é o default do arquivo.
        publicavel: !/publicavel:\s*false/.test(corpo),
        motivo: motivoDe(corpo),
      });
    }
  }
  return regras;
}

// ---------------------------------------------------------------------------
// O lado da TELA
//
// Lido do arquivo pelo mesmo motivo: importar `.ts` exigiria um passo de build
// só para este prover. A regex falha alto se o arquivo mudar de forma — ela
// cobra 4 formatos e 8 canais, e sair desse número é erro, não lista vazia
// comparada com lista vazia.
// ---------------------------------------------------------------------------
function doFront() {
  const texto = readFileSync(
    join(RAIZ, 'plataforma', 'src', 'dados', 'formatos.ts'),
    'utf8',
  );

  const acharBloco = (nome, abre, fecha) => {
    const m = new RegExp(`${nome}[^=]*=\\s*\\${abre}([\\s\\S]*?)\\n\\${fecha};`).exec(texto);
    if (!m) {
      console.error(`FALHOU: nao achei ${nome} em plataforma/src/dados/formatos.ts.`);
      process.exit(1);
    }
    return m[1];
  };

  // Os limites, por tipo.
  const limites = new Map();
  for (const m of acharBloco('FORMATOS', '{', '}').matchAll(/(\w+):\s*\{([\s\S]*?)\}/g)) {
    const corpo = m[2];
    const num = (chave) => {
      const v = new RegExp(`${chave}:\\s*(\\d+)`).exec(corpo);
      return v ? Number(v[1]) : null;
    };
    limites.set(m[1], {
      minimo: num('minimo'),
      maximo: num('maximo'),
      natureza: /natureza:\s*'([a-z_]+)'/.exec(corpo)?.[1] ?? null,
    });
  }

  // E quais (rede × formato) publicam.
  const regras = [];
  for (const m of acharBloco('CANAIS', '[', ']').matchAll(/\{([^}]*)\}/g)) {
    const corpo = m[1];
    const txt = (chave) => new RegExp(`${chave}:\\s*'([a-z_]+)'`).exec(corpo)?.[1] ?? null;
    const plataforma = txt('plataforma');
    const tipo = txt('tipo');
    const lim = limites.get(tipo) ?? { minimo: null, maximo: null, natureza: null };
    regras.push({
      plataforma,
      tipo,
      publicavel: /publicavel:\s*true/.test(corpo),
      motivo: motivoDe(corpo),
      ...lim,
    });
  }

  if (limites.size !== 4 || regras.length !== 8) {
    console.error(
      `FALHOU: esperava 4 formatos e 8 canais na tela, achei ${limites.size} e ${regras.length}. ` +
        'A regex deste prover nao entende mais o arquivo — conserte o prover antes de confiar nele.',
    );
    process.exit(1);
  }
  return regras;
}

// ---------------------------------------------------------------------------
// O lado SQL
// ---------------------------------------------------------------------------
const CONSULTA = `
  select f.plataforma::text as plataforma,
         f.tipo::text       as tipo,
         f.publicavel,
         f.motivo,
         l.minimo,
         l.maximo,
         l.natureza
    from public.formatos_suportados f
    cross join lateral public.limites_de_midia(f.tipo) l
   order by 1, 2
`;

function doBancoLocal() {
  const saida = execFileSync(
    'psql',
    ['-h', '/tmp', '-p', '5444', '-U', 'postgres', '-d', 'astart', '-At', '-F', '\t', '-c', CONSULTA],
    { encoding: 'utf8' },
  );
  return saida
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [plataforma, tipo, publicavel, motivo, minimo, maximo, natureza] = l.split('\t');
      return {
        plataforma,
        tipo,
        publicavel: publicavel === 't',
        motivo: motivo || null,
        minimo: Number(minimo),
        maximo: Number(maximo),
        natureza,
      };
    });
}

async function doBancoProducao() {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const ref = process.env.SUPABASE_PROJECT_REF?.trim();
  if (!token || !ref) {
    console.error('FALHOU: --producao precisa de SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF.');
    process.exit(1);
  }
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CONSULTA, read_only: true }),
  });
  if (!r.ok) {
    console.error(`FALHOU: a API respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`);
    process.exit(1);
  }
  return (await r.json()).map((l) => ({ ...l, minimo: Number(l.minimo), maximo: Number(l.maximo) }));
}

// ---------------------------------------------------------------------------
// A comparação
// ---------------------------------------------------------------------------
const chave = (r) => `${r.plataforma}/${r.tipo}`;

/** Compara uma ponta com o banco, nos dois sentidos. */
function comparar(nome, lista, sql) {
  const mapaA = new Map(lista.map((r) => [chave(r), r]));
  const mapaB = new Map(sql.map((r) => [chave(r), r]));

  cobrar(lista.length > 0, `${nome}: a lista nao esta vazia`);

  // Nos dois sentidos: regra que só existe num lado é divergência igual.
  for (const k of mapaA.keys()) cobrar(mapaB.has(k), `${nome}: ${k} tambem existe no banco`);
  for (const k of mapaB.keys()) cobrar(mapaA.has(k), `${nome}: ${k} do banco tambem existe aqui`);

  for (const [k, a] of mapaA) {
    const b = mapaB.get(k);
    if (!b) continue;
    cobrar(
      a.publicavel === b.publicavel,
      `${nome}: ${k} publicavel concorda (${nome} ${a.publicavel}, banco ${b.publicavel})`,
    );
    cobrar(a.minimo === b.minimo, `${nome}: ${k} minimo concorda (${a.minimo} / ${b.minimo})`);
    cobrar(a.maximo === b.maximo, `${nome}: ${k} maximo concorda (${a.maximo} / ${b.maximo})`);
    cobrar(
      a.natureza === b.natureza,
      `${nome}: ${k} natureza concorda (${a.natureza} / ${b.natureza})`,
    );
    // Canal que nao publica TEM de dizer por que, nas duas pontas. Chip apagado
    // sem motivo e a pior tela possivel: a pessoa nao sabe se e defeito ou se
    // falta recurso, e vai procurar o que nao existe.
    if (!b.publicavel) {
      cobrar(Boolean(a.motivo), `${nome}: ${k} nao publica e explica por que`);
    }
  }
}

const adaptador = doTypeScript();
const tela = doFront();
const sql = PRODUCAO ? await doBancoProducao() : doBancoLocal();

console.log(
  `adaptador: ${adaptador.length} regras · tela: ${tela.length} regras · banco: ${sql.length} regras\n`,
);

cobrar(sql.length > 0, 'banco: a lista nao esta vazia');
comparar('adaptador', adaptador, sql);
comparar('tela', tela, sql);

// E o motivo do banco e o que a tela mostra quando nao tem chip nenhum
// disponivel, entao ele tem de ser uma frase, nao um rotulo.
for (const b of sql) {
  if (!b.publicavel) {
    cobrar(
      Boolean(b.motivo && b.motivo.trim().length > 10),
      `banco: ${chave(b)} nao publica e o motivo e uma frase legivel`,
    );
  }
}

if (falhas.length > 0) {
  console.log(`\nPROBLEMAS (${falhas.length}):\n${falhas.join('\n')}`);
  console.log(
    '\nAs copias da regra divergiram. Conserte TODAS as que o relatorio acima acusa:\n' +
      '  adaptador  supabase/functions/_shared/meta/formatos.ts\n' +
      '  tela       plataforma/src/dados/formatos.ts\n' +
      '  banco      uma migration nova sobre formatos_suportados / limites_de_midia\n' +
      'Mexer num lado so recria o problema.',
  );
  process.exit(1);
}
console.log(`\nAs tres copias da regra concordam (${sql.length} canais).`);
