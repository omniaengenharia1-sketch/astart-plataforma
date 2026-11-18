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

Prazos, cada um da sua fonte: a **Business Verification** leva *até 14 dias
úteis* (página oficial da Meta, lida em 18/11/2026); o **App Review** tem média
declarada de ~24 h na doc de desenvolvedor, e os relatos de 2026 falam em 2 a 4
semanas — então conte com semanas, não com horas. Reprovar e resubmeter é comum
e não é problema; o caro é submeter com material incompleto e perder o ciclo.

---

## 1. O que já está pronto

> **O DOMÍNIO JÁ ESTÁ NO AR, e eu também não tinha conferido.** A plataforma
> responde em **`https://app.astartstudio.com.br`**, servida pelo Cloudflare, e
> as três páginas públicas chegam lá com texto, sem depender de JavaScript —
> medido em 18/11/2026 com `curl` puro, que é como a checagem automática da
> Meta confere.
>
> Eu listei "apontar o subdomínio" como pendência e como o passo 1 do dia. Era
> a segunda tarefa seguida que eu mandei fazer sem olhar se já estava feita — e
> esta, ao contrário da Business Verification, eu PODIA ter conferido daqui: é
> uma consulta de DNS de cinco segundos, com ferramentas que eu já tinha.
>
> Fica valendo a regra, para o dia em que o endereço mudar: trocar o domínio
> depois de aprovado obriga a atualizar o app na Meta e, em alguns casos, a
> passar por análise de novo.

| item | onde (endereço definitivo, no ar e conferido) |
|---|---|
| Política de privacidade | `https://app.astartstudio.com.br/privacidade` ✅ |
| Termos de uso | `https://app.astartstudio.com.br/termos` ✅ |
| Instruções de exclusão de dados | `https://app.astartstudio.com.br/exclusao-de-dados` ✅ |
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

### Pendência que bloqueia: nenhum endereço @astartstudio.com.br recebe

As três páginas mandam escrever para **`astartagencia@gmail.com`**, e isso é
provisório. O endereço da agência é `projetos@astartstudio.com.br` (confirmado
pela dona em 14/10; antes era `contato@`, palpite meu) — mas ele não recebe, e
nenhum outro desse domínio recebe.

**Quando a zona for consertada:** mandar um teste de entrega de verdade para
`projetos@`, e só depois trocar nos dois lugares —
`plataforma/src/paginas/Politicas.tsx` (a constante `CONTATO`) e
`plataforma/provar-politicas.mjs` (a constante `CONTATO` e a regra
`DOMINIO_QUE_RECUSA`, que pode sair junto). A regra existe por causa do defeito,
não por princípio: ela proíbe qualquer endereço `@astartstudio.com.br` nas
páginas, inclusive uma troca bem-intencionada para outra caixa do mesmo domínio,
que pareceria conserto e seria o mesmo buraco.

O endereço existe e tem servidor: o `MX` aponta para
`_dc-mx.5ba896815cfc.astartstudio.com.br`, que resolve para `177.104.174.39`. O
problema é o que está **ao lado** dele na zona:

| registro | valor | o que ele faz |
|---|---|---|
| `MX` | `0 .` | o *null MX* da RFC 7505: declara que o domínio não recebe e-mail |
| `TXT` | `v=spf1 -all` | segundo SPF na zona; dois SPF é erro permanente, e quem recebe nem avalia |

A RFC manda o null MX ser o **único** `MX` quando existe. Com os dois ao mesmo
tempo, o comportamento fica com o remetente — e foi **medido**, não deduzido.

Teste em 14/10: mensagem de um Gmail para `projetos@astartstudio.com.br`.
Bounce em **3 segundos**:

> Endereço não encontrado. A mensagem não foi entregue para
> `projetos@astartstudio.com.br` porque o domínio `astartstudio.com.br` não foi
> encontrado.

A dona já tinha feito o mesmo teste em 13/10 com `adm@` (duas vezes) e
`contato@`: bounce idêntico nas três. Ou seja, **nenhum endereço do domínio
recebe**, e trocar de caixa não adianta — o buraco é da zona, não do endereço.

Isto corrige uma afirmação anterior minha de que "chegaria às vezes". Chegaria,
num servidor tolerante; o Google honra o null MX e recusa na hora, e Google é
quem a Meta usa com mais frequência.

Apagar os dois registros. Manter o outro `MX` (que tem servidor de verdade:
`_dc-mx...` resolve para `177.104.174.39`) e o outro SPF
(`v=spf1 +a +mx +ip4:199.193.117.170 ...`).

**Enquanto a zona não for consertada**, as três páginas públicas precisam de um
endereço que receba, ou a política promete um canal que não existe — e o revisor
que escrever leva bounce. Um endereço de Gmail da agência resolve e é honesto: a
política precisa dizer para onde escrever, não precisa ser no domínio.

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

### Business Verification — ✅ **JÁ ESTÁ FEITA**

> **Conferido pela dona no painel, em 18/11/2026.** No portfólio **Astart
> Design**, Centro de Segurança → *Verificação do negócio*:
>
> | | |
> |---|---|
> | pessoa jurídica | **Astart Agencia de Publicidade LTDA** |
> | estado | **Verificado** |
> | primeira verificação | **13 de dezembro de 2024** |
> | caso de uso | trocado para *"A configurar uma conta do WhatsApp Business"* — continuou Verificado |
> | 2FA dos administradores | em ordem, ninguém pendente |
>
> Não existe botão "Iniciar verificação" para clicar. **O passo a passo
> abaixo não é necessário para este portfólio** — fica como referência para
> um portfólio novo, ou para o dia em que a Meta pedir de novo.
>
> **O erro foi meu, e vale nomear:** eu listei a Business Verification como
> pendência e a chamei de "a fila mais lenta" em todas as versões desta
> página, sem nunca ter conferido. Eu não consigo abrir o Business Manager
> daqui — mas isso é razão para PERGUNTAR, não para afirmar. Duas semanas de
> espera que não existiam entraram em todo plano que escrevi.
>
> **A interface da conta está em português de PORTUGAL.** O menu chama-se
> *Centro de Segurança* (não "Central"), e chega-se a ele por **Definições**,
> no fim da lista da esquerda. Os nomes do passo a passo abaixo são os da
> Central de Ajuda em pt-BR e podem aparecer diferentes na tela.

#### O que isto destrava, e o que NÃO destrava

Destrava: o pré-requisito que a doc de Tech Provider chama de *"Your business
must be verified before you can start the app review process"*. Vale para as
duas fases, Instagram/Facebook e WhatsApp.

**Não destrava, e é o que precisa ser conferido antes de qualquer submissão:**
a verificação é do **portfólio**, não da conta. O app da plataforma tem de
estar ligado ao portfólio **Astart Design** — se ele nasceu sob outro
portfólio, a verificação não viaja junto e o App Review barra do mesmo jeito.
É uma conferência de um minuto no painel do app, em *Configurações → Básico*,
no campo do portfólio empresarial.

---

#### Referência: como seria, num portfólio ainda não verificado

> **Esta seção foi reescrita em 18/11/2026 contra a fonte certa.** A versão
> anterior veio de guias de terceiros e errava duas coisas que importam: dizia
> que a Meta confirma por "telefone e e-mail no domínio da empresa" (são
> **cinco** métodos, e o e-mail é o pior deles para a Astart), e estimava
> "2 a 4 semanas" (a Meta diz **até 14 dias úteis**). O que está abaixo saiu
> das páginas em português da Central de Ajuda, lidas com navegador — elas
> carregam por JavaScript e vêm vazias num `curl`, que foi por isso que a
> primeira versão era palpite.

**Onde fica, com o nome de hoje:** *Central de Segurança*, no **Meta Business
Suite** → botão **Iniciar verificação**. Não é mais "Business Manager →
Configurações do negócio" na nomenclatura atual.

Quem clica precisa ter **controle total do portfólio empresarial**: *"Os
proprietários de portfólios empresariais com controle total podem verificar
suas empresas"*. Se a Central de Segurança não abrir, é isso que falta.

Se aparecer **"Não se qualifica para verificação"**, não é erro: a Meta diz que
nem toda empresa precisa, e que o pedido pode chegar depois por e-mail ou
notificação, vindo do produto que exige — no nosso caso, a Plataforma do
WhatsApp Business, que está na lista oficial de produtos que exigem verificação.

#### O que preencher

Razão social, endereço, telefone e site. A Meta é explícita:

> Verifique se os detalhes inseridos correspondem exatamente aos detalhes da
> sua pessoa jurídica.

> verifique se o site da sua empresa está carregando corretamente e se está em
> conformidade com o HTTPS

**O site já passa.** Conferido em 18/11/2026 com navegador:
`https://astartstudio.com.br` responde 200 em HTTPS, e `www` redireciona para
ele. Site que não carrega, sem HTTPS, ou com link que leva a erro é **motivo
declarado de rejeição**.

#### Como a Meta confirma que a empresa é sua — e por que isto desbloqueia a Astart

> Escolha um método para confirmar sua conexão: **email, telefone, SMS,
> mensagem do WhatsApp ou verificação de domínio**.

São cinco, não dois. **Escolher telefone, SMS ou WhatsApp resolve o problema
da zona de DNS quebrada**: o código não passa por e-mail nenhum.

E há um motivo a mais para não escolher e-mail:

> Talvez você também tenha que fornecer comprovantes de que é proprietário do
> domínio do site, **caso escolha receber o código de verificação pelo endereço
> de email**.

Ou seja, o caminho do e-mail custa mais trabalho E depende de uma caixa que
hoje não recebe. **Telefone ou WhatsApp, e segue.**

Isto corrige a dependência que esta página afirmava: consertar a zona de DNS
continua certo e necessário (as três páginas públicas prometem um canal de
contato), mas **não bloqueia a Business Verification**.

#### Os documentos, com os nomes que a Meta usa

Pode ser pedido quando a empresa não é encontrada no registro automático
("Minha empresa não está listada"). A lista oficial:

| documento | serve para |
|---|---|
| Certificado/contrato social | razão social |
| Documento de inscrição ou licença da empresa | razão social |
| Documento fiscal emitido **pelo governo** (ex.: certificado fiscal — o cartão CNPJ) | razão social |
| Extrato bancário da empresa | razão social |
| Conta de serviços públicos | **só** endereço e telefone, nunca razão social |

Regras que reprovam se ignoradas:

- documento **vencido** não vale, e tem de ser emitido pela autoridade competente;
- *"Documentos fiscais preenchidos pela própria empresa não são aceitos"*;
- a conta de luz/água tem de trazer a **razão social**, não o nome de uma pessoa;
- **tape o CPF**: *"Lembre-se de cobrir as informações pessoais adicionais de
  que não precisamos"*;
- **português é aceito** — não precisa traduzir nada.

#### Prazo e reprovação

> Uma decisão sobre o envio da verificação pode levar **até 14 dias úteis**.

Os motivos de rejeição que a Meta lista:

1. informação falsa ou enganosa, ou suspeita disso;
2. tentar verificar um portfólio que não é seu;
3. tentar burlar o sistema de análise;
4. **site que não carrega, sem HTTPS, ou com link que leva a erro**.

Reprovado, dá para **apelar** pela própria Central de Segurança.

#### A armadilha que custa o ciclo inteiro

> **se você editar os detalhes da sua empresa, será necessário concluir o
> processo de verificação novamente.**

Por isso o endereço, o telefone e a razão social têm de estar certos **antes**
de enviar. Mexer depois zera a fila de 14 dias.

> **Não confundir com duas coisas parecidas:** *verificação de domínio* é
> provar que o site é seu (metatag ou registro DNS), e aqui é só um dos cinco
> métodos de confirmação; *Meta Verified* é o selo azul pago, e a Meta avisa
> em todas as páginas que a verificação da empresa *"não concederá a você um
> selo de verificado"*.

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

1. Abrir `app.astartstudio.com.br`, fazer login com a conta de teste.
   (O endereço do vídeo tem de ser o MESMO que está no formulário. Gravar no
   `pages.dev` e submeter o outro é pedir para o revisor perguntar por quê.)
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

1. ~~**Hoje:** abrir a Business Verification.~~ **PRONTA desde 13/12/2024**,
   no portfólio Astart Design. Em vez disso: conferir que o app da plataforma
   está ligado A ESSE portfólio — a verificação é do portfólio, não da conta.
2. **Hoje:** conferir as três páginas públicas e me dizer se o texto está certo.
   O e-mail de contato já foi confirmado: `projetos@astartstudio.com.br`.
3. ~~**Antes de qualquer submissão:** apontar o subdomínio.~~ **JÁ ESTÁ**, em
   `app.astartstudio.com.br`, com as três páginas conferidas por `curl`. O que
   resta é copiar esses três endereços para *Configurações → Básico* do app.
4. ~~**Antes de gravar o vídeo:** escrever o adaptador do Facebook.~~
   **FEITO (0072).** A Página publica **foto e álbum de fotos**. Reel e story
   da Página continuam recusados, com o motivo na tela: vídeo sobe por
   `rupload.facebook.com`, em upload retomável de três fases — outro host e
   outro protocolo, que pede um estado novo na máquina do worker.
   Para o screencast isso basta: o que o `pages_manage_posts` precisa mostrar
   é **um post saindo numa Página**, e uma foto é um post.
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


---

# Fase 2 — o WhatsApp no sistema (coexistence)

> Escrito em 18/11/2026, depois de a dona perguntar como o Kommo conecta o
> WhatsApp sem perder nada. **Nada disto está construído.** É o mapa do que a
> Meta exige, levantado na documentação oficial, para a decisão não ser tomada
> em cima de blog de fornecedor.

## O recurso tem nome: Coexistence

Desde 2025 a Meta deixa o **mesmo número** rodar no app WhatsApp Business do
celular **e** na Cloud API ao mesmo tempo. Na doc:

> They can still send messages on a one-to-one basis using the WhatsApp
> Business app

> Messages sent and received are mirrored between the Cloud API and WhatsApp
> Business app

É isto que o Kommo vende como *"Connect WhatsApp Business app to Kommo"*. Não
é leitura de QR do WhatsApp Web.

**Correção de uma afirmação minha anterior.** Eu disse à dona que migrar o
número faria perder o app e o histórico. Isso vale para o caminho **direto**
(registrar o número na Cloud API), e não para este. Eu estava desatualizado.

## O que NÃO sobrevive

Da doc, e vale escrever antes de alguém prometer "não perde nada":

| | |
|---|---|
| histórico | `All chat messages in the most recent 6 months can be synchronized` — e só se o negócio aceitar compartilhar no onboarding. **O Kommo, no artigo dele, importa só os últimos 30 dias.** |
| grupos | `Group chats will not be synchronized.` |
| listas de transmissão | `Broadcast lists will be disabled.` As que existem ficam só-leitura |
| sem suporte na API | chamadas de voz e vídeo, catálogo, pedidos, status, etiquetas, respostas rápidas, mensagem de saudação e de ausência |
| aparelhos | ao conectar, `all companion apps will be unlinked`; depois religa até 4 |
| vazão | `a fixed throughput of 20 mps` |
| prazo | 24 h para sincronizar depois do onboarding, e **uma vez só** — para refazer, desconectar no app e repetir |

Requisitos do número: app **2.24.17 ou superior**, não pode ser WhatsApp
pessoal, e a elegibilidade é decisão da Meta (conta nova de app não entra na
hora).

**É reversível.** Sai pelo app, em *Ajustes → Conta → Plataforma de Negócios →
Desconectar*. Não dá para usar a Deregister API.

## O requisito que decide tudo

> You must already be a Solution Partner or Tech Provider.

Coexistence só acontece pelo **Embedded Signup**, e Embedded Signup é de
parceiro. É exatamente por isso que o Kommo consegue e a plataforma não.

**Tech Provider é autosserviço** — não há aplicação comercial, só painel:

1. Business Verification: `Your business must be verified before you can start
   the app review process.` **É a mesma da fase 1** — feita uma vez, serve às
   duas.
2. App Review com **Advanced Access** em:
   - `whatsapp_business_messaging` — *"required to send messages on behalf of
     your clients"*
   - `whatsapp_business_management` — *"required to access your clients'
     WhatsApp accounts and Messaging accounts"*
3. Sem isso: `You will not be able to onboard business customers until your app
   has been approved for advanced access`.

Prazo médio que a doc cita para o App Review: **~24 h** (a nossa experiência
com os prazos reais da fase 1 dirá se vale para nós).

Um teto de volume existe, e não atrapalha a Astart: sem verificação são 10
novos clientes a cada 7 dias; com ela, 200.

## O preço

A Meta cobra **por mensagem** desde 1º de julho de 2025, não por conversa:
*"Meta charges on a per-message basis"*. A tabela em vigor é `effective October
1, 2026`, e nela as mensagens de **service** voltaram a ser cobradas depois de
uma franquia de **1.000 por mês por número**. As enviadas pelo app do celular
continuam de graça: *"messages sent by the business via the WhatsApp Business
app will continue to be free"*.

Comparação, para a decisão: o Kommo custa **US$ 20 a 45 por usuário/mês**
(cobrado em blocos de 6 meses) **mais** as taxas da Meta. Como Tech Provider,
só as taxas da Meta.

## A ordem

1. **Fase 1 primeiro** (Instagram e Facebook). A doc avisa que pedir permissão
   desnecessária é *"a common reason for rejection"*: empacotar WhatsApp junto
   arrisca a aprovação que destrava o atendimento aos clientes.
2. Business Verification aprovada → submeter os dois escopos de WhatsApp.
3. Só então construir o módulo: webhook de `smb_message_echoes` (o que ela
   manda pelo celular chega na plataforma), janela de atendimento de 24 h, e a
   conversa dentro do cartão do lead.

**Atenção à versão.** A doc avisa que `Embedded Signup v2 and v3 will be
deprecated on October 15, 2026` — data que já passou. Conferir v4/v5 no dia da
implementação, não hoje.
