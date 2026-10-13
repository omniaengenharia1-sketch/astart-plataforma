// Tipos espelhando o schema. Mantidos a mao de proposito: a Edge Function nao
// depende de geracao de tipos para subir.

export type PlataformaSocial = 'instagram' | 'facebook';

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

export type FamiliaErro = 'transitorio' | 'permanente';

export interface PostAlvo {
  id: string;
  post_id: string;
  conta_social_id: string;
  estado: EstadoAlvo;
  container_id: string | null;
  container_children: string[] | null;
  media_id_publicado: string | null;
  publicado_em: string | null;
  tentativas: number;
  proxima_tentativa_em: string | null;
  erro_codigo: string | null;
  erro_familia: FamiliaErro | null;
  erro_mensagem: string | null;
  lock_token: string | null;
  bloqueado_ate: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface Post {
  id: string;
  cliente_id: string;
  titulo_interno: string;
  tipo: TipoPost;
  legenda: string;
  /** So as hashtags, sem a legenda. Quem junta e o worker (0046). */
  hashtags: string;
  /** Hashtags no primeiro comentario, para a legenda ficar limpa no feed. */
  hashtags_no_comentario: boolean;
  primeiro_comentario: string | null;
  agendado_para: string | null;
  status: StatusPost;
}

export interface PostMidia {
  id: string;
  post_id: string;
  ordem: number;
  storage_path: string;
  mime: string;
  largura: number | null;
  altura: number | null;
  duracao_segundos: number | null;
  tamanho_bytes: number | null;
}

/** Retorno de obter_token_conta(). O token NUNCA sai daqui. */
export interface ContextoConta {
  conta_social_id: string;
  plataforma: PlataformaSocial;
  ig_user_id: string | null;
  page_id: string | null;
  access_token: string;
}
