// =============================================================================
// A unica porta entre o front e os dados.
//
// Quando ha Supabase configurado, cada painel e UMA chamada RPC: a agregacao
// mora no banco, onde o RLS ja decide o que cada papel ve. O navegador nao
// monta painel juntando oito consultas que podem discordar entre si.
//
// Sem Supabase configurado, devolve os dados de exemplo. A tela diz que esta
// em modo exemplo; nada finge estar ligado.
// =============================================================================
import { ligado, sb } from './supabase';
import { PAINEL_CLIENTE, PAINEL_EQUIPE, SESSAO_CLIENTE, SESSAO_EQUIPE } from './mock';
import type { Cliente, PainelCliente, PainelEquipe, Perfil, Sessao } from './tipos';

export { ligado };

export class FalhaDados extends Error {}

/**
 * Em modo exemplo, qual persona esta aberta. Comeca nula de proposito: a tela
 * de entrada tem de aparecer igual, senao a primeira tela da plataforma nunca
 * e exercitada por quem esta avaliando.
 */
let personaExemplo: 'equipe' | 'cliente' | null = null;

function exija<T>(valor: T | null | undefined, oQue: string): T {
  if (valor === null || valor === undefined) {
    throw new FalhaDados(`${oQue} não voltou do servidor.`);
  }
  return valor;
}

/** O RPC devolve jsonb. Aqui ele vira um tipo, com os campos conferidos. */
function lerSessao(bruta: unknown): Sessao {
  if (typeof bruta !== 'object' || bruta === null) return { tipo: 'anonimo' };
  const o = bruta as Record<string, unknown>;

  if (o['tipo'] === 'equipe' && typeof o['perfil'] === 'object' && o['perfil'] !== null) {
    const p = o['perfil'] as Record<string, unknown>;
    return {
      tipo: 'equipe',
      perfil: {
        userId: String(p['userId'] ?? ''),
        nome: (p['nome'] as string | null) ?? null,
        email: String(p['email'] ?? ''),
        papel: (p['papel'] as Perfil['papel']) ?? 'leitura',
        cargo: (p['cargo'] as string | null) ?? null,
        ativo: p['ativo'] !== false,
      },
    };
  }

  if (o['tipo'] === 'cliente' && Array.isArray(o['clientes'])) {
    const clientes: Cliente[] = (o['clientes'] as Record<string, unknown>[]).map((c) => ({
      id: String(c['id'] ?? ''),
      nome: String(c['nome'] ?? ''),
      slug: String(c['slug'] ?? ''),
      fusoHorario: String(c['fusoHorario'] ?? 'America/Sao_Paulo'),
      ativo: c['ativo'] !== false,
    }));
    const primeiro = clientes[0];
    // Acesso de cliente sem nenhum cliente ligado nao deveria existir; se
    // acontecer, e melhor cair como anonimo do que montar um portal vazio.
    if (!primeiro) return { tipo: 'anonimo' };
    return {
      tipo: 'cliente',
      nome: String(o['nome'] ?? ''),
      email: String(o['email'] ?? ''),
      clientes,
      clienteAtual: primeiro,
    };
  }

  return { tipo: 'anonimo' };
}

export async function sessaoAtual(): Promise<Sessao> {
  if (!sb) {
    if (personaExemplo === null) return { tipo: 'anonimo' };
    return personaExemplo === 'equipe' ? SESSAO_EQUIPE : SESSAO_CLIENTE;
  }

  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) return { tipo: 'anonimo' };

  const { data, error } = await sb.rpc('minha_sessao');
  if (error) throw new FalhaDados(`Não consegui identificar sua conta: ${error.message}`);
  return lerSessao(data);
}

export async function entrar(email: string, senha: string): Promise<void> {
  if (!sb) {
    personaExemplo = email.includes('@astartstudio') ? 'equipe' : 'cliente';
    return;
  }
  const { error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) {
    throw new FalhaDados(
      /invalid login/i.test(error.message)
        ? 'E-mail ou senha incorretos.'
        : `Não consegui entrar: ${error.message}`,
    );
  }
}

export async function entrarComoExemplo(persona: 'equipe' | 'cliente'): Promise<void> {
  personaExemplo = persona;
}

export async function sair(): Promise<void> {
  personaExemplo = null;
  if (sb) await sb.auth.signOut();
}

export async function painelEquipe(): Promise<PainelEquipe> {
  if (!sb) return PAINEL_EQUIPE;
  const { data, error } = await sb.rpc('painel_equipe');
  if (error) throw new FalhaDados(`Não consegui montar o painel: ${error.message}`);
  return exija(data as PainelEquipe | null, 'O painel da equipe');
}

export async function painelCliente(clienteId: string): Promise<PainelCliente> {
  if (!sb) return PAINEL_CLIENTE;
  const { data, error } = await sb.rpc('painel_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Não consegui montar o painel: ${error.message}`);
  return exija(data as PainelCliente | null, 'O painel deste cliente');
}
