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
# noutro terminal, com playwright-core instalado:
node contraste.mjs        # contraste composto, dois temas
node acessibilidade.mjs   # axe-core, 2 larguras × 2 temas × 2 papéis
node olhar.mjs            # jornada da equipe + ciclo de aprovação
```
