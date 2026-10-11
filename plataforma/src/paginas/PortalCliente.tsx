import { useCallback, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { CascaCliente } from '../componentes/Casca';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { painelCliente } from '../dados/api';
import { useSessao } from '../sessao';
import { InicioCliente } from './InicioCliente';
import { PortalAprovar } from './PortalAprovar';
import { Projeto } from './Projeto';
import type { PainelCliente } from '../dados/tipos';

/** Tela ainda não construída. Diz isso, em vez de mostrar uma página em branco. */
function EmBreve({ titulo }: { titulo: string }) {
  return (
    <Vazio titulo={titulo} explica="Esta tela ainda não foi construída. O portal já reconhece a rota." />
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
  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!painel) return <Carregando oQue="o seu portal" />;

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
            <div className="px-5 pb-16 sm:px-8 lg:px-12">
              <h1 className="titulao pt-9 text-[clamp(1.8rem,5vw,2.8rem)]">Meu projeto</h1>
              <Projeto clienteId={painel.cliente.id} equipe={false} />
            </div>
          }
        />
        <Route path="calendario" element={<EmBreve titulo="Calendário" />} />
        <Route path="grid" element={<EmBreve titulo="Grid" />} />
        <Route path="campanhas" element={<EmBreve titulo="Campanhas" />} />
        <Route path="galeria" element={<EmBreve titulo="Galeria" />} />
        <Route path="site" element={<EmBreve titulo="Meu site" />} />
        <Route path="acervo" element={<EmBreve titulo="Acervo" />} />
        <Route path="financeiro" element={<EmBreve titulo="Financeiro" />} />
        <Route path="contrato" element={<EmBreve titulo="Contrato" />} />
        <Route path="feedback" element={<EmBreve titulo="Feedback" />} />
        <Route path="*" element={<EmBreve titulo="Página não encontrada" />} />
      </Routes>
    </CascaCliente>
  );
}
