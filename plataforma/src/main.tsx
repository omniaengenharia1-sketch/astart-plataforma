import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { ProvedorSessao } from './sessao';
import { ligarReflexo } from './efeitos/reflexo';
import './estilos/global.css';

ligarReflexo();

// As auroras vivem fora da arvore do React: sao decoracao pura, nao tem estado
// e nao devem re-renderizar com nada.
const luz = document.createElement('div');
luz.className = 'auroras';
luz.setAttribute('aria-hidden', 'true');
luz.innerHTML = '<i></i><i></i><i></i>';
document.body.prepend(luz);

// Prévia estática (VITE_PREVIA=1) usa rota com #: sem servidor que devolva o
// index.html em qualquer caminho, recarregar /clientes daria 404. Em produção
// é BrowserRouter, com a URL limpa.
const Rota = import.meta.env['VITE_PREVIA'] === '1' ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Rota>
      <ProvedorSessao>
        <App />
      </ProvedorSessao>
    </Rota>
  </StrictMode>,
);
