import type { ReactNode } from 'react';
import { Botao } from './Botao';

export function Carregando({ oQue }: { oQue: string }) {
  return (
    <p role="status" className="rotulo piscando px-5 py-20 text-center sm:px-8 lg:px-12">
      carregando {oQue}
    </p>
  );
}

/** Falha nunca é silenciosa: o que quebrou, em português, e a ação. */
export function Falhou({ mensagem, tentar }: { mensagem: string; tentar?: () => void }) {
  return (
    <div
      role="alert"
      className="bloco sombra-dura mx-5 my-10 border-4 bg-alerta-fundo p-5 sm:mx-8 lg:mx-12"
    >
      <div className="rotulo-forte">não deu certo</div>
      <p className="mt-2 text-[15px] font-medium">{mensagem}</p>
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
    <div className="bloco sombra-dura mx-auto my-10 max-w-xl border-4 bg-superficie text-center">
      <div className="hachura h-5 border-b-2 border-linha" />
      <div className="px-6 py-10 sm:px-10">
        <div className="rotulo">nada por aqui ainda</div>
        <h2 className="titulao mt-3 text-[clamp(1.3rem,4vw,1.9rem)]">{titulo}</h2>
        {explica && <p className="mt-3 text-tinta-2">{explica}</p>}
        {acao && <div className="mt-6 flex flex-wrap justify-center gap-3">{acao}</div>}
      </div>
    </div>
  );
}
