import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { aoMudarSessao, entrar as apiEntrar, ligado, sair as apiSair, sessaoAtual } from './dados/api';
import type { Cliente, Sessao } from './dados/tipos';

interface Ctx {
  sessao: Sessao;
  carregando: boolean;
  /** Caiu para fora sem ter clicado em Sair: o token venceu. */
  expirou: boolean;
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
  const [expirou, setExpirou] = useState(false);
  // `sair()` tambem dispara SIGNED_OUT. Sem distinguir, quem clica em Sair
  // leria "sua sessao expirou", que e mentira e assusta.
  const [saindoDeProposito, setSaindoDeProposito] = useState(false);

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

  // O ouvinte e o conserto de fundo. Ler a sessao so no carregamento deixava a
  // plataforma afirmando que a pessoa estava dentro depois de o token morrer —
  // cabecalho logado, painel com erro de banco, botao "tentar de novo" que
  // nunca ia funcionar.
  useEffect(
    () =>
      aoMudarSessao((saiu) => {
        if (saiu && !saindoDeProposito) setExpirou(true);
        void recarregar();
      }),
    [recarregar, saindoDeProposito],
  );

  const entrar = useCallback(
    async (email: string, senha: string) => {
      setExpirou(false);
      await apiEntrar(email, senha);
      await recarregar();
    },
    [recarregar],
  );

  const sair = useCallback(async () => {
    setSaindoDeProposito(true);
    setExpirou(false);
    await apiSair();
    setSessao({ tipo: 'anonimo' });
    setSaindoDeProposito(false);
  }, []);

  const trocarCliente = useCallback((c: Cliente) => {
    setSessao((s) => (s.tipo === 'cliente' ? { ...s, clienteAtual: c } : s));
  }, []);

  const valor = useMemo<Ctx>(
    () => ({ sessao, carregando, expirou, ligado, entrar, sair, trocarCliente, recarregar }),
    [sessao, carregando, expirou, entrar, sair, trocarCliente, recarregar],
  );

  return <CtxSessao.Provider value={valor}>{children}</CtxSessao.Provider>;
}

export function useSessao(): Ctx {
  const c = useContext(CtxSessao);
  if (!c) throw new Error('useSessao fora do ProvedorSessao.');
  return c;
}
