// =============================================================================
// O link de aprovação sem conta.
//
// Arquivo separado da api porque aqui o chamador NÃO está logado: quem abre o
// endereço não tem conta e nunca vai ter. Tudo passa pela Edge Function
// `aprovar`, que carrega o token até o banco — o navegador de quem recebeu o
// link não fala com o Postgres.
// =============================================================================
import { sb } from './supabase';
import type { Decisao, LoteDoLink } from './tipos';

export class FalhaLink extends Error {}

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  if (!sb) throw new FalhaLink('Sem Supabase configurado.');
  const { data, error } = await sb.functions.invoke('aprovar', { body: corpo });
  if (error) {
    // A função responde { erro: "mensagem em português" } com status 4xx, e o
    // supabase-js embrulha isso num erro genérico. Sem abrir o corpo, quem
    // recebeu o link leria "Edge Function returned a non-2xx status code".
    let mensagem = error.message;
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const j = (await ctx.json()) as { erro?: string };
        if (j?.erro) mensagem = j.erro;
      } catch {
        /* fica a mensagem bruta, que é melhor que nada */
      }
    }
    throw new FalhaLink(mensagem);
  }
  return data as T;
}

export async function lotePorToken(token: string): Promise<LoteDoLink> {
  if (!sb) {
    const { loteExemplo } = await import('./mock');
    return loteExemplo(token);
  }
  return chamar<LoteDoLink>({ token, acao: 'abrir' });
}

/**
 * Responde um item do lote. Devolve o lote já atualizado: a página não precisa
 * de uma segunda volta para saber que o item saiu da fila — e para saber se
 * aquele era o último, o que fecha o lote.
 */
export async function responderPorToken(
  token: string,
  item: string,
  decisao: Decisao,
  quem: string,
  comentario?: string,
): Promise<LoteDoLink> {
  if (decisao === 'com_ajustes' && !comentario?.trim()) {
    throw new FalhaLink('Escreva o que precisa mudar para pedir ajuste.');
  }
  if (!quem.trim()) {
    throw new FalhaLink('Diga o seu nome para a equipe saber quem respondeu.');
  }

  if (!sb) {
    const { responderLoteExemplo } = await import('./mock');
    try {
      return responderLoteExemplo(token, item, decisao, quem, comentario);
    } catch (x) {
      throw new FalhaLink(x instanceof Error ? x.message : 'Não consegui registrar.');
    }
  }

  const r = await chamar<{ ok: boolean; lote: LoteDoLink }>({
    token,
    acao: 'responder',
    item,
    decisao,
    quem: quem.trim(),
    comentario: comentario?.trim() || undefined,
  });
  return r.lote;
}
