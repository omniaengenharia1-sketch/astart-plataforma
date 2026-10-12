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
  /** Centavos. Nunca float: centavo perdido em cobranca vira ligacao de cliente. */
  valorCentavos: number;
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
  vencidoCentavos: number;
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
  mensalCentavos: number;
  unicoCentavos: number;
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
  mensalCentavos: number;
  unicoCentavos: number;
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

export type StatusPublicacao =
  | 'rascunho' | 'aguardando_aprovacao' | 'aprovado' | 'agendado'
  | 'publicando' | 'publicado' | 'falhou' | 'cancelado';

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
  capa: string | null;
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
  arquivo: string | null;
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
