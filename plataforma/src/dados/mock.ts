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
  Catalogo, ChaveModulo, ChaveServico, Cliente, ClienteNaLista, ClienteNovo, Decisao,
  ConviteAberto, EntregavelNoProjeto, EquipeEConvites, FichaCliente, FormatoContrato,
  ItemNaFila, MesDeConteudo, PainelCliente, PainelEquipe, PecaNoMes, Perfil,
  PedidoDeConvite, PessoaDaEquipe, ServicoContratado, ServicoEscolhido, ServicoNoProjeto,
  Sessao, StatusPublicacao, TipoPeca,
} from './tipos';

import { sluguificar } from '../formato';

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

export function enviarExemplo(itemIds: string[]): number {
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
