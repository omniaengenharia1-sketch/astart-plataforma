import { Navigate, Route, Routes } from 'react-router-dom';
import { CascaEquipe } from './componentes/Casca';
import { Carregando, NaoEAqui, Vazio } from './componentes/Estado';
import { useSessao } from './sessao';
import { veDinheiro } from './permissao';
import { AlbumPublico } from './paginas/AlbumPublico';
import { Aprovar } from './paginas/Aprovar';
import { Entrar } from './paginas/Entrar';
import { Agenda } from './paginas/Agenda';
import { Ajustes } from './paginas/Ajustes';
import { Aprovacoes } from './paginas/Aprovacoes';
import { Clientes } from './paginas/Clientes';
import { Comercial } from './paginas/Comercial';
import { Feedbacks } from './paginas/Feedbacks';
import { FichaCliente } from './paginas/FichaCliente';
import { Fila } from './paginas/Fila';
import { Financeiro } from './paginas/Financeiro';
import { InicioEquipe } from './paginas/InicioEquipe';
import { NovaSenha } from './paginas/NovaSenha';
import { NovoCliente } from './paginas/NovoCliente';
import { PortalCliente } from './paginas/PortalCliente';

function EmBreve({ titulo }: { titulo: string }) {
  return (
    <Vazio titulo={titulo} explica="Em breve." />
  );
}

export default function App() {
  const { sessao, carregando } = useSessao();
  const dinheiro = veDinheiro(sessao);

  if (carregando) return <Carregando oQue="a plataforma" principal />;

  // Os dois links sem conta vem ANTES de qualquer checagem de sessao: quem
  // recebeu o endereco nao tem conta, e nao vai criar uma para ver as proprias
  // fotos nem para aprovar uma peca. Se a sessao decidisse primeiro, a tela de
  // entrada apareceria para quem nunca vai ter login.
  const caminho = window.location.pathname + window.location.hash;
  if (/(^|#)\/(g|a)\//.test(caminho)) {
    return (
      <Routes>
        <Route path="/g/:token" element={<AlbumPublico />} />
        <Route path="/a/:token" element={<Aprovar />} />
      </Routes>
    );
  }

  // A tela de senha tambem vem antes da sessao, e por um motivo que nao e
  // obvio: o link de convite e o de recuperacao CRIAM uma sessao ao abrir. Se a
  // checagem de sessao decidisse primeiro, a pessoa cairia dentro da plataforma
  // sem nunca definir senha — entrava hoje e ficava trancada fora amanha.
  if (/^\/nova-senha/.test(window.location.pathname)) {
    return (
      <Routes>
        <Route path="/nova-senha" element={<NovaSenha />} />
      </Routes>
    );
  }

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
              <Route path="/agenda" element={<Agenda />} />
              <Route path="/fila" element={<Fila />} />
              {/* Quem digitou o endereço na barra recebe uma lâmina que
                  explica, não a mensagem crua de uma função que devolveu null. */}
              <Route
                path="/financeiro"
                element={dinheiro ? <Financeiro /> : <NaoEAqui oQue="Financeiro" />}
              />
              <Route
                path="/comercial"
                element={dinheiro ? <Comercial /> : <NaoEAqui oQue="Comercial" />}
              />
              <Route path="/feedbacks" element={<Feedbacks />} />
              <Route path="/ajustes/*" element={<Ajustes />} />
              {/* Grid, calendário e entregáveis são de um cliente: moram na
                  ficha dele, não numa tela solta que não saberia de quem é. */}
              <Route path="*" element={<EmBreve titulo="Página não encontrada" />} />
            </Routes>
          </CascaEquipe>
        }
      />
    </Routes>
  );
}
