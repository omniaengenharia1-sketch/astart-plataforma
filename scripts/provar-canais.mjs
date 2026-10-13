#!/usr/bin/env node
// Prova que as DUAS cópias da regra de formato concordam.
//
// A regra existe em dois lugares, em duas linguagens, e não dá para ser em um
// só:
//
//   `supabase/functions/_shared/meta/formatos.ts` — o adaptador lê esta para
//   decidir o que manda para a Meta. Roda em Deno, dentro da Edge Function.
//
//   `public.formatos_suportados` (migration 0055) — a tela lê esta para
//   decidir quais chips oferecer, e as duas travas de escrita a usam para
//   recusar. Roda em Postgres.
//
// Duas cópias da mesma regra é a armadilha que este projeto já pagou três
// vezes: a tela oferecia quatro formatos e o adaptador publicava um; o front
// aceitava PNG e a Meta só publica JPEG; o teste cobrava uma mensagem que
// escondia o terceiro formato de contrato. Em todas, a cópia que divergiu era
// a menos olhada, e quem pagou foi quem leu a tela.
//
// Então a divergência passa a ser um erro de build, não uma descoberta de
// madrugada. É o mesmo papel do `provar-cors.mjs`: fazer a verificação tão
// exigente quanto a realidade.
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
      });
    }
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
const ts = doTypeScript();
const sql = PRODUCAO ? await doBancoProducao() : doBancoLocal();

console.log(`typescript: ${ts.length} regras · banco: ${sql.length} regras\n`);

cobrar(ts.length > 0, 'a lista do typescript nao esta vazia');
cobrar(sql.length > 0, 'a lista do banco nao esta vazia');

const chave = (r) => `${r.plataforma}/${r.tipo}`;
const mapaTs = new Map(ts.map((r) => [chave(r), r]));
const mapaSql = new Map(sql.map((r) => [chave(r), r]));

// Nos dois sentidos: regra que só existe num lado é divergência igual.
for (const k of mapaTs.keys()) {
  cobrar(mapaSql.has(k), `${k} existe no typescript e no banco`);
}
for (const k of mapaSql.keys()) {
  cobrar(mapaTs.has(k), `${k} existe no banco e no typescript`);
}

for (const [k, a] of mapaTs) {
  const b = mapaSql.get(k);
  if (!b) continue;
  cobrar(
    a.publicavel === b.publicavel,
    `${k}: publicavel concorda (typescript ${a.publicavel}, banco ${b.publicavel})`,
  );
  cobrar(a.minimo === b.minimo, `${k}: minimo concorda (${a.minimo} / ${b.minimo})`);
  cobrar(a.maximo === b.maximo, `${k}: maximo concorda (${a.maximo} / ${b.maximo})`);
  cobrar(
    a.natureza === b.natureza,
    `${k}: natureza concorda (${a.natureza} / ${b.natureza})`,
  );
  // Formato que nao publica TEM de dizer por que. Chip apagado sem motivo e a
  // pior tela possivel: a pessoa nao sabe se e defeito ou falta de feature.
  if (!b.publicavel) {
    cobrar(
      Boolean(b.motivo && b.motivo.trim().length > 10),
      `${k}: nao publica e o banco explica por que`,
    );
  }
}

if (falhas.length > 0) {
  console.log(`\nPROBLEMAS (${falhas.length}):\n${falhas.join('\n')}`);
  console.log(
    '\nAs duas copias da regra divergiram. Conserte as DUAS: ' +
      'supabase/functions/_shared/meta/formatos.ts e uma migration nova sobre ' +
      'public.formatos_suportados. Mexer num lado so recria o problema.',
  );
  process.exit(1);
}
console.log(`\nAs duas copias da regra concordam (${ts.length} canais).`);
