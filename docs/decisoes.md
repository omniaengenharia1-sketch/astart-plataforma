# Decisões da dona — 13 de outubro de 2026

Depois de um dia de três teorias erradas sobre o mesmo token, ela disse: *"para
não haver mais erros, pergunte TUDO que você tem dúvida sobre o sistema e o que
ele deve haver."* Perguntei vinte e nove coisas. Este arquivo é a resposta, e
passa a valer como decisão — não como preferência a reconfirmar.

Onde eu tinha recomendado algo, a recomendação está marcada. **Em duas ela
decidiu diferente de mim, e nas duas ela estava certa.**

---

## O que já mudou no código por causa disto

| decisão | o que mudou |
|---|---|
| Cliente vê sempre o contrato dele | `registrar_documento_do_cliente()` (0053): `contrato` nasce **visível**, `proposta` e `outro` nascem fechados. Eu havia escrito "upload nunca publica" para todos. |
| Facebook entra | A homologação volta a pedir `pages_manage_posts`, e o screencast precisa mostrar um post na Página. Falta escrever o adaptador. |
| Carrossel com foto **e** vídeo | Precisa de um estado novo no worker: filho de vídeo tem de terminar de processar antes de o carrossel ser montado, e dormir dentro de uma invocação é proibido aqui. |
| Domínio da Astart | As três URLs da homologação saem do `pages.dev` **antes** de submeter. |

---

## Travando

1. **`SUPABASE_DB_PASSWORD` nos segredos do repositório** — ela adiciona. Sem
   isso, a esteira que aplica migrations nunca roda, e produção fica atrás do
   código. Já ficou: produção na 51, repositório na 53.
2. **Business Verification da Meta** — abrir, é a fila mais lenta.
3. **Domínio:** `astartstudio.com.br`, que ela já tem. Eu uso um subdomínio e
   mando o que apontar no Cloudflare. Decidir isto antes da submissão evita
   refazer a análise.
4. **E-mail de contato das páginas públicas** — ainda não confirmado. Está
   `contato@astartstudio.com.br` por palpite meu.

## Campanhas e relatórios

5. **Só o arquivo.** Sem formulário de digitar métrica. *(era a minha
   recomendação, e a tabela de detalhe fica para quando fizer falta)*
6. **PDF, planilha e apresentação.** Imagem segue aceita também, porque
   contrato escaneado é imagem.
7. **O cliente vê o relatório na hora.** Relatório é entrega; não tem chave de
   visibilidade. O portão é o módulo `campanhas` no contrato.

## NPS

8. **Os dois caminhos.** A plataforma coleta (link, nota de 0 a 10, comentário,
   cálculo) **e** aceita arquivo de fora, para o histórico antigo ter lugar.
   O arquivo cai em `cliente_documentos` como `outro`, fechado.
9. Periodicidade: não perguntei de forma fechada. **Pendente.**

## Contrato

10. PDF assinado é anexo; **os valores continuam digitados**, porque é deles que
    a cobrança sai.
11. **O cliente vê sempre o contrato dele.** *(eu havia decidido o contrário —
    ela corrigiu, e a razão dela é melhor: o documento assinado é dos dois, e
    esconder o que a pessoa assinou é burocracia, não cuidado.)*
12. **Valor de contrato: só direção e financeiro.** Operação altera o resto.
    Já valendo na 0052.

## Cobrança (Asaas)

13. **Sandbox primeiro**, até um ciclo fechar.
14. **A plataforma emite sozinha** no dia do vencimento, e avisa do que emitiu.
15. **Pix e boleto.** Sem cartão — nem avulso, nem recorrente.
16. **Atraso: mostra e avisa por e-mail. Nunca bloqueia o portal.**
17. Nota fiscal: não perguntei. **Pendente.**

## Publicação / Meta

18. **Chips de canal (rede + formato numa escolha):** sim, mas depois do upload.
19. **Aviso de falha: e-mail + a tela.** Sem WhatsApp.
20. **Carrossel com foto e vídeo** — "assim como o Insta permite". *(eu havia
    recomendado só imagem por agora; ela quer o que a rede permite, e tem
    razão: metade de um recurso confunde mais que a ausência dele.)*
21. **Facebook entra.** Não é só Instagram.
22. **TikTok e YouTube: os dois, quando der.** Sem API unificada — o token
    continua no nosso Vault.
23. **De 6 a 15 clientes.** Longe do limite de 100 posts/24h por conta, mas o
    agendador deve espalhar os posts ao longo do dia em vez de disparar tudo
    junto.

## Equipe e acesso

24. **Aprovação: depende do cliente.** Os dois caminhos ficam abertos — link sem
    conta e portal logado.
25. **Dinheiro: só a direção, por enquanto.** O papel financeiro existe e entra
    quando houver alguém.
26. Quem começa a usar esta semana: não perguntei. **Pendente.**

## Operação

27. Fuso: não perguntei de forma fechada. Hoje tudo nasce em
    `America/Sao_Paulo`. **Pendente** se houver cliente fora.
28. **Astart e Omnia são mundos separados.** Esta plataforma é só da Astart; a
    ObrasPro continua no projeto da Omnia. Nada compartilhado.

## Prioridade

29. **Primeiro: as telas de upload de contrato e relatório.** O banco já está
    pronto; falta a tela. Depois: chips de canal, Facebook, carrossel com vídeo,
    cobrança.

---

## O que ficou pendente

Quatro coisas que eu não perguntei de forma fechada e que vão precisar de
resposta antes de os módulos correspondentes ficarem de pé:

- o **e-mail de contato** das páginas públicas (bloqueia a submissão à Meta);
- a **periodicidade do NPS** (mensal, trimestral, ao fim de projeto);
- **nota fiscal** — a Astart emite por fora, ou isso entra na plataforma;
- **fuso de cliente fora de São Paulo**, se houver.
