// Tipos do domínio. Espelham o schema Supabase; quando as tabelas novas forem
// aprovadas, estes tipos passam a ser gerados a partir do banco.

export type Papel = 'admin' | 'operacao' | 'financeiro' | 'leitura';

export type PlataformaSocial = 'instagram' | 'facebook';

export type OrigemToken = 'system_user' | 'oauth';

export type AcessoParceiro = 'concedido' | 'pendente' | 'expirado';

export type TipoPost = 'imagem' | 'carrossel' | 'reel' | 'story';

export type StatusPost =
  | 'rascunho'
  | 'aguardando_aprovacao'
  | 'aprovado'
  | 'agendado'
  | 'publicando'
  | 'publicado'
  | 'publicado_parcial'
  | 'falhou'
  | 'cancelado';

export type EstadoAlvo =
  | 'pendente'
  | 'container_criando'
  | 'container_aguardando'
  | 'container_pronto'
  | 'publicando'
  | 'publicado'
  | 'falhou'
  | 'cancelado';

export interface Perfil {
  id: string;
  nome: string;
  papel: Papel;
  cor: string;
  ativo: boolean;
}

export interface ContaSocial {
  id: string;
  clienteId: string;
  plataforma: PlataformaSocial;
  nomeExibicao: string;
  identificador: string;
  origemToken: OrigemToken;
  /** Nulo quando origemToken é system_user: esse token não expira. */
  tokenExpiraEm: string | null;
  tokenRef: string | null;
  acessoParceiro: AcessoParceiro;
  ativo: boolean;
}

export interface Cliente {
  id: string;
  nome: string;
  slug: string;
  cor: string;
  fusoHorario: string;
  ativo: boolean;
  desde: string;
  contas: ContaSocial[];
  linkAprovacao: { expiraEm: string; revogado: boolean } | null;
}

export interface Post {
  id: string;
  clienteId: string;
  tituloInterno: string;
  tipo: TipoPost;
  legenda: string;
  primeiroComentario: string | null;
  dia: number;
  hora: string;
  status: StatusPost;
}

export interface PostAlvo {
  id: string;
  postId: string;
  clienteId: string;
  contaSocialId: string;
  estado: EstadoAlvo;
  tentativas: number;
  proximaTentativa: string;
  erroCodigo: string | null;
  erroMensagem: string | null;
  mediaId: string | null;
}

export interface EventoAlvo {
  hora: string;
  evento: string;
  tom: 'ok' | 'erro' | 'meta' | 'neutro';
  detalhe: string;
}

export interface Aprovacao {
  postId: string;
  decisao: 'sim' | 'nao' | null;
  comentario: string;
}
