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
    <div className="relative min-h-dvh text-tinta">
      {/* A LOGO FLUTUA SOBRE A CAPA, NÃO EMPURRA A CAPA PARA BAIXO.

          Antes esta barra ocupava 74px de altura no topo da página, e a foto
          começava depois dela. No tema claro isso é uma faixa branca em cima
          da capa — foi o que a dona viu: "a capa tá com esse espaço em
          branco". Uma entrega de fotografia começa na foto.

          `absolute` + `pointer-events-none` na barra para que ela não roube o
          clique de nada que esteja embaixo; os elementos que importam
          recuperam o `pointer-events`. A legibilidade sobre qualquer foto vem
          do véu de cima que a própria capa desenha (em `Album.tsx`). */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-4 px-5 py-6 sm:px-8 lg:px-12">
        {/* Sempre a logo clara: ela fica sobre uma foto escurecida pelo véu,
            e não sobre o papel do tema. */}
        <Logo altura={26} className="marca-sobre-foto pointer-events-auto" />
        <span className="rotulo text-[rgb(255_255_255/0.78)]">galeria</span>
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
