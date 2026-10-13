/**
 * conectar-conta — liga a conta de Instagram de um cliente à plataforma.
 *
 * Por que isto é Edge Function e não RPC: descobrir QUAL Página e qual conta de
 * Instagram o Business Manager da Astart alcança exige falar com a Graph API
 * usando o token de System User. Esse token mora no Vault, lido por
 * `token_do_sistema()` com service role — nunca chega ao navegador.
 *
 * Duas ações:
 *   descobrir -> pergunta à Meta o que o token alcança, e devolve a lista com
 *                o nome de cada conta. Não grava nada.
 *   salvar    -> grava a conta escolhida.
 *
 * O passo de descobrir existe para você CONFERIR antes de salvar. Digitar um
 * `ig_user_id` à mão é como publicar no escuro: o número está certo ou o post
 * do seu cliente vai para a conta de outra pessoa, e isso não se desfaz.
 *
 * Só admin. Ligar a conta de um cliente envolve o Business Manager da agência e
 * o token compartilhado; a checagem usa o JWT de quem chamou, não um parâmetro.
 */
import { cabecalhosCors, origemPermitida, preflight } from '../_shared/cors.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { chamarGraph, FalhaMeta } from '../_shared/graph.ts';

interface Pedido {
  acao: 'descobrir' | 'salvar' | 'conferir';
  clienteId?: string;
  /** salvar */
  plataforma?: 'instagram' | 'facebook';
  nome?: string;
  igUserId?: string;
  pageId?: string;
}

/**
 * Os escopos que ESTE caminho precisa.
 *
 * A gente usa a Instagram API com Facebook Login: descobre as contas por
 * `me/accounts` (Páginas) e publica em `{ig-user-id}/media`. Os nomes dos
 * escopos desse caminho são estes. O caminho alternativo — Instagram API com
 * Instagram Login — usa outros nomes (`instagram_business_*`), e pedir os
 * nomes do caminho errado na homologação queima um ciclo de análise inteiro.
 */
const ESCOPOS_NECESSARIOS = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
];

function cabecalhos(req: Request): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...cabecalhosCors(origemPermitida(req)),
  };
}

function erro(req: Request, mensagem: string, status: number): Response {
  return new Response(JSON.stringify({ erro: mensagem }), { status, headers: cabecalhos(req) });
}

function exigir(nome: string): string {
  const v = Deno.env.get(nome);
  if (!v) throw new Error(`Variavel de ambiente ${nome} nao configurada.`);
  return v;
}

/** Quem chamou é admin? Lido do JWT, com as políticas de RLS valendo. */
async function souAdmin(autorizacao: string): Promise<boolean> {
  const comoUsuario = createClient(exigir('SUPABASE_URL'), exigir('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: autorizacao } },
  });
  const { data, error } = await comoUsuario.rpc('usuario_admin');
  return !error && data === true;
}

interface ContaDaMeta {
  pageId: string;
  pageName: string;
  igUserId: string | null;
  igUsername: string | null;
}

async function descobrir(sb: SupabaseClient): Promise<ContaDaMeta[]> {
  const { data: token, error } = await sb.rpc('token_do_sistema');
  if (error || typeof token !== 'string') {
    throw new Error(error?.message ?? 'Nao consegui ler o token da Meta no Vault.');
  }

  // `me/accounts` devolve as Páginas que o token alcança, e cada uma traz a
  // conta de Instagram vinculada — que é o que precisamos para publicar.
  const { dados } = await chamarGraph<{
    data?: { id: string; name: string; instagram_business_account?: { id: string; username?: string } }[];
  }>({
    metodo: 'GET',
    caminho: 'me/accounts',
    token,
    operacao: 'descobrir_contas',
    params: { fields: 'id,name,instagram_business_account{id,username}', limit: '100' },
  });

  return (dados.data ?? []).map((p) => ({
    pageId: p.id,
    pageName: p.name,
    igUserId: p.instagram_business_account?.id ?? null,
    igUsername: p.instagram_business_account?.username ?? null,
  }));
}

interface SaudeDoToken {
  valido: boolean;
  /** USER, SYSTEM_USER, PAGE… como a Meta chama. Nulo quando ela não diz. */
  tipo: string | null;
  /** ISO, ou nulo quando o token não expira (é o que a gente quer). */
  expiraEm: string | null;
  jaExpirou: boolean;
  escopos: string[];
  escoposFaltando: string[];
  appId: string | null;
  /**
   * Como a pergunta foi feita. `so_a_data` quer dizer que a Meta nem aceitou a
   * pergunta — o diagnóstico saiu do que o banco sabe, e não dela.
   */
  conferidoCom: 'app_token' | 'proprio_token' | 'so_a_data';
  /** Quando a chave entrou no Vault. É metadado, nunca o valor. */
  cadastradaEm: string | null;
  /** Sinalizadores de formato (0050). Nunca o valor nem parte dele. */
  formato: FormatoDoToken | null;
  diagnostico: string;
  oQueFazer: string | null;
}

interface FormatoDoToken {
  cadastrada: boolean;
  tamanho?: number;
  pontasSujas?: boolean;
  temQuebraDeLinha?: boolean;
  temAspas?: boolean;
  temSinaisDeMarcador?: boolean;
  soCaracteresEsperados?: boolean;
  comecaComEAA?: boolean;
}

/**
 * O que o formato do token denuncia, em português.
 *
 * Separa "o texto está quebrado" de "o token está morto" — duas coisas com dois
 * consertos completamente diferentes, que até a 0050 davam a mesma mensagem.
 * Token recém-gravado e recusado com 190 quase nunca é validade; é o texto.
 */
function oQueOFormatoDiz(f: FormatoDoToken | null): string[] {
  if (!f?.cadastrada) return [];
  const notas: string[] = [];

  // Primeiro da lista porque é o caso mais provável: a instrução que a gente
  // mesmo dava — `'<valor novo>'` — convidava a deixar os sinais no valor.
  if (f.temSinaisDeMarcador) {
    notas.push(
      'O valor guardado tem os sinais < e > dentro dele. Eles eram só o marcador de lugar no ' +
        'comando: o token vai entre as aspas, SEM < e >. Grave de novo tirando os dois sinais.',
    );
  }
  if (f.temAspas) {
    notas.push(
      'O valor guardado TEM ASPAS dentro dele. Isso acontece quando as aspas do comando SQL ' +
        'entram no valor: o certo é só o token entre as aspas, nunca aspas dentro.',
    );
  }
  if (f.pontasSujas || f.temQuebraDeLinha) {
    notas.push(
      'O valor tinha espaço ou quebra de linha nas pontas. Isso sozinho faz a Meta recusar, e ' +
        'é invisível na tela.',
    );
  }
  if (f.soCaracteresEsperados === false) {
    notas.push(
      'O valor tem caracteres que não existem em token da Meta. Provavelmente foi colado ' +
        'incompleto, ou não é um token.',
    );
  }
  if (f.comecaComEAA === false) {
    notas.push(
      'O valor não começa com "EAA", como os tokens da Meta começam. Confira se não foi colado ' +
        'o App ID ou outro campo no lugar do token.',
    );
  }
  if (typeof f.tamanho === 'number' && f.tamanho < 100) {
    notas.push(
      `O valor tem só ${f.tamanho} caracteres. Token de usuário do sistema costuma passar de ` +
        '150 — este parece truncado.',
    );
  }
  return notas;
}

/** "há 11 horas", "há 3 dias" — o que faz a data virar argumento. */
function faz(desde: Date): string {
  const h = (Date.now() - desde.getTime()) / 3_600_000;
  if (h < 1) return `há ${Math.max(1, Math.round(h * 60))} minuto(s)`;
  if (h < 48) return `há ${Math.round(h)} hora(s)`;
  return `há ${Math.round(h / 24)} dia(s)`;
}

/**
 * O diagnóstico que NÃO depende da Meta.
 *
 * Existe porque a conferência da 0048 tinha um buraco que só apareceu no caso
 * real: para perguntar `debug_token` você precisa de um token válido, e sem o
 * app token cadastrado o único token disponível é o que morreu. A pergunta
 * morria com ele, e a tela dizia "a Meta recusou a conferência" — verdade, e
 * inútil.
 *
 * A data de cadastro resolve o caso mais comum sem uma única chamada de rede:
 * token de usuário do sistema NÃO EXPIRA, então um token que a Meta recusa e
 * que foi cadastrado há poucas horas é, quase com certeza, o token curto do
 * Graph API Explorer. Dizer isso com a data na mão é mais útil que dizer
 * "expirou ou foi revogado" sem nada.
 */
async function saudePelaData(sb: SupabaseClient, recusa: string): Promise<SaudeDoToken> {
  const { data } = await sb.rpc('quando_a_chave_mudou', { p_nome: 'meta_system_user_token' });
  const { data: bruto } = await sb.rpc('formato_do_token_meta');
  const formato = (bruto as FormatoDoToken | null) ?? null;

  const quando = typeof data === 'string' ? new Date(data) : null;
  const horas = quando ? (Date.now() - quando.getTime()) / 3_600_000 : null;
  const notas = oQueOFormatoDiz(formato);

  const partes = [`A Meta recusou até a conferência do token: ${recusa}`];

  if (quando) partes.push(`A chave foi gravada ${faz(quando)}.`);

  // O formato vem ANTES de qualquer teoria sobre validade: um token recém
  // gravado e recusado quase nunca expirou — o texto está quebrado.
  if (notas.length > 0) {
    partes.push(...notas);
  } else if (horas !== null && horas < 1) {
    partes.push(
      'O texto do token está bem formado, e ele foi gravado agora — então não é validade. ' +
        'Sobram três causas: o token é de um app diferente do que a plataforma usa, o usuário ' +
        'do sistema não tem as Páginas e contas de Instagram como ativos, ou o token foi ' +
        'revogado logo depois de gerado (gerar um novo invalida o anterior).',
    );
  } else if (horas !== null && horas < 72) {
    partes.push(
      'Token de usuário do sistema NÃO EXPIRA. Um token gravado há tão pouco tempo e já ' +
        'recusado costuma ser o token curto que o Graph API Explorer entrega por padrão — ele ' +
        'vive de uma a duas horas.',
    );
  }

  partes.push(
    'Não dá para perguntar mais à Meta porque a própria pergunta precisa de um token válido, e ' +
      'meta_app_id/meta_app_secret não estão no Vault.',
  );

  return {
    valido: false,
    tipo: null,
    expiraEm: null,
    jaExpirou: false,
    escopos: [],
    escoposFaltando: [],
    appId: null,
    conferidoCom: 'so_a_data',
    cadastradaEm: quando ? quando.toISOString() : null,
    formato,
    diagnostico: partes.join(' '),
    oQueFazer: notas.length > 0
      ? 'Grave o token de novo, com cuidado para colar SÓ o token entre as aspas do comando, ' +
        'sem espaço, sem quebra de linha e sem aspas extras.'
      : 'Confira, no Business Manager: (1) que o token foi gerado para o MESMO app que a ' +
        'plataforma usa; (2) que o usuário do sistema tem as Páginas e as contas de Instagram ' +
        'como ativos, com controle total; (3) que ninguém gerou outro token depois deste, ' +
        'porque o novo invalida o anterior.',
  };
}

/**
 * A saúde do token, perguntada à Meta — não deduzida daqui.
 *
 * `GET /debug_token` responde tipo, validade e escopos. O detalhe que faz esta
 * função existir: para perguntar, você precisa de um token válido. Se o único
 * token que você tem é o que morreu, a pergunta morre com ele. Por isso o
 * app token (`app_id|app_secret`), que não expira: com ele dá para conferir um
 * token já morto e descobrir POR QUE morreu — que é exatamente o momento em
 * que alguém precisa saber.
 *
 * Sem as credenciais do app, cai para auto-inspeção e diz isso na resposta. Não
 * finge ter conferido do jeito bom.
 */
async function conferirToken(sb: SupabaseClient): Promise<SaudeDoToken> {
  const { data: token, error } = await sb.rpc('token_do_sistema');
  if (error || typeof token !== 'string') {
    throw new Error(error?.message ?? 'Nao consegui ler o token da Meta no Vault.');
  }

  const { data: credenciais, error: erroCred } = await sb.rpc('credenciais_do_app_meta');
  if (erroCred) throw new Error(erroCred.message);

  const app = (credenciais as { app_id: string; app_secret: string }[] | null)?.[0];
  const conferidoCom = app ? 'app_token' as const : 'proprio_token' as const;

  interface RespostaDebug {
    data?: {
      app_id?: string;
      type?: string;
      is_valid?: boolean;
      expires_at?: number;
      scopes?: string[];
      error?: { message?: string };
    };
  }

  let dados: RespostaDebug;
  try {
    ({ dados } = await chamarGraph<RespostaDebug>({
      metodo: 'GET',
      caminho: 'debug_token',
      token: app ? `${app.app_id}|${app.app_secret}` : token,
      operacao: 'conferir_token',
      params: { input_token: token },
    }));
  } catch (e) {
    // Com o app token, uma recusa aqui é problema do app — e tem de subir.
    // Sem ele, a recusa é ESPERADA quando o token esta morto: a pergunta usou
    // o proprio token. Ai o diagnostico sai da data, que e melhor que nada e,
    // neste caso, melhor que a resposta da Meta teria sido.
    if (app || !(e instanceof FalhaMeta)) throw e;
    return await saudePelaData(sb, e.message);
  }

  const d = dados.data ?? {};
  const escopos = d.scopes ?? [];
  const escoposFaltando = ESCOPOS_NECESSARIOS.filter((e) => !escopos.includes(e));

  // `expires_at = 0` quer dizer "não expira", que é o que um token de System
  // User devolve. Qualquer número diferente de zero é uma data de morte.
  const expira = typeof d.expires_at === 'number' && d.expires_at > 0 ? d.expires_at * 1000 : null;
  const jaExpirou = expira !== null && expira < Date.now();
  const valido = d.is_valid === true && !jaExpirou;
  const tipo = d.type ?? null;

  const partes: string[] = [];
  let oQueFazer: string | null = null;

  if (tipo && tipo !== 'SYSTEM_USER') {
    // O diagnóstico que resolve o caso mais comum: o token do Graph API
    // Explorer é de USUÁRIO e vive uma ou duas horas. Ele FUNCIONA no teste e
    // morre antes do primeiro post agendado — o pior tipo de erro, porque
    // parece ter dado certo.
    partes.push(
      `Este token é do tipo ${tipo}, não SYSTEM_USER. Token de usuário vive de uma a duas ` +
        'horas e morre sozinho, mesmo sem ninguém mexer.',
    );
    oQueFazer =
      'Gere um token de usuário do sistema: Business Manager → Configurações do negócio → ' +
      'Usuários → Usuários do sistema → o usuário da Astart → Gerar novo token. Escolha o app, ' +
      'marque os escopos, e em "Expiração do token" escolha NUNCA.';
  } else if (jaExpirou) {
    partes.push(`O token expirou em ${new Date(expira!).toLocaleString('pt-BR')}.`);
    oQueFazer = 'Gere um novo token de usuário do sistema, com expiração NUNCA.';
  } else if (!valido) {
    partes.push('A Meta diz que este token não é válido.');
    oQueFazer =
      'Confira se o texto colado no Vault está completo e sem espaço sobrando, e se o app é o ' +
      'mesmo do Business Manager da Astart.';
  } else if (expira !== null) {
    partes.push(
      `O token é válido, mas expira em ${new Date(expira).toLocaleString('pt-BR')} — ` +
        'e quando expirar, os posts param sem avisar.',
    );
    oQueFazer = 'Gere um token de usuário do sistema com expiração NUNCA, para não repetir isto.';
  } else {
    partes.push('Token de usuário do sistema, válido e sem data de expiração. É o que se quer.');
  }

  if (escoposFaltando.length > 0) {
    partes.push(`Faltam escopos: ${escoposFaltando.join(', ')}.`);
    oQueFazer = (oQueFazer ? `${oQueFazer} ` : '') +
      `Ao gerar o token, marque: ${escoposFaltando.join(', ')}.`;
  }

  if (conferidoCom === 'proprio_token') {
    partes.push(
      'Conferido com o próprio token, porque meta_app_id e meta_app_secret não estão no Vault. ' +
        'Com eles, dá para conferir até um token já morto.',
    );
  }

  const { data: desde } = await sb.rpc('quando_a_chave_mudou', {
    p_nome: 'meta_system_user_token',
  });
  const { data: bruto } = await sb.rpc('formato_do_token_meta');
  const formato = (bruto as FormatoDoToken | null) ?? null;

  // Pontas sujas e aspas valem o aviso mesmo quando a Meta aceitou: hoje
  // funciona, e amanhã alguem troca a chave do mesmo jeito e nao funciona.
  const notas = oQueOFormatoDiz(formato);
  if (notas.length > 0) partes.push(...notas);

  return {
    valido,
    tipo,
    expiraEm: expira === null ? null : new Date(expira).toISOString(),
    jaExpirou,
    escopos,
    escoposFaltando,
    appId: d.app_id ?? null,
    conferidoCom,
    cadastradaEm: typeof desde === 'string' ? desde : null,
    formato,
    diagnostico: partes.join(' '),
    oQueFazer,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const voo = preflight(req);
  if (voo) return voo;

  if (req.method !== 'POST') return erro(req, 'Use POST.', 405);

  const autorizacao = req.headers.get('Authorization');
  if (!autorizacao) return erro(req, 'Faltou o cabecalho de autorizacao.', 401);

  let pedido: Pedido;
  try {
    pedido = (await req.json()) as Pedido;
  } catch {
    return erro(req, 'Corpo invalido: esperava JSON.', 400);
  }

  if (!(await souAdmin(autorizacao))) {
    return erro(req, 'So quem e direcao conecta conta de rede social.', 403);
  }
  // `conferir` e sobre o token da AGENCIA, nao de um cliente: nao pede cliente.
  if (pedido.acao !== 'conferir' && !pedido.clienteId) {
    return erro(req, 'Diga de qual cliente e a conta.', 400);
  }

  const sb = createClient(exigir('SUPABASE_URL'), exigir('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  if (pedido.acao === 'conferir') {
    try {
      return new Response(JSON.stringify(await conferirToken(sb)), { headers: cabecalhos(req) });
    } catch (e) {
      const m = e instanceof FalhaMeta
        ? `A Meta recusou a conferencia: ${e.message}`
        : e instanceof Error
          ? e.message
          : 'Nao consegui conferir o token.';
      return erro(req, m, 502);
    }
  }

  if (pedido.acao === 'descobrir') {
    try {
      const contas = await descobrir(sb);
      if (contas.length === 0) {
        return erro(
          req,
          'O token nao alcanca nenhuma Pagina. Confira no Business Manager da Astart se as ' +
            'Paginas e contas de Instagram dos clientes foram adicionadas como ativos do ' +
            'usuario do sistema.',
          404,
        );
      }
      return new Response(JSON.stringify({ contas }), { headers: cabecalhos(req) });
    } catch (e) {
      // Mensagem da Meta em portugues quando ela diz algo util; a nossa quando
      // o erro e nosso. O que nao pode e a pessoa ler "unknown error".
      const m = e instanceof FalhaMeta
        ? `A Meta recusou a consulta: ${e.message}`
        : e instanceof Error
          ? e.message
          : 'Nao consegui falar com a Meta.';

      // A recusa da Meta sozinha nao diz o que fazer: "expirou ou foi revogado"
      // cobre tres casos diferentes, com tres consertos diferentes. Entao a
      // gente PERGUNTA a ela o que esta errado e manda junto.
      //
      // A conferencia pode falhar tambem — e o caso de token morto sem as
      // credenciais do app, em que nem a pergunta passa. Falhar aqui nao pode
      // apagar o erro original, que e o que a pessoa precisa ver.
      let saude: SaudeDoToken | null = null;
      if (e instanceof FalhaMeta) {
        saude = await conferirToken(sb).catch(() => null);
      }

      return new Response(JSON.stringify({ erro: m, saude }), {
        status: 502,
        headers: cabecalhos(req),
      });
    }
  }

  if (pedido.acao === 'salvar') {
    const plataforma = pedido.plataforma ?? 'instagram';
    const { data, error } = await sb.rpc('salvar_conta_social', {
      p_cliente: pedido.clienteId,
      p_plataforma: plataforma,
      p_nome: pedido.nome ?? '',
      p_ig_user_id: pedido.igUserId ?? null,
      p_page_id: pedido.pageId ?? null,
    });

    if (error) return erro(req, error.message, 409);
    return new Response(JSON.stringify(data), { status: 201, headers: cabecalhos(req) });
  }

  return erro(req, 'Acao desconhecida. Use "descobrir" ou "salvar".', 400);
});
