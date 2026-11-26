// =============================================================================
// cobrar-tick — emite as cobranças que vencem, pela Asaas.
//
// A dona: "vamos montar a estrutura asaas agora?".
//
// AS DECISOES DELA, E ONDE CADA UMA APARECE AQUI
//
//   DEZ DIAS ANTES do vencimento. A decisão antiga dizia "no dia do
//     vencimento", o que dá ao cliente zero dia para pagar; ela corrigiu
//     quando eu mostrei a conta. Vira `DIAS_ANTES`, lido do ambiente;
//   SEM multa e juros — nenhum `fine` nem `interest` vai no corpo;
//   PIX E BOLETO, sem cartão. `billingType: 'UNDEFINED'` é como a Asaas diz
//     "deixe o pagador escolher entre pix e boleto"; mandar BOLETO fixo
//     tiraria o pix, que é como quase todo mundo paga hoje;
//   SANDBOX primeiro. O ambiente vem de `ASAAS_AMBIENTE` e é gravado em
//     cada linha: sandbox e produção não compartilham NADA, e um código de
//     cliente de um não existe no outro.
//
// AS REGRAS QUE GOVERNAM ESTE ARQUIVO
//
//   1. Um tick avança cada cobrança UM passo e devolve o controle. Sem
//      sleep, sem polling dentro de uma invocação — igual ao publicar-tick.
//   2. O PIOR BUG POSSÍVEL é cobrar o cliente de outra pessoa duas vezes.
//      A fila do banco só devolve quem nunca foi emitido ou falhou, e
//      `cobrancas.lancamento_id` é UNIQUE: duas travas, uma na consulta e
//      outra no schema.
//   3. `externalReference` leva o id do lançamento para a Asaas. Se um dia
//      a resposta se perder no caminho — gravamos lá e não aqui —, é por
//      ele que dá para reconciliar sem adivinhar.
//   4. Falha silenciosa é proibida: toda recusa vira `cobranca_falhou` com
//      a mensagem em português, que aparece na tela do Financeiro.
// =============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** A Asaas exige User-Agent em contas criadas depois de 13/06/2024. */
const AGENTE = 'AstartPlataforma/1.0';
const LIMITE_TEMPO_MS = 45_000;
const DIAS_ANTES = Number(Deno.env.get('ASAAS_DIAS_ANTES') ?? '10');

interface NaFila {
  lancamentoId: string;
  clienteId: string;
  clienteNome: string;
  cnpjCpf: string;
  email: string | null;
  telefone: string | null;
  /** Nulo quando o cliente ainda não existe NESTE ambiente da Asaas. */
  asaasCustomer: string | null;
  descricao: string;
  valorCentavos: number;
  vencimento: string;
  tentativas: number;
}

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Traduz a recusa da Asaas para português, sem perder o original.
 *
 * O que vai para `ultimo_erro` aparece na tela do Financeiro: "invalid
 * cpfCnpj" não ajuda ninguém a consertar. A mensagem crua fica no fim, entre
 * parênteses, para quando eu precisar dela.
 */
function emPortugues(status: number, corpo: Record<string, unknown>): string {
  const erros = (corpo?.errors as { code?: string; description?: string }[] | undefined) ?? [];
  const primeiro = erros[0];
  const crua = primeiro?.description ?? JSON.stringify(corpo).slice(0, 200);

  if (status === 401) {
    return 'A Asaas recusou a chave. Confira `asaas_api_key` no cofre — '
      + 'chave de sandbox não serve em produção, nem o contrário.';
  }
  if (primeiro?.code === 'invalid_cpfCnpj' || /cpfCnpj/i.test(crua)) {
    return `O CPF/CNPJ deste cliente foi recusado pela Asaas. (${crua})`;
  }
  if (/customer/i.test(crua) && /not found|invalid/i.test(crua)) {
    return `A Asaas não reconheceu o cadastro deste cliente. (${crua})`;
  }
  if (status >= 500) {
    return `A Asaas está fora do ar neste momento (${status}). A próxima rodada tenta de novo.`;
  }
  return `A Asaas recusou (${status}): ${crua}`;
}

async function asaas(
  base: string, chave: string, caminho: string, metodo: string, corpo?: unknown,
): Promise<{ ok: boolean; status: number; dados: Record<string, unknown> }> {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      'access_token': chave,
      'content-type': 'application/json',
      'User-Agent': AGENTE,
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const dados = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, dados: dados as Record<string, unknown> };
}

/**
 * Acha ou cria o cliente na Asaas.
 *
 * Antes de criar, PROCURA pelo CPF/CNPJ. Sem isso, um banco restaurado de
 * backup — ou a mesma empresa cadastrada duas vezes aqui — criaria um
 * segundo cadastro lá, e as cobranças de um cliente ficariam espalhadas
 * entre dois registros.
 */
async function acharOuCriarCliente(
  sb: SupabaseClient, base: string, chave: string, ambiente: string, item: NaFila,
): Promise<string> {
  if (item.asaasCustomer) return item.asaasCustomer;

  const busca = await asaas(
    base, chave, `/customers?cpfCnpj=${encodeURIComponent(item.cnpjCpf)}&limit=1`, 'GET');
  if (!busca.ok) throw new Error(emPortugues(busca.status, busca.dados));

  const achado = (busca.dados.data as { id: string }[] | undefined)?.[0];
  let id = achado?.id;

  if (!id) {
    const criado = await asaas(base, chave, '/customers', 'POST', {
      name: item.clienteNome,
      cpfCnpj: item.cnpjCpf,
      email: item.email ?? undefined,
      mobilePhone: item.telefone ?? undefined,
      externalReference: item.clienteId,
      notificationDisabled: false,
    });
    if (!criado.ok) throw new Error(emPortugues(criado.status, criado.dados));
    id = criado.dados.id as string;
  }

  const { error } = await sb.rpc('casar_cliente_com_asaas', {
    p_cliente: item.clienteId, p_customer_id: id, p_ambiente: ambiente,
  });
  if (error) throw new Error(`Criei o cliente na Asaas mas não consegui gravar aqui: ${error.message}`);
  return id;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, erro: 'Use POST.' });

  const faltando = (['TICK_SECRET'] as const).filter((n) => !Deno.env.get(n)?.trim());
  if (faltando.length > 0) {
    return json(500, {
      ok: false,
      erro: `Faltam variáveis nesta função: ${faltando.join(', ')}. `
        + 'Defina em Settings > Edge Functions > Secrets.',
    });
  }
  if (req.headers.get('x-tick-secret') !== Deno.env.get('TICK_SECRET')) {
    return json(401, { ok: false, erro: 'Requisição não autorizada.' });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const servico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !servico) return json(500, { ok: false, erro: 'Function mal configurada.' });
  const sb = createClient(url, servico, { auth: { persistSession: false } });

  // A chave e o endereço vivem no Vault, e o Vault NÃO é lido daqui direto:
  // `sb.schema('vault')` devolve "Invalid schema: vault", porque o PostgREST
  // só expõe os schemas configurados — e expor o cofre na API seria abrir a
  // porta dos segredos para qualquer chave de leitura. Quem lê é uma função
  // `security definer` do banco, liberada só para o service role (0083).
  const { data: cfg, error: eSeg } = await sb.rpc('config_asaas');
  if (eSeg) return json(500, { ok: false, erro: `Não consegui ler o cofre: ${eSeg.message}` });

  const conf = (Array.isArray(cfg) ? cfg[0] : cfg) as
    { chave: string; base_url: string; ambiente: string } | undefined;
  if (!conf?.chave || !conf?.base_url) {
    return json(500, {
      ok: false,
      erro: 'Faltam `asaas_api_key` e/ou `asaas_base_url` no Vault. '
        + 'Sem elas não há como emitir cobrança.',
    });
  }
  const chave = conf.chave;
  const base = conf.base_url;
  const ambiente = conf.ambiente;

  const { data, error } = await sb.rpc('cobrancas_para_emitir', {
    p_ambiente: ambiente, p_dias_antes: DIAS_ANTES, p_limite: 50,
  });
  if (error) return json(500, { ok: false, erro: `cobrancas_para_emitir: ${error.message}` });

  const fila = (data ?? []) as NaFila[];
  const limiteEm = Date.now() + LIMITE_TEMPO_MS;
  const emitidas: unknown[] = [];
  const falhas: unknown[] = [];

  for (const item of fila) {
    if (Date.now() > limiteEm) break;
    try {
      const customer = await acharOuCriarCliente(sb, base, chave, ambiente, item);

      const r = await asaas(base, chave, '/payments', 'POST', {
        customer,
        // Deixa o pagador escolher entre pix e boleto. Sem cartão, decisão dela.
        billingType: 'UNDEFINED',
        value: item.valorCentavos / 100,
        dueDate: item.vencimento,
        description: item.descricao,
        // Por onde reconciliar se a resposta se perder no caminho.
        externalReference: item.lancamentoId,
      });
      if (!r.ok) throw new Error(emPortugues(r.status, r.dados));

      const pagamento = r.dados.id as string;

      // O código pix vem noutra chamada, e a Asaas o gera alguns SEGUNDOS
      // depois de criar a cobrança — no primeiro ciclo de verdade ele veio
      // vazio aqui e existia logo em seguida. Se falhar, a cobrança JÁ
      // EXISTE lá: gravar assim mesmo é melhor do que deixá-la órfã na
      // Asaas. Quem volta para buscar o que ficou para trás é a segunda
      // fila, no fim deste arquivo.
      let pix: string | null = null;
      const qr = await asaas(base, chave, `/payments/${pagamento}/pixQrCode`, 'GET');
      if (qr.ok) pix = (qr.dados.payload as string) ?? null;

      const { error: eGrava } = await sb.rpc('cobranca_emitida', {
        p_lancamento: item.lancamentoId,
        p_externo_id: pagamento,
        p_boleto_url: (r.dados.bankSlipUrl as string) ?? (r.dados.invoiceUrl as string) ?? null,
        p_pix: pix,
        p_vencimento: item.vencimento,
        p_valor_centavos: item.valorCentavos,
        p_ambiente: ambiente,
      });
      if (eGrava) throw new Error(`Emiti na Asaas mas não gravei aqui: ${eGrava.message}`);

      emitidas.push({ cliente: item.clienteNome, descricao: item.descricao, pagamento, pix: pix !== null });
    } catch (x) {
      const erro = x instanceof Error ? x.message : String(x);
      await sb.rpc('cobranca_falhou', { p_lancamento: item.lancamentoId, p_erro: erro });
      falhas.push({ cliente: item.clienteNome, descricao: item.descricao, erro });
    }
  }

  // ---- SEGUNDA FILA: o pix que chegou depois --------------------------
  //
  // Sem isto, a cobrança emitida sem pix nunca mais seria visitada — ela sai
  // da fila de emissão de propósito, e essa é a trava contra cobrar duas
  // vezes. O cliente abriria o portal e veria meia cobrança, sem erro nenhum
  // em lugar nenhum.
  const pixBuscado: unknown[] = [];
  if (Date.now() < limiteEm) {
    const { data: semPix } = await sb.rpc('cobrancas_sem_pix', {
      p_ambiente: ambiente, p_limite: 50,
    });
    for (const c of (semPix ?? []) as { lancamentoId: string; externoId: string }[]) {
      if (Date.now() > limiteEm) break;
      const qr = await asaas(base, chave, `/payments/${c.externoId}/pixQrCode`, 'GET');
      const payload = qr.ok ? (qr.dados.payload as string | undefined) : undefined;
      if (!payload) continue;
      const { error } = await sb.rpc('cobranca_ganhou_pix', {
        p_lancamento: c.lancamentoId, p_pix: payload,
      });
      if (!error) pixBuscado.push(c.externoId);
    }
  }

  return json(200, {
    ok: true,
    ambiente,
    diasAntes: DIAS_ANTES,
    naFila: fila.length,
    emitidas,
    falhas,
    pixBuscado,
  });
});
