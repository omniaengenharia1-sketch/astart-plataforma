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
import {
  PAINEL_EQUIPE, SESSAO_CLIENTE, SESSAO_EQUIPE,
  catalogoExemplo, criarClienteExemplo, fichaExemplo, filaExemplo, listaClientesExemplo,
  painelClienteExemplo, responderExemplo,
} from './mock';
import type {
  Catalogo, Cliente, ClienteNaLista, ClienteNovo, Decisao, FichaCliente, ItemNaFila,
  PainelCliente, PainelEquipe, Perfil, ServicoEscolhido, Sessao,
} from './tipos';

export { ligado };

export class FalhaDados extends Error {}

/**
 * Em modo exemplo, qual persona esta aberta. Comeca nula de proposito: a tela
 * de entrada tem de aparecer igual, senao a primeira tela da plataforma nunca
 * e exercitada por quem esta avaliando.
 *
 * Fica no sessionStorage porque recarregar a pagina nao pode derrubar a sessao:
 * em modo exemplo isso jogava de volta para o login a cada F5, e quem estava
 * avaliando lia como "a plataforma me deslogou". Com Supabase ligado quem
 * guarda a sessao e o proprio supabase-js.
 */
type Persona = 'equipe' | 'cliente';
const CHAVE_PERSONA = 'astart.exemplo.persona';

function lerPersona(): Persona | null {
  try {
    const v = sessionStorage.getItem(CHAVE_PERSONA);
    return v === 'equipe' || v === 'cliente' ? v : null;
  } catch {
    // Navegador com armazenamento bloqueado: a plataforma continua, so nao
    // lembra a persona entre recargas.
    return null;
  }
}

function gravarPersona(v: Persona | null): void {
  try {
    if (v) sessionStorage.setItem(CHAVE_PERSONA, v);
    else sessionStorage.removeItem(CHAVE_PERSONA);
  } catch {
    /* idem */
  }
}

let personaExemplo: Persona | null = lerPersona();

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
    gravarPersona(personaExemplo);
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

export async function entrarComoExemplo(persona: Persona): Promise<void> {
  personaExemplo = persona;
  gravarPersona(persona);
}

export async function sair(): Promise<void> {
  personaExemplo = null;
  gravarPersona(null);
  if (sb) await sb.auth.signOut();
}

export async function painelEquipe(): Promise<PainelEquipe> {
  if (!sb) return PAINEL_EQUIPE;
  const { data, error } = await sb.rpc('painel_equipe');
  if (error) throw new FalhaDados(`Não consegui montar o painel: ${error.message}`);
  return exija(data as PainelEquipe | null, 'O painel da equipe');
}

export async function painelCliente(clienteId: string): Promise<PainelCliente> {
  if (!sb) return painelClienteExemplo(clienteId);
  const { data, error } = await sb.rpc('painel_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Não consegui montar o painel: ${error.message}`);
  return exija(data as PainelCliente | null, 'O painel deste cliente');
}

export async function listaClientes(): Promise<ClienteNaLista[]> {
  if (!sb) return listaClientesExemplo();
  const { data, error } = await sb.rpc('lista_clientes');
  if (error) throw new FalhaDados(`Não consegui carregar os clientes: ${error.message}`);
  return exija(data as ClienteNaLista[] | null, 'A lista de clientes');
}

export async function filaAprovacoes(): Promise<ItemNaFila[]> {
  if (!sb) return filaExemplo();
  const { data, error } = await sb.rpc('fila_aprovacoes');
  if (error) throw new FalhaDados(`Não consegui carregar a fila: ${error.message}`);
  return exija(data as ItemNaFila[] | null, 'A fila de aprovações');
}

export async function fichaCliente(clienteId: string): Promise<FichaCliente> {
  if (!sb) return exija(fichaExemplo(clienteId), 'A ficha deste cliente');
  const { data, error } = await sb.rpc('ficha_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Não consegui abrir o cliente: ${error.message}`);
  return exija(data as FichaCliente | null, 'A ficha deste cliente');
}

/**
 * Responder e a unica escrita que o cliente faz na plataforma. A regra do
 * comentario obrigatorio esta aqui E na funcao do banco: a tela avisa antes,
 * a funcao recusa de todo jeito.
 */
export async function responderItem(
  itemId: string,
  decisao: Decisao,
  autorNome: string,
  comentario?: string,
): Promise<void> {
  if (decisao === 'com_ajustes' && !comentario?.trim()) {
    throw new FalhaDados('Escreva o que precisa mudar para pedir ajuste.');
  }

  if (!sb) {
    try {
      responderExemplo(itemId, decisao, autorNome, comentario);
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui registrar a resposta.');
    }
    return;
  }

  const { error } = await sb.rpc('responder_item', {
    p_item_id: itemId,
    p_decisao: decisao,
    p_autor_nome: autorNome,
    p_autor_tipo: 'cliente',
    p_comentario: comentario?.trim() ?? null,
  });
  if (error) {
    // A mensagem do banco ja vem em portugues e legivel: ela e a mensagem da
    // tela. Falha silenciosa e proibida, e falha traduzida duas vezes mente.
    throw new FalhaDados(error.message);
  }
}

export async function catalogo(): Promise<Catalogo> {
  if (!sb) return catalogoExemplo();
  const { data, error } = await sb.rpc('catalogo');
  if (error) throw new FalhaDados(`Não consegui carregar os serviços: ${error.message}`);
  return exija(data as Catalogo | null, 'O catálogo de serviços');
}

/**
 * Cadastra cliente e contrato de uma vez. A funcao do banco grava os dois na
 * mesma transacao: ou o cliente nasce inteiro, ou nao nasce. O endereco e unico,
 * entao um segundo envio do mesmo formulario volta como "ja existe" em vez de
 * abrir um cliente gemeo.
 */
export async function criarCliente(
  nome: string,
  servicos: ServicoEscolhido[],
  slug?: string,
  fuso = 'America/Sao_Paulo',
): Promise<ClienteNovo> {
  if (!sb) {
    try {
      return criarClienteExemplo(nome, servicos, slug);
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui cadastrar.');
    }
  }

  const { data, error } = await sb.rpc('criar_cliente', {
    p_nome: nome,
    p_servicos: servicos,
    p_slug: slug?.trim() || null,
    p_fuso: fuso,
  });
  if (error) {
    // RLS recusando vira uma mensagem que ninguem entende. As outras mensagens
    // ja vem em portugues da propria funcao.
    throw new FalhaDados(
      /row-level security|permission denied/i.test(error.message)
        ? 'Seu acesso não cadastra clientes. Fale com quem administra a plataforma.'
        : error.message,
    );
  }
  return exija(data as ClienteNovo | null, 'O cliente cadastrado');
}
