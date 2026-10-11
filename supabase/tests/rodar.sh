#!/usr/bin/env bash
# Aplica as migrations num Postgres vazio e roda cada teste numa copia do banco.
# Cada arquivo de teste assume banco limpo, por isso a copia.
#
#   initdb -D /tmp/pgdata -A trust -U postgres
#   pg_ctl -D /tmp/pgdata -o "-k /tmp -p 5444" start
#   supabase/tests/rodar.sh
#
# Nao substitui teste contra a Meta nem contra a Asaas: valida schema e SQL.
set -uo pipefail

PORT="${PGPORT:-5444}"
HOST="${PGHOST:-/tmp}"
USER="${PGUSER:-postgres}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PSQL=(psql -h "$HOST" -p "$PORT" -U "$USER" -v ON_ERROR_STOP=1 -q)

q() { psql -h "$HOST" -p "$PORT" -U "$USER" -q -c "$1" >/dev/null 2>&1; }

for d in $(psql -h "$HOST" -p "$PORT" -U "$USER" -Atc \
    "select datname from pg_database where datname like 'astart%'" 2>/dev/null); do
  q "drop database if exists $d"
done
for r in anon authenticated service_role; do q "drop role if exists $r"; done

if ! out=$("${PSQL[@]}" -f "$REPO/supabase/tests/00_stubs_supabase.sql" 2>&1); then
  echo "FALHOU nos stubs:"; echo "$out" | tail -20; exit 1
fi

n=0
for f in "$REPO"/supabase/migrations/*.sql; do
  # As extensoes reais nao existem no Postgres stock; o stub ja criou os schemas.
  if ! out=$(sed -E 's/^create extension if not exists (pg_net|pg_cron|supabase_vault).*/-- &/' "$f" \
             | "${PSQL[@]}" -d astart 2>&1); then
    echo "FALHOU em $(basename "$f"):"; echo "$out" | grep -v NOTICE | tail -25; exit 1
  fi
  n=$((n + 1))
done
echo "OK  $n migrations"

falhou=0
for t in "$REPO"/supabase/tests/[0-9][1-9]_*.sql; do
  q "drop database if exists astart_t"
  q "create database astart_t template astart"
  if out=$("${PSQL[@]}" -d astart_t -f "$t" 2>&1); then
    echo "OK  $(basename "$t")"
  else
    echo "FALHOU  $(basename "$t")"; echo "$out" | grep -v NOTICE | tail -30; falhou=1
  fi
done
q "drop database if exists astart_t"
exit $falhou
