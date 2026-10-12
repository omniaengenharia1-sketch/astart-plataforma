// =============================================================================
// Como cada chave do banco aparece na tela. Um lugar so: rotulo escrito na mao
// em cada tela viraria "Gestao Digital" numa e "Gestão digital" na outra.
// =============================================================================
import type {
  ChaveModulo, EstadoEntregavel, EtapaLead, FormatoContrato,
  PapelCliente, SituacaoLancamento, StatusPublicacao, StatusServico, TipoItem, TipoPeca,
} from './dados/tipos';

export const MODULO: Record<ChaveModulo, string> = {
  marcos: 'Marcos',
  entregaveis: 'Entregáveis',
  acervo: 'Acervo',
  galeria: 'Galeria',
  calendario: 'Calendário',
  grid: 'Grid',
  publicacao: 'Publicação',
  campanhas: 'Campanhas',
  ambientes: 'Ambientes e acessos',
  manutencao: 'Manutenção',
  integracoes: 'Integrações',
  financeiro: 'Financeiro',
  contrato: 'Contrato',
  nps: 'Feedbacks e NPS',
};

export const FORMATO: Record<FormatoContrato, string> = {
  recorrente: 'por mês',
  projeto: 'projeto',
  pontual: 'pontual',
};

export const STATUS_SERVICO: Record<StatusServico, string> = {
  ativo: 'ativo',
  pausado: 'pausado',
  encerrado: 'encerrado',
};

export const ESTADO: Record<EstadoEntregavel, string> = {
  a_fazer: 'a fazer',
  produzindo: 'produzindo',
  em_aprovacao: 'esperando o cliente',
  com_ajustes: 'pediu ajuste',
  aprovado: 'aprovado',
  declinado: 'declinado',
};

/** Como o próprio cliente lê o mesmo estado, do lado dele do portal. */
export const ESTADO_CLIENTE: Record<EstadoEntregavel, string> = {
  // "a fazer" é linguagem de quem produz. Para o cliente, o que importa é que
  // ninguém está esperando nada dele ali — e dizer "em produção" o que ainda
  // nem começou seria mentira pequena, do tipo que cobra caro depois.
  a_fazer: 'ainda não começou',
  produzindo: 'em produção',
  em_aprovacao: 'esperando você',
  com_ajustes: 'ajuste pedido',
  aprovado: 'aprovado',
  declinado: 'declinado',
};

export const TIPO_ITEM: Record<TipoItem, string> = {
  peca: 'peça',
  entregavel: 'entregável',
};

export const PAPEL_CLIENTE: Record<PapelCliente, string> = {
  principal: 'contato principal',
  financeiro: 'financeiro',
  leitura: 'só leitura',
};

export const TIPO_PECA: Record<TipoPeca, string> = {
  imagem: 'imagem',
  carrossel: 'carrossel',
  reel: 'reel',
  story: 'story',
};

/** O que está acontecendo com a publicação, do lado de quem produz. */
export const STATUS_PUBLICACAO: Record<StatusPublicacao, string> = {
  rascunho: 'rascunho',
  aguardando_aprovacao: 'no cliente',
  aprovado: 'aprovada',
  agendado: 'agendada',
  publicando: 'saindo agora',
  publicado: 'no ar',
  falhou: 'falhou',
  cancelado: 'cancelada',
};

/**
 * A mesma cobrança tem dois nomes: "recebido" é o que a Astart vê, "pago" é o
 * que o cliente vê. No banco são estados diferentes (receita e custo), e por
 * isso os dois existem aqui.
 */
export const SITUACAO: Record<SituacaoLancamento, string> = {
  previsto: 'a vencer',
  atrasado: 'atrasado',
  recebido: 'recebido',
  pago: 'pago',
  cancelado: 'cancelado',
};

/** Como o cliente lê a própria conta. */
export const SITUACAO_CLIENTE: Record<SituacaoLancamento, string> = {
  previsto: 'a vencer',
  atrasado: 'vencido',
  recebido: 'pago',
  pago: 'pago',
  cancelado: 'cancelado',
};

export const ETAPA_LEAD: Record<EtapaLead, string> = {
  novo_lead: 'novo',
  pronto_abordar: 'pronto para abordar',
  aguardando_aprovacao: 'esperando aprovação',
  aguardando_edicao: 'esperando edição',
  contato_feito: 'contato feito',
  em_conversa: 'em conversa',
  qualificado: 'qualificado',
  reuniao_agendada: 'reunião marcada',
  proposta_enviada: 'proposta enviada',
  negociacao: 'negociando',
  fechado: 'fechado',
  perdido: 'perdido',
  descartado: 'descartado',
};

/** As etapas na ordem do funil, como a tela empilha as colunas. */
export const ETAPAS_ABERTAS: EtapaLead[] = [
  'novo_lead', 'pronto_abordar', 'contato_feito', 'em_conversa', 'qualificado',
  'reuniao_agendada', 'proposta_enviada', 'negociacao',
];

export const NATUREZA: Record<string, string> = {
  receita: 'receita',
  custo: 'custo',
  investimento: 'investimento',
  imposto: 'imposto',
};

export const PRIORIDADE: Record<string, string> = {
  baixa: 'baixa',
  media: 'média',
  alta: 'alta',
  urgente: 'urgente',
};

export const STATUS_CHAMADO: Record<string, string> = {
  aberto: 'aberto',
  em_andamento: 'em andamento',
  esperando_cliente: 'esperando você',
  resolvido: 'resolvido',
  cancelado: 'cancelado',
};
