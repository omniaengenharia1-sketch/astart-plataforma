import { useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Falhou, Vazio } from '../componentes/Estado';
import { responderItem } from '../dados/api';
import { haQuanto } from '../formato';
import { TIPO_ITEM } from '../rotulos';
import type { Decisao, ItemAprovacao } from '../dados/tipos';

/** Qual formulário está aberto num item. Fechado = só os três botões. */
type Aberto = null | 'ajuste' | 'declinar';

function Item({
  item,
  nome,
  aoResponder,
}: {
  item: ItemAprovacao;
  nome: string;
  aoResponder: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState<Aberto>(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function responder(decisao: Decisao) {
    if (enviando) return; // Clique duplo não manda duas respostas.
    setEnviando(true);
    setErro(null);
    try {
      await responderItem(item.id, decisao, nome, texto.trim() || undefined);
      setTexto('');
      setAberto(null);
      await aoResponder();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui registrar a sua resposta.');
    } finally {
      setEnviando(false);
    }
  }

  const faltaTexto = aberto === 'ajuste' && texto.trim().length === 0;

  return (
    <li className="bloco sombra-dura-p bg-superficie p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Marca>{TIPO_ITEM[item.tipo]}</Marca>
            <span className="rotulo">enviado {haQuanto(item.enviadoEm)}</span>
          </div>
          <h3 className="titulao mt-2 text-[clamp(1.1rem,3.5vw,1.5rem)]">{item.titulo}</h3>
        </div>
      </div>

      {/* O preview do conteúdo entra aqui quando a mídia estiver no Storage.
          Até lá, a tela não finge ter imagem: diz o que ainda não tem. */}
      <div className="mt-4 border-2 border-dashed border-linha-fraca px-4 py-8 text-center">
        <span className="rotulo">a prévia do material aparece aqui</span>
      </div>

      {aberto === null && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Botao variante="primario" disabled={enviando} onClick={() => void responder('aprovado')}>
            {enviando ? 'Enviando…' : 'Aprovar'}
          </Botao>
          <Botao disabled={enviando} onClick={() => setAberto('ajuste')}>
            Pedir ajuste
          </Botao>
          <Botao variante="texto" disabled={enviando} onClick={() => setAberto('declinar')}>
            Não vai usar
          </Botao>
        </div>
      )}

      {aberto !== null && (
        <div className="mt-4 border-t-2 border-linha pt-4">
          <label htmlFor={`texto-${item.id}`} className="rotulo-forte">
            {aberto === 'ajuste' ? 'o que precisa mudar' : 'por que não vai usar (opcional)'}
          </label>
          <textarea
            id={`texto-${item.id}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            autoFocus
            placeholder={
              aberto === 'ajuste'
                ? 'Ex.: trocar a foto do primeiro quadro, o produto saiu escuro.'
                : 'Ex.: a promoção foi cancelada.'
            }
            className="mt-2 w-full resize-y border-2 border-linha bg-superficie px-3 py-2 text-[14px] placeholder:text-tinta-3 focus:outline-none"
          />
          {aberto === 'ajuste' && (
            <p className="rotulo mt-1.5">
              sem isso a equipe não sabe o que refazer — por isso o campo é obrigatório
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Botao
              variante="primario"
              disabled={enviando || faltaTexto}
              onClick={() => void responder(aberto === 'ajuste' ? 'com_ajustes' : 'declinado')}
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
        <div role="alert" className="mt-4 border-2 border-linha bg-alerta-fundo px-3 py-2">
          <span className="rotulo-forte">não deu certo</span>
          <p className="mt-1 text-[13.5px] font-medium">{erro}</p>
        </div>
      )}
    </li>
  );
}

export function PortalAprovar({
  itens,
  nome,
  recarregar,
}: {
  itens: ItemAprovacao[];
  nome: string;
  recarregar: () => Promise<void>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [lote, setLote] = useState(false);
  const [erroLote, setErroLote] = useState<string | null>(null);

  async function aprovarTudo() {
    if (lote) return;
    setLote(true);
    setErroLote(null);
    try {
      // Uma por uma, em sequência. Se a terceira falhar, as duas primeiras
      // valem: a função do banco recusa responder item já respondido, então
      // repetir a ação não aprova nada duas vezes.
      for (const i of itens) {
        await responderItem(i.id, 'aprovado', nome);
      }
      setConfirmando(false);
      await recarregar();
    } catch (x) {
      setErroLote(x instanceof Error ? x.message : 'Não consegui aprovar tudo.');
      await recarregar();
    } finally {
      setLote(false);
    }
  }

  const n = itens.length;

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <div className="rotulo">o que a Astart mandou para você olhar</div>
        <h1 className="titulao mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">
          {n === 0 ? 'Nada esperando você.' : `${n} ${n === 1 ? 'item espera' : 'itens esperam'} você.`}
        </h1>
        {n > 0 && (
          <p className="mt-3 max-w-xl text-tinta-2">
            Aprove o que estiver bom. Se algo precisar mudar, escreva o que mudar — é isso que a
            equipe vai ler.
          </p>
        )}
      </div>

      {n === 0 ? (
        <Vazio
          titulo="Tudo respondido."
          explica="Quando a equipe mandar material novo, ele aparece aqui e você recebe aviso."
        />
      ) : (
        <>
          <div className="mt-7 grid grid-cols-3 gap-4">
            <Bloco rotulo="Esperando você" destaque={String(n)} alerta sombra />
            <Bloco
              rotulo="Peças"
              destaque={String(itens.filter((i) => i.tipo === 'peca').length)}
            />
            <Bloco
              rotulo="Entregáveis"
              destaque={String(itens.filter((i) => i.tipo === 'entregavel').length)}
            />
          </div>

          {n > 1 && (
            <div className="mt-7 flex flex-wrap items-center gap-3">
              {confirmando ? (
                <>
                  <span className="rotulo-forte">aprovar {n} itens de uma vez?</span>
                  <Botao variante="primario" disabled={lote} onClick={() => void aprovarTudo()}>
                    {lote ? 'Aprovando…' : `Sim, aprovar ${n}`}
                  </Botao>
                  <Botao variante="texto" disabled={lote} onClick={() => setConfirmando(false)}>
                    Deixa, vou ver um por um
                  </Botao>
                </>
              ) : (
                <Botao onClick={() => setConfirmando(true)}>Aprovar todos de uma vez</Botao>
              )}
            </div>
          )}

          {erroLote && <Falhou mensagem={erroLote} />}

          <div className="mt-8">
            <Fita>Um por um</Fita>
          </div>
          <ul className="mt-4 grid gap-5 xl:grid-cols-2">
            {itens.map((i) => (
              <Item key={i.id} item={i} nome={nome} aoResponder={recarregar} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
