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
  ChaveModulo, ChaveServico, Cliente, ClienteNaLista, Decisao, FichaCliente,
  ItemNaFila, PainelCliente, PainelEquipe, Perfil, ServicoContratado, Sessao,
} from './tipos';

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

export const SESSAO_EQUIPE: Sessao = { tipo: 'equipe', perfil: PERFIL_EXEMPLO };

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
      { nome: 'Bruna Melo', email: 'bruna@mormarcas.com.br', papel: 'principal', ativo: true },
      { nome: 'Ricardo Mor', email: 'financeiro@mormarcas.com.br', papel: 'financeiro', ativo: true },
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
      { nome: 'Thiago Prado', email: 'thiago@publika.ai', papel: 'principal', ativo: true },
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
      { nome: 'Ana Paula', email: 'ana@choppdobarbudo.com.br', papel: 'principal', ativo: true },
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
      { nome: 'Karla Bernardo', email: 'contato@karlabernardo.com', papel: 'principal', ativo: true },
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
      { nome: 'Marcos Lopes', email: 'marcos@omniaengenharia.com.br', papel: 'principal', ativo: true },
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
      { nome: 'Pamela Dantas', email: 'pamela@pameladantas.com', papel: 'principal', ativo: true },
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

function mensalDe(c: ClienteExemplo) {
  return soma(ativos(c).filter((s) => s.formato === 'recorrente').map((s) => s.valorCentavos));
}
function unicoDe(c: ClienteExemplo) {
  return soma(ativos(c).filter((s) => s.formato !== 'recorrente').map((s) => s.valorCentavos));
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
    servicos: c.servicos,
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
    npsPendente: true,
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
