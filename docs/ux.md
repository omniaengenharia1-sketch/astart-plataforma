# Auditoria de UX, acessibilidade e jornada

Feita em cima do design de vidro (outubro de 2026), nas duas larguras extremas
(1440 e 390), nos dois temas, nos dois papéis — equipe e cliente.

Tudo aqui é medido, não opinado: os três roteiros ficam em
`plataforma/` e rodam contra o build de verdade, no navegador de verdade.

| O que | Como |
|---|---|
| Contraste | mede a cor **composta** na tela, camada por camada |
| Acessibilidade | axe-core (WCAG 2.0/2.1/2.2 A e AA + boas práticas) |
| Jornada | roteiro que executa o caminho inteiro e falha se ele quebrar |

---

## 1. Contraste: por que o token mente no vidro

Num design chapado dá para conferir contraste olhando a paleta: tinta sobre
papel, pronto. **Em vidro isso não existe.** O painel é translúcido, embaixo
dele tem um campo escuro com três auroras e uma camada de grão, e o que o olho
recebe é a composição de tudo. Conferir `--tinta-3` contra `--superficie` não
responde nada, porque nenhum dos dois é o que está na tela.

Então o teste pergunta ao navegador, para cada texto: qual é a sua cor, e qual
é a primeira camada opaca abaixo de você. Compõe alfa por alfa e calcula.

Duas rodadas saíram erradas antes de a terceira valer, e as duas por motivo
que vale anotar:

1. **Parada de degradê com alfa não é cor chapada.** Tratar
   `rgba(255,61,154,.24)` da aurora como pink puro reprovava meia interface
   que estava perfeita.
2. **Ler cor com expressão regular quebra.** O navegador devolve
   `oklab(0.98 0.006 -0.005 / 0.62)` e `color-mix(...)` já resolvidos; pegar os
   números na marra lê `0.98` como vermelho e transforma quase-branco em preto.
   Agora quem converte é o próprio navegador: a cor é pintada sobre branco e
   sobre preto num canvas de 1px, e o RGBA sai da diferença. Funciona para
   qualquer sintaxe que o CSS aceitar.

### O que estava realmente errado

| Achado | Medido | Conserto |
|---|---|---|
| Botão pink no tema claro, texto branco no topo do degradê | 1,9:1 | degradê ganhou tokens próprios (`--pink-topo`/`--pink-base`), que escurecem no claro |
| Texto pink da marca sobre fundo claro | 2,6:1 | `--pink-texto` separado do `--pink` de preenchimento: 5,9:1 no claro, 7,5:1 no escuro |
| Cinza secundário no tema claro | 3,9:1 | `--tinta-3` de 0.56 → 0.68 de alfa |
| Lista de peças dentro do cartão pink do portal | **1,57:1** | todo texto dentro do cartão pink passou a usar a tinta do pink |
| Botão pink **dentro** do cartão pink | — | variante `inverso`: fundo escuro, texto pink |
| Legenda da prévia sobre vidro | 4,15:1 | subiu para a tinta cheia |

**Estado:** nenhum texto abaixo do mínimo da AA, nos dois temas, nas telas
auditadas. O botão pink com texto escuro dá 6,4:1 — passaria até em AAA para
texto grande.

---

## 2. Acessibilidade

### O que o axe pegou

Uma violação real: o aviso de "modo exemplo" ficava fora de qualquer marco de
página, então quem navega por marcos pulava ele. Virou `<aside>` com nome.
Hoje: **zero violações** em 2 larguras × 2 temas × 2 papéis × 6 telas.

O contraste fica desligado no axe de propósito — ele não compõe vidro e dá
falso positivo em tudo. Quem mede contraste é o item 1.

### O que o axe não pega, e estava quebrado

- **A lista de clientes não tinha teclado.** A linha inteira era um `<div>` com
  `onClick`: funcionava no mouse e não existia no `Tab`. O nome do cliente
  virou link de verdade; o clique na linha continua, como atalho de mouse.
- **O dia do calendário também não.** Mesmo caso, mesmo conserto: virou
  `<button>` com nome acessível ("Criar peça no dia 6 · 1 já marcada").
- **O foco sumia em cima do pink.** O anel era um contorno pink — invisível
  justamente no botão principal. Agora são dois anéis: um vão da cor do fundo e
  um fio pink por fora, que aparece sobre vidro, sobre preto e sobre o pink.
- **Caixas de marcar de 16px.** A AA 2.2 pede 24px de alvo. Foram para 20px com
  a área do rótulo junto, acima de 44px de altura clicável.
- **Toda tela se chamava "Astart — Plataforma".** Quem trabalha com seis abas
  abertas não achava nenhuma. O título agora é "Aprovações · Astart".
- **Não havia como pular o menu.** Entrou o link "Pular para o conteúdo", que
  aparece no primeiro `Tab`.

### O que já estava certo e continua

Rótulo ligado a cada campo por `htmlFor`; `aria-current` no item de menu
ativo; tabela com `<th scope>`; erro em `role="alert"` e confirmação em
`role="status"`; nada comunicado só por cor (todo estado tem palavra);
`prefers-reduced-motion` derruba as animações; `prefers-reduced-transparency`
troca o vidro por lâmina opaca.

---

## 3. Avaliação heurística (Nielsen)

| # | Heurística | Como a plataforma responde | Dívida |
|---|---|---|---|
| 1 | Visibilidade do estado | Cada item diz de quem é a bola: "no cliente", "ajuste", "no ar". O Início abre com o número do que trava. | O selo de pendência ainda não aparece no menu da equipe |
| 2 | Linguagem do mundo real | "De quem é a bola", "pronto para mandar", "precisa de você". Nada de "pipeline", "workflow", "deliverable". | — |
| 3 | Controle e liberdade | Cancelar em todo formulário; "limpar" na seleção; convite e acesso podem ser revogados. | Não há desfazer depois de aprovar — e não deve haver: a resposta é um compromisso com o cliente |
| 4 | Consistência | Um componente por papel (lâmina, cápsula, fita). A mesma tela de projeto serve equipe e cliente, trocando uma chave. | — |
| 5 | Prevenção de erro | O banco recusa antes da tela: ajuste sem comentário, reenvio do que já está com o cliente, dois clientes no mesmo lote, vencimento dia 31. Clique duplo nunca manda duas vezes. | — |
| 6 | Reconhecer em vez de lembrar | O contrato liga as abas: módulo não contratado não existe na tela, em vez de aparecer cinza. | — |
| 7 | Flexibilidade | "Aprovar todos de uma vez" para quem confia; um por um para quem lê. Busca na lista de clientes. | Faltam atalhos de teclado |
| 8 | Estética e minimalismo | Uma caixa pink por tela, no máximo. O resto é vidro e tipografia. | — |
| 9 | Recuperação de erro | Toda falha vira frase em português, do lado do que falhou, com o botão de tentar de novo. A mensagem do banco é a mensagem da tela. | — |
| 10 | Ajuda | A dica do campo explica a regra **antes** do erro ("até o 28, que existe em todo mês"). A aba da proposta diz o que falta para ela existir. | Não há documentação dentro do produto |

---

## 4. As duas jornadas, conferidas de ponta a ponta

### Equipe — o dia

```
entrar → Início (o que trava hoje) → Clientes → ficha → Entregáveis
  → marcar 2 etapas → recado → enviar → volta pra fila
```

Oito passos do login ao material na mão do cliente. O roteiro executa isso e
falha se qualquer elo quebrar — inclusive conferindo que as etapas enviadas
aparecem na fila da equipe depois.

### Cliente — aprovar

```
entrar → "4 itens esperam você" → abrir → aprovar
                                        ↘ pedir ajuste (texto obrigatório)
```

Três toques para aprovar, quatro para pedir ajuste. O campo de ajuste é
obrigatório na tela **e** na função do banco. O roteiro faz o ciclo inteiro e
confere que o comentário aparece na fila da equipe, do outro lado.

### Onde a jornada ainda trava (e por quê)

| Trava | Depende de |
|---|---|
| Prévia do material não existe (a lâmina mostra "aparece aqui") | Supabase ligado, para o Storage |
| Proposta em PDF não preenche o cadastro | chave da Anthropic + decisão sobre o documento sair da infra |
| A peça aprovada não vai sozinha para a fila de publicação | conexão com a Meta |
| Cobrança não é emitida | Asaas |

---

## 5. Como rodar

```bash
cd plataforma && npm run build && npx vite preview --port 4178
# noutro terminal:
npm run roteiros        # os nove, em sequência
```

Ou um por um:

| Script | O que percorre |
|---|---|
| `telas` | cada tela abre com dado dentro, nas duas larguras — e o que a operação **não** vê |
| `tema` | as 16 telas nos dois temas: fundo, texto, logo, barra do navegador e a cor do reflexo |
| `link` | o link sem conta: a equipe manda, alguém sem login abre e responde |
| `olhar` | jornada da equipe + ciclo de aprovação de peça |
| `projeto` | entregável: envia, cliente responde, a volta aparece na ficha |
| `cadastro` | cadastra cliente com contrato, bate na trava de endereço repetido |
| `calendario` | mês de conteúdo, criar peça, mover peça |
| `acessos` | convidar equipe, dar acesso a contato do cliente, tirar acesso |
| `galeria` | subir arquivo, gerar link, abrir o álbum sem conta |
| `acessibilidade` | axe-core, 2 larguras × 2 temas × 2 papéis |
| `contraste` | contraste composto, dois temas, 15 telas |

Os cinco do meio moravam só no diretório de rascunho desta sessão até agora —
teste que vive fora do repositório é teste que não existe, porque o container é
reciclado. Entraram com os `npm run` acima.

Os quatro acham o Chromium do ambiente por conta (`navegador.mjs`): o
`playwright-core` procura um número de build exato e morre pedindo
`npx playwright install` quando a imagem traz outro.

O `telas.mjs` é o que cobra o básico de toda tela nova, dos dois lados: um `h1`
por página, nenhum erro no console, nada rolando na horizontal, nenhum "Em
breve" sobrando, e nenhum `NaN`, `undefined` ou `Invalid Date` escapando para a
tela. Ele também fecha um ciclo: o cliente dá a nota do NPS, sai, a equipe entra
e o comentário dele tem de estar lá.

O `telas.mjs` também percorre o inverso, que importa tanto quanto: entra como
operação e cobra que o Financeiro e o Comercial **não estejam** no menu, que
`/financeiro` digitado na barra encontre uma lâmina que explica em vez de abrir,
que a coluna "por mês" tenha saído da lista e que a ficha mostre o serviço sem
nenhum `R$`. Foi ele que pegou o cartão "Recorrente por mês" no topo da lista de
clientes, que eu tinha esquecido depois de tirar as colunas da tabela.

Três coisas que esse roteiro ensinou:

- **Procurar `nan` em texto minúsculo reprova "Karla Bernardo".** Sujeira de
  render tem caixa própria (`NaN`, `undefined`), então a busca é no texto cru e
  com fronteira de palavra.
- **Esconder em um lugar não é esconder.** A mesma informação aparece em cinco
  pontos de uma tela: coluna da tabela, cartão de resumo, cartão de total,
  resumo do celular e linha da ficha. Tirar da tabela e deixar no total não
  esconde nada — e é o tipo de sobra que só um roteiro acha.
- **Entrar com `goto` zera o modo exemplo.** Os dados vivem na memória da
  página; recarregar entre a sessão do cliente e a da equipe apagava justamente
  a continuidade que o teste existia para provar.

---

## 4b. Aprovar sem ter conta

O caminho mais curto que existe na plataforma, e o que mais muda o dia: a equipe
copia um endereço, manda no WhatsApp, e a pessoa responde. Sem convite, sem
senha, sem "esqueci minha senha" na sexta à noite.

A tela não tem casca: nem menu, nem logo grande da Astart, nem botão de sair.
Quem abriu não é usuária de nada — é alguém que recebeu um link. A marca grande
é a do cliente; a nossa assina pequeno no rodapé.

Uma coisa é pedida antes de qualquer botão funcionar: **o nome**. Sem conta não
há de onde tirar quem respondeu, e "respondido por: alguém" não serve para a
equipe que vai refazer o material. Fica guardado na sessão do navegador, então
ela digita uma vez.

O roteiro `link` abre a página num **contexto limpo**, sem a sessão da equipe —
reaproveitar a aba logada provaria o caminho do portal, que já tem teste. Ele
cobra também o que **não** pode aparecer ali: nada de "plataforma interna",
"ajustes", "sair" nem campo de senha vazando da casca da equipe.

## 5a. O tema segue o aparelho

Sem botão, como no iPhone: `prefers-color-scheme` decide, e a plataforma vira
junto. Quatro coisas trocam, não só a cor de fundo:

1. **Os tokens.** `--papel` vai de `#06060b` a `#fbf7fc`, as lâminas de branco a
   6% viram branco a 66%, e as linhas de brancas a quase-pretas.
2. **Os dois rosas.** `--pink` (preenchimento) e `--pink-texto` (escrita) escurecem
   no claro — `#ff3d9a` sobre branco dá 1,9:1, que é mancha, não texto. No claro
   viram `#c2105f` e `#a30d50`, e o texto em cima dos botões passa de escuro para
   branco.
3. **A logo.** São dois arquivos, não um com filtro: inverter comeria o
   quadradinho verde da marca. Quem troca é o CSS, porque o tema pode vir do
   sistema **ou** do atributo `data-tema`.
4. **O ícone da aba e a barra do navegador.** `favicon.svg` tem a media query
   dentro do próprio SVG, e há um `theme-color` para cada tema — é ele que deixa
   o topo da tela do iPhone preto ou branco junto com a página.

O `data-tema="claro"` / `data-tema="escuro"` no `<html>` existe e tem precedência
sobre o sistema. Nada no front escreve esse atributo hoje: é o gancho pronto para
o dia que alguém pedir um botão de trocar à mão.

### Por que um roteiro só para isso

`contraste` mede a cor do texto contra o fundo e `acessibilidade` roda o axe.
Nenhum dos dois vê **tela em branco** nem **painel escuro no tema claro** — os
dois acham tudo ótimo numa página vazia. O `tema.mjs` mede luminância: fundo do
lado certo, texto do lado oposto, logo certa, e nada grande com opacidade abaixo
de 0,9 depois da animação assentar.

Essa última linha nasceu de um erro meu, duas vezes seguidas. Primeiro tirei um
print 400 ms depois de trocar de aba e concluí que o tema claro estava quebrado —
a tela estava só no meio da animação de entrada (a escada vai até 820 ms: 520 de
animação mais 300 de atraso no último cartão). Então escrevi o roteiro dormindo
900 ms antes de medir. Passou dez vezes e falhou na décima primeira, quando a
máquina estava ocupada com os outros nove roteiros: a aba Contrato ainda tinha
três cartões a meio caminho.

Esperar a **condição** em vez do relógio ajudou, mas não bastou: sob pico de CPU
a escada ainda passava dos 8 segundos de orçamento. A medição então deixou de
disputar com a animação — o roteiro varre as telas com `reducedMotion: reduce`,
que é o modo em que o próprio CSS desliga a escada, e a tela nasce assentada.
Que a animação **termina** é cobrado uma vez, no fim do arquivo, com movimento
ligado. Teste que depende de a máquina estar folgada não é teste, é sorte — e o
falso positivo custa mais caro que o bug, porque ensina a ignorar o vermelho.

### O reflexo, que nenhum outro roteiro vê

A Vi apontou um borrão branco em cima do cartão rosa do portal. A regra do tema
claro tinha o comentário "o reflexo é sombra, não luz" e pintava **branco a 85%**
na linha seguinte. Em lâmina branca ninguém via; sobre o rosa era uma mancha no
meio da única caixa da tela que precisava ficar limpa.

Nem o contraste nem o axe pegariam: o texto continua legível e a cor errada vive
num pseudo-elemento decorativo. Então o `tema.mjs` passou a ler a cor calculada
do `::after` e cobrar duas coisas: no cartão rosa nenhum ponto do reflexo passa
de 12% de alfa, e na lâmina comum o reflexo é claro no tema escuro e escuro no
tema claro. Reintroduzi o bug exato para ver as duas asserções acusarem.

## 5b. As três personas do modo exemplo

A prévia tem três entradas, porque o que cada uma vê é diferente — e uma
demonstração com uma persona só esconde justamente a parte que foi construída:

| Entrada | Quem é | O que muda |
|---|---|---|
| `viviane@astartstudio.com.br` | direção (admin) | vê tudo: Financeiro, Comercial, valor do contrato, mudar papel, tirar cliente do ar |
| `layana@astartstudio.com.br` | operação | sem Financeiro e sem Comercial no menu; contrato sem preço; sem o cartão de vencido |
| `bruna@mormarcas.com.br` | cliente | só o portal dele, com a própria cobrança e o próprio contrato |

Senha: qualquer coisa.

## 6. Como a plataforma fala

Seis regras, aplicadas tela a tela. Elas existem porque a diferença entre
"linguagem de app" e "texto de sistema" é quase toda subtração.

1. **Botão é verbo curto.** "Enviar ao cliente", não "Enviar para aprovação".
   "Aprovar tudo", não "Aprovar todos de uma vez".
2. **Rótulo é substantivo de uma a três palavras.** "Como cobra", "Pode o quê",
   "De quem é a bola". Pergunta curta vale; frase não.
3. **Não explicar a regra — dizer o que fazer.** Era: "sem isso a equipe não
   sabe o que refazer, por isso o campo é obrigatório". Virou: "obrigatório".
4. **Dica tem no máximo cinco palavras, e só quando evita erro.** "do 1 ao 28",
   "só a equipe vê", "opcional". Quando não evita erro, sai.
5. **Vazio diz o que vai aparecer ali, e a ação.** "Nenhuma entrega. Crie a
   galeria, suba os arquivos e mande o link." Sem "assim que a Astart…".
6. **A plataforma não fala de si mesma.** Nada de "o sistema", "a plataforma",
   "nossa infraestrutura", "esta tela ainda não foi construída". O que não
   existe ainda diz "Em breve." e pronto.

Duas consequências práticas: o motivo de uma regra mora no **código**, em
comentário, não na tela — e nome de fornecedor (Pixieset, Anthropic) não
aparece para o usuário, só na documentação.
