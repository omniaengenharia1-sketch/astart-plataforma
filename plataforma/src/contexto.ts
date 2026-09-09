import { useOutletContext } from 'react-router-dom';
import type { Dispatch, SetStateAction } from 'react';
import type { Aprovacao, EventoAlvo, Perfil, Post, PostAlvo } from './dados/tipos';

/**
 * Estado compartilhado entre as telas. Enquanto a fase for visual, ele vive em
 * memória; quando o Supabase entrar, cada setter vira um mutate + revalidate.
 */
export interface CtxApp {
  operador: Perfil;
  clienteAtivo: string;
  setClienteAtivo: (id: string) => void;
  posts: Post[];
  setPosts: Dispatch<SetStateAction<Post[]>>;
  alvos: PostAlvo[];
  setAlvos: Dispatch<SetStateAction<PostAlvo[]>>;
  eventos: Record<string, EventoAlvo[]>;
  setEventos: Dispatch<SetStateAction<Record<string, EventoAlvo[]>>>;
  aprovacoes: Aprovacao[];
  setAprovacoes: Dispatch<SetStateAction<Aprovacao[]>>;
  avisar: (mensagem: string) => void;
}

export function useApp(): CtxApp {
  return useOutletContext<CtxApp>();
}

export const ROTULO_STATUS: Record<string, string> = {
  rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovado: 'Aprovado',
  agendado: 'Agendado',
  publicando: 'Publicando',
  publicado: 'Publicado',
  publicado_parcial: 'Publicado parcial',
  falhou: 'Falhou',
  cancelado: 'Cancelado',
};

/** Cor da borda da peça no calendário. */
export const COR_STATUS: Record<string, string> = {
  rascunho: 'border-l-linha-forte',
  aguardando_aprovacao: 'border-l-espera',
  aprovado: 'border-l-ok',
  agendado: 'border-l-pink',
  publicando: 'border-l-espera',
  publicado: 'border-l-ok',
  publicado_parcial: 'border-l-espera',
  falhou: 'border-l-falha',
  cancelado: 'border-l-linha-forte',
};

export const TOM_STATUS: Record<string, 'ok' | 'espera' | 'falha' | 'acao' | 'neutro'> = {
  rascunho: 'neutro',
  aguardando_aprovacao: 'espera',
  aprovado: 'ok',
  agendado: 'acao',
  publicando: 'espera',
  publicado: 'ok',
  publicado_parcial: 'espera',
  falhou: 'falha',
  cancelado: 'neutro',
};

export const ESTADOS_EM_VOO = [
  'pendente',
  'container_criando',
  'container_aguardando',
  'container_pronto',
  'publicando',
];

/** Mês fixo enquanto os dados são fictícios. */
export const ANO = 2026;
export const MES = 7; // agosto
export const HOJE = 26;
