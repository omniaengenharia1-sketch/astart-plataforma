import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { entrar as apiEntrar, ligado, sair as apiSair, sessaoAtual } from './dados/api';
import type { Cliente, Sessao } from './dados/tipos';

interface Ctx {
  sessao: Sessao;
  carregando: boolean;
  ligado: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  trocarCliente: (c: Cliente) => void;
  recarregar: () => Promise<void>;
}

const CtxSessao = createContext<Ctx | null>(null);

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Sessao>({ tipo: 'anonimo' });
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    try {
      setSessao(await sessaoAtual());
    } catch {
      // Sessao que nao carrega e sessao que nao existe. A tela de entrada
      // aparece, e a pessoa tenta de novo.
      setSessao({ tipo: 'anonimo' });
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const entrar = useCallback(
    async (email: string, senha: string) => {
      await apiEntrar(email, senha);
      await recarregar();
    },
    [recarregar],
  );

  const sair = useCallback(async () => {
    await apiSair();
    setSessao({ tipo: 'anonimo' });
  }, []);

  const trocarCliente = useCallback((c: Cliente) => {
    setSessao((s) => (s.tipo === 'cliente' ? { ...s, clienteAtual: c } : s));
  }, []);

  const valor = useMemo<Ctx>(
    () => ({ sessao, carregando, ligado, entrar, sair, trocarCliente, recarregar }),
    [sessao, carregando, entrar, sair, trocarCliente, recarregar],
  );

  return <CtxSessao.Provider value={valor}>{children}</CtxSessao.Provider>;
}

export function useSessao(): Ctx {
  const c = useContext(CtxSessao);
  if (!c) throw new Error('useSessao fora do ProvedorSessao.');
  return c;
}
