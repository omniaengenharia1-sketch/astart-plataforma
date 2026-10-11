import type { ReactNode } from 'react';
import { Botao } from './Botao';

export function Carregando({ oQue }: { oQue: string }) {
  return (
    <p role="status" className="rotulo px-5 py-16 text-center sm:px-8 lg:px-12">
      carregando {oQue}…
    </p>
  );
}

/**
 * Falha nunca é silenciosa: diz o que quebrou, em português, e oferece a ação.
 */
export function Falhou({ mensagem, tentar }: { mensagem: string; tentar?: () => void }) {
  return (
    <div className="mx-5 my-10 border-2 border-falha bg-falha-suave p-6 sm:mx-8 lg:mx-12" role="alert">
      <div className="rotulo text-falha">não deu certo</div>
      <p className="mt-2 text-[14px]">{mensagem}</p>
      {tentar && (
        <Botao onClick={tentar} className="mt-4">
          Tentar de novo
        </Botao>
      )}
    </div>
  );
}

/** O primeiro dia de cada tela: o que falta, e o botão que resolve. */
export function Vazio({ titulo, explica, acao }: { titulo: string; explica?: string; acao?: ReactNode }) {
  return (
    <div className="mx-auto my-10 max-w-xl border-2 border-tinta bg-superficie px-8 py-12 text-center">
      <div className="rotulo">nada por aqui ainda</div>
      <h2 className="font-display mt-3 text-2xl font-semibold tracking-tight">{titulo}</h2>
      {explica && <p className="mt-2 text-tinta-2">{explica}</p>}
      {acao && <div className="mt-6 flex flex-wrap justify-center gap-3">{acao}</div>}
    </div>
  );
}
