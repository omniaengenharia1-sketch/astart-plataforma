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
| Aprovar em lote | não desenhado; cliente com 10 peças clica 10 vezes |
| Estados vazios | nenhuma tela do primeiro dia foi desenhada |
| Tela de Equipe | cadastro de membro ainda sem wireframe |
| Comercial / CRM | 13 etapas mapeadas no Notion, nenhuma tela |

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
