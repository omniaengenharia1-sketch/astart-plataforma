// =============================================================================
// Como cada chave do banco aparece na tela. Um lugar so: rotulo escrito na mao
// em cada tela viraria "Gestao Digital" numa e "Gestão digital" na outra.
// =============================================================================
import type {
  ChaveModulo, EstadoEntregavel, FormatoContrato,
  PapelCliente, StatusServico, TipoItem,
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
