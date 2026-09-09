import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './componentes/Layout';
import { Toast } from './componentes/Toast';
import { Entrada } from './paginas/Entrada';
import { Inicio } from './paginas/Inicio';
import { Clientes } from './paginas/Clientes';
import { ClienteDetalhe } from './paginas/ClienteDetalhe';
import { Calendario } from './paginas/Calendario';
import { Editor } from './paginas/Editor';
import { Fila } from './paginas/Fila';
import { Portal } from './paginas/Portal';
import { AFazer } from './paginas/AFazer';
import { ALVOS, EVENTOS, POSTS } from './dados/mock';
import type { CtxApp } from './contexto';
import type { Aprovacao, EventoAlvo, Perfil, Post, PostAlvo } from './dados/tipos';

const A_FAZER = ['financeiro', 'contratos', 'crm'];

export default function App() {
  const [operador, setOperador] = useState<Perfil | null>(null);
  const [clienteAtivo, setClienteAtivo] = useState('mor');
  const [posts, setPosts] = useState<Post[]>(POSTS);
  const [alvos, setAlvos] = useState<PostAlvo[]>(ALVOS);
  const [eventos, setEventos] = useState<Record<string, EventoAlvo[]>>(EVENTOS);
  const [aprovacoes, setAprovacoes] = useState<Aprovacao[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const avisar = useCallback((mensagem: string) => {
    setAviso(mensagem);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAviso(null), 2800);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!operador) return <Entrada aoEntrar={setOperador} />;

  const contexto: CtxApp = {
    operador,
    clienteAtivo,
    setClienteAtivo,
    posts,
    setPosts,
    alvos,
    setAlvos,
    eventos,
    setEventos,
    aprovacoes,
    setAprovacoes,
    avisar,
  };

  return (
    <>
      <Routes>
        <Route
          element={
            <Layout
              operador={operador}
              aoTrocarOperador={() => setOperador(null)}
              clienteAtivo={clienteAtivo}
              setClienteAtivo={setClienteAtivo}
              contexto={contexto}
            />
          }
        >
          <Route index element={<Inicio operador={operador} />} />
          <Route path="calendario" element={<Calendario />} />
          <Route path="editor" element={<Editor />} />
          <Route path="fila" element={<Fila />} />
          <Route path="aprovacao" element={<Portal />} />
          <Route path="clientes" element={<Clientes operador={operador} />} />
          <Route path="clientes/:id" element={<ClienteDetalhe operador={operador} />} />
          {A_FAZER.map((k) => (
            <Route key={k} path={k} element={<AFazer chave={k} />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toast mensagem={aviso} />
    </>
  );
}
