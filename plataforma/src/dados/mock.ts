// =============================================================================
// Dados de exemplo. Servem para a plataforma abrir e ser navegada antes de o
// Supabase existir — e so isso. Nada aqui e lido quando ha conexao.
//
// Uma coisa importante: os itens de aprovacao moram num unico array mutavel,
// como moram numa unica tabela no banco. Quando o cliente aprova no portal, a
// fila da equipe e a lista de clientes mudam juntas. Exemplo em que cada tela
// tem a sua propria verdade engana quem esta avaliando o fluxo.
// =============================================================================
import type {
  Canal, Catalogo, ChaveModulo, ChaveServico, Cliente, ClienteNaLista, ClienteNovo, Conector,
  ContaDescoberta, ContaSocial, Decisao, Publicacao, PublicacaoNova,
  Album, AmbientesDoCliente, ConviteAberto, EntregavelNoProjeto, EquipeEConvites, EtapaLead,
  EventoNaAgenda, FichaCliente, FinanceiroDoCliente, FormatoContrato, Funil,
  GaleriaNaLista, ItemDoGrid, ItemGaleria,
  EnvioNaFicha, ItemDoLote, ItemNaFila, LancamentoNaLista, LeadNoFunil, LinkDeAprovacao,
  LoteDoLink, MesDeConteudo, NpsDoCliente, PainelCliente,
  PainelEquipe, PainelFinanceiro, PecaNaFila, PecaNoMes, Perfil,
  DocumentoDoCliente, TipoDocumento,
  PapelEquipe, PedidoDeConvite, PessoaDaEquipe, RelatorioDeCampanha, ResumoNps, SaudeDoToken,
  ServicoContratado, ServicoEscolhido, ServicoNoProjeto,
  Sessao, SituacaoLancamento, StatusPublicacao, TipoPeca,
} from './tipos';

import { CANAIS, FORMATOS, ORDEM_FORMATOS } from './formatos';
import { sluguificar } from '../formato';
import { publico } from '../publico';

const hoje = new Date().toISOString().slice(0, 10);
const emDias = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const haHoras = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

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

/**
 * A dona da agencia. Existe porque a Layana e operacao: sem uma persona de
 * admin, o modo exemplo nao teria como mostrar o Financeiro, o Comercial nem a
 * troca de papel — e quem esta avaliando concluiria que as telas nao existem.
 */
export const PERFIL_DONO: Perfil = {
  userId: 'exemplo-viviane',
  nome: 'Viviane',
  email: 'viviane@astartstudio.com.br',
  papel: 'admin',
  cargo: 'Direção',
  ativo: true,
};

export const SESSAO_EQUIPE: Sessao = { tipo: 'equipe', perfil: PERFIL_EXEMPLO };
export const SESSAO_DONO: Sessao = { tipo: 'equipe', perfil: PERFIL_DONO };

/**
 * Qual persona esta aberta. Espelha a 0039 no modo exemplo: so admin e
 * financeiro veem valor, e o cliente ve o do proprio contrato. Com Supabase
 * ligado quem responde e o banco — aqui e so para a demonstracao nao mentir.
 */
let papelDaVez: 'admin' | 'operacao' | 'cliente' | null = null;

export function definirPapelExemplo(p: 'admin' | 'operacao' | 'cliente' | null): void {
  papelDaVez = p;
}

function veDinheiroExemplo(): boolean {
  return papelDaVez === 'admin' || papelDaVez === 'cliente';
}

export const SESSAO_CLIENTE: Sessao = {
  tipo: 'cliente',
  nome: 'Bruna Melo',
  email: 'bruna@mormarcas.com.br',
  clientes: [CLIENTE_EXEMPLO],
  clienteAtual: CLIENTE_EXEMPLO,
};

// ---------------------------------------------------------------------------
// A matriz servico -> modulo, espelhada da migration 0014 so para o modo
// exemplo. Com Supabase ligado quem responde e o banco, via cliente_tem_modulo.
// ---------------------------------------------------------------------------
const SEMPRE: ChaveModulo[] = ['financeiro', 'contrato', 'nps'];

const MATRIZ: Record<ChaveServico, ChaveModulo[]> = {
  branding: ['marcos', 'entregaveis', 'acervo'],
  identidade_visual: ['marcos', 'entregaveis', 'acervo'],
  audiovisual: ['marcos', 'entregaveis', 'acervo', 'galeria'],
  website: ['marcos', 'entregaveis', 'acervo', 'ambientes', 'manutencao'],
  sistemas: ['marcos', 'entregaveis', 'acervo', 'integracoes', 'manutencao'],
  gestao_digital: ['calendario', 'grid', 'publicacao'],
};

const ORDEM_MODULOS: ChaveModulo[] = [
  'marcos', 'entregaveis', 'acervo', 'galeria', 'calendario', 'grid',
  'publicacao', 'campanhas', 'ambientes', 'manutencao', 'integracoes',
  'financeiro', 'contrato', 'nps',
];

function modulosDe(servicos: ServicoContratado[], extras: ChaveModulo[] = []): ChaveModulo[] {
  const ligados = new Set<ChaveModulo>([...SEMPRE, ...extras]);
  for (const s of servicos.filter((x) => x.status === 'ativo')) {
    for (const m of MATRIZ[s.servico]) ligados.add(m);
  }
  return ORDEM_MODULOS.filter((m) => ligados.has(m));
}

// ---------------------------------------------------------------------------
// Os clientes de exemplo, com contrato
// ---------------------------------------------------------------------------
interface ClienteExemplo {
  cliente: Cliente;
  servicos: ServicoContratado[];
  /** Chaves opcionais da matriz ligadas no contrato. */
  extras?: ChaveModulo[];
  contatos: FichaCliente['contatos'];
}

let seq = 0;
function srv(
  clienteId: string,
  servico: ChaveServico,
  servicoNome: string,
  formato: ServicoContratado['formato'],
  valorCentavos: number,
  resto: Partial<ServicoContratado> = {},
): ServicoContratado {
  seq += 1;
  return {
    id: `cs-${seq}`,
    clienteId,
    servico,
    servicoNome,
    formato,
    status: 'ativo',
    responsavelNome: null,
    valorCentavos,
    diaVencimento: formato === 'recorrente' ? 10 : null,
    parcelas: formato === 'recorrente' ? null : 1,
    inicio: emDias(-120),
    entregaEm: null,
    ...resto,
  };
}

const CLIENTES: ClienteExemplo[] = [
  {
    cliente: CLIENTE_EXEMPLO,
    servicos: [
      srv('exemplo-mor', 'gestao_digital', 'Gestão Digital', 'recorrente', 280000, {
        responsavelNome: 'Layana', diaVencimento: 10,
      }),
      srv('exemplo-mor', 'website', 'Website', 'projeto', 1200000, {
        responsavelNome: 'Viviane', parcelas: 3, entregaEm: emDias(38),
      }),
    ],
    extras: ['galeria'],
    contatos: [
      { userId: 'u-bruna', nome: 'Bruna Melo', email: 'bruna@mormarcas.com.br',
        papel: 'principal', ativo: true },
      { userId: 'u-ricardo', nome: 'Ricardo Mor', email: 'financeiro@mormarcas.com.br',
        papel: 'financeiro', ativo: true },
    ],
  },
  {
    cliente: { id: 'exemplo-pub', nome: 'Publika.ai', slug: 'publika-ai', fusoHorario: 'America/Sao_Paulo', ativo: true },
    servicos: [
      srv('exemplo-pub', 'gestao_digital', 'Gestão Digital', 'recorrente', 320000, {
        responsavelNome: 'Layana', diaVencimento: 5,
      }),
    ],
    extras: ['campanhas'],
    contatos: [
      { userId: 'u-thiago', nome: 'Thiago Prado', email: 'thiago@publika.ai', papel: 'principal', ativo: true },
    ],
  },
  {
    cliente: { id: 'exemplo-chopp', nome: 'Chopp do Barbudo', slug: 'chopp-do-barbudo', fusoHorario: 'America/Sao_Paulo', ativo: true },
    servicos: [
      srv('exemplo-chopp', 'gestao_digital', 'Gestão Digital', 'recorrente', 190000, {
        responsavelNome: 'Layana', diaVencimento: 15,
      }),
      srv('exemplo-chopp', 'audiovisual', 'Audiovisual', 'pontual', 240000, {
        responsavelNome: 'Beatriz', parcelas: 2,
      }),
    ],
    contatos: [
      { userId: 'u-ana', nome: 'Ana Paula', email: 'ana@choppdobarbudo.com.br', papel: 'principal', ativo: true },
    ],
  },
  {
    cliente: { id: 'exemplo-kb', nome: 'Karla Bernardo', slug: 'karla-bernardo', fusoHorario: 'America/Sao_Paulo', ativo: true },
    servicos: [
      srv('exemplo-kb', 'branding', 'Branding', 'projeto', 950000, {
        responsavelNome: 'Viviane', parcelas: 4, entregaEm: emDias(55),
      }),
    ],
    contatos: [
      { userId: 'u-karla', nome: 'Karla Bernardo', email: 'contato@karlabernardo.com', papel: 'principal', ativo: true },
    ],
  },
  {
    cliente: { id: 'exemplo-omnia', nome: 'Omnia Engenharia', slug: 'omnia-engenharia', fusoHorario: 'America/Sao_Paulo', ativo: true },
    servicos: [
      srv('exemplo-omnia', 'website', 'Website', 'projeto', 1800000, {
        responsavelNome: 'Viviane', parcelas: 3, entregaEm: emDias(12),
      }),
      srv('exemplo-omnia', 'sistemas', 'Sistemas', 'projeto', 2400000, {
        responsavelNome: 'Viviane', parcelas: 6, entregaEm: emDias(90),
      }),
    ],
    contatos: [
      { userId: 'u-marcos', nome: 'Marcos Lopes', email: 'marcos@omniaengenharia.com.br', papel: 'principal', ativo: true },
    ],
  },
  {
    cliente: { id: 'exemplo-pam', nome: 'Pamela Dantas', slug: 'pamela-dantas', fusoHorario: 'America/Sao_Paulo', ativo: true },
    servicos: [
      srv('exemplo-pam', 'identidade_visual', 'Identidade Visual', 'pontual', 420000, {
        responsavelNome: 'Viviane', parcelas: 2, status: 'pausado',
      }),
    ],
    contatos: [
      { userId: 'u-pamela', nome: 'Pamela Dantas', email: 'pamela@pameladantas.com', papel: 'principal', ativo: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Os itens de aprovacao — a tabela mutavel
// ---------------------------------------------------------------------------
function item(
  id: string, clienteId: string, titulo: string,
  resto: Partial<ItemNaFila> = {},
): ItemNaFila {
  const nome = CLIENTES.find((c) => c.cliente.id === clienteId)?.cliente.nome ?? '';
  return {
    id, clienteId, clienteNome: nome, tipo: 'peca', estado: 'em_aprovacao',
    titulo, enviadoEm: haHoras(6), respondidoEm: null, respondidoPor: null,
    comentario: null, ...resto,
  };
}

const ITENS: ItemNaFila[] = [
  item('i1', 'exemplo-mor', 'Making of da campanha', { enviadoEm: haHoras(30) }),
  item('i2', 'exemplo-mor', 'Frase da semana', { enviadoEm: haHoras(28) }),
  item('i3', 'exemplo-mor', 'Perguntas que mais recebemos', { enviadoEm: haHoras(27) }),
  item('i4', 'exemplo-mor', 'Layout mobile', { tipo: 'entregavel', enviadoEm: haHoras(20) }),
  item('i5', 'exemplo-mor', 'Como a peça é feita', {
    estado: 'com_ajustes', enviadoEm: haHoras(72), respondidoEm: haHoras(26),
    respondidoPor: 'Bruna Melo',
    comentario: 'Trocar a foto do primeiro quadro, o produto saiu escuro.',
  }),
  item('i6', 'exemplo-pub', 'Carrossel do lançamento', { enviadoEm: haHoras(9) }),
  item('i7', 'exemplo-pub', 'Relatório de setembro', { tipo: 'entregavel', enviadoEm: haHoras(50) }),
  item('i8', 'exemplo-chopp', 'Reels da fábrica', { enviadoEm: haHoras(4) }),
  item('i9', 'exemplo-kb', 'Painel semântico', {
    tipo: 'entregavel', estado: 'com_ajustes', enviadoEm: haHoras(96),
    respondidoEm: haHoras(48), respondidoPor: 'Karla Bernardo',
    comentario: 'Gostei do segundo caminho, mas quero ver sem o serifado.',
  }),
  item('i10', 'exemplo-omnia', 'Wireframe da home', {
    tipo: 'entregavel', estado: 'aprovado', enviadoEm: haHoras(120),
    respondidoEm: haHoras(100), respondidoPor: 'Marcos Lopes',
  }),
  item('i11', 'exemplo-mor', 'Bastidores do estúdio', {
    estado: 'aprovado', enviadoEm: haHoras(60), respondidoEm: haHoras(52),
    respondidoPor: 'Bruna Melo',
  }),
  // Rascunho: no banco todo post nasce com item, pelo gatilho da 0019.
  item('i12', 'exemplo-mor', 'Depoimento da cliente', { estado: 'produzindo', enviadoEm: null }),
  // Aprovados que ainda vao sair: e deles que a fila de publicacao e feita.
  item('i13', 'exemplo-mor', 'Antes e depois do projeto', {
    estado: 'aprovado', enviadoEm: haHoras(40), respondidoEm: haHoras(31),
    respondidoPor: 'Bruna Melo',
  }),
  item('i14', 'exemplo-pub', 'Bastidores da reunião', {
    estado: 'aprovado', enviadoEm: haHoras(33), respondidoEm: haHoras(25),
    respondidoPor: 'Thiago Prado',
  }),
  item('i15', 'exemplo-chopp', 'Chopp do fim de semana', {
    estado: 'aprovado', enviadoEm: haHoras(29), respondidoEm: haHoras(20),
    respondidoPor: 'Ana Paula',
  }),
  item('i16', 'exemplo-pub', 'Dica rápida de copy', {
    estado: 'aprovado', enviadoEm: haHoras(70), respondidoEm: haHoras(60),
    respondidoPor: 'Thiago Prado',
  }),
];

const PESO: Record<string, number> = { com_ajustes: 0, em_aprovacao: 1 };

/** A fila da equipe: os dois estados abertos, o que precisa dela primeiro. */
export function filaExemplo(): ItemNaFila[] {
  return ITENS.filter((i) => i.estado === 'em_aprovacao' || i.estado === 'com_ajustes')
    .slice()
    .sort((a, b) => {
      const p = (PESO[a.estado] ?? 9) - (PESO[b.estado] ?? 9);
      return p !== 0 ? p : (a.enviadoEm ?? '').localeCompare(b.enviadoEm ?? '');
    });
}

export function itensDoCliente(clienteId: string): ItemNaFila[] {
  return ITENS.filter((i) => i.clienteId === clienteId && i.estado === 'em_aprovacao').slice()
    .sort((a, b) => (a.enviadoEm ?? '').localeCompare(b.enviadoEm ?? ''));
}

/** Mesma regra da funcao do banco: ajuste sem comentario nao passa. */
export function responderExemplo(
  itemId: string, decisao: Decisao, autor: string, comentario?: string,
): void {
  const i = ITENS.find((x) => x.id === itemId);
  if (!i) throw new Error('Item não encontrado.');
  if (i.estado !== 'em_aprovacao') {
    throw new Error(`Este item não está em aprovação (está em ${i.estado}).`);
  }
  if (decisao === 'com_ajustes' && !comentario?.trim()) {
    throw new Error('Pedido de ajuste exige um comentário dizendo o que mudar.');
  }
  i.estado = decisao;
  i.respondidoEm = new Date().toISOString();
  i.respondidoPor = autor;
  if (comentario?.trim()) i.comentario = comentario.trim();
}

// ---------------------------------------------------------------------------
// As listas, derivadas
// ---------------------------------------------------------------------------
const ativos = (c: ClienteExemplo) => c.servicos.filter((s) => s.status === 'ativo');
const soma = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

function mensalDe(c: ClienteExemplo): number | null {
  if (!veDinheiroExemplo()) return null;
  return soma(ativos(c).filter((s) => s.formato === 'recorrente').map((s) => s.valorCentavos ?? 0));
}
function unicoDe(c: ClienteExemplo): number | null {
  if (!veDinheiroExemplo()) return null;
  return soma(ativos(c).filter((s) => s.formato !== 'recorrente').map((s) => s.valorCentavos ?? 0));
}
function conta(clienteId: string, estado: string) {
  return ITENS.filter((i) => i.clienteId === clienteId && i.estado === estado).length;
}

export function listaClientesExemplo(): ClienteNaLista[] {
  return CLIENTES.map((c) => ({
    id: c.cliente.id,
    nome: c.cliente.nome,
    slug: c.cliente.slug,
    servicos: ativos(c).map((s) => s.servicoNome),
    responsaveis: [...new Set(ativos(c).map((s) => s.responsavelNome).filter((x): x is string => !!x))],
    precisaDeVoce: conta(c.cliente.id, 'com_ajustes'),
    esperandoCliente: conta(c.cliente.id, 'em_aprovacao'),
    mensalCentavos: mensalDe(c),
    unicoCentavos: unicoDe(c),
  })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

const VERBO: Record<string, string> = {
  aprovado: 'aprovou', com_ajustes: 'pediu ajuste em', declinado: 'declinou',
};

export function fichaExemplo(clienteId: string): FichaCliente | null {
  const c = CLIENTES.find((x) => x.cliente.id === clienteId);
  if (!c) return null;
  return {
    cliente: c.cliente,
    modulos: modulosDe(c.servicos, c.extras),
    // Mesmo corte da `contrato_valores()`: o servico fica, o preco sai.
    servicos: veDinheiroExemplo()
      ? c.servicos
      : c.servicos.map((s) => ({
          ...s, valorCentavos: null, diaVencimento: null, parcelas: null,
        })),
    contatos: c.contatos,
    pendencias: ITENS.filter((i) => i.clienteId === clienteId && i.estado === 'com_ajustes')
      .map((i) => ({ id: i.id, tipo: i.tipo, titulo: i.titulo, quando: i.respondidoEm })),
    movimentos: ITENS.filter((i) => i.clienteId === clienteId && i.respondidoEm)
      .slice()
      .sort((a, b) => (b.respondidoEm ?? '').localeCompare(a.respondidoEm ?? ''))
      .slice(0, 8)
      .map((i) => ({
        quando: i.respondidoEm ?? '',
        oQue: `${i.respondidoPor ?? 'O cliente'} ${VERBO[i.estado] ?? 'respondeu'} “${i.titulo}”`,
      })),
    mensalCentavos: mensalDe(c),
    unicoCentavos: unicoDe(c),
  };
}

// ---------------------------------------------------------------------------
// Os paineis
// ---------------------------------------------------------------------------
/**
 * O painel da equipe no modo exemplo. Funcao, nao constante: o cartao do
 * vencido e a pendencia de cobranca dependem de quem esta olhando.
 */
export function painelEquipeExemplo(): PainelEquipe {
  const dinheiro = veDinheiroExemplo();
  return {
    ...PAINEL_EQUIPE,
    vencidoCentavos: dinheiro ? PAINEL_EQUIPE.vencidoCentavos : null,
    // No banco quem tira esta linha e o RLS: a pendencia nasce de um
    // lancamento que a operacao nao alcanca.
    pendencias: PAINEL_EQUIPE.pendencias.filter((p) => dinheiro || p.rota !== 'financeiro'),
  };
}

export const PAINEL_EQUIPE: PainelEquipe = {
  hoje,
  esperandoCliente: 7,
  vencidoCentavos: 320000,
  pendencias: [
    {
      id: 'p1', clienteId: 'exemplo-mor', clienteNome: 'Mor Marcas',
      oQue: 'Peça voltou com ajuste: Como a peça é feita',
      quando: emDias(-1), rota: 'aprovacoes', acao: 'Abrir', urgente: true,
    },
    {
      id: 'p2', clienteId: 'exemplo-kb', clienteNome: 'Karla Bernardo',
      oQue: 'Entregável voltou com ajuste: Painel semântico',
      quando: emDias(-2), rota: 'aprovacoes', acao: 'Abrir', urgente: true,
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

/** Derivado dos itens, para o portal e a fila nunca discordarem. */
export function painelClienteExemplo(clienteId: string): PainelCliente {
  const ficha = fichaExemplo(clienteId) ?? fichaExemplo('exemplo-mor');
  const alvo = ficha?.cliente.id ?? 'exemplo-mor';
  return {
    cliente: ficha?.cliente ?? CLIENTE_EXEMPLO,
    modulos: ficha?.modulos ?? [],
    paraAprovar: itensDoCliente(alvo),
    proximaCobranca: {
      id: 'c1', descricao: 'Gestão Digital — outubro',
      valorCentavos: 280000, vencimento: emDias(3), situacao: 'previsto',
    },
    // Derivado do mesmo lugar que a aba Feedback le: se a tela do NPS diz que
    // nao ha nada pendente, o cartao do Inicio nao pode insistir que ha.
    npsPendente: npsDoClienteExemplo(alvo).pendente !== null,
    redes: { publicados: 5, agendados: 1, esperandoVoce: itensDoCliente(alvo).length, emProducao: 3 },
    projeto: {
      servicoNome: 'Website', total: 11, entregues: 2,
      fase: 'Design', proximo: 'Layout mobile',
    },
    captacao: {
      proximaData: emDias(1), proximoTitulo: 'Captação na fábrica',
      ultimaTitulo: 'Captação de setembro', ultimaFotos: 44, ultimaVideos: 6,
    },
  };
}

// ---------------------------------------------------------------------------
// O catalogo e o cadastro
// ---------------------------------------------------------------------------
const NOME_SERVICO: Record<ChaveServico, string> = {
  branding: 'Branding',
  identidade_visual: 'Identidade Visual',
  audiovisual: 'Audiovisual',
  website: 'Website',
  sistemas: 'Sistemas',
  gestao_digital: 'Gestão Digital',
};

const NOME_MODULO: Record<ChaveModulo, string> = {
  marcos: 'Marcos', entregaveis: 'Entregáveis', acervo: 'Acervo', galeria: 'Galeria',
  calendario: 'Calendário', grid: 'Grid', publicacao: 'Publicação', campanhas: 'Campanhas',
  ambientes: 'Ambientes e acessos', manutencao: 'Manutenção', integracoes: 'Integrações',
  financeiro: 'Financeiro', contrato: 'Contrato', nps: 'Feedbacks e NPS',
};

/** Opcional na matriz da 0014: hoje so as duas da Gestao Digital. */
const OPCIONAIS: Partial<Record<ChaveServico, ChaveModulo[]>> = {
  gestao_digital: ['campanhas', 'galeria'],
};

const PADRAO: Record<ChaveServico, FormatoContrato | null> = {
  branding: 'projeto',
  identidade_visual: 'projeto',
  audiovisual: null,
  website: 'projeto',
  sistemas: 'projeto',
  gestao_digital: 'recorrente',
};

const ORDEM_SERVICOS: ChaveServico[] = [
  'branding', 'identidade_visual', 'audiovisual', 'website', 'sistemas', 'gestao_digital',
];

export function catalogoExemplo(): Catalogo {
  return {
    servicos: ORDEM_SERVICOS.map((chave) => {
      const opcionais = OPCIONAIS[chave] ?? [];
      return {
        chave,
        nome: NOME_SERVICO[chave],
        formatoPadrao: PADRAO[chave],
        modulos: [...MATRIZ[chave], ...opcionais]
          .filter((m, i, todos) => todos.indexOf(m) === i)
          .map((m) => ({ chave: m, nome: NOME_MODULO[m], opcional: opcionais.includes(m) })),
      };
    }),
    modulosSempre: SEMPRE.map((m) => ({ chave: m, nome: NOME_MODULO[m] })),
    equipe: [
      { userId: 'exemplo-viviane', nome: 'Viviane', papel: 'admin' },
      { userId: 'exemplo-layana', nome: 'Layana', papel: 'operacao' },
      { userId: 'exemplo-beatriz', nome: 'Beatriz', papel: 'operacao' },
      { userId: 'exemplo-camila', nome: 'Camila', papel: 'financeiro' },
    ],
  };
}

/** Mesmas recusas de criar_cliente(), para a tela de exemplo nao mentir. */
export function criarClienteExemplo(
  nome: string, servicos: ServicoEscolhido[], slug?: string,
): ClienteNovo {
  const alvo = sluguificar(slug?.trim() || nome);
  if (!nome.trim()) throw new Error('O cliente precisa de um nome.');
  if (!alvo) throw new Error(`Não consegui montar um endereço a partir de "${nome}". Escreva um.`);
  if (CLIENTES.some((c) => c.cliente.slug === alvo)) {
    throw new Error(`Já existe um cliente no endereço "${alvo}". Escolha outro.`);
  }
  if (servicos.length === 0) {
    throw new Error('Escolha pelo menos um serviço: é o contrato que liga as telas do cliente.');
  }

  const cliente: Cliente = {
    id: `exemplo-${alvo}`, nome: nome.trim(), slug: alvo,
    fusoHorario: 'America/Sao_Paulo', ativo: true,
  };
  const equipe = catalogoExemplo().equipe;
  const contratados: ServicoContratado[] = servicos.map((e) => {
    const formato = e.formato ?? PADRAO[e.servico];
    if (!formato) throw new Error(`Diga se ${NOME_SERVICO[e.servico]} é recorrente ou pontual.`);
    if (formato === 'recorrente' && !e.diaVencimento) {
      throw new Error(`Diga o dia de vencimento de ${NOME_SERVICO[e.servico]} (1 a 28).`);
    }
    return srv(cliente.id, e.servico, NOME_SERVICO[e.servico], formato, e.valorCentavos, {
      diaVencimento: formato === 'recorrente' ? e.diaVencimento : null,
      parcelas: formato === 'recorrente' ? null : (e.parcelas ?? 1),
      inicio: e.inicio,
      entregaEm: e.entregaEm,
      responsavelNome: equipe.find((m) => m.userId === e.responsavelId)?.nome ?? null,
    });
  });

  CLIENTES.push({
    cliente,
    servicos: contratados,
    extras: servicos.flatMap((e) => e.modulos),
    contatos: [],
  });
  return { id: cliente.id, slug: alvo, nome: cliente.nome };
}

// ---------------------------------------------------------------------------
// O projeto — os mesmos modelos da migration 0018, resumidos para o exemplo
// ---------------------------------------------------------------------------
const MODELOS: Partial<Record<ChaveServico, [string, string][]>> = {
  website: [
    ['Descoberta', 'Briefing e arquitetura'],
    ['Descoberta', 'Wireframe'],
    ['Design', 'Layout desktop'],
    ['Design', 'Layout mobile'],
    ['Desenvolvimento', 'Desenvolvimento responsivo'],
    ['Desenvolvimento', 'Otimização SEO'],
    ['Desenvolvimento', 'Velocidade e performance'],
    ['Publicação', 'Domínio e hospedagem'],
    ['Publicação', 'Certificado SSL'],
    ['Publicação', 'Homologação'],
    ['Publicação', 'Site no ar'],
  ],
  branding: [
    ['Diagnóstico', 'Diagnóstico de marca'],
    ['Estratégia', 'Arquétipo, propósito e valores'],
    ['Estratégia', 'Posicionamento estratégico'],
    ['Estratégia', 'Proposta de valor'],
    ['Entrega', 'Tom de voz e direcionamento'],
    ['Entrega', 'Brandbook'],
  ],
  identidade_visual: [
    ['Conceito', 'Logo'],
    ['Sistema', 'Paleta de cores'],
    ['Sistema', 'Tipografia'],
    ['Sistema', 'Elementos gráficos e padrões'],
    ['Entrega', 'Manual de aplicação'],
    ['Entrega', 'Papelaria digital'],
  ],
  audiovisual: [
    ['Pré', 'Roteiro'],
    ['Captação', 'Captação'],
    ['Pós', 'Seleção de material'],
    ['Pós', 'Edição e color grading'],
    ['Entrega', 'Entrega final'],
  ],
  sistemas: [
    ['Descoberta', 'Mapeamento do processo'],
    ['Desenho', 'Fluxos e automações'],
    ['Construção', 'Integrações'],
    ['Entrega', 'Homologação'],
    ['Entrega', 'Treinamento de uso'],
  ],
};

/** Os entregaveis nascem do contrato, como o gatilho da 0018 faz no banco. */
const PROJETOS = new Map<string, ServicoNoProjeto[]>();

function projetoDe(c: ClienteExemplo): ServicoNoProjeto[] {
  const pronto = PROJETOS.get(c.cliente.id);
  if (pronto) return pronto;

  const servicos: ServicoNoProjeto[] = ativos(c)
    .filter((s) => MODELOS[s.servico])
    .map((s) => ({
      clienteServicoId: s.id,
      servico: s.servico,
      servicoNome: s.servicoNome,
      entregaEm: s.entregaEm,
      entregaveis: (MODELOS[s.servico] ?? []).map(([fase, titulo], i) => ({
        id: `${s.id}-e${i + 1}`,
        itemId: null,
        fase,
        titulo,
        ordem: i + 1,
        estado: 'a_fazer' as const,
        prazo: null,
        versaoAtual: null,
        enviadoEm: null,
        respondidoEm: null,
        responsavelNome: s.responsavelNome,
      })),
      marcos: [],
    }));

  PROJETOS.set(c.cliente.id, servicos);
  return servicos;
}

export function projetoExemplo(clienteId: string): ServicoNoProjeto[] {
  const c = CLIENTES.find((x) => x.cliente.id === clienteId);
  if (!c) return [];
  const p = projetoDe(c);
  // O estado real mora no item, como na view do banco.
  for (const s of p) {
    for (const e of s.entregaveis) {
      const item = e.itemId ? ITENS.find((i) => i.id === e.itemId) : null;
      e.estado = item ? item.estado : 'a_fazer';
      e.enviadoEm = item?.enviadoEm ?? null;
      e.respondidoEm = item?.respondidoEm ?? null;
    }
  }
  return p;
}

function acharEntregavel(id: string): { cliente: string; e: EntregavelNoProjeto } | null {
  for (const c of CLIENTES) {
    for (const s of projetoDe(c)) {
      const e = s.entregaveis.find((x) => x.id === id);
      if (e) return { cliente: c.cliente.id, e };
    }
  }
  return null;
}

/** Mesmo contrato de item_do_entregavel(): chamar de novo devolve o mesmo item. */
export function itemDoEntregavelExemplo(entregavelId: string): string {
  const achado = acharEntregavel(entregavelId);
  if (!achado) throw new Error('Entregável não encontrado.');
  if (achado.e.itemId) return achado.e.itemId;

  const id = `item-${entregavelId}`;
  ITENS.push(item(id, achado.cliente, achado.e.titulo, {
    tipo: 'entregavel', estado: 'produzindo', enviadoEm: null,
  }));
  achado.e.itemId = id;
  return id;
}

export function enviarExemplo(itemIds: string[], mensagem?: string): number {
  if (itemIds.length === 0) throw new Error('Escolha o que enviar.');
  const itens = itemIds.map((id) => {
    const i = ITENS.find((x) => x.id === id);
    if (!i) throw new Error('Item não encontrado.');
    return i;
  });
  if (new Set(itens.map((i) => i.clienteId)).size > 1) {
    throw new Error('Um envio é de um cliente só. Separe em dois.');
  }
  for (const i of itens) {
    if (i.estado === 'em_aprovacao') {
      throw new Error(`“${i.titulo}” já está esperando o cliente.`);
    }
    if (i.estado === 'aprovado') {
      throw new Error(`“${i.titulo}” já foi aprovado. Para mandar de novo, crie uma nova versão.`);
    }
  }
  for (const i of itens) {
    i.estado = 'em_aprovacao';
    i.enviadoEm = new Date().toISOString();
    i.respondidoEm = null;
    i.respondidoPor = null;
  }
  // O lote nasce aqui, como nasce no banco: e dele que sai o link sem conta.
  // `registrarEnvioExemplo` esta definido mais abaixo no arquivo; na hora em
  // que esta funcao roda, o modulo ja carregou inteiro.
  const primeiro = itens[0];
  if (primeiro) registrarEnvioExemplo(primeiro.clienteId, itemIds, mensagem);
  return itens.length;
}

// ---------------------------------------------------------------------------
// O calendario — as pecas do mes
//
// Cada peca aponta para um item de aprovacao, como no banco: o estado vem de
// la, nao de uma copia aqui. Assim o calendario, a fila da equipe e o portal
// do cliente nunca discordam.
// ---------------------------------------------------------------------------
interface PecaExemplo {
  id: string;
  clienteId: string;
  itemId: string | null;
  titulo: string;
  tipo: TipoPeca;
  legenda: string;
  dia: string;
  hora: string;
  statusPublicacao: StatusPublicacao;
  contas: string[];
}

const agora = new Date();
const noMes = (dia: number) =>
  `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

const PECAS: PecaExemplo[] = [
  { id: 'pc1', clienteId: 'exemplo-mor', itemId: 'i11', titulo: 'Bastidores do estúdio',
    tipo: 'reel', legenda: 'Um dia inteiro em 40 segundos.', dia: noMes(3), hora: '12:00',
    statusPublicacao: 'publicado', contas: ['@mormarcas'] },
  { id: 'pc2', clienteId: 'exemplo-mor', itemId: 'i5', titulo: 'Como a peça é feita',
    tipo: 'carrossel', legenda: '', dia: noMes(6), hora: '12:00',
    statusPublicacao: 'rascunho', contas: ['@mormarcas'] },
  { id: 'pc3', clienteId: 'exemplo-mor', itemId: 'i1', titulo: 'Making of da campanha',
    tipo: 'reel', legenda: '', dia: noMes(10), hora: '19:00',
    statusPublicacao: 'aguardando_aprovacao', contas: ['@mormarcas'] },
  { id: 'pc4', clienteId: 'exemplo-mor', itemId: 'i2', titulo: 'Frase da semana',
    tipo: 'imagem', legenda: '', dia: noMes(13), hora: '12:00',
    statusPublicacao: 'aguardando_aprovacao', contas: ['@mormarcas'] },
  { id: 'pc5', clienteId: 'exemplo-mor', itemId: 'i3', titulo: 'Perguntas que mais recebemos',
    tipo: 'carrossel', legenda: '', dia: noMes(17), hora: '19:00',
    statusPublicacao: 'aguardando_aprovacao', contas: ['@mormarcas'] },
  { id: 'pc6', clienteId: 'exemplo-mor', itemId: 'i12', titulo: 'Depoimento da cliente',
    tipo: 'reel', legenda: '', dia: noMes(20), hora: '12:00',
    statusPublicacao: 'rascunho', contas: ['@mormarcas'] },
  { id: 'pc7', clienteId: 'exemplo-pub', itemId: 'i6', titulo: 'Carrossel do lançamento',
    tipo: 'carrossel', legenda: '', dia: noMes(8), hora: '09:00',
    statusPublicacao: 'aguardando_aprovacao', contas: ['@publika.ai'] },
  { id: 'pc8', clienteId: 'exemplo-chopp', itemId: 'i8', titulo: 'Reels da fábrica',
    tipo: 'reel', legenda: '', dia: noMes(5), hora: '18:00',
    statusPublicacao: 'falhou', contas: ['@choppdobarbudo'] },
  { id: 'pc9', clienteId: 'exemplo-mor', itemId: 'i13', titulo: 'Antes e depois do projeto',
    tipo: 'carrossel', legenda: 'Dois meses entre a primeira e a última foto.',
    dia: hoje, hora: '19:00', statusPublicacao: 'agendado', contas: ['@mormarcas'] },
  { id: 'pc10', clienteId: 'exemplo-pub', itemId: 'i14', titulo: 'Bastidores da reunião',
    tipo: 'story', legenda: '', dia: hoje, hora: '09:00',
    statusPublicacao: 'publicando', contas: ['@publika.ai'] },
  { id: 'pc11', clienteId: 'exemplo-chopp', itemId: 'i15', titulo: 'Chopp do fim de semana',
    tipo: 'imagem', legenda: 'Sexta começa quinta.', dia: emDias(1), hora: '18:00',
    statusPublicacao: 'agendado', contas: ['@choppdobarbudo'] },
  { id: 'pc12', clienteId: 'exemplo-pub', itemId: 'i16', titulo: 'Dica rápida de copy',
    tipo: 'reel', legenda: '', dia: emDias(-1), hora: '12:00',
    statusPublicacao: 'publicado', contas: ['@publika.ai'] },
];

let seqPeca = 0;

function comoNoMes(p: PecaExemplo): PecaNoMes {
  const item = p.itemId ? ITENS.find((i) => i.id === p.itemId) : null;
  return {
    id: p.id,
    itemId: p.itemId,
    titulo: p.titulo,
    tipo: p.tipo,
    legenda: p.legenda,
    dia: p.dia,
    hora: p.hora,
    statusPublicacao: p.statusPublicacao,
    estadoAprovacao: item?.estado ?? 'produzindo',
    erro: p.statusPublicacao === 'falhou' ? 'O token do Instagram venceu.' : null,
    contas: p.contas,
  };
}

export function calendarioExemplo(clienteId: string, mes: string): MesDeConteudo {
  const prefixo = mes.slice(0, 7);
  const doMes = PECAS.filter((p) => p.clienteId === clienteId && p.dia.startsWith(prefixo))
    .map(comoNoMes)
    .sort((a, b) => (a.dia + a.hora).localeCompare(b.dia + b.hora));

  const c = CLIENTES.find((x) => x.cliente.id === clienteId);
  const gestao = c ? ativos(c).find((s) => s.servico === 'gestao_digital') : undefined;

  return {
    mes: `${prefixo}-01`,
    fusoHorario: c?.cliente.fusoHorario ?? 'America/Sao_Paulo',
    pecas: doMes,
    plano: gestao
      ? {
          clienteServicoId: gestao.id,
          diasSemana: [1, 3, 5],
          horario: '12:00',
          postsPorMes: 8,
          reelsPorMes: 2,
          cota: 10,
        }
      : null,
    noMes: doMes.length,
    esperandoCliente: doMes.filter((p) => p.estadoAprovacao === 'em_aprovacao').length,
    comAjustes: doMes.filter((p) => p.estadoAprovacao === 'com_ajustes').length,
    publicadas: doMes.filter((p) => p.statusPublicacao === 'publicado').length,
    falhas: doMes.filter((p) => p.statusPublicacao === 'falhou').length,
  };
}

export function criarPecaExemplo(
  clienteId: string, titulo: string, tipo: TipoPeca, dia: string, hora: string, legenda: string,
): { id: string; itemId: string } {
  if (!titulo.trim()) {
    throw new Error('A peça precisa de um nome interno — é por ele que a equipe acha ela.');
  }
  if (!dia) throw new Error('Diga que dia a peça sai.');

  seqPeca += 1;
  const id = `pc-nova-${seqPeca}`;
  const itemId = `item-${id}`;
  // O gatilho da 0019 cria o item junto com a peca; aqui e o mesmo contrato.
  ITENS.push(item(itemId, clienteId, titulo.trim(), { tipo: 'peca', estado: 'produzindo', enviadoEm: null }));
  PECAS.push({
    id, clienteId, itemId, titulo: titulo.trim(), tipo, legenda,
    dia, hora: hora || '12:00', statusPublicacao: 'rascunho', contas: [],
  });
  return { id, itemId };
}

export function moverPecaExemplo(pecaId: string, dia: string, hora?: string): void {
  const p = PECAS.find((x) => x.id === pecaId);
  if (!p) throw new Error('Peça não encontrada.');
  if (p.statusPublicacao === 'publicado' || p.statusPublicacao === 'publicando') {
    throw new Error('Esta peça já saiu. Não dá para mudar a data dela.');
  }
  p.dia = dia;
  if (hora) p.hora = hora;
}

// ---------------------------------------------------------------------------
// Acessos
// ---------------------------------------------------------------------------
const PESSOAS: PessoaDaEquipe[] = [
  { userId: 'exemplo-viviane', nome: 'Viviane', email: 'viviane@astartstudio.com.br',
    papel: 'admin', cargo: 'Direção', ativo: true, desativadoEm: null },
  { userId: 'exemplo-layana', nome: 'Layana', email: 'layana@astartstudio.com.br',
    papel: 'operacao', cargo: 'Social Media', ativo: true, desativadoEm: null },
  { userId: 'exemplo-beatriz', nome: 'Beatriz', email: 'beatriz@astartstudio.com.br',
    papel: 'operacao', cargo: 'Audiovisual', ativo: true, desativadoEm: null },
  { userId: 'exemplo-camila', nome: 'Camila', email: 'camila@astartstudio.com.br',
    papel: 'financeiro', cargo: 'Financeiro', ativo: true, desativadoEm: null },
  { userId: 'exemplo-rafa', nome: 'Rafael', email: null,
    papel: 'leitura', cargo: 'Estágio', ativo: false, desativadoEm: haHoras(900) },
];

const CONVITES: ConviteAberto[] = [
  { id: 'cv1', destino: 'equipe', email: 'nova@astartstudio.com.br', nome: 'Nova pessoa',
    papel: 'operacao', cargo: 'Designer', clienteId: null, clienteNome: null,
    papelCliente: null, criadoEm: haHoras(30) },
];

let seqConvite = 0;

/**
 * No exemplo, a Meta aparece com DUAS chaves faltando e a Asaas como ainda nao
 * construida. Nao e preguica: e o estado mais informativo para quem esta
 * avaliando a tela — mostra os tres casos de uma vez (pronta, incompleta, e
 * "falta codigo, nao chave"), que e justamente o que a tela precisa saber
 * desenhar.
 */
/**
 * No exemplo o cliente comeca SEM conta conectada, de proposito: e o estado em
 * que a tela tem mais a dizer, e o que alguem avaliando precisa ver primeiro.
 * `salvarContaSocialExemplo` enche esta lista, entao a demonstracao percorre o
 * caminho inteiro sem banco.
 */
const CONTAS_EXEMPLO = new Map<string, ContaSocial[]>();

/**
 * O compositor em modo exemplo.
 *
 * Guarda de verdade, num mapa, porque o roteiro precisa percorrer o caminho
 * inteiro: criar, anexar, agendar. Demonstracao que para no primeiro passo nao
 * prova nada — foi a licao do stub generoso, duas vezes nesta semana.
 */
const PUBLICACOES = new Map<string, Publicacao>();

export function criarPublicacaoExemplo(p: PublicacaoNova): string {
  if (!p.titulo.trim()) throw new Error('De um nome interno para a publicacao.');
  const id = `pub-${crypto.randomUUID()}`;
  PUBLICACOES.set(id, {
    ...p,
    id,
    quando: null,
    status: 'rascunho',
    erro: null,
    midias: [],
  });
  return id;
}

export function atualizarPublicacaoExemplo(id: string, p: Partial<PublicacaoNova>): void {
  const atual = PUBLICACOES.get(id);
  if (!atual) throw new Error('Publicacao nao encontrada.');
  if (atual.status === 'publicado') throw new Error('Esta publicacao esta no ar — nao muda mais.');
  PUBLICACOES.set(id, { ...atual, ...p });
}

export function publicacaoExemplo(id: string): Publicacao | null {
  return PUBLICACOES.get(id) ?? null;
}

/**
 * As mesmas travas do banco, repetidas aqui de proposito: se as duas
 * discordarem, o roteiro acusa. Sem elas, a demonstracao deixaria agendar post
 * sem imagem — ensinando o contrario do que a plataforma faz.
 */
export function agendarPublicacaoExemplo(
  id: string,
  quando: string | null,
): { quando: string; agora: boolean } {
  const pub = PUBLICACOES.get(id);
  if (!pub) throw new Error('Publicacao nao encontrada.');

  const minimo = pub.tipo === 'carrossel' ? 2 : 1;
  if (pub.midias.length < minimo) {
    throw new Error(
      `Falta arquivo: ${pub.tipo} pede ${minimo} e tem ${pub.midias.length}. Anexe antes de agendar.`,
    );
  }

  const q = quando ?? new Date().toISOString();
  PUBLICACOES.set(id, { ...pub, quando: q, status: 'agendado' });
  return { quando: q, agora: new Date(q).getTime() <= Date.now() + 70_000 };
}

/** O compositor em exemplo anota a midia aqui, para `agendar` poder cobrar. */
export function anotarMidiaExemplo(id: string, midias: unknown[]): void {
  const pub = PUBLICACOES.get(id);
  if (pub) PUBLICACOES.set(id, { ...pub, midias: midias as Publicacao['midias'] });
}

export function contasDoClienteExemplo(clienteId: string): ContaSocial[] {
  return CONTAS_EXEMPLO.get(clienteId) ?? [];
}

/**
 * Os canais do cliente no modo exemplo — a mesma resposta da
 * `canais_do_cliente` (0055), montada das mesmas listas que a tela usa.
 *
 * Montada, nao escrita a mao: lista escrita a mao aqui seria a QUINTA copia da
 * regra de formato, e seria a que divergisse — e divergir no modo exemplo e o
 * pior lugar, porque e onde os roteiros de navegador rodam.
 *
 * A ordem copia a da funcao do banco: Instagram antes de Facebook, formato na
 * ordem em que a agencia pensa, e canal que publica antes do que nao publica.
 */
export function canaisDoClienteExemplo(clienteId: string): Canal[] {
  const contas = CONTAS_EXEMPLO.get(clienteId) ?? [];
  const canais: Canal[] = [];

  for (const c of contas) {
    for (const tipo of ORDEM_FORMATOS) {
      const regra = FORMATOS[tipo];
      const linha = CANAIS.find((x) => x.plataforma === c.plataforma && x.tipo === tipo);
      // A conta antes do formato, como no banco: conta desligada nao publica em
      // formato nenhum, e dizer "o Facebook nao faz reel" para uma conta
      // desligada seria responder a pergunta errada.
      const recusaDaConta = !c.ativo
        ? 'Esta conta está desligada na plataforma.'
        : c.acessoParceiro !== 'concedido'
          ? `O acesso de parceiro desta conta está ${c.acessoParceiro}. Confira no Business Manager.`
          : c.plataforma === 'instagram' && !c.igUserId
            ? 'Falta o id do Instagram desta conta. Reconecte-a.'
            : null;

      const publicavel = recusaDaConta === null && (linha?.publicavel ?? false);
      canais.push({
        contaId: c.id,
        conta: c.nome,
        plataforma: c.plataforma,
        tipo,
        publicavel,
        motivo: publicavel ? null : (recusaDaConta ?? linha?.motivo ?? 'Canal sem regra.'),
        minimo: regra.minimo,
        maximo: regra.maximo,
        natureza: regra.natureza,
      });
    }
  }

  const peso = (x: Canal) =>
    (x.plataforma === 'instagram' ? 0 : 100) +
    ORDEM_FORMATOS.indexOf(x.tipo) +
    (x.publicavel ? 0 : 50);
  return canais.sort((a, b) => peso(a) - peso(b));
}

export function descobrirContasExemplo(): ContaDescoberta[] {
  return [
    { pageId: '1010', pageName: 'Mor Marcas', igUserId: '17841400000001', igUsername: 'mormarcas' },
    { pageId: '1011', pageName: 'Publika.ai', igUserId: '17841400000002', igUsername: 'publika.ai' },
    // Pagina sem Instagram vinculado: o caso que a tela precisa saber recusar.
    { pageId: '1012', pageName: 'Pagina sem Instagram', igUserId: null, igUsername: null },
  ];
}

/**
 * No exemplo, o token e o SAUDAVEL: tipo SYSTEM_USER, sem expiracao, escopos
 * completos.
 *
 * Mostrar o caso doente aqui seria mais chamativo e seria errado: quem abre o
 * modo exemplo esta vendo como a plataforma fica quando esta certa.
 */
export function conferirTokenExemplo(): SaudeDoToken {
  return {
    valido: true,
    tipo: 'SYSTEM_USER',
    expiraEm: null,
    jaExpirou: false,
    escopos: [
      'instagram_basic',
      'instagram_content_publish',
      'pages_show_list',
      'pages_read_engagement',
      'business_management',
    ],
    escoposFaltando: [],
    appId: '000000000000000',
    conferidoCom: 'app_token',
    cadastradaEm: new Date(Date.now() - 32 * 86_400_000).toISOString(),
    formato: {
      cadastrada: true,
      tamanho: 212,
      pontasSujas: false,
      temQuebraDeLinha: false,
      temAspas: false,
      temSinaisDeMarcador: false,
      soCaracteresEsperados: true,
      comecaComEAA: true,
    },
    diagnostico: 'Token de usuário do sistema, válido e sem data de expiração. É o que se quer.',
    oQueFazer: null,
  };
}

export function salvarContaSocialExemplo(clienteId: string, conta: ContaDescoberta): void {
  if (!conta.igUserId) throw new Error('Esta pagina nao tem conta de Instagram vinculada.');
  const lista = CONTAS_EXEMPLO.get(clienteId) ?? [];
  if (lista.some((c) => c.igUserId === conta.igUserId)) return;
  lista.push({
    id: `conta-${conta.igUserId}`,
    plataforma: 'instagram',
    nome: conta.igUsername ?? conta.pageName,
    igUserId: conta.igUserId,
    pageId: conta.pageId,
    ativo: true,
    acessoParceiro: 'concedido',
    tokenProprio: false,
    prontaParaPublicar: true,
  });
  CONTAS_EXEMPLO.set(clienteId, lista);
}

export function conectoresExemplo(): Conector[] {
  return [
    {
      id: 'meta',
      nome: 'Meta',
      paraQue: 'publicar no Instagram e Facebook na hora marcada',
      construida: true,
      ordem: 1,
      faltando: ['meta_system_user_token', 'tick_secret'],
      agendador: { publicar: false, renovar: false },
      chaves: [
        { chave: 'meta_system_user_token', onde: 'vault', obrigatoria: true, paraQue: 'token do System User do Business Manager da Astart', presente: false },
        { chave: 'tick_secret', onde: 'vault', obrigatoria: true, paraQue: 'segredo entre o agendador e as funcoes', presente: false },
        { chave: 'publicar_tick_url', onde: 'vault', obrigatoria: true, paraQue: 'endereco da funcao que publica', presente: true },
        { chave: 'renovar_tokens_url', onde: 'vault', obrigatoria: true, paraQue: 'endereco da funcao que renova token', presente: true },
        { chave: 'META_API_VERSION', onde: 'funcao', obrigatoria: true, paraQue: 'versao da API da Meta, sem default no codigo', presente: null },
        { chave: 'TICK_SECRET', onde: 'funcao', obrigatoria: true, paraQue: 'o mesmo valor do tick_secret', presente: null },
      ],
    },
    {
      id: 'asaas',
      nome: 'Asaas',
      paraQue: 'emitir cobranca e saber quem pagou',
      construida: false,
      ordem: 2,
      faltando: ['asaas_api_key', 'asaas_base_url', 'asaas_webhook_token'],
      agendador: null,
      chaves: [
        { chave: 'asaas_api_key', onde: 'vault', obrigatoria: true, paraQue: 'chave da API da Asaas', presente: false },
        { chave: 'asaas_base_url', onde: 'vault', obrigatoria: true, paraQue: 'endereco da API: sandbox ou producao, escrito e nao adivinhado', presente: false },
        { chave: 'asaas_webhook_token', onde: 'vault', obrigatoria: true, paraQue: 'segredo que confere se o aviso de pagamento e da Asaas', presente: false },
      ],
    },
    {
      id: 'anthropic',
      nome: 'Anthropic',
      paraQue: 'ler proposta em PDF e preencher o cadastro',
      construida: false,
      ordem: 3,
      faltando: ['anthropic_api_key'],
      agendador: null,
      chaves: [
        { chave: 'anthropic_api_key', onde: 'vault', obrigatoria: true, paraQue: 'chave da API da Anthropic', presente: false },
      ],
    },
  ];
}

export function equipeEConvitesExemplo(): EquipeEConvites {
  return {
    pessoas: PESSOAS.slice().sort((a, b) =>
      a.ativo === b.ativo ? (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR') : a.ativo ? -1 : 1),
    convites: CONVITES.slice(),
    // Em modo exemplo quem entra pela equipe entra como operacao; para a tela
    // de Ajustes ser navegavel, aqui ela ve como admin.
    souAdmin: true,
  };
}

export function convidarExemplo(p: PedidoDeConvite): void {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) throw new Error('E-mail inválido.');
  if (PESSOAS.some((x) => x.email === p.email && x.ativo)) {
    throw new Error('Já existe gente da equipe com esse e-mail.');
  }
  if (CONVITES.some((c) => c.email === p.email)) {
    throw new Error('Já existe um convite aberto para esse e-mail.');
  }
  seqConvite += 1;
  CONVITES.push({
    id: `cv-${seqConvite}`,
    destino: p.destino,
    email: p.email,
    nome: p.nome ?? null,
    papel: p.destino === 'equipe' ? p.papel : null,
    cargo: p.destino === 'equipe' ? (p.cargo ?? null) : null,
    clienteId: p.destino === 'cliente' ? p.clienteId : null,
    clienteNome: p.destino === 'cliente'
      ? (CLIENTES.find((c) => c.cliente.id === p.clienteId)?.cliente.nome ?? null)
      : null,
    papelCliente: p.destino === 'cliente' ? p.papelCliente : null,
    criadoEm: new Date().toISOString(),
  });

  // No banco o contato so existe quando o convite e aceito; no exemplo ele ja
  // aparece na ficha como "sem acesso ainda", que e o que a tela mostraria.
  if (p.destino === 'cliente') {
    const c = CLIENTES.find((x) => x.cliente.id === p.clienteId);
    c?.contatos.push({
      userId: `u-${p.email}`,
      nome: p.nome ?? p.email, email: p.email, papel: p.papelCliente, ativo: false,
    });
  }
}

export function revogarConviteExemplo(id: string): void {
  const i = CONVITES.findIndex((c) => c.id === id);
  if (i >= 0) CONVITES.splice(i, 1);
}

export function mudarAcessoExemplo(userId: string, ativo: boolean): void {
  const p = PESSOAS.find((x) => x.userId === userId);
  if (!p) throw new Error('Pessoa não encontrada.');
  p.ativo = ativo;
  p.desativadoEm = ativo ? null : new Date().toISOString();
}

export function tirarAcessoDoClienteExemplo(email: string, clienteId: string): void {
  const c = CLIENTES.find((x) => x.cliente.id === clienteId);
  const contato = c?.contatos.find((x) => x.email === email);
  if (contato) contato.ativo = false;
}

// ---------------------------------------------------------------------------
// Galerias de exemplo
//
// As fotos são campos de cor gerados para este repositório — nossas, leves, e
// combinam com o vidro. Em modo exemplo o "upload" não sai do navegador: o
// arquivo vira um object URL e entra na grade, para o fluxo inteiro poder ser
// percorrido antes de existir Supabase.
// ---------------------------------------------------------------------------
interface GaleriaExemplo extends GaleriaNaLista {
  clienteId: string;
  itens: ItemGaleria[];
}

const foto = (n: number, nome: string, bytes: number): ItemGaleria => ({
  id: `g-foto-${n}`,
  tipo: 'foto',
  nome,
  miniatura: publico(`exemplo/mini-${String(n).padStart(2, '0')}.jpg`),
  poster: null,
  largura: 6000,
  altura: 4000,
  duracao: null,
  bytes,
});

const ITENS_PADARIA: ItemGaleria[] = [
  foto(1, 'ASTART_padaria_0001.jpg', 8_412_000),
  foto(2, 'ASTART_padaria_0002.jpg', 7_980_000),
  foto(3, 'ASTART_padaria_0003.jpg', 9_104_000),
  foto(4, 'ASTART_padaria_0004.jpg', 8_221_000),
  foto(5, 'ASTART_padaria_0005.jpg', 7_640_000),
  foto(6, 'ASTART_padaria_0006.jpg', 8_903_000),
  {
    id: 'g-video-1',
    tipo: 'video',
    nome: 'ASTART_padaria_makingof.mp4',
    miniatura: publico('exemplo/mini-07.jpg'),
    poster: publico('exemplo/foto-07.jpg'),
    largura: 3840,
    altura: 2160,
    duracao: 94.5,
    bytes: 1_240_000_000,
  },
  foto(8, 'ASTART_padaria_0008.jpg', 8_060_000),
];

const GALERIAS: GaleriaExemplo[] = [
  {
    id: 'gal-1',
    clienteId: 'exemplo-chopp',
    titulo: 'Captação na fábrica — outubro',
    sessaoId: 'ses-1',
    quando: emDias(-6),
    local: 'Fábrica, Bairro Industrial',
    provedor: 'storage',
    url: null,
    permiteDownload: true,
    publicadaEm: emDias(-5),
    capa: publico('exemplo/mini-01.jpg'),
    fotos: 7,
    videos: 1,
    bytes: ITENS_PADARIA.reduce((a, i) => a + (i.bytes ?? 0), 0),
    favoritos: 2,
    baixou: true,
    links: [{ id: 'lk-1', criadoEm: emDias(-5), acessos: 6, ultimoAcessoEm: emDias(-1) }],
    itens: ITENS_PADARIA,
  },
  {
    id: 'gal-2',
    clienteId: 'exemplo-mor',
    titulo: 'Ensaio de produto — setembro',
    sessaoId: 'ses-2',
    quando: emDias(-38),
    local: 'Estúdio Astart',
    provedor: 'storage',
    url: null,
    permiteDownload: true,
    publicadaEm: emDias(-36),
    capa: publico('exemplo/mini-04.jpg'),
    fotos: 4,
    videos: 0,
    bytes: 32_000_000,
    favoritos: 0,
    baixou: false,
    links: [],
    itens: [
      foto(4, 'ASTART_mor_0001.jpg', 8_000_000),
      foto(5, 'ASTART_mor_0002.jpg', 8_000_000),
      foto(6, 'ASTART_mor_0003.jpg', 8_000_000),
      foto(8, 'ASTART_mor_0004.jpg', 8_000_000),
    ],
  },
];

const FAVORITOS = new Set<string>(['g-foto-2', 'g-foto-5']);

/** Arquivadas no modo exemplo. A equipe ve; o cliente nao (0058). */
const ARQUIVADAS = new Map<string, string>();

export function arquivarGaleriaExemplo(galeriaId: string, arquivar: boolean): void {
  if (arquivar) ARQUIVADAS.set(galeriaId, new Date().toISOString());
  else ARQUIVADAS.delete(galeriaId);
}

export function excluirGaleriaExemplo(
  galeriaId: string,
): { titulo: string; itens: number; arquivosApagados: number } {
  const i = GALERIAS.findIndex((g) => g.id === galeriaId);
  if (i < 0) throw new Error('Galeria nao encontrada.');
  const [fora] = GALERIAS.splice(i, 1);
  ARQUIVADAS.delete(galeriaId);
  CAPAS.delete(galeriaId);
  return {
    titulo: fora?.titulo ?? 'Galeria',
    itens: fora?.itens.length ?? 0,
    arquivosApagados: fora?.itens.length ?? 0,
  };
}

export function galeriasExemplo(clienteId: string): GaleriaNaLista[] {
  return GALERIAS.filter((g) => g.clienteId === clienteId).map((g) => ({
    ...g,
    arquivadaEm: ARQUIVADAS.get(g.id) ?? null,
    capaItemId: CAPAS.get(g.id) ?? null,
    fotos: g.itens.filter((i) => i.tipo === 'foto').length,
    videos: g.itens.filter((i) => i.tipo === 'video').length,
    bytes: g.itens.reduce((a, i) => a + (i.bytes ?? 0), 0),
    favoritos: g.itens.filter((i) => FAVORITOS.has(i.id)).length,
  }));
}

/** A capa escolhida no modo exemplo. Chave = id da galeria. */
const CAPAS = new Map<string, string>();

export function definirCapaExemplo(galeriaId: string, itemId: string | null): void {
  if (itemId) CAPAS.set(galeriaId, itemId);
  else CAPAS.delete(galeriaId);
}

export function albumExemplo(chave: string): Album {
  const g = GALERIAS.find((x) => x.id === chave || x.links.some((l) => l.id === chave))
    ?? GALERIAS[0]!;
  // A mesma regra do banco: capa escolhida, senao a primeira foto. O roteiro de
  // tela percorre os dois caminhos.
  const capaId = CAPAS.get(g.id) ?? null;
  const capa = capaId
    ? (g.itens.find((i) => i.id === capaId)?.miniatura ?? null)
    : (g.itens.find((i) => i.tipo === 'foto')?.miniatura ?? null);
  return {
    titulo: g.titulo,
    recado: 'Marque as suas preferidas. O download sai em alta.',
    cliente: CLIENTES.find((c) => c.cliente.id === g.clienteId)?.cliente.nome ?? null,
    quando: g.quando,
    permiteDownload: g.permiteDownload,
    capa,
    capaItemId: capaId,
    favoritos: g.itens.filter((i) => FAVORITOS.has(i.id)).map((i) => i.id),
    itens: g.itens,
  };
}

export function favoritarExemplo(item: string, ligadoAgora: boolean): void {
  if (ligadoAgora) FAVORITOS.add(item);
  else FAVORITOS.delete(item);
}

export function urlsExemplo(item?: string): { id: string; nome: string; bytes: number | null; url: string }[] {
  const itens = GALERIAS.flatMap((g) => g.itens);
  const alvo = item ? itens.filter((i) => i.id === item) : (GALERIAS[0]?.itens ?? []);
  return alvo.map((i) => ({
    id: i.id,
    nome: i.nome,
    bytes: i.bytes,
    // Em exemplo o "alta resolução" é a própria foto de exemplo.
    url: i.poster ?? (i.miniatura ?? '').replace('mini-', 'foto-'),
  }));
}

export function criarGaleriaExemplo(clienteId: string, titulo: string): string {
  const id = `gal-${GALERIAS.length + 1}`;
  GALERIAS.unshift({
    id, clienteId, titulo, sessaoId: `ses-${id}`, quando: hoje, local: null,
    provedor: 'storage', url: null, permiteDownload: true, publicadaEm: null,
    capa: null, fotos: 0, videos: 0, bytes: 0, favoritos: 0, baixou: false,
    links: [], itens: [],
  });
  return id;
}

export function criarLinkExemplo(galeriaId: string): { linkId: string; token: string } {
  const g = GALERIAS.find((x) => x.id === galeriaId);
  const linkId = `lk-${Math.random().toString(36).slice(2, 8)}`;
  const token = `exemplo-${galeriaId}`;
  g?.links.push({ id: linkId, criadoEm: new Date().toISOString(), acessos: 0, ultimoAcessoEm: null });
  if (g && !g.publicadaEm) g.publicadaEm = new Date().toISOString();
  return { linkId, token };
}

export function revogarLinkExemplo(linkId: string): void {
  for (const g of GALERIAS) g.links = g.links.filter((l) => l.id !== linkId);
}

/** O "upload" do modo exemplo: object URL, com um progresso de mentirinha. */
export async function registrarItemExemplo(
  galeriaId: string,
  arquivo: File,
  aoProgredir: (f: number) => void,
): Promise<void> {
  const g = GALERIAS.find((x) => x.id === galeriaId);
  if (!g) throw new Error('Galeria não encontrada.');
  for (const passo of [0.15, 0.4, 0.7, 0.95]) {
    await new Promise((r) => setTimeout(r, 120));
    aoProgredir(passo);
  }
  const url = URL.createObjectURL(arquivo);
  g.itens.push({
    id: `g-novo-${g.itens.length + 1}`,
    tipo: arquivo.type.startsWith('video/') ? 'video' : 'foto',
    nome: arquivo.name,
    miniatura: url,
    poster: arquivo.type.startsWith('video/') ? url : null,
    largura: null,
    altura: null,
    duracao: null,
    bytes: arquivo.size,
  });
  if (!g.capa) g.capa = url;
  aoProgredir(1);
}

// ---------------------------------------------------------------------------
// Financeiro
//
// Os lançamentos saem do contrato, não de uma lista paralela: a mensalidade de
// exemplo é a mesma que a ficha do cliente mostra. Fora isso, o que existe aqui
// é o que a Astart tem de verdade na planilha — entrada de projeto, equipe,
// ferramentas, imposto.
// ---------------------------------------------------------------------------
interface LancamentoExemplo extends LancamentoNaLista {
  competencia: string;
}

const primeiroDoMes = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

const mesAtual = primeiroDoMes(agora);
const mesPassado = primeiroDoMes(new Date(agora.getFullYear(), agora.getMonth() - 1, 1));

/** Dia do mês de uma competência, sem escorregar em fevereiro. */
function diaDe(competencia: string, dia: number): string {
  const [ano, mes] = competencia.split('-').map(Number) as [number, number];
  const ultimo = new Date(ano, mes, 0).getDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

let seqLanc = 0;
function lanc(
  competencia: string,
  descricao: string,
  valorCentavos: number,
  resto: Partial<LancamentoExemplo> = {},
): LancamentoExemplo {
  seqLanc += 1;
  return {
    id: `l-${seqLanc}`,
    descricao,
    clienteNome: null,
    clienteId: null,
    natureza: 'receita',
    grupo: 'Receita de serviços',
    categoria: 'Serviços',
    subcategoria: 'Mensalidade',
    valorCentavos,
    vencimento: diaDe(competencia, 10),
    situacao: 'previsto',
    forma: 'pix',
    sugestao: null,
    competencia,
    ...resto,
  };
}

/** A mensalidade de cada contrato recorrente ativo, no mês pedido. */
function mensalidadesDo(competencia: string, situacao: SituacaoLancamento): LancamentoExemplo[] {
  return CLIENTES.flatMap((c) =>
    ativos(c)
      .filter((s) => s.formato === 'recorrente')
      .map((s) =>
        // O contrato de exemplo sempre tem valor; o nulo do tipo e do corte da
        // 0039 na LEITURA, nao do dado.
        lanc(competencia, `${s.servicoNome} — ${c.cliente.nome}`, s.valorCentavos ?? 0, {
          clienteId: c.cliente.id,
          clienteNome: c.cliente.nome,
          categoria: s.servicoNome,
          vencimento: diaDe(competencia, s.diaVencimento ?? 10),
          situacao,
        }),
      ),
  );
}

const LANCAMENTOS: LancamentoExemplo[] = [
  // Mês passado, fechado.
  ...mensalidadesDo(mesPassado, 'recebido'),
  lanc(mesPassado, 'Equipe — salários', 1_420_000, {
    natureza: 'custo', grupo: 'Pessoas', categoria: 'Equipe fixa', subcategoria: 'Salários',
    vencimento: diaDe(mesPassado, 5), situacao: 'pago', forma: 'transferência',
  }),
  lanc(mesPassado, 'Ferramentas e hospedagem', 185_000, {
    natureza: 'custo', grupo: 'Operação', categoria: 'Ferramentas', subcategoria: 'Assinaturas',
    vencimento: diaDe(mesPassado, 8), situacao: 'pago', forma: 'cartão',
  }),

  // Mês corrente.
  ...mensalidadesDo(mesAtual, 'previsto').map((l) =>
    // As duas primeiras já entraram; o resto vence ao longo do mês.
    l.clienteId === 'exemplo-mor' || l.clienteId === 'exemplo-pub'
      ? { ...l, situacao: 'recebido' as SituacaoLancamento }
      : l,
  ),
  lanc(mesAtual, 'Branding — entrada', 320_000, {
    clienteId: 'exemplo-kb', clienteNome: 'Karla Bernardo',
    categoria: 'Branding', subcategoria: 'Entrada de projeto',
    vencimento: emDias(-3), situacao: 'atrasado', forma: 'boleto',
  }),
  lanc(mesAtual, 'Website — parcela 2 de 3', 400_000, {
    clienteId: 'exemplo-mor', clienteNome: 'Mor Marcas',
    categoria: 'Website', subcategoria: 'Parcela de projeto',
    vencimento: diaDe(mesAtual, 20),
  }),
  lanc(mesAtual, 'Website — parcela 1 de 3', 600_000, {
    clienteId: 'exemplo-omnia', clienteNome: 'Omnia Engenharia',
    categoria: 'Website', subcategoria: 'Parcela de projeto',
    vencimento: diaDe(mesAtual, 25),
  }),
  lanc(mesAtual, 'Sistemas — parcela 1 de 6', 400_000, {
    clienteId: 'exemplo-omnia', clienteNome: 'Omnia Engenharia',
    categoria: 'Sistemas', subcategoria: 'Parcela de projeto',
    vencimento: diaDe(mesAtual, 25),
  }),
  lanc(mesAtual, 'Audiovisual — parcela 1 de 2', 120_000, {
    clienteId: 'exemplo-chopp', clienteNome: 'Chopp do Barbudo',
    categoria: 'Audiovisual', subcategoria: 'Parcela de projeto',
    vencimento: diaDe(mesAtual, 12), situacao: 'recebido',
  }),
  lanc(mesAtual, 'Equipe — salários', 1_420_000, {
    natureza: 'custo', grupo: 'Pessoas', categoria: 'Equipe fixa', subcategoria: 'Salários',
    vencimento: diaDe(mesAtual, 5), situacao: 'pago', forma: 'transferência',
  }),
  lanc(mesAtual, 'Ferramentas e hospedagem', 185_000, {
    natureza: 'custo', grupo: 'Operação', categoria: 'Ferramentas', subcategoria: 'Assinaturas',
    vencimento: diaDe(mesAtual, 8), situacao: 'pago', forma: 'cartão',
  }),
  lanc(mesAtual, 'Edição do making of', 95_000, {
    natureza: 'custo', grupo: 'Produção', categoria: 'Freelancer', subcategoria: 'A confirmar',
    vencimento: diaDe(mesAtual, 18), forma: 'pix',
    // Enquanto ninguém confirma, a classificação é palpite — e aparece como palpite.
    sugestao: 'Produção · Edição de vídeo',
  }),
  lanc(mesAtual, 'Simples Nacional', 236_700, {
    natureza: 'imposto', grupo: 'Impostos', categoria: 'Simples Nacional', subcategoria: 'DAS',
    vencimento: diaDe(mesAtual, 20), forma: 'boleto',
  }),
];

export function painelFinanceiroExemplo(mes?: string): PainelFinanceiro {
  // Mesma recusa da funcao do banco, e com a mesma cara: quem nao cuida do
  // dinheiro nao recebe um painel de zeros, recebe uma recusa.
  if (!veDinheiroExemplo() || papelDaVez === 'cliente') {
    throw new Error('O financeiro é de quem cuida do dinheiro da agência.');
  }
  const competencia = mes ? `${mes.slice(0, 7)}-01` : mesAtual;
  const doMes = LANCAMENTOS.filter((l) => l.competencia === competencia);
  const soma2 = (f: (l: LancamentoExemplo) => boolean) =>
    soma(doMes.filter(f).map((l) => l.valorCentavos));

  const porCliente = new Map<string, { clienteId: string; clienteNome: string; receitaCentavos: number; atrasadoCentavos: number }>();
  for (const l of doMes) {
    if (l.natureza !== 'receita' || !l.clienteId || l.situacao === 'cancelado') continue;
    const atual = porCliente.get(l.clienteId) ?? {
      clienteId: l.clienteId, clienteNome: l.clienteNome ?? '', receitaCentavos: 0, atrasadoCentavos: 0,
    };
    atual.receitaCentavos += l.valorCentavos;
    if (l.situacao === 'atrasado') atual.atrasadoCentavos += l.valorCentavos;
    porCliente.set(l.clienteId, atual);
  }

  return {
    mes: competencia,
    receitaCentavos: soma2((l) => l.natureza === 'receita' && l.situacao !== 'cancelado'),
    custoCentavos: soma2((l) => l.natureza === 'custo' && l.situacao !== 'cancelado'),
    recebidoCentavos: soma2((l) => l.natureza === 'receita' && l.situacao === 'recebido'),
    atrasadoCentavos: soma2((l) => l.natureza === 'receita' && l.situacao === 'atrasado'),
    lancamentos: doMes
      .slice()
      .sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? '')),
    porCliente: [...porCliente.values()].sort((a, b) => b.receitaCentavos - a.receitaCentavos),
  };
}

export function financeiroDoClienteExemplo(clienteId: string): FinanceiroDoCliente {
  const dele = LANCAMENTOS.filter((l) => l.clienteId === clienteId && l.natureza === 'receita');
  const somaSe = (f: (l: LancamentoExemplo) => boolean) =>
    soma(dele.filter(f).map((l) => l.valorCentavos));
  return {
    aVencerCentavos: somaSe((l) => l.situacao === 'previsto'),
    atrasadoCentavos: somaSe((l) => l.situacao === 'atrasado'),
    pagoNoAnoCentavos: somaSe((l) => l.situacao === 'recebido'),
    lancamentos: dele
      .slice()
      .sort((a, b) => (b.vencimento ?? '').localeCompare(a.vencimento ?? ''))
      .map((l) => ({
        id: l.id,
        descricao: l.descricao,
        valorCentavos: l.valorCentavos,
        vencimento: l.vencimento,
        competencia: l.competencia,
        situacao: l.situacao,
        // Boleto e pix só existem para o que ainda tem de ser pago.
        boletoUrl: l.situacao === 'previsto' || l.situacao === 'atrasado' ? '#boleto-de-exemplo' : null,
        pix:
          l.situacao === 'previsto' || l.situacao === 'atrasado'
            ? '00020126580014BR.GOV.BCB.PIX0136exemplo-astart-studio-chave-pix5204000053039865802BR6009SAO PAULO62070503***6304ABCD'
            : null,
      })),
  };
}

// ---------------------------------------------------------------------------
// Fila de publicação
//
// Mesma origem do calendário: as peças. Dois eixos, como no banco — o status do
// post e o estado de cada conta. Peça publicada em duas contas e falhada numa
// terceira é exatamente o caso que a tela precisa mostrar.
// ---------------------------------------------------------------------------
const NA_FILA: StatusPublicacao[] = ['aprovado', 'agendado', 'publicando', 'falhou', 'publicado'];

export function filaPublicacaoExemplo(): PecaNaFila[] {
  const limite = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  return PECAS.filter(
    (p) =>
      NA_FILA.includes(p.statusPublicacao) &&
      (p.statusPublicacao !== 'publicado' || p.dia >= limite),
  )
    .map((p) => ({
      id: p.id,
      clienteId: p.clienteId,
      clienteNome: CLIENTES.find((c) => c.cliente.id === p.clienteId)?.cliente.nome ?? '',
      titulo: p.titulo,
      tipo: p.tipo,
      status: p.statusPublicacao,
      quando: `${p.dia}T${p.hora}:00-03:00`,
      erro: p.statusPublicacao === 'falhou' ? 'O token do Instagram venceu.' : null,
      alvos: p.contas.map((conta) => ({
        conta,
        plataforma: 'instagram',
        estado:
          p.statusPublicacao === 'falhou'
            ? 'falhou'
            : p.statusPublicacao === 'publicado'
              ? 'publicado'
              : p.statusPublicacao === 'publicando'
                ? 'enviando'
                : 'na fila',
        erro: p.statusPublicacao === 'falhou' ? 'Token expirado (190).' : null,
        tentativas: p.statusPublicacao === 'falhou' ? 3 : p.statusPublicacao === 'publicando' ? 1 : 0,
      })),
    }))
    .sort((a, b) => {
      const falha = Number(b.status === 'falhou') - Number(a.status === 'falhou');
      return falha !== 0 ? falha : (a.quando ?? '').localeCompare(b.quando ?? '');
    });
}

// ---------------------------------------------------------------------------
// Agenda — tudo que tem data, no mesmo lugar
// ---------------------------------------------------------------------------
interface CaptacaoExemplo {
  clienteId: string;
  titulo: string;
  data: string;
  local: string;
}

const CAPTACOES: CaptacaoExemplo[] = [
  { clienteId: 'exemplo-chopp', titulo: 'Captação na fábrica', data: emDias(1), local: 'Fábrica, Bairro Industrial' },
  { clienteId: 'exemplo-mor', titulo: 'Ensaio de produto', data: emDias(9), local: 'Estúdio Astart' },
  { clienteId: 'exemplo-chopp', titulo: 'Captação de bastidores', data: emDias(22), local: 'Bar da Praça' },
];

const nomeDe = (clienteId: string) =>
  CLIENTES.find((c) => c.cliente.id === clienteId)?.cliente.nome ?? '';

export function agendaExemplo(de: string, ate: string): EventoNaAgenda[] {
  const dentro = (dia: string) => dia >= de && dia <= ate;
  const eventos: EventoNaAgenda[] = [];

  for (const p of PECAS) {
    if (!dentro(p.dia)) continue;
    eventos.push({
      tipo: 'publicacao', quando: p.dia, clienteId: p.clienteId,
      clienteNome: nomeDe(p.clienteId), oQue: p.titulo, detalhe: p.tipo,
    });
  }
  for (const c of CAPTACOES) {
    if (!dentro(c.data)) continue;
    eventos.push({
      tipo: 'captacao', quando: c.data, clienteId: c.clienteId,
      clienteNome: nomeDe(c.clienteId), oQue: c.titulo, detalhe: c.local,
    });
  }
  for (const cliente of CLIENTES) {
    for (const s of projetoExemplo(cliente.cliente.id)) {
      for (const m of s.marcos) {
        if (m.concluidoEm || !dentro(m.prazo)) continue;
        eventos.push({
          tipo: 'marco', quando: m.prazo, clienteId: cliente.cliente.id,
          clienteNome: cliente.cliente.nome, oQue: m.titulo, detalhe: s.servicoNome,
        });
      }
    }
  }
  for (const l of LANCAMENTOS) {
    if (l.natureza !== 'receita' || !l.vencimento || !l.clienteId) continue;
    if (l.situacao !== 'previsto' && l.situacao !== 'atrasado') continue;
    if (!dentro(l.vencimento)) continue;
    eventos.push({
      tipo: 'cobranca', quando: l.vencimento, clienteId: l.clienteId,
      clienteNome: l.clienteNome ?? '', oQue: l.descricao, detalhe: l.situacao,
    });
  }

  return eventos.sort((a, b) => a.quando.localeCompare(b.quando) || a.oQue.localeCompare(b.oQue, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// Grid — o feed como ele vai ficar
// ---------------------------------------------------------------------------
const NO_GRID: StatusPublicacao[] = ['aprovado', 'agendado', 'publicando', 'publicado'];

export function gridExemplo(clienteId: string): ItemDoGrid[] {
  return PECAS.filter((p) => p.clienteId === clienteId && NO_GRID.includes(p.statusPublicacao))
    .slice()
    .sort((a, b) => (b.dia + b.hora).localeCompare(a.dia + a.hora))
    .map((p, i) => {
      const item = p.itemId ? ITENS.find((x) => x.id === p.itemId) : null;
      return {
        id: p.id,
        titulo: p.titulo,
        tipo: p.tipo,
        status: p.statusPublicacao,
        estado: item?.estado ?? 'produzindo',
        quando: `${p.dia}T${p.hora}:00-03:00`,
        capa: publico(`exemplo/mini-0${(i % 8) + 1}.jpg`),
      };
    });
}

// ---------------------------------------------------------------------------
// Feedbacks (NPS)
//
// Uma tabela mutável, como as outras: quando o cliente dá a nota no portal, o
// resumo da equipe muda na mesma hora.
// ---------------------------------------------------------------------------
interface PesquisaExemplo {
  id: string;
  clienteId: string;
  competencia: string;
  nota: number | null;
  comentario: string | null;
  quem: string | null;
  quando: string | null;
}

const PESQUISAS: PesquisaExemplo[] = [
  { id: 'nps-1', clienteId: 'exemplo-mor', competencia: mesAtual, nota: null, comentario: null, quem: null, quando: null },
  { id: 'nps-2', clienteId: 'exemplo-omnia', competencia: mesAtual, nota: null, comentario: null, quem: null, quando: null },
  { id: 'nps-3', clienteId: 'exemplo-pub', competencia: mesAtual, nota: 10,
    comentario: 'Resposta rápida e material no ponto.', quem: 'Thiago Prado', quando: haHoras(60) },
  { id: 'nps-4', clienteId: 'exemplo-chopp', competencia: mesAtual, nota: 9,
    comentario: null, quem: 'Ana Paula', quando: haHoras(100) },
  { id: 'nps-5', clienteId: 'exemplo-pam', competencia: mesAtual, nota: 4,
    comentario: 'Demora pra responder no WhatsApp.', quem: 'Pamela Dantas', quando: haHoras(120) },
  { id: 'nps-6', clienteId: 'exemplo-mor', competencia: mesPassado, nota: 9,
    comentario: 'A entrega do mês ficou ótima.', quem: 'Bruna Melo', quando: emDias(-34) },
  { id: 'nps-7', clienteId: 'exemplo-pub', competencia: mesPassado, nota: 10, comentario: null, quem: 'Thiago Prado', quando: emDias(-33) },
  { id: 'nps-8', clienteId: 'exemplo-chopp', competencia: mesPassado, nota: 8,
    comentario: 'Só senti falta de mais stories.', quem: 'Ana Paula', quando: emDias(-31) },
  { id: 'nps-9', clienteId: 'exemplo-kb', competencia: mesPassado, nota: 6,
    comentario: 'Travou no meio do projeto, voltou depois.', quem: 'Karla Bernardo', quando: emDias(-30) },
];

export function npsResumoExemplo(): ResumoNps {
  const respondidas = PESQUISAS.filter((p): p is PesquisaExemplo & { nota: number } => p.nota !== null);
  const conta2 = (f: (n: number) => boolean) => respondidas.filter((p) => f(p.nota)).length;
  const total = respondidas.length;
  const promotores = conta2((n) => n >= 9);
  const detratores = conta2((n) => n <= 6);

  return {
    respostas: total,
    promotores,
    neutros: conta2((n) => n >= 7 && n <= 8),
    detratores,
    nps: total === 0 ? null : Math.round(((promotores - detratores) / total) * 100),
    ultimas: respondidas
      .filter((p) => p.comentario !== null || p.nota <= 6)
      .slice()
      .sort((a, b) => (b.quando ?? '').localeCompare(a.quando ?? ''))
      .map((p) => ({
        nota: p.nota,
        comentario: p.comentario,
        quem: p.quem,
        quando: p.quando ?? '',
        clienteNome: nomeDe(p.clienteId),
        clienteId: p.clienteId,
      })),
    semResposta: PESQUISAS.filter((p) => p.nota === null)
      .map((p) => ({ clienteNome: nomeDe(p.clienteId), competencia: p.competencia }))
      .sort((a, b) => b.competencia.localeCompare(a.competencia)),
  };
}

export function npsDoClienteExemplo(clienteId: string): NpsDoCliente {
  const dele = PESQUISAS.filter((p) => p.clienteId === clienteId);
  const pendente = dele
    .filter((p) => p.nota === null)
    .sort((a, b) => b.competencia.localeCompare(a.competencia))[0];
  return {
    pendente: pendente ? { id: pendente.id, competencia: pendente.competencia } : null,
    respondidas: dele
      .filter((p): p is PesquisaExemplo & { nota: number } => p.nota !== null)
      .sort((a, b) => b.competencia.localeCompare(a.competencia))
      .map((p) => ({
        competencia: p.competencia,
        nota: p.nota,
        comentario: p.comentario,
        quando: p.quando ?? '',
      })),
  };
}

/** Mesma trava da função do banco: a mesma pesquisa não se responde duas vezes. */
export function responderNpsExemplo(pesquisaId: string, nota: number, comentario?: string): void {
  const p = PESQUISAS.find((x) => x.id === pesquisaId);
  if (!p) throw new Error('Pesquisa não encontrada.');
  if (p.nota !== null) throw new Error('Esta pesquisa já foi respondida.');
  p.nota = nota;
  p.comentario = comentario?.trim() || null;
  p.quem = SESSAO_CLIENTE.tipo === 'cliente' ? SESSAO_CLIENTE.nome : null;
  p.quando = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Comercial — o funil
// ---------------------------------------------------------------------------
const FECHADAS: EtapaLead[] = ['fechado', 'perdido', 'descartado'];

const LEADS: (LeadNoFunil & { convertidoEm: string | null })[] = [
  {
    id: 'ld-1', nome: 'Renata Alves', empresa: 'Clínica Viva', etapa: 'proposta_enviada',
    valorCentavos: 450_000, origem: 'indicação', proximoPasso: 'Ligar para fechar',
    proximoEm: emDias(1), responsavelNome: 'Layana', ultimaEm: emDias(-2), convertidoEm: null,
  },
  {
    id: 'ld-2', nome: 'Diego Matos', empresa: 'Matos Advocacia', etapa: 'reuniao_agendada',
    valorCentavos: 320_000, origem: 'Instagram', proximoPasso: 'Reunião às 15h',
    proximoEm: emDias(2), responsavelNome: 'Viviane', ultimaEm: emDias(-1), convertidoEm: null,
  },
  {
    id: 'ld-3', nome: 'Juliana Prado', empresa: 'Doce Ponto', etapa: 'em_conversa',
    valorCentavos: 190_000, origem: 'Google', proximoPasso: 'Mandar portfólio de food',
    proximoEm: hoje, responsavelNome: 'Layana', ultimaEm: emDias(-4), convertidoEm: null,
  },
  {
    id: 'ld-4', nome: 'Sérgio Lima', empresa: 'Lima Construções', etapa: 'qualificado',
    valorCentavos: 1_200_000, origem: 'indicação', proximoPasso: 'Levantar escopo do site',
    proximoEm: emDias(3), responsavelNome: 'Viviane', ultimaEm: emDias(-6), convertidoEm: null,
  },
  {
    id: 'ld-5', nome: 'Camila Rocha', empresa: null, etapa: 'novo_lead',
    valorCentavos: null, origem: 'WhatsApp', proximoPasso: 'Primeiro contato',
    proximoEm: hoje, responsavelNome: null, ultimaEm: null, convertidoEm: null,
  },
  {
    id: 'ld-6', nome: 'Fábio Nunes', empresa: 'Nunes Pneus', etapa: 'negociacao',
    valorCentavos: 280_000, origem: 'Instagram', proximoPasso: 'Responder contraproposta',
    proximoEm: emDias(-1), responsavelNome: 'Layana', ultimaEm: emDias(-3), convertidoEm: null,
  },
  {
    id: 'ld-7', nome: 'Marcos Lopes', empresa: 'Omnia Engenharia', etapa: 'fechado',
    valorCentavos: 4_200_000, origem: 'indicação', proximoPasso: null,
    proximoEm: null, responsavelNome: 'Viviane', ultimaEm: emDias(-20), convertidoEm: emDias(-18),
  },
  {
    id: 'ld-8', nome: 'Paula Freitas', empresa: 'Freitas Odonto', etapa: 'perdido',
    valorCentavos: 240_000, origem: 'Google', proximoPasso: null,
    proximoEm: null, responsavelNome: 'Layana', ultimaEm: emDias(-25), convertidoEm: null,
  },
];

export function funilExemplo(): Funil {
  if (!veDinheiroExemplo() || papelDaVez === 'cliente') {
    throw new Error('O comercial é de quem cuida do dinheiro da agência.');
  }
  const abertos = LEADS.filter((l) => !FECHADAS.includes(l.etapa));
  const inicioDoMes = mesAtual;
  return {
    abertos: abertos.length,
    valorAbertoCentavos: soma(abertos.map((l) => l.valorCentavos ?? 0)),
    fechadosNoMes: LEADS.filter((l) => l.convertidoEm && l.convertidoEm >= inicioDoMes).length,
    leads: abertos
      .slice()
      .sort((a, b) => (a.proximoEm ?? '9999').localeCompare(b.proximoEm ?? '9999')),
  };
}

/** Mesma trava do banco: perdido exige motivo. */
export function moverLeadExemplo(leadId: string, etapa: EtapaLead, motivo?: string): void {
  if (!veDinheiroExemplo() || papelDaVez === 'cliente') {
    throw new Error('O comercial é de quem cuida do dinheiro da agência.');
  }
  const l = LEADS.find((x) => x.id === leadId);
  if (!l) throw new Error('Lead não encontrado.');
  if (etapa === 'perdido' && !motivo?.trim()) throw new Error('Lead perdido precisa de motivo.');
  l.etapa = etapa;
  l.ultimaEm = new Date().toISOString();
  if (etapa === 'fechado') l.convertidoEm = hoje;
  if (FECHADAS.includes(etapa)) {
    l.proximoPasso = null;
    l.proximoEm = null;
  }
}

// ---------------------------------------------------------------------------
// Campanhas — o relatório do tráfego
// ---------------------------------------------------------------------------
const RELATORIOS: (RelatorioDeCampanha & { clienteId: string })[] = [
  {
    id: 'rel-1', clienteId: 'exemplo-pub', de: mesPassado, ate: diaDe(mesPassado, 31),
    arquivo: 'publika-relatorio-outubro.pdf',
    metricas: [
      { rotulo: 'Alcance', valor: 184_320 },
      { rotulo: 'Cliques no link', valor: 3_914 },
      { rotulo: 'Conversas iniciadas', valor: 212 },
      { rotulo: 'Custo por conversa', valor: 7.08 },
    ],
    campanhas: [
      { nome: 'Lançamento — tráfego frio', plataforma: 'Meta Ads', objetivo: 'Mensagens',
        verbaCentavos: 90_000, resultadoRotulo: 'Conversas', resultadoValor: 128 },
      { nome: 'Remarketing — quem viu o vídeo', plataforma: 'Meta Ads', objetivo: 'Mensagens',
        verbaCentavos: 60_000, resultadoRotulo: 'Conversas', resultadoValor: 84 },
    ],
  },
  {
    id: 'rel-2', clienteId: 'exemplo-pub',
    de: primeiroDoMes(new Date(agora.getFullYear(), agora.getMonth() - 2, 1)),
    ate: diaDe(primeiroDoMes(new Date(agora.getFullYear(), agora.getMonth() - 2, 1)), 31),
    arquivo: 'publika-relatorio-setembro.pdf',
    metricas: [
      { rotulo: 'Alcance', valor: 151_880 },
      { rotulo: 'Cliques no link', valor: 3_102 },
      { rotulo: 'Conversas iniciadas', valor: 166 },
      { rotulo: 'Custo por conversa', valor: 9.03 },
    ],
    campanhas: [
      { nome: 'Sempre no ar', plataforma: 'Meta Ads', objetivo: 'Alcance',
        verbaCentavos: 150_000, resultadoRotulo: 'Conversas', resultadoValor: 166 },
    ],
  },
];

export function campanhasExemplo(clienteId: string): RelatorioDeCampanha[] {
  return RELATORIOS.filter((r) => r.clienteId === clienteId);
}

// ---------------------------------------------------------------------------
// Arquivos do cliente: contrato, proposta, relatório, NPS (0053/0054)
//
// O modo exemplo guarda o arquivo no navegador, com `URL.createObjectURL`.
// Isto não é enfeite de demonstração: sem ele, o roteiro de tela não consegue
// exercitar a subida — ele roda em modo exemplo, e o caminho inteiro (arrastar,
// aparecer, mostrar ao cliente, tirar) ficaria sem teste de navegador nenhum.
// Já paguei essa conta duas vezes nesta semana.
// ---------------------------------------------------------------------------
const DOCUMENTOS = new Map<string, DocumentoDoCliente[]>([
  ['exemplo-mor', [
    {
      id: 'doc-1', tipo: 'contrato', nome: 'Contrato Mor Marcas 2026.pdf',
      caminho: 'exemplo/contrato.pdf', visivelAoCliente: true,
      enviadoEm: emDias(-120), url: null,
    },
    {
      id: 'doc-2', tipo: 'proposta', nome: 'Proposta com margem (interno).pdf',
      caminho: 'exemplo/proposta.pdf', visivelAoCliente: false,
      enviadoEm: emDias(-131), url: null,
    },
  ]],
]);

export function documentosExemplo(clienteId: string): DocumentoDoCliente[] {
  const lista = DOCUMENTOS.get(clienteId) ?? [];
  // O portal do cliente vê só o que foi liberado — o mesmo filtro que a função
  // do banco aplica. Se os dois discordarem, o roteiro acusa.
  return papelDaVez === 'cliente' ? lista.filter((d) => d.visivelAoCliente) : lista;
}

export function registrarDocumentoExemplo(
  clienteId: string,
  tipo: TipoDocumento,
  nome: string,
  arquivo: File,
): { visivelAoCliente: boolean } {
  const lista = DOCUMENTOS.get(clienteId) ?? [];
  // A MESMA regra da 0053: contrato nasce visível, o resto nasce fechado.
  const visivelAoCliente = tipo === 'contrato';
  lista.unshift({
    id: crypto.randomUUID(),
    tipo,
    nome,
    caminho: `exemplo/${arquivo.name}`,
    visivelAoCliente,
    enviadoEm: new Date().toISOString(),
    url: URL.createObjectURL(arquivo),
  });
  DOCUMENTOS.set(clienteId, lista);
  return { visivelAoCliente };
}

export function removerDocumentoExemplo(id: string): void {
  for (const [cliente, lista] of DOCUMENTOS) {
    const i = lista.findIndex((d) => d.id === id);
    if (i >= 0) {
      const [fora] = lista.splice(i, 1);
      if (fora?.url) URL.revokeObjectURL(fora.url);
      DOCUMENTOS.set(cliente, lista);
      return;
    }
  }
}

export function mudarVisibilidadeExemplo(id: string, visivel: boolean): void {
  for (const lista of DOCUMENTOS.values()) {
    const d = lista.find((x) => x.id === id);
    if (d) {
      d.visivelAoCliente = visivel;
      return;
    }
  }
}

export function relatorioExemplo(
  clienteId: string,
  de: string,
  ate: string,
  nome: string,
  arquivo: File,
): void {
  // Um relatório por período, como o índice único da 0021: reenviar o mesmo
  // período troca o arquivo em vez de criar uma segunda linha.
  //
  // `existente` em vez de indexar duas vezes: com `noUncheckedIndexedAccess`
  // ligado, `RELATORIOS[i]` é possivelmente undefined mesmo depois de um
  // `findIndex` que achou — e o TypeScript está certo em desconfiar, porque
  // nada impede o array de mudar entre as linhas.
  const i = RELATORIOS.findIndex(
    (r) => r.clienteId === clienteId && r.de === de && r.ate === ate,
  );
  const existente = i >= 0 ? RELATORIOS[i] : undefined;
  const linha = {
    id: existente?.id ?? crypto.randomUUID(),
    clienteId,
    de,
    ate,
    arquivo: nome,
    arquivoCaminho: URL.createObjectURL(arquivo),
    // Métrica digitada não existe nesta versão: o relatório é o arquivo.
    metricas: existente?.metricas ?? [],
    campanhas: existente?.campanhas ?? [],
  };
  if (existente) RELATORIOS[i] = linha;
  else RELATORIOS.unshift(linha);
}

export function removerRelatorioExemplo(id: string): void {
  const i = RELATORIOS.findIndex((r) => r.id === id);
  if (i >= 0) RELATORIOS.splice(i, 1);
}

// ---------------------------------------------------------------------------
// Ambientes, domínios e chamados
// ---------------------------------------------------------------------------
const AMBIENTES: Record<string, AmbientesDoCliente> = {
  'exemplo-omnia': {
    ambientes: [
      { id: 'am-1', nome: 'Produção', url: 'https://omniaengenharia.com.br',
        hospedagem: 'Vercel', sslRenovaEm: emDias(54), noAr: true },
      { id: 'am-2', nome: 'Homologação', url: 'https://staging.omniaengenharia.com.br',
        hospedagem: 'Vercel', sslRenovaEm: emDias(54), noAr: true },
    ],
    dominios: [
      { dominio: 'omniaengenharia.com.br', registrador: 'Registro.br',
        titular: 'Omnia Engenharia LTDA', venceEm: emDias(210) },
    ],
    chamados: [
      { id: 'ch-1', titulo: 'Formulário de contato não envia no celular',
        prioridade: 'alta', status: 'em_andamento', abertoEm: emDias(-2) },
      { id: 'ch-2', titulo: 'Trocar o telefone do rodapé',
        prioridade: 'baixa', status: 'resolvido', abertoEm: emDias(-14) },
    ],
  },
  'exemplo-mor': {
    ambientes: [
      { id: 'am-3', nome: 'Produção', url: 'https://mormarcas.com.br',
        hospedagem: 'Vercel', sslRenovaEm: emDias(31), noAr: false },
    ],
    dominios: [
      { dominio: 'mormarcas.com.br', registrador: 'Registro.br',
        titular: 'Mor Marcas ME', venceEm: emDias(96) },
    ],
    chamados: [],
  },
};

const VAZIO_AMBIENTES: AmbientesDoCliente = { ambientes: [], dominios: [], chamados: [] };

export function ambientesExemplo(clienteId: string): AmbientesDoCliente {
  return AMBIENTES[clienteId] ?? VAZIO_AMBIENTES;
}

let seqChamado = 0;

/**
 * Mesma ordem de conferência da função do banco, inclusive o módulo: sem
 * manutenção no contrato, a função recusa — não é a tela que esconde o botão.
 */
export function abrirChamadoExemplo(
  clienteId: string,
  titulo: string,
  descricao?: string,
  prioridade = 'media',
): void {
  const c = CLIENTES.find((x) => x.cliente.id === clienteId);
  if (!c) throw new Error('Cliente não encontrado.');
  if (!titulo.trim()) throw new Error('Diga em uma linha o que está acontecendo.');
  if (!modulosDe(c.servicos, c.extras).includes('manutencao')) {
    throw new Error('Este cliente não tem manutenção no contrato.');
  }
  seqChamado += 1;
  const alvo = AMBIENTES[clienteId] ?? (AMBIENTES[clienteId] = { ambientes: [], dominios: [], chamados: [] });
  alvo.chamados.unshift({
    id: `ch-novo-${seqChamado}`,
    titulo: titulo.trim(),
    prioridade,
    status: 'aberto',
    abertoEm: new Date().toISOString(),
  });
  // `descricao` existe no banco e aparece quando a equipe abre o chamado; a
  // lista do cliente mostra só o título.
  void descricao;
}

// ---------------------------------------------------------------------------
// O que só o admin faz
// ---------------------------------------------------------------------------

/** Mesmas travas de `mudar_papel()`: só admin, e a casa não fica sem admin. */
export function mudarPapelExemplo(userId: string, papel: PapelEquipe): void {
  if (papelDaVez !== 'admin') {
    throw new Error('Só quem administra a plataforma muda papel.');
  }
  const p = PESSOAS.find((x) => x.userId === userId);
  if (!p) throw new Error('Essa pessoa não está na equipe.');
  if (p.papel === papel) return;
  if (p.papel === 'admin' && papel !== 'admin'
      && PESSOAS.filter((x) => x.papel === 'admin' && x.ativo).length <= 1) {
    throw new Error('Precisa de outra pessoa administrando antes de sair.');
  }
  p.papel = papel;
}

export function desativarClienteExemplo(clienteId: string): void {
  if (papelDaVez !== 'admin') {
    throw new Error('Só quem administra a plataforma tira um cliente do ar.');
  }
  const c = CLIENTES.find((x) => x.cliente.id === clienteId);
  if (!c) throw new Error('Cliente não encontrado.');
  c.cliente.ativo = false;
  for (const s of c.servicos) if (s.status === 'ativo') s.status = 'encerrado';
  for (const u of c.contatos) u.ativo = false;
}

export function reativarClienteExemplo(clienteId: string): void {
  if (papelDaVez !== 'admin') {
    throw new Error('Só quem administra a plataforma reativa um cliente.');
  }
  const c = CLIENTES.find((x) => x.cliente.id === clienteId);
  if (!c) throw new Error('Cliente não encontrado.');
  c.cliente.ativo = true;
  // Os serviços não voltam sozinhos, igual à função do banco: quanto custa o
  // contrato novo é decisão de alguém, não de um clique.
}

/**
 * Apaga o cliente de verdade, como a 0060 — inclusive com historico.
 *
 * Antes recusava com "ja tem N registros. Tire do ar em vez de apagar", e o
 * modo exemplo tinha de recusar junto, senao a demonstracao ensinaria o
 * contrario do que a producao faz. A dona mudou a regra; o exemplo muda junto,
 * pelo mesmo motivo.
 */
export function removerClienteExemplo(clienteId: string): ResumoDaRemocao {
  if (papelDaVez !== 'admin') {
    throw new Error('Só quem administra a plataforma remove um cliente.');
  }
  const i = CLIENTES.findIndex((x) => x.cliente.id === clienteId);
  if (i < 0) throw new Error('Cliente não encontrado.');

  const aprovacoes = ITENS.filter((x) => x.clienteId === clienteId).length;
  const publicacoes = PECAS.filter((x) => x.clienteId === clienteId).length;
  const lancamentos = LANCAMENTOS.filter((x) => x.clienteId === clienteId).length;
  const galerias = GALERIAS.filter((x) => x.clienteId === clienteId);
  const arquivos = galerias.reduce((a, g) => a + g.itens.length, 0);

  // O cascade do banco, imitado: o que pendura no cliente sai junto. Sem isto,
  // a demonstracao mostraria peca orfa de cliente que nao existe mais.
  const fora = (lista: { clienteId: string }[]) => {
    for (let n = lista.length - 1; n >= 0; n -= 1) {
      if (lista[n]?.clienteId === clienteId) lista.splice(n, 1);
    }
  };
  fora(ITENS);
  fora(PECAS);
  fora(LANCAMENTOS);
  fora(GALERIAS);

  const nome = CLIENTES[i]?.cliente.nome ?? 'Cliente';
  CLIENTES.splice(i, 1);

  return {
    nome,
    publicacoes,
    aprovacoes,
    lancamentos,
    captacoes: galerias.length,
    contas: 0,
    documentos: 0,
    arquivosApagados: arquivos,
  };
}

// ---------------------------------------------------------------------------
// O link de aprovação sem conta
//
// Os lotes nascem dos mesmos ITENS que a fila da equipe e o portal leem. Em
// modo exemplo há um lote pronto no cliente de exemplo, para o endereço
// /a/exemplo abrir sem ninguém ter de enviar nada primeiro.
// ---------------------------------------------------------------------------
interface EnvioExemplo {
  id: string;
  clienteId: string;
  mensagem: string | null;
  quando: string;
  itens: string[];
  links: (LinkDeAprovacao & { token: string; revogado: boolean })[];
}

const ENVIOS: EnvioExemplo[] = [
  {
    id: 'env-1',
    clienteId: 'exemplo-mor',
    mensagem: 'Separei as três dessa semana. Qualquer coisa me fala.',
    quando: haHoras(30),
    itens: ['i1', 'i2', 'i3'],
    links: [
      { id: 'lk-ap-1', token: 'exemplo', criadoEm: haHoras(30), acessos: 2, ultimoAcessoEm: haHoras(4), revogado: false },
    ],
  },
];

let seqEnvio = 0;

function envioDoToken(token: string): EnvioExemplo | null {
  return ENVIOS.find((e) => e.links.some((l) => l.token === token && !l.revogado)) ?? null;
}

function comoItemDoLote(id: string): ItemDoLote | null {
  const i = ITENS.find((x) => x.id === id);
  if (!i) return null;
  return {
    id: i.id,
    tipo: i.tipo,
    titulo: i.titulo,
    estado: i.estado,
    respondidoPor: i.respondidoPor,
    respondidoEm: i.respondidoEm,
    comentario: i.comentario,
  };
}

function montarLote(e: EnvioExemplo): LoteDoLink {
  const itens = e.itens.map(comoItemDoLote).filter((x): x is ItemDoLote => x !== null);
  return {
    cliente: nomeDe(e.clienteId),
    mensagem: e.mensagem,
    quando: e.quando,
    // Mesma regra do banco: o lote fecha quando o último item é respondido.
    fechado: itens.length > 0 && itens.every((i) => i.estado !== 'em_aprovacao'),
    itens,
  };
}

/** Token errado ou revogado erra igual: não conta se o lote existe. */
export function loteExemplo(token: string): LoteDoLink {
  const e = envioDoToken(token);
  if (!e) throw new Error('Este link não vale mais.');
  const link = e.links.find((l) => l.token === token);
  if (link) {
    link.acessos += 1;
    link.ultimoAcessoEm = new Date().toISOString();
  }
  return montarLote(e);
}

export function responderLoteExemplo(
  token: string,
  item: string,
  decisao: Decisao,
  quem: string,
  comentario?: string,
): LoteDoLink {
  const e = envioDoToken(token);
  if (!e) throw new Error('Este link não vale mais.');
  // A trava que importa: token vazado responde aquele lote, não o cliente todo.
  if (!e.itens.includes(item)) throw new Error('Este item não é deste link.');
  responderExemplo(item, decisao, quem, comentario);
  return montarLote(e);
}

export function enviosExemplo(clienteId: string): EnvioNaFicha[] {
  return ENVIOS.filter((e) => e.clienteId === clienteId).map((e) => {
    const itens = e.itens.map(comoItemDoLote).filter((x): x is ItemDoLote => x !== null);
    const respondidos = itens.filter((i) => i.estado !== 'em_aprovacao').length;
    return {
      id: e.id,
      mensagem: e.mensagem,
      quando: e.quando,
      fechadoEm: respondidos === itens.length && itens.length > 0 ? e.quando : null,
      itens: itens.length,
      respondidos,
      links: e.links.filter((l) => !l.revogado).map((l) => ({
        id: l.id, criadoEm: l.criadoEm, acessos: l.acessos, ultimoAcessoEm: l.ultimoAcessoEm,
      })),
    };
  });
}

export function criarLinkAprovacaoExemplo(envioId: string): { linkId: string; token: string } {
  const e = ENVIOS.find((x) => x.id === envioId);
  if (!e) throw new Error('Envio não encontrado.');
  seqEnvio += 1;
  const token = `exemplo-${envioId}-${seqEnvio}`;
  const linkId = `lk-ap-${seqEnvio + 1}`;
  e.links.push({ id: linkId, token, criadoEm: new Date().toISOString(), acessos: 0, ultimoAcessoEm: null, revogado: false });
  return { linkId, token };
}

export function revogarLinkAprovacaoExemplo(linkId: string): void {
  for (const e of ENVIOS) {
    const l = e.links.find((x) => x.id === linkId);
    if (l) l.revogado = true;
  }
}

/** O lote que `enviar_para_aprovacao()` cria, para a ficha mostrar na hora. */
export function registrarEnvioExemplo(clienteId: string, itens: string[], mensagem?: string): string {
  seqEnvio += 1;
  const id = `env-novo-${seqEnvio}`;
  ENVIOS.unshift({
    id, clienteId, mensagem: mensagem?.trim() || null,
    quando: new Date().toISOString(), itens, links: [],
  });
  return id;
}
