import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { filaAprovacoes } from '../dados/api';
import { haQuanto } from '../formato';
import { TIPO_ITEM } from '../rotulos';
import type { ItemNaFila } from '../dados/tipos';

function Linha({ item, aoAbrir }: { item: ItemNaFila; aoAbrir: () => void }) {
  const ajuste = item.estado === 'com_ajustes';
  return (
    <li
      className={
        'border-b border-linha-fraca px-3 py-3.5 ' +
        (ajuste ? 'border-l-2 border-l-pink' : '')
      }
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-bold uppercase">{item.clienteNome}</span>
            <Marca>{TIPO_ITEM[item.tipo]}</Marca>
            <span className="rotulo">
              {ajuste ? haQuanto(item.respondidoEm) : `enviado ${haQuanto(item.enviadoEm)}`}
            </span>
          </div>
          <p className="mt-1 font-medium">{item.titulo}</p>
        </div>
        <Botao tamanho="pequeno" className="shrink-0" onClick={aoAbrir}>
          Abrir
        </Botao>
      </div>

      {/* O comentário é o que diz o que fazer. Fica na fila, não atrás de um
          clique: a equipe precisa decidir a ordem do dia olhando a lista. */}
      {ajuste && item.comentario && (
        <blockquote className="mt-2.5 rounded-[var(--raio-p)] border-l-2 border-pink bg-superficie-2 px-3.5 py-2.5 text-[13px]">
          <span className="rotulo">{item.respondidoPor ?? 'o cliente'} escreveu</span>
          <p className="mt-1">{item.comentario}</p>
        </blockquote>
      )}
    </li>
  );
}

export function Aprovacoes() {
  const [fila, setFila] = useState<ItemNaFila[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cliente, setCliente] = useState('');
  const navegar = useNavigate();

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setFila(await filaAprovacoes());
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui carregar a fila.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const clientes = useMemo(
    () => [...new Set((fila ?? []).map((i) => i.clienteNome))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [fila],
  );

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!fila) return <Carregando oQue="a fila de aprovações" />;

  const filtrada = cliente ? fila.filter((i) => i.clienteNome === cliente) : fila;
  const ajustes = filtrada.filter((i) => i.estado === 'com_ajustes');
  const esperando = filtrada.filter((i) => i.estado === 'em_aprovacao');

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <div className="rotulo">fila única</div>
        <h1 className="titulao mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">
          {ajustes.length === 0
            ? 'Nada na sua mão.'
            : `${ajustes.length} ${ajustes.length === 1 ? 'volta' : 'voltas'} para refazer.`}
        </h1>
      </div>

      <div className="escada mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Bloco
          rotulo="Precisa de você"
          destaque={String(ajustes.length)}
          alerta={ajustes.length > 0}
          sombra={ajustes.length > 0}
        />
        <Bloco rotulo="Esperando o cliente" destaque={String(esperando.length)} />
        <Bloco rotulo="Clientes na fila" destaque={String(clientes.length)} />
        <Bloco rotulo="Na fila agora" destaque={String(filtrada.length)} />
      </div>

      {clientes.length > 1 && (
        <div className="mt-7 flex flex-wrap items-center gap-2">
          <span className="rotulo mr-1">cliente</span>
          <Botao
            tamanho="pequeno"
            variante={cliente === '' ? 'primario' : 'secundario'}
            onClick={() => setCliente('')}
          >
            Todos
          </Botao>
          {clientes.map((c) => (
            <Botao
              key={c}
              tamanho="pequeno"
              variante={cliente === c ? 'primario' : 'secundario'}
              onClick={() => setCliente(c)}
            >
              {c}
            </Botao>
          ))}
        </div>
      )}

      {filtrada.length === 0 ? (
        <Vazio
          titulo="Fila vazia."
          explica="Nada esperando resposta."
        />
      ) : (
        <div className="mt-8 grid items-start gap-9 xl:grid-cols-2">
          <section>
            <Fita>Precisa de você</Fita>
            {ajustes.length === 0 ? (
              <p className="py-4 text-tinta-3">Nada voltou com ajuste.</p>
            ) : (
              <ul className="border-t border-linha-fraca">
                {ajustes.map((i) => (
                  <Linha key={i.id} item={i} aoAbrir={() => navegar(`/clientes/${i.clienteId}`)} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <Fita>Esperando o cliente</Fita>
            {esperando.length === 0 ? (
              <p className="py-4 text-tinta-3">Nada enviado sem resposta.</p>
            ) : (
              <ul className="border-t border-linha-fraca">
                {esperando.map((i) => (
                  <Linha key={i.id} item={i} aoAbrir={() => navegar(`/clientes/${i.clienteId}`)} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
