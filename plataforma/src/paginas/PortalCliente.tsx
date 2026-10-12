import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { CascaCliente } from '../componentes/Casca';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { painelCliente } from '../dados/api';
import { useSessao } from '../sessao';
import { InicioCliente } from './InicioCliente';
import { PortalAprovar } from './PortalAprovar';
import { Ambientes } from './Ambientes';
import { Calendario } from './Calendario';
import { Campanhas } from './Campanhas';
import { ContaDoCliente } from './ContaDoCliente';
import { Contrato } from './Contrato';
import { FeedbackCliente } from './FeedbackCliente';
import { Galeria } from './Galeria';
import { Grid } from './Grid';
import { Projeto } from './Projeto';
import type { PainelCliente } from '../dados/tipos';

/** Tela ainda não construída. Diz isso, em vez de mostrar uma página em branco. */
function EmBreve({ titulo }: { titulo: string }) {
  return (
    <Vazio titulo={titulo} explica="Em breve." />
  );
}

/**
 * O miolo de cada aba do portal. O h1 fica aqui, uma vez: tela sem h1 deixa
 * quem navega por marcos sem ponto de entrada, e dois h1 é a mesma doença.
 */
function Aba({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <h1 className="titulao pt-9 text-[clamp(1.8rem,5vw,2.8rem)]">{titulo}</h1>
      {children}
    </div>
  );
}

export function PortalCliente() {
  const { sessao } = useSessao();
  const [painel, setPainel] = useState<PainelCliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const clienteId = sessao.tipo === 'cliente' ? sessao.clienteAtual.id : null;

  const carregar = useCallback(async () => {
    if (!clienteId) return;
    setErro(null);
    try {
      setPainel(await painelCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui montar o seu portal.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (sessao.tipo !== 'cliente') return null;
  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} principal />;
  if (!painel) return <Carregando oQue="o seu portal" principal />;

  return (
    <CascaCliente modulos={painel.modulos} aprovacoesAbertas={painel.paraAprovar.length}>
      <Routes>
        <Route index element={<InicioCliente painel={painel} nome={sessao.nome} />} />
        <Route
          path="aprovar"
          element={
            <PortalAprovar
              itens={painel.paraAprovar}
              nome={sessao.nome}
              recarregar={carregar}
            />
          }
        />
        <Route
          path="projeto"
          element={
            <Aba titulo="Meu projeto">
              <Projeto clienteId={painel.cliente.id} equipe={false} />
            </Aba>
          }
        />
        <Route
          path="calendario"
          element={
            <Aba titulo="Calendário">
              <Calendario clienteId={painel.cliente.id} equipe={false} />
            </Aba>
          }
        />
        <Route
          path="grid"
          element={
            <Aba titulo="Grid">
              <Grid clienteId={painel.cliente.id} equipe={false} />
            </Aba>
          }
        />
        <Route
          path="campanhas"
          element={
            <Aba titulo="Campanhas">
              <Campanhas clienteId={painel.cliente.id} equipe={false} />
            </Aba>
          }
        />
        <Route
          path="galeria"
          element={
            <Aba titulo="Galeria">
              <Galeria clienteId={painel.cliente.id} equipe={false} quem={sessao.nome} />
            </Aba>
          }
        />
        <Route
          path="site"
          element={
            <Aba titulo="Meu site">
              <Ambientes clienteId={painel.cliente.id} equipe={false} />
            </Aba>
          }
        />
        {/* Acervo e Galeria leem a mesma coisa: os arquivos entregues. O que
            muda e o nome que o contrato da a aba. */}
        <Route
          path="acervo"
          element={
            <Aba titulo="Acervo">
              <Galeria clienteId={painel.cliente.id} equipe={false} quem={sessao.nome} />
            </Aba>
          }
        />
        <Route
          path="financeiro"
          element={
            <Aba titulo="Financeiro">
              <ContaDoCliente clienteId={painel.cliente.id} equipe={false} />
            </Aba>
          }
        />
        <Route
          path="contrato"
          element={
            <Aba titulo="Contrato">
              <Contrato clienteId={painel.cliente.id} equipe={false} />
            </Aba>
          }
        />
        <Route
          path="feedback"
          element={
            <Aba titulo="Feedback">
              <FeedbackCliente clienteId={painel.cliente.id} equipe={false} />
            </Aba>
          }
        />
        <Route path="*" element={<EmBreve titulo="Página não encontrada" />} />
      </Routes>
    </CascaCliente>
  );
}
