// Dados fictícios da fase visual. Nenhuma chamada de rede acontece aqui — quando
// o schema for aprovado, cada função vira uma query Supabase com o mesmo formato.

import type { Cliente, Perfil, Post, PostAlvo } from './tipos';

export const EQUIPE: Perfil[] = [
  { id: 'amanda', nome: 'Amanda', papel: 'admin', cor: '#ea1a6e', ativo: true },
  { id: 'rafael', nome: 'Rafael', papel: 'operacao', cor: '#111111', ativo: true },
  { id: 'juliana', nome: 'Juliana', papel: 'operacao', cor: '#6b2d4e', ativo: true },
  { id: 'bruno', nome: 'Bruno', papel: 'financeiro', cor: '#8a7f84', ativo: true },
  { id: 'carla', nome: 'Carla', papel: 'leitura', cor: '#111111', ativo: true },
];

export const CLIENTES: Cliente[] = [
  {
    id: 'mor',
    nome: 'Mor Marcas',
    slug: 'mor-marcas',
    cor: '#ea1a6e',
    fusoHorario: 'America/Sao_Paulo',
    ativo: true,
    desde: '03/2025',
    contas: [
      {
        id: 'mor-ig',
        clienteId: 'mor',
        plataforma: 'instagram',
        nomeExibicao: '@mormarcas',
        identificador: '17841400000000001',
        origemToken: 'system_user',
        tokenExpiraEm: null,
        tokenRef: null,
        acessoParceiro: 'concedido',
        ativo: true,
      },
    ],
    linkAprovacao: { expiraEm: '12/09/2026', revogado: false },
  },
  {
    id: 'publika',
    nome: 'Publika.ai',
    slug: 'publika-ai',
    cor: '#111111',
    fusoHorario: 'America/Sao_Paulo',
    ativo: true,
    desde: '08/2025',
    contas: [
      {
        id: 'pub-ig',
        clienteId: 'publika',
        plataforma: 'instagram',
        nomeExibicao: '@publika.ai',
        identificador: '17841400000000002',
        origemToken: 'system_user',
        tokenExpiraEm: null,
        tokenRef: null,
        acessoParceiro: 'concedido',
        ativo: true,
      },
      {
        id: 'pub-fb',
        clienteId: 'publika',
        plataforma: 'facebook',
        nomeExibicao: 'Publika.ai',
        identificador: '555000000000002',
        origemToken: 'system_user',
        tokenExpiraEm: null,
        tokenRef: null,
        acessoParceiro: 'concedido',
        ativo: true,
      },
    ],
    linkAprovacao: { expiraEm: '02/09/2026', revogado: false },
  },
  {
    id: 'confraria',
    nome: 'Confraria Somos',
    slug: 'confraria-somos',
    cor: '#6b2d4e',
    fusoHorario: 'America/Sao_Paulo',
    ativo: true,
    desde: '01/2026',
    contas: [
      {
        id: 'con-ig',
        clienteId: 'confraria',
        plataforma: 'instagram',
        nomeExibicao: '@confrariasomos',
        identificador: '17841400000000003',
        origemToken: 'system_user',
        tokenExpiraEm: null,
        tokenRef: null,
        acessoParceiro: 'pendente',
        ativo: true,
      },
    ],
    linkAprovacao: { expiraEm: '20/08/2026', revogado: false },
  },
  {
    id: 'pamela',
    nome: 'Pamela Dantas',
    slug: 'pamela-dantas',
    cor: '#8a7f84',
    fusoHorario: 'America/Recife',
    ativo: true,
    desde: '05/2026',
    contas: [
      {
        id: 'pam-ig',
        clienteId: 'pamela',
        plataforma: 'instagram',
        nomeExibicao: '@pameladantas.capilar',
        identificador: '17841400000000004',
        // Cliente sem Business Manager: caiu na exceção de OAuth.
        origemToken: 'oauth',
        tokenExpiraEm: '18/09/2026',
        tokenRef: 'token_pamela_dantas',
        acessoParceiro: 'concedido',
        ativo: true,
      },
    ],
    linkAprovacao: null,
  },
  {
    id: 'gustavo',
    nome: 'Gustavo Arq',
    slug: 'gustavo-arq',
    cor: '#8a7f84',
    fusoHorario: 'America/Sao_Paulo',
    ativo: false,
    desde: '09/2025',
    contas: [
      {
        id: 'gus-ig',
        clienteId: 'gustavo',
        plataforma: 'instagram',
        nomeExibicao: '@gustavo.arq',
        identificador: '17841400000000005',
        origemToken: 'system_user',
        tokenExpiraEm: null,
        tokenRef: null,
        acessoParceiro: 'expirado',
        ativo: false,
      },
    ],
    linkAprovacao: null,
  },
];

export const POSTS: Post[] = [
  { id: 'p01', clienteId: 'mor', tituloInterno: 'Pesquisa de anterioridade no INPI', tipo: 'imagem', legenda: '', primeiroComentario: null, dia: 3, hora: '09:00', status: 'publicado' },
  { id: 'p05', clienteId: 'mor', tituloInterno: 'Blockchain como prova de anterioridade', tipo: 'imagem', legenda: '', primeiroComentario: null, dia: 26, hora: '09:30', status: 'publicando' },
  { id: 'p06', clienteId: 'mor', tituloInterno: 'Marca nominativa, mista e figurativa', tipo: 'carrossel', legenda: '', primeiroComentario: null, dia: 28, hora: '09:30', status: 'aguardando_aprovacao' },
  { id: 'p07', clienteId: 'mor', tituloInterno: 'Erros que anulam um registro', tipo: 'reel', legenda: '', primeiroComentario: null, dia: 31, hora: '11:00', status: 'rascunho' },
  { id: 'p11', clienteId: 'publika', tituloInterno: 'Release não é press kit', tipo: 'imagem', legenda: '', primeiroComentario: null, dia: 26, hora: '16:00', status: 'publicado_parcial' },
  { id: 'p12', clienteId: 'publika', tituloInterno: 'O que medir numa campanha de PR', tipo: 'imagem', legenda: '', primeiroComentario: null, dia: 27, hora: '12:00', status: 'agendado' },
  { id: 'p13', clienteId: 'publika', tituloInterno: 'Crise: as 3 primeiras horas', tipo: 'carrossel', legenda: '', primeiroComentario: null, dia: 29, hora: '10:00', status: 'aguardando_aprovacao' },
  { id: 'p16', clienteId: 'confraria', tituloInterno: 'Curadoria: quem entra na Confraria', tipo: 'imagem', legenda: '', primeiroComentario: null, dia: 26, hora: '19:30', status: 'agendado' },
  { id: 'p17', clienteId: 'confraria', tituloInterno: 'Convite: jantar de setembro', tipo: 'imagem', legenda: '', primeiroComentario: null, dia: 30, hora: '19:00', status: 'aguardando_aprovacao' },
  { id: 'p21', clienteId: 'pamela', tituloInterno: 'Antes e depois: caso da Renata', tipo: 'reel', legenda: '', primeiroComentario: null, dia: 26, hora: '08:00', status: 'publicando' },
  { id: 'p22', clienteId: 'pamela', tituloInterno: 'Dorme com a prótese? Responde aqui', tipo: 'imagem', legenda: '', primeiroComentario: null, dia: 29, hora: '08:30', status: 'rascunho' },
];

export const ALVOS: PostAlvo[] = [
  { id: 'a1', postId: 'p05', clienteId: 'mor', contaSocialId: 'mor-ig', estado: 'container_pronto', tentativas: 0, proximaTentativa: 'agora', erroCodigo: null, erroMensagem: null, mediaId: null },
  { id: 'a2', postId: 'p11', clienteId: 'publika', contaSocialId: 'pub-ig', estado: 'falhou', tentativas: 1, proximaTentativa: '—', erroCodigo: 'meta_2207009 · permanente', erroMensagem: 'Proporção da imagem fora do permitido pelo Instagram. Use algo entre 4:5 (vertical) e 1.91:1 (horizontal).', mediaId: null },
  { id: 'a3', postId: 'p11', clienteId: 'publika', contaSocialId: 'pub-fb', estado: 'publicado', tentativas: 0, proximaTentativa: '—', erroCodigo: null, erroMensagem: null, mediaId: '122098...4471' },
  { id: 'a4', postId: 'p16', clienteId: 'confraria', contaSocialId: 'con-ig', estado: 'container_aguardando', tentativas: 0, proximaTentativa: 'em 30s', erroCodigo: 'IN_PROGRESS', erroMensagem: 'A Meta ainda está processando esta mídia.', mediaId: null },
  { id: 'a5', postId: 'p21', clienteId: 'pamela', contaSocialId: 'pam-ig', estado: 'publicando', tentativas: 2, proximaTentativa: 'em 1 min', erroCodigo: 'publicacao_indefinida · transitório', erroMensagem: 'A resposta da Meta à publicação se perdeu. O sistema vai conferir se o post saiu antes de qualquer nova tentativa.', mediaId: null },
  { id: 'a6', postId: 'p12', clienteId: 'publika', contaSocialId: 'pub-ig', estado: 'pendente', tentativas: 0, proximaTentativa: '27/08 12:00', erroCodigo: null, erroMensagem: null, mediaId: null },
];

export function clientePorId(id: string): Cliente | undefined {
  return CLIENTES.find((c) => c.id === id);
}

export function postPorId(id: string): Post | undefined {
  return POSTS.find((p) => p.id === id);
}

export function contaPorId(id: string) {
  for (const c of CLIENTES) {
    const conta = c.contas.find((x) => x.id === id);
    if (conta) return conta;
  }
  return undefined;
}

import type { EventoAlvo } from './tipos';

/** Log append-only por alvo. Espelha publicacao_eventos. */
export const EVENTOS: Record<string, EventoAlvo[]> = {
  a1: [
    { hora: '09:30:04', evento: 'tick.reivindicou', tom: 'meta', detalhe: 'Lease de 120s tomado pelo tick 4f2a…c1.' },
    { hora: '09:30:04', evento: 'container_solicitado', tom: 'neutro', detalhe: '1 arquivo, link assinado válido por 2h.' },
    { hora: '09:30:05', evento: 'meta.ig.criar_container_imagem', tom: 'meta', detalhe: 'POST /17841…/media → 201 em 812 ms.' },
    { hora: '09:30:05', evento: 'container_criado', tom: 'ok', detalhe: 'container_id 17999…3021.' },
  ],
  a2: [
    { hora: '16:00:03', evento: 'container_solicitado', tom: 'neutro', detalhe: '1 arquivo, link assinado válido por 2h.' },
    { hora: '16:00:04', evento: 'meta.ig.criar_container_imagem', tom: 'meta', detalhe: 'POST /17841…/media → 400 em 640 ms.' },
    { hora: '16:00:04', evento: 'erro_permanente', tom: 'erro', detalhe: 'Código 2207009. Sem retry — o arquivo é 1200×500 (2.4:1). O JSON cru da Meta ficou só aqui no log.' },
    { hora: '16:00:04', evento: 'alerta_enviado', tom: 'neutro', detalhe: 'Webhook disparado para o canal #social-alertas.' },
  ],
  a3: [
    { hora: '16:00:03', evento: 'container_solicitado', tom: 'neutro', detalhe: 'Foto na Página do Facebook.' },
    { hora: '16:00:04', evento: 'meta.fb.publicar_foto', tom: 'meta', detalhe: 'POST /5550…/photos → 200 em 1.1 s.' },
    { hora: '16:00:04', evento: 'publicacao_confirmada', tom: 'ok', detalhe: 'media_id 122098…4471. Saiu no Facebook e falhou no Instagram: o post virou publicado_parcial.' },
  ],
  a4: [
    { hora: '19:30:02', evento: 'container_solicitado', tom: 'neutro', detalhe: '1 arquivo.' },
    { hora: '19:30:03', evento: 'container_criado', tom: 'ok', detalhe: 'container_id 17888…9915.' },
    { hora: '19:30:33', evento: 'container_processando', tom: 'neutro', detalhe: 'status_code IN_PROGRESS. Nova checagem em 30s — não consome tentativa.' },
  ],
  a5: [
    { hora: '08:00:02', evento: 'meta.ig.consultar_cota', tom: 'meta', detalhe: 'quota_usage 11 de 50 na janela móvel de 24h.' },
    { hora: '08:00:02', evento: 'publicacao_solicitada', tom: 'neutro', detalhe: 'creation_id 17777…2210. Gravado antes da chamada.' },
    { hora: '08:00:27', evento: 'publicacao_indefinida', tom: 'erro', detalhe: 'Timeout de 25s sem resposta. Não sabemos se publicou — e por isso não republicamos.' },
    { hora: '08:01:03', evento: 'reconciliacao_iniciada', tom: 'meta', detalhe: 'GET /17777…2210?fields=status_code → FINISHED.' },
    { hora: '08:01:04', evento: 'meta.ig.midias_recentes', tom: 'meta', detalhe: 'Nenhuma mídia nova na conta desde 08:00:02.' },
  ],
  a6: [
    { hora: '—', evento: 'aguardando_horario', tom: 'neutro', detalhe: 'Alvo criado no agendamento. Só fica elegível às 12:00 de 27/08.' },
  ],
};

export const LEGENDAS_EXEMPLO: Record<string, string> = {
  p06: 'Registrou a marca e acha que está tudo resolvido? Existem três tipos de registro no INPI, e escolher o errado deixa buraco na sua proteção.\n\nSalva esse post para consultar antes de entrar com o pedido.\n\n#registrodemarca #INPI #propriedadeintelectual #marcas #empreendedorismo',
  p13: 'O que a sua marca faz nas três primeiras horas de uma crise decide o tamanho dela. Silêncio também é posicionamento — só que involuntário.\n\n#assessoriadeimprensa #gestaodecrise #comunicacao',
  p17: 'Mesa posta para 12. Setembro fecha o ciclo do semestre e a curadoria deste encontro foi feita peça por peça. Confirmação até dia 25.\n\n#networking #confrariasomos',
};
