import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Entrada } from '../componentes/Campo';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { enviarParaAprovacao, itemDoEntregavel, projetoDoCliente } from '../dados/api';
import { diaMes, haQuanto, plural } from '../formato';
import { ESTADO, ESTADO_CLIENTE } from '../rotulos';
import type { EntregavelNoProjeto, EstadoEntregavel, ServicoNoProjeto } from '../dados/tipos';

/** O que ainda pode ir para o cliente. Aprovado não reenvia; esperando, também não. */
const ENVIAVEL: EstadoEntregavel[] = ['a_fazer', 'produzindo', 'com_ajustes', 'declinado'];

function fases(entregaveis: EntregavelNoProjeto[]): [string, EntregavelNoProjeto[]][] {
  const mapa = new Map<string, EntregavelNoProjeto[]>();
  for (const e of entregaveis) {
    const lista = mapa.get(e.fase);
    if (lista) lista.push(e);
    else mapa.set(e.fase, [e]);
  }
  return [...mapa.entries()];
}

function Barra({ feitos, total }: { feitos: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-3 flex-1 border border-linha">
        <div
          className="h-full bg-pink"
          style={{ width: `${total === 0 ? 0 : Math.round((feitos / total) * 100)}%` }}
        />
      </div>
      <span className="numeros text-[12px] whitespace-nowrap">
        {feitos}/{total}
      </span>
    </div>
  );
}

function Linha({
  e,
  equipe,
  marcado,
  aoMarcar,
}: {
  e: EntregavelNoProjeto;
  equipe: boolean;
  marcado: boolean;
  aoMarcar: (v: boolean) => void;
}) {
  const podeEnviar = equipe && ENVIAVEL.includes(e.estado);
  const ajuste = e.estado === 'com_ajustes';

  return (
    <li
      className={
        'flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-3 py-3 ' +
        (ajuste ? 'border-l-2 border-l-pink' : '')
      }
    >
      {equipe && (
        <input
          type="checkbox"
          checked={marcado}
          disabled={!podeEnviar}
          onChange={(ev) => aoMarcar(ev.target.checked)}
          aria-label={`Enviar ${e.titulo}`}
          className="size-5 shrink-0 cursor-pointer accent-[var(--pink)] disabled:cursor-default disabled:opacity-25"
        />
      )}
      <span className="min-w-48 flex-1 font-medium">{e.titulo}</span>
      <Marca forte={ajuste}>{(equipe ? ESTADO : ESTADO_CLIENTE)[e.estado]}</Marca>
      {e.versaoAtual !== null && <span className="rotulo">v{e.versaoAtual}</span>}
      {equipe && <span className="rotulo w-24 shrink-0">{e.responsavelNome ?? '—'}</span>}
      <span className="rotulo w-24 shrink-0">
        {e.respondidoEm
          ? haQuanto(e.respondidoEm)
          : e.enviadoEm
            ? `enviado ${haQuanto(e.enviadoEm)}`
            : e.prazo
              ? `prazo ${diaMes(e.prazo)}`
              : ''}
      </span>
    </li>
  );
}

export function Projeto({ clienteId, equipe }: { clienteId: string; equipe: boolean }) {
  const [servicos, setServicos] = useState<ServicoNoProjeto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setServicos(await projetoDoCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir o projeto.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const todos = useMemo(() => (servicos ?? []).flatMap((s) => s.entregaveis), [servicos]);

  async function enviar() {
    if (enviando || marcados.length === 0) return; // Clique duplo não envia duas vezes.
    setEnviando(true);
    setErroEnvio(null);
    setRecado(null);
    try {
      // O item nasce aqui para quem ainda estava "a fazer": é a hora em que o
      // trabalho de fato saiu da mesa.
      const itens: string[] = [];
      for (const id of marcados) itens.push(await itemDoEntregavel(id));
      const n = await enviarParaAprovacao(itens, mensagem);
      setMarcados([]);
      setMensagem('');
      setRecado(`${plural(n, 'item foi', 'itens foram')} para o cliente.`);
      await carregar();
    } catch (x) {
      setErroEnvio(x instanceof Error ? x.message : 'Não consegui enviar.');
      await carregar();
    } finally {
      setEnviando(false);
    }
  }

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!servicos) return <Carregando oQue="o projeto" />;

  if (servicos.length === 0) {
    return (
      <Vazio
        titulo="Sem projeto aqui."
        explica={
          equipe
            ? 'Este cliente não contratou serviço com entregáveis. É o contrato que liga esta aba.'
            : 'Quando um projeto começar, as etapas aparecem aqui.'
        }
      />
    );
  }

  const aprovados = todos.filter((e) => e.estado === 'aprovado').length;

  return (
    // A barra de envio cola no rodape; sem esta folga a ultima etapa fica
    // escondida atras dela quando a pagina chega no fim.
    <div className={'pt-7 ' + (equipe && marcados.length > 0 ? 'pb-24' : '')}>
      <div className="escada grid gap-4 sm:grid-cols-3">
        <Bloco rotulo="Etapas" destaque={String(todos.length)} />
        <Bloco rotulo="Aprovadas" destaque={String(aprovados)} />
        <Bloco
          rotulo={equipe ? 'Esperando o cliente' : 'Esperando você'}
          destaque={String(todos.filter((e) => e.estado === 'em_aprovacao').length)}
          alerta={!equipe && todos.some((e) => e.estado === 'em_aprovacao')}
        />
      </div>

      {servicos.map((s) => {
        const feitos = s.entregaveis.filter((e) => e.estado === 'aprovado').length;
        return (
          <section key={s.clienteServicoId} className="mt-8">
            <Fita>
              {s.servicoNome}
              {s.entregaEm ? ` · entrega ${diaMes(s.entregaEm)}` : ''}
            </Fita>
            <div className="mt-3 max-w-md">
              <Barra feitos={feitos} total={s.entregaveis.length} />
            </div>

            {fases(s.entregaveis).map(([fase, lista]) => (
              <div key={fase} className="mt-5">
                <div className="rotulo-forte mb-1.5">{fase}</div>
                <ul className="border-t border-linha-fraca">
                  {lista.map((e) => (
                    <Linha
                      key={e.id}
                      e={e}
                      equipe={equipe}
                      marcado={marcados.includes(e.id)}
                      aoMarcar={(v) =>
                        setMarcados((a) => (v ? [...a, e.id] : a.filter((x) => x !== e.id)))
                      }
                    />
                  ))}
                </ul>
              </div>
            ))}

            {s.marcos.length > 0 && (
              <div className="mt-5">
                <div className="rotulo-forte mb-1.5">Datas</div>
                <ul>
                  {s.marcos.map((m) => (
                    <li key={m.id} className="flex items-baseline gap-3 border-b border-linha-fraca py-2.5">
                      <span className="numeros w-14 shrink-0 text-[12.5px]">{diaMes(m.prazo)}</span>
                      <span className="flex-1">{m.titulo}</span>
                      {m.concluidoEm && <Marca>feito</Marca>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}

      {recado && (
        <p role="status" className="rotulo-forte mt-6">
          {recado}
        </p>
      )}
      {erroEnvio && <Falhou mensagem={erroEnvio} />}

      {/* A barra de envio só existe quando há o que enviar. Ela cola no rodapé
          no celular, que é onde o polegar está. */}
      {equipe && marcados.length > 0 && (
        <div className="vidro-chapa sticky bottom-0 z-10 mt-8 border-t border-linha px-1 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rotulo-forte">
              {plural(marcados.length, 'etapa marcada', 'etapas marcadas')}
            </span>
            <Entrada
              value={mensagem}
              onChange={(ev) => setMensagem(ev.target.value)}
              placeholder="Recado para o cliente (opcional)"
              aria-label="Recado para o cliente"
              className="max-w-80 flex-1"
            />
            <Botao variante="primario" disabled={enviando} onClick={() => void enviar()}>
              {enviando ? 'Enviando…' : 'Enviar para aprovação'}
            </Botao>
            <Botao variante="texto" disabled={enviando} onClick={() => setMarcados([])}>
              Limpar
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}
