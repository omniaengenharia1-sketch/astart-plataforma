# Smoke test local das migrations

Roda o schema e as funcoes num Postgres vazio, sem precisar de projeto Supabase.

`00_stubs_supabase.sql` cria versoes falsas do que o Supabase entrega pronto
(`auth`, `storage`, `vault`, `cron`, `net`). Cada arquivo de teste assume banco
limpo, entao o runner aplica as migrations uma vez e roda cada teste numa copia.

```bash
initdb -D /tmp/pgdata -A trust -U postgres
pg_ctl -D /tmp/pgdata -o "-k /tmp -p 5444" start

supabase/tests/rodar.sh          # PGPORT/PGHOST/PGUSER sobrescrevem o padrao
```

| Arquivo | O que exercita |
|---|---|
| `01_smoke_worker.sql` | promocao de posts, lease, reconciliacao, redacao de segredos no log, append-only, permissoes |
| `02_smoke_papeis_e_conexao.sql` | papeis do perfil e estado do token das contas da Meta |
| `03_smoke_fundacao.sql` | portao de modulo, coerencia do contrato, separacao equipe/cliente, convites, motor de aprovacao e isolamento entre clientes |

`03` redefine `auth.uid()` para ler uma variavel de sessao e usa `set role
authenticated`, que e o que faz o RLS valer de verdade — como dono das tabelas,
`postgres` passaria por cima de toda politica.

Nao substitui teste contra a Meta nem contra a Asaas: valida schema e logica SQL.
