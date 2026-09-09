// =============================================================================
// renovar-tokens — cron diario que renova os tokens de OAuth antes de vencerem.
//
// Contas com System User nao passam por aqui: o token nao expira. Esta funcao
// so existe por causa da excecao — o cliente que nao tem Business Manager.
//
// Regras:
//   1. Token que ainda nao venceu e renovado. Token ja vencido nao tem conserto
//      automatico: a Meta so devolve um novo apos alguem reconectar a conta.
//   2. Toda falha vira log estruturado + alerta. Um token que morre em silencio
//      derruba a publicacao daquele cliente sem ninguem perceber.
// =============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { chamarGraph, FalhaMeta } from '../_shared/graph.ts';
import { alertar } from '../_shared/eventos.ts';

interface ContaVencendo {
  conta_social_id: string;
  cliente_nome: string;
  nome_exibicao: string;
  token_expira_em: string;
  horas_restantes: number;
  situacao: 'vencendo' | 'vencido';
}

interface ResultadoConta {
  conta: string;
  cliente: string;
  situacao: string;
  resultado: 'renovado' | 'precisa_reconectar' | 'falhou';
  novo_vencimento?: string;
  motivo?: string;
}

const DIAS_ANTECEDENCIA = Number(Deno.env.get('RENOVAR_TOKEN_DIAS') ?? '7');

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * Troca um token de longa duracao por outro. A Meta devolve `expires_in` em
 * segundos; sem ele, nao da para saber quando renovar de novo — e a conta
 * voltaria a vencer em silencio.
 */
async function renovar(
  sb: SupabaseClient,
  conta: ContaVencendo,
  appId: string,
  appSecret: string,
): Promise<ResultadoConta> {
  const base: ResultadoConta = {
    conta: conta.nome_exibicao,
    cliente: conta.cliente_nome,
    situacao: conta.situacao,
    resultado: 'falhou',
  };

  if (conta.situacao === 'vencido') {
    return {
      ...base,
      resultado: 'precisa_reconectar',
      motivo: `O token venceu em ${conta.token_expira_em}. A Meta so devolve um novo depois que alguem ` +
        'reconectar a conta pelo painel. Renovacao automatica nao resolve este caso.',
    };
  }

  // O token atual e o insumo da troca, e sai do Vault pela mesma porta de sempre.
  const { data: ctx, error: erroToken } = await sb.rpc('obter_token_conta', {
    p_conta_social_id: conta.conta_social_id,
  });
  if (erroToken || !ctx || (ctx as { access_token: string }[]).length === 0) {
    return { ...base, motivo: erroToken?.message ?? 'Nao foi possivel ler o token atual no Vault.' };
  }
  const tokenAtual = (ctx as { access_token: string }[])[0].access_token;

  let novoToken: string;
  let expiraEm: Date;
  try {
    const { dados } = await chamarGraph<{ access_token?: string; expires_in?: number }>({
      metodo: 'GET',
      caminho: 'oauth/access_token',
      token: tokenAtual,
      operacao: 'meta.trocar_token_longa_duracao',
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: tokenAtual,
      },
    });

    if (!dados?.access_token) {
      return { ...base, motivo: 'A Meta respondeu sem devolver um token novo.' };
    }
    if (!dados.expires_in) {
      return {
        ...base,
        motivo: 'A Meta devolveu o token sem expires_in. Sem vencimento nao da para agendar a proxima ' +
          'renovacao, entao o token nao foi gravado.',
      };
    }
    novoToken = dados.access_token;
    expiraEm = new Date(Date.now() + dados.expires_in * 1000);
  } catch (e) {
    const motivo = e instanceof FalhaMeta
      ? e.classificado.mensagem
      : e instanceof Error
      ? e.message
      : String(e);
    return { ...base, motivo };
  }

  const { error: erroGravar } = await sb.rpc('atualizar_token_conta', {
    p_conta_social_id: conta.conta_social_id,
    p_token: novoToken,
    p_expira_em: expiraEm.toISOString(),
  });
  if (erroGravar) {
    return { ...base, motivo: `Token renovado na Meta mas nao gravado: ${erroGravar.message}` };
  }

  return { ...base, resultado: 'renovado', novo_vencimento: expiraEm.toISOString() };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const inicio = Date.now();
  const execucaoId = crypto.randomUUID();

  if (req.method !== 'POST') return json(405, { ok: false, erro: 'Use POST.' });

  const segredo = Deno.env.get('TICK_SECRET');
  if (!segredo || req.headers.get('x-tick-secret') !== segredo) {
    return json(401, { ok: false, erro: 'Requisicao nao autorizada.' });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appId = Deno.env.get('META_APP_ID');
  const appSecret = Deno.env.get('META_APP_SECRET');

  if (!url || !chave) return json(500, { ok: false, erro: 'Function mal configurada.' });
  if (!appId || !appSecret) {
    const erro = 'META_APP_ID e META_APP_SECRET nao configurados: sem eles nao ha como trocar o token.';
    console.error(JSON.stringify({ nivel: 'erro', execucao_id: execucaoId, detalhe: erro }));
    await alertar('Renovacao de token nao pode rodar', { execucao_id: execucaoId, detalhe: erro });
    return json(500, { ok: false, erro });
  }

  const sb = createClient(url, chave, { auth: { persistSession: false } });

  try {
    const { data, error } = await sb.rpc('contas_com_token_vencendo', { p_dias: DIAS_ANTECEDENCIA });
    if (error) throw new Error(`contas_com_token_vencendo: ${error.message}`);

    const contas = (data ?? []) as ContaVencendo[];
    const resultados: ResultadoConta[] = [];
    for (const conta of contas) {
      resultados.push(await renovar(sb, conta, appId, appSecret));
    }

    // Falha silenciosa e proibida: tudo que nao renovou vira alerta nominal.
    for (const r of resultados) {
      if (r.resultado === 'renovado') continue;
      await alertar(
        r.resultado === 'precisa_reconectar'
          ? 'Token da Meta venceu e precisa de reconexao'
          : 'Falha ao renovar token da Meta',
        { cliente: r.cliente, conta: r.conta, motivo: r.motivo ?? '' },
      );
    }

    const resposta = {
      ok: true,
      execucao_id: execucaoId,
      duracao_ms: Date.now() - inicio,
      dias_antecedencia: DIAS_ANTECEDENCIA,
      avaliadas: contas.length,
      renovadas: resultados.filter((r) => r.resultado === 'renovado').length,
      precisam_reconectar: resultados.filter((r) => r.resultado === 'precisa_reconectar').length,
      falharam: resultados.filter((r) => r.resultado === 'falhou').length,
      resultados,
    };

    console.log(JSON.stringify({ nivel: 'info', ...resposta }));
    return json(200, resposta);
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({ nivel: 'erro', execucao_id: execucaoId, origem: 'renovar-tokens', detalhe }),
    );
    await alertar('A rotina de renovacao de token falhou', { execucao_id: execucaoId, detalhe });
    return json(500, { ok: false, execucao_id: execucaoId, erro: detalhe });
  }
});
