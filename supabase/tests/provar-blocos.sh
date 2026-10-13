#!/usr/bin/env bash
# Prova os blocos que o `scripts/gerar-blocos.mjs` gera, do jeito que o SQL
# Editor do Supabase vai aplicar: um paste por vez, cada um inteiro, em ordem.
#
# Cobra tres coisas:
#   1. os blocos aplicam num banco vazio, na ordem, sem erro;
#   2. toda tabela nasce com RLS — a regra numero cinco do projeto;
#   3. repetir um bloco e RECUSADO com a mensagem clara, e nao com o erro de
#      coluna que apareceria sem a guarda (a 0017 troca uma coluna da 0005).
#
#   initdb -D /tmp/pgdata -A trust -U postgres
#   pg_ctl -D /tmp/pgdata -o "-k /tmp -p 5444" start
#   node scripts/gerar-blocos.mjs
#   supabase/tests/provar-blocos.sh
set -uo pipefail

PORT="${PGPORT:-5444}"
HOST="${PGHOST:-/tmp}"
USER="${PGUSER:-postgres}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BLOCOS="${1:-$REPO/supabase/blocos}"
PSQL=(psql -h "$HOST" -p "$PORT" -U "$USER" -v ON_ERROR_STOP=1 -q)

q() { psql -h "$HOST" -p "$PORT" -U "$USER" -q -c "$1" >/dev/null 2>&1; }
le() { psql -h "$HOST" -p "$PORT" -U "$USER" -d astart -Atc "$1" 2>/dev/null; }

arquivos=("$BLOCOS"/banco-*-de-*.sql)
if [ ! -e "${arquivos[0]}" ]; then
  echo "FALHOU: nao achei blocos em $BLOCOS. Rode: node scripts/gerar-blocos.mjs"
  exit 1
fi
total=${#arquivos[@]}

q "drop database if exists astart"
for r in anon authenticated service_role; do q "drop role if exists $r"; done

# Os stubs fazem o papel do que o Supabase ja entrega pronto: auth, storage,
# vault, cron, net e os tres papeis. O arquivo cria o banco e entra nele.
if ! out=$("${PSQL[@]}" -f "$REPO/supabase/tests/00_stubs_supabase.sql" 2>&1); then
  echo "FALHOU nos stubs:"; echo "$out" | tail -5; exit 1
fi

# `--single-transaction` nao e detalhe: e o que o SQL Editor do Supabase faz com
# um arquivo colado. Sem ele o psql abre uma transacao por statement, e o
# verificador fica MAIS PERMISSIVO que o editor de verdade — foi assim que o
# erro `unsafe use of new value "operacao" of enum type` chegou na mao da dona
# com os blocos "provados". O Postgres nao deixa usar um valor de enum novo na
# mesma transacao que o criou, e so dentro de uma transacao isso aparece.
aplica() {
  local f="$1"
  local tmp
  tmp=$(mktemp "${TMPDIR:-/tmp}/bloco-XXXXXX.sql")
  # As extensoes reais nao existem no Postgres cru; no Supabase existem.
  sed -E 's/^create extension if not exists (pg_net|pg_cron|supabase_vault).*/-- &/' "$f" > "$tmp"
  "${PSQL[@]}" --single-transaction -d astart -f "$tmp" 2>&1
  local rc=$?
  rm -f "$tmp"
  return $rc
}

for f in "${arquivos[@]}"; do
  if ! out=$(aplica "$f"); then
    echo "FALHOU em $(basename "$f"):"; echo "$out" | grep -v NOTICE | tail -12; exit 1
  fi
  echo "OK  $(basename "$f")"
done

tabelas=$(le "select count(*) from pg_tables where schemaname='public'")
funcoes=$(le "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")
abertas=$(le "select count(*) from pg_tables where schemaname='public' and not rowsecurity")
echo "    $tabelas tabelas, $funcoes funcoes, $abertas sem RLS"
if [ "$abertas" != "0" ]; then
  echo "FALHOU: ha tabela sem RLS:"
  le "select tablename from pg_tables where schemaname='public' and not rowsecurity"
  exit 1
fi

for f in "${arquivos[@]}"; do
  out=$(aplica "$f")
  if [ $? -eq 0 ]; then
    echo "FALHOU: $(basename "$f") aceitou rodar duas vezes"; exit 1
  fi
  if ! echo "$out" | grep -q "ja foi aplicado neste banco"; then
    echo "FALHOU: $(basename "$f") recusou pelo motivo errado:"
    echo "$out" | grep ERROR | tail -3; exit 1
  fi
done
echo "OK  repetir qualquer bloco e recusado com a mensagem certa"

# O livro-caixa e o mesmo do `supabase db push`: sem ele, o CLI tentaria
# aplicar tudo de novo no dia em que alguem o usasse.
registradas=$(le "select count(*) from supabase_migrations.schema_migrations")
esperadas=$(ls "$REPO"/supabase/migrations/*.sql | wc -l | tr -d ' ')
echo "    livro-caixa: $registradas de $esperadas migrations registradas"
[ "$registradas" = "$esperadas" ] || { echo "FALHOU: livro-caixa incompleto"; exit 1; }

# Contar linha nao basta, e essa lacuna CUSTOU: a tabela nasceu so com
# `version`, aceitou as 41 sem reclamar, e a ferramenta oficial quebrou com
# "column name does not exist" — porque ela le `select version, name`. Contar
# provava que o registro existia, nao que alguem conseguia ler.
#
# Entao a cobranca e a consulta DE VERDADE, a mesma que o CLI faz.
if ! le "select version, name from supabase_migrations.schema_migrations order by version" > /dev/null 2>&1; then
  echo "FALHOU: a ferramenta oficial nao consegue ler o livro-caixa."
  echo "        colunas que existem:"
  le "select string_agg(column_name, ', ' order by ordinal_position)
        from information_schema.columns
       where table_schema='supabase_migrations' and table_name='schema_migrations'"
  echo "        o CLI espera: version, statements, name"
  exit 1
fi
sem_nome=$(le "select count(*) from supabase_migrations.schema_migrations where name is null")
[ "$sem_nome" = "0" ] || { echo "FALHOU: $sem_nome migrations registradas sem nome"; exit 1; }
echo "OK  o livro-caixa responde a consulta do CLI, com nome em todas"

echo "OK  $total blocos provados"
