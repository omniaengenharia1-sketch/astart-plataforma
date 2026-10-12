// =============================================================================
// Quem pode o quê, num lugar só.
//
// O banco é quem decide de verdade: as funções do dinheiro devolvem `null` para
// quem não cuida dele, e `cliente_servicos` tem a coluna do valor fechada por
// privilégio (migration 0039). Isto aqui existe para a tela não OFERECER o que
// o banco vai recusar — menu que abre numa recusa é pior que menu que não tem o
// item.
//
// Quando as duas discordarem, o banco está certo.
// =============================================================================
import type { Sessao } from './dados/tipos';

/** Financeiro e Comercial: papel admin ou financeiro. */
export function veDinheiro(sessao: Sessao): boolean {
  return sessao.tipo === 'equipe'
    && (sessao.perfil.papel === 'admin' || sessao.perfil.papel === 'financeiro');
}

/** Equipe, acessos, papéis, tirar cliente do ar. */
export function souAdmin(sessao: Sessao): boolean {
  return sessao.tipo === 'equipe' && sessao.perfil.papel === 'admin';
}
