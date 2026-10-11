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
