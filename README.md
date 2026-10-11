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
| — | Fundação: banco inteiro em 27 migrations, RLS em todas as tabelas | pronto |
| — | Entrada, início da equipe e início do cliente | front pronto |
| — | Clientes e ficha do cliente | front pronto, leitura |
| 1 | Agendamento de posts (Meta) | worker em produção; front a fazer |
| 2 | Aprovação de peça e entregável | banco e as duas pontas do front prontos |
| 3 | Financeiro | banco pronto; front a fazer |
| 4 | Contratos | banco pronto; front a fazer |
| 5 | CRM comercial | banco pronto; front a fazer |

O trabalho vai módulo a módulo: primeiro o visual e as regras, depois a API.

## Estrutura

```
plataforma/                 front React — ver plataforma/README.md
supabase/
  migrations/               27 migrations versionadas, RLS em todas as tabelas
  functions/publicar-tick/  worker disparado por pg_cron a cada minuto
  functions/_shared/        adapter da Meta, classificação de erro, log
  tests/                    smoke test local do schema
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
```
