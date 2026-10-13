import { chamarGraph, type RegistroChamada } from '../graph.ts';
import { erroPermanente, FalhaPasso } from '../erros.ts';
import type {
  AdaptadorPlataforma,
  Cota,
  EntradaContainer,
  MidiaEntrada,
  MidiaRecente,
  ResultadoContainer,
  ResultadoPublicacao,
  StatusContainer,
} from '../adaptador.ts';
import type { ContextoConta } from '../tipos.ts';
import { ehVideo, FORMATOS_INSTAGRAM, MIMES_IMAGEM } from './formatos.ts';

function exigirIgUserId(ctx: ContextoConta): string {
  if (!ctx.ig_user_id) {
    throw new FalhaPasso(
      erroPermanente(
        'conta_sem_ig_user_id',
        'A conta nao tem o ID do Instagram cadastrado. Preencha ig_user_id em contas_sociais.',
      ),
    );
  }
  return ctx.ig_user_id;
}

/**
 * Confere a midia contra a regra do formato ANTES de gastar chamada na Meta.
 *
 * O banco ja cobra isso na hora de anexar (0045/0047/0048), e esta e a segunda
 * barreira de proposito: midia pode ser trocada no banco por caminho que nao
 * passa pela RPC, e aqui e o ultimo lugar antes de a Meta ver.
 */
function conferirMidias(tipo: string, midias: MidiaEntrada[]): void {
  const regra = FORMATOS_INSTAGRAM[tipo];

  if (!regra) {
    throw new FalhaPasso(
      erroPermanente('tipo_desconhecido', `Formato "${tipo}" nao existe no adaptador do Instagram.`),
    );
  }
  if (!regra.publicavel) {
    throw new FalhaPasso(
      erroPermanente('formato_nao_implementado', regra.motivo ?? `O formato "${tipo}" ainda nao publica.`),
    );
  }
  if (midias.length < regra.minimo || midias.length > regra.maximo) {
    throw new FalhaPasso(
      erroPermanente(
        'quantidade_de_midia_invalida',
        `Um post "${tipo}" precisa de ${regra.minimo} a ${regra.maximo} arquivo(s); ` +
          `foram encontrados ${midias.length}.`,
      ),
    );
  }

  for (const m of midias) {
    const video = ehVideo(m.mime);

    if (regra.natureza === 'imagem' && video) {
      throw new FalhaPasso(
        erroPermanente(
          'natureza_nao_suportada',
          `O formato "${tipo}" aceita so imagem, e o arquivo ${m.ordem} e ${m.mime}.`,
        ),
      );
    }
    if (regra.natureza === 'video' && !video) {
      throw new FalhaPasso(
        erroPermanente(
          'natureza_nao_suportada',
          `O formato "${tipo}" aceita so video, e o arquivo ${m.ordem} e ${m.mime}.`,
        ),
      );
    }
    // JPEG e a unica imagem que a Meta publica. A mesma regra da 0047.
    if (!video && !MIMES_IMAGEM.has(m.mime.toLowerCase())) {
      throw new FalhaPasso(
        erroPermanente(
          'formato_nao_suportado',
          `O Instagram publica imagem so em JPEG. Arquivo ${m.ordem}: ${m.mime}.`,
        ),
      );
    }
  }
}

function exigirId(dados: { id?: string } | null, operacao: string): string {
  if (!dados?.id) {
    throw new FalhaPasso(
      erroPermanente(
        'container_sem_id',
        `A Meta aceitou "${operacao}" mas nao devolveu o ID. Verifique o log deste item.`,
      ),
    );
  }
  return dados.id;
}

export const adaptadorInstagram: AdaptadorPlataforma = {
  plataforma: 'instagram',

  /**
   * Os quatro formatos, cada um com o seu jeito de nascer na Meta.
   *
   *   imagem    → image_url, sem media_type. Nasce pronta.
   *   carrossel → um container por arquivo (`is_carousel_item`), depois o pai
   *               (`media_type=CAROUSEL`, `children`). A legenda vai SO no pai:
   *               a Meta ignora legenda em filho de carrossel.
   *   reel      → media_type=REELS. Video processa, entao aguarda.
   *   story     → media_type=STORIES, e SEM legenda: a Meta descarta.
   *
   * O que a documentacao oficial da Meta nao resolve: se filho de video precisa
   * de `media_type=VIDEO`. O unico exemplo oficial usa, a lista de valores
   * aceitos nao cita. Nao importa aqui, porque carrossel so aceita imagem nesta
   * versao — e quando aceitar video, o registro da chamada mostra a resposta.
   */
  async criarContainer(ctx: ContextoConta, entrada: EntradaContainer): Promise<ResultadoContainer> {
    const igUserId = exigirIgUserId(ctx);
    conferirMidias(entrada.tipo, entrada.midias);

    const legenda = entrada.legenda || undefined;
    const ordenadas = [...entrada.midias].sort((a, b) => a.ordem - b.ordem);

    if (entrada.tipo === 'carrossel') {
      const registros: RegistroChamada[] = [];
      const filhos: string[] = [];

      // Sequencial, nao em paralelo: a ordem dos filhos E a ordem do carrossel
      // no feed, e `children` e uma lista ordenada. Paralelizar aqui pouparia
      // segundos e embaralharia o carrossel do cliente.
      for (const m of ordenadas) {
        const { dados, registro } = await chamarGraph<{ id: string }>({
          metodo: 'POST',
          caminho: `${igUserId}/media`,
          token: ctx.access_token,
          operacao: 'ig.criar_filho_carrossel',
          corpo: { image_url: m.url, is_carousel_item: 'true' },
        });
        registros.push(registro);
        filhos.push(exigirId(dados, 'ig.criar_filho_carrossel'));
      }

      const { dados, registro } = await chamarGraph<{ id: string }>({
        metodo: 'POST',
        caminho: `${igUserId}/media`,
        token: ctx.access_token,
        operacao: 'ig.criar_container_carrossel',
        corpo: { media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda },
      });
      registros.push(registro);

      // Filho de imagem nao processa, e o pai de carrossel de imagem tambem
      // nao: nasce pronto.
      return {
        containerId: exigirId(dados, 'ig.criar_container_carrossel'),
        aguardarProcessamento: false,
        children: filhos,
        registros,
      };
    }

    const midia = ordenadas[0]!;

    if (entrada.tipo === 'reel') {
      const { dados, registro } = await chamarGraph<{ id: string }>({
        metodo: 'POST',
        caminho: `${igUserId}/media`,
        token: ctx.access_token,
        operacao: 'ig.criar_container_reel',
        corpo: { media_type: 'REELS', video_url: midia.url, caption: legenda },
      });

      // Video SEMPRE processa. Sem isto o `media_publish` sai antes da hora e a
      // Meta recusa com o container ainda em IN_PROGRESS.
      return {
        containerId: exigirId(dados, 'ig.criar_container_reel'),
        aguardarProcessamento: true,
        registros: [registro],
      };
    }

    if (entrada.tipo === 'story') {
      const video = ehVideo(midia.mime);
      const { dados, registro } = await chamarGraph<{ id: string }>({
        metodo: 'POST',
        caminho: `${igUserId}/media`,
        token: ctx.access_token,
        operacao: 'ig.criar_container_story',
        // Story nao leva legenda: a Meta descarta o campo. Mandar seria sujar o
        // log com um parametro que nao faz nada.
        corpo: video
          ? { media_type: 'STORIES', video_url: midia.url }
          : { media_type: 'STORIES', image_url: midia.url },
      });

      return {
        containerId: exigirId(dados, 'ig.criar_container_story'),
        aguardarProcessamento: video,
        registros: [registro],
      };
    }

    const { dados, registro } = await chamarGraph<{ id: string }>({
      metodo: 'POST',
      caminho: `${igUserId}/media`,
      token: ctx.access_token,
      operacao: 'ig.criar_container_imagem',
      corpo: { image_url: midia.url, caption: legenda },
    });

    // Imagem nao passa por processamento assincrono: ja nasce pronta.
    return {
      containerId: exigirId(dados, 'ig.criar_container_imagem'),
      aguardarProcessamento: false,
      registros: [registro],
    };
  },

  async verificarContainer(ctx: ContextoConta, containerId: string): Promise<StatusContainer> {
    const { dados, registro } = await chamarGraph<{ status_code?: string; status?: string }>({
      metodo: 'GET',
      caminho: containerId,
      token: ctx.access_token,
      operacao: 'ig.verificar_container',
      params: { fields: 'status_code,status' },
    });

    const codigo = (dados?.status_code ?? '').toUpperCase();
    const registros = [registro];

    switch (codigo) {
      case 'FINISHED':
        return { estado: 'pronto', detalhe: dados?.status, registros };
      case 'PUBLISHED':
        return { estado: 'publicado', detalhe: dados?.status, registros };
      case 'IN_PROGRESS':
        return { estado: 'processando', detalhe: dados?.status, registros };
      case 'ERROR':
      case 'EXPIRED':
        return { estado: 'erro', detalhe: dados?.status ?? codigo, registros };
      default:
        return { estado: 'processando', detalhe: dados?.status ?? codigo, registros };
    }
  },

  async consultarCota(ctx: ContextoConta): Promise<Cota> {
    const igUserId = exigirIgUserId(ctx);

    const { dados, registro } = await chamarGraph<{
      data?: Array<{ quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } }>;
    }>({
      metodo: 'GET',
      caminho: `${igUserId}/content_publishing_limit`,
      token: ctx.access_token,
      operacao: 'ig.consultar_cota',
      params: { fields: 'config,quota_usage' },
    });

    const linha = dados?.data?.[0];
    // A cota e uma janela movel de 24h mantida pela propria Meta. O total vem
    // da resposta — nunca de um numero chumbado aqui.
    return {
      usadas: linha?.quota_usage ?? 0,
      total: linha?.config?.quota_total ?? 0,
      registros: [registro],
    };
  },

  async publicar(ctx: ContextoConta, containerId: string): Promise<ResultadoPublicacao> {
    const igUserId = exigirIgUserId(ctx);

    const { dados, registro } = await chamarGraph<{ id: string }>({
      metodo: 'POST',
      caminho: `${igUserId}/media_publish`,
      token: ctx.access_token,
      operacao: 'ig.publicar',
      corpo: { creation_id: containerId },
    });

    if (!dados?.id) {
      throw new FalhaPasso(
        erroPermanente(
          'publicacao_sem_id',
          'A Meta respondeu a publicacao sem devolver o ID da midia. Confira a conta antes de tentar de novo.',
        ),
      );
    }

    return { mediaId: dados.id, registros: [registro] };
  },

  async comentar(ctx: ContextoConta, mediaId: string, texto: string): Promise<ResultadoPublicacao> {
    const { dados, registro } = await chamarGraph<{ id: string }>({
      metodo: 'POST',
      caminho: `${mediaId}/comments`,
      token: ctx.access_token,
      operacao: 'ig.primeiro_comentario',
      corpo: { message: texto },
    });

    return { mediaId: dados?.id ?? '', registros: [registro] };
  },

  async midiasPublicadasApos(
    ctx: ContextoConta,
    desde: Date,
  ): Promise<{ candidatos: MidiaRecente[]; registros: RegistroChamada[] }> {
    const igUserId = exigirIgUserId(ctx);

    const { dados, registro } = await chamarGraph<{
      data?: Array<{ id: string; timestamp: string }>;
    }>({
      metodo: 'GET',
      caminho: `${igUserId}/media`,
      token: ctx.access_token,
      operacao: 'ig.midias_recentes',
      params: { fields: 'id,timestamp', limit: '25' },
    });

    // Margem de 60s: o timestamp da Meta e o do servidor dela, nao o nosso.
    const corte = desde.getTime() - 60_000;
    const candidatos = (dados?.data ?? []).filter((m) => {
      const t = Date.parse(m.timestamp);
      return Number.isFinite(t) && t >= corte;
    });

    return { candidatos, registros: [registro] };
  },
};
