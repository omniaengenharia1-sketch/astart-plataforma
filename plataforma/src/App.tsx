import { Navigate, Route, Routes } from 'react-router-dom';
import { CascaEquipe } from './componentes/Casca';
import { Carregando, Vazio } from './componentes/Estado';
import { useSessao } from './sessao';
import { Entrar } from './paginas/Entrar';
import { Ajustes } from './paginas/Ajustes';
import { Aprovacoes } from './paginas/Aprovacoes';
import { Clientes } from './paginas/Clientes';
import { FichaCliente } from './paginas/FichaCliente';
import { InicioEquipe } from './paginas/InicioEquipe';
import { NovoCliente } from './paginas/NovoCliente';
import { PortalCliente } from './paginas/PortalCliente';

function EmBreve({ titulo }: { titulo: string }) {
  return (
    <Vazio titulo={titulo} explica="Esta tela ainda não foi construída. A rota já existe." />
  );
}

export default function App() {
  const { sessao, carregando } = useSessao();

  if (carregando) return <Carregando oQue="a plataforma" />;
  if (sessao.tipo === 'anonimo') return <Entrar />;

  // Depois da senha o sistema sabe quem e: equipe cai no painel, cliente no
  // portal. Ninguem escolhe "sou cliente" ou "sou equipe" numa tela.
  if (sessao.tipo === 'cliente') {
    return (
      <Routes>
        <Route path="/portal/*" element={<PortalCliente />} />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/portal/*" element={<Navigate to="/" replace />} />
      <Route
        path="*"
        element={
          <CascaEquipe>
            <Routes>
              <Route path="/" element={<InicioEquipe />} />
              <Route path="/clientes" element={<Clientes />} />
              <Route path="/clientes/novo" element={<NovoCliente />} />
              <Route path="/clientes/:clienteId/*" element={<FichaCliente />} />
              <Route path="/aprovacoes" element={<Aprovacoes />} />
              <Route path="/agenda" element={<EmBreve titulo="Agenda" />} />
              <Route path="/fila" element={<EmBreve titulo="Fila de publicação" />} />
              <Route path="/financeiro" element={<EmBreve titulo="Financeiro" />} />
              <Route path="/comercial" element={<EmBreve titulo="Comercial" />} />
              <Route path="/ajustes/*" element={<Ajustes />} />
              <Route path="/feedbacks" element={<EmBreve titulo="Feedbacks" />} />
              <Route path="/grid" element={<EmBreve titulo="Grid" />} />
              <Route path="/entregaveis" element={<EmBreve titulo="Entregáveis" />} />
              <Route path="*" element={<EmBreve titulo="Página não encontrada" />} />
            </Routes>
          </CascaEquipe>
        }
      />
    </Routes>
  );
}
