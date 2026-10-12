import { useState } from 'react';
import { Marca } from './Bloco';
import { Botao } from './Botao';
import { haQuanto } from '../formato';
import { TIPO_ITEM } from '../rotulos';
import type { Decisao, EstadoAprovacao, TipoItem } from '../dados/tipos';

/**
 * O cartão de responder um item. Existe uma vez porque as regras dele são
 * regras, não layout: comentário obrigatório no ajuste, clique duplo que não
 * manda duas respostas, erro em português na própria linha.
 *
 * Dois lugares usam: o portal de quem tem conta e a página do link de quem não
 * tem. Quem responde é diferente nos dois — então quem responde vem por `fora`.
 */
export type Aberto = null | 'ajuste' | 'declinar';

export function ItemAprovavel({
  id,
  tipo,
  titulo,
  enviadoEm,
  estado,
  respondidoPor,
  comentario,
  responder,
}: {
  id: string;
  tipo: TipoItem;
  titulo: string;
  enviadoEm: string | null;
  /** Fora de `em_aprovacao` o cartão é leitura: mostra o que foi respondido. */
  estado?: EstadoAprovacao;
  respondidoPor?: string | null;
  comentario?: string | null;
  responder: (decisao: Decisao, texto?: string) => Promise<void>;
}) {
  const [aberto, setAberto] = useState<Aberto>(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const respondido = estado !== undefined && estado !== 'em_aprovacao';

  async function enviar(decisao: Decisao) {
    if (enviando) return; // Clique duplo não manda duas respostas.
    setEnviando(true);
    setErro(null);
    try {
      await responder(decisao, texto.trim() || undefined);
      setTexto('');
      setAberto(null);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui registrar a sua resposta.');
    } finally {
      setEnviando(false);
    }
  }

  const faltaTexto = aberto === 'ajuste' && texto.trim().length === 0;

  return (
    <li className={'bloco p-4 sm:p-5 ' + (respondido ? '' : 'erguer')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Marca>{TIPO_ITEM[tipo]}</Marca>
            {respondido ? (
              <Marca forte={estado === 'com_ajustes'}>
                {estado === 'aprovado' ? 'aprovado' : estado === 'com_ajustes' ? 'ajuste pedido' : 'declinado'}
              </Marca>
            ) : (
              <span className="rotulo">enviado {haQuanto(enviadoEm)}</span>
            )}
          </div>
          <h3 className="titulao mt-2 text-[clamp(1.1rem,3.5vw,1.5rem)]">{titulo}</h3>
        </div>
      </div>

      {/* O preview do conteúdo entra aqui quando a mídia estiver no Storage.
          Até lá, a tela não finge ter imagem: diz o que ainda não tem. */}
      {!respondido && (
        <div className="aurora mt-4 border border-dashed border-linha px-4 py-8 text-center">
          <span className="rotulo-forte rounded-full bg-superficie-2 px-3 py-1.5 text-tinta">
            prévia do material
          </span>
        </div>
      )}

      {respondido ? (
        <div className="mt-3">
          {respondidoPor && <div className="rotulo">por {respondidoPor}</div>}
          {comentario && <p className="mt-2 text-[14px]">“{comentario}”</p>}
        </div>
      ) : aberto === null ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Botao variante="primario" disabled={enviando} onClick={() => void enviar('aprovado')}>
            {enviando ? 'Enviando…' : 'Aprovar'}
          </Botao>
          <Botao disabled={enviando} onClick={() => setAberto('ajuste')}>
            Pedir ajuste
          </Botao>
          <Botao variante="texto" disabled={enviando} onClick={() => setAberto('declinar')}>
            Não vai usar
          </Botao>
        </div>
      ) : (
        <div className="mt-4 border-t border-linha-fraca pt-4">
          <label htmlFor={`texto-${id}`} className="rotulo-forte">
            {aberto === 'ajuste' ? 'o que mudar' : 'motivo (opcional)'}
          </label>
          <textarea
            id={`texto-${id}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            autoFocus
            placeholder={
              aberto === 'ajuste'
                ? 'Ex.: trocar a foto do primeiro quadro.'
                : 'Ex.: a promoção foi cancelada.'
            }
            className="mt-2 w-full resize-y rounded-[var(--raio-p)] border border-linha bg-superficie px-3 py-2 text-[14px] placeholder:text-tinta-3 focus:outline-none"
          />
          {aberto === 'ajuste' && <p className="rotulo mt-1.5">obrigatório</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Botao
              variante="primario"
              disabled={enviando || faltaTexto}
              onClick={() => void enviar(aberto === 'ajuste' ? 'com_ajustes' : 'declinado')}
            >
              {enviando ? 'Enviando…' : aberto === 'ajuste' ? 'Enviar o ajuste' : 'Confirmar'}
            </Botao>
            <Botao
              variante="texto"
              disabled={enviando}
              onClick={() => {
                setAberto(null);
                setTexto('');
                setErro(null);
              }}
            >
              Cancelar
            </Botao>
          </div>
        </div>
      )}

      {erro && (
        <div role="alert" className="bloco mt-4 bg-alerta-fundo px-3.5 py-2.5">
          <span className="rotulo-forte text-pink-texto">não deu certo</span>
          <p className="mt-1 text-[13.5px] font-medium">{erro}</p>
        </div>
      )}
    </li>
  );
}
