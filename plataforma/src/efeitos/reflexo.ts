/**
 * O reflexo que segue a mão sobre as lâminas de vidro.
 *
 * Um listener só, no documento, e no máximo uma escrita por quadro. A
 * alternativa — um onMouseMove por painel em React — colocaria dezenas de
 * handlers e um render por pixel de movimento.
 *
 * Escreve duas variáveis CSS no painel sob o ponteiro; quem desenha é o CSS.
 * Em telefone nada disso roda: sem ponteiro fino, o efeito não existe.
 */
export function ligarReflexo(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (!window.matchMedia('(pointer: fine)').matches) return () => {};
  if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return () => {};

  let alvo: HTMLElement | null = null;
  let x = 0;
  let y = 0;
  let agendado = false;

  const pintar = () => {
    agendado = false;
    if (!alvo) return;
    const r = alvo.getBoundingClientRect();
    alvo.style.setProperty('--mx', `${((x - r.left) / r.width) * 100}%`);
    alvo.style.setProperty('--my', `${((y - r.top) / r.height) * 100}%`);
  };

  const mover = (e: PointerEvent) => {
    const lamina = (e.target as Element | null)?.closest?.('.bloco') as HTMLElement | null;
    if (lamina !== alvo) {
      alvo?.style.removeProperty('--mx');
      alvo?.style.removeProperty('--my');
      alvo = lamina;
    }
    if (!alvo) return;
    x = e.clientX;
    y = e.clientY;
    if (!agendado) {
      agendado = true;
      requestAnimationFrame(pintar);
    }
  };

  document.addEventListener('pointermove', mover, { passive: true });
  return () => document.removeEventListener('pointermove', mover);
}
