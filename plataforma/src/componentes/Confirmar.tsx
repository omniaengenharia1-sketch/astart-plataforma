import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Botao } from './Botao';

/**
 * O pop-up de confirmação — "igual tem em outros sites", nas palavras da dona.
 *
 * POR QUE ELE EXISTE
 *
 * A confirmação de tirar foto nasceu dentro da miniatura: uma faixa escrita
 * "tirar mesmo?". Ela respondeu: "agora fica esse tirar mesmo? e nao aparece
 * confirmacao" — e estava certa. Uma pergunta sem sim e sem não não é
 * confirmação, e ninguém adivinha que a própria faixa é o botão.
 *
 * A segunda tentativa pôs a pergunta embaixo da grade, com dois botões. Melhor,
 * mas ainda errado no telefone: numa galeria de oito fotos o painel nascia no
 * pixel 1191 de uma tela de 852. Tocar no "×" não mudava nada visível.
 *
 * Um pop-up acaba com a classe inteira de problemas: ele aparece no meio da
 * tela, ele impede o resto, e ele traz o sim e o não juntos. Não é falta de
 * criatividade — é a forma que já está no vocabulário de quem usa a internet.
 *
 * O QUE ELE FAZ ALÉM DE APARECER
 *
 *   · Esc cancela e clicar no fundo cancela — as duas saídas que todo mundo
 *     tenta sem pensar;
 *   · o foco entra no pop-up e volta para o botão que o abriu quando ele
 *     fecha, senão quem usa teclado fica perdido no meio da página;
 *   · o Tab circula DENTRO dele. Sem isso o teclado passeia pela página de
 *     trás com o pop-up aberto, e já não se sabe mais o que está em foco;
 *   · o botão que começa em foco é o de CANCELAR, não o de apagar. Um Enter
 *     distraído não pode apagar a foto de ninguém;
 *   · a página de trás não rola.
 *
 * Fora da árvore do React (`createPortal`): modal dentro da árvore depende de
 * nenhum ancestral ter `transform`, e essa é uma promessa que ninguém mantém.
 */
export function Confirmar({
  titulo,
  children,
  acao,
  aoConfirmar,
  aoCancelar,
  ocupado = false,
}: {
  /** A pergunta, curta. Vira o nome do diálogo para quem usa leitor de tela. */
  titulo: string;
  /** O que a pessoa precisa saber antes de decidir. */
  children: React.ReactNode;
  /** O texto do botão que faz a coisa. Diga o VERBO: "Tirar da galeria". */
  acao: string;
  aoConfirmar: () => void;
  aoCancelar: () => void;
  ocupado?: boolean;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  // Quem estava em foco antes: é para cá que o foco volta ao fechar.
  const antes = useRef<Element | null>(null);

  useEffect(() => {
    antes.current = document.activeElement;
    // O primeiro botão do pop-up é o Cancelar, e é nele que o foco começa —
    // procurado no DOM porque o `Botao` deste projeto não repassa `ref`, e
    // fazer ele repassar por causa de um pop-up mexeria em toda a plataforma.
    caixa.current?.querySelector<HTMLElement>('button')?.focus();

    const trancado = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        aoCancelar();
        return;
      }
      if (e.key !== 'Tab') return;
      // O Tab circula aqui dentro.
      const dentro = caixa.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!dentro || dentro.length === 0) return;
      const primeiro = dentro[0]!;
      const ultimo = dentro[dentro.length - 1]!;
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };

    document.addEventListener('keydown', tecla, true);
    return () => {
      document.removeEventListener('keydown', tecla, true);
      document.body.style.overflow = trancado;
      // `focus` num elemento que saiu da página não faz nada, e tudo bem.
      (antes.current as HTMLElement | null)?.focus?.();
    };
  }, [aoCancelar]);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-5"
      // Clique no fundo cancela. No `div` de fora, e conferindo que o clique
      // foi NELE: sem isso, soltar o mouse fora depois de selecionar um texto
      // dentro do pop-up fecharia o pop-up.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoCancelar();
      }}
    >
      <div aria-hidden className="absolute inset-0 bg-[rgb(3_3_8/0.62)] backdrop-blur-sm" />
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmar-titulo"
        className="bloco relative w-full max-w-sm p-5"
      >
        <h2 id="confirmar-titulo" className="text-[17px] font-bold">
          {titulo}
        </h2>
        <div className="mt-2 text-[13.5px] text-tinta-2">{children}</div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Botao variante="texto" onClick={aoCancelar} disabled={ocupado}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={aoConfirmar} disabled={ocupado}>
            {ocupado ? 'Um instante…' : acao}
          </Botao>
        </div>
      </div>
    </div>,
    document.body,
  );
}
