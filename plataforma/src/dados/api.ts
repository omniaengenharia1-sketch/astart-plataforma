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
import { enderecoDeChegada, ligado, sb } from './supabase';
import {
  SESSAO_CLIENTE, SESSAO_DONO, SESSAO_EQUIPE,
  abrirChamadoExemplo, agendaExemplo, ambientesExemplo, definirPapelExemplo,
  painelEquipeExemplo,
  calendarioExemplo, campanhasExemplo, catalogoExemplo, convidarExemplo, criarClienteExemplo,
  criarGaleriaExemplo, criarLinkAprovacaoExemplo, criarLinkExemplo, criarPecaExemplo,
  desativarClienteExemplo, enviosExemplo, revogarLinkAprovacaoExemplo,
  financeiroDoClienteExemplo, mudarPapelExemplo, reativarClienteExemplo, removerClienteExemplo,
  filaPublicacaoExemplo, funilExemplo, galeriasExemplo, gridExemplo, moverLeadExemplo,
  npsDoClienteExemplo, npsResumoExemplo, painelFinanceiroExemplo, responderNpsExemplo,
  revogarLinkExemplo,
  enviarExemplo, equipeEConvitesExemplo, fichaExemplo, filaExemplo, itemDoEntregavelExemplo,
  listaClientesExemplo, moverPecaExemplo, mudarAcessoExemplo, painelClienteExemplo,
  projetoExemplo, responderExemplo, revogarConviteExemplo, tirarAcessoDoClienteExemplo,
} from './mock';
import type {
  Album, AmbientesDoCliente, Catalogo, Cliente, ClienteNaLista, ClienteNovo, Decisao,
  EnvioNaFicha, EquipeEConvites, EtapaLead, EventoNaAgenda, FichaCliente,
  FinanceiroDoCliente, Funil,
  GaleriaNaLista, ItemDoGrid, ItemGaleria, ItemNaFila, MesDeConteudo, NpsDoCliente,
  PainelCliente, PainelEquipe, PainelFinanceiro, PapelEquipe, PecaNaFila, PedidoDeConvite, Perfil,
  RelatorioDeCampanha, ResumoNps, ServicoEscolhido, ServicoNoProjeto, Sessao, TipoPeca,
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
type Persona = 'dono' | 'equipe' | 'cliente';
const CHAVE_PERSONA = 'astart.exemplo.persona';

/** Qual papel cada persona de exemplo tem, para o mock cortar o dinheiro igual. */
const PAPEL_DA_PERSONA: Record<Persona, 'admin' | 'operacao' | 'cliente'> = {
  dono: 'admin',
  equipe: 'operacao',
  cliente: 'cliente',
};

function lerPersona(): Persona | null {
  try {
    const v = sessionStorage.getItem(CHAVE_PERSONA);
    return v === 'dono' || v === 'equipe' || v === 'cliente' ? v : null;
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
definirPapelExemplo(personaExemplo ? PAPEL_DA_PERSONA[personaExemplo] : null);

function usarPersona(p: Persona | null): void {
  personaExemplo = p;
  gravarPersona(p);
  definirPapelExemplo(p ? PAPEL_DA_PERSONA[p] : null);
}

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
    if (personaExemplo === 'dono') return SESSAO_DONO;
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
    // Em exemplo o e-mail escolhe a persona. A Layana e operacao de proposito:
    // e o unico jeito de a demonstracao mostrar o que ela NAO ve.
    usarPersona(
      !email.includes('@astartstudio')
        ? 'cliente'
        : email.toLowerCase().startsWith('layana')
          ? 'equipe'
          : 'dono',
    );
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

/**
 * Por que a pessoa chegou na tela de senha.
 *
 * Nao e enfeite de interface: cada caso precisa de um texto diferente e de um
 * formulario diferente. Quem veio de um link que expirou nao pode ver um campo
 * de senha que vai falhar ao salvar — precisa ver o pedido de um link novo.
 */
export type MotivoDoLink = 'convite' | 'recuperacao' | 'trocar' | 'expirado' | 'semLink';

export async function motivoDoLink(): Promise<MotivoDoLink> {
  // O Supabase devolve o fracasso no hash, nao em erro de rede: um link velho
  // chega como `#error=access_denied&error_code=otp_expired`. Ler isso e o que
  // separa "escolha uma senha" de "este link nao serve mais".
  // `enderecoDeChegada`, nao `window.location`: o supabase-js ja limpou a barra
  // de endereco quando este codigo roda. Ver o comentario em supabase.ts.
  const hash = new URLSearchParams(enderecoDeChegada.hash.replace(/^#/, ''));
  if (hash.get('error')) return 'expirado';

  const tipo = hash.get('type');

  if (!sb) {
    // Em exemplo nao existe link de verdade. Sem pista no endereco, mostra o
    // caso do convite: e o que precisa ser visto numa demonstracao.
    if (tipo === 'recovery') return 'recuperacao';
    if (personaExemplo !== null) return 'trocar';
    return 'convite';
  }

  // `detectSessionInUrl` consome o endereco ao carregar, entao a sessao pode
  // levar um instante para existir. Sem esta espera a primeira renderizacao
  // diria "este link nao serve" para um link perfeitamente bom.
  let sessao = (await sb.auth.getSession()).data.session;
  if (!sessao && (tipo === 'invite' || tipo === 'recovery' || enderecoDeChegada.busca.includes('code='))) {
    await new Promise((r) => setTimeout(r, 600));
    sessao = (await sb.auth.getSession()).data.session;
  }

  if (!sessao) return 'semLink';
  if (tipo === 'invite') return 'convite';
  if (tipo === 'recovery') return 'recuperacao';
  return 'trocar';
}

export async function pedirLinkDeSenha(email: string): Promise<void> {
  if (!email.includes('@')) throw new FalhaDados('Escreva um e-mail valido.');
  if (!sb) return;

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/nova-senha`,
  });

  // Conta que nao existe NAO vira erro aqui, e e de proposito: a resposta tem
  // de ser a mesma para e-mail cadastrado e nao cadastrado, senao esta tela
  // vira um conferidor de quem trabalha na agencia para qualquer pessoa da
  // internet. Quem decide isso e a mensagem na tela, que fala no condicional.
  if (error) {
    throw new FalhaDados(
      /rate limit|too many/i.test(error.message)
        ? 'Voce pediu varios links seguidos. Espere alguns minutos e tente de novo.'
        : `Nao consegui enviar o link: ${error.message}`,
    );
  }
}

export async function definirSenha(senha: string): Promise<void> {
  if (!sb) return;

  const { error } = await sb.auth.updateUser({ password: senha });
  if (error) {
    throw new FalhaDados(
      /should be at least|password.*short/i.test(error.message)
        ? 'A senha e curta demais para o que o projeto exige.'
        : /same.*password|different from the old/i.test(error.message)
          ? 'Essa e a senha que voce ja usava. Escolha outra.'
          : /session|jwt|expired/i.test(error.message)
            ? 'O link que te trouxe aqui expirou antes de voce salvar. Peca outro e tente de novo.'
            : `Nao consegui salvar a senha: ${error.message}`,
    );
  }

  // A sessao do link morre aqui. A proxima entrada e com a senha digitada, o
  // que faz a pessoa descobrir HOJE que guardou a senha errada, e nao amanha.
  await sb.auth.signOut();
}

/**
 * Avisa quando a sessao muda por fora da tela: token que venceu e nao renovou,
 * `signOut()` disparado pela guarda, ou outra aba que saiu.
 *
 * Sem este ouvinte o provedor lia a sessao UMA vez, no carregamento, e nunca
 * mais — foi assim que a plataforma ficou afirmando que a pessoa estava dentro
 * enquanto o banco a tratava como visitante.
 */
export function aoMudarSessao(quando: (saiu: boolean) => void): () => void {
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT' || evento === 'TOKEN_REFRESHED' || evento === 'SIGNED_IN') {
      quando(evento === 'SIGNED_OUT');
    }
  });
  return () => data.subscription.unsubscribe();
}

export async function entrarComoExemplo(persona: Persona): Promise<void> {
  usarPersona(persona);
}

export async function sair(): Promise<void> {
  usarPersona(null);
  if (sb) await sb.auth.signOut();
}

export async function painelEquipe(): Promise<PainelEquipe> {
  if (!sb) return painelEquipeExemplo();
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

export async function projetoDoCliente(clienteId: string): Promise<ServicoNoProjeto[]> {
  if (!sb) return projetoExemplo(clienteId);
  const { data, error } = await sb.rpc('projeto_do_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Não consegui abrir o projeto: ${error.message}`);
  return exija(data as ServicoNoProjeto[] | null, 'O projeto deste cliente');
}

/** O item de aprovação do entregável, criando se ainda não existir. */
export async function itemDoEntregavel(entregavelId: string): Promise<string> {
  if (!sb) return itemDoEntregavelExemplo(entregavelId);
  const { data, error } = await sb.rpc('item_do_entregavel', { p_entregavel_id: entregavelId });
  if (error) throw new FalhaDados(error.message);
  return exija(data as string | null, 'O item deste entregável');
}

/**
 * Manda o lote para o cliente. A funcao do banco recusa o que ja esta na mao
 * dele em vez de reenviar: reenviar faria o mesmo material aparecer duas vezes
 * na fila do cliente.
 */
export async function enviarParaAprovacao(
  itemIds: string[],
  mensagem?: string,
): Promise<number> {
  if (!sb) {
    try {
      return enviarExemplo(itemIds, mensagem);
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui enviar.');
    }
  }
  const { data, error } = await sb.rpc('enviar_para_aprovacao', {
    p_item_ids: itemIds,
    p_mensagem: mensagem?.trim() || null,
  });
  if (error) throw new FalhaDados(error.message);
  const r = data as { enviados?: number } | null;
  return r?.enviados ?? 0;
}

/** O mês de conteúdo. `mes` é qualquer dia do mês, no formato AAAA-MM-DD. */
export async function calendarioDoCliente(
  clienteId: string,
  mes: string,
): Promise<MesDeConteudo> {
  if (!sb) return calendarioExemplo(clienteId, mes);
  const { data, error } = await sb.rpc('calendario_do_cliente', {
    p_cliente: clienteId,
    p_mes: mes,
  });
  if (error) throw new FalhaDados(`Não consegui abrir o mês: ${error.message}`);
  return exija(data as MesDeConteudo | null, 'O calendário deste cliente');
}

export async function criarPeca(
  clienteId: string,
  titulo: string,
  tipo: TipoPeca,
  dia: string,
  hora: string,
  legenda = '',
): Promise<void> {
  if (!sb) {
    try {
      criarPecaExemplo(clienteId, titulo, tipo, dia, hora, legenda);
      return;
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui criar a peça.');
    }
  }
  const { error } = await sb.rpc('criar_peca', {
    p_cliente: clienteId,
    p_titulo: titulo,
    p_tipo: tipo,
    p_dia: dia,
    p_hora: hora || '12:00',
    p_legenda: legenda,
  });
  if (error) {
    throw new FalhaDados(
      /row-level security|permission denied/i.test(error.message)
        ? 'Seu acesso não cria peças.'
        : error.message,
    );
  }
}

export async function moverPeca(pecaId: string, dia: string, hora?: string): Promise<void> {
  if (!sb) {
    try {
      moverPecaExemplo(pecaId, dia, hora);
      return;
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui mover a peça.');
    }
  }
  const { error } = await sb.rpc('mover_peca', {
    p_post: pecaId,
    p_dia: dia,
    p_hora: hora ?? null,
  });
  if (error) throw new FalhaDados(error.message);
}

export async function equipeEConvites(): Promise<EquipeEConvites> {
  if (!sb) return equipeEConvitesExemplo();
  const { data, error } = await sb.rpc('equipe_e_convites');
  if (error) throw new FalhaDados(`Não consegui carregar a equipe: ${error.message}`);
  return exija(data as EquipeEConvites | null, 'A equipe');
}

/**
 * Convidar passa pela Edge Function, nao por RPC: criar conta no Auth exige a
 * service role, e service role nunca chega ao navegador. A funcao confere pelo
 * JWT que quem pediu e admin — nao por um parametro que o front mandaria.
 */
export async function convidar(pedido: PedidoDeConvite): Promise<void> {
  if (!sb) {
    try {
      convidarExemplo(pedido);
      return;
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui convidar.');
    }
  }

  // Para onde o convidado volta. A Edge Function sempre aceitou este campo — a
  // tela e que nunca mandava, e sem ele o Supabase devolvia a pessoa para a
  // raiz, onde ela caia dentro da plataforma SEM definir senha: entrava hoje e
  // ficava trancada fora amanha. Quem monta o endereco e a plataforma, nao a
  // tela, porque quem convida nao tem de saber disso.
  const { error } = await sb.functions.invoke('convidar', {
    body: { ...pedido, redirecionarPara: `${window.location.origin}/nova-senha` },
  });
  if (!error) return;

  // A funcao responde { erro: "mensagem em portugues" } com status 4xx, e o
  // supabase-js embrulha isso num erro generico. Sem abrir o corpo, a tela
  // mostraria "Edge Function returned a non-2xx status code" para a pessoa.
  let mensagem = error.message;
  const contexto = (error as { context?: unknown }).context;
  if (contexto instanceof Response) {
    try {
      const corpo: unknown = await contexto.json();
      if (corpo && typeof corpo === 'object' && typeof (corpo as { erro?: unknown }).erro === 'string') {
        mensagem = (corpo as { erro: string }).erro;
      }
    } catch {
      /* fica a mensagem bruta, que e melhor que nada */
    }
  }
  throw new FalhaDados(mensagem);
}

export async function revogarConvite(id: string): Promise<void> {
  if (!sb) {
    revogarConviteExemplo(id);
    return;
  }
  const { error } = await sb.rpc('revogar_convite', { p_convite: id });
  if (error) throw new FalhaDados(error.message);
}

export async function mudarAcesso(userId: string, ativo: boolean): Promise<void> {
  if (!sb) {
    try {
      mudarAcessoExemplo(userId, ativo);
      return;
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui mudar o acesso.');
    }
  }
  const { error } = await sb.rpc(ativo ? 'reativar_pessoa' : 'desativar_pessoa', {
    p_user_id: userId,
  });
  if (error) {
    throw new FalhaDados(
      /row-level security|permission denied/i.test(error.message)
        ? 'Só quem administra a plataforma muda acesso.'
        : error.message,
    );
  }
}

export async function tirarAcessoDoCliente(
  userId: string,
  clienteId: string,
  email: string,
): Promise<void> {
  if (!sb) {
    tirarAcessoDoClienteExemplo(email, clienteId);
    return;
  }
  const { error } = await sb.rpc('tirar_acesso_do_cliente', {
    p_user_id: userId,
    p_cliente: clienteId,
  });
  if (error) throw new FalhaDados(error.message);
}

// ---------------------------------------------------------------------------
// Galeria
// ---------------------------------------------------------------------------

export async function galeriasDoCliente(clienteId: string): Promise<GaleriaNaLista[]> {
  if (!sb) return galeriasExemplo(clienteId);
  const { data, error } = await sb.rpc('galerias_do_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Não consegui carregar as galerias: ${error.message}`);
  return exija(data as GaleriaNaLista[] | null, 'As galerias deste cliente');
}

/**
 * A galeria nasce de uma captação, não do nada: é o trabalho que justifica o
 * álbum. Sem captação registrada, esta função cria uma na data de hoje.
 */
export async function criarGaleria(
  clienteId: string,
  titulo: string,
  sessaoId?: string,
): Promise<string> {
  if (!sb) return criarGaleriaExemplo(clienteId, titulo);

  let sessao = sessaoId;
  if (!sessao) {
    const { data, error } = await sb
      .from('sessoes_captacao')
      .insert({
        cliente_id: clienteId,
        titulo,
        data: new Date().toISOString().slice(0, 10),
        status: 'realizada',
      })
      .select('id')
      .single();
    if (error) {
      throw new FalhaDados(
        /row-level security|permission denied/i.test(error.message)
          ? 'Seu acesso não cria galeria.'
          : error.message,
      );
    }
    sessao = (data as { id: string }).id;
  }

  const { data, error } = await sb.rpc('criar_galeria', {
    p_sessao: sessao,
    p_titulo: titulo,
    p_recado: null,
  });
  if (error) throw new FalhaDados(error.message);
  return exija(data as string | null, 'A galeria');
}

export async function criarLinkGaleria(galeriaId: string): Promise<{ linkId: string; token: string }> {
  if (!sb) return criarLinkExemplo(galeriaId);
  const { data, error } = await sb.rpc('criar_link_galeria', { p_galeria: galeriaId });
  if (error) throw new FalhaDados(error.message);
  const linha = (data as { link_id: string; token: string }[] | null)?.[0];
  if (!linha) throw new FalhaDados('O link não voltou do servidor.');
  // O token aparece UMA vez, agora. Depois disto só existe o hash no banco.
  return { linkId: linha.link_id, token: linha.token };
}

export async function revogarLinkGaleria(linkId: string): Promise<void> {
  if (!sb) {
    revogarLinkExemplo(linkId);
    return;
  }
  const { error } = await sb.rpc('revogar_link_galeria', { p_link: linkId });
  if (error) throw new FalhaDados(error.message);
}

/**
 * Os itens de uma galeria para a equipe, com miniatura assinada. A equipe lê o
 * bucket direto (política do 0035), então não precisa passar pela Edge
 * Function do link — ela existe para quem NÃO tem conta.
 */
export async function itensDaGaleria(galeriaId: string): Promise<ItemGaleria[]> {
  if (!sb) {
    const { albumExemplo } = await import('./mock');
    return albumExemplo(galeriaId).itens;
  }

  const { data, error } = await sb
    .from('galeria_itens')
    .select('id, tipo, nome, miniatura_caminho, poster_caminho, largura, altura, duracao_s, tamanho_bytes')
    .eq('galeria_id', galeriaId)
    .eq('pronto', true)
    .order('ordem');
  if (error) throw new FalhaDados(`Não consegui abrir a galeria: ${error.message}`);

  const linhas = (data ?? []) as {
    id: string; tipo: 'foto' | 'video'; nome: string;
    miniatura_caminho: string | null; poster_caminho: string | null;
    largura: number | null; altura: number | null;
    duracao_s: number | null; tamanho_bytes: number | null;
  }[];

  const caminhos = linhas.map((l) => l.miniatura_caminho).filter((c): c is string => !!c);
  const assinadas = new Map<string, string>();
  if (caminhos.length) {
    const { data: urls } = await sb.storage.from('galerias').createSignedUrls(caminhos, 3600);
    for (const u of urls ?? []) if (u.path && u.signedUrl) assinadas.set(u.path, u.signedUrl);
  }

  return linhas.map((l) => ({
    id: l.id,
    tipo: l.tipo,
    nome: l.nome,
    miniatura: l.miniatura_caminho ? (assinadas.get(l.miniatura_caminho) ?? null) : null,
    poster: l.poster_caminho ? (assinadas.get(l.poster_caminho) ?? null) : null,
    largura: l.largura,
    altura: l.altura,
    duracao: l.duracao_s,
    bytes: l.tamanho_bytes,
  }));
}

/** O álbum que o cliente LOGADO abre, sem token nenhum. */
export async function albumDoCliente(galeriaId: string): Promise<Album> {
  if (!sb) {
    const { albumExemplo } = await import('./mock');
    return albumExemplo(galeriaId);
  }

  const [{ data: cabeca, error: e1 }, itens] = await Promise.all([
    sb.from('galerias')
      .select('titulo, recado, permite_download, sessoes_captacao(data, clientes(nome))')
      .eq('id', galeriaId)
      .single(),
    itensDaGaleria(galeriaId),
  ]);
  if (e1) throw new FalhaDados(`Não consegui abrir a galeria: ${e1.message}`);

  const { data: favs } = await sb
    .from('galeria_favoritos')
    .select('item_id')
    .eq('galeria_id', galeriaId);

  const c = cabeca as unknown as {
    titulo: string | null;
    recado: string | null;
    permite_download: boolean;
    sessoes_captacao: { data: string; clientes: { nome: string } | null } | null;
  };

  return {
    titulo: c.titulo ?? 'Galeria',
    recado: c.recado,
    cliente: c.sessoes_captacao?.clientes?.nome ?? null,
    quando: c.sessoes_captacao?.data ?? null,
    permiteDownload: c.permite_download,
    favoritos: ((favs ?? []) as { item_id: string }[]).map((f) => f.item_id),
    itens,
  };
}

export async function favoritarItem(itemId: string, ligadoAgora: boolean): Promise<void> {
  if (!sb) {
    const { favoritarExemplo } = await import('./mock');
    favoritarExemplo(itemId, ligadoAgora);
    return;
  }
  const { error } = await sb.rpc('favoritar_item', { p_item: itemId, p_ligado: ligadoAgora });
  if (error) throw new FalhaDados(error.message);
}

/**
 * URLs dos originais para o cliente logado. Ele lê o bucket por política
 * (0035), então assina direto — sem passar pela função do link.
 */
export async function urlsDosOriginais(
  galeriaId: string,
  itemId?: string,
): Promise<{ id: string; nome: string; bytes: number | null; url: string | null }[]> {
  if (!sb) {
    const { urlsExemplo } = await import('./mock');
    return urlsExemplo(itemId);
  }

  let consulta = sb
    .from('galeria_itens')
    .select('id, nome, caminho, tamanho_bytes')
    .eq('galeria_id', galeriaId)
    .eq('pronto', true)
    .order('ordem');
  if (itemId) consulta = consulta.eq('id', itemId);

  const { data, error } = await consulta;
  if (error) throw new FalhaDados(error.message);
  const linhas = (data ?? []) as { id: string; nome: string; caminho: string; tamanho_bytes: number | null }[];
  if (linhas.length === 0) return [];

  const { data: urls } = await sb.storage
    .from('galerias')
    .createSignedUrls(linhas.map((l) => l.caminho), 60 * 60 * 6);
  const mapa = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));

  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    bytes: l.tamanho_bytes,
    url: mapa.get(l.caminho) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Financeiro
// ---------------------------------------------------------------------------

/** `mes` é qualquer dia do mês, AAAA-MM-DD. Omitido, é o mês corrente. */
export async function painelFinanceiro(mes?: string): Promise<PainelFinanceiro> {
  if (!sb) return painelFinanceiroExemplo(mes);
  const { data, error } = await sb.rpc('painel_financeiro', { p_mes: mes ?? null });
  if (error) {
    throw new FalhaDados(
      /permission denied|row-level security/i.test(error.message)
        ? 'Seu acesso não abre o financeiro.'
        : `Não consegui abrir o financeiro: ${error.message}`,
    );
  }
  return exija(data as PainelFinanceiro | null, 'O financeiro do mês');
}

/**
 * A conta de UM cliente. A mesma função serve a equipe e o próprio cliente: o
 * RLS é que decide quais lançamentos cada um alcança, então a tela não precisa
 * de dois caminhos.
 */
export async function financeiroDoCliente(clienteId: string): Promise<FinanceiroDoCliente> {
  if (!sb) return financeiroDoClienteExemplo(clienteId);
  const { data, error } = await sb.rpc('financeiro_do_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Não consegui abrir as cobranças: ${error.message}`);
  return exija(data as FinanceiroDoCliente | null, 'As cobranças deste cliente');
}

// ---------------------------------------------------------------------------
// Fila de publicação e agenda
// ---------------------------------------------------------------------------

export async function filaPublicacao(): Promise<PecaNaFila[]> {
  if (!sb) return filaPublicacaoExemplo();
  const { data, error } = await sb.rpc('fila_publicacao');
  if (error) throw new FalhaDados(`Não consegui carregar a fila: ${error.message}`);
  return exija(data as PecaNaFila[] | null, 'A fila de publicação');
}

export async function agenda(de: string, ate: string): Promise<EventoNaAgenda[]> {
  if (!sb) return agendaExemplo(de, ate);
  const { data, error } = await sb.rpc('agenda', { p_de: de, p_ate: ate });
  if (error) throw new FalhaDados(`Não consegui abrir a agenda: ${error.message}`);
  return exija(data as EventoNaAgenda[] | null, 'A agenda');
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/**
 * O feed como ele vai ficar. A capa vem como CAMINHO no bucket privado, não
 * como endereço: quem assina é esta função, com validade curta. O cliente lê o
 * bucket pela política da 0038 — a mesma chamada serve aos dois lados.
 */
export async function gridDoCliente(clienteId: string): Promise<ItemDoGrid[]> {
  if (!sb) return gridExemplo(clienteId);
  const { data, error } = await sb.rpc('grid_do_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Não consegui abrir o grid: ${error.message}`);
  const itens = exija(data as ItemDoGrid[] | null, 'O grid deste cliente');

  const caminhos = itens.map((i) => i.capa).filter((c): c is string => !!c);
  if (caminhos.length === 0) return itens;

  const { data: urls } = await sb.storage.from('midias-posts').createSignedUrls(caminhos, 3600);
  const mapa = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));
  // Capa que não assinou vira null, não vira endereço quebrado: a tela mostra o
  // bloco vazio com o título, que é melhor que um ícone de imagem partida.
  return itens.map((i) => ({ ...i, capa: i.capa ? (mapa.get(i.capa) ?? null) : null }));
}

// ---------------------------------------------------------------------------
// Feedbacks (NPS)
// ---------------------------------------------------------------------------

export async function npsResumo(): Promise<ResumoNps> {
  if (!sb) return npsResumoExemplo();
  const { data, error } = await sb.rpc('nps_resumo');
  if (error) throw new FalhaDados(`Não consegui carregar os feedbacks: ${error.message}`);
  return exija(data as ResumoNps | null, 'Os feedbacks');
}

export async function npsDoCliente(clienteId: string): Promise<NpsDoCliente> {
  if (!sb) return npsDoClienteExemplo(clienteId);
  const { data, error } = await sb.rpc('nps_do_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Não consegui abrir o feedback: ${error.message}`);
  return exija(data as NpsDoCliente | null, 'O feedback deste cliente');
}

/**
 * A nota do cliente. A função do banco recusa a segunda resposta da mesma
 * pesquisa: responder duas vezes mudaria o NPS do mês com uma opinião só.
 */
export async function responderNps(
  pesquisaId: string,
  nota: number,
  comentario?: string,
): Promise<void> {
  if (nota < 0 || nota > 10 || !Number.isInteger(nota)) {
    throw new FalhaDados('A nota vai de 0 a 10.');
  }
  if (!sb) {
    try {
      responderNpsExemplo(pesquisaId, nota, comentario);
      return;
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui registrar a nota.');
    }
  }
  const { error } = await sb.rpc('responder_nps', {
    p_pesquisa: pesquisaId,
    p_nota: nota,
    p_comentario: comentario?.trim() || null,
  });
  if (error) throw new FalhaDados(error.message);
}

// ---------------------------------------------------------------------------
// Comercial
// ---------------------------------------------------------------------------

export async function funil(): Promise<Funil> {
  if (!sb) return funilExemplo();
  const { data, error } = await sb.rpc('funil');
  if (error) throw new FalhaDados(`Não consegui abrir o funil: ${error.message}`);
  return exija(data as Funil | null, 'O funil');
}

export async function moverLead(leadId: string, etapa: EtapaLead, motivo?: string): Promise<void> {
  if (etapa === 'perdido' && !motivo?.trim()) {
    throw new FalhaDados('Escreva o motivo para marcar como perdido.');
  }
  if (!sb) {
    try {
      moverLeadExemplo(leadId, etapa, motivo);
      return;
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui mover o lead.');
    }
  }
  const { error } = await sb.rpc('mover_lead', {
    p_lead: leadId,
    p_etapa: etapa,
    p_motivo: motivo?.trim() || null,
  });
  if (error) throw new FalhaDados(error.message);
}

// ---------------------------------------------------------------------------
// Campanhas, ambientes e chamados
// ---------------------------------------------------------------------------

export async function campanhasDoCliente(clienteId: string): Promise<RelatorioDeCampanha[]> {
  if (!sb) return campanhasExemplo(clienteId);
  const { data, error } = await sb.rpc('campanhas_do_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Não consegui abrir as campanhas: ${error.message}`);
  return exija(data as RelatorioDeCampanha[] | null, 'As campanhas deste cliente');
}

export async function ambientesDoCliente(clienteId: string): Promise<AmbientesDoCliente> {
  if (!sb) return ambientesExemplo(clienteId);
  const { data, error } = await sb.rpc('ambientes_do_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Não consegui abrir o site: ${error.message}`);
  return exija(data as AmbientesDoCliente | null, 'O site deste cliente');
}

export async function abrirChamado(
  clienteId: string,
  titulo: string,
  descricao?: string,
  prioridade: 'baixa' | 'media' | 'alta' | 'urgente' = 'media',
): Promise<void> {
  if (!titulo.trim()) throw new FalhaDados('Diga em uma linha o que está acontecendo.');
  if (!sb) {
    try {
      abrirChamadoExemplo(clienteId, titulo, descricao, prioridade);
      return;
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui abrir o chamado.');
    }
  }
  const { error } = await sb.rpc('abrir_chamado', {
    p_cliente: clienteId,
    p_titulo: titulo.trim(),
    p_descricao: descricao?.trim() || null,
    p_prioridade: prioridade,
  });
  if (error) throw new FalhaDados(error.message);
}

// ---------------------------------------------------------------------------
// O que só o admin faz
// ---------------------------------------------------------------------------

/**
 * Troca o papel de alguém da equipe. A função do banco recusa duas coisas que
 * a tela não deve nem tentar: quem não é admin mudando papel, e o último admin
 * se rebaixando — isso trancaria a plataforma para todo mundo.
 */
export async function mudarPapel(userId: string, papel: PapelEquipe): Promise<void> {
  if (!sb) {
    try {
      mudarPapelExemplo(userId, papel);
      return;
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui mudar o papel.');
    }
  }
  const { error } = await sb.rpc('mudar_papel', { p_user_id: userId, p_papel: papel });
  if (error) throw new FalhaDados(error.message);
}

/** Tira o cliente do ar: encerra o contrato e fecha o portal dele. Não apaga. */
export async function desativarCliente(clienteId: string): Promise<void> {
  if (!sb) {
    try {
      desativarClienteExemplo(clienteId);
      return;
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui tirar do ar.');
    }
  }
  const { error } = await sb.rpc('desativar_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(error.message);
}

export async function reativarCliente(clienteId: string): Promise<void> {
  if (!sb) {
    try {
      reativarClienteExemplo(clienteId);
      return;
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui reativar.');
    }
  }
  const { error } = await sb.rpc('reativar_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(error.message);
}

/**
 * Apaga de verdade. Existe para o cliente cadastrado errado: com qualquer
 * histórico, a função do banco recusa e manda tirar do ar.
 */
export async function removerCliente(clienteId: string): Promise<void> {
  if (!sb) {
    try {
      removerClienteExemplo(clienteId);
      return;
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui remover.');
    }
  }
  const { error } = await sb.rpc('remover_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(error.message);
}

// ---------------------------------------------------------------------------
// Os links de aprovação (o lado da equipe)
// ---------------------------------------------------------------------------

export async function enviosDoCliente(clienteId: string): Promise<EnvioNaFicha[]> {
  if (!sb) return enviosExemplo(clienteId);
  const { data, error } = await sb.rpc('envios_do_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Não consegui carregar os envios: ${error.message}`);
  return exija(data as EnvioNaFicha[] | null, 'Os envios deste cliente');
}

/**
 * Cria o link que o cliente abre sem conta. O token aparece UMA vez, agora:
 * depois disto só existe o hash no banco. Por isso a tela copia na hora.
 */
export async function criarLinkAprovacao(envioId: string): Promise<string> {
  if (!sb) {
    try {
      return criarLinkAprovacaoExemplo(envioId).token;
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui criar o link.');
    }
  }
  const { data, error } = await sb.rpc('criar_link_aprovacao', { p_envio_id: envioId });
  if (error) throw new FalhaDados(error.message);
  const linha = (data as { link_id: string; token: string }[] | null)?.[0];
  if (!linha) throw new FalhaDados('O link não voltou do servidor.');
  return linha.token;
}

export async function revogarLinkAprovacao(linkId: string): Promise<void> {
  if (!sb) {
    revogarLinkAprovacaoExemplo(linkId);
    return;
  }
  const { error } = await sb.rpc('revogar_link_aprovacao', { p_link: linkId });
  if (error) throw new FalhaDados(error.message);
}
