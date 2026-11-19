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
 * 2. ARRASTAR USA EVENTOS DE PONTEIRO, NAO `draggable`.
 *
 *    Era `draggable` nativo, e a dona cobrou: "aqui eu queria poder arrastar
 *    as tarefas entre os kanbans". Ela usa Safari. Rodei o mesmo gesto nos
 *    dois motores com o Playwright: no Chromium sai `dragstart`, `dragover`,
 *    `drop` e o cartao muda de coluna; no WebKit, que e o motor do Safari,
 *    NENHUM evento dispara. O recurso estava morto para ela desde sempre, e
 *    eu nunca testei fora do Chromium.
 *
 *    `pointerdown`/`pointermove`/`pointerup` sao os mesmos nos dois. So
 *    comeca a arrastar depois de 6px de movimento, senao todo clique para
 *    abrir o cartao viraria um arrasto.
 *
 *    No TOQUE o arrasto continua de fora, de proposito: para arrastar com o
 *    dedo seria preciso travar a rolagem da pagina, e o quadro rola de lado
 *    no celular. La o cartao tem o seletor de coluna, que e o mesmo gesto em
 *    forma de botao. O mesmo seletor esta no cartao aberto, em qualquer
 *    tamanho de tela: e o caminho de quem usa teclado, que arrastar nunca
 *    atende.
 *
 * 3. QUEM RENUMERA É O BANCO. A tela manda "este cartao, nesta coluna, nesta
 *    posicao" e recarrega. Duas pessoas arrastando ao mesmo tempo com a tela
 *    decidindo os numeros dariam duas ordens diferentes para o mesmo quadro.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as PointerEventoReact } from 'react';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada, Escolha } from '../componentes/Campo';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { Fita, Marca } from '../componentes/Bloco';
import {
  anexarNaTarefa, apagarColunaDeTarefa, apagarTarefa, criarColunaDeTarefa, criarTarefa,
  editarTarefa, equipeEConvites, listaClientes, mencionarNaTarefa, moverTarefa,
  quadroDeTarefas, renomearColunaDeTarefa, tirarAnexoDaTarefa, tirarMencaoDaTarefa,
  urlDoAnexo,
} from '../dados/api';
import { useSessao } from '../sessao';
import { diaMes } from '../formato';
import type {
  ClienteNaLista, ColunaDeTarefa, PessoaDaEquipe, QuadroDeTarefas, Tarefa,
} from '../dados/tipos';

type Periodo = 'semana' | 'mes' | 'tudo';

const peso = (bytes: number): string => {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1).replace('.', ',')} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
};

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
  t, colunas, equipe, aoMover, aoAbrir, aoPegar, fantasma,
}: {
  t: Tarefa;
  colunas: ColunaDeTarefa[];
  equipe: PessoaDaEquipe[];
  aoMover: (colunaId: string) => void;
  aoAbrir: () => void;
  aoPegar: (e: PointerEventoReact) => void;
  /** Este cartao e o que esta sendo arrastado agora. */
  fantasma: boolean;
}) {
  const estado = urgencia(t);
  return (
    <article
      onPointerDown={aoPegar}
      className={
        'bloco cursor-grab p-3 transition-shadow hover:shadow-lg ' +
        (estado === 'atrasada' ? 'border-pink ' : '') +
        (fantasma ? 'opacity-40' : '')
      }
      onClick={aoAbrir}
    >
      <p className="text-[14.5px] leading-snug font-bold text-tinta">{t.titulo}</p>

      {t.cliente && <p className="legenda mt-1.5">{t.cliente}</p>}

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
        {/* O cartao fechado diz que TEM anexo, sem listar: saber que existe
            muda a decisao de abrir; saber o nome do arquivo, não. */}
        {t.arquivos.length > 0 && (
          <Marca>{t.arquivos.length} anexo{t.arquivos.length > 1 ? 's' : ''}</Marca>
        )}
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

  /**
   * Guarda o ID, não o cartão.
   *
   * Guardando o objeto, ele congela no estado do momento em que foi aberto: a
   * tela recarrega por baixo e o cartão aberto continua mostrando a versão
   * velha. A saída anterior era FECHAR o cartão a cada ação — e aí não dava
   * para anexar dois arquivos seguidos nem mencionar duas pessoas, porque o
   * primeiro clique já tinha fechado tudo.
   *
   * Com o ID, o cartão é sempre lido do quadro recém-carregado: muda sozinho e
   * continua aberto.
   */
  const [abertaId, setAbertaId] = useState<string | null>(null);

  /**
   * ARRASTAR, com ponteiro.
   *
   * Tres refs e dois estados. As refs porque os ouvintes sao registrados uma
   * vez so, na montagem, e leriam estado congelado; os estados porque o que
   * aparece na tela — o cartao fantasma e a coluna acesa — precisa redesenhar.
   */
  const pegado = useRef<{ id: string; coluna: string; x: number; y: number } | null>(null);
  const sobreRef = useRef<string | null>(null);
  /** Virou arrasto de verdade? Serve para o clique seguinte NAO abrir o cartao. */
  const arrastou = useRef(false);
  const [arrastando, setArrastando] = useState<{ id: string; titulo: string } | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [onde, setOnde] = useState({ x: 0, y: 0 });
  /** Para o ouvinte chamar o `mover` de agora, nao o da montagem. */
  const moverRef = useRef<(id: string, coluna: string) => void>(() => {});
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

  // Espelhos do que o ouvinte precisa ler. Atribuidos a cada desenho, entao
  // o ouvinte, que e registrado uma vez so, sempre le o de agora.
  const quadroRef = useRef<QuadroDeTarefas | null>(quadro);
  quadroRef.current = quadro;
  moverRef.current = (id, col) => void mover(id, col);

  /** O ponteiro encostou num cartao. Ainda nao e arrasto: pode ser clique. */
  function pegar(e: PointerEventoReact, t: Tarefa) {
    // So mouse e caneta. No dedo, arrastar exigiria travar a rolagem — e o
    // quadro rola de lado no celular. La o caminho e o seletor de coluna.
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    if (e.button !== 0) return;
    arrastou.current = false;
    pegado.current = { id: t.id, coluna: t.colunaId, x: e.clientX, y: e.clientY };
  }

  useEffect(() => {
    function andou(e: PointerEvent) {
      const p = pegado.current;
      if (!p) return;
      if (!arrastou.current) {
        // Seis pixels de folga: sem isso, a mao tremida de um clique ja
        // arrastaria o cartao para outra coluna.
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
        arrastou.current = true;
        const t = quadroRef.current?.tarefas.find((x) => x.id === p.id);
        setArrastando({ id: p.id, titulo: t?.titulo ?? '' });
        document.body.style.userSelect = 'none';
      }
      setOnde({ x: e.clientX, y: e.clientY });
      // Quem esta embaixo do ponteiro. O fantasma nao atrapalha porque e
      // `pointer-events-none`.
      const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-coluna]');
      const col = alvo ? alvo.getAttribute('data-coluna') : null;
      sobreRef.current = col;
      setSobre(col);
    }
    function soltou() {
      const p = pegado.current;
      const col = sobreRef.current;
      pegado.current = null;
      sobreRef.current = null;
      document.body.style.userSelect = '';
      setArrastando(null);
      setSobre(null);
      // Soltar na mesma coluna nao e mover: seria uma ida ao banco e um
      // recarregamento para nada.
      if (arrastou.current && p && col && col !== p.coluna) moverRef.current(p.id, col);
    }
    window.addEventListener('pointermove', andou);
    window.addEventListener('pointerup', soltou);
    window.addEventListener('pointercancel', soltou);
    return () => {
      window.removeEventListener('pointermove', andou);
      window.removeEventListener('pointerup', soltou);
      window.removeEventListener('pointercancel', soltou);
      document.body.style.userSelect = '';
    };
  }, []);

  if (erro && !quadro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!quadro) return <Carregando oQue="o quadro" />;

  const aberta = quadro.tarefas.find((t) => t.id === abertaId) ?? null;

  return (
    // A margem lateral e de cada tela: a casca nao aplica nenhuma. Sem isto o
    // quadro encostava na borda esquerda e o "A fazer" aparecia cortado.
    <div className="px-5 pb-16 pt-7 sm:px-8 lg:px-12">
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
          <span className="legenda text-tinta-3">
            tarefa sem prazo aparece sempre
          </span>
        )}
      </div>

      {recado && <p className="mb-4 text-[14px] text-tinta-2">{recado}</p>}
      {erro && <p className="mb-4 text-[14px] text-pink-texto">{erro}</p>}

      {/* ---- o quadro --------------------------------------------------- */}
      {/* SANGRA ate a borda, mas COMECA alinhado.
          A margem negativa cancela o respiro da pagina e o padding devolve: a
          primeira coluna fica na mesma linha vertical do resto da tela, e as
          outras deslizam ate a borda em vez de parar antes dela. Sem isso, ou
          o quadro encosta na borda (como estava) ou perde largura util no
          celular, que e onde ela mais falta. */}
      <div
        className={
          'flex gap-4 overflow-x-auto pb-4 ' +
          '-mx-5 px-5 sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12'
        }
      >
        {quadro.colunas.map((c, i) => {
          const cartoes = porColuna.get(c.id) ?? [];
          return (
            <section
              key={c.id}
              data-coluna={c.id}
              className={
                'w-[min(86vw,300px)] shrink-0 rounded-xl transition-colors '
                + (arrastando && sobre === c.id ? 'bg-pink/10 outline outline-2 outline-pink' : '')
              }
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
                  <p className="legenda text-tinta-3">nada aqui</p>
                ) : (
                  cartoes.map((t) => (
                    <Cartao
                      key={t.id}
                      t={t}
                      colunas={quadro.colunas}
                      equipe={equipe}
                      aoMover={(col) => void mover(t.id, col)}
                      // Depois de arrastar NAO abre: o clique vem logo atras
                      // do soltar, e abrir o cartao seria uma surpresa.
                      aoAbrir={() => { if (!arrastou.current) setAbertaId(t.id); }}
                      aoPegar={(e) => pegar(e, t)}
                      fantasma={arrastando?.id === t.id}
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

      {/* O cartao que segue o ponteiro. `pointer-events-none` e obrigatorio:
          sem isso ele seria o elemento embaixo do cursor e nenhuma coluna
          seria encontrada. */}
      {arrastando && (
        <div
          className="pointer-events-none fixed z-50 max-w-[240px] rounded-lg border border-pink bg-superficie px-3 py-2 text-[13.5px] font-bold shadow-lg"
          style={{ left: onde.x + 14, top: onde.y + 14 }}
        >
          {arrastando.titulo}
        </div>
      )}

      {aberta && (
        <Detalhe
          t={aberta}
          colunas={quadro.colunas}
          equipe={equipe}
          euSou={sessao.tipo === 'equipe' ? sessao.perfil.userId : ''}
          aoFechar={() => setAbertaId(null)}
          // Recarrega e CONTINUA ABERTO. Só o apagar fecha, porque aí o cartão
          // deixou de existir.
          aoMudar={carregar}
          aoApagar={async () => { setAbertaId(null); await carregar(); }}
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
  t, colunas, equipe, euSou, aoFechar, aoMudar, aoApagar, aoFalhar,
}: {
  t: Tarefa;
  colunas: ColunaDeTarefa[];
  equipe: PessoaDaEquipe[];
  euSou: string;
  aoFechar: () => void;
  aoMudar: () => Promise<void>;
  aoApagar: () => Promise<void>;
  aoFalhar: (m: string) => void;
}) {
  const [detalhe, setDetalhe] = useState(t.detalhe ?? '');
  const [salvando, setSalvando] = useState(false);
  const [subindo, setSubindo] = useState(false);
  const podeApagar = t.criadoPor === euSou;

  async function anexar(f: File) {
    setSubindo(true);
    try {
      await anexarNaTarefa(t.id, f);
      await aoMudar();
    } catch (x) {
      aoFalhar(x instanceof Error ? x.message : 'Não consegui anexar.');
    } finally {
      setSubindo(false);
    }
  }

  /**
   * Abre numa aba nova com URL assinada de dez minutos.
   *
   * O balde é privado: não existe endereço permanente de nenhum anexo. Assinar
   * só na hora de abrir evita gerar dezenas de endereços que ninguém usa toda
   * vez que o quadro carrega.
   */
  async function abrir(caminho: string) {
    try {
      window.open(await urlDoAnexo(caminho), '_blank', 'noopener');
    } catch (x) {
      aoFalhar(x instanceof Error ? x.message : 'Não consegui abrir o anexo.');
    }
  }

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

        <p className="legenda mt-1.5">
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
          <p className="legenda mt-1.5">
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

        {/* ANEXOS — "queria que no card desse pra colocar imagem, documento".
            Briefing sem o arquivo junto vira troca de WhatsApp, que é o que
            este quadro existe para tirar do WhatsApp. */}
        <div className="mt-5">
          <Fita>Imagens e documentos</Fita>

          {t.arquivos.length > 0 && (
            <ul className="mt-2.5 flex flex-col gap-2">
              {t.arquivos.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={salvando}
                    onClick={() => void abrir(a.caminho)}
                    className="min-w-0 flex-1 truncate text-left text-[14px] text-tinta underline-offset-2 hover:underline"
                  >
                    {a.nome}
                    {a.bytes ? (
                      <span className="legenda ml-2 text-tinta-3">{peso(a.bytes)}</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    aria-label={`Tirar ${a.nome}`}
                    disabled={salvando}
                    onClick={() => void tentar(() => tirarAnexoDaTarefa(a.id))}
                    className="rotulo shrink-0 text-tinta-3 hover:text-pink-texto"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="mt-3 block">
            <span className="legenda">
              {subindo ? 'Subindo…' : 'Anexar imagem ou documento'}
            </span>
            <input
              type="file"
              disabled={subindo || salvando}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void anexar(f);
              }}
              className="mt-1.5 block w-full text-[13px] text-tinta-2 file:mr-3 file:border file:border-linha file:bg-superficie-2 file:px-3 file:py-2 file:text-tinta"
            />
          </label>
          {/* Dizer o limite ANTES, não depois de a pessoa esperar a subida de
              um arquivo de 300 MB para receber uma recusa. */}
          <p className="legenda mt-1.5 text-tinta-3">
            até 200 MB · imagem, PDF, Word, Excel, PowerPoint, CSV ou vídeo
          </p>
        </div>

        {/* MOVER DAQUI, EM QUALQUER TELA.
            No quadro, o seletor de coluna só aparece no celular — no
            computador o gesto é arrastar. Mas arrastar não atende quem usa
            teclado, e o cartão aberto é onde essa pessoa chega com Enter.
            Então aqui o seletor existe sempre. */}
        <div className="mt-6 border-t border-linha-fraca pt-4">
          <label className="block">
            <span className="rotulo">Coluna</span>
            <select
              value={t.colunaId}
              aria-label={`Coluna de ${t.titulo}`}
              disabled={salvando}
              onChange={(e) => void tentar(() => moverTarefa(t.id, e.target.value))}
              className="mt-1.5 min-h-11 w-full border border-linha-fraca bg-superficie-2 px-2 text-[14px] text-tinta"
            >
              {colunas.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Apagar é de quem criou. Quem recebeu move e conclui; sumir com o
            pedido de outra pessoa, não. */}
        {podeApagar && (
          <div className="mt-6 border-t border-linha-fraca pt-4">
            <Botao
              tamanho="pequeno"
              className="text-pink-texto"
              disabled={salvando}
              onClick={() => {
                setSalvando(true);
                void apagarTarefa(t.id)
                  .then(aoApagar)
                  .catch((x: unknown) =>
                    aoFalhar(x instanceof Error ? x.message : 'Não consegui apagar.'))
                  .finally(() => setSalvando(false));
              }}
            >
              Apagar esta tarefa
            </Botao>
          </div>
        )}
      </div>
    </div>
  );
}
