# Primeiro deploy

Da primeira vez tem uma ordem que importa: **as migrations `0009` e `0012`
agendam tarefas no `pg_cron` e abortam de proposito se as chaves nao estiverem
no cofre.** Elas preferem falhar alto a criar um agendamento que aponta para
lugar nenhum.

Entao: cria o projeto, bota as tres chaves no cofre, e so depois aplica.

---

## 1. Criar o projeto no Supabase

<https://supabase.com/dashboard> > **New project**.

- Region: **South America (São Paulo)** — e onde os clientes estao.
- Guarde a **senha do banco** que ele pedir. Ela nao aparece de novo.

Anote da pagina **Settings > API**:

| Valor | Onde usar | Pode compartilhar? |
|---|---|---|
| **Project URL** | front e CI | sim, e publico |
| **anon public** | front | sim — e feita para ir no navegador, quem protege e o RLS |
| **service_role** | so no painel do Supabase | **nunca.** Ela passa por cima de todo RLS |
| **Reference ID** | CI (`SUPABASE_PROJECT_REF`) | sim |

## 2. Botar as tres chaves no cofre

**Settings > Vault > New secret**, ou cole no **SQL Editor** (trocando os
valores). Nao comite isto em lugar nenhum.

```sql
-- Troque <REF> pelo Reference ID do projeto.
select vault.create_secret(
  'https://<REF>.supabase.co/functions/v1/publicar-tick', 'publicar_tick_url');
select vault.create_secret(
  'https://<REF>.supabase.co/functions/v1/renovar-tokens', 'renovar_tokens_url');

-- Segredo partilhado entre o pg_cron e as Edge Functions. Gere um aleatorio:
--   openssl rand -hex 32
select vault.create_secret('<COLE_O_ALEATORIO_AQUI>', 'tick_secret');
```

## 3. Aplicar as migrations

```bash
npm install -g supabase       # ou: brew install supabase/tap/supabase
supabase login                # abre o navegador
supabase link --project-ref <REF>
supabase db push              # pede a senha do banco do passo 1
```

Deve terminar aplicando 25 migrations. Se parar numa delas, me mande a
mensagem inteira: o erro diz o que falta.

## 4. Deixar o CI cuidando disso para sempre

No GitHub: **Settings > Secrets and variables > Actions > New repository
secret**, duas vezes:

| Nome | Valor | Onde pegar |
|---|---|---|
| `SUPABASE_PROJECT_REF` | o Reference ID | Painel do projeto > **Settings > General** |
| `SUPABASE_ACCESS_TOKEN` | um token da sua conta | <https://supabase.com/dashboard/account/tokens> |

**Dois, e nao tres.** A senha do banco NAO e mais necessaria.

Ela era, enquanto a esteira usava `supabase db push`, que conecta direto no
Postgres. E foi exatamente ali que tudo travou: a senha do banco nao da para
consultar — o Supabase a define na criacao do projeto e nunca mostra de novo,
so deixa trocar — entao o segredo ficou faltando, a esteira ficou vermelha por
dias, e ninguem notou porque as migrations vinham sendo aplicadas a mao.

Hoje a esteira usa `scripts/aplicar-migrations.mjs`, que aplica pela API de
gerenciamento e autentica com o `SUPABASE_ACCESS_TOKEN` — o mesmo que publica
as Edge Functions. Um segredo a menos para guardar e um a menos para vazar.

Feito isso, todo merge na `main` que toque `supabase/migrations/` aplica
sozinho. Ninguem roda SQL na mao de novo.

**Como saber se ficou funcionando:** o workflow `migrations` tem de aparecer
verde em *Actions*. Ele falha no primeiro passo enquanto faltar qualquer um dos
tres segredos, e a mensagem diz qual — de proposito, para nao gastar uma
tentativa de conexao descobrindo isso.

## 5. Segredos das Edge Functions

Ficam no Supabase, nunca no repositorio:

```bash
supabase secrets set META_API_VERSION=v21.0
supabase secrets set TICK_SECRET=<o mesmo aleatorio do passo 2>

# quando chegar a hora de cada um:
supabase secrets set ANTHROPIC_API_KEY=<...>
supabase secrets set ASAAS_API_KEY=<...>
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` o proprio
runtime injeta; nao precisa configurar.

## 6. Publicar as functions

```bash
supabase functions deploy publicar-tick
supabase functions deploy renovar-tokens
supabase functions deploy convidar
```

## 7. O primeiro admin

Nao da para se convidar: a funcao `convidar` exige que quem chama ja seja
admin. O primeiro tem que nascer na mao.

1. **Authentication > Users > Add user**, com o seu e-mail. Copie o `id`.
2. No **SQL Editor**:

```sql
insert into public.perfis (user_id, nome, email, papel, cargo)
values ('<ID_COPIADO>', 'Viviane', 'viviane@astartstudio.com.br', 'admin', 'Direção');
```

Do segundo em diante, tudo pela tela de Equipe.

## Conferindo

```sql
-- 25 migrations aplicadas
select count(*) from supabase_migrations.schema_migrations;

-- nenhuma tabela sem RLS
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- os dois agendamentos no ar
select jobname, schedule from cron.job;
```

A segunda consulta tem que voltar **vazia**. Se voltar alguma coisa, me avise:
e tabela sem RLS em producao.
