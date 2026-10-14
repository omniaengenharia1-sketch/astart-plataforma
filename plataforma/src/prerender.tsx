/**
 * As três páginas públicas, geradas como HTML de verdade.
 *
 * Isto existe por um defeito achado conferindo a própria homologação. As três
 * URLs respondiam 200 e pareciam prontas:
 *
 *   https://astart-plataforma.pages.dev/privacidade   200
 *
 * Mas o corpo eram 1.115 bytes de casca e **19 caracteres de texto** — só o
 * `<title>`. O resto é React, e React precisa de JavaScript. Quem abre no
 * navegador vê a política inteira; quem BUSCA a URL vê uma página em branco.
 *
 * E quem busca a URL é justamente quem decide: a checagem automática da Meta no
 * App Review, qualquer robô, qualquer arquivo. "Política de privacidade vazia"
 * é um dos motivos mais citados de reprovação, e aqui a política existe — ela
 * só não estava no arquivo que o revisor recebe.
 *
 * É a mesma armadilha do resto do projeto, mais uma vez: a verificação (abrir
 * no navegador) era menos exigente que a realidade (um GET sem JavaScript).
 *
 * As três páginas são componentes puros — sem estado, sem `window`, sem rota —
 * então dá para renderizá-las em texto no build e escrever três arquivos
 * estáticos. O JavaScript continua carregando por cima; a diferença é que agora
 * o conteúdo chega mesmo sem ele.
 *
 * Quem chama isto é o `prerender.mjs`, depois do `vite build`.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { ExclusaoDeDados, Privacidade, Termos } from './paginas/Politicas';

export interface PaginaPronta {
  /**
   * Vira `dist/<caminho>.html`, servido em `/<caminho>`.
   *
   * Arquivo solto, não `<caminho>/index.html`: o Pages serve arquivo solto SEM
   * barra no fim e índice de pasta COM barra (`html_handling` é
   * `auto-trailing-slash` por padrão). Como as três URLs já estão escritas sem
   * barra no `docs/homologacao-meta.md` e vão para o painel da Meta, arquivo
   * solto entrega a página direto, sem um 301 no meio.
   */
  caminho: string;
  titulo: string;
  descricao: string;
  html: string;
  /** Uma frase que TEM de aparecer no arquivo escrito. O prover cobra. */
  prova: string;
}

export function paginas(): PaginaPronta[] {
  return [
    {
      caminho: 'privacidade',
      titulo: 'Política de privacidade — Astart Studio',
      descricao:
        'Quais dados a plataforma interna da Astart Studio guarda, por quanto tempo, ' +
        'com quem compartilha e como o titular pede acesso ou exclusão.',
      html: renderToStaticMarkup(<Privacidade />),
      prova: 'Política de privacidade',
    },
    {
      caminho: 'termos',
      titulo: 'Termos de uso — Astart Studio',
      descricao:
        'Condições de uso da plataforma interna da Astart Studio: quem pode entrar, ' +
        'o que a agência faz em nome do cliente e os limites do serviço.',
      html: renderToStaticMarkup(<Termos />),
      prova: 'Termos de uso',
    },
    {
      caminho: 'exclusao-de-dados',
      titulo: 'Exclusão de dados — Astart Studio',
      descricao:
        'Como pedir a exclusão dos dados guardados pela plataforma interna da Astart ' +
        'Studio, o que é apagado e em quanto tempo.',
      html: renderToStaticMarkup(<ExclusaoDeDados />),
      prova: 'Exclusão de dados',
    },
  ];
}
