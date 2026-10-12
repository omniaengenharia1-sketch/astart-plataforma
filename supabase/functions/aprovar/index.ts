// =============================================================================
// aprovar — a porta do link de aprovação sem conta.
//
// O cliente recebe um endereço no WhatsApp, abre, vê o lote e responde. Ele não
// tem conta, não vai criar uma, e a fila dele mora atrás de RLS. Então esta
// função é a única que pode: ela carrega o token até o banco e devolve o lote.
//
// A validação do token mora no banco (`envio_por_token`), não aqui: é lá que
// está o hash e é lá que `revogado` é conferido. Esta função só leva o token
// até lá — e é por isso que ela pode ser pública sem ser uma porta aberta.
//
// O que ela NÃO faz, de propósito: confiar em nada que vem no corpo além do
// token. Quem respondeu, qual item, qual decisão — tudo passa por
// `responder_por_token`, que confere se o item é daquele lote antes de gravar.
// Token vazado responde aquele lote e nada mais.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CABECALHOS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function erro(mensagem: string, status: number): Response {
  return new Response(JSON.stringify({ erro: mensagem }), { status, headers: CABECALHOS });
}

function exigir(nome: string): string {
  const v = Deno.env.get(nome);
  if (!v) throw new Error(`Variavel de ambiente ${nome} nao configurada.`);
  return v;
}

type Decisao = 'aprovado' | 'com_ajustes' | 'declinado';
const DECISOES: Decisao[] = ['aprovado', 'com_ajustes', 'declinado'];

interface Pedido {
  token?: string;
  acao?: 'abrir' | 'responder';
  item?: string;
  decisao?: string;
  quem?: string;
  comentario?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return erro('Use POST.', 405);

  let pedido: Pedido;
  try {
    pedido = await req.json();
  } catch {
    return erro('Corpo invalido: esperava JSON.', 400);
  }

  const token = (pedido.token ?? '').trim();
  // O token tem 64 hex. Mais curto que isso nem chega ao banco.
  if (token.length < 32) return erro('Este link não abre nada.', 404);

  const sb = createClient(exigir('SUPABASE_URL'), exigir('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  if ((pedido.acao ?? 'abrir') === 'responder') {
    if (!pedido.item) return erro('Faltou dizer qual item.', 400);

    const decisao = pedido.decisao as Decisao | undefined;
    if (!decisao || !DECISOES.includes(decisao)) {
      return erro('Decisão inválida.', 400);
    }
    // A tela também barra, mas a decisão de recusar é do banco: é ele que
    // garante, e é dele que sai a mensagem que a pessoa lê.
    const { error } = await sb.rpc('responder_por_token', {
      p_token: token,
      p_item: pedido.item,
      p_decisao: decisao,
      p_nome: pedido.quem ?? '',
      p_comentario: pedido.comentario ?? null,
    });
    if (error) return erro(error.message, 400);

    // Devolve o lote já atualizado: a página não precisa de uma segunda volta
    // para saber que o item saiu da fila (e que o lote talvez tenha fechado).
    const { data } = await sb.rpc('envio_por_token', { p_token: token });
    return new Response(JSON.stringify({ ok: true, lote: data }), { headers: CABECALHOS });
  }

  const { data, error } = await sb.rpc('envio_por_token', { p_token: token });
  if (error) return erro('Não consegui abrir este link.', 500);
  // Mesma resposta para token errado, link revogado e lote apagado. Dizer
  // "este lote existe, mas o link foi revogado" já conta demais a quem está
  // tentando adivinhar endereços.
  if (!data) return erro('Este link não vale mais.', 404);

  return new Response(JSON.stringify(data), { headers: CABECALHOS });
});
