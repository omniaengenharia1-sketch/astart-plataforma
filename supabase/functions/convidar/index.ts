// =============================================================================
// convidar — cria o acesso de alguem, de equipe ou de cliente.
//
// Existe porque criar usuario no Supabase Auth exige a service role, e service
// role nunca pode chegar ao navegador. O front chama esta funcao; ela confere
// quem pediu, convida pelo Auth e so entao grava o perfil ou o acesso.
//
// Regras:
//   1. So admin convida. A checagem usa o JWT de quem chamou, nao um parametro.
//   2. O convite NAO expira. Nao ha prazo em lugar nenhum deste caminho.
//   3. Ninguem e equipe e cliente ao mesmo tempo — o banco barra, e aqui a
//      mensagem vira portugues legivel em vez de erro de constraint.
//   4. Se o Auth criar o usuario e o banco recusar depois, a funcao desfaz o
//      usuario. Conta orfa no Auth vira gente que consegue logar e nao existe.
// =============================================================================

import { cabecalhosCors, origemPermitida, preflight } from '../_shared/cors.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

type Destino = 'equipe' | 'cliente';

interface Pedido {
  destino: Destino;
  email: string;
  nome?: string;
  /** destino = equipe */
  papel?: 'admin' | 'operacao' | 'financeiro' | 'leitura';
  cargo?: string;
  /** destino = cliente */
  clienteId?: string;
  papelCliente?: 'principal' | 'financeiro' | 'leitura';
  /** Para onde o convidado volta depois de criar a senha. */
  redirecionarPara?: string;
}

const PAPEIS_EQUIPE = ['admin', 'operacao', 'financeiro', 'leitura'];
const PAPEIS_CLIENTE = ['principal', 'financeiro', 'leitura'];

function cabecalhos(req: Request): Record<string, string> {
  return { 'content-type': 'application/json', ...cabecalhosCors(origemPermitida(req)) };
}

function erro(req: Request, mensagem: string, status: number): Response {
  return new Response(JSON.stringify({ erro: mensagem }), { status, headers: cabecalhos(req) });
}

function exigir(nome: string): string {
  const v = Deno.env.get(nome);
  if (!v) throw new Error(`Variavel de ambiente ${nome} nao configurada.`);
  return v;
}

/** Valida o corpo e devolve a mensagem do primeiro problema, ou null. */
function validar(p: Pedido): string | null {
  if (p.destino !== 'equipe' && p.destino !== 'cliente') {
    return 'Informe se o convite e para a equipe ou para um cliente.';
  }
  if (!p.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) {
    return 'E-mail invalido.';
  }
  if (p.destino === 'equipe') {
    if (!p.papel || !PAPEIS_EQUIPE.includes(p.papel)) {
      return `Papel invalido. Use um de: ${PAPEIS_EQUIPE.join(', ')}.`;
    }
    if (p.clienteId) return 'Convite de equipe nao leva cliente.';
  } else {
    if (!p.clienteId) return 'Convite de cliente precisa dizer qual cliente.';
    if (!p.papelCliente || !PAPEIS_CLIENTE.includes(p.papelCliente)) {
      return `Papel do cliente invalido. Use um de: ${PAPEIS_CLIENTE.join(', ')}.`;
    }
    if (p.papel) return 'Convite de cliente nao leva papel de equipe.';
  }
  return null;
}

/** Quem chamou e admin? Lido do JWT, com as politicas de RLS valendo. */
async function chamadoPorAdmin(url: string, anon: string, autorizacao: string): Promise<boolean> {
  const comoUsuario = createClient(url, anon, {
    global: { headers: { Authorization: autorizacao } },
    auth: { persistSession: false },
  });
  const { data, error } = await comoUsuario.rpc('usuario_admin');
  if (error) return false;
  return data === true;
}

async function gravarVinculo(
  sb: SupabaseClient,
  p: Pedido,
  userId: string,
  conviteId: string,
  convidadoPor: string | null,
): Promise<void> {
  if (p.destino === 'equipe') {
    const { error } = await sb.from('perfis').insert({
      user_id: userId,
      nome: p.nome ?? null,
      email: p.email,
      papel: p.papel,
      cargo: p.cargo ?? null,
      convidado_por: convidadoPor,
    });
    if (error) throw error;
  } else {
    const { error } = await sb.from('clientes_usuarios').insert({
      user_id: userId,
      cliente_id: p.clienteId,
      nome: p.nome ?? null,
      email: p.email,
      papel_cliente: p.papelCliente,
      convidado_por: convidadoPor,
    });
    if (error) throw error;
  }

  const { error: erroConvite } = await sb
    .from('convites')
    .update({ aceito_em: new Date().toISOString(), aceito_por: userId })
    .eq('id', conviteId);
  if (erroConvite) throw erroConvite;
}

/**
 * Traduz o que o banco recusou. A mensagem dos gatilhos de separacao
 * equipe/cliente ja vem em portugues; o resto ganha um texto decente aqui.
 */
function mensagemDoBanco(e: unknown): string {
  const m = (e as { message?: string }).message ?? '';
  if (/faz parte da equipe|acesso de cliente/i.test(m)) return m;
  if (/duplicate key|unique/i.test(m)) return 'Esta pessoa ja tem acesso.';
  return `Nao consegui gravar o acesso: ${m}`;
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

  const problema = validar(pedido);
  if (problema) return erro(req, problema, 400);

  const url = exigir('SUPABASE_URL');
  const anon = exigir('SUPABASE_ANON_KEY');
  const servico = exigir('SUPABASE_SERVICE_ROLE_KEY');

  if (!(await chamadoPorAdmin(url, anon, autorizacao))) {
    return erro(req, 'So quem e admin convida.', 403);
  }

  const sb = createClient(url, servico, { auth: { persistSession: false } });

  const { data: quem } = await createClient(url, anon, {
    global: { headers: { Authorization: autorizacao } },
    auth: { persistSession: false },
  }).auth.getUser();
  const convidadoPor = quem?.user?.id ?? null;

  // 1. Registra o convite. O indice parcial do banco recusa um segundo convite
  //    em aberto para o mesmo e-mail, entao a corrida morre aqui.
  const { data: convite, error: erroConvite } = await sb
    .from('convites')
    .insert({
      destino: pedido.destino,
      email: pedido.email,
      nome: pedido.nome ?? null,
      papel: pedido.destino === 'equipe' ? pedido.papel : null,
      cargo: pedido.destino === 'equipe' ? (pedido.cargo ?? null) : null,
      cliente_id: pedido.destino === 'cliente' ? pedido.clienteId : null,
      papel_cliente: pedido.destino === 'cliente' ? pedido.papelCliente : null,
      criado_por: convidadoPor,
    })
    .select('id')
    .single();

  if (erroConvite || !convite) {
    const m = erroConvite?.message ?? '';
    if (/duplicate key|unique/i.test(m)) {
      return erro(req, 'Ja existe um convite em aberto para este e-mail. Revogue antes de reenviar.', 409);
    }
    return erro(req, `Nao consegui registrar o convite: ${m}`, 400);
  }

  // 2. Convida pelo Auth.
  const { data: criado, error: erroAuth } = await sb.auth.admin.inviteUserByEmail(pedido.email, {
    redirectTo: pedido.redirecionarPara,
    data: { nome: pedido.nome ?? null, destino: pedido.destino },
  });

  if (erroAuth || !criado?.user) {
    await sb.from('convites').update({ revogado_em: new Date().toISOString() }).eq('id', convite.id);
    const m = erroAuth?.message ?? 'motivo nao informado';
    if (/already been registered|already exists/i.test(m)) {
      return erro(req, 'Ja existe uma conta com este e-mail.', 409);
    }
    return erro(req, `O convite nao saiu: ${m}`, 502);
  }

  // 3. Grava o vinculo. Se o banco recusar, desfaz o usuario: conta orfa no
  //    Auth e gente que consegue logar e nao existe em lugar nenhum.
  try {
    await gravarVinculo(sb, pedido, criado.user.id, convite.id, convidadoPor);
  } catch (e) {
    await sb.auth.admin.deleteUser(criado.user.id);
    await sb.from('convites').update({ revogado_em: new Date().toISOString() }).eq('id', convite.id);
    return erro(req, mensagemDoBanco(e), 409);
  }

  return new Response(
    JSON.stringify({ conviteId: convite.id, userId: criado.user.id, email: pedido.email }),
    { status: 201, headers: cabecalhos(req) },
  );
});
