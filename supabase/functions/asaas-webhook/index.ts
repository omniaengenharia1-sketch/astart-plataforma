// =============================================================================
// asaas-webhook — recebe o aviso de pagamento e dá baixa.
//
// A OUTRA METADE DA COBRANÇA. Sem ela, a plataforma emite boleto e nunca
// fica sabendo que alguém pagou: "Entrou R$ 0,00" para sempre, e a dona
// conferindo extrato na mão para marcar cada linha.
//
// QUEM AUTORIZA ESTA FUNÇÃO NÃO É O JWT
//
// Quem chama é a Asaas, que não tem conta aqui. A conferência é o cabeçalho
// `asaas-access-token`, comparado com o segredo que mora no Vault e que foi
// cadastrado no painel deles. Por isso ela entra na lista SEM_JWT do deploy.
//
// A comparação é de tempo constante. Comparar segredo com `===` vaza, por
// quanto tempo a comparação demora, por onde ele começa a divergir — e
// adivinhar byte a byte é um ataque conhecido, não teoria.
//
// IDEMPOTÊNCIA É O CORAÇÃO DESTE ARQUIVO
//
// A Asaas REENVIA o aviso até receber 200. Receber o mesmo evento duas vezes
// é o caso normal, não a exceção. Quem resolve isso é o banco:
// `cobranca_eventos.evento_externo_id` é unique e o registro acontece na
// mesma transação da baixa, então o reenvio vira no-op.
//
// E por isso esta função responde 200 mesmo para evento repetido ou
// desconhecido: 500 faria a Asaas reenviar para sempre, enchendo a fila
// deles e o nosso log, sem nunca resolver nada.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Comparação de tempo constante: `===` vaza o segredo pelo relógio. */
function igualSemVazar(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diferenca = 0;
  for (let i = 0; i < x.length; i += 1) diferenca |= x[i] ^ y[i];
  return diferenca === 0;
}

/** Reais com centavos -> centavos, sem passar por float. */
function emCentavos(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, erro: 'Use POST.' });

  const url = Deno.env.get('SUPABASE_URL');
  const servico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !servico) return json(500, { ok: false, erro: 'Function mal configurada.' });
  const sb = createClient(url, servico, { auth: { persistSession: false } });

  // O cofre não é lido daqui direto: o PostgREST não expõe o schema `vault`,
  // e expor seria abrir a porta dos segredos. Quem lê é uma função do banco,
  // `security definer`, liberada só para o service role (0083). Esta função
  // recebe SÓ o token do webhook — a chave da API ela não precisa, e dar o
  // que não se precisa é como vazamento começa.
  const { data: segredo, error: eSeg } = await sb.rpc('token_do_webhook_asaas');
  if (eSeg) return json(500, { ok: false, erro: `Não consegui ler o cofre: ${eSeg.message}` });

  const esperado = segredo as string | null;
  if (!esperado) {
    // Sem o segredo cadastrado, aceitar qualquer POST seria deixar a porta
    // do dinheiro aberta. Melhor recusar e dizer o que falta.
    return json(500, {
      ok: false,
      erro: 'Falta `asaas_webhook_token` no Vault. Sem ele não há como saber '
        + 'se o aviso veio mesmo da Asaas.',
    });
  }

  const recebido = req.headers.get('asaas-access-token') ?? '';
  if (!igualSemVazar(recebido, esperado)) {
    console.error(JSON.stringify({ nivel: 'erro', detalhe: 'webhook com token invalido' }));
    return json(401, { ok: false, erro: 'Aviso não autenticado.' });
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return json(400, { ok: false, erro: 'Corpo não é JSON.' });
  }

  const pagamento = (corpo.payment ?? {}) as Record<string, unknown>;
  const eventoId = String(corpo.id ?? '');
  const tipo = String(corpo.event ?? '');
  const externoId = String(pagamento.id ?? '');

  if (!eventoId || !tipo) {
    return json(400, { ok: false, erro: 'Aviso sem id de evento ou sem tipo.' });
  }

  const { data, error } = await sb.rpc('registrar_evento_de_cobranca', {
    p_evento_id: eventoId,
    p_tipo: tipo,
    p_externo_id: externoId,
    p_carga: corpo,
    p_pago_em: (pagamento.paymentDate as string) ?? (pagamento.clientPaymentDate as string) ?? null,
    p_valor_pago_centavos: emCentavos(pagamento.value),
    p_forma: (pagamento.billingType as string) ?? null,
  });

  if (error) {
    // 500 aqui é de propósito: a Asaas reenvia, e reenviar é o certo quando
    // o erro foi nosso. O que não pode é 500 em evento repetido — esse caso
    // o banco resolve devolvendo `false`, e a resposta abaixo é 200.
    console.error(JSON.stringify({ nivel: 'erro', evento: eventoId, detalhe: error.message }));
    return json(500, { ok: false, erro: error.message });
  }

  // `false` = já tínhamos visto este evento. 200, para a Asaas parar de
  // reenviar: dizer "já vi este" é a resposta certa, não um erro.
  return json(200, { ok: true, novo: data === true, evento: eventoId, tipo });
});
