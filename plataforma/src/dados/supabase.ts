import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * O cliente so existe quando as duas variaveis estao configuradas. Sem elas a
 * plataforma roda com dados de exemplo, e diz isso na tela — em vez de quebrar
 * com "failed to fetch" e deixar a pessoa adivinhando.
 */
const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;

/**
 * A chave publica do projeto. O Supabase trocou o formato: a `anon` antiga era
 * um JWT (`eyJ...`) e a nova e uma publishable (`sb_publishable_...`). As duas
 * sao publicas por desenho — elas vao dentro do bundle, qualquer pessoa le do
 * navegador — e quem decide o que cada uma alcanca e o RLS, dentro do banco.
 *
 * Aceitamos os dois nomes de variavel porque projetos novos nem mostram mais a
 * `anon`, e projetos antigos ainda usam ela. Cair em modo exemplo por causa do
 * nome da variavel seria o tipo de erro que custa uma tarde.
 */
const chave =
  (import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] as string | undefined) ??
  (import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined);

export const ligado = Boolean(url && chave);

/**
 * O endereco EXATO com que a aba abriu, guardado antes de qualquer outra coisa.
 *
 * Isto tem de ficar aqui, acima do `createClient`, e nao e preciosismo: com
 * `detectSessionInUrl` o supabase-js consome o hash e LIMPA a barra de
 * endereco. Quem for ler `window.location.hash` depois ja nao acha nada.
 *
 * O caso que isso quebrava: um link de senha vencido chega como
 * `#error=access_denied&error_code=otp_expired`. A tela lia o hash para
 * distinguir "este link nao serve mais" de "este endereco precisa de um link",
 * e no site de verdade lia hash vazio — entao mandava a pessoa pedir um link
 * novo sem dizer que o dela havia vencido. Em modo exemplo nao existe cliente,
 * ninguem limpa o hash, e o roteiro passava: o bug sO aparecia em producao.
 *
 * Duas linhas no topo do modulo que cria o cliente garantem a ordem. Em
 * qualquer outro arquivo, a ordem passaria a depender de quem importa quem.
 */
export const enderecoDeChegada = {
  hash: window.location.hash,
  busca: window.location.search,
};

/**
 * Quando a sessão morre, o banco responde como se você fosse visitante.
 *
 * Aconteceu em produção no primeiro dia: o token venceu, a tela continuou
 * mostrando "ASTARTAGENCIA · DIREÇÃO" no topo, e o painel trouxe uma caixa
 * vermelha com `permission denied for function painel_equipe`. É o erro que o
 * papel `anon` recebe — o cabeçalho estava logado e a chamada chegou ao banco
 * sem credencial nenhuma.
 *
 * Duas coisas erradas ali, e a segunda é a grave:
 *   1. a mensagem era texto do Postgres, em inglês, sem dizer o que fazer;
 *   2. a plataforma continuou afirmando que você estava dentro, com um botão
 *      "tentar de novo" que nunca ia funcionar.
 *
 * Reconhecer isso em cada uma das ~60 chamadas seria esquecer em alguma. Então
 * a checagem fica aqui, uma vez, em volta do `rpc`: sessão morta vira
 * `signOut()`, e quem decide o que a pessoa vê é a tela de entrada — com
 * recado, não com erro de banco.
 */
/**
 * O ponto central é o `fetch`, não o `rpc`.
 *
 * A primeira tentativa envolveu `cliente.rpc`, e o TypeScript recusou com
 * razão: `rpc()` devolve um construtor de consulta encadeável, não uma
 * promessa. Trocar por função `async` quebraria qualquer chamada que use
 * `.single()` — em silêncio, só em produção. O `fetch` não tem esse problema:
 * TODA chamada ao banco passa por ele, inclusive as de tabela.
 */
let conferindo = false;

async function conferirSessao(cliente: SupabaseClient): Promise<void> {
  if (conferindo) return;
  conferindo = true;
  try {
    const { data } = await cliente.auth.getSession();
    if (!data.session) return; // Já está fora: a tela de entrada resolve.

    // Só derruba se a renovação REALMENTE falhar. Um 401 legítimo — alguém
    // logado pedindo o que o papel dela não alcança — não pode expulsar
    // ninguém: seria trocar um bug por outro pior.
    const { error } = await cliente.auth.refreshSession();
    if (error) await cliente.auth.signOut();
  } finally {
    conferindo = false;
  }
}

export const sb: SupabaseClient | null = ligado
  ? (() => {
      let cliente: SupabaseClient;

      const buscaComGuarda: typeof fetch = async (entrada, inicio) => {
        const resposta = await fetch(entrada, inicio);

        const endereco = typeof entrada === 'string' ? entrada : (entrada as Request).url ?? String(entrada);
        // As rotas de `auth` ficam de fora: senha errada noutra aba responde
        // 400/401 e não pode derrubar quem já está dentro. E a própria
        // renovação passa por aqui — sem esta linha, laço infinito.
        const ehAuth = endereco.includes('/auth/v1/');

        if (!ehAuth && (resposta.status === 401 || resposta.status === 403)) {
          void conferirSessao(cliente);
        }
        return resposta;
      };

      cliente = createClient(url as string, chave as string, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        global: { fetch: buscaComGuarda },
      });
      return cliente;
    })()
  : null;
