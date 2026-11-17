import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, useLocation } from 'react-router-dom';
import App from './App';
import { BarreiraDeErro } from './componentes/BarreiraDeErro';
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

/**
 * A barreira fica DENTRO da rota, e envolve a sessão.
 *
 * Dentro da rota porque ela precisa saber quando a pessoa mudou de tela: é
 * assim que a barreira abaixa sozinha quando a tela quebrada fica para trás.
 *
 * Envolvendo a sessão, e não só o `App`, porque um erro ao ler quem está
 * logado também apagava a página — e esse é justamente o erro que aparece
 * antes de qualquer tela existir.
 */
function ComBarreira({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <BarreiraDeErro chave={pathname}>{children}</BarreiraDeErro>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Rota>
      <ComBarreira>
        <ProvedorSessao>
          <App />
        </ProvedorSessao>
      </ComBarreira>
    </Rota>
  </StrictMode>,
);
