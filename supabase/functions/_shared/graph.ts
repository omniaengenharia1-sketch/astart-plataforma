import { classificarErroMeta, type ErroClassificado, erroTransitorio, FalhaPasso } from './erros.ts';

const BASE = 'https://graph.facebook.com';

/** Registro de uma chamada, para publicacao_eventos. Nunca carrega token. */
export interface RegistroChamada {
  operacao: string;
  metodo: 'GET' | 'POST';
  url: string;
  corpo?: Record<string, unknown>;
  status?: number;
  resposta?: unknown;
  duracao_ms: number;
}

export class FalhaMeta extends FalhaPasso {
  constructor(classificado: ErroClassificado, readonly registro: RegistroChamada) {
    super(classificado);
    this.name = 'FalhaMeta';
  }
}

/**
 * A versao da Graph API e obrigatoria e vem do ambiente. Nao existe default
 * no codigo de proposito: versao chumbada e a forma mais silenciosa de
 * envelhecer uma integracao com a Meta.
 */
export function versaoApi(): string {
  const v = Deno.env.get('META_API_VERSION')?.trim();
  if (!v) {
    throw new Error(
      'META_API_VERSION nao configurada. Defina a versao vigente da Graph API ' +
        '(ex.: v23.0) em supabase secrets.',
    );
  }
  return v.startsWith('v') ? v : `v${v}`;
}

const SENSIVEL = /token|secret|authorization/i;

/** Remove qualquer par sensivel antes de virar log. */
function limpar(obj: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    saida[k] = SENSIVEL.test(k) ? '[redigido]' : v;
  }
  return saida;
}

/**
 * A URL que vai para o log, com todo parametro sensivel apagado.
 *
 * O `access_token` de um GET e acrescentado DEPOIS desta linha, e por isso
 * nunca aparecia. Mas isso era sorte de ordem, nao protecao: no dia em que uma
 * chamada levasse um token como parametro COMUM, ele entraria no log inteiro.
 *
 * Esse dia chegou com `debug_token?input_token=<token>` (0048) — a chamada que
 * pergunta a saude do token da agencia. Como `registro.url` e gravado em
 * `publicacao_eventos`, o token da Astart iria para uma tabela do banco, em
 * texto, por uma porta que ninguem estava olhando. Ja que `limpar()` cuidava
 * so do corpo, a URL passava livre.
 *
 * Entao a regra passa a valer nos dois lugares, e vale para quem vier depois.
 */
function urlParaLog(url: URL): string {
  const copia = new URL(url.toString());
  for (const [k] of [...copia.searchParams]) {
    if (SENSIVEL.test(k)) copia.searchParams.set(k, '[redigido]');
  }
  return copia.toString();
}

export interface OpcoesChamada {
  metodo: 'GET' | 'POST';
  caminho: string;
  token: string;
  operacao: string;
  params?: Record<string, string | undefined>;
  corpo?: Record<string, string | undefined>;
  timeoutMs?: number;
}

export async function chamarGraph<T>(
  opts: OpcoesChamada,
): Promise<{ dados: T; registro: RegistroChamada }> {
  const inicio = Date.now();
  const url = new URL(`${BASE}/${versaoApi()}/${opts.caminho.replace(/^\//, '')}`);

  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const urlSemToken = urlParaLog(url);

  const init: RequestInit = {
    method: opts.metodo,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
  };

  if (opts.metodo === 'POST') {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.corpo ?? {})) {
      if (v !== undefined) form.set(k, v);
    }
    form.set('access_token', opts.token);
    init.body = form;
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  } else {
    url.searchParams.set('access_token', opts.token);
  }

  const registroBase: Omit<RegistroChamada, 'duracao_ms'> = {
    operacao: opts.operacao,
    metodo: opts.metodo,
    url: urlSemToken,
    corpo: limpar(opts.corpo),
  };

  let resposta: Response;
  try {
    resposta = await fetch(url, init);
  } catch (e) {
    const registro: RegistroChamada = { ...registroBase, duracao_ms: Date.now() - inicio };
    const eNome = e instanceof Error ? e.name : 'erro';
    throw new FalhaMeta(
      erroTransitorio(
        eNome === 'TimeoutError' ? 'rede_timeout' : 'rede_indisponivel',
        'Nao foi possivel falar com a Meta agora (rede ou timeout). A fila tenta de novo automaticamente.',
        { nome: eNome, mensagem: e instanceof Error ? e.message : String(e) },
      ),
      registro,
    );
  }

  const texto = await resposta.text();
  let corpoJson: unknown = null;
  try {
    corpoJson = texto ? JSON.parse(texto) : null;
  } catch {
    corpoJson = { resposta_nao_json: texto.slice(0, 2000) };
  }

  const registro: RegistroChamada = {
    ...registroBase,
    status: resposta.status,
    resposta: corpoJson,
    duracao_ms: Date.now() - inicio,
  };

  if (!resposta.ok) {
    throw new FalhaMeta(classificarErroMeta(resposta.status, corpoJson), registro);
  }

  return { dados: corpoJson as T, registro };
}
