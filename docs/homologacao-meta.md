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

| item | onde |
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
   *(Este trecho justifica `instagram_business_content_publish`.)*
7. Mostrar a página de **exclusão de dados** e dizer, em voz ou legenda, como o
   cliente revoga o acesso.

Fale em voz alta o que está fazendo, ou ponha legenda. Em português está certo —
a Meta aceita, e inventar inglês ruim atrapalha mais que ajuda.

---

## 3. As permissões, e a justificativa de cada uma

A regra que os guias repetem: **peça só o que o screencast mostra.** Permissão
pedida sem aparecer no vídeo é motivo de reprovação do pedido inteiro.

| permissão | para que, no nosso caso |
|---|---|
| `instagram_business_content_publish` | publicar a peça agendada na conta do cliente, na hora marcada |
| `pages_show_list` | listar as Páginas que o cliente autorizou, para a equipe escolher a conta certa na hora de conectar |
| `pages_manage_posts` | publicar na Página do Facebook vinculada, quando o contrato inclui Facebook |
| `instagram_basic` | ler o nome e o identificador da conta, para a equipe confirmar que conectou a conta certa |
| `business_management` | ler o vínculo entre a Página e a conta de Instagram dentro do Business Manager da agência |

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
3. **Depois do primeiro post de teste funcionar:** gravar o screencast. Gravar
   antes é perder o trabalho, porque o fluxo ainda vai mudar.
4. **Com a verificação aprovada e o vídeo pronto:** submeter as cinco
   permissões de uma vez.

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
