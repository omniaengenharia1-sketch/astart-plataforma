# Arquitetura — Plataforma Astart

> Documento de referência. O código segue este documento; quando divergirem,
> o documento é corrigido antes do código.
>
> Última revisão: 16/09/2026

## 1. O que é

Sistema interno da Astart Studio. Duas aplicações sobre a mesma base: o
**painel da equipe** e o **portal do cliente**. Não é SaaS e não é
multi-tenant — é uma agência e seus clientes.

## 2. Responsividade

| Faixa | Alvo |
|---|---|
| ≤ 640px | celular |
| 641 – 1024px | tablet |
| ≥ 1025px | desktop |

Prioridades diferentes dos dois lados, de propósito:

- **Painel da equipe → desktop primeiro.** É onde se monta calendário,
  arrasta grid e confere proposta. Funciona no tablet e cabe no celular
  para consulta e aprovação rápida.
- **Portal do cliente → celular primeiro.** O cliente aprova do telefone.
  Se a tela *Para aprovar* não for boa no celular, o resto não importa.

O que cada tela faz ao encolher:

| Tela | Desktop | Celular |
|---|---|---|
| Calendário | mês em 7 colunas | lista por dia, rolagem vertical |
| Grid | 3 colunas + painel lateral | 3 colunas; painel vira folha de baixo |
| Conferir proposta | PDF e campos lado a lado | duas abas: Proposta / Campos |
| Serviços | 4 campos em linha | campos empilhados |
| Entregáveis | lista + painel | lista; tocar abre em tela cheia |
| Início (os dois) | colunas | blocos empilhados, ação primeiro |
| Para aprovar | ações na lateral | item em tela cheia, botões fixos no rodapé |

Alvo de toque mínimo 44px. Tabela que não cabe vira lista de cartões —
nunca rolagem horizontal.

## 3. Os seis serviços

`Branding` · `Identidade Visual` · `Audiovisual` · `Website` · `Sistemas` ·
`Gestão Digital`

Tráfego pago não é serviço: é chave dentro da Gestão Digital.
Captação não é serviço: é Audiovisual, e também vem inclusa na Gestão Digital.

## 4. Os três formatos de contrato

| Formato | Serviços | Comporta-se como |
|---|---|---|
| **Projeto** | Branding, Identidade Visual, Website, Sistemas | fases, entregáveis fechados, data de fim, vira acervo |
| **Recorrente** | Gestão Digital, Audiovisual mensal | ciclo mensal, sem fim |
| **Pontual** | Audiovisual avulso | uma entrega, uma data, acaba |

Audiovisual é o único que pergunta o formato no cadastro.

## 5. A matriz serviço → módulo

Serviço contratado liga módulos. Vários serviços podem ligar o mesmo módulo.

| Módulo | Brand | Id.Vis | Audiov | Website | Sistemas | Gestão Dig |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Marcos | ● | ● | ● | ● | ● | ○ |
| Entregáveis | ● | ● | ● | ● | ● | ○ |
| Acervo | ● | ● | ● | ● | ● | ○ |
| Galeria (Drive/Pixieset) | ○ | ○ | ● | ○ | ○ | ● |
| Calendário | ○ | ○ | ○ | ○ | ○ | ● |
| Grid (IG ⟷ TikTok) | ○ | ○ | ○ | ○ | ○ | ● |
| Publicação | ○ | ○ | ○ | ○ | ○ | ● |
| Campanhas | ○ | ○ | ○ | ○ | ○ | ◐ |
| Ambientes e acessos | ○ | ○ | ○ | ● | ● | ○ |
| Manutenção | ○ | ○ | ○ | ● | ● | ○ |
| Integrações | ○ | ○ | ○ | ○ | ● | ○ |
| Financeiro · Contrato · NPS | ● | ● | ● | ● | ● | ● |

● liga · ○ não liga · ◐ liga se a chave estiver ativa no contrato

O padrão vem do serviço e pode ser sobrescrito por cliente. Serviço pausado
desliga a aba **e** o acesso ao dado.

## 6. Mapa de telas

### Painel da equipe — `/`

```
Entrar
│
├─ Início ················· o que precisa de você hoje
├─ Clientes
│   └─ Cliente
│       ├─ Visão geral · Contrato e serviços ······ sempre
│       ├─ Marcos · Entregáveis · Acervo ·········· projeto
│       ├─ Calendário · Grid · Campanhas
│       │   · Redes e contas ····················· recorrente
│       ├─ Ambientes · Integrações · Manutenção ··· website, sistemas
│       ├─ Galeria ······························· audiovisual, captação inclusa
│       ├─ Financeiro ···························· sempre
│       └─ Feedbacks / NPS ······················· sempre
├─ Aprovações ············· todos os clientes, os dois objetos
├─ Agenda ················· a semana da agência: posts e marcos
├─ Fila ··················· publicação em andamento e falhas
├─ Financeiro ············· a agência inteira
├─ Comercial ·············· CRM
└─ Ajustes ················ Equipe · Serviços · Modelos de entregável
```

### Portal do cliente — `/portal`

```
Início ················ o que precisa de você
├─ Para aprovar ········ peças e entregáveis juntos
├─ Meu projeto ········· se tem projeto ativo
├─ Calendário · Grid ··· gestão digital
├─ Campanhas ··········· tráfego pago ativo
├─ Galeria ············· audiovisual ou captação inclusa
├─ Meu site ············ website
├─ Acervo ·············· o que já foi entregue
├─ Financeiro · Contrato · Feedback ··· sempre
```

### Convidado — `/l/:token`

Uma tela. O recorte enviado e os três botões. Sem menu, sem saída.

## 7. O motor de aprovação

Um motor, dois objetos: **peça de conteúdo** e **entregável de projeto**.

```
Ideia → Produzindo → Em aprovação → ┬→ Aprovado → Agendado → Publicado
             ↑                      ├→ Com ajustes ──┘ (volta)
             └──────────────────────┘
                                    └→ Declinado (fim)
```

- O cliente responde item por item. Pode aprovar 8 e pedir ajuste em 2.
- Pedir ajuste exige comentário. Sem texto, não envia.
- O comentário fica preso ao item, com autor e hora.
- Reenvio leva só o que voltou.
- Entregável de projeto tem versões (v1, v2…); peça de conteúdo tem
  substituição de arte. Mesmo ciclo, histórico diferente.

## 8. Entrada e acesso

- Uma porta. Uma tela de login para equipe e cliente; o sistema roteia
  depois da senha.
- Ninguém se cadastra sozinho. Toda conta nasce de convite.
- Sem tela de primeiro acesso: o link do convite abre a mesma tela de login
  com o e-mail preenchido.
- **Nada expira** — nem convite, nem link de aprovação.
- Link de aprovação fecha por estado, não por relógio: quando todos os itens
  do envio forem respondidos vira leitura. A equipe pode revogar na mão.
- Papéis da equipe: `admin` · `operacao` · `financeiro` · `leitura`.
  Separados do **cargo** (Social Media, Designer, Comercial), que é exibição.
- Papéis do cliente: `principal` · `financeiro` · `leitura`. Uma pessoa pode
  responder por mais de um cliente.
- Um mesmo usuário nunca pode ser equipe e cliente ao mesmo tempo — barrado
  no banco, não na aplicação.

## 9. Cadastro de cliente

Três entradas, uma tela de destino:

1. **Importar proposta** — PDF ou link; a IA lê e preenche.
2. **Cadastro manual** — sem proposta em arquivo.
3. **Do comercial** — negócio fechado no CRM vira cliente.

Regras da importação:

- A IA nunca cria o cliente. Ela preenche um formulário.
- Três estados por campo: `preenchido` · `confirmar` · `não encontrado`.
  Campo não encontrado fica vazio, nunca chutado.
- Clicar num campo mostra o trecho de origem no PDF.
- Trava em valor e serviço: sem confirmação desses dois, não cria.
- Só pode cair nos seis serviços. Nunca inventa um sétimo.
- Guarda o sugerido e o aceito, lado a lado.
- A proposta vira o contrato, guardada e visível na aba Contrato desde o
  primeiro dia.
- Escopo escrito na proposta prevalece sobre o modelo padrão de entregáveis.

Serviços em multi-seleção: a barra *Adicionar serviço* abre a lista dos seis;
cada um adicionado abre o próprio bloco de valor. Totais separados —
**Mensal** e **Pagamento único** — nunca somados.

## 9b. Como a equipe preenche o sistema

A regra: **ninguém digita duas vezes, e ninguém digita o que o sistema já sabe.**

O que o sistema preenche sozinho:

| O quê | De onde vem |
|---|---|
| Ficha do cliente | proposta em PDF lida pela IA, confirmada por uma pessoa |
| Entregáveis do projeto | modelo do serviço contratado |
| Cobranças | valores e vencimentos do contrato |
| Slots do mês | escopo contratado + padrão de publicação do cliente |
| Ideias de conteúdo | rotina das 9h |
| Status de pagamento | webhook da Asaas |
| Status de publicação | worker da Meta |

O que uma pessoa digita, e onde:

| Quem | O quê | Onde |
|---|---|---|
| Operação | título e legenda do mês inteiro | **Planejar o mês** (tabela, teclado, uma tela) |
| Operação | ajuste de uma peça | Editor de peça |
| Designer | arte | Editor de peça, ou arrastar no Grid |
| Audiovisual | material de captação | Galeria |
| Operação | versão de entregável | Entregáveis |
| Financeiro | lançamento avulso e rateio | Financeiro |
| Comercial | lead e follow-up | Comercial |
| Admin | cliente, contrato, equipe | Cadastro e Ajustes |

O mês não se monta peça por peça. **Planejar o mês** gera os dez slots nas
datas certas a partir do escopo e do padrão de publicação (`2ª, 4ª e 6ª às 12h`),
e a pessoa preenche só o miolo — em tabela, descendo com o teclado. Dá para
duplicar o mês anterior e para puxar do banco de ideias. Peça criada nasce em
`Produzindo`, sem arte; ganha arte depois e só então entra no Grid.

Montar o mês é trabalho de tela grande. No celular essa tela vira leitura e
ajuste de uma peça.

## 10. Regras do sistema inteiro

1. Aba não contratada **não existe**. Não cinza, não com cadeado: ausente.
   O portão vale na tela e no banco.
2. Os dois inícios respondem à mesma pergunta: o que precisa de mim agora?
3. Nada some sem explicação: status visível, motivo em português, registro.
4. Projeto acaba, acervo não. Contrato encerrado vira leitura, para sempre.
5. Idempotência na publicação. Nunca publicar duas vezes. Item travado em
   `publicando` é reconciliado, jamais reenviado.
6. Token nunca chega no front: Vault, lido só por Edge Function com service role.
7. RLS em todas as tabelas, desde a primeira.
8. Toda data em `timestamptz`, com o fuso do cliente guardado à parte.
9. Migrations versionadas. Nada de mexer no schema pelo painel.
10. Interface em português do Brasil.

## 11. Stack

| Camada | O quê |
|---|---|
| Front | React 18 · Vite · TypeScript strict · Tailwind (responsivo) |
| Banco | Supabase Postgres · RLS · Vault |
| Auth | Supabase Auth |
| Arquivos | Supabase Storage (privado) |
| Trabalho de fundo | Edge Functions (Deno) disparadas por pg_cron |
| Publicação | Meta Graph API — Instagram Business + Facebook Page |
| Cobrança | Asaas (boleto e PIX) — a confirmar |
| Mídia do cliente | Google Drive · Pixieset — a confirmar |
| IA | Anthropic API, só dentro de Edge Function |

## 12. Em aberto

| Item | Situação |
|---|---|
| Asaas | falta confirmar que é essa integração e obter a chave (sandbox primeiro) |
| Pixieset | API pública limitada; pode virar link de galeria + metadados nossos |
| Google Drive | faltam credenciais e a decisão entre ler a pasta ou só linkar |
| Aprovar em lote | decidido que entra, como ação secundária; ainda sem tela |

## 14. Estado do banco

Migrations `0001`–`0012` são o módulo de agendamento na Meta. A fundação da
plataforma são as cinco seguintes:

| Migration | O que entrega |
|---|---|
| `0013` | equipe e convites — papel separado de cargo, convite como única porta de entrada |
| `0014` | os seis serviços, os catorze módulos e a matriz entre eles |
| `0015` | contrato por serviço, chaves opcionais, documentos e o portão `cliente_tem_modulo()` |
| `0016` | login do cliente, `clientes_usuarios` e o RLS que separa um cliente do outro |
| `0017` | motor de aprovação: `itens_aprovacao`, envios em lote, link sem validade |

E os módulos:

| Migration | O que entrega |
|---|---|
| `0018` | entregáveis, versões, arquivos, marcos e os modelos por serviço |
| `0019` | plano de conteúdo, `gerar_slots()` e o banco de ideias |
| `0020` | financeiro: hierarquia de 3 níveis, rateio exato, cobranças |
| `0021` | campanhas de tráfego, relatórios e métricas chave/valor |
| `0022` | captação, galerias e itens |
| `0023` | ambientes, domínios, acessos, integrações e chamados |
| `0024` | NPS |
| `0025` | comercial (CRM) com as 13 etapas |
| `0026` | `minha_sessao()`, `painel_equipe()` e `painel_cliente()` — o que cada início lê |
| `0027` | `lista_clientes()`, `fila_aprovacoes()` e `ficha_cliente()` — o que as telas de dentro leem |

Decisões que viraram regra no banco, não só na tela:

- **Dinheiro em centavos inteiros.** `valor_centavos bigint`. Ponto flutuante
  perde centavo, e centavo perdido em cobrança vira ligação de cliente.
- **Dia de vencimento só até 28.** Dia 29, 30 e 31 não existem em todo mês.
- **Ninguém é equipe e cliente ao mesmo tempo.** Trigger nas duas tabelas.
- **Pedir ajuste exige comentário.** `responder_item()` recusa sem texto; a tela
  também barra, mas quem garante é a função.
- **Item já respondido não aceita nova resposta**, e ninguém responde item de
  cliente que não enxerga.
- **Nada tem coluna de validade.** Nem convite, nem link. O link fecha quando o
  último item do lote é respondido, ou quando alguém revoga.
- **Módulo obrigatório não pode ser desligado na mão** — só os marcados como
  opcionais na matriz aceitam chave no contrato.

O estado de **aprovação** mora em `itens_aprovacao`; `posts.status` continua
cuidando da **publicação**. São dois eixos. Um gatilho de mão única espelha o
primeiro no segundo para o worker seguir funcionando sem alteração.

### Três armadilhas de RLS que já custaram caro aqui

Estão viradas em teste na `08_auditoria_rls.sql`, que varre o catálogo em vez
de listar tabela por tabela — tabela nova que esquecer o RLS cai sozinha.

1. **Política de RLS não pode consultar tabela que também tem RLS.** A
   subconsulta roda como o próprio usuário, volta vazia e esconde tudo em
   silêncio. Quando precisar de um dado de outra tabela protegida, passe por
   uma função `SECURITY DEFINER`.
2. **View sem `security_invoker` fura o portão**, porque lê como dono.
3. **`SECURITY DEFINER` sem `search_path` fixo** aceita sequestro por função
   homônima plantada num schema anterior no caminho.

E duas de teste:

- O dono das tabelas passa por cima de toda política. Teste de RLS que não faz
  `set role authenticated` não testou nada.
- Teste que não roda é pior que teste que falha. O `rodar.sh` casava
  `[0-9][1-9]_*.sql` e pulou o `10_` em silêncio por uma rodada inteira. Agora
  casa `[0-9][0-9]_`, tira só o stub e imprime quantos rodaram.

Toda função nova de leitura entra com o par: o papel certo recebe o dado e o
papel errado recebe `null`, não uma versão reduzida. E cada guarda nova é
quebrada de propósito uma vez, para ver o teste falhar — guarda cujo teste
passa com ela removida não é guarda.

### Rodar os testes

```bash
initdb -D /tmp/pgdata -A trust -U postgres
pg_ctl -D /tmp/pgdata -o "-k /tmp -p 5444" start
supabase/tests/rodar.sh
```

## 13. Telas

**Wireframes** — canvas com as 11 telas, em três páginas
(Entrada, Cadastro, Aprovação):
<https://claude.ai/artifact/Sjwz1yLNgK4GSJkQRDRDVc>

**MVP navegável** — as 45 telas do mapa, ligadas, responsivo, abre no celular:
<https://claude.ai/artifact/5nuLBonHy1jE5nyVmAZi7y>
Fonte em `docs/proto/plataforma-astart.html` (arquivo único, sem dependências).

Cobre a entrada, o painel da equipe inteiro (Início, Clientes, Aprovações, Agenda,
Fila, Financeiro, Comercial, Ajustes), o cadastro de cliente, as 14 abas da ficha
do cliente, o editor de peça, as 12 telas do portal e o link de quem não tem conta.
Inclui o estado vazio do primeiro dia.

### O que já está construído em `plataforma/`

O protótipo acima é o desenho. Isto é o que existe em React, lendo os RPC do banco
(e os dados de exemplo enquanto não há Supabase configurado):

| Tela | Rota | Lê |
|---|---|---|
| Entrar | `/` sem sessão | `minha_sessao()` |
| Início da equipe | `/` | `painel_equipe()` |
| Clientes | `/clientes` | `lista_clientes()` |
| Novo cliente | `/clientes/novo` | `catalogo()` + `criar_cliente()` |
| Ficha do cliente | `/clientes/:id` | `ficha_cliente()` |
| Aprovações | `/aprovacoes` | `fila_aprovacoes()` |
| Início do cliente | `/portal` | `painel_cliente()` |
| Para aprovar | `/portal/aprovar` | `painel_cliente()` + `responder_item()` |
| Entregáveis (ficha) | `/clientes/:id/entregaveis` | `projeto_do_cliente()` + `enviar_para_aprovacao()` |
| Meu projeto | `/portal/projeto` | `projeto_do_cliente()` |

As abas da ficha e as outras telas do portal já existem como rota e dizem que ainda
não foram construídas, em vez de abrir em branco.

O cadastro tem duas abas. A de preencher à mão está pronta: a barrinha de
serviços abre a lista do que ainda não entrou, cada serviço escolhido abre o
próprio valor, e o lado direito mostra em tempo real quanto fica por mês, quanto
em projeto e **quais abas o contrato liga** — a mesma matriz que o RLS aplica.
A aba de jogar a proposta diz o que falta para existir (a chave da Anthropic e a
decisão sobre o documento sair da nossa infraestrutura) em vez de fingir.

A mesma tela de projeto serve os dois lados, com `equipe` ligado ou desligado:
a equipe marca etapas e manda o lote, o cliente lê o andamento. O item de
aprovação nasce no envio — entregável sem item é "a fazer", e é por isso que
começar a trabalhar e mandar para o cliente são dois momentos diferentes no
banco.

**Responder é a única escrita que o cliente faz.** A regra do comentário obrigatório
está nos dois lados: a tela desabilita o botão e explica por quê, e `responder_item()`
recusa de todo jeito — tela é conveniência, função é garantia.
