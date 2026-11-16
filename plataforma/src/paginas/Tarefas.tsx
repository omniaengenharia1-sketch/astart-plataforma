/**
 * O quadro de tarefas — o kanban que a dona pediu.
 *
 * "tipo um kanban estilo trello que a gente colocaria o que tem pra fazer, ai
 * podemos organizar por semana, mes, tarefa... e que a gente possa conectar
 * com outra pessoa, por exemplo: fazer criativo - responsavel: raquel".
 *
 * TRES COISAS QUE ESTA TELA DECIDE, E POR QUE
 *
 * 1. O FILTRO DE PERIODO NAO E UM QUADRO POR SEMANA. É o mesmo quadro, com os
 *    cartoes do periodo. Quadro por semana cria tarefa orfa toda segunda: o
 *    que nao foi feito fica no quadro da semana passada, que ninguem abre.
 *
 * 2. ARRASTAR USA O HTML, NAO UMA BIBLIOTECA. `draggable` nativo resolve o
 *    gesto no computador em vinte linhas. No celular, onde `draggable` nao
 *    existe, o cartao tem um seletor de coluna — gesto que nao funciona no
 *    telefone e pior que botao que funciona, e a dona trabalha do telefone.
 *
 * 3. QUEM RENUMERA É O BANCO. A tela manda "este cartao, nesta coluna, nesta
 *    posicao" e recarrega. Duas pessoas arrastando ao mesmo tempo com a tela
 *    decidindo os numeros dariam duas ordens diferentes para o mesmo quadro.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada, Escolha } from '../componentes/Campo';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { Fita, Marca } from '../componentes/Bloco';
import {
  apagarColunaDeTarefa, apagarTarefa, criarColunaDeTarefa, criarTarefa, editarTarefa,
  equipeEConvites, listaClientes, mencionarNaTarefa, moverTarefa, quadroDeTarefas,
  renomearColunaDeTarefa, tirarMencaoDaTarefa,
} from '../dados/api';
import { useSessao } from '../sessao';
import { diaMes } from '../formato';
import type {
  ClienteNaLista, ColunaDeTarefa, PessoaDaEquipe, QuadroDeTarefas, Tarefa,
} from '../dados/tipos';

type Periodo = 'semana' | 'mes' | 'tudo';

/** Segunda a domingo da semana corrente, e o mes corrente inteiro. */
function janela(p: Periodo): { de: string | null; ate: string | null } {
  if (p === 'tudo') return { de: null, ate: null };
  const hoje = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (p === 'mes') {
    const de = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const ate = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    return { de: iso(de), ate: iso(ate) };
  }
  // Semana que começa na segunda: domingo é 0 em JavaScript, e tratar domingo
  // como início da semana põe o fim de semana no começo da lista.
  const diaSemana = (hoje.getDay() + 6) % 7;
  const de = new Date(hoje);
  de.setDate(hoje.getDate() - diaSemana);
  const ate = new Date(de);
  ate.setDate(de.getDate() + 6);
  return { de: iso(de), ate: iso(ate) };
}

/** Vermelho só quando passou do prazo e não está feita. Antes disso é ruído. */
function urgencia(t: Tarefa): 'atrasada' | 'hoje' | null {
  if (!t.prazo || t.concluidoEm) return null;
  const hoje = new Date().toISOString().slice(0, 10);
  if (t.prazo < hoje) return 'atrasada';
  if (t.prazo === hoje) return 'hoje';
  return null;
}

function Cartao({
  t, colunas, equipe, aoMover, aoAbrir,
}: {
  t: Tarefa;
  colunas: ColunaDeTarefa[];
  equipe: PessoaDaEquipe[];
  aoMover: (colunaId: string) => void;
  aoAbrir: () => void;
}) {
  const estado = urgencia(t);
  return (
    <article
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
      className={
        'bloco cursor-pointer p-3 transition-shadow hover:shadow-lg ' +
        (estado === 'atrasada' ? 'border-pink' : '')
      }
      onClick={aoAbrir}
    >
      <p className="text-[14.5px] leading-snug font-bold text-tinta">{t.titulo}</p>

      {t.cliente && <p className="rotulo mt-1.5 normal-case">{t.cliente}</p>}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {t.responsavel && <Marca forte>{t.responsavel}</Marca>}
        {t.prazo && (
          <Marca forte={estado === 'atrasada'}>
            {estado === 'atrasada' ? 'atrasada · ' : ''}
            {diaMes(t.prazo)}
          </Marca>
        )}
        {t.mencionados.map((m) => (
          <Marca key={m.id}>@{m.nome}</Marca>
        ))}
      </div>

      {/* NO CELULAR não há arrastar. Este seletor é o mesmo gesto em forma de
          botão — e é por ele que a dona vai mover, porque ela trabalha do
          telefone. No computador ele some: lá o arrastar funciona. */}
      <label className="mt-2.5 block sm:hidden" onClick={(e) => e.stopPropagation()}>
        <span className="sr-only">Mover {t.titulo} de coluna</span>
        <select
          value={t.colunaId}
          aria-label={`Mover ${t.titulo}`}
          onChange={(e) => aoMover(e.target.value)}
          className="min-h-11 w-full border border-linha-fraca bg-superficie-2 px-2 text-[13px] text-tinta"
        >
          {colunas.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
      </label>

      {equipe.length === 0 && null}
    </article>
  );
}

export function Tarefas() {
  const { sessao } = useSessao();
  const euSou = sessao.tipo === 'equipe' ? sessao.perfil.nome : '';

  const [quadro, setQuadro] = useState<QuadroDeTarefas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>('tudo');

  const [equipe, setEquipe] = useState<PessoaDaEquipe[]>([]);
  const [clientes, setClientes] = useState<ClienteNaLista[]>([]);

  const [novoTitulo, setNovoTitulo] = useState('');
  const [novoResp, setNovoResp] = useState('');
  const [novoCliente, setNovoCliente] = useState('');
  const [novoPrazo, setNovoPrazo] = useState('');
  const [criando, setCriando] = useState(false);
  /**
   * O formulário começa FECHADO.
   *
   * Aberto, ele ocupa a primeira tela inteira do celular e empurra o quadro
   * para baixo da dobra — quem abre o app para ver o que tem pra fazer rola
   * um formulário antes de ver qualquer tarefa. O quadro é o que se olha
   * dez vezes por dia; criar tarefa é o que se faz uma.
   */
  const [abrindoForm, setAbrindoForm] = useState(false);

  const [aberta, setAberta] = useState<Tarefa | null>(null);
  const [novaColuna, setNovaColuna] = useState('');

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const { de, ate } = janela(periodo);
      setQuadro(await quadroDeTarefas(de, ate));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui carregar o quadro.');
    }
  }, [periodo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Equipe e clientes uma vez só: alimentam os seletores, não mudam a cada
  // troca de filtro.
  useEffect(() => {
    void (async () => {
      try {
        const e = await equipeEConvites();
        setEquipe(e.pessoas.filter((p) => p.ativo));
      } catch { /* sem equipe o seletor fica vazio; o quadro continua de pé */ }
      try {
        setClientes(await listaClientes());
      } catch { /* idem */ }
    })();
  }, []);

  const porColuna = useMemo(() => {
    const m = new Map<string, Tarefa[]>();
    for (const c of quadro?.colunas ?? []) m.set(c.id, []);
    for (const t of quadro?.tarefas ?? []) {
      const lista = m.get(t.colunaId);
      if (lista) lista.push(t);
    }
    return m;
  }, [quadro]);

  async function criar() {
    if (criando || !novoTitulo.trim()) return;
    setCriando(true);
    setErro(null);
    try {
      await criarTarefa({
        titulo: novoTitulo.trim(),
        responsavelId: novoResp || null,
        clienteId: novoCliente || null,
        prazo: novoPrazo || null,
      });
      const quem = equipe.find((p) => p.userId === novoResp)?.nome ?? null;
      setRecado(
        quem && quem !== euSou
          ? `Tarefa criada para ${quem}. O aviso ficou registrado e sai quando o e-mail estiver ligado.`
          : 'Tarefa criada.',
      );
      setNovoTitulo(''); setNovoResp(''); setNovoCliente(''); setNovoPrazo('');
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui criar a tarefa.');
    } finally {
      setCriando(false);
    }
  }

  async function mover(id: string, colunaId: string, para?: number) {
    setErro(null);
    try {
      await moverTarefa(id, colunaId, para);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui mover.');
    }
  }

  async function mexerNaColuna(fn: () => Promise<unknown>, oQue: string) {
    setErro(null);
    try {
      await fn();
      setRecado(oQue);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui mexer na coluna.');
    }
  }

  if (erro && !quadro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!quadro) return <Carregando oQue="o quadro" />;

  return (
    <div className="pt-7">
      {/* ---- criar ------------------------------------------------------ */}
      <section className="bloco mb-6 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <Fita>Nova tarefa</Fita>
          <Botao
            tamanho="pequeno"
            variante="texto"
            aria-expanded={abrindoForm}
            onClick={() => setAbrindoForm((v) => !v)}
          >
            {abrindoForm ? 'Fechar' : '+ Nova tarefa'}
          </Botao>
        </div>

        {abrindoForm && (
        <>
        <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <Campo id="t-titulo" rotulo="O que tem pra fazer">
            <Entrada
              id="t-titulo"
              value={novoTitulo}
              placeholder="Fazer criativo"
              onChange={(e) => setNovoTitulo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void criar(); }}
            />
          </Campo>

          <Campo id="t-resp" rotulo="Responsável" dica="quem recebe o aviso">
            <Escolha id="t-resp" value={novoResp} onChange={(e) => setNovoResp(e.target.value)}>
              <option value="">— ninguém ainda</option>
              {equipe.map((p) => (
                <option key={p.userId} value={p.userId}>{p.nome ?? p.email}</option>
              ))}
            </Escolha>
          </Campo>

          <Campo id="t-cliente" rotulo="Cliente">
            <Escolha id="t-cliente" value={novoCliente} onChange={(e) => setNovoCliente(e.target.value)}>
              <option value="">— nenhum</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </Escolha>
          </Campo>

          <Campo id="t-prazo" rotulo="Prazo">
            <Entrada id="t-prazo" type="date" value={novoPrazo}
              onChange={(e) => setNovoPrazo(e.target.value)} />
          </Campo>
        </div>
        <div className="mt-3">
          <Botao variante="primario" disabled={criando || !novoTitulo.trim()}
            onClick={() => void criar()}>
            {criando ? 'Criando…' : 'Adicionar ao quadro'}
          </Botao>
        </div>
        </>
        )}
      </section>

      {/* ---- filtro de periodo ------------------------------------------ */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {([['semana', 'Esta semana'], ['mes', 'Este mês'], ['tudo', 'Tudo']] as const).map(
          ([v, rotulo]) => (
            <Botao
              key={v}
              tamanho="pequeno"
              variante={periodo === v ? 'primario' : 'secundario'}
              onClick={() => setPeriodo(v)}
            >
              {rotulo}
            </Botao>
          ),
        )}
        {/* Tarefa SEM prazo aparece em qualquer filtro. "Sem data" não é "fora
            do período", e escondê-la faria sumir sem explicação. */}
        {periodo !== 'tudo' && (
          <span className="rotulo normal-case text-tinta-3">
            tarefa sem prazo aparece sempre
          </span>
        )}
      </div>

      {recado && <p className="mb-4 text-[14px] text-tinta-2">{recado}</p>}
      {erro && <p className="mb-4 text-[14px] text-pink-texto">{erro}</p>}

      {/* ---- o quadro --------------------------------------------------- */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {quadro.colunas.map((c, i) => {
          const cartoes = porColuna.get(c.id) ?? [];
          return (
            <section
              key={c.id}
              className="w-[min(86vw,300px)] shrink-0"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                if (id) void mover(id, c.id);
              }}
            >
              <header className="mb-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  title="Renomear esta coluna"
                  onClick={() => {
                    const nome = window.prompt('Nome da coluna', c.nome);
                    if (nome && nome.trim() && nome !== c.nome) {
                      void mexerNaColuna(
                        () => renomearColunaDeTarefa(c.id, nome.trim()),
                        `Coluna renomeada para "${nome.trim()}".`,
                      );
                    }
                  }}
                  className="rotulo-forte text-left text-tinta"
                >
                  {c.nome} <span className="text-tinta-3">· {cartoes.length}</span>
                </button>

                <button
                  type="button"
                  aria-label={`Apagar a coluna ${c.nome}`}
                  title="Apagar esta coluna"
                  onClick={() => void mexerNaColuna(
                    () => apagarColunaDeTarefa(c.id),
                    `Coluna "${c.nome}" apagada.`,
                  )}
                  className="rotulo text-tinta-3 hover:text-pink-texto"
                >
                  ✕
                </button>
              </header>

              <div className="flex flex-col gap-2.5">
                {cartoes.length === 0 ? (
                  <p className="rotulo normal-case text-tinta-3">nada aqui</p>
                ) : (
                  cartoes.map((t) => (
                    <Cartao
                      key={t.id}
                      t={t}
                      colunas={quadro.colunas}
                      equipe={equipe}
                      aoMover={(col) => void mover(t.id, col)}
                      aoAbrir={() => setAberta(t)}
                    />
                  ))
                )}
              </div>

              {/* Só depois da última coluna, para não repetir em cada uma. */}
              {i === quadro.colunas.length - 1 && null}
            </section>
          );
        })}

        {/* ---- nova coluna ------------------------------------------------ */}
        <section className="w-[min(86vw,240px)] shrink-0">
          <div className="rotulo-forte mb-3 text-tinta-3">nova coluna</div>
          <div className="flex gap-2">
            <Entrada
              id="t-nova-coluna"
              value={novaColuna}
              placeholder="Esperando cliente"
              onChange={(e) => setNovaColuna(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && novaColuna.trim()) {
                  void mexerNaColuna(
                    () => criarColunaDeTarefa(novaColuna.trim()),
                    `Coluna "${novaColuna.trim()}" criada.`,
                  ).then(() => setNovaColuna(''));
                }
              }}
            />
            <Botao
              tamanho="pequeno"
              disabled={!novaColuna.trim()}
              onClick={() => void mexerNaColuna(
                () => criarColunaDeTarefa(novaColuna.trim()),
                `Coluna "${novaColuna.trim()}" criada.`,
              ).then(() => setNovaColuna(''))}
            >
              +
            </Botao>
          </div>
        </section>
      </div>

      {quadro.tarefas.length === 0 && (
        <Vazio
          titulo="Nada neste período"
          explica="Crie a primeira tarefa aí em cima, ou mude o filtro para Tudo."
        />
      )}

      {aberta && (
        <Detalhe
          t={aberta}
          equipe={equipe}
          euSou={sessao.tipo === 'equipe' ? sessao.perfil.userId : ''}
          aoFechar={() => setAberta(null)}
          aoMudar={async () => { await carregar(); setAberta(null); }}
          aoFalhar={setErro}
        />
      )}
    </div>
  );
}

/**
 * O cartão aberto: descrição, menções e apagar.
 *
 * Em modal e não em página própria porque uma tarefa é um bilhete, não um
 * documento — tirar a pessoa do quadro para ler três linhas custa mais do que
 * entrega.
 */
function Detalhe({
  t, equipe, euSou, aoFechar, aoMudar, aoFalhar,
}: {
  t: Tarefa;
  equipe: PessoaDaEquipe[];
  euSou: string;
  aoFechar: () => void;
  aoMudar: () => Promise<void>;
  aoFalhar: (m: string) => void;
}) {
  const [detalhe, setDetalhe] = useState(t.detalhe ?? '');
  const [salvando, setSalvando] = useState(false);
  const podeApagar = t.criadoPor === euSou;

  async function tentar(fn: () => Promise<unknown>) {
    setSalvando(true);
    try {
      await fn();
      await aoMudar();
    } catch (x) {
      aoFalhar(x instanceof Error ? x.message : 'Não consegui salvar.');
    } finally {
      setSalvando(false);
    }
  }

  const naoMencionados = equipe.filter(
    (p) => p.userId !== t.responsavelId && !t.mencionados.some((m) => m.id === p.userId),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.titulo}
      className="fixed inset-0 z-50 grid place-items-end bg-[rgb(3_3_8/0.6)] sm:place-items-center"
      onClick={aoFechar}
    >
      <div
        className="bloco max-h-[88dvh] w-full overflow-y-auto p-5 sm:max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[17px] font-bold text-tinta">{t.titulo}</h2>
          <Botao tamanho="pequeno" variante="texto" onClick={aoFechar}>Fechar</Botao>
        </div>

        <p className="rotulo mt-1.5 normal-case">
          criada por {t.criadoPorNome ?? '—'}
          {t.cliente ? ` · ${t.cliente}` : ''}
          {t.prazo ? ` · vence ${diaMes(t.prazo)}` : ''}
        </p>

        <div className="mt-4">
          <Campo id="t-det" rotulo="Descrição">
            <textarea
              id="t-det"
              rows={4}
              value={detalhe}
              onChange={(e) => setDetalhe(e.target.value)}
              className="w-full border border-linha-fraca bg-superficie-2 p-3 text-[14px] text-tinta"
            />
          </Campo>
          <Botao
            tamanho="pequeno"
            className="mt-2"
            disabled={salvando || detalhe === (t.detalhe ?? '')}
            onClick={() => void tentar(() =>
              detalhe.trim()
                ? editarTarefa(t.id, { detalhe: detalhe.trim() })
                : editarTarefa(t.id, {}, ['detalhe']),
            )}
          >
            Salvar descrição
          </Botao>
        </div>

        {/* MENÇÃO — "se a pessoa quiser mencionar a outra, a outra vê".
            É aqui que uma tarefa deixa de ser só sua. */}
        <div className="mt-5">
          <Fita>Mencionar alguém</Fita>
          <p className="rotulo mt-1.5 normal-case">
            quem for mencionado passa a ver esta tarefa no quadro dele
          </p>

          <div className="mt-2.5 flex flex-wrap gap-2">
            {t.mencionados.map((m) => (
              <Botao
                key={m.id}
                tamanho="pequeno"
                disabled={salvando}
                title={`Tirar ${m.nome} da tarefa`}
                onClick={() => void tentar(() => tirarMencaoDaTarefa(t.id, m.id))}
              >
                @{m.nome} ✕
              </Botao>
            ))}
            {naoMencionados.map((p) => (
              <Botao
                key={p.userId}
                tamanho="pequeno"
                variante="secundario"
                disabled={salvando}
                onClick={() => void tentar(() => mencionarNaTarefa(t.id, p.userId))}
              >
                + {p.nome ?? p.email}
              </Botao>
            ))}
          </div>
        </div>

        {/* Apagar é de quem criou. Quem recebeu move e conclui; sumir com o
            pedido de outra pessoa, não. */}
        {podeApagar && (
          <div className="mt-6 border-t border-linha-fraca pt-4">
            <Botao
              tamanho="pequeno"
              className="text-pink-texto"
              disabled={salvando}
              onClick={() => void tentar(() => apagarTarefa(t.id))}
            >
              Apagar esta tarefa
            </Botao>
          </div>
        )}
      </div>
    </div>
  );
}
