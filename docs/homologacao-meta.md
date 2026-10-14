# Homologação da Meta — o que submeter, e quem produz cada coisa

Para publicar na conta de um cliente que **não tem papel no nosso app**, a Meta
exige App Review das permissões de publicação e Business Verification da
empresa. Até sair, o app publica apenas em contas que tenham papel nele — o que
serve para testar, não para atender cliente.

> **Ressalva honesta sobre esta página.** O checklist abaixo foi montado a
> partir de guias de terceiros (não achei a página oficial e atual da Meta com
> o checklist completo) e da experiência relatada por quem submeteu em 2026. Os
> campos do painel mudam de nome e de lugar. Trate como roteiro, confira cada
> item no painel na hora, e me diga o que estiver diferente — eu corrijo esta
> página.

Prazo relatado em 2026: **2 a 4 semanas**, com uma fonte citando ~20 dias.
Reprovar e resubmeter é comum e não é problema; o caro é submeter com material
incompleto e perder o ciclo.

---

## 1. O que já está pronto

> **O domínio foi decidido, e isto tem de ser feito ANTES de submeter.** A
> plataforma vai para um subdomínio de `astartstudio.com.br`, que a Astart já
> tem. Os três endereços abaixo entram no formulário do App Review, e trocar o
> domínio depois de aprovado obriga a atualizar o app na Meta — em alguns casos,
> a passar por análise de novo. Então o domínio primeiro, as URLs depois, a
> submissão por último.

| item | onde (hoje, no endereço provisório) |
|---|---|
| Política de privacidade | `https://astart-plataforma.pages.dev/privacidade` |
| Termos de uso | `https://astart-plataforma.pages.dev/termos` |
| Instruções de exclusão de dados | `https://astart-plataforma.pages.dev/exclusao-de-dados` |
| Fluxo de publicação funcionando | compositor → agendar → worker publica |
| Fluxo de conexão de conta | botão "Conectar conta", no calendário |

As três páginas abrem **sem login**, porque o revisor não tem conta aqui. O
texto delas é factual de propósito: descreve que o token fica criptografado no
Vault, que é lido só no servidor, e o que a plataforma faz com ele. Política
genérica copiada da internet é um dos motivos mais citados de reprovação — e
aqui seria mentira.

**Não é peça jurídica.** É a descrição técnica do que acontece com o dado.
Antes de valer como documento legal, advogado tem de ler.

### As três chegam como HTML, não como casca

Elas abriam no navegador e vinham **vazias no `curl`**: 1.115 bytes de casca e
19 caracteres de texto, só o `<title>`. O conteúdo é React, e React precisa de
JavaScript — mas quem confere no App Review é uma checagem automática que faz um
GET, não um navegador. Política de privacidade em branco é dos motivos mais
citados de reprovação, e esta não estava em branco: ela só não chegava.

O `plataforma/prerender.mjs` roda depois do `vite build` e escreve
`dist/privacidade.html`, `dist/termos.html` e `dist/exclusao-de-dados.html` com
o texto já renderizado (arquivo solto, não `pasta/index.html`, para o Pages
servir sem barra no fim e sem um 301 no caminho). O JavaScript continua
carregando por cima; a diferença é que agora o texto chega sem ele.

**O comando de build do Cloudflare Pages tem de ser `npm run build`.** Com
`vite build` sozinho o `prerender.mjs` não roda e as três voltam a ser casca,
sem erro nenhum — o site publica normalmente. Quem cobra isso é o
`plataforma/provar-politicas.mjs`, que bate no site publicado com `fetch` puro,
sem navegador. Rodar depois de cada deploy que toque nas políticas:

```
cd plataforma && node provar-politicas.mjs
```

### Pendência que bloqueia: o e-mail de contato não recebe

As três páginas mandam escrever para `contato@astartstudio.com.br`, e hoje esse
endereço **recusa mensagem no nível do servidor**. A zona tem dois registros que
precisam sair:

| registro | valor | o que ele faz |
|---|---|---|
| `MX` | `0 .` | declara formalmente que o domínio não recebe e-mail (RFC 7505) |
| `TXT` | `v=spf1 -all` | segundo SPF na zona; dois SPF é erro permanente, e o servidor que recebe nem avalia |

Manter o outro `MX` e o outro SPF (`v=spf1 +a +mx +ip4:199.193.117.170 ...`). Até
isso ser corrigido, o revisor que escrever para o endereço da política leva
bounce — e endereço de contato que não recebe é tão ruim quanto não ter
endereço.

---

## 1.5. O token: o que deu errado hoje, e como não repetir

O primeiro "Conectar conta" de verdade levou este erro:

> A Meta recusou a consulta: O token de acesso da Meta expirou ou foi revogado.

A chave estava no Vault, cadastrada **às 05:09 do mesmo dia**. Dez horas de
vida. Token de usuário do sistema **não expira**; o que morre em uma ou duas
horas é o token curto que o Graph API Explorer entrega por padrão. Era esse.

**O token certo, passo a passo.** Business Manager → *Configurações do negócio*:

1. **Usuários → Usuários do sistema.** Crie um (ou use o que existir) com a
   função **Administrador**.
2. **Adicionar ativos**: as Páginas e as contas de Instagram dos clientes, cada
   uma com **controle total**. Sem isto o token funciona e não alcança conta
   nenhuma — o erro vira "o token não alcança nenhuma Página", que é outro.
3. **Gerar novo token**: escolha o app da Astart, marque os escopos da
   seção 3, e em **Expiração do token** escolha **Nunca**.
4. Copie e guarde na hora: a Meta mostra uma vez só.
5. No SQL Editor do Supabase, **troque** a chave (não é `create_secret`, que
   falha em nome repetido):

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'meta_system_user_token'),
  '<o token novo>'
);
```

6. Na plataforma, em **Ajustes → Integrações → Meta**, clique em **Conferir se o
   token funciona**. Ele tem de aparecer como `SYSTEM_USER` · `não expira` ·
   sem escopo faltando. Se aparecer `USER`, ou com data de expiração, é o token
   errado de novo — e agora a tela diz isso antes de você descobrir num post
   que não saiu.

**Recomendado, e opcional:** cadastre também `meta_app_id` e `meta_app_secret`
(*Configurações do app → Básico*). Com os dois, a conferência consegue
diagnosticar um token **já morto** e dizer por quê; sem eles, ela só funciona
enquanto o token ainda está vivo — que é justamente quando ninguém pergunta.

```sql
select vault.create_secret('<app id>',     'meta_app_id');
select vault.create_secret('<app secret>', 'meta_app_secret');
```

---

## 2. O que só a Astart pode produzir

### Business Verification
O item mais lento, e o único que não depende de código.

- CNPJ da Astart, com situação regular
- Documento constitutivo (contrato social ou equivalente)
- Comprovante de endereço da empresa
- Telefone e e-mail no domínio da empresa, que a Meta vai usar para confirmar
- Site público da empresa

Começa em **Business Manager → Configurações do negócio → Central de segurança
→ Verificação do negócio**. Dá para iniciar **antes** do App Review, e é o que
eu recomendo: enquanto ela corre, a gente prepara o resto.

### Conta de teste para o revisor
Os guias são unânimes: o revisor precisa **entrar e ver funcionando**. Então:

- um usuário na plataforma com papel `operacao` e e-mail que a Astart controle
- um cliente de teste com uma conta de Instagram Business conectada
- a senha, escrita no formulário de submissão

Essa conta é descartável e eu apago depois. **Não use a sua conta de direção**:
o revisor veria o financeiro da agência, que não tem nada a ver com a análise.

### O screencast
É a peça que mais pesa. Os guias dizem que reprovação por "fluxo incompleto" é
o caso mais comum — o revisor precisa ver **do login até o post publicado**,
sem corte.

Roteiro, em uma gravação só, sem edição:

1. Abrir `astart-plataforma.pages.dev`, fazer login com a conta de teste.
2. Ir no cliente → aba **Calendário**.
3. Clicar em **Conectar conta**, mostrar a lista que a Meta devolve, e ligar
   uma conta. *(Este trecho justifica `pages_show_list` e `business_management`.)*
4. Clicar em **Nova publicação**: escolher formato, escrever legenda e
   hashtags, **arrastar uma imagem JPG**.
5. Escolher data e hora e clicar em **Agendar**. Mostrar a peça aparecendo no
   calendário na data.
6. Voltar e clicar em **Postar agora** numa segunda peça. Esperar e mostrar o
   post **publicado no Instagram**, na conta conectada.
   *(Este trecho justifica `instagram_content_publish`.)*
6b. Repetir numa peça com destino **Facebook**, e mostrar o post publicado na
   Página. *(Este trecho justifica `pages_manage_posts`. Só gravável depois de
   o adaptador da Página existir.)*
7. Mostrar a página de **exclusão de dados** e dizer, em voz ou legenda, como o
   cliente revoga o acesso.

Fale em voz alta o que está fazendo, ou ponha legenda. Em português está certo —
a Meta aceita, e inventar inglês ruim atrapalha mais que ajuda.

---

## 3. As permissões, e a justificativa de cada uma

A regra que os guias repetem: **peça só o que o screencast mostra.** Permissão
pedida sem aparecer no vídeo é motivo de reprovação do pedido inteiro.

> **Correção de uma versão anterior desta página.** Eu havia escrito
> `instagram_business_content_publish`, e está errado para o nosso caso. Existem
> dois caminhos de login, com nomes de permissão diferentes, e eles não se
> misturam:
>
> - **Instagram API com Facebook Login** — o nosso. A gente descobre as contas
>   por `me/accounts` (Páginas) e publica em `{ig-user-id}/media`. Usa
>   `instagram_content_publish`.
> - **Instagram API com Instagram Login** — o outro. Usa
>   `instagram_business_content_publish` e `instagram_business_basic`.
>
> Pedir o nome do caminho errado queima um ciclo de análise inteiro. Os nomes
> abaixo são os do caminho que o código realmente usa — estão escritos também em
> `supabase/functions/conectar-conta/index.ts`, na constante
> `ESCOPOS_NECESSARIOS`, e a tela de Integrações mostra quais o token tem.

| permissão | para que, no nosso caso |
|---|---|
| `instagram_content_publish` | publicar a peça agendada na conta do cliente, na hora marcada |
| `instagram_basic` | ler o nome e o identificador da conta, para a equipe confirmar que conectou a conta certa |
| `pages_show_list` | listar as Páginas que o cliente autorizou, para a equipe escolher a conta certa na hora de conectar |
| `pages_read_engagement` | ler o vínculo da Página com a conta de Instagram — é o que o caminho de Facebook Login exige para alcançar a conta |
| `pages_manage_posts` | publicar na Página do Facebook do cliente, quando o contrato inclui Facebook |
| `business_management` | ler esse vínculo dentro do Business Manager da agência, que é onde os ativos do cliente estão |

> **O `pages_manage_posts` entrou depois.** Eu o havia tirado desta lista
> escrevendo que o adaptador do Facebook não existe e que pedir permissão que o
> screencast não mostra reprova o pedido. As duas frases continuam verdadeiras —
> mas a dona respondeu que **precisa do Facebook**, não só do Instagram. Então a
> ordem muda, não a regra: **o adaptador da Página tem de existir e aparecer no
> vídeo antes da submissão.** Submeter as seis com o Facebook só no papel é
> queimar o ciclo.

Texto-base para o campo de justificativa (adapte, não copie cego):

> A Astart Studio é uma agência de social media. Esta plataforma é a ferramenta
> interna com que a equipe planeja, submete à aprovação do cliente e publica o
> conteúdo nas contas que cada cliente autorizou por contrato. A permissão é
> usada exclusivamente para publicar peças agendadas por uma pessoa da equipe e
> aprovadas pelo cliente, nas contas conectadas por ele. Não há publicação
> automática sem agendamento humano, e os dados não são usados para nenhuma
> outra finalidade.

---

## 4. Configuração do app, antes de submeter

No painel do app, em *Configurações → Básico*:

- **Nome de exibição**: "Astart Studio" (não ponha "teste" nem "dev" — reprova)
- **E-mail de contato**: um endereço que a Astart leia
- **URL da política de privacidade**: `.../privacidade`
- **URL dos termos de serviço**: `.../termos`
- **Instruções de exclusão de dados**: `.../exclusao-de-dados`
- **Ícone do app**: a marca da Astart, 1024×1024
- **Categoria**: Business
- **Modo**: o app tem de estar em **Live**, não em Desenvolvimento

Em *Facebook Login for Business → Configurações*:

- **URI de redirecionamento válido**: o endereço da Edge Function de conexão.
  Eu te mando o endereço exato quando a gente for construir o fluxo de OAuth —
  hoje a conexão usa token de System User, que não precisa de redirect.

---

## 5. A ordem que eu recomendo

1. **Hoje:** abrir a Business Verification. É a fila mais lenta e não depende
   de mais nada.
2. **Hoje:** conferir as três páginas públicas e me dizer se o texto está certo
   — o e-mail de contato nelas é um palpite meu (`contato@astartstudio.com.br`).
3. **Antes de qualquer submissão:** apontar o subdomínio de `astartstudio.com.br`
   para a plataforma, e trocar as três URLs. Fazer isso depois custa uma
   atualização no app da Meta e, no pior caso, outra análise.
4. **Antes de gravar o vídeo:** escrever o adaptador do Facebook. A dona
   confirmou que precisa dele, e o `pages_manage_posts` só se justifica se o
   screencast mostrar um post na Página.
5. **Depois do primeiro post de teste funcionar:** gravar o screencast. Gravar
   antes é perder o trabalho, porque o fluxo ainda vai mudar.
6. **Com a verificação aprovada e o vídeo pronto:** submeter as seis permissões
   de uma vez.

---

## 6. Enquanto a análise corre

Sem App Review, o app publica só em contas com papel nele. Duas saídas, e elas
não se excluem:

**Dar papel ao cliente no app.** Em *Funções do app → Testadores*, convidando a
conta do Instagram do cliente. Funciona de graça e na hora, mas pede que cada
cliente aceite um convite de app de desenvolvedor — fácil de explicar para um
cliente parceiro, estranho para os outros.

**API unificada** (Zernio, Upload-Post, Ayrshare). O fornecedor já tem os apps
homologados em várias redes; a gente fala com um endpoint só e o cliente conecta
por lá. Resolve TikTok e YouTube de uma vez, que são dois adaptadores e duas
auditorias que ainda não existem aqui.

> **O que isso custa, e não é dinheiro:** o token do cliente passa a viver no
> fornecedor, não no nosso Vault. Isso contraria a regra que organiza este
> projeto desde o primeiro dia — "token nunca chega no front, fica no Vault,
> lido só pela Edge Function". Continua sendo uma escolha legítima, porque o
> fornecedor é quem tem a homologação; mas é uma escolha, não um detalhe, e a
> política de privacidade teria de passar a citá-lo.
