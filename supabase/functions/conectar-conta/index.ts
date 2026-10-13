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
  acao: 'descobrir' | 'salvar';
  clienteId: string;
  /** salvar */
  plataforma?: 'instagram' | 'facebook';
  nome?: string;
  igUserId?: string;
  pageId?: string;
}

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
  if (!pedido.clienteId) return erro(req, 'Diga de qual cliente e a conta.', 400);

  const sb = createClient(exigir('SUPABASE_URL'), exigir('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

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
      return erro(req, m, 502);
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
