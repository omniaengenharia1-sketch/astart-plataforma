// =============================================================================
// publicar-tick — worker stateless disparado por pg_cron a cada minuto.
//
// Regras que governam este arquivo:
//   1. Um tick avanca cada item UM passo e devolve o controle. Sem sleep,
//      sem polling dentro de uma invocacao.
//   2. Nenhum passo que ja chamou a Meta e reexecutado sem antes checar o que
//      foi feito. `media_publish` e o unico ponto capaz de duplicar um post:
//      um alvo em "publicando" NUNCA e republicado, so reconciliado.
//   3. Todo erro vira estado visivel + mensagem em portugues + evento no log
//      (+ alerta, quando permanente).
// =============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { adaptadorInstagram } from '../_shared/meta/instagram.ts';
import { FalhaMeta } from '../_shared/graph.ts';
import { type ErroClassificado, erroPermanente, erroTransitorio, FalhaPasso } from '../_shared/erros.ts';
import { alertar, registrarChamadas, registrarEvento } from '../_shared/eventos.ts';
import type { AdaptadorPlataforma, MidiaEntrada } from '../_shared/adaptador.ts';
import type { ContextoConta, EstadoAlvo, Post, PostAlvo, PostMidia } from '../_shared/tipos.ts';

// --- Configuracao -----------------------------------------------------------

const LOTE_PADRAO = Number(Deno.env.get('TICK_LOTE_MAX') ?? '20');
const TTL_URL_ASSINADA = Number(Deno.env.get('SIGNED_URL_TTL_SEGUNDOS') ?? '7200'); // 2h
const MAX_TENTATIVAS = 6;
const LEASE_SEGUNDOS = 120;
const CONCORRENCIA = 4;
/** Margem confortavel abaixo do timeout da Edge Function. */
const LIMITE_TEMPO_MS = 45_000;
const RESERVA_POR_ITEM_MS = 8_000;
/** Container de video que nao termina de processar nesse prazo e desistido. */
const IDADE_MAX_CONTAINER_MS = 30 * 60_000;
const ESPERA_CONTAINER_SEGUNDOS = 30;
const ESPERA_COTA_SEGUNDOS = 900;

const ADAPTADORES: Record<string, AdaptadorPlataforma> = {
  instagram: adaptadorInstagram,
};

// --- Tipos de resposta ------------------------------------------------------

interface ResultadoItem {
  alvo_id: string;
  post_id: string;
  de: EstadoAlvo;
  para: EstadoAlvo;
  nota?: string;
  erro?: { familia: string; codigo: string; mensagem: string };
}

interface CorpoRequisicao {
  lote?: number;
  alvo_id?: string;
  dry_run?: boolean;
}

// --- Utilitarios ------------------------------------------------------------

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function emSegundos(s: number): string {
  return new Date(Date.now() + s * 1000).toISOString();
}

/** Backoff exponencial comecando em 1 minuto, teto de 1 hora. */
function backoffSegundos(tentativas: number): number {
  return Math.min(60 * 2 ** Math.max(tentativas - 1, 0), 3600);
}

function comoErro(e: unknown): ErroClassificado {
  if (e instanceof FalhaPasso) return e.classificado;
  return erroTransitorio(
    'erro_inesperado',
    'Ocorreu uma falha inesperada ao processar este item. A fila tenta de novo automaticamente.',
    { mensagem: e instanceof Error ? e.message : String(e) },
  );
}

/**
 * Verdadeiro so quando a Meta recusou a requisicao de forma definitiva (4xx):
 * ai sabemos que nada foi publicado. 5xx e timeout ficam de fora de proposito —
 * a Meta pode ter processado antes de estourar, e nesses casos reconciliamos.
 */
function recusaDefinitiva(e: unknown): boolean {
  if (!(e instanceof FalhaMeta)) return false;
  const status = e.registro.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

// --- Acesso a dados ---------------------------------------------------------

/**
 * Escrita cercada pelo lock_token: se outro tick reivindicou o alvo no meio do
 * caminho, esta atualizacao nao encosta na linha.
 */
async function patchAlvo(
  sb: SupabaseClient,
  alvo: PostAlvo,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await sb
    .from('post_alvos')
    .update(patch)
    .eq('id', alvo.id)
    .eq('lock_token', alvo.lock_token)
    .select('id');

  if (error) throw new Error(`Falha ao atualizar post_alvos: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

async function carregarContexto(
  sb: SupabaseClient,
  alvo: PostAlvo,
): Promise<{ post: Post; midias: PostMidia[]; ctx: ContextoConta; adaptador: AdaptadorPlataforma }> {
  const { data: post, error: erroPost } = await sb
    .from('posts')
    .select('id, cliente_id, titulo_interno, tipo, legenda, primeiro_comentario, agendado_para, status')
    .eq('id', alvo.post_id)
    .single();

  if (erroPost || !post) {
    throw new FalhaPasso(
      erroPermanente('post_inexistente', 'O post deste item nao existe mais no banco.', erroPost),
    );
  }

  const { data: midias, error: erroMidias } = await sb
    .from('post_midias')
    .select('id, post_id, ordem, storage_path, mime, largura, altura, duracao_segundos, tamanho_bytes')
    .eq('post_id', alvo.post_id)
    .order('ordem', { ascending: true });

  if (erroMidias) {
    throw new FalhaPasso(
      erroTransitorio('leitura_midias_falhou', 'Nao foi possivel ler as midias do post agora.', erroMidias),
    );
  }

  // Unica porta de saida do Vault. O token nao passa pelo front em momento algum.
  const { data: contas, error: erroToken } = await sb.rpc('obter_token_conta', {
    p_conta_social_id: alvo.conta_social_id,
  });

  if (erroToken || !contas || (contas as ContextoConta[]).length === 0) {
    throw new FalhaPasso(
      erroPermanente(
        'token_indisponivel',
        erroToken?.message ??
          'Nao foi possivel obter o token da Meta para esta conta. Confira o cadastro no Vault.',
        erroToken,
      ),
    );
  }

  const ctx = (contas as ContextoConta[])[0];
  const adaptador = ADAPTADORES[ctx.plataforma];

  if (!adaptador) {
    throw new FalhaPasso(
      erroPermanente(
        'plataforma_nao_suportada',
        `Esta versao publica apenas no Instagram. Plataforma da conta: "${ctx.plataforma}".`,
      ),
    );
  }

  return { post: post as Post, midias: (midias ?? []) as PostMidia[], ctx, adaptador };
}

async function urlsAssinadas(sb: SupabaseClient, midias: PostMidia[]): Promise<MidiaEntrada[]> {
  const saida: MidiaEntrada[] = [];

  for (const m of midias) {
    const { data, error } = await sb.storage
      .from('midias-posts')
      .createSignedUrl(m.storage_path, TTL_URL_ASSINADA);

    if (error || !data?.signedUrl) {
      throw new FalhaPasso(
        erroPermanente(
          'midia_inacessivel',
          `Nao foi possivel gerar o link do arquivo "${m.storage_path}". Confirme se ele ainda esta no Storage.`,
          error,
        ),
      );
    }

    saida.push({
      ordem: m.ordem,
      url: data.signedUrl,
      mime: m.mime,
      largura: m.largura,
      altura: m.altura,
      duracao_segundos: m.duracao_segundos,
    });
  }

  return saida;
}

async function instanteDoEvento(
  sb: SupabaseClient,
  alvoId: string,
  evento: string,
): Promise<Date | null> {
  const { data } = await sb
    .from('publicacao_eventos')
    .select('criado_em')
    .eq('post_alvo_id', alvoId)
    .eq('evento', evento)
    .order('criado_em', { ascending: false })
    .limit(1);

  const bruto = data?.[0]?.criado_em;
  return bruto ? new Date(bruto) : null;
}

// --- Tratamento de falha ----------------------------------------------------

async function tratarFalha(
  sb: SupabaseClient,
  alvo: PostAlvo,
  cls: ErroClassificado,
  estadoRetorno: EstadoAlvo,
): Promise<ResultadoItem> {
  const tentativas = alvo.tentativas + 1;
  const podeTentarDeNovo = cls.familia === 'transitorio' && tentativas < MAX_TENTATIVAS;

  const base = {
    tentativas,
    erro_codigo: cls.codigo,
    erro_familia: cls.familia,
    lock_token: null,
    bloqueado_ate: null,
  };

  if (podeTentarDeNovo) {
    const espera = backoffSegundos(tentativas);
    await patchAlvo(sb, alvo, {
      ...base,
      estado: estadoRetorno,
      erro_mensagem: cls.mensagem,
      proxima_tentativa_em: emSegundos(espera),
    });
    await registrarEvento(sb, alvo.id, 'erro_transitorio', {
      codigo: cls.codigo,
      mensagem: cls.mensagem,
      tentativas,
      nova_tentativa_em_segundos: espera,
      detalhe: cls.detalhe ?? null,
    });

    return {
      alvo_id: alvo.id,
      post_id: alvo.post_id,
      de: alvo.estado,
      para: estadoRetorno,
      nota: `nova tentativa em ${espera}s (${tentativas}/${MAX_TENTATIVAS})`,
      erro: { familia: cls.familia, codigo: cls.codigo, mensagem: cls.mensagem },
    };
  }

  const mensagem = cls.familia === 'transitorio'
    ? `${cls.mensagem} O limite de ${MAX_TENTATIVAS} tentativas foi atingido.`
    : cls.mensagem;

  await patchAlvo(sb, alvo, {
    ...base,
    estado: 'falhou',
    erro_mensagem: mensagem,
    proxima_tentativa_em: null,
  });
  await registrarEvento(sb, alvo.id, 'erro_permanente', {
    codigo: cls.codigo,
    mensagem,
    tentativas,
    familia_original: cls.familia,
    detalhe: cls.detalhe ?? null,
  });
  await alertar('Publicacao falhou', {
    post_alvo_id: alvo.id,
    post_id: alvo.post_id,
    codigo: cls.codigo,
    motivo: mensagem,
  });

  return {
    alvo_id: alvo.id,
    post_id: alvo.post_id,
    de: alvo.estado,
    para: 'falhou',
    erro: { familia: cls.familia, codigo: cls.codigo, mensagem },
  };
}

// --- Passos da maquina de estados -------------------------------------------

async function passoCriarContainer(
  sb: SupabaseClient,
  alvo: PostAlvo,
  dryRun: boolean,
): Promise<ResultadoItem> {
  const { post, midias, ctx, adaptador } = await carregarContexto(sb, alvo);

  if (midias.length === 0) {
    throw new FalhaPasso(
      erroPermanente('post_sem_midia', 'O post nao tem nenhum arquivo de midia anexado.'),
    );
  }

  const entradas = await urlsAssinadas(sb, midias);

  if (dryRun) {
    return {
      alvo_id: alvo.id,
      post_id: alvo.post_id,
      de: alvo.estado,
      para: alvo.estado,
      nota: `dry_run: criaria container ${post.tipo} com ${entradas.length} arquivo(s)`,
    };
  }

  // Marca o passo em voo ANTES de falar com a Meta: se a execucao morrer aqui,
  // o lease vencido devolve para "pendente" — o container orfao expira sozinho
  // em 24h sem publicar nada, entao vazar container e seguro.
  await patchAlvo(sb, alvo, { estado: 'container_criando' });
  await registrarEvento(sb, alvo.id, 'container_solicitado', {
    tipo: post.tipo,
    arquivos: entradas.length,
    ttl_url_segundos: TTL_URL_ASSINADA,
  });

  const resultado = await adaptador.criarContainer(ctx, {
    tipo: post.tipo,
    legenda: post.legenda,
    midias: entradas,
  });

  await registrarChamadas(sb, alvo.id, resultado.registros);

  const proximo: EstadoAlvo = resultado.aguardarProcessamento ? 'container_aguardando' : 'container_pronto';

  await patchAlvo(sb, alvo, {
    estado: proximo,
    container_id: resultado.containerId,
    container_children: resultado.children ?? null,
    erro_codigo: null,
    erro_familia: null,
    erro_mensagem: null,
    proxima_tentativa_em: resultado.aguardarProcessamento ? emSegundos(ESPERA_CONTAINER_SEGUNDOS) : null,
    lock_token: null,
    bloqueado_ate: null,
  });
  await registrarEvento(sb, alvo.id, 'container_criado', {
    container_id: resultado.containerId,
    children: resultado.children ?? null,
  });

  return { alvo_id: alvo.id, post_id: alvo.post_id, de: alvo.estado, para: proximo };
}

async function passoVerificarContainer(
  sb: SupabaseClient,
  alvo: PostAlvo,
  dryRun: boolean,
): Promise<ResultadoItem> {
  if (!alvo.container_id) {
    throw new FalhaPasso(
      erroPermanente('sem_container_id', 'O item esta aguardando um container que nao foi registrado.'),
    );
  }

  const { ctx, adaptador } = await carregarContexto(sb, alvo);

  if (dryRun) {
    return { alvo_id: alvo.id, post_id: alvo.post_id, de: alvo.estado, para: alvo.estado, nota: 'dry_run' };
  }

  const status = await adaptador.verificarContainer(ctx, alvo.container_id);
  await registrarChamadas(sb, alvo.id, status.registros);

  if (status.estado === 'pronto') {
    await patchAlvo(sb, alvo, {
      estado: 'container_pronto',
      proxima_tentativa_em: null,
      erro_codigo: null,
      erro_familia: null,
      erro_mensagem: null,
      lock_token: null,
      bloqueado_ate: null,
    });
    return { alvo_id: alvo.id, post_id: alvo.post_id, de: alvo.estado, para: 'container_pronto' };
  }

  if (status.estado === 'publicado') {
    // Container ja publicado sem que tenhamos registrado: reconciliacao.
    return await passoReconciliar(sb, alvo, false);
  }

  if (status.estado === 'erro') {
    throw new FalhaPasso(
      erroPermanente(
        'container_recusado',
        'A Meta descartou o container desta midia (erro ou expiracao) antes da publicacao. ' +
          'Reenvie o arquivo e reagende.',
        { status: status.detalhe },
      ),
    );
  }

  // Ainda processando: espera fixa e sem consumir tentativa — isso e esperado
  // em video. O que limita e a idade do container.
  const criadoEm = await instanteDoEvento(sb, alvo.id, 'container_criado');
  if (criadoEm && Date.now() - criadoEm.getTime() > IDADE_MAX_CONTAINER_MS) {
    throw new FalhaPasso(
      erroPermanente(
        'container_demorou_demais',
        'A Meta nao terminou de processar esta midia dentro do tempo limite. Reenvie o arquivo.',
        { status: status.detalhe },
      ),
    );
  }

  await patchAlvo(sb, alvo, {
    proxima_tentativa_em: emSegundos(ESPERA_CONTAINER_SEGUNDOS),
    lock_token: null,
    bloqueado_ate: null,
  });
  await registrarEvento(sb, alvo.id, 'container_processando', { status: status.detalhe ?? null });

  return {
    alvo_id: alvo.id,
    post_id: alvo.post_id,
    de: alvo.estado,
    para: 'container_aguardando',
    nota: `container ainda processando; nova checagem em ${ESPERA_CONTAINER_SEGUNDOS}s`,
  };
}

async function passoPublicar(
  sb: SupabaseClient,
  alvo: PostAlvo,
  dryRun: boolean,
): Promise<ResultadoItem> {
  if (!alvo.container_id) {
    throw new FalhaPasso(
      erroPermanente(
        'sem_container_id',
        'O item esta pronto para publicar mas nao tem container registrado.',
      ),
    );
  }

  const { post, ctx, adaptador } = await carregarContexto(sb, alvo);

  if (dryRun) {
    return {
      alvo_id: alvo.id,
      post_id: alvo.post_id,
      de: alvo.estado,
      para: alvo.estado,
      nota: `dry_run: publicaria o container ${alvo.container_id}`,
    };
  }

  // Cota: janela movel de 24h lida da propria Meta, nunca contador local.
  const cota = await adaptador.consultarCota(ctx);
  await registrarChamadas(sb, alvo.id, cota.registros);

  if (cota.total > 0 && cota.usadas >= cota.total) {
    // Nao consome tentativa: cota estourada nao e defeito do post.
    await patchAlvo(sb, alvo, {
      proxima_tentativa_em: emSegundos(ESPERA_COTA_SEGUNDOS),
      erro_codigo: 'cota_24h_estourada',
      erro_familia: 'transitorio',
      erro_mensagem:
        `A conta ja usou ${cota.usadas} de ${cota.total} publicacoes na janela de 24h da Meta. ` +
        'A fila retoma sozinha assim que a janela abrir.',
      lock_token: null,
      bloqueado_ate: null,
    });
    await registrarEvento(sb, alvo.id, 'cota_estourada', { usadas: cota.usadas, total: cota.total });

    return {
      alvo_id: alvo.id,
      post_id: alvo.post_id,
      de: alvo.estado,
      para: 'container_pronto',
      nota: `cota 24h estourada (${cota.usadas}/${cota.total}); reavalia em ${ESPERA_COTA_SEGUNDOS}s`,
    };
  }

  // A partir daqui esta o unico passo capaz de duplicar um post.
  await registrarEvento(sb, alvo.id, 'publicacao_solicitada', {
    container_id: alvo.container_id,
    cota_usada: cota.usadas,
    cota_total: cota.total,
  });
  await patchAlvo(sb, alvo, { estado: 'publicando' });

  let mediaId: string;
  try {
    const resultado = await adaptador.publicar(ctx, alvo.container_id);
    await registrarChamadas(sb, alvo.id, resultado.registros);
    mediaId = resultado.mediaId;
  } catch (e) {
    if (recusaDefinitiva(e)) {
      // 4xx: a Meta recusou a requisicao, nada foi publicado. Retry e seguro.
      throw e;
    }
    // Timeout, rede ou 5xx: nao sabemos se publicou. Deixa em "publicando" para
    // o proximo tick reconciliar. Republicar as cegas aqui e o pior bug possivel.
    const cls = comoErro(e);
    await patchAlvo(sb, alvo, {
      estado: 'publicando',
      tentativas: alvo.tentativas + 1,
      erro_codigo: 'publicacao_indefinida',
      erro_familia: 'transitorio',
      erro_mensagem: 'A resposta da Meta a publicacao se perdeu. O sistema vai conferir com a Meta ' +
        'se o post saiu antes de qualquer nova tentativa.',
      proxima_tentativa_em: emSegundos(60),
      lock_token: null,
      bloqueado_ate: null,
    });
    await registrarEvento(sb, alvo.id, 'publicacao_indefinida', {
      codigo: cls.codigo,
      detalhe: cls.detalhe ?? null,
    });

    return {
      alvo_id: alvo.id,
      post_id: alvo.post_id,
      de: alvo.estado,
      para: 'publicando',
      nota: 'resposta perdida; sera reconciliado no proximo tick',
      erro: { familia: 'transitorio', codigo: 'publicacao_indefinida', mensagem: cls.mensagem },
    };
  }

  await patchAlvo(sb, alvo, {
    estado: 'publicado',
    media_id_publicado: mediaId,
    publicado_em: new Date().toISOString(),
    proxima_tentativa_em: null,
    erro_codigo: null,
    erro_familia: null,
    erro_mensagem: null,
    lock_token: null,
    bloqueado_ate: null,
  });
  await registrarEvento(sb, alvo.id, 'publicacao_confirmada', { media_id: mediaId });

  await publicarPrimeiroComentario(sb, alvo, ctx, adaptador, post.primeiro_comentario, mediaId);

  return { alvo_id: alvo.id, post_id: alvo.post_id, de: alvo.estado, para: 'publicado' };
}

/** Falha aqui nao derruba o post: so registra aviso. */
async function publicarPrimeiroComentario(
  sb: SupabaseClient,
  alvo: PostAlvo,
  ctx: ContextoConta,
  adaptador: AdaptadorPlataforma,
  texto: string | null,
  mediaId: string,
): Promise<void> {
  if (!texto || !texto.trim()) return;

  try {
    const r = await adaptador.comentar(ctx, mediaId, texto);
    await registrarChamadas(sb, alvo.id, r.registros);
    await registrarEvento(sb, alvo.id, 'primeiro_comentario_publicado', { comentario_id: r.mediaId });
  } catch (e) {
    const cls = comoErro(e);
    await registrarEvento(sb, alvo.id, 'primeiro_comentario_falhou', {
      codigo: cls.codigo,
      mensagem: cls.mensagem,
      detalhe: cls.detalhe ?? null,
    });
    await alertar('Primeiro comentario nao foi publicado', {
      post_alvo_id: alvo.id,
      media_id: mediaId,
      motivo: cls.mensagem,
      observacao: 'O post principal foi publicado normalmente.',
    });
  }
}

/**
 * Chega aqui um alvo que ficou em "publicando" sem confirmacao. A pergunta e
 * uma so: a Meta publicou ou nao? Nunca "vamos tentar de novo e ver".
 */
async function passoReconciliar(
  sb: SupabaseClient,
  alvo: PostAlvo,
  dryRun: boolean,
): Promise<ResultadoItem> {
  if (!alvo.container_id) {
    throw new FalhaPasso(
      erroPermanente(
        'reconciliacao_sem_container',
        'Item interrompido durante a publicacao sem container registrado. Confira a conta manualmente.',
      ),
    );
  }

  const { ctx, adaptador } = await carregarContexto(sb, alvo);

  if (dryRun) {
    return { alvo_id: alvo.id, post_id: alvo.post_id, de: alvo.estado, para: alvo.estado, nota: 'dry_run' };
  }

  await registrarEvento(sb, alvo.id, 'reconciliacao_iniciada', { container_id: alvo.container_id });

  const status = await adaptador.verificarContainer(ctx, alvo.container_id);
  await registrarChamadas(sb, alvo.id, status.registros);

  const desde = (await instanteDoEvento(sb, alvo.id, 'publicacao_solicitada')) ??
    new Date(alvo.atualizado_em);
  const recentes = await adaptador.midiasPublicadasApos(ctx, desde);
  await registrarChamadas(sb, alvo.id, recentes.registros);

  // O status do container e a autoridade. Uma midia recente na conta sozinha
  // e indicio fraco (alguem pode ter postado a mao na mesma janela), mas basta
  // para NAO republicar: na duvida, o post fica marcado como publicado.
  const confirmadoPeloContainer = status.estado === 'publicado';
  const publicouDeFato = confirmadoPeloContainer || recentes.candidatos.length > 0;

  if (publicouDeFato) {
    // Publicado sem ID e aceitavel. Publicado duas vezes, nao.
    const mediaId = recentes.candidatos.length === 1 ? recentes.candidatos[0]!.id : null;
    const precisaConferencia = !confirmadoPeloContainer || !mediaId;

    await patchAlvo(sb, alvo, {
      estado: 'publicado',
      media_id_publicado: mediaId,
      publicado_em: new Date().toISOString(),
      proxima_tentativa_em: null,
      erro_codigo: precisaConferencia ? 'publicado_sem_confirmacao_plena' : null,
      erro_familia: null,
      erro_mensagem: precisaConferencia
        ? 'O post aparece como publicado, mas nao foi possivel confirmar com certeza qual midia ' +
          'na conta corresponde a ele. Confira o feed antes de reprocessar — o sistema nao vai ' +
          'republicar sozinho.'
        : null,
      lock_token: null,
      bloqueado_ate: null,
    });
    await registrarEvento(sb, alvo.id, 'publicado_reconciliado', {
      status_container: status.detalhe ?? status.estado,
      confirmado_pelo_container: confirmadoPeloContainer,
      media_id: mediaId,
      candidatos: recentes.candidatos.length,
    });

    return {
      alvo_id: alvo.id,
      post_id: alvo.post_id,
      de: alvo.estado,
      para: 'publicado',
      nota: mediaId ? 'reconciliado com media_id' : 'reconciliado sem media_id identificavel',
    };
  }

  if (status.estado === 'erro') {
    throw new FalhaPasso(
      erroPermanente(
        'container_recusado',
        'A Meta descartou o container antes de publicar. Reenvie o arquivo e reagende.',
        { status: status.detalhe },
      ),
    );
  }

  // Container intacto e nenhuma midia nova na conta: a publicacao
  // comprovadamente nao aconteceu. So aqui e seguro voltar para o caminho normal.
  await patchAlvo(sb, alvo, {
    estado: 'container_pronto',
    proxima_tentativa_em: emSegundos(backoffSegundos(alvo.tentativas + 1)),
    erro_codigo: 'reconciliado_nao_publicado',
    erro_familia: 'transitorio',
    erro_mensagem: 'A publicacao anterior nao chegou a acontecer. A fila vai tentar de novo.',
    lock_token: null,
    bloqueado_ate: null,
  });
  await registrarEvento(sb, alvo.id, 'reconciliado_nao_publicado', {
    status_container: status.detalhe ?? status.estado,
  });

  return {
    alvo_id: alvo.id,
    post_id: alvo.post_id,
    de: alvo.estado,
    para: 'container_pronto',
    nota: 'reconciliacao provou que nada foi publicado',
  };
}

// --- Orquestracao de um item ------------------------------------------------

async function processarAlvo(
  sb: SupabaseClient,
  alvo: PostAlvo,
  dryRun: boolean,
): Promise<ResultadoItem> {
  const estadoInicial = alvo.estado;

  try {
    switch (estadoInicial) {
      case 'pendente':
      case 'container_criando':
        return await passoCriarContainer(sb, alvo, dryRun);
      case 'container_aguardando':
        return await passoVerificarContainer(sb, alvo, dryRun);
      case 'container_pronto':
        return await passoPublicar(sb, alvo, dryRun);
      case 'publicando':
        return await passoReconciliar(sb, alvo, dryRun);
      default:
        throw new FalhaPasso(
          erroPermanente('estado_inesperado', `Estado "${estadoInicial}" nao deveria estar na fila.`),
        );
    }
  } catch (e) {
    const cls = comoErro(e);

    // Sempre volta para o estado de entrada. A ambiguidade perigosa (resposta
    // perdida no media_publish) e resolvida dentro do proprio passoPublicar,
    // que deixa o alvo em "publicando" para o proximo tick reconciliar.
    try {
      return await tratarFalha(sb, alvo, cls, estadoInicial);
    } catch (falhaAoRegistrar) {
      console.error(
        JSON.stringify({
          nivel: 'erro',
          origem: 'tratarFalha',
          post_alvo_id: alvo.id,
          detalhe: falhaAoRegistrar instanceof Error ? falhaAoRegistrar.message : String(falhaAoRegistrar),
        }),
      );
      return {
        alvo_id: alvo.id,
        post_id: alvo.post_id,
        de: estadoInicial,
        para: estadoInicial,
        erro: { familia: cls.familia, codigo: cls.codigo, mensagem: cls.mensagem },
      };
    }
  }
}

/** Pool simples: mantem CONCORRENCIA itens em voo, respeitando o prazo do tick. */
async function processarLote(
  sb: SupabaseClient,
  alvos: PostAlvo[],
  dryRun: boolean,
  inicio: number,
): Promise<{ resultados: ResultadoItem[]; naoProcessados: PostAlvo[] }> {
  const resultados: ResultadoItem[] = [];
  const fila = [...alvos];
  const naoProcessados: PostAlvo[] = [];

  async function trabalhador(): Promise<void> {
    for (;;) {
      const alvo = fila.shift();
      if (!alvo) return;

      if (Date.now() - inicio > LIMITE_TEMPO_MS - RESERVA_POR_ITEM_MS) {
        naoProcessados.push(alvo);
        continue;
      }

      resultados.push(await processarAlvo(sb, alvo, dryRun));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCORRENCIA, Math.max(alvos.length, 1)) }, () => trabalhador()),
  );

  return { resultados, naoProcessados };
}

// --- Handler ----------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const inicio = Date.now();
  const tickId = crypto.randomUUID();

  if (req.method !== 'POST') {
    return json(405, { ok: false, erro: 'Use POST.' });
  }

  // Duas coisas diferentes, duas respostas diferentes.
  //
  // Antes era uma: `if (!segredo || header !== segredo) return 401`. Parecia
  // seguro e era cego — variavel nao configurada e segredo errado davam a mesma
  // resposta, e ninguem de fora conseguia distinguir. O custo disso e concreto:
  // sem o TICK_SECRET na funcao, o pg_cron bate aqui de minuto em minuto
  // levando 401 para sempre, e a unica pista seria um log que ninguem le.
  //
  // Dizer "nao configurada" nao entrega nada a um atacante: ele ja sabe que nao
  // passou. Entrega a quem esta ligando a integracao a unica informacao que
  // resolve o problema.
  // A configuracao e conferida ANTES da autorizacao, e de proposito.
  //
  // O META_API_VERSION so era lido no instante de falar com a Meta: faltando,
  // o sintoma apareceria no primeiro post que nao sai, nao agora. Conferir
  // tudo na entrada troca "a gente descobre quando doer" por "a gente sabe
  // hoje" — que e a mesma escolha da mensagem do TICK_SECRET.
  //
  // Vem antes do 401 porque erro de configuracao nao e tentativa de invasao, e
  // quem esta ligando a integracao precisa da resposta sem ter o segredo em
  // maos. O que isso conta a um estranho — "falta uma variavel aqui" — nao
  // abre porta nenhuma; o que ele nao recebe continua sendo o acesso.
  const faltando = (['TICK_SECRET', 'META_API_VERSION'] as const).filter(
    (nome) => !Deno.env.get(nome)?.trim(),
  );
  if (faltando.length > 0) {
    return json(500, {
      ok: false,
      erro:
        `Faltam variaveis nesta funcao: ${faltando.join(', ')}. ` +
        'Defina em Settings > Edge Functions > Secrets. O TICK_SECRET tem de ter o MESMO ' +
        'valor da chave tick_secret do Vault, e o META_API_VERSION a versao vigente da Graph API.',
    });
  }

  const segredo = Deno.env.get('TICK_SECRET');
  if (!segredo) {
    // Inalcancavel depois da conferencia acima, e fica como rede: o dia em que
    // alguem mexer na lista, o TypeScript continua sabendo que isto pode ser
    // undefined.
    return json(500, { ok: false, erro: 'TICK_SECRET nao configurada nesta funcao.' });
  }
  if (req.headers.get('x-tick-secret') !== segredo) {
    return json(401, { ok: false, erro: 'Requisicao nao autorizada.' });
  }

  let corpo: CorpoRequisicao = {};
  try {
    const texto = await req.text();
    if (texto.trim()) corpo = JSON.parse(texto) as CorpoRequisicao;
  } catch {
    return json(400, { ok: false, erro: 'Corpo invalido: esperado JSON.' });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !chave) {
    console.error(JSON.stringify({ nivel: 'erro', tick_id: tickId, detalhe: 'SUPABASE_URL/KEY ausentes' }));
    return json(500, { ok: false, erro: 'Function mal configurada.' });
  }

  const sb = createClient(url, chave, { auth: { persistSession: false } });
  const dryRun = corpo.dry_run === true;
  const lock = crypto.randomUUID();

  try {
    // Execucoes anteriores que morreram no meio do passo voltam para a fila.
    const { data: liberados, error: erroLease } = await sb.rpc('liberar_leases_vencidos');
    if (erroLease) throw new Error(`liberar_leases_vencidos: ${erroLease.message}`);

    // Passo 1: posts agendados vencidos viram "publicando" e ganham alvos.
    const { data: promovidos, error: erroPromo } = await sb.rpc('promover_posts_agendados');
    if (erroPromo) throw new Error(`promover_posts_agendados: ${erroPromo.message}`);

    // Passo 2: reivindica o lote com lease (FOR UPDATE SKIP LOCKED por dentro).
    const rpcAlvos = corpo.alvo_id
      ? sb.rpc('reivindicar_alvo', {
        p_alvo_id: corpo.alvo_id,
        p_lock: lock,
        p_lease_segundos: LEASE_SEGUNDOS,
      })
      : sb.rpc('reivindicar_alvos', {
        p_lote: Math.max(1, corpo.lote ?? LOTE_PADRAO),
        p_lock: lock,
        p_lease_segundos: LEASE_SEGUNDOS,
      });

    const { data: alvosBrutos, error: erroAlvos } = await rpcAlvos;
    if (erroAlvos) throw new Error(`reivindicar: ${erroAlvos.message}`);

    const alvos = (alvosBrutos ?? []) as PostAlvo[];

    // Passo 3: um passo por item.
    const { resultados, naoProcessados } = await processarLote(sb, alvos, dryRun, inicio);

    // Devolve o que nao coube neste tick, sem esperar o lease vencer.
    for (const alvo of naoProcessados) {
      await patchAlvo(sb, alvo, { lock_token: null, bloqueado_ate: null }).catch(() => {});
    }

    // Passo 4: status do post derivado dos alvos.
    const postsTocados = [...new Set(resultados.map((r) => r.post_id))];
    for (const postId of postsTocados) {
      const { error } = await sb.rpc('recalcular_status_post', { p_post_id: postId });
      if (error) {
        console.error(
          JSON.stringify({
            nivel: 'erro',
            tick_id: tickId,
            origem: 'recalcular_status_post',
            post_id: postId,
            detalhe: error.message,
          }),
        );
      }
    }

    const resposta = {
      ok: true,
      tick_id: tickId,
      dry_run: dryRun,
      duracao_ms: Date.now() - inicio,
      leases_liberados: (liberados as number | null) ?? 0,
      promovidos: (promovidos as number | null) ?? 0,
      reivindicados: alvos.length,
      adiados: naoProcessados.length,
      processados: resultados,
    };

    console.log(JSON.stringify({ nivel: 'info', ...resposta, processados: resultados.length }));
    return json(200, resposta);
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ nivel: 'erro', tick_id: tickId, origem: 'publicar-tick', detalhe }));
    await alertar('O tick de publicacao falhou', { tick_id: tickId, detalhe });
    return json(500, { ok: false, tick_id: tickId, erro: detalhe, duracao_ms: Date.now() - inicio });
  }
});
