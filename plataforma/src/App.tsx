import { Navigate, Route, Routes } from 'react-router-dom';
import { sb } from './dados/supabase';
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
import { Tarefas } from './paginas/Tarefas';
import { Financeiro } from './paginas/Financeiro';
import { InicioEquipe } from './paginas/InicioEquipe';
import { NovaSenha } from './paginas/NovaSenha';
import { NovoCliente } from './paginas/NovoCliente';
import { ExclusaoDeDados, Privacidade, Termos } from './paginas/Politicas';
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
  // As tres paginas da homologacao: publicas, sem login, porque o revisor da
  // Meta nao tem conta aqui. Vem ANTES de tudo, como os links sem conta.
  if (/^\/(privacidade|termos|exclusao-de-dados)$/.test(window.location.pathname)) {
    return (
      <Routes>
        <Route path="/privacidade" element={<Privacidade />} />
        <Route path="/termos" element={<Termos />} />
        <Route path="/exclusao-de-dados" element={<ExclusaoDeDados />} />
      </Routes>
    );
  }

  // A COSTURA QUE PROVA A BARREIRA DE ERRO.
  //
  // A barreira existe porque a plataforma inteira virou uma tela em branco
  // quando algo estourou durante o desenho. Barreira que ninguem exercita e
  // barreira que a gente DESCOBRE quebrada no dia seguinte — e o dia seguinte
  // e, de novo, uma tela branca na frente da dona.
  //
  // Para exercita-la de verdade e preciso uma tela que estoure de verdade:
  // erro simulado por fora nao passa pelo caminho de desenho do React, que e
  // justamente o caminho que apaga a pagina.
  //
  // So existe no MODO EXEMPLO (`sb` nulo, que e quando nao ha Supabase
  // configurado). Na producao a condicao e falsa e este caminho nao responde.
  // E o mesmo portao do resto do modo exemplo, entao nao e um portao novo para
  // alguem errar.
  // `(^|#)` porque o modo exemplo roda nas duas rotas: `/estourar` com a URL
  // limpa e `#/estourar` na previa estatica. Escrevi so a segunda na primeira
  // versao e o roteiro nunca teria chegado aqui — guarda que nao e alcancada e
  // guarda que nao existe.
  if (!sb && /(^|#)\/estourar$/.test(window.location.pathname + window.location.hash)) {
    throw new Error('Tela de teste da barreira de erro.');
  }

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
              <Route path="/tarefas" element={<Tarefas />} />
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
