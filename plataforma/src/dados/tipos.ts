// =============================================================================
// Os tipos espelham o schema de supabase/migrations. Quando um divergir, o
// banco esta certo e este arquivo esta errado.
// =============================================================================

export type PapelEquipe = 'admin' | 'operacao' | 'financeiro' | 'leitura';
export type PapelCliente = 'principal' | 'financeiro' | 'leitura';
export type FormatoContrato = 'projeto' | 'recorrente' | 'pontual';
export type StatusServico = 'ativo' | 'pausado' | 'encerrado';

export type EstadoAprovacao =
  | 'produzindo'
  | 'em_aprovacao'
  | 'com_ajustes'
  | 'aprovado'
  | 'declinado';

/** Entregavel sem item ainda nao comecou. A view do banco devolve 'a_fazer'. */
export type EstadoEntregavel = EstadoAprovacao | 'a_fazer';

export type TipoItem = 'peca' | 'entregavel';

export type ChaveServico =
  | 'branding'
  | 'identidade_visual'
  | 'audiovisual'
  | 'website'
  | 'sistemas'
  | 'gestao_digital';

export type ChaveModulo =
  | 'marcos' | 'entregaveis' | 'acervo' | 'galeria'
  | 'calendario' | 'grid' | 'publicacao' | 'campanhas'
  | 'ambientes' | 'manutencao' | 'integracoes'
  | 'financeiro' | 'contrato' | 'nps';

export interface Perfil {
  userId: string;
  nome: string | null;
  email: string;
  papel: PapelEquipe;
  cargo: string | null;
  ativo: boolean;
}

export interface Cliente {
  id: string;
  nome: string;
  slug: string;
  fusoHorario: string;
  ativo: boolean;
}

export interface ServicoContratado {
  id: string;
  clienteId: string;
  servico: ChaveServico;
  servicoNome: string;
  formato: FormatoContrato;
  status: StatusServico;
  responsavelNome: string | null;
  /**
   * Centavos. Nunca float: centavo perdido em cobranca vira ligacao de cliente.
   *
   * Nulo quando quem esta lendo nao cuida do dinheiro (migration 0039). Nulo e
   * "nao te mostro", nao "e zero" — a tela esconde o campo em vez de dizer que
   * o cliente nao paga nada.
   */
  valorCentavos: number | null;
  diaVencimento: number | null;
  parcelas: number | null;
  inicio: string;
  entregaEm: string | null;
}

export interface ItemAprovacao {
  id: string;
  clienteId: string;
  clienteNome: string;
  tipo: TipoItem;
  estado: EstadoAprovacao;
  titulo: string;
  enviadoEm: string | null;
  respondidoEm: string | null;
  respondidoPor: string | null;
}

/** Uma linha do "precisa de voce" do Inicio da equipe. */
export interface Pendencia {
  id: string;
  clienteId: string;
  clienteNome: string;
  oQue: string;
  quando: string;
  rota: string;
  acao: string;
  urgente: boolean;
}

export interface SaidaDoDia {
  id: string;
  hora: string;
  clienteNome: string;
  tipo: string;
}

export interface CompromissoDaSemana {
  id: string;
  data: string;
  titulo: string;
  responsavelNome: string | null;
}

export interface PainelEquipe {
  hoje: string;
  pendencias: Pendencia[];
  saiHoje: SaidaDoDia[];
  semana: CompromissoDaSemana[];
  esperandoCliente: number;
  /** Nulo para quem nao cuida do dinheiro. */
  vencidoCentavos: number | null;
}

export interface ResumoRedes {
  publicados: number;
  agendados: number;
  esperandoVoce: number;
  emProducao: number;
}

export interface ResumoProjeto {
  servicoNome: string;
  total: number;
  entregues: number;
  fase: string;
  proximo: string | null;
}

export interface ResumoCaptacao {
  proximaData: string | null;
  proximoTitulo: string | null;
  ultimaTitulo: string | null;
  ultimaFotos: number;
  ultimaVideos: number;
}

export interface Cobranca {
  id: string;
  descricao: string;
  valorCentavos: number;
  vencimento: string | null;
  situacao: 'previsto' | 'atrasado' | 'recebido' | 'pago' | 'cancelado';
}

export interface PainelCliente {
  cliente: Cliente;
  modulos: ChaveModulo[];
  paraAprovar: ItemAprovacao[];
  proximaCobranca: Cobranca | null;
  npsPendente: boolean;
  redes: ResumoRedes | null;
  projeto: ResumoProjeto | null;
  captacao: ResumoCaptacao | null;
}

/** Quem esta logado. A plataforma inteira se decide por este tipo. */
export type Sessao =
  | { tipo: 'anonimo' }
  | { tipo: 'equipe'; perfil: Perfil }
  | { tipo: 'cliente'; nome: string; email: string; clientes: Cliente[]; clienteAtual: Cliente };

// --- as listas de dentro (migration 0027) ------------------------------------

/** Uma linha da tela Clientes. */
export interface ClienteNaLista {
  id: string;
  nome: string;
  slug: string;
  servicos: string[];
  responsaveis: string[];
  /** Itens que voltaram com ajuste: a bola está com a equipe. */
  precisaDeVoce: number;
  /** Itens enviados e sem resposta: a bola está com o cliente. */
  esperandoCliente: number;
  /** Nulos para quem nao cuida do dinheiro: a coluna sai da tabela. */
  mensalCentavos: number | null;
  unicoCentavos: number | null;
}

/** Uma linha da fila de aprovações, de qualquer cliente, dos dois tipos. */
export interface ItemNaFila extends ItemAprovacao {
  /** O último comentário do item, para a fila não precisar abrir o item. */
  comentario: string | null;
}

export interface ContatoCliente {
  userId: string;
  nome: string;
  email: string;
  papel: PapelCliente;
  ativo: boolean;
}

export interface PendenciaCurta {
  id: string;
  tipo: TipoItem;
  titulo: string;
  quando: string | null;
}

export interface Movimento {
  quando: string;
  oQue: string;
}

export interface FichaCliente {
  cliente: Cliente;
  modulos: ChaveModulo[];
  servicos: ServicoContratado[];
  contatos: ContatoCliente[];
  pendencias: PendenciaCurta[];
  movimentos: Movimento[];
  mensalCentavos: number | null;
  unicoCentavos: number | null;
}

/** As três respostas que `responder_item()` aceita. */
export type Decisao = 'aprovado' | 'com_ajustes' | 'declinado';

// --- o cadastro (migration 0028) --------------------------------------------

export interface ModuloDoServico {
  chave: ChaveModulo;
  nome: string;
  /** Opcional = só liga se for marcado no contrato. */
  opcional: boolean;
}

export interface ServicoCatalogo {
  chave: ChaveServico;
  nome: string;
  /** Nulo = o cadastro pergunta o formato. Hoje só o Audiovisual. */
  formatoPadrao: FormatoContrato | null;
  modulos: ModuloDoServico[];
}

export interface MembroEquipe {
  userId: string;
  nome: string | null;
  papel: PapelEquipe;
}

export interface Catalogo {
  servicos: ServicoCatalogo[];
  modulosSempre: { chave: ChaveModulo; nome: string }[];
  equipe: MembroEquipe[];
}

/** Uma linha do contrato, do jeito que `criar_cliente()` espera. */
export interface ServicoEscolhido {
  servico: ChaveServico;
  formato: FormatoContrato | null;
  valorCentavos: number;
  diaVencimento: number | null;
  parcelas: number | null;
  inicio: string;
  entregaEm: string | null;
  responsavelId: string | null;
  /** Só os módulos OPCIONAIS que ficam ligados. */
  modulos: ChaveModulo[];
}

export interface ClienteNovo {
  id: string;
  slug: string;
  nome: string;
}

// --- o projeto (migration 0029) ---------------------------------------------

export interface EntregavelNoProjeto {
  id: string;
  itemId: string | null;
  fase: string;
  titulo: string;
  ordem: number;
  estado: EstadoEntregavel;
  prazo: string | null;
  versaoAtual: number | null;
  enviadoEm: string | null;
  respondidoEm: string | null;
  responsavelNome: string | null;
}

export interface MarcoNoProjeto {
  id: string;
  titulo: string;
  prazo: string;
  concluidoEm: string | null;
}

export interface ServicoNoProjeto {
  clienteServicoId: string;
  servico: ChaveServico;
  servicoNome: string;
  entregaEm: string | null;
  entregaveis: EntregavelNoProjeto[];
  marcos: MarcoNoProjeto[];
}

// --- o calendario (migration 0030) ------------------------------------------

/**
 * Os mesmos valores do enum `status_post` do banco — TODOS eles.
 *
 * `publicado_parcial` faltava aqui, e o banco manda o status cru. Uma peça que
 * saiu numa conta e falhou na outra chegava com um valor que o tipo dizia não
 * existir, caía em todos os `if` e aparecia como **rascunho** — o pior rótulo
 * possível para algo que já está no ar pela metade. Lista de valores que não
 * espelha o enum é mentira que o TypeScript não pega.
 */
export type StatusPublicacao =
  | 'rascunho' | 'aguardando_aprovacao' | 'aprovado' | 'agendado'
  | 'publicando' | 'publicado' | 'publicado_parcial' | 'falhou' | 'cancelado';

export type TipoPeca = 'imagem' | 'carrossel' | 'reel' | 'story';

export interface PecaNoMes {
  id: string;
  itemId: string | null;
  titulo: string;
  tipo: TipoPeca;
  legenda: string;
  /** Dia e hora JÁ no fuso do cliente: quem converte é o banco. */
  dia: string;
  hora: string;
  statusPublicacao: StatusPublicacao;
  estadoAprovacao: EstadoAprovacao;
  erro: string | null;
  contas: string[];
}

export interface PlanoDeConteudo {
  clienteServicoId: string;
  /** 0 = domingo … 6 = sábado, como o `extract(dow)` do Postgres. */
  diasSemana: number[];
  horario: string;
  postsPorMes: number;
  reelsPorMes: number;
  cota: number;
}

export interface MesDeConteudo {
  mes: string;
  fusoHorario: string;
  pecas: PecaNoMes[];
  plano: PlanoDeConteudo | null;
  noMes: number;
  esperandoCliente: number;
  comAjustes: number;
  publicadas: number;
  falhas: number;
}

// --- acessos (migration 0031 + Edge Function `convidar`) ---------------------

export interface PessoaDaEquipe {
  userId: string;
  nome: string | null;
  email: string | null;
  papel: PapelEquipe;
  cargo: string | null;
  ativo: boolean;
  desativadoEm: string | null;
}

export interface ConviteAberto {
  id: string;
  destino: 'equipe' | 'cliente';
  email: string;
  nome: string | null;
  papel: PapelEquipe | null;
  cargo: string | null;
  clienteId: string | null;
  clienteNome: string | null;
  papelCliente: PapelCliente | null;
  criadoEm: string;
}

export interface EquipeEConvites {
  pessoas: PessoaDaEquipe[];
  convites: ConviteAberto[];
  souAdmin: boolean;
}

/** O corpo que a Edge Function `convidar` espera. */
export type PedidoDeConvite =
  | { destino: 'equipe'; email: string; nome?: string; papel: PapelEquipe; cargo?: string }
  | {
      destino: 'cliente';
      email: string;
      nome?: string;
      clienteId: string;
      papelCliente: PapelCliente;
    };

// --- compositor (migration 0046) -------------------------------------------

export interface PublicacaoNova {
  clienteId: string;
  titulo: string;
  tipo: TipoPeca;
  legenda: string;
  hashtags: string;
  /** Hashtags no primeiro comentário, para a legenda ficar limpa no feed. */
  noComentario: boolean;
  /** Vazio = todas as contas ativas do cliente, que é o caso da maioria. */
  contas: string[];
}

export interface Publicacao extends PublicacaoNova {
  id: string;
  quando: string | null;
  status: StatusPublicacao;
  erro: string | null;
  midias: MidiaDaPeca[];
}

// --- mídia da peça (migration 0045) ----------------------------------------

export interface MidiaDaPeca {
  id: string;
  ordem: number;
  /** O caminho no bucket privado. Endereço assinado vem em `url`. */
  caminho: string;
  mime: string;
  bytes: number | null;
  /** Nulo quando a assinatura falhou: a tela mostra o lugar, não um ícone roto. */
  url?: string | null;
}

// --- contas sociais (migration 0044) ---------------------------------------

export interface ContaSocial {
  id: string;
  plataforma: 'instagram' | 'facebook';
  nome: string;
  igUserId: string | null;
  pageId: string | null;
  ativo: boolean;
  acessoParceiro: 'concedido' | 'pendente' | 'expirado';
  tokenProprio: boolean;
  /** A única pergunta que importa na tela: dá para publicar nesta conta? */
  prontaParaPublicar: boolean;
}

/**
 * Um canal: UMA conta em UM formato (migration 0055).
 *
 * É a unidade da escolha no compositor, e existe porque perguntar "formato?" e
 * "onde publica?" separado deixava montar combinação impossível — Reel numa
 * Página do Facebook, que não tem adaptador. O banco responde a pergunta
 * inteira, com o motivo quando o canal não publica.
 */
export interface Canal {
  contaId: string;
  conta: string;
  plataforma: 'instagram' | 'facebook';
  tipo: TipoPeca;
  publicavel: boolean;
  /** Preenchido sempre que `publicavel` é falso: chip apagado sem motivo é o pior. */
  motivo: string | null;
  minimo: number;
  maximo: number;
  natureza: 'imagem' | 'video' | 'imagem_ou_video';
}

/**
 * O que saiu junto quando um cliente é apagado (0060).
 *
 * Serve para a tela confirmar com número. "Cliente apagado" sem contagem não
 * dá para conferir — e apagar cliente não tem desfazer.
 */
export interface ResumoDaRemocao {
  nome: string;
  publicacoes: number;
  aprovacoes: number;
  lancamentos: number;
  captacoes: number;
  contas: number;
  documentos: number;
  /** Arquivos que saíram dos baldes, não linhas do banco. */
  arquivosApagados: number;
}

/** O que a Meta devolve quando perguntamos o que o token alcança. */
export interface ContaDescoberta {
  pageId: string;
  pageName: string;
  igUserId: string | null;
  igUsername: string | null;
}

/**
 * A saúde do token da Meta, perguntada a ela (migration 0048).
 *
 * Existe porque "chave cadastrada" e "chave que funciona" são coisas
 * diferentes, e a plataforma só sabia a primeira. O token de usuário que o
 * Graph API Explorer entrega vive uma ou duas horas: funciona no teste e morre
 * antes do primeiro post agendado.
 */
export interface SaudeDoToken {
  valido: boolean;
  /** Como a Meta chama: USER, SYSTEM_USER, PAGE… O que se quer é SYSTEM_USER. */
  tipo: string | null;
  /** Nulo quando o token não expira — que é o certo. */
  expiraEm: string | null;
  jaExpirou: boolean;
  escopos: string[];
  escoposFaltando: string[];
  appId: string | null;
  /**
   * Como a pergunta foi feita. `so_a_data` quer dizer que a Meta nem aceitou a
   * pergunta — o diagnóstico saiu do que o banco sabe, e não dela.
   */
  conferidoCom: 'app_token' | 'proprio_token' | 'so_a_data';
  /** Quando a chave entrou no Vault (0049). É metadado, nunca o valor. */
  cadastradaEm: string | null;
  /**
   * Sinalizadores de formato (0050) — nunca o valor nem parte dele. Separam
   * "o texto do token está quebrado" de "o token está morto": duas coisas com
   * dois consertos diferentes, que antes davam a mesma mensagem.
   */
  formato: FormatoDoToken | null;
  diagnostico: string;
  oQueFazer: string | null;
}

// --- arquivos do cliente (migrations 0053/0054) -----------------------------

export type TipoDocumento = 'proposta' | 'contrato' | 'outro';

export interface DocumentoDoCliente {
  id: string;
  tipo: TipoDocumento;
  nome: string;
  /** Caminho no bucket privado. Nunca URL pública. */
  caminho: string;
  /**
   * Contrato nasce visível; proposta e outro nascem fechados. Quem decide o
   * padrão é a função do banco, que sabe o tipo.
   */
  visivelAoCliente: boolean;
  enviadoEm: string;
  /** Endereço assinado, de validade curta. Nulo quando não deu para assinar. */
  url?: string | null;
}

export interface FormatoDoToken {
  cadastrada: boolean;
  tamanho?: number;
  pontasSujas?: boolean;
  temQuebraDeLinha?: boolean;
  temAspas?: boolean;
  /** Os sinais `<` e `>` do marcador de lugar ficaram no valor (0051). */
  temSinaisDeMarcador?: boolean;
  soCaracteresEsperados?: boolean;
  comecaComEAA?: boolean;
}

// --- conectores (migration 0043) --------------------------------------------

/**
 * Onde a chave mora. `vault` dá para conferir a presença pelo banco; `funcao`
 * vive nos secrets da Edge Function, fora do alcance de qualquer consulta —
 * e por isso `presente` vem nulo, não falso.
 */
export type OndeMoraChave = 'vault' | 'funcao';

export interface ChaveDeConector {
  chave: string;
  onde: OndeMoraChave;
  obrigatoria: boolean;
  paraQue: string;
  /** Nulo quando não dá para conferir daqui. Nunca traz o valor. */
  presente: boolean | null;
  /**
   * Quando a chave foi cadastrada ou trocada (0049). Data não é segredo, e é
   * o que separa "está lá" de "está lá desde quando" — uma chave trocada hoje
   * e já recusada pela Meta conta uma história que o `●` sozinho não conta.
   */
  atualizadaEm?: string | null;
}

export interface Conector {
  id: string;
  nome: string;
  paraQue: string;
  /** Falso enquanto só existe o schema: o que falta é código, não chave. */
  construida: boolean;
  ordem: number;
  chaves: ChaveDeConector[];
  faltando: string[];
  agendador: { publicar: boolean; renovar: boolean } | null;
}

// --- galeria própria (migrations 0034/0035) ---------------------------------

export type TipoMidia = 'foto' | 'video';

export interface ItemGaleria {
  id: string;
  tipo: TipoMidia;
  nome: string;
  /** URL assinada da miniatura. Curta: a página pede de novo quando recarrega. */
  miniatura: string | null;
  poster: string | null;
  largura: number | null;
  altura: number | null;
  duracao: number | null;
  bytes: number | null;
}

/** O que a página do link sem conta recebe. */
export interface Album {
  titulo: string;
  recado: string | null;
  cliente: string | null;
  quando: string | null;
  permiteDownload: boolean;
  /** URL assinada da capa escolhida (0057). Nula cai na primeira foto. */
  capa: string | null;
  /** Para a equipe saber qual foto está marcada como capa hoje. */
  capaItemId: string | null;
  favoritos: string[];
  itens: ItemGaleria[];
}

export interface LinkGaleria {
  id: string;
  criadoEm: string;
  acessos: number;
  ultimoAcessoEm: string | null;
}

export interface GaleriaNaLista {
  id: string;
  titulo: string;
  sessaoId: string;
  quando: string;
  local: string | null;
  provedor: 'drive' | 'pixieset' | 'storage' | 'outro';
  url: string | null;
  permiteDownload: boolean;
  publicadaEm: string | null;
  /** Preenchido = fora do ar: o link não abre e o cliente não vê (0058). */
  arquivadaEm: string | null;
  capa: string | null;
  capaItemId: string | null;
  fotos: number;
  videos: number;
  bytes: number;
  favoritos: number;
  baixou: boolean;
  links: LinkGaleria[];
}

/** Um arquivo subindo, do jeito que a tela mostra. */
export interface EnvioEmCurso {
  id: string;
  nome: string;
  bytes: number;
  tipo: TipoMidia;
  progresso: number;
  erro: string | null;
  pronto: boolean;
}

// --- as telas que faltavam (migrations 0036/0037) ---------------------------

export type SituacaoLancamento = 'previsto' | 'atrasado' | 'recebido' | 'pago' | 'cancelado';

export interface LancamentoNaLista {
  id: string;
  descricao: string;
  clienteNome: string | null;
  clienteId: string | null;
  natureza: 'receita' | 'custo' | 'investimento' | 'imposto';
  grupo: string;
  categoria: string;
  subcategoria: string;
  valorCentavos: number;
  vencimento: string | null;
  situacao: SituacaoLancamento;
  forma: string | null;
  /** Só aparece enquanto ninguém confirmou a sugestão da IA. */
  sugestao: string | null;
}

export interface PainelFinanceiro {
  mes: string;
  receitaCentavos: number;
  custoCentavos: number;
  recebidoCentavos: number;
  atrasadoCentavos: number;
  lancamentos: LancamentoNaLista[];
  porCliente: { clienteId: string; clienteNome: string; receitaCentavos: number; atrasadoCentavos: number }[];
}

export interface ContaDoCliente {
  id: string;
  descricao: string;
  valorCentavos: number;
  vencimento: string | null;
  competencia: string;
  situacao: SituacaoLancamento;
  boletoUrl: string | null;
  pix: string | null;
}

export interface FinanceiroDoCliente {
  aVencerCentavos: number;
  atrasadoCentavos: number;
  pagoNoAnoCentavos: number;
  lancamentos: ContaDoCliente[];
}

export interface AlvoDaPeca {
  conta: string;
  plataforma: string;
  estado: string;
  erro: string | null;
  tentativas: number;
}

export interface PecaNaFila {
  id: string;
  clienteId: string;
  clienteNome: string;
  titulo: string;
  tipo: TipoPeca;
  status: StatusPublicacao;
  quando: string | null;
  erro: string | null;
  alvos: AlvoDaPeca[];
}

export interface EventoNaAgenda {
  tipo: 'publicacao' | 'captacao' | 'marco' | 'cobranca';
  quando: string;
  clienteId: string;
  clienteNome: string;
  oQue: string;
  detalhe: string;
}

export interface ItemDoGrid {
  id: string;
  titulo: string;
  tipo: TipoPeca;
  status: StatusPublicacao;
  estado: EstadoAprovacao;
  quando: string | null;
  capa: string | null;
}

export interface ResumoNps {
  respostas: number;
  promotores: number;
  neutros: number;
  detratores: number;
  nps: number | null;
  ultimas: {
    nota: number; comentario: string | null; quem: string | null;
    quando: string; clienteNome: string | null; clienteId: string | null;
  }[];
  semResposta: { clienteNome: string; competencia: string }[];
}

export interface NpsDoCliente {
  pendente: { id: string; competencia: string } | null;
  respondidas: { competencia: string; nota: number; comentario: string | null; quando: string }[];
}

export type EtapaLead =
  | 'novo_lead' | 'pronto_abordar' | 'aguardando_aprovacao' | 'aguardando_edicao'
  | 'contato_feito' | 'em_conversa' | 'qualificado' | 'reuniao_agendada'
  | 'proposta_enviada' | 'negociacao' | 'fechado' | 'perdido' | 'descartado';

export interface LeadNoFunil {
  id: string;
  nome: string;
  empresa: string | null;
  etapa: EtapaLead;
  valorCentavos: number | null;
  origem: string | null;
  proximoPasso: string | null;
  proximoEm: string | null;
  responsavelNome: string | null;
  ultimaEm: string | null;
}

export interface Funil {
  abertos: number;
  valorAbertoCentavos: number;
  fechadosNoMes: number;
  leads: LeadNoFunil[];
}

export interface RelatorioDeCampanha {
  id: string;
  de: string;
  ate: string;
  /** O nome que aparece na tela. */
  arquivo: string | null;
  /**
   * O caminho no bucket (0054). Serve para a URL assinada e nada mais — sem
   * ele o relatório era um texto que ninguém conseguia abrir.
   */
  arquivoCaminho?: string | null;
  metricas: { rotulo: string; valor: number }[];
  campanhas: {
    nome: string; plataforma: string; objetivo: string | null;
    verbaCentavos: number | null; resultadoRotulo: string | null; resultadoValor: number | null;
  }[];
}

export interface AmbientesDoCliente {
  ambientes: {
    id: string; nome: string; url: string | null; hospedagem: string | null;
    sslRenovaEm: string | null; noAr: boolean;
  }[];
  dominios: { dominio: string; registrador: string | null; titular: string | null; venceEm: string | null }[];
  chamados: { id: string; titulo: string; prioridade: string; status: string; abertoEm: string }[];
}

// --- aprovar sem conta (migration 0041) -------------------------------------

export interface ItemDoLote {
  id: string;
  tipo: TipoItem;
  titulo: string;
  estado: EstadoAprovacao;
  respondidoPor: string | null;
  respondidoEm: string | null;
  comentario: string | null;
}

/** O que a página do link mostra. Nada aqui depende de ter conta. */
export interface LoteDoLink {
  cliente: string;
  mensagem: string | null;
  quando: string;
  /** Todos os itens respondidos: o link vira leitura, sem botão nenhum. */
  fechado: boolean;
  itens: ItemDoLote[];
}

export interface LinkDeAprovacao {
  id: string;
  criadoEm: string;
  acessos: number;
  ultimoAcessoEm: string | null;
}

/** Um lote enviado, do lado da equipe: quantos responderam e se abriram. */
export interface EnvioNaFicha {
  id: string;
  mensagem: string | null;
  quando: string;
  fechadoEm: string | null;
  itens: number;
  respondidos: number;
  links: LinkDeAprovacao[];
}
