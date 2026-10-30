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
  canaisDoClienteExemplo,
  conectoresExemplo, contasDoClienteExemplo, descobrirContasExemplo, salvarContaSocialExemplo,
  conferirTokenExemplo,
  criarPublicacaoExemplo, atualizarPublicacaoExemplo, agendarPublicacaoExemplo, publicacaoExemplo,
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
  Album, AmbientesDoCliente, Canal, Catalogo, Cliente, ClienteNaLista, ClienteNovo, Conector,
  ContaDescoberta, ContaSocial, Decisao,
  Publicacao, PublicacaoNova,
  EnvioNaFicha, EquipeEConvites, EtapaLead, EventoNaAgenda, FichaCliente,
  FinanceiroDoCliente, Funil,
  GaleriaNaLista, ItemDoGrid, ItemGaleria, ItemNaFila, MesDeConteudo, NpsDoCliente,
  PainelCliente, PainelEquipe, PainelFinanceiro, PapelEquipe, PecaNaFila, PedidoDeConvite, Perfil,
  RelatorioDeCampanha, ResumoDaRemocao, ResumoNps, SaudeDoToken, ServicoEscolhido, ServicoNoProjeto, Sessao,
  TipoPeca,
} from './tipos';

export { ligado };

export class FalhaDados extends Error {}

/**
 * Falha que veio com diagnóstico do token (0048).
 *
 * Separada de `FalhaDados` porque a tela faz algo diferente com ela: além da
 * mensagem, mostra o que está errado com o token e o que fazer. "Expirou ou foi
 * revogado" cobre três casos com três consertos diferentes, e mandar a pessoa
 * adivinhar qual é foi o que aconteceu hoje.
 */
export class FalhaDaMeta extends FalhaDados {
  constructor(mensagem: string, readonly saude: SaudeDoToken | null) {
    super(mensagem);
    this.name = 'FalhaDaMeta';
  }
}

/**
 * Traduz o erro de uma Edge Function para algo que a tela pode mostrar.
 *
 * Duas coisas que o supabase-js esconde:
 *
 * 1. A funcao responde `{ erro: "mensagem em portugues" }` com status 4xx, e o
 *    supabase-js embrulha num erro generico. Sem abrir o corpo, a tela mostra
 *    "Edge Function returned a non-2xx status code" para a pessoa.
 *
 * 2. Quando a chamada nem CHEGA na funcao, ele diz "Failed to send a request to
 *    the Edge Function" — em ingles, sem dizer o que fazer. Foi o que a dona leu
 *    quando faltava CORS: ela nao tinha como saber que o navegador bloqueou o
 *    pedido antes de sair.
 *
 * Virou funcao porque tres telas precisam do mesmo cuidado. Estava enterrado
 * dentro do `convidar`, e a segunda chamada teria copiado — ou, pior, esquecido.
 */
async function corpoDaFuncao(
  error: { message: string; context?: unknown },
  seNaoChegar: string,
): Promise<{ mensagem: string; saude: SaudeDoToken | null }> {
  let mensagem = error.message;
  let saude: SaudeDoToken | null = null;

  const contexto = error.context;
  if (contexto instanceof Response) {
    try {
      const corpo = (await contexto.json()) as { erro?: unknown; saude?: unknown } | null;
      if (corpo && typeof corpo === 'object') {
        // O diagnostico do token (0048) vem no MESMO corpo do erro, e nao numa
        // segunda chamada: quem precisa dele esta lendo a falha agora.
        if (corpo.saude && typeof corpo.saude === 'object') saude = corpo.saude as SaudeDoToken;
        if (typeof corpo.erro === 'string') return { mensagem: corpo.erro, saude };
      }
    } catch {
      /* fica a mensagem bruta, que e melhor que nada */
    }
  }

  if (/failed to send a request/i.test(mensagem) || /fetch/i.test(mensagem)) {
    mensagem =
      `${seNaoChegar} O navegador nao conseguiu falar com o servidor. ` +
      'Confira a internet e tente de novo. Se insistir, me avise — pode ser a funcao fora do ar.';
  }

  return { mensagem, saude };
}

async function mensagemDaFuncao(
  error: { message: string; context?: unknown },
  seNaoChegar: string,
): Promise<string> {
  return (await corpoDaFuncao(error, seNaoChegar)).mensagem;
}

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
/**
 * O mapa das chaves. NUNCA traz valor de segredo — a funcao do banco le o nome
 * no `vault.secrets` e a descriptografia nem acontece. O teste 24 cobra isso
 * procurando o valor na resposta.
 *
 * Nulo quando quem pergunta nao e admin: e mapa de onde os segredos ficam, e
 * isso e leitura de direcao.
 */
/** As contas de rede social de um cliente. Nulo quando ele nao tem publicacao. */
/**
 * Cria a publicacao como RASCUNHO, sem hora.
 *
 * A ordem e essa de proposito: o caminho do arquivo no bucket precisa do id do
 * post (0045), entao o post nasce primeiro, o arquivo entra depois, e agendar e
 * o ultimo passo — o unico que cobra se a midia esta completa.
 */
export async function criarPublicacao(p: PublicacaoNova): Promise<string> {
  if (!sb) return criarPublicacaoExemplo(p);
  const { data, error } = await sb.rpc('criar_publicacao', {
    p_cliente: p.clienteId,
    p_titulo: p.titulo,
    p_tipo: p.tipo,
    p_legenda: p.legenda,
    p_hashtags: p.hashtags,
    p_no_comentario: p.noComentario,
    p_contas: p.contas.length > 0 ? p.contas : null,
  });
  if (error) throw new FalhaDados(error.message);
  return (data as { id: string }).id;
}

export async function atualizarPublicacao(
  id: string,
  p: Partial<PublicacaoNova>,
): Promise<void> {
  if (!sb) {
    atualizarPublicacaoExemplo(id, p);
    return;
  }
  const { error } = await sb.rpc('atualizar_publicacao', {
    p_post: id,
    p_titulo: p.titulo ?? null,
    p_legenda: p.legenda ?? null,
    p_hashtags: p.hashtags ?? null,
    p_no_comentario: p.noComentario ?? null,
    p_tipo: p.tipo ?? null,
    p_contas: p.contas ?? null,
  });
  if (error) throw new FalhaDados(error.message);
}

/**
 * Agenda, ou posta agora — que e agendar para agora.
 *
 * `quando` nulo significa agora: o worker varre `agendado and agendado_para <=
 * now()` a cada minuto e pega na proxima rodada. Um caminho paralelo que
 * publicasse na hora teria outra retentativa e outro registro de erro.
 */
export async function agendarPublicacao(
  id: string,
  quando: string | null,
): Promise<{ quando: string; agora: boolean }> {
  if (!sb) return agendarPublicacaoExemplo(id, quando);
  const { data, error } = await sb.rpc('agendar_publicacao', { p_post: id, p_quando: quando });
  if (error) throw new FalhaDados(error.message);
  return data as { quando: string; agora: boolean };
}

export async function publicacao(id: string): Promise<Publicacao | null> {
  if (!sb) return publicacaoExemplo(id);
  const { data, error } = await sb.rpc('publicacao', { p_post: id });
  if (error) throw new FalhaDados(`Nao consegui abrir a publicacao: ${error.message}`);
  return (data as Publicacao | null) ?? null;
}

export async function contasDoCliente(clienteId: string): Promise<ContaSocial[]> {
  if (!sb) return contasDoClienteExemplo(clienteId);
  const { data, error } = await sb.rpc('contas_do_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Nao consegui ler as contas: ${error.message}`);
  return (data as ContaSocial[] | null) ?? [];
}

/**
 * Os canais do cliente: uma linha por (conta × formato), com o motivo quando
 * aquele canal nao publica (0055).
 *
 * E UMA pergunta, nao duas. O compositor perguntava "formato?" e "onde
 * publica?" separado, e isso deixava montar Reel numa Pagina do Facebook, que
 * nao tem adaptador. A tela aceitava, o banco aceitava, e a recusa vinha na
 * hora de publicar — de madrugada, com o cliente sem receber nada.
 */
export async function canaisDoCliente(clienteId: string): Promise<Canal[]> {
  if (!sb) return canaisDoClienteExemplo(clienteId);
  const { data, error } = await sb.rpc('canais_do_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(`Nao consegui ler os canais: ${error.message}`);
  return (data as Canal[] | null) ?? [];
}

/**
 * Pergunta a Meta o que o token da agencia alcanca. Nao grava nada: existe para
 * a pessoa CONFERIR antes de salvar. Digitar um ig_user_id na mao e publicar no
 * escuro — o numero esta certo ou o post do cliente vai para a conta de outro.
 */
export async function descobrirContas(clienteId: string): Promise<ContaDescoberta[]> {
  if (!sb) return descobrirContasExemplo();
  const { data, error } = await sb.functions.invoke('conectar-conta', {
    body: { acao: 'descobrir', clienteId },
  });
  if (error) {
    const { mensagem, saude } = await corpoDaFuncao(error, 'Nao consegui falar com a Meta.');
    throw new FalhaDaMeta(mensagem, saude);
  }
  return (data as { contas: ContaDescoberta[] }).contas;
}

/**
 * Pergunta a Meta a saude do token da agencia (0048).
 *
 * Nao e o mesmo que `conectores()`: aquela diz se a chave esta CADASTRADA, esta
 * diz se ela FUNCIONA — tipo, validade e escopos. A diferenca entre as duas foi
 * o que fez a dona clicar em "Conectar conta" e levar um erro sem saber o que
 * consertar, com a chave cadastrada dez horas antes.
 */
export async function conferirTokenDaMeta(): Promise<SaudeDoToken> {
  if (!sb) return conferirTokenExemplo();
  const { data, error } = await sb.functions.invoke('conectar-conta', {
    body: { acao: 'conferir' },
  });
  if (error) {
    const { mensagem, saude } = await corpoDaFuncao(error, 'Nao consegui conferir o token.');
    throw new FalhaDaMeta(mensagem, saude);
  }
  return data as SaudeDoToken;
}

export async function salvarContaSocial(
  clienteId: string,
  conta: ContaDescoberta,
): Promise<void> {
  if (!sb) {
    salvarContaSocialExemplo(clienteId, conta);
    return;
  }
  const { error } = await sb.functions.invoke('conectar-conta', {
    body: {
      acao: 'salvar',
      clienteId,
      plataforma: 'instagram',
      nome: conta.igUsername ?? conta.pageName,
      igUserId: conta.igUserId,
      pageId: conta.pageId,
    },
  });
  if (error) throw new FalhaDados(await mensagemDaFuncao(error, 'Nao consegui salvar a conta.'));
}

export async function conectores(): Promise<Conector[] | null> {
  if (!sb) return conectoresExemplo();
  const { data, error } = await sb.rpc('estado_dos_conectores');
  if (error) throw new FalhaDados(`Nao consegui ler as integracoes: ${error.message}`);
  return (data as Conector[] | null) ?? null;
}

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

  throw new FalhaDados(await mensagemDaFuncao(error, 'Nao consegui convidar.'));
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
  const lista = exija(data as GaleriaNaLista[] | null, 'As galerias deste cliente');

  // A `capa` vem como CAMINHO no balde privado (`<galeria>/mini/<id>.webp`),
  // porque funcao SQL nao assina nada. O cartao punha esse caminho direto no
  // `src` da imagem, e o navegador mostrava o icone de imagem quebrada.
  //
  // Esteve assim desde a 0034 e ninguem viu: a capa era uma faixa fina de 16:7
  // no alto do cartao, e faixa escura quebrada parece faixa escura. Quando ela
  // virou uma capa 4:3 de verdade, o defeito apareceu na primeira olhada.
  //
  // Uma assinatura so para todas as capas da tela: uma chamada por galeria
  // seria uma viagem de rede por cartao.
  const caminhos = [...new Set(lista.map((g) => g.capa).filter((c): c is string => !!c))];
  if (caminhos.length === 0) return lista;

  const { data: urls } = await sb.storage.from('galerias').createSignedUrls(caminhos, 3600);
  // Sem predicado de tipo aqui: o tipo do supabase-js traz `path` e `signedUrl`
  // anulaveis (e um `signedURL` legado), e afirmar um formato proprio nao
  // compila. Monta o mapa no laco, que e honesto e nao precisa de asserçao.
  const mapa = new Map<string, string>();
  for (const u of urls ?? []) {
    if (u.path && u.signedUrl) mapa.set(u.path, u.signedUrl);
  }

  // Capa que nao assinou vira `null`, nao caminho cru: o cartao sabe desenhar
  // o lugar vazio, e nao sabe desenhar um endereco que nao existe.
  return lista.map((g) => ({ ...g, capa: g.capa ? (mapa.get(g.capa) ?? null) : null }));
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
      .select('titulo, recado, permite_download, capa_item_id, sessoes_captacao(data, clientes(nome))')
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
    capa_item_id: string | null;
    sessoes_captacao: { data: string; clientes: { nome: string } | null } | null;
  };

  // A capa e a miniatura de um dos itens que ja vieram assinados — nao vale
  // uma segunda assinatura so para ela.
  const capa = c.capa_item_id
    ? (itens.find((i) => i.id === c.capa_item_id)?.miniatura ?? null)
    : null;

  return {
    titulo: c.titulo ?? 'Galeria',
    recado: c.recado,
    cliente: c.sessoes_captacao?.clientes?.nome ?? null,
    quando: c.sessoes_captacao?.data ?? null,
    permiteDownload: c.permite_download,
    capa,
    capaItemId: c.capa_item_id,
    favoritos: ((favs ?? []) as { item_id: string }[]).map((f) => f.item_id),
    itens,
  };
}

/**
 * Tira a galeria do ar, ou devolve (0058).
 *
 * Arquivar e gaveta, nao revogacao: o link para de abrir porque
 * `galeria_por_token` recusa galeria arquivada, e desarquivar devolve o MESMO
 * link. Os arquivos ficam no balde.
 */
export async function arquivarGaleria(galeriaId: string, arquivar: boolean): Promise<void> {
  if (!sb) {
    const { arquivarGaleriaExemplo } = await import('./mock');
    arquivarGaleriaExemplo(galeriaId, arquivar);
    return;
  }
  const { error } = await sb.rpc('arquivar_galeria', {
    p_galeria: galeriaId,
    p_arquivar: arquivar,
  });
  if (error) throw new FalhaDados(error.message);
}

/**
 * Apaga a galeria de vez: as linhas E os arquivos (0058). Nao tem volta.
 *
 * A ORDEM importa, e e a mesma do resto do projeto: a linha primeiro, o
 * arquivo depois. Ao contrario, uma falha no meio deixaria a galeria apontando
 * para arquivo que nao existe — miniatura quebrada na cara do cliente. Do jeito
 * certo, uma falha no meio deixa arquivo orfao no balde: desperdicio, nao
 * defeito.
 *
 * Quem tira do balde e este navegador, com o JWT de quem clicou, porque e ele
 * que tem permissao no bucket — funcao SQL nao alcanca o storage.
 */
export async function excluirGaleria(
  galeriaId: string,
): Promise<{ titulo: string; itens: number; arquivosApagados: number; arquivosQueFicaram: number }> {
  if (!sb) {
    const { excluirGaleriaExemplo } = await import('./mock');
    return excluirGaleriaExemplo(galeriaId);
  }

  const { data, error } = await sb.rpc('excluir_galeria', { p_galeria: galeriaId });
  if (error) throw new FalhaDados(error.message);

  const r = data as { titulo: string; itens: number; caminhos: string[] };
  let apagados = 0;
  if (r.caminhos.length > 0) {
    // Em lotes: `remove` com milhares de caminhos de uma vez estoura o pedido.
    for (let i = 0; i < r.caminhos.length; i += 100) {
      const lote = r.caminhos.slice(i, i + 100);
      const { error: e } = await sb.storage.from('galerias').remove(lote);
      if (!e) apagados += lote.length;
    }
  }
  // O que NAO saiu do balde volta junto, contado.
  //
  // Antes esta funcao contava o que saiu e seguia, com um comentario meu
  // dizendo que o resto "e lixo no balde, nao defeito na tela". A primeira
  // metade estava certa — arquivo que nao sai nao desfaz a exclusao, e deixar
  // orfao e melhor que deixar galeria apontando para arquivo que sumiu. A
  // segunda metade era falha silenciosa, que e proibida aqui.
  //
  // O preco: 175 MB parados no balde da Astart, 60% do total, de uma galeria
  // apagada em 28/10 — e ninguem soube ate a dona perguntar onde as fotos
  // ficavam guardadas.
  return {
    titulo: r.titulo,
    itens: r.itens,
    arquivosApagados: apagados,
    arquivosQueFicaram: r.caminhos.length - apagados,
  };
}

/**
 * Arquivos no balde que nenhuma linha do banco referencia (0062).
 *
 * Existe porque 60% do balde da Astart era lixo e ninguem sabia: 369 arquivos,
 * 175 MB, de uma galeria apagada em 28/10 cujos arquivos ficaram. Descobri
 * medindo para responder "onde as fotos ficam guardadas?".
 *
 * `margemMinutos` nao e detalhe: o upload sobe o arquivo ANTES de gravar a
 * linha, entao durante uma subida ha arquivos sem dono que sao identicos a um
 * orfao. Sem a margem, uma faxina apagaria foto de cliente no meio do upload.
 */
export async function arquivosOrfaos(
  margemMinutos = 60,
): Promise<{ arquivos: number; bytes: number; caminhos: string[]; margemMinutos: number }> {
  if (!sb) {
    const { arquivosOrfaosExemplo } = await import('./mock');
    return arquivosOrfaosExemplo();
  }
  const { data, error } = await sb.rpc('arquivos_orfaos', { p_minutos: margemMinutos });
  if (error) throw new FalhaDados(error.message);
  return data as { arquivos: number; bytes: number; caminhos: string[]; margemMinutos: number };
}

/**
 * Tira do balde os arquivos que a funcao acima apontou.
 *
 * Quem apaga e o navegador de quem clicou, com o JWT dele — SQL nao alcanca o
 * storage, e a politica do balde ja diz quem pode. Em lotes de cem, como no
 * apagar galeria: `remove` com milhares de caminhos estoura o pedido.
 *
 * Devolve quantos sairam E quantos ficaram. Nunca so o primeiro: foi engolir o
 * segundo que deixou 175 MB acumularem sem aviso.
 */
export async function apagarArquivosOrfaos(
  caminhos: string[],
): Promise<{ apagados: number; ficaram: number }> {
  if (!sb) return { apagados: caminhos.length, ficaram: 0 };
  let apagados = 0;
  for (let i = 0; i < caminhos.length; i += 100) {
    const lote = caminhos.slice(i, i + 100);
    const { error } = await sb.storage.from('galerias').remove(lote);
    if (!error) apagados += lote.length;
  }
  return { apagados, ficaram: caminhos.length - apagados };
}

/**
 * Troca a capa da galeria (0057).
 *
 * A capa e a primeira coisa que o cliente ve ao abrir o link. A coluna
 * `capa_item_id` existia desde a 0034 e ninguem conseguia mexer nela: a
 * primeira foto entrava sozinha e ficava para sempre.
 */
export async function definirCapaGaleria(galeriaId: string, itemId: string | null): Promise<void> {
  if (!sb) {
    const { definirCapaExemplo } = await import('./mock');
    definirCapaExemplo(galeriaId, itemId);
    return;
  }
  const { error } = await sb.rpc('definir_capa_galeria', {
    p_galeria: galeriaId,
    p_item: itemId,
  });
  if (error) throw new FalhaDados(error.message);
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
/**
 * Apaga o cliente de verdade — as linhas E os arquivos (0060).
 *
 * Ate a 0060 isto recusava cliente com qualquer historico e mandava desativar.
 * A dona decidiu o contrario: "pode apagar, nao deixa em historico que
 * sobrecarrega a memoria. apagou apagou".
 *
 * O cascade do banco leva as linhas; os ARQUIVOS nao, porque funcao SQL nao
 * alcanca o Storage. Sem este segundo passo, apagar um cliente deixaria as
 * fotos das galerias e as midias dos posts orfas no balde — a mesma sobrecarga,
 * agora invisivel. Por isso a funcao devolve os caminhos agrupados por balde e
 * quem remove e este navegador, com o JWT de quem clicou.
 *
 * A ordem e linha primeiro, arquivo depois, igual ao resto do projeto: ao
 * contrario, uma falha no meio deixaria tela apontando para arquivo que nao
 * existe. Do jeito certo, deixa arquivo orfao — desperdicio, nao defeito.
 */
export async function removerCliente(clienteId: string): Promise<ResumoDaRemocao> {
  if (!sb) {
    try {
      return removerClienteExemplo(clienteId);
    } catch (x) {
      throw new FalhaDados(x instanceof Error ? x.message : 'Não consegui remover.');
    }
  }

  const { data, error } = await sb.rpc('remover_cliente', { p_cliente: clienteId });
  if (error) throw new FalhaDados(error.message);

  const r = data as {
    nome: string;
    publicacoes: number;
    aprovacoes: number;
    lancamentos: number;
    captacoes: number;
    contas: number;
    documentos: number;
    arquivos: { galerias: string[]; midias: string[]; documentos: string[] };
  };

  let apagados = 0;
  for (const [balde, caminhos] of [
    ['galerias', r.arquivos.galerias],
    ['midias-posts', r.arquivos.midias],
    ['documentos', r.arquivos.documentos],
  ] as const) {
    // Em lotes: `remove` com milhares de caminhos de uma vez estoura o pedido.
    for (let i = 0; i < caminhos.length; i += 100) {
      const lote = caminhos.slice(i, i + 100);
      const { error: e } = await sb.storage.from(balde).remove(lote);
      // Arquivo que nao sai nao desfaz a remocao — a linha ja foi. Conta o que
      // saiu e segue: o resto e lixo no balde, nao defeito na tela.
      if (!e) apagados += lote.length;
    }
  }

  return {
    nome: r.nome,
    publicacoes: r.publicacoes,
    aprovacoes: r.aprovacoes,
    lancamentos: r.lancamentos,
    captacoes: r.captacoes,
    contas: r.contas,
    documentos: r.documentos,
    arquivosApagados: apagados,
  };
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
