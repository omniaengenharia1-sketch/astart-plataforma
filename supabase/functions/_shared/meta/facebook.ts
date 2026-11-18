/**
 * Publicar na Página do Facebook.
 *
 * A dona confirmou que precisa do Facebook, e o `pages_manage_posts` só se
 * justifica no App Review se o vídeo mostrar um post saindo numa Página. Este
 * arquivo é o que falta para gravar esse vídeo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ELE NÃO É O `instagram.ts` COM OUTRO ENDEREÇO
 * ---------------------------------------------------------------------------
 *
 * O Instagram tem duas fases de verdade: `POST /media` cria um rascunho que
 * fica guardado na Meta, e `POST /media_publish` solta. Entre as duas pode
 * passar tempo. A máquina de estados do worker foi desenhada em cima disso.
 *
 * A Página NÃO tem isso, e eu só descobri lendo a referência inteira:
 *
 *   · `POST /{page-id}/feed` com `published=false` EXIGE
 *     `scheduled_publish_time`. Não existe "cria desligado e liga depois".
 *   · `is_published` aparece na tabela de "Updating" do Page Post sem uma
 *     linha de descrição e sem exemplo, e na referência do feed ele é campo
 *     de LEITURA: "Indicates whether a scheduled post was published".
 *
 * Ou seja: não há forma documentada de publicar agora um post criado antes.
 * Construir em cima do `is_published` seria apostar numa linha de tabela sem
 * descrição — e o preço de errar isso é um post que não sai de madrugada.
 *
 * ENTÃO O ENCAIXE É OUTRO, e ele cabe na mesma interface:
 *
 *   criarContainer → sobe cada FOTO com `published=false`. A foto existe na
 *                    Meta, ainda não aparece em lugar nenhum. É o trabalho
 *                    pesado (a Meta baixa cada arquivo pela URL assinada).
 *   publicar       → UMA chamada a `/{page-id}/feed` com `message` e
 *                    `attached_media`. O post nasce já publicado.
 *
 * Isso deixa o passo que pode duplicar um post reduzido a uma única chamada,
 * que é um perfil de idempotência MELHOR que o do Instagram, não pior: não há
 * janela entre "criei" e "soltei". Se essa chamada cair no timeout, o worker
 * faz o que já fazia — fica em `publicando` e reconcilia no tick seguinte, em
 * vez de republicar às cegas.
 *
 * ---------------------------------------------------------------------------
 * O TOKEN É OUTRO
 * ---------------------------------------------------------------------------
 * Os dois endpoints pedem, na doc, "A Page access token requested by a person
 * who can perform the CREATE_CONTENT task". O token que o worker carrega é o
 * do System User da agência. O token da Página sai de
 * `GET /{page-id}?fields=access_token` com esse token — e ele NUNCA é gravado:
 * vive dentro de uma publicação e morre com ela.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE ADAPTADOR NÃO FAZ
 * ---------------------------------------------------------------------------
 * Reels e stories da Página sobem por `rupload.facebook.com`, em upload
 * retomável de três fases, que é outro protocolo e outro host — não é o
 * `chamarGraph` daqui. Ficam recusados, com o motivo escrito, em vez de
 * aceitos e quebrados na hora de publicar. A homologação precisa de uma foto
 * na Página, e é isso que está pronto.
 */
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
import { ehVideo, FORMATOS_FACEBOOK, MIMES_IMAGEM } from './formatos.ts';

/** O que separa os ids das fotos dentro do `container_id` gravado no banco. */
const SEPARADOR = ',';

function exigirPageId(ctx: ContextoConta): string {
  if (!ctx.page_id) {
    throw new FalhaPasso(
      erroPermanente(
        'conta_sem_page_id',
        'A conta nao tem o ID da Pagina cadastrado. Preencha page_id em contas_sociais.',
      ),
    );
  }
  return ctx.page_id;
}

/**
 * O token da Página, a partir do token do System User.
 *
 * Buscado a cada publicação, de propósito: guardar em cache dentro da Edge
 * Function economizaria uma chamada e seguraria um token de Página numa
 * variável de módulo, que sobrevive entre invocações no mesmo isolate. Uma
 * chamada por post é barata; token vazando de um post para outro, não.
 *
 * Quando o System User não tem a Página como ativo, a Meta responde sem o
 * campo — e o erro tem de dizer o que fazer, não "undefined".
 */
async function tokenDaPagina(
  ctx: ContextoConta,
): Promise<{ token: string; registros: RegistroChamada[] }> {
  const pageId = exigirPageId(ctx);

  const { dados, registro } = await chamarGraph<{ access_token?: string }>({
    metodo: 'GET',
    caminho: pageId,
    token: ctx.access_token,
    operacao: 'fb.token_da_pagina',
    params: { fields: 'access_token' },
  });

  if (!dados?.access_token) {
    throw new FalhaPasso(
      erroPermanente(
        'pagina_sem_token',
        `A Meta nao devolveu o token da Pagina ${pageId}. Normalmente e porque o ` +
          'usuario do sistema da agencia nao tem essa Pagina como ativo com controle total. ' +
          'Confira em Configuracoes do negocio > Usuarios do sistema > Adicionar ativos.',
      ),
    );
  }

  return { token: dados.access_token, registros: [registro] };
}

/**
 * A mídia bate com a regra do formato?
 *
 * Segunda barreira de propósito, igual à do Instagram: o banco já cobra na
 * hora de anexar, e aqui é o último lugar antes de a Meta ver.
 *
 * A Página aceita mais formatos de imagem que o Instagram — a doc lista
 * ".jpeg, .bmp, .png, .gif, .tiff". Mesmo assim esta função exige JPEG, e isso
 * é escolha: o envio já converte tudo para JPEG antes de guardar, então uma
 * regra mais larga aqui não liberaria nada que exista no Storage, e criaria
 * duas regras diferentes para a mesma pergunta em dois arquivos vizinhos.
 */
function conferirMidias(tipo: string, midias: MidiaEntrada[]): void {
  const regra = FORMATOS_FACEBOOK[tipo];

  if (!regra) {
    throw new FalhaPasso(
      erroPermanente('tipo_desconhecido', `Formato "${tipo}" nao existe no adaptador do Facebook.`),
    );
  }
  if (!regra.publicavel) {
    throw new FalhaPasso(
      erroPermanente(
        'formato_nao_implementado',
        regra.motivo ?? `O formato "${tipo}" ainda nao publica no Facebook.`,
      ),
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
    if (ehVideo(m.mime)) {
      throw new FalhaPasso(
        erroPermanente(
          'natureza_nao_suportada',
          `O formato "${tipo}" na Pagina aceita so imagem, e o arquivo ${m.ordem} e ${m.mime}.`,
        ),
      );
    }
    if (!MIMES_IMAGEM.has(m.mime.toLowerCase())) {
      throw new FalhaPasso(
        erroPermanente(
          'formato_nao_suportado',
          `A plataforma publica imagem so em JPEG. Arquivo ${m.ordem}: ${m.mime}.`,
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

export const adaptadorFacebook: AdaptadorPlataforma = {
  plataforma: 'facebook',

  /**
   * Sobe as fotos desligadas. Nenhuma delas aparece na Página ainda.
   *
   * Sequencial, não em paralelo, pelo mesmo motivo do carrossel do Instagram:
   * a ordem em que os ids entram em `attached_media` é a ordem em que o
   * Facebook mostra as fotos. Paralelizar pouparia segundos e embaralharia o
   * post do cliente.
   *
   * ATENÇÃO AO PRAZO: foto não publicada é apagada pela Meta em cerca de 24 h.
   * Se um post ficar represado mais que isso (backoff longo, fila parada), os
   * ids morrem e o `verificarContainer` abaixo acusa — em vez de o `publicar`
   * falhar com um erro da Meta que ninguém entende.
   */
  async criarContainer(ctx: ContextoConta, entrada: EntradaContainer): Promise<ResultadoContainer> {
    const pageId = exigirPageId(ctx);
    conferirMidias(entrada.tipo, entrada.midias);

    const { token, registros } = await tokenDaPagina(ctx);
    const ordenadas = [...entrada.midias].sort((a, b) => a.ordem - b.ordem);
    const fotos: string[] = [];

    for (const m of ordenadas) {
      const { dados, registro } = await chamarGraph<{ id: string }>({
        metodo: 'POST',
        caminho: `${pageId}/photos`,
        token,
        operacao: 'fb.subir_foto',
        // `published: 'false'` — string, porque o corpo vai como formulário.
        // Sem `temporary`: ele existe para foto de post AGENDADO na Meta, e
        // aqui quem agenda é o nosso worker.
        corpo: { url: m.url, published: 'false' },
      });
      registros.push(registro);
      fotos.push(exigirId(dados, 'fb.subir_foto'));
    }

    // Foto não passa por processamento assíncrono como vídeo: nasce pronta.
    return {
      containerId: fotos.join(SEPARADOR),
      aguardarProcessamento: false,
      children: fotos,
      registros,
    };
  },

  /**
   * As fotos ainda existem?
   *
   * Não há "status" de container na Página — o que existe é a foto existir ou
   * ter sido varrida pelas 24 h. Confere a primeira: se ela sumiu, todas
   * sumiram juntas, e o estado honesto é erro, para o worker refazer em vez de
   * publicar um post sem imagem.
   */
  async verificarContainer(ctx: ContextoConta, containerId: string): Promise<StatusContainer> {
    const primeira = containerId.split(SEPARADOR)[0] ?? '';

    if (!primeira) {
      return { estado: 'erro', detalhe: 'container vazio', registros: [] };
    }

    const { dados, registro } = await chamarGraph<{ id?: string }>({
      metodo: 'GET',
      caminho: primeira,
      token: ctx.access_token,
      operacao: 'fb.verificar_foto',
      params: { fields: 'id' },
    });

    return dados?.id
      ? { estado: 'pronto', registros: [registro] }
      : {
        estado: 'erro',
        detalhe: 'a foto nao existe mais na Meta (fotos nao publicadas somem em ~24h)',
        registros: [registro],
      };
  },

  /**
   * A Página não tem cota de publicação.
   *
   * O Instagram expõe `content_publishing_limit`, uma janela móvel de 24 h. Na
   * referência da Página não existe equivalente — o que existe é limite de
   * CHAMADAS ("4800 * Number of Engaged Users"), que é outra coisa e já chega
   * como erro classificado pelo `chamarGraph`.
   *
   * Devolver zero é o combinado: o worker só barra quando `total > 0`. Não é
   * "não sei", é "não existe", e está escrito aqui para ninguém procurar de
   * novo.
   */
  // deno-lint-ignore require-await
  async consultarCota(_ctx: ContextoConta): Promise<Cota> {
    return { usadas: 0, total: 0, registros: [] };
  },

  /**
   * A única chamada que pode duplicar um post.
   *
   * A legenda chega por parâmetro porque na Página ela só é dita AGORA — no
   * Instagram ela já foi junto na criação do container. O worker passa
   * `legendaFinal(post)`, o mesmo texto dos dois lados.
   *
   * Se ela não vier, isto estoura alto em vez de publicar um post mudo na
   * conta de um cliente.
   */
  async publicar(
    ctx: ContextoConta,
    containerId: string,
    entrada?: { legenda: string },
  ): Promise<ResultadoPublicacao> {
    const pageId = exigirPageId(ctx);

    if (!entrada) {
      throw new FalhaPasso(
        erroPermanente(
          'publicacao_sem_legenda',
          'O adaptador do Facebook precisa da legenda na hora de publicar, e ela nao veio. ' +
            'E defeito de codigo, nao de cadastro.',
        ),
      );
    }

    const fotos = containerId.split(SEPARADOR).filter((x) => x.trim() !== '');
    if (fotos.length === 0) {
      throw new FalhaPasso(
        erroPermanente('sem_container_id', 'Nenhuma foto registrada para publicar na Pagina.'),
      );
    }

    const { token, registros } = await tokenDaPagina(ctx);

    // `attached_media[0]`, `attached_media[1]`, ... cada um com o JSON de um
    // `media_fbid`. É a sintaxe de formulário que a referência do feed mostra.
    const corpo: Record<string, string> = {};
    if (entrada.legenda.trim() !== '') corpo['message'] = entrada.legenda;
    fotos.forEach((id, i) => {
      corpo[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
    });

    const { dados, registro } = await chamarGraph<{ id: string }>({
      metodo: 'POST',
      caminho: `${pageId}/feed`,
      token,
      operacao: 'fb.publicar',
      corpo,
    });
    registros.push(registro);

    if (!dados?.id) {
      throw new FalhaPasso(
        erroPermanente(
          'publicacao_sem_id',
          'A Meta respondeu a publicacao sem devolver o ID do post. Confira a Pagina antes de tentar de novo.',
        ),
      );
    }

    return { mediaId: dados.id, registros };
  },

  async comentar(ctx: ContextoConta, mediaId: string, texto: string): Promise<ResultadoPublicacao> {
    const { token, registros } = await tokenDaPagina(ctx);

    const { dados, registro } = await chamarGraph<{ id: string }>({
      metodo: 'POST',
      caminho: `${mediaId}/comments`,
      token,
      operacao: 'fb.primeiro_comentario',
      corpo: { message: texto },
    });
    registros.push(registro);

    return { mediaId: dados?.id ?? '', registros };
  },

  /**
   * Para a reconciliação: o post saiu mesmo?
   *
   * `/feed` devolve publicados E não publicados, então `is_published` vem
   * junto e os não publicados são descartados aqui — senão a reconciliação
   * daria por publicado um post que não saiu, que é o erro mais caro que esta
   * função pode cometer.
   */
  async midiasPublicadasApos(
    ctx: ContextoConta,
    desde: Date,
  ): Promise<{ candidatos: MidiaRecente[]; registros: RegistroChamada[] }> {
    const pageId = exigirPageId(ctx);
    const { token, registros } = await tokenDaPagina(ctx);

    const { dados, registro } = await chamarGraph<{
      data?: Array<{ id: string; created_time: string; is_published?: boolean }>;
    }>({
      metodo: 'GET',
      caminho: `${pageId}/feed`,
      token,
      operacao: 'fb.posts_recentes',
      params: { fields: 'id,created_time,is_published', limit: '25' },
    });
    registros.push(registro);

    // Margem de 60s: o timestamp é do servidor da Meta, não do nosso.
    const corte = desde.getTime() - 60_000;
    const candidatos = (dados?.data ?? [])
      .filter((p) => p.is_published !== false)
      .map((p) => ({ id: p.id, timestamp: p.created_time }))
      .filter((p) => {
        const t = Date.parse(p.timestamp);
        return Number.isFinite(t) && t >= corte;
      });

    return { candidatos, registros };
  },
};
