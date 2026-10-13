// Gera as migrations em blocos para colar no SQL Editor do Supabase.
//
// Existe porque aplicar 41 migrations pelo CLI exige CLI instalado, repositorio
// clonado e a senha do banco na mao. Colar quatro blocos no painel nao exige
// nada disso — e a senha nunca sai do painel.
//
// Dois cuidados que nao sao opcionais:
//   1. cada bloco grava no `supabase_migrations.schema_migrations`, que e o
//      MESMO livro-caixa do `supabase db push`. Sem isso, no dia em que alguem
//      rodar o CLI ele tentaria aplicar as 41 de novo;
//   2. cada bloco se recusa a rodar duas vezes. Repetir nunca ia funcionar — a
//      0017 troca uma coluna que a 0005 criou, e nenhum `if not exists`
//      conserta isso — entao a recusa e explicita, em vez de um erro de coluna.
//
// Uso:  node scripts/gerar-blocos.mjs [destino]
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;
const ORIGEM = join(RAIZ, 'supabase/migrations');
const DESTINO = process.argv[2] ?? join(RAIZ, 'supabase/blocos');
const LIMITE = 95_000;

mkdirSync(DESTINO, { recursive: true });

/**
 * Migration que adiciona valor a um enum FECHA o bloco.
 *
 * O Postgres nao deixa USAR um valor de enum novo na mesma transacao que o
 * criou ("unsafe use of new value ... New enum values must be committed before
 * they can be used"). O `supabase db push` nao sofre disso porque aplica uma
 * migration por transacao; o SQL Editor roda o arquivo colado inteiro numa
 * transacao so. A 0010 adiciona 'operacao' ao `papel_perfil` e a 0011 usa o
 * valor na linha seguinte — juntas no mesmo paste, morre.
 *
 * Entao o corte nao e so por tamanho: e por commit.
 */
const MUDA_ENUM = /alter\s+type\s+[\w."]+\s+add\s+value/i;

const arquivos = readdirSync(ORIGEM).filter((f) => f.endsWith('.sql')).sort();
const blocos = [];
let atual = [];
let tam = 0;
for (const f of arquivos) {
  const txt = readFileSync(join(ORIGEM, f), 'utf8');
  if (tam && tam + txt.length > LIMITE) {
    blocos.push(atual);
    atual = [];
    tam = 0;
  }
  atual.push({ f, txt });
  tam += txt.length;
  if (MUDA_ENUM.test(txt)) {
    // Fecha aqui: o valor novo precisa estar commitado antes de alguem usar.
    blocos.push(atual);
    atual = [];
    tam = 0;
  }
}
if (atual.length) blocos.push(atual);

const N = blocos.length;
blocos.forEach((bloco, i0) => {
  const i = i0 + 1;
  const versoes = bloco.map(({ f }) => /^(\d+)_/.exec(basename(f))[1]);
  const lista = bloco.map(({ f }) => `--   ${basename(f)}`).join('\n');
  // `name` e o que a ferramenta oficial mostra na listagem: o nome do arquivo
  // sem o carimbo de hora e sem o `.sql`, igual ao que o CLI gravaria.
  const valores = bloco
    .map(({ f }) => {
      const [, v, nome] = /^(\d+)_(.+)\.sql$/.exec(basename(f));
      return `('${v}', '${nome}')`;
    })
    .join(',\n    ');

  // Com N=5 o atalho `1, 2, 3, ${N}` dizia "1, 2, 3, 5" e mandava pular o 4.
  const ordem = Array.from({ length: N }, (_, k) => k + 1).join(', ');
  const cabeca = `-- =============================================================================
-- Astart — banco, bloco ${i} de ${N}
--
-- COMO USAR: cole este arquivo inteiro no SQL Editor do Supabase e clique Run.
-- Rode os blocos EM ORDEM — ${ordem} — porque cada um depende do anterior.
--
-- RODE UMA VEZ SO. Nao e seguro repetir: a migration 0017 troca uma coluna que
-- a 0005 criou, e nenhum \`if not exists\` conserta isso — e a natureza de uma
-- SEQUENCIA de migrations, nao um descuido. Por isso o bloco se recusa a rodar
-- duas vezes, com uma mensagem clara, em vez de deixar um erro de coluna.
--
-- Se der erro, me manda a mensagem inteira: ela diz o arquivo e a linha.
--
-- Migrations neste bloco:
${lista}
-- =============================================================================

-- ---------------------------------------------------------------------------
-- O livro-caixa das migrations.
--
-- E o MESMO que o \`supabase db push\` usa. Gravar aqui tem um motivo concreto:
-- no dia em que alguem rodar o CLI, ele le esta tabela para saber o que ja foi
-- aplicado. Sem o registro, ele tentaria aplicar as ${arquivos.length} de novo — e
-- quebraria exatamente como quebraria colar este bloco duas vezes.
-- ---------------------------------------------------------------------------
create schema if not exists supabase_migrations;

-- As TRES colunas do CLI, nao uma. Eu criei esta tabela so com a version, e ela
-- aceitou os registros sem reclamar — mas a ferramenta oficial consulta
-- "select version, name from ..." e morre com "column name does not exist".
-- Livro-caixa que so o autor consegue ler nao e livro-caixa, e o erro so
-- aparece no dia em que alguem usa o CLI, ou seja no pior dia possivel.
create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  statements text[],
  name       text
);

-- Para o banco que nasceu com a versao errada deste gerador.
alter table supabase_migrations.schema_migrations
  add column if not exists statements text[],
  add column if not exists name text;

do $ja$
begin
  if exists (
    select 1 from supabase_migrations.schema_migrations
     where version = '${versoes[0]}'
  ) then
    raise exception
      'O bloco ${i} de ${N} ja foi aplicado neste banco. Pule para o bloco seguinte.';
  end if;
end
$ja$;

`;

  const corpo = bloco
    .map(({ f, txt }) => `\n-- ########## ${basename(f)} ##########\n\n${txt}\n`)
    .join('');

  const rodape = `
-- ---------------------------------------------------------------------------
-- Registra o bloco. Entre \`do\` e \`exception\` porque o livro-caixa e conforto,
-- nao correcao: se a tabela do CLI tiver outra forma nesta versao, o aviso
-- aparece e as migrations continuam valendo.
-- ---------------------------------------------------------------------------
do $reg$
begin
  insert into supabase_migrations.schema_migrations (version, name) values
    ${valores}
  on conflict (version) do update set name = excluded.name;
exception when others then
  raise warning 'Nao consegui registrar o bloco no livro-caixa (%). As migrations foram aplicadas.', sqlerrm;
end
$reg$;

select 'bloco ${i} de ${N} aplicado' as resultado;
`;

  const nome = join(DESTINO, `banco-${i}-de-${N}.sql`);
  writeFileSync(nome, cabeca + corpo + rodape);
  const kb = Math.round(statSync(nome).size / 1024);
  console.log(`${basename(nome)}  ${kb} KB  (${bloco.length} migrations)`);
});
