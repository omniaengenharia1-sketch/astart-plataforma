import type { RegistroChamada } from './graph.ts';
import type { ContextoConta, PlataformaSocial, TipoPost } from './tipos.ts';

export interface MidiaEntrada {
  ordem: number;
  /** Signed URL do Storage, valida por 2h. A Meta baixa o arquivo por ela. */
  url: string;
  mime: string;
  largura: number | null;
  altura: number | null;
  duracao_segundos: number | null;
}

export interface EntradaContainer {
  tipo: TipoPost;
  legenda: string;
  midias: MidiaEntrada[];
}

export type EstadoContainer = 'processando' | 'pronto' | 'publicado' | 'erro';

export interface ResultadoContainer {
  containerId: string;
  /** true para video: o container precisa terminar de processar antes do publish. */
  aguardarProcessamento: boolean;
  children?: string[];
  registros: RegistroChamada[];
}

export interface StatusContainer {
  estado: EstadoContainer;
  detalhe?: string;
  registros: RegistroChamada[];
}

export interface Cota {
  usadas: number;
  total: number;
  registros: RegistroChamada[];
}

export interface ResultadoPublicacao {
  mediaId: string;
  registros: RegistroChamada[];
}

export interface MidiaRecente {
  id: string;
  timestamp: string;
}

/**
 * Interface unica de saida para plataforma externa. Hoje so o Instagram
 * implementa. Facebook Page, e o que vier depois, entram por aqui — sem
 * abstracao multi-plataforma generica antes da hora.
 */
export interface AdaptadorPlataforma {
  readonly plataforma: PlataformaSocial;

  criarContainer(ctx: ContextoConta, entrada: EntradaContainer): Promise<ResultadoContainer>;

  verificarContainer(ctx: ContextoConta, containerId: string): Promise<StatusContainer>;

  /** Janela movel de 24h lida da propria Meta. Nunca um contador local. */
  consultarCota(ctx: ContextoConta): Promise<Cota>;

  /**
   * Solta o que `criarContainer` preparou.
   *
   * `entrada` e opcional porque as duas plataformas pedem coisas diferentes, e
   * forcar as duas ao mesmo formato esconderia a diferenca em vez de mostra-la:
   *
   *   · Instagram — a legenda ja foi junto na criacao do container. Ignora.
   *   · Facebook  — a Pagina nao tem "criar desligado e ligar depois"; o post
   *                 nasce aqui, e a legenda so e dita AGORA.
   *
   * Quem nao receber o que precisa estoura alto: o adaptador do Facebook
   * recusa publicar sem legenda em vez de publicar um post mudo.
   */
  publicar(
    ctx: ContextoConta,
    containerId: string,
    entrada?: { legenda: string },
  ): Promise<ResultadoPublicacao>;

  comentar(ctx: ContextoConta, mediaId: string, texto: string): Promise<ResultadoPublicacao>;

  /** Usado so na reconciliacao, para provar se a publicacao aconteceu. */
  midiasPublicadasApos(
    ctx: ContextoConta,
    desde: Date,
  ): Promise<{ candidatos: MidiaRecente[]; registros: RegistroChamada[] }>;
}
