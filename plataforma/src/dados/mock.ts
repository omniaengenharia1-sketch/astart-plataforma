// =============================================================================
// Dados de exemplo. Servem para a plataforma abrir e ser navegada antes de o
// Supabase existir — e so isso. Nada aqui e lido quando ha conexao.
// =============================================================================
import type { Cliente, PainelCliente, PainelEquipe, Perfil, Sessao } from './tipos';

const hoje = new Date().toISOString().slice(0, 10);
const emDias = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export const PERFIL_EXEMPLO: Perfil = {
  userId: 'exemplo-layana',
  nome: 'Layana',
  email: 'layana@astartstudio.com.br',
  papel: 'operacao',
  cargo: 'Social Media',
  ativo: true,
};

export const CLIENTE_EXEMPLO: Cliente = {
  id: 'exemplo-mor',
  nome: 'Mor Marcas',
  slug: 'mor-marcas',
  fusoHorario: 'America/Sao_Paulo',
  ativo: true,
};

export const SESSAO_EQUIPE: Sessao = { tipo: 'equipe', perfil: PERFIL_EXEMPLO };

export const SESSAO_CLIENTE: Sessao = {
  tipo: 'cliente',
  nome: 'Bruna Melo',
  email: 'bruna@mormarcas.com.br',
  clientes: [CLIENTE_EXEMPLO],
  clienteAtual: CLIENTE_EXEMPLO,
};

export const PAINEL_EQUIPE: PainelEquipe = {
  hoje,
  esperandoCliente: 7,
  vencidoCentavos: 320000,
  pendencias: [
    {
      id: 'p1', clienteId: 'exemplo-mor', clienteNome: 'Mor Marcas',
      oQue: 'Peça voltou com ajuste: Como a peça é feita',
      quando: emDias(-1), rota: 'grid', acao: 'Abrir', urgente: true,
    },
    {
      id: 'p2', clienteId: 'exemplo-mor', clienteNome: 'Mor Marcas',
      oQue: 'Entregável parado em produção: Layout desktop',
      quando: emDias(-4), rota: 'entregaveis', acao: 'Abrir', urgente: true,
    },
    {
      id: 'p3', clienteId: 'exemplo-pub', clienteNome: 'Publika.ai',
      oQue: 'Publicação falhou: O token do Instagram venceu.',
      quando: emDias(-1), rota: 'fila', acao: 'Resolver', urgente: true,
    },
    {
      id: 'p4', clienteId: 'exemplo-kb', clienteNome: 'Karla Bernardo',
      oQue: 'Cobrança vencida: Branding — entrada',
      quando: emDias(-3), rota: 'financeiro', acao: 'Cobrar', urgente: true,
    },
    {
      id: 'p5', clienteId: 'exemplo-pam', clienteNome: 'Pamela Dantas',
      oQue: 'NPS nota 4 — “demora pra responder no WhatsApp”',
      quando: emDias(-5), rota: 'feedbacks', acao: 'Ver', urgente: true,
    },
  ],
  saiHoje: [
    { id: 's1', hora: '09:00', clienteNome: 'Chopp do Barbudo', tipo: 'imagem' },
    { id: 's2', hora: '12:00', clienteNome: 'Mor Marcas', tipo: 'reel' },
    { id: 's3', hora: '15:30', clienteNome: 'Publika.ai', tipo: 'carrossel' },
    { id: 's4', hora: '18:00', clienteNome: 'Omnia Engenharia', tipo: 'imagem' },
  ],
  semana: [
    { id: 'w1', data: emDias(1), titulo: 'Captação: na fábrica', responsavelNome: 'Beatriz' },
    { id: 'w2', data: emDias(4), titulo: 'Entrega do Layout mobile', responsavelNome: 'Viviane' },
    { id: 'w3', data: emDias(7), titulo: 'Fechar novembro de 4 clientes', responsavelNome: 'Layana' },
  ],
};

export const PAINEL_CLIENTE: PainelCliente = {
  cliente: CLIENTE_EXEMPLO,
  modulos: [
    'calendario', 'grid', 'publicacao', 'galeria', 'marcos', 'entregaveis',
    'acervo', 'ambientes', 'manutencao', 'financeiro', 'contrato', 'nps',
  ],
  paraAprovar: [
    {
      id: 'i1', clienteId: 'exemplo-mor', clienteNome: 'Mor Marcas', tipo: 'peca',
      estado: 'em_aprovacao', titulo: 'Making of da campanha',
      enviadoEm: hoje, respondidoEm: null, respondidoPor: null,
    },
    {
      id: 'i2', clienteId: 'exemplo-mor', clienteNome: 'Mor Marcas', tipo: 'peca',
      estado: 'em_aprovacao', titulo: 'Frase da semana',
      enviadoEm: hoje, respondidoEm: null, respondidoPor: null,
    },
    {
      id: 'i3', clienteId: 'exemplo-mor', clienteNome: 'Mor Marcas', tipo: 'peca',
      estado: 'em_aprovacao', titulo: 'Perguntas que mais recebemos',
      enviadoEm: hoje, respondidoEm: null, respondidoPor: null,
    },
    {
      id: 'i4', clienteId: 'exemplo-mor', clienteNome: 'Mor Marcas', tipo: 'entregavel',
      estado: 'em_aprovacao', titulo: 'Layout mobile',
      enviadoEm: emDias(-1), respondidoEm: null, respondidoPor: null,
    },
  ],
  proximaCobranca: {
    id: 'c1', descricao: 'Gestão Digital — outubro',
    valorCentavos: 280000, vencimento: emDias(3), situacao: 'previsto',
  },
  npsPendente: true,
  redes: { publicados: 5, agendados: 1, esperandoVoce: 3, emProducao: 3 },
  projeto: {
    servicoNome: 'Website', total: 11, entregues: 2,
    fase: 'Design', proximo: 'Layout mobile',
  },
  captacao: {
    proximaData: emDias(1), proximoTitulo: 'Captação na fábrica',
    ultimaTitulo: 'Captação de setembro', ultimaFotos: 44, ultimaVideos: 6,
  },
};
