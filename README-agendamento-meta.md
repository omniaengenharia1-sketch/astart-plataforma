# Agendamento Meta — Plataforma Astart

Agendador e publicador de posts para **Instagram Business** e **Facebook Page**,
uso interno da Astart, multi-cliente dentro de um unico workspace. Substitui o
mLabs na operacao da agencia.

> **Fase 1 (esta entrega):** publicar uma **imagem unica no Instagram**, ponta a
> ponta, sem interface. Carrossel, Reels, Story, Facebook Page e as telas vem
> depois, entrando pelo mesmo adapter.

---

## Como funciona

Sem backend proprio. O `pg_cron` chama a Edge Function `publicar-tick` a cada
minuto; ela acorda, avanca **um passo** de cada item da fila e devolve o
controle. Nao existe `sleep` nem polling dentro de uma invocacao.

```
posts.status
  rascunho → aguardando_aprovacao → aprovado → agendado
                                                  │  (tick: agendado_para venceu)
                                                  ▼
                                             publicando ──► publicado
                                                        ├─► publicado_parcial
                                                        └─► falhou

post_alvos.estado   (uma linha por post × conta de destino)
  pendente ─► container_criando ─► container_aguardando ─► container_pronto
                                          (video)              │
                                                               ▼
                                                          publicando ─► publicado
  qualquer passo ─► falhou | cancelado
```

### Onde esta o risco de duplicar um post

Nao e uniforme entre os passos, e o codigo trata cada caso de um jeito:

| Passo | Se a resposta se perder | Por que |
| --- | --- | --- |
| **criar container** | volta para `pendente` e refaz | container orfao expira em 24h sem publicar nada. Vazar container e inofensivo. |
| **`media_publish`** | **nunca refaz** | e o unico ponto capaz de publicar duas vezes. |

Um alvo que ficou em `publicando` sem confirmacao vai para **reconciliacao**, nao
para retry: o worker pergunta a Meta o `status_code` do container e lista as
midias recentes da conta. So volta a publicar quando fica **provado** que nada
saiu. Se ficou provado que saiu mas nao da para identificar qual midia e, o item
e marcado `publicado` com `media_id_publicado` nulo — publicado sem ID e
aceitavel; publicado duas vezes, nao.

Toda chamada a Meta grava evento **antes** (`*_solicitado`) e **depois**
(`*_confirmado`) em `publicacao_eventos`, entao o log mostra exatamente onde a
lacuna aconteceu.

---

## 1. App na Meta

1. **developers.facebook.com → Meus apps → Criar app**, tipo **Business**,
   vinculado ao **Business Manager da Astart**.
2. Adicione os produtos **Instagram** e **Facebook Login for Business**.
3. Permissoes necessarias:
   - `instagram_business_content_publish`
   - `pages_manage_posts`
   - `pages_show_list`
   - `business_management`
   - `instagram_basic`

Durante o desenvolvimento o app roda em **modo de desenvolvimento** e publica
normalmente em contas que tenham papel no app. A unica diferenca para producao e
a aprovacao do **App Review** — o codigo ja assume producao.

## 2. Acesso as contas dos clientes

**Nao ha OAuth individual por cliente.** O modelo e:

1. O cliente compartilha a **Pagina do Facebook** e a **conta do Instagram** com
   o Business Manager da Astart via **acesso de parceiro**
   (BM do cliente → Configuracoes → Parceiros → Adicionar parceiro → ID do BM da
   Astart → conceder acesso a Pagina e a conta do Instagram).
2. A conta do Instagram precisa ser **Business** (nao Creator) e estar vinculada
   a essa Pagina.

## 3. Token de System User

1. **Business Manager da Astart → Configuracoes → Usuarios do sistema →
   Adicionar**, tipo **Admin**.
2. **Adicionar ativos**: as Paginas e contas do Instagram dos clientes, com
   controle total.
3. **Gerar novo token**, escolhendo o app criado no passo 1 e marcando as cinco
   permissoes acima. Um token de System User **nao expira**.

Guarde o token no Vault, nunca em variavel de ambiente e nunca no front:

```sql
select vault.create_secret('<TOKEN_DO_SYSTEM_USER>', 'meta_system_user_token');
```

### Cliente que nao aceita compartilhar via BM

Esse e o unico caso de OAuth. A conta entra com `origem_token = 'oauth'` e um
vencimento; a partir dai a rotina diaria cuida dela.

```sql
update contas_sociais
   set origem_token = 'oauth', token_expira_em = now() + interval '60 days'
 where id = '...';

select atualizar_token_conta('<id da conta>', '<TOKEN_DO_CLIENTE>', now() + interval '60 days');
```

`atualizar_token_conta()` cria a chave no Vault na primeira chamada e sobrescreve
nas seguintes, sempre com o mesmo nome. Nao ha como cadastrar um token OAuth sem
vencimento: uma constraint impede, justamente para a rotina nunca perder a conta
de vista.

Para isso funcionar, a Edge Function precisa de mais dois segredos:

```bash
supabase secrets set META_APP_ID=<id do app> META_APP_SECRET=<segredo do app>
```

**Um token que ja venceu nao volta sozinho.** A Meta so devolve um novo depois
que alguem reconecta a conta; a rotina detecta o caso, para de tentar e alerta o
time — em vez de insistir em silencio.

### Descobrindo `ig_user_id` e `page_id`

```bash
TOKEN=...
curl -s "https://graph.facebook.com/v23.0/me/accounts?fields=id,name,instagram_business_account{id,username}&access_token=$TOKEN"
```
`id` da pagina → `page_id`; `instagram_business_account.id` → `ig_user_id`.

---

## 4. Variaveis e segredos

### No Vault (banco)

| Chave | Para que serve |
| --- | --- |
| `meta_system_user_token` | token de System User do BM da Astart |
| `tick_secret` | segredo compartilhado entre o `pg_cron` e as Edge Functions |
| `publicar_tick_url` | URL da function de publicacao, usada pelo `pg_cron` |
| `renovar_tokens_url` | URL da function de renovacao de token |
| `token_conta_<uuid>` | criada sozinha na primeira renovacao de uma conta OAuth |

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/publicar-tick', 'publicar_tick_url');
select vault.create_secret('https://<ref>.supabase.co/functions/v1/renovar-tokens', 'renovar_tokens_url');
select vault.create_secret('<gere_um_valor_longo_e_aleatorio>', 'tick_secret');
```

### Na Edge Function

```bash
supabase secrets set \
  META_API_VERSION=v23.0 \
  TICK_SECRET='<mesmo valor da chave tick_secret>' \
  TICK_LOTE_MAX=20 \
  SIGNED_URL_TTL_SEGUNDOS=7200 \
  ALERTA_WEBHOOK_URL='<opcional: webhook do Slack/Discord>'
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` sao injetadas pelo proprio Supabase.

> `META_API_VERSION` e **obrigatoria e nao tem default no codigo**: versao de API
> chumbada e a forma mais silenciosa de envelhecer uma integracao com a Meta.
> Confira a versao vigente na doc antes de definir.

### No `.env` local (so para o script de teste)

```bash
cp .env.example .env   # SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
```

---

## 5. Deploy

```bash
supabase link --project-ref <ref>

# As chaves publicar_tick_url e tick_secret precisam existir no Vault ANTES:
# a migration 0009 aborta com mensagem explicita se faltarem.
supabase db push

supabase functions deploy publicar-tick --no-verify-jwt
supabase functions deploy renovar-tokens --no-verify-jwt
```

Verifique o cron:

```sql
select jobname, schedule, active from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
```

---

## 6. Teste ponta a ponta

```bash
npm install

npm run teste:publicacao -- \
  --ig-user-id 17841400000000000 \
  --imagem ./caminho/para/imagem.jpg \
  --legenda "Teste de publicacao da Astart" \
  --minutos 2
```

O script cria cliente, conta, midia e post agendado para daqui a 2 minutos, faz o
upload no Storage e fica imprimindo a evolucao dos estados a cada 5s ate um
estado final. Ele tambem le as dimensoes da imagem e **avisa antes de enviar** se
a proporcao estiver fora de 4:5 – 1.91:1.

| Argumento | Padrao |
| --- | --- |
| `--imagem` | obrigatorio, `.jpg` ou `.png` |
| `--ig-user-id` | obrigatorio (ou `--conta <uuid>` de uma conta ja cadastrada) |
| `--legenda` | texto de teste |
| `--minutos` | `2` |
| `--cliente` | `teste-astart` |
| `--primeiro-comentario` | nenhum |
| `--token-ref` | nenhum (usa o token global do BM) |

Saida esperada:

```
[10:32:05] post: agendado
      alvo 3f2a1b8c · pendente
[10:34:07] post: publicando
      alvo 3f2a1b8c · container_pronto · container=17999...
[10:34:07]   · container_solicitado
[10:34:07]   · meta.ig.criar_container_imagem
[10:34:07]   · container_criado
[10:35:06] post: publicado
      alvo 3f2a1b8c · publicado · media=17888...
```

### Rodar o tick na mao

```bash
curl -X POST "https://<ref>.supabase.co/functions/v1/publicar-tick" \
  -H "x-tick-secret: $TICK_SECRET" -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

| Campo do body | Efeito |
| --- | --- |
| `lote` | tamanho do lote (default `TICK_LOTE_MAX`) |
| `alvo_id` | reprocessa um alvo especifico — e o "tentar novamente" do monitor |
| `dry_run` | percorre a fila sem chamar a Meta |

---

## 7. Depurando

Tudo que foi mandado e recebido da Meta esta em `publicacao_eventos`, com os
tokens ja redigidos:

```sql
select e.criado_em, e.evento, e.payload
  from publicacao_eventos e
  join post_alvos a on a.id = e.post_alvo_id
 where a.post_id = '<uuid>'
 order by e.criado_em;
```

Fila e o que travou:

```sql
select a.estado, a.tentativas, a.proxima_tentativa_em, a.erro_codigo, a.erro_mensagem,
       p.titulo_interno, c.nome_exibicao
  from post_alvos a
  join posts p on p.id = a.post_id
  join contas_sociais c on c.id = a.conta_social_id
 where a.estado not in ('publicado','cancelado')
 order by a.proxima_tentativa_em nulls first;
```

Reprocessar um item:

```sql
-- pela function (respeita o lease e a reconciliacao)
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='publicar_tick_url'),
  headers := jsonb_build_object('Content-Type','application/json',
             'x-tick-secret',(select decrypted_secret from vault.decrypted_secrets where name='tick_secret')),
  body := jsonb_build_object('alvo_id','<uuid do alvo>')
);
```

### Retry e classificacao de erro

| Familia | Exemplos | Comportamento |
| --- | --- | --- |
| **Transitorio** | HTTP 429/5xx, codigos 1, 2, 4, 17, 32, 341, 613, 80004, container ainda processando, timeout de rede | backoff exponencial a partir de 1 min, teto de 1h, maximo 6 tentativas |
| **Permanente** | validacao de midia, proporcao invalida, permissao negada, token invalido, conta desvinculada | falha na hora, sem retry |

A tela sempre recebe mensagem em portugues (`post_alvos.erro_mensagem`). O JSON
cru da Meta fica so no log de eventos.

### Cota da Meta

A cota e uma **janela movel de 24h por conta**, nao dia de calendario, e o worker
**le o valor real** em `GET /{ig-user-id}/content_publishing_limit` antes de cada
publicacao — nao ha numero chumbado no codigo (a documentacao da Meta diverge
entre 50 e 100). Cota estourada nao consome tentativa: o item e reavaliado em
15 minutos. Carrossel conta como 1 publicacao, independente do numero de itens.

### Alertas

Falha permanente e falha do tick escrevem no log estruturado e, se
`ALERTA_WEBHOOK_URL` estiver definida, disparam webhook. Falha no primeiro
comentario nao derruba o post: gera aviso.

---

## 8. Estrutura

```
supabase/
  migrations/
    ..._0001_extensoes_e_enums.sql
    ..._0002_base.sql               clientes, contas_sociais, perfis
    ..._0003_posts_e_midias.sql
    ..._0004_alvos_e_eventos.sql    maquina de estados + log append-only
    ..._0005_aprovacao.sql          comentarios e links do portal do cliente
    ..._0006_rls.sql                RLS em todas as tabelas
    ..._0007_funcoes_worker.sql     promover / reivindicar / reconciliar
    ..._0008_storage.sql            bucket privado midias-posts
    ..._0009_cron.sql               pg_cron a cada minuto
  functions/
    publicar-tick/index.ts          o worker
    _shared/
      adaptador.ts                  interface unica de saida para plataforma
      meta/instagram.ts             unica implementacao hoje
      graph.ts                      cliente HTTP da Graph API
      erros.ts                      classificacao + mensagens em portugues
      eventos.ts                    log append-only e alertas
  tests/                            smoke test local das migrations
scripts/agendar-post-teste.ts       teste ponta a ponta da fase 1
```

### Seguranca

- Token da Meta so no Vault, lido por `obter_token_conta()` (SECURITY DEFINER,
  `execute` apenas para `service_role`). Nunca chega no front.
- RLS habilitada nas 9 tabelas. `anon` nao tem **nenhum** privilegio: o portal do
  cliente por link vai passar pela Edge Function `portal-aprovacao` com service
  role, nao por policy anonima.
- `links_aprovacao` guarda **hash** do token; o valor em claro so aparece uma vez,
  no retorno de `criar_link_aprovacao()`.
- `publicacao_eventos` e append-only por trigger e passa por redacao recursiva de
  segredos antes de gravar.
- Bucket `midias-posts` privado; a Meta baixa por signed URL de 2h.

### Desvios do desenho original

Tres adicoes, todas para fechar buraco de falha silenciosa ou de concorrencia:

1. `post_alvos.lock_token` + `bloqueado_ate` — lease. `FOR UPDATE SKIP LOCKED`
   continua sendo usado, mas dentro do `UPDATE` de reivindicacao, para nao manter
   transacao aberta durante a chamada HTTP a Meta.
2. `post_alvos.erro_familia` — separa transitorio de permanente sem parsear texto.
3. `posts.erro_mensagem` — post agendado sem conta de destino nao tem alvo onde
   pendurar o erro; sem essa coluna ele ficaria parado em silencio.

Mais a tabela `perfis`, necessaria para escrever RLS que nao seja "tabela aberta
por enquanto".

---

## Fora de escopo agora

TikTok, LinkedIn, Google, metricas, relatorios e analytics. As chamadas a Meta
ficam atras de `AdaptadorPlataforma` para facilitar o proximo passo, mas nao ha
abstracao multi-plataforma generica antes da hora.
