#!/usr/bin/env node
// Aplica as migrations pendentes pela API de gerenciamento do Supabase.
//
// POR QUE ISTO EXISTE, e nao o `supabase db push`:
//
// O `db push` conecta direto no Postgres e exige a SENHA DO BANCO. Essa senha
// nao da para consultar — o Supabase a define na criacao do projeto e nunca
// mostra de novo, so deixa trocar. A dona nao a tinha, e a saida que ela
// propos foi me passar a senha para eu fazer. Isso nao: credencial colada no
// chat passa a existir na transcricao, e a regra deste projeto desde o
// primeiro dia e que segredo nenhum atravessa o navegador nem a conversa.
//
// Entao o segredo sai do caminho. A API de gerenciamento aplica SQL com o
// `SUPABASE_ACCESS_TOKEN`, que ja estava configurado e funcionando (e o mesmo
// que publica as Edge Functions). Um segredo a menos para guardar, um a menos
// para vazar, e nenhuma pergunta de "onde eu pego isso".
//
// O endpoint e o mesmo que o conector do Supabase usa por dentro, e foi por
// ele que as seis migrations de hoje entraram. A documentacao o marca como
// experimental; se um dia ele mudar, o `db push` continua existindo como
// alternativa — e o `--conferir` abaixo quebra primeiro, sem escrever nada.
//
// Uso:
//   node scripts/aplicar-migrations.mjs --conferir   # so le e lista o que falta
//   node scripts/aplicar-migrations.mjs              # aplica
//
// Precisa de SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF no ambiente.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = join(RAIZ, 'supabase', 'migrations');

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const REF = process.env.SUPABASE_PROJECT_REF?.trim();
const SO_CONFERIR = process.argv.includes('--conferir');

// Duas coisas diferentes, duas mensagens diferentes — a mesma licao do
// TICK_SECRET: "nao configurado" e "errado" nao podem dar a mesma resposta.
const faltando = [
  !TOKEN && 'SUPABASE_ACCESS_TOKEN',
  !REF && 'SUPABASE_PROJECT_REF',
].filter(Boolean);
if (faltando.length > 0) {
  console.error(
    `FALHOU: faltam estas variaveis: ${faltando.join(', ')}.\n` +
      'No GitHub: Settings > Secrets and variables > Actions.',
  );
  process.exit(1);
}

/** Uma chamada ao endpoint de query. Devolve o corpo ja em JSON. */
async function consultar(sql) {
  const resposta = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const texto = await resposta.text();
  let corpo = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = { resposta_nao_json: texto.slice(0, 2000) };
  }

  if (!resposta.ok) {
    // A mensagem da API vem em `message` quase sempre. O status sozinho nao
    // diz nada para quem esta lendo o log do CI as sete da noite.
    const motivo = corpo?.message ?? corpo?.error ?? texto.slice(0, 500) ?? '(sem corpo)';
    const erro = new Error(`HTTP ${resposta.status}: ${motivo}`);
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
}

/**
 * O livro-caixa, lido com a MESMA consulta que a ferramenta oficial usa.
 *
 * Nao e capricho: a CLI le `version, name`, e um livro-caixa sem a coluna
 * `name` a faz falhar com uma mensagem que nao explica nada. Ler igual a ela
 * garante que o que funciona aqui funciona la.
 */
async function jaAplicadas() {
  const linhas = await consultar(
    'select version, name from supabase_migrations.schema_migrations order by version',
  );
  return new Map((linhas ?? []).map((l) => [l.version, l.name]));
}

/** Os arquivos, em ordem de nome — que e a ordem de aplicacao. */
function doDisco() {
  return readdirSync(PASTA)
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((arquivo) => {
      const m = /^(\d+)_(.+)\.sql$/.exec(arquivo);
      if (!m) {
        throw new Error(
          `FALHOU: o nome "${arquivo}" nao segue <versao>_<nome>.sql. ` +
            'A ferramenta oficial compara a versao pelo nome do arquivo, e um ' +
            'arquivo fora do padrao seria aplicado de novo a cada rodada.',
        );
      }
      return { arquivo, versao: m[1], nome: m[2], sql: readFileSync(join(PASTA, arquivo), 'utf8') };
    });
}

/**
 * Uma etiqueta de dollar-quoting que NAO aparece no conteudo.
 *
 * O SQL das migrations usa `$$` para corpo de funcao, entao embutir o arquivo
 * numa string com `$$` fecharia a citacao no meio e produziria um erro de
 * sintaxe incompreensivel. A etiqueta e conferida contra o texto antes de ser
 * usada — adivinhar que "provavelmente nao colide" e como esse tipo de bug
 * nasce.
 */
function etiqueta(conteudo) {
  for (let i = 0; i < 1000; i++) {
    const tag = `$mig${i}$`;
    if (!conteudo.includes(tag)) return tag;
  }
  throw new Error('FALHOU: nao achei uma etiqueta de citacao livre para este arquivo.');
}

async function registrar({ versao, nome, sql }) {
  const tag = etiqueta(sql);
  // `statements` guarda o arquivo inteiro num elemento. A CLI usa essa coluna
  // em `migration repair` e no diff; guardar o texto inteiro e honesto e
  // suficiente, e nao tenta reimplementar o separador de statements dela —
  // que e exatamente o tipo de reimplementacao que divergiria em silencio.
  await consultar(
    `insert into supabase_migrations.schema_migrations (version, name, statements)
     values ('${versao}', '${nome}', array[${tag}${sql}${tag}])
     on conflict (version) do update set name = excluded.name,
                                         statements = excluded.statements`,
  );
}

const aplicadas = await jaAplicadas();
const arquivos = doDisco();
const pendentes = arquivos.filter((a) => !aplicadas.has(a.versao));

console.log(`livro-caixa: ${aplicadas.size} aplicadas · disco: ${arquivos.length} arquivos`);

// Divergencia ao contrario: o banco tem versao que nao existe mais no disco.
// Nao impede nada, mas e sinal de migration apagada ou renomeada depois de
// aplicada, e ninguem quer descobrir isso num `db diff` seis meses depois.
const noDisco = new Set(arquivos.map((a) => a.versao));
const orfas = [...aplicadas.keys()].filter((v) => !noDisco.has(v));
if (orfas.length > 0) {
  console.log(`AVISO: ${orfas.length} versao(oes) no banco sem arquivo no disco: ${orfas.join(', ')}`);
}

if (pendentes.length === 0) {
  console.log('OK  nada pendente: producao e o que esta no repositorio.');
  process.exit(0);
}

console.log(`\npendentes (${pendentes.length}):`);
for (const p of pendentes) console.log(`  ${p.versao}  ${p.nome}`);

if (SO_CONFERIR) {
  // A conferencia e READ-ONLY de proposito, e roda ANTES de aplicar no CI: se
  // o token estiver errado ou o endpoint tiver mudado, a rodada morre aqui,
  // sem ter encostado no schema.
  console.log('\n(--conferir: nada foi aplicado)');
  process.exit(0);
}

for (const p of pendentes) {
  process.stdout.write(`\naplicando ${p.arquivo} … `);
  try {
    await consultar(p.sql);
  } catch (e) {
    console.error(`\n\nFALHOU em ${p.arquivo}:\n${e.message}\n`);
    console.error(
      'Nada depois deste arquivo foi aplicado, e ele pode ter ficado pela metade: ' +
        'a API aplica cada arquivo numa transacao, entao o que falhou voltou atras.',
    );
    process.exit(1);
  }

  try {
    await registrar(p);
  } catch (e) {
    // O pior dos dois mundos: o schema mudou e o livro-caixa nao soube. A
    // proxima rodada tentaria aplicar de novo. Dizer isso alto e melhor que
    // sair com codigo zero fingindo sucesso.
    console.error(
      `\n\nFALHOU ao registrar ${p.arquivo} no livro-caixa: ${e.message}\n` +
        'ATENCAO: o SQL foi aplicado e o registro nao. Me avise antes de rodar de novo.',
    );
    process.exit(1);
  }
  console.log('ok');
}

console.log(`\nOK  ${pendentes.length} migration(s) aplicada(s).`);
