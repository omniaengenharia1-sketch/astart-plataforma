import type { ReactNode } from 'react';
import { Botao } from './Botao';

/**
 * `principal` para quando este é o conteúdo da página inteira — tela de
 * carregamento do app, por exemplo. Sem isso a página fica sem `<main>` e sem
 * h1 enquanto carrega, e quem navega por marcos cai no vazio.
 */
export function Carregando({ oQue, principal }: { oQue: string; principal?: boolean }) {
  const corpo = (
    <p role="status" className="rotulo piscando px-5 py-20 text-center sm:px-8 lg:px-12">
      carregando {oQue}
    </p>
  );
  if (!principal) return corpo;
  return (
    <main id="conteudo">
      <h1 className="sr-only">Carregando {oQue}</h1>
      {corpo}
    </main>
  );
}

/** Falha nunca é silenciosa: o que quebrou, em português, e a ação. */
export function Falhou({
  mensagem,
  tentar,
  principal,
}: {
  mensagem: string;
  tentar?: () => void;
  principal?: boolean;
}) {
  const Caixa = principal ? 'main' : 'div';
  return (
    <Caixa
      {...(principal ? { id: 'conteudo' } : {})}
      role="alert"
      className="bloco brilho-p mx-5 my-10 bg-alerta-fundo p-5 sm:mx-8 lg:mx-12"
    >
      {principal && <h1 className="sr-only">Não deu certo</h1>}
      <div className="rotulo-forte text-pink-texto">não deu certo</div>
      <p className="mt-2 text-[15px] font-medium">{mensagem}</p>
      {tentar && (
        <Botao onClick={tentar} className="mt-4">
          Tentar de novo
        </Botao>
      )}
    </Caixa>
  );
}

/** O primeiro dia de cada tela: o que falta, e o botão que resolve. */
export function Vazio({ titulo, explica, acao }: { titulo: string; explica?: string; acao?: ReactNode }) {
  return (
    <div className="bloco mx-auto my-10 max-w-xl overflow-hidden text-center">
      <div className="aurora h-20" />
      <div className="px-6 py-9 sm:px-10">
        <div className="rotulo">nada por aqui ainda</div>
        <h2 className="titulao mt-3 text-[clamp(1.3rem,4vw,1.9rem)]">{titulo}</h2>
        {explica && <p className="mt-3 text-tinta-2">{explica}</p>}
        {acao && <div className="mt-6 flex flex-wrap justify-center gap-3">{acao}</div>}
      </div>
    </div>
  );
}
