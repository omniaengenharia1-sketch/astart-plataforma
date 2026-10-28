import { useParams } from 'react-router-dom';
import { Album } from './Album';
import { Logo } from '../componentes/Marca';

/**
 * A página que o cliente de fotos abre. Sem login, sem casca da plataforma:
 * ele não é usuário de nada, é alguém que recebeu um link. A marca aparece no
 * rodapé, discreta — o material é dele, a assinatura é nossa.
 */
export function AlbumPublico() {
  const { token = '' } = useParams();

  return (
    <div className="min-h-dvh text-tinta">
      {/* `py`, não `pt`. Só com respiro em cima a logo encostava na capa: a
          barra media exatamente a altura da logo, e a foto começava no pixel
          seguinte. Parecia logo cortada, e a dona leu como logo quebrada. */}
      <header className="flex items-center justify-between gap-4 px-5 py-6 sm:px-8 lg:px-12">
        <Logo altura={26} />
        <span className="rotulo">galeria</span>
      </header>

      <main id="conteudo" className="entra">
        <Album fonte={{ tipo: 'token', token }} quem="cliente" />
      </main>

      <footer className="border-t border-linha-fraca px-5 py-7 text-center sm:px-8 lg:px-12">
        <span className="rotulo">entregue por astart studio</span>
      </footer>
    </div>
  );
}
