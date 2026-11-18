/**
 * "A tela não tem o botão que você disse que tinha."
 *
 * A dona abriu o Comercial e não achou o "+ Novo lead". O código estava
 * certo, o roteiro de navegador provava que o botão existe, e o endereço de
 * produção servia o arquivo novo. O que ela via era um arquivo VELHO, guardado
 * pelo navegador dela de uma visita anterior.
 *
 * Os cabeçalhos já estão certos (`max-age=0, must-revalidate` no `index.html`),
 * e mesmo assim acontece: aba aberta há horas não recarrega sozinha, e o
 * Safari é generoso com o cache de memória. Esta plataforma é feita para ficar
 * aberta o dia todo — então a aba velha não é exceção, é o estado normal.
 *
 * E o custo não é só não ver um botão. Uma aba velha conversa com um banco que
 * já mudou: ela pode chamar uma função que não existe mais, ou deixar de
 * mandar um campo que agora é obrigatório. O erro que aparece disso não fala
 * de versão nenhuma — fala de coluna, de permissão, de nada.
 *
 * COMO SE DESCOBRE, SEM INVENTAR NADA NOVO
 *
 * O Vite já põe um hash do conteúdo no nome do arquivo: `index-DMgvrni4.js`.
 * Nome diferente = código diferente. Então basta comparar o nome que ESTA aba
 * carregou com o que o servidor entrega agora.
 *
 * Quando pergunta: ao voltar para a aba, e de hora em hora. Não a cada
 * clique — isso seria uma chamada de rede por navegação para resolver uma
 * coisa que muda uma vez por dia.
 *
 * O QUE ELE NÃO FAZ: recarregar sozinho. Recarga automática no meio de uma
 * legenda que a pessoa está escrevendo perde o texto dela. Quem decide a hora
 * é ela; a tela só para de mentir que está atualizada.
 */
import { useEffect, useState } from 'react';

/** De hora em hora. O gatilho que importa é o foco; isto é a rede de baixo. */
const DE_QUANTO_EM_QUANTO = 60 * 60 * 1000;

/** O nome do arquivo de código que ESTA aba carregou. */
function bundleDaAbaAtual(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return s?.getAttribute('src') ?? null;
}

function bundleDoHtml(html: string): string | null {
  // Sem DOMParser de propósito: parsear HTML de fora para ler UM atributo é
  // trabalho e superfície a mais. O que se procura é um nome de arquivo.
  return /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1] ?? null;
}

export function AvisoDeVersao() {
  const [velha, setVelha] = useState(false);

  useEffect(() => {
    const meu = bundleDaAbaAtual();
    // Em desenvolvimento o Vite serve o módulo direto, sem hash: não há o que
    // comparar, e piscar um aviso a cada salvamento seria barulho.
    if (!meu || !meu.includes('/assets/')) return;

    let vivo = true;

    async function conferir() {
      if (!vivo || velha) return;
      try {
        // `no-store` porque perguntar ao cache se o cache está velho não
        // responde nada.
        const r = await fetch('/', { cache: 'no-store' });
        if (!r.ok) return;
        const servido = bundleDoHtml(await r.text());
        // Só acende com os dois nomes em mãos. Resposta estranha — um portal
        // de wifi, uma página de erro — não vira aviso de versão.
        if (vivo && servido && servido !== meu) setVelha(true);
      } catch {
        // Sem rede não se sabe de nada, e "não sei" não é "está velha".
      }
    }

    const aoFocar = () => void conferir();
    window.addEventListener('focus', aoFocar);
    const relogio = window.setInterval(() => void conferir(), DE_QUANTO_EM_QUANTO);
    void conferir();

    return () => {
      vivo = false;
      window.removeEventListener('focus', aoFocar);
      window.clearInterval(relogio);
    };
  }, [velha]);

  if (!velha) return null;

  return (
    <div
      role="status"
      className="vidro-chapa sticky top-0 z-40 flex flex-wrap items-center gap-x-3 gap-y-2
 border-b border-linha bg-alerta-fundo px-5 py-2.5 sm:px-8 lg:px-12"
    >
      <span className="text-[13.5px] font-bold">Saiu uma versão nova da plataforma.</span>
      <span className="legenda flex-1">
        Esta aba está com a anterior — pode faltar coisa que já existe.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="min-h-9 rounded-full border border-linha bg-superficie px-4 text-[13px]
 font-semibold text-tinta hover:text-pink-texto"
      >
        Recarregar
      </button>
    </div>
  );
}
