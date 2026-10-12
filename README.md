# Astart — Plataforma interna

Plataforma de operação da **Astart Studio**, agência de social media. Uso interno:
os usuários são a equipe da Astart e os clientes da agência, cada lado com o seu
acesso. Quem não tem conta ainda pode responder por link de aprovação, que não vence.

Projeto independente — conta, banco, repositório e deploy próprios.

## Stack

React + Vite + TypeScript + Tailwind no front. Supabase (Postgres, Auth, Storage,
Edge Functions, pg_cron, Vault) atrás. Deploy do front em Vercel ou Netlify, ainda
a definir: o build é estático puro em `dist/`, sem uma linha acoplada a nenhum dos dois.

Toda a lógica de agendamento e disparo vive no Supabase — pg_cron chamando Edge
Function. O host do front é camada estática, então limite de tempo de execução de
função nunca entra na conta.

## Módulos

| # | Módulo | Estado |
|---|---|---|
| — | Fundação: banco inteiro em 40 migrations, RLS em todas as tabelas | pronto |
| — | Entrada, início da equipe e início do cliente | pronto |
| — | Clientes, cadastro e ficha do cliente | pronto |
| 1 | Agendamento de posts (Meta) | worker em produção; calendário e fila prontos |
| 2 | Aprovação de peça e entregável | pronto, as duas pontas |
| 3 | Financeiro | pronto (equipe, ficha e portal) |
| 4 | Contratos | pronto |
| 5 | CRM comercial | pronto |
| 6 | Galeria própria (saindo do Pixieset) | pronto, com link sem conta |
| 7 | Grid, campanhas, ambientes e NPS | pronto |
| 8 | Papéis e acessos, com o dinheiro fechado | pronto |

Todas as telas existem e são navegáveis em modo exemplo. O que falta é **ligar**:
Supabase de verdade (URL + anon key), Asaas para a cobrança sair, e o app da Meta
publicado para a peça aprovada ir sozinha. Nenhum desses depende de código novo.

O trabalho vai módulo a módulo: primeiro o visual e as regras, depois a API.

## Estrutura

```
plataforma/                 front React — ver plataforma/README.md
supabase/
  migrations/               40 migrations versionadas, RLS em todas as tabelas
  functions/publicar-tick/  worker disparado por pg_cron a cada minuto
  functions/_shared/        adapter da Meta, classificação de erro, log
  tests/                    20 testes de schema e de RLS, rodados num Postgres vazio
scripts/agendar-post-teste.ts   teste ponta a ponta da publicação
README-agendamento-meta.md      configuração do app Meta, System User e Vault
```

## Princípios que o código carrega

- **Idempotência acima de tudo.** O pior bug possível é publicar duas vezes na conta
  de um cliente. `media_publish` nunca é reexecutado: um item interrompido em
  `publicando` vai para reconciliação contra a Meta e só volta a publicar quando fica
  provado que nada saiu.
- **Sem polling dentro de uma invocação.** O worker é um tick stateless: acorda,
  avança cada item um passo, devolve o controle.
- **Token nunca chega no front.** Fica no Supabase Vault, lido só por Edge Function
  com service role.
- **Falha silenciosa é proibida.** Todo erro vira status visível, mensagem legível em
  português, registro no log e alerta.
- **RLS ativa desde a primeira tabela**, sem exceção. `anon` não tem privilégio nenhum.
- **Toda data em `timestamptz`**, com o fuso do cliente guardado à parte só para renderizar.
- **Papel decide no banco, não na tela.** O front esconde o que a pessoa não pode
  ver só para não oferecer o que o banco vai recusar. Quando os dois discordarem,
  o banco está certo — ver `docs/arquitetura.md`, seção 10b.

## O primeiro dia — ligar no Supabase

Nesta ordem. O passo 4 é o que destranca a plataforma: num banco novo `perfis`
está vazia, ninguém é admin, e a Edge Function de convite recusa todo mundo —
inclusive a dona. A `0040` existe para isso, e se fecha sozinha depois.

```bash
# 1. banco
supabase link --project-ref <ref>
supabase db push                      # 40 migrations

# 2. as funções
supabase functions deploy publicar-tick --no-verify-jwt
supabase functions deploy convidar
supabase functions deploy galeria --no-verify-jwt
supabase functions deploy renovar-tokens --no-verify-jwt

# 3. os segredos, direto no painel (nunca no repositório, nunca no chat):
#    Vault: token da Meta, chave do Asaas, chave da Anthropic
#    Settings > Edge Functions: as variáveis que cada função lê
```

4. **A conta que administra.** Em *Authentication > Users*, crie a conta com o
   seu e-mail. Depois, no editor SQL:

   ```sql
   select public.primeiro_admin('voce@astartstudio.com.br');
   ```

   Ela promove essa conta a admin e, a partir daí, recusa: com um admin ativo a
   porta é o convite. Dali você convida o resto da equipe pela tela de Ajustes.

5. **O front aponta para o banco.** Em `plataforma/.env.local`:

   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```

   As duas são públicas por desenho — a `anon key` não abre nada sozinha, quem
   decide é o RLS. `service_role` e senha do banco **nunca** saem do painel.

Sem o `.env.local` a plataforma abre em **modo exemplo**, com dados fictícios e
um aviso no topo. Nada finge estar ligado.

## Rodar

```bash
# front
cd plataforma && npm install && npm run dev

# banco e worker (ver README-agendamento-meta.md para os segredos)
supabase link --project-ref <ref>
supabase db push
supabase functions deploy publicar-tick --no-verify-jwt

# teste de publicação ponta a ponta
npm install
npm run teste:publicacao -- --ig-user-id <id> --imagem ./imagem.jpg

# os testes do banco, num Postgres vazio
initdb -D /tmp/pgdata -A trust -U postgres
pg_ctl -D /tmp/pgdata -o "-k /tmp -p 5444" start
supabase/tests/rodar.sh

# as auditorias de tela (ver docs/ux.md)
cd plataforma && npm run build && npx vite preview --port 4178
npm run telas && npm run olhar && npm run acessibilidade && npm run contraste
```
