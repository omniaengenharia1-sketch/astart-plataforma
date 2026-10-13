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

## 10b. Quem vê o quê

Papel decide, e decide no banco. O portão do dinheiro é `usuario_financeiro()`
— papel `admin` **ou** `financeiro`.

| | direção | operação | financeiro | só leitura | cliente |
|---|---|---|---|---|---|
| Financeiro (agência) | ✓ | — | ✓ | — | — |
| Comercial / funil | ✓ | — | ✓ | — | — |
| Valor do contrato | ✓ | — | ✓ | — | o próprio |
| Cobrança do cliente | ✓ | — | ✓ | — | a própria |
| Clientes, aprovações, agenda, fila, feedbacks | ✓ | ✓ | ✓ | lê | — |
| Convidar, mudar papel, tirar cliente do ar | ✓ | — | — | — | — |

Três coisas que isso quer dizer na prática:

1. **A operação vê o contrato sem o preço.** Serviço, formato, responsável e
   prazo de entrega ficam; valor, dia de vencimento e parcelas saem. Ela precisa
   dos primeiros para trabalhar e não precisa dos últimos para nada.
2. **O NPS continua sendo da equipe inteira.** Quem atende precisa saber que o
   cliente reclamou. O funil, não — ele carrega o valor de cada proposta.
3. **O último admin não se rebaixa.** `mudar_papel()` recusa, porque isso
   trancaria a plataforma para todo mundo e ninguém de dentro conseguiria abrir.

No front isso vive em `src/permissao.ts`, em duas funções, e serve apenas para a
tela não OFERECER o que o banco vai recusar — menu que abre numa recusa é pior
que menu que não tem o item. Quando as duas discordarem, o banco está certo.

## 10c. Os dois links sem conta

Galeria (`/g/:token`) e aprovação (`/a/:token`). Mesma arquitetura, e pelos
mesmos motivos:

1. **O banco guarda o hash, nunca o token.** Vazou o banco, não vazou o acesso.
   O valor em claro existe uma vez, no retorno da função que cria o link — por
   isso a tela copia na hora e avisa que não aparece de novo.
2. **Quem lê é `service_role`, ou seja a Edge Function.** O navegador de quem
   recebeu o link nunca fala com o Postgres: `envio_por_token` e
   `responder_por_token` são revogadas de `anon` **e** de `authenticated`.
3. **Nada vence por relógio.** O link de aprovação vira leitura quando o lote
   fecha (último item respondido) e morre quando alguém revoga. Validade por
   data vence sempre na hora errada: no meio de uma aprovação.
4. **Token vazado responde aquele lote, não o cliente.** `responder_por_token`
   confere que o item pertence ao envio daquele link antes de gravar. Sem essa
   linha, um endereço que escapou no WhatsApp seria chave permanente.
5. **Token errado, link revogado e lote apagado respondem a mesma coisa.** Dizer
   "este lote existe, mas o link foi revogado" já conta demais a quem está
   adivinhando endereços.

A resposta entra pela mesma porta do portal (`responder_item`), que desde a
`0017` aceita `auth.uid()` nulo exatamente para este caminho — ali quem validou
o token foi a função, antes de chegar lá. O nome de quem respondeu vem digitado
na tela: sem conta não há de onde tirar, e "respondido por: alguém" não serve
para quem vai refazer o material.

O contador de acessos existe porque **"ele não respondeu" é diferente de "ele
nem abriu"** — a primeira é cobrança, a segunda é conferir se o link chegou.

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
| `0028` | `catalogo()` e `criar_cliente()` — cliente e contrato na mesma transação |
| `0029` | `item_do_entregavel()` e `enviar_para_aprovacao()` — o lote que não reenvia o que já está na mão do cliente |
| `0030` | `calendario_do_cliente()`, `criar_peca()` e `mover_peca()` — o mês já no fuso do cliente |
| `0031` | `equipe_e_convites()`, desativar, reativar e tirar acesso |
| `0032` | o gatilho que impede alguém de se promover a admin |
| `0033` | ajustes de leitura pedidos pelas telas da ficha |
| `0034` | galeria própria: links por token, favoritos e downloads |
| `0035` | o bucket `galerias`, privado, com o caminho decidindo o dono |
| `0036` | as nove leituras que faltavam: financeiro, fila, agenda, grid, NPS, funil, campanhas, ambientes |
| `0037` | as quatro escritas que faltavam: responder NPS, mover lead, abrir chamado |
| `0038` | o cliente lê a mídia do próprio post — sem isso o Grid do portal era um grid vazio |
| `0039` | o dinheiro é só de quem cuida dele, o comercial fecha junto, e o admin ganha mudar papel e tirar cliente do ar |
| `0040` | `primeiro_admin()` — a porta do primeiro dia, que se fecha sozinha |
| `0041` | aprovar **sem conta**: `envio_por_token()`, `responder_por_token()`, revogar e os lotes na ficha |
| `0042` | `search_path` fixo nas cinco que faltavam; as funções de token saem do alcance do navegador |
| `0043` | `conectores` — o mapa das chaves das três integrações, com estado honesto |

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

### Treze armadilhas que já custaram caro aqui

Estão viradas em teste na `08_auditoria_rls.sql`, que varre o catálogo em vez
de listar tabela por tabela — tabela nova que esquecer o RLS cai sozinha. Mas
auditoria genérica só vê que existe política; **o que a política deixa fazer é
outra pergunta**, e essa só um teste escrito à mão responde (a quarta armadilha
abaixo passou batido por toda a auditoria).

1. **Política de RLS não pode consultar tabela que também tem RLS.** A
   subconsulta roda como o próprio usuário, volta vazia e esconde tudo em
   silêncio. Quando precisar de um dado de outra tabela protegida, passe por
   uma função `SECURITY DEFINER`.
2. **View sem `security_invoker` fura o portão**, porque lê como dono.
3. **`SECURITY DEFINER` sem `search_path` fixo** aceita sequestro por função
   homônima plantada num schema anterior no caminho.
4. **Política de RLS é por LINHA, não por COLUNA.** `perfis_edita_proprio`
   existia para a pessoa trocar o próprio nome e cargo — e deixava trocar o
   próprio `papel` junto. Uma linha de SQL e qualquer pessoa da equipe virava
   admin, com o financeiro e os convites de brinde. Fechado na `0032` com um
   gatilho, porque privilégio de coluna (`grant update (nome, …)`) tiraria o
   direito do admin também. O teste `15_escalada_de_privilegio.sql` tenta a
   promoção e mais cinco caminhos, e falha se a `0032` sair.

A quinta: **zero que mente é pior que porta fechada.** O RLS de `lancamentos` já
era de admin e financeiro, mas `painel_financeiro()` abria para qualquer pessoa
ativa: o RLS filtrava as linhas em silêncio e a tela mostrava R$ 0,00 em tudo.
Operação abria o Financeiro e lia "a agência não faturou nada". A `0039` troca
o portão da função, e agora ela devolve `null` — a aba deixa de existir em vez
de abrir num painel de zeros. Vale para o cartão "vencido" do Início e para a
coluna "por mês" da lista de clientes: nulo é *não te mostro*, zero é *é zero*,
e a tela esconde o campo em vez de afirmar o segundo.

A sexta: **RLS é por linha, e às vezes o segredo é uma coluna.** A operação
PRECISA da linha de `cliente_servicos` — nome do serviço, responsável, prazo de
entrega — e não pode ver três colunas dela. Nenhuma política resolve isso, e
esconder só na função de leitura seria teatro: `GET /rest/v1/cliente_servicos
?select=valor_centavos` continuaria aberto para qualquer login. A `0039` corta
no privilégio de coluna (`revoke select` + `grant select (as outras)`) e o
dinheiro passa a sair de `contrato_valores()` / `contrato_totais()`, SECURITY
DEFINER, que conferem o papel. Isso tira o acesso direto do admin também, de
propósito — e é justamente o motivo de a `0032` **não** ter usado privilégio de
coluna para `perfis.papel`: lá não havia função no caminho, aqui há.

A sétima: **stub generoso testa só o caminho já configurado.** As migrations
`0009` e `0012` recusavam **aplicar** sem as chaves do agendador no Vault, e o
primeiro paste num projeto novo morria em `Cadastre a chave publicar_tick_url`.
Nenhum dos 21 testes pegava, porque o `00_stubs_supabase.sql` criava justamente
aquelas quatro chaves: o ambiente de teste estava mais configurado que uma
instalação nova. Agora o Vault do stub nasce vazio, cada teste cria a chave que
precisa, e o `22_smoke_instalacao_nova.sql` percorre o caminho da primeira vez.

A correção de fundo é de ordem: o agendador da Meta é **um** módulo de oito, e
não pode impedir clientes, aprovações, financeiro e galeria de existirem. O
agendamento do cron virou `agendar_tick()` e `agendar_renovacao_tokens()` —
sem as chaves elas dizem o que falta, em português, e a migration segue com um
aviso. Melhor não agendado que batendo de minuto em minuto numa Edge Function
que ainda não foi publicada.

A oitava: **banco novo nasce trancado.** `perfis` vazia significa
`usuario_admin()` falso para todos, e a Edge Function de convite recusa todo
mundo — inclusive quem acabou de criar o projeto. Nenhum teste pegaria isso,
porque todo teste insere o seu próprio perfil de admin na primeira linha. A
`0040` resolve com uma função que promove a primeira conta e recusa a partir do
segundo uso: a porta se fecha sozinha. Ela é de `service_role`, não de
`authenticated` — se fosse chamável por quem está logado, numa base recém-criada
a primeira pessoa a aparecer se promoveria a dona.

A nona: **`for all` inclui `delete`.** A política de `clientes` da `0006` era
`for all using (usuario_edita())`, então qualquer pessoa de operação podia
apagar um cliente — e o cascade levaria posts, cobranças, galerias e aprovações
com ele. A `0039` separa em três políticas e deixa delete só para admin. Mesmo
ele passa por `remover_cliente()`, que recusa quem tem histórico e manda usar
`desativar_cliente()`.

A décima: **`SECURITY DEFINER` em bucket privado precisa de guarda de formato
antes do cast.** A `0035` e a `0038` leem o dono do arquivo a partir do caminho,
e as duas funções rodam dentro do `using` da política do bucket. Um nome de
arquivo fora da convenção fazendo `::uuid` estourar não derrubaria só aquele
arquivo: derrubaria toda leitura de storage, para todo mundo. Por isso o regex
vem antes do cast, e os testes `16` e `18` passam um caminho torto de propósito.

A décima primeira: **comportamento certo com declaração frouxa passa em teste de
comportamento.** Os 22 primeiros testes cobram o que a plataforma *faz* — o
cliente errado não lê, o operador não vê valor, o token revogado não abre — e
todos passavam enquanto cinco funções estavam sem `search_path` fixo (a terceira
armadilha, violada no próprio código que a documenta) e três funções de token
continuavam chamáveis direto do navegador. Quem achou foi o linter do Supabase,
num banco de produção, com tudo já aplicado. O `23_smoke_declaracoes.sql` cobra
a **propriedade** em vez do caso: nenhuma função de `public` sem `search_path`,
nenhuma `_por_token` alcançável por `anon` ou `authenticated`, e a lista curta
das que são só de `service_role`. Cobrar pelo sufixo, e não pela lista de nomes,
faz a próxima função de token nascer coberta.

As três do token eram **porta a mais, não cofre aberto**: o token continuava
conferido contra o hash, mas o mesmo link podia ser gasto em
`/rest/v1/rpc/galeria_por_token`, sem passar pela Edge Function — que é onde
ficam o registro de acesso e o limite de tentativas. Duas portas e um vigia é o
tipo de arranjo que ninguém desenha de propósito; nasce de uma permissão que
ficou quando o desenho mudou. A `0042` revoga as duas e deixa `service_role`
explícito.

A décima segunda: **curl não aplica CORS, e navegador que não clica não cobre
função.** Eu conferi as cinco Edge Functions com `curl`, uma a uma, e cada uma
respondeu com a própria mensagem em português — relatei que estavam no ar, e
estavam. Mas curl manda o POST direto: não faz o preflight `OPTIONS` que o
navegador manda antes de qualquer pedido com cabeçalho de autorização. Nenhuma
das cinco tratava `OPTIONS`, o preflight voltava `405` sem
`Access-Control-Allow-Origin`, e o navegador bloqueava a chamada antes de sair.

O primeiro convite de verdade descobriu, com "Failed to send a request to the
Edge Function" — que não é erro da função: é a chamada não chegar nela.

O que torna isso instrutivo é que eu tinha **os dois** caminhos de verificação e
os dois estavam cegos no mesmo ponto: o `curl` não aplica a regra do navegador,
e os doze roteiros de tela abrem navegador de verdade mas nenhum clicava em algo
que chamasse Edge Function. Cada um via exatamente o que o outro não via. A
`0042` e o `23` vieram de um linter; este veio de um usuário.

O `scripts/provar-cors.mjs` faz o preflight de propósito, nas cinco, e cobra
quatro coisas: que a nossa origem passa, que a prévia de branch passa, que
**site de fora não recebe liberação**, e que `Vary: Origin` existe — sem ele um
cache intermediário serve a liberação de uma origem para outra. As duas funções
de fundo seguem sem CORS, e o teste cobra isso também: navegador nenhum fala com
elas, e superfície sem uso é o que ninguém revisa depois.

E a lista de origens é lista, não `*`. O token vai no cabeçalho
`Authorization`, que um site de fora não consegue preencher, então o estrago
direto de `*` seria pequeno — mas "pequeno" não é motivo para abrir, e a
`galeria` e a `aprovar` são autorizadas por token, onde o raciocínio não se
repete.

A décima terceira: **`create table if not exists` numa tabela já existente não
avisa nada.** A `0043` criava `public.integracoes` para o mapa das chaves da
agência — e a `0023` já havia criado `public.integracoes` para outra coisa: as
integrações instaladas no site do cliente, amarradas a `cliente_servicos`. O
`if not exists` não criou, não avisou, seguiu. Quem denunciou foi a chave
estrangeira, **por sorte**: `id text` contra `id uuid`. Se as duas usassem
`uuid`, a migration teria se pendurado silenciosamente na tabela errada, a RLS
da agência teria sido aplicada à tabela do cliente, e o estrago apareceria
meses depois sem pista de origem.

A lição não é "escolha nomes melhores" — é que **`if not exists` é idempotência,
não verificação**. Onde o nome importa, o jeito de checar é olhar o catálogo
antes. O registro da agência virou `conectores`/`conector_chaves`.

**O lint que fica, e fica de propósito:** o Supabase avisa que 31 funções
`SECURITY DEFINER` são executáveis por quem está logado. É a arquitetura, não um
descuido — o portão é dentro da função (`usuario_admin()`, `ve_valor_do_contrato()`,
`cliente_tem_modulo()`), e `mudar_papel` ou `remover_cliente` recusam quem não
pode. Trocar para `SECURITY INVOKER` quebraria a primeira armadilha desta mesma
lista. Antes de "resolver" esse aviso, leia a 0032 e a 0039.

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

**MVP navegável (histórico)** — o protótipo de arquivo único que desenhou as 45
telas antes de existir código: <https://claude.ai/artifact/5nuLBonHy1jE5nyVmAZi7y>

O arquivo-fonte dele saiu do repositório: a plataforma de verdade tem todas essas
telas, em React, com as regras no banco. Protótipo e produto divergindo é pior que
protótipo nenhum — quem for conferir o comportamento tem de abrir a prévia, não
uma maquete que não sabe das últimas quinze decisões.

**Prévia da plataforma** — modo exemplo, três acessos (direção, operação,
cliente): <https://claude.ai/artifact/9gnztdQQQjjpJ96mBgW7Ep>

### A linguagem visual: vidro líquido

Preto, branco e o pink da marca, em lâminas translúcidas sobre um campo escuro
com auroras. O vidro é material, não enfeite — e material tem regra:

1. **O campo tem cor; as lâminas quase não têm.** Painel com cor própria vira
   plástico. A cor vem das três auroras (pink, violeta, ciano) presas à janela,
   mais um grão por cima — sem grão, dreamcore vira render de banco de imagem.
2. **Vidro só onde há camada de verdade:** painel, cabeçalho, barra fixa. Linha
   de lista não leva `backdrop-filter`; cem lâminas numa tela derrubam o
   telefone de qualquer um.
3. **A iridescência mora em 1px.** O fio da borda do painel é um degradê
   pink → violeta → ciano com máscara. Em bloco, violeta e ciano nunca aparecem:
   o palco é preto, branco e pink. No tema claro o fio inteiro cai para alfa
   baixo (`--iris-a/b/c`), porque sobre lâmina branca o trecho ciano virava um
   risco azul na borda de baixo — a regra existia e o CSS a furava.
4. **De dia o vidro não acende, escurece.** O reflexo que segue a mão é branco
   no escuro e uma sombra no claro. Por um tempo esta regra tinha o comentário
   certo e o código invertido: branco a 85%. Em lâmina branca ninguém via; em
   cima do cartão rosa era um borrão branco no meio da única caixa da tela que
   precisava ficar limpa. O `tema.mjs` agora mede a cor do reflexo.
5. **O rosa chapado é a caixa que grita, então é a que menos aceita enfeite.**
   `.lamina-pink` tem reflexo próprio (branco a 12%, igual nos dois temas, porque
   o rosa é escuro no claro também), fio de cima mais fraco e queda de sombra em
   vinho, não halo rosa claro.
6. **Dois pinks.** `--pink` preenche (vive atrás de texto escuro) e
   `--pink-texto` escreve (precisa dos 4,5:1 sozinho). Um só não serve aos dois,
   e o degradê dos botões tem outras duas pontas, que escurecem no tema claro
   porque lá o texto em cima é branco.

| Efeito | Onde | O que comunica |
|---|---|---|
| `bloco` | painel | a lâmina: desfoque, brilho interno, queda longa, fio iridescente |
| `erguer` | cartão clicável | sobe 3px e o halo cresce |
| reflexo | lâmina sob o ponteiro | no escuro acende (branco a 14%), no claro **escurece** (preto a 7%) |
| `empurra` | linha de lista que abre algo | acende e ganha um fio pink à esquerda |
| `aurora` | vazio, prévia que não existe, dia livre do calendário | névoa: "cabe coisa aqui" |
| `piscando` | carregando | ponto pink que pulsa, não spinner |
| `risca` | item de menu | fio iridescente que cresce debaixo |
| `entra` | a tela inteira, por rota | sobe 10px saindo do desfoque, 320ms |
| foco | qualquer controle | dois anéis: um vão da cor do fundo e um fio pink — aparece até sobre o próprio pink |

Tudo cai para o estado final sob `prefers-reduced-motion: reduce`, e
`prefers-reduced-transparency: reduce` troca o vidro por lâmina opaca.

**A logo** são dois arquivos, não um com filtro: inverter comeria o quadradinho
verde da marca. Qual aparece é decidido no CSS, porque o tema pode vir do
sistema ou do atributo `data-tema`.

**O tema segue o aparelho**, sem botão: `prefers-color-scheme` manda, e junto com
os tokens trocam os dois rosas, a logo, o ícone da aba (media query dentro do
`favicon.svg`) e o `theme-color` que pinta a barra do navegador. `data-tema` no
`<html>` tem precedência e existe como gancho — nada escreve nele hoje. O
`tema.mjs` cobra isso nas 16 telas, medindo luminância: é o único roteiro que
enxerga "painel escuro no tema claro", porque contraste e axe acham uma página
vazia perfeita.

A auditoria de contraste, acessibilidade, heurísticas e jornada está em
[`ux.md`](ux.md), com os roteiros que medem tudo isso no navegador.

## 15. Galeria própria — saindo do Pixieset

A 0022 deixou a galeria provedor-agnóstica. A `0034`/`0035` fazem `storage`
virar provedor de primeira classe: o arquivo mora no nosso bucket, o cliente
abre por um link sem conta, escolhe as favoritas e baixa em alta.

### As decisões que moldam o resto

1. **A miniatura é feita no navegador, antes de subir.** Quem envia já tem o
   arquivo na mão; mandar 8 MB para o servidor devolver um quadrado de 40 KB
   gasta banda duas vezes e obriga a manter processamento de mídia no servidor.
   Para vídeo seria pior: 1,2 GB subindo só para alguém pegar o primeiro
   quadro. O poster do vídeo sai de um `<canvas>`, com o `<video>` posicionado
   um segundo adentro — o primeiro quadro costuma ser preto.
2. **O original nunca passa por função.** O download é uma URL assinada que
   aponta direto para o storage. Streaming de GB por Edge Function é o caminho
   certo para estourar memória e tempo.
3. **O zip é montado no navegador de quem baixa.** Com `showSaveFilePicker`
   (Chrome e Edge no computador) o arquivo é escrito direto no disco, item a
   item, sem nunca existir inteiro na memória — é assim que 40 GB de captação
   cabem num download. Sem a API, cai para um arquivo de cada vez. O zip é
   `store`, sem compressão: foto e vídeo já estão comprimidos.
4. **Duas portas para a mesma sala.** Quem tem o link não tem conta e passa
   pela Edge Function `galeria`, que valida o token contra o hash no banco.
   Quem está logado lê direto, porque o RLS já sabe quem é. A mesma tela de
   álbum serve as duas.
5. **O caminho é o dono.** `<galeria_id>/orig|mini|poster/<item_id>.<ext>`, e a
   política do bucket traduz o caminho em cliente. A função que faz isso
   confere o formato antes de converter: ela roda dentro da política, e um
   nome de arquivo torto estourando o cast derrubaria toda leitura do storage,
   para todo mundo.

### O que o Pixieset faz e aqui também

Link sem conta · senha opcional no contrato (`permite_download`) · grade com
lupa, teclado e vídeo · o cliente marca as preferidas (é metade do valor do
produto) · download individual e em lote, em alta · registro de quem abriu,
quantas vezes e se já baixou · link revogável, que é a única porta de saída
porque **nada vence** nesta plataforma.

### Onde fica a conta

O que muda de verdade não é o código, é onde o arquivo mora. O Supabase
Storage cobra armazenamento barato e **egresso caro** — por volta de
US$ 0,09/GB acima da franquia, e download de captação é egresso puro. O
Cloudflare R2 cobra armazenamento parecido e **egresso zero**.

Para 300 GB de entregas sendo baixadas duas vezes cada, a diferença é a
mensalidade inteira do Pixieset. O código já está preparado: a única parte
que conhece o provedor é quem assina a URL. Confirmar os preços antes de
decidir — eles mudam.


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
| Calendário (ficha) | `/clientes/:id/calendario` | `calendario_do_cliente()` + `criar_peca()` |
| Calendário | `/portal/calendario` | `calendario_do_cliente()` |
| Equipe e acessos | `/ajustes` | `equipe_e_convites()` + Edge Function `convidar` |

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

O calendário é a mesma tela nos dois lados, como o projeto. Grade de mês no
desktop, agenda no celular — sete colunas de 50px não são um calendário. As
datas chegam do banco **já convertidas para o fuso do cliente**: a peça das 23h
de um cliente no Acre tem de cair no dia dela para quem abrir de qualquer lugar.

Convidar não é RPC: criar conta no Auth exige a service role, que nunca pode
chegar ao navegador. A tela chama a Edge Function `convidar`, que confere pelo
JWT que quem pediu é admin. Como nada vence nesta plataforma, **cancelar
convite e tirar acesso precisam existir de verdade** — e existem, nos Ajustes e
na ficha do cliente. Tirar acesso não apaga ninguém: o histórico de quem
aprovou o quê continua de pé.

**Responder é a única escrita que o cliente faz.** A regra do comentário obrigatório
está nos dois lados: a tela desabilita o botão e explica por quê, e `responder_item()`
recusa de todo jeito — tela é conveniência, função é garantia.
