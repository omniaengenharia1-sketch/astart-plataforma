/**
 * A agenda, em calendário de mês.
 *
 * A dona: "pq nao consigo colocar coisas na agenda, vc precisa fazer a agenda
 * estilo calendário. CALENDÁRIO BRASILEIRO".
 *
 * TRÊS COISAS QUE ESTA TELA DECIDE, E POR QUÊ
 *
 * 1. A SEMANA COMEÇA NO DOMINGO. É o calendário de parede do Brasil, D S T Q
 *    Q S S, e foi isso que ela pediu com todas as letras. O filtro de semana
 *    das Tarefas começa na segunda, que é o certo para contar dias úteis —
 *    são perguntas diferentes e não precisam da mesma resposta.
 *
 * 2. A GRADE É O MÊS INTEIRO, não uma janela de 7/15/30 dias. Janela responde
 *    "o que vem agora"; calendário responde "como está o mês", que é a
 *    pergunta de quem planeja gravação e reunião. A lista do mês continua
 *    existindo, embaixo, para quem quer ler em vez de olhar.
 *
 * 3. SÓ COMPROMISSO É EDITÁVEL, e quem diz isso é o banco (`editavel`), não
 *    esta tela. Peça agendada, captação, marco e cobrança pertencem ao módulo
 *    que os criou: oferecer "editar" aqui seria um botão que mente.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada, Escolha } from '../componentes/Campo';
import { Carregando, Falhou } from '../componentes/Estado';
import {
  agenda, apagarCompromisso, compromisso as pedirCompromisso, criarCompromisso,
  editarCompromisso, equipeEConvites, listaClientes,
} from '../dados/api';
import { diaMes, porExtenso } from '../formato';
import type {
  ClienteNaLista, CompromissoNaFicha, EventoNaAgenda, PessoaDaEquipe,
} from '../dados/tipos';

type Tipo = EventoNaAgenda['tipo'];

const NOME: Record<Tipo, string> = {
  publicacao: 'publicação',
  captacao: 'captação',
  marco: 'marco',
  cobranca: 'cobrança',
  compromisso: 'compromisso',
};

/** Uma cor por tipo, para o olho achar sem ler. */
const COR: Record<Tipo, string> = {
  publicacao: 'bg-pink',
  captacao: 'bg-amber-400',
  marco: 'bg-sky-400',
  cobranca: 'bg-emerald-400',
  compromisso: 'bg-violet-400',
};

/** Domingo primeiro: é o calendário de parede do Brasil. */
const CABECA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const hojeISO = () => new Date().toISOString().slice(0, 10);
const mesDe = (texto: string) => texto.slice(0, 7);
const mesDeHoje = () => mesDe(hojeISO());

function mesVizinho(mes: string, passo: number): string {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const d = new Date(a, m - 1 + passo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function porExtensoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  return `${MESES[m - 1]} de ${a}`;
}

const emTexto = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Os dias que a grade mostra: do domingo da primeira semana ao sábado da
 * última. Os de fora do mês entram apagados, porque semana cortada no meio é
 * pior que semana com três dias do mês passado.
 */
function diasDaGrade(mes: string): string[] {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const primeiro = new Date(a, m - 1, 1);
  const inicio = new Date(primeiro);
  inicio.setDate(1 - primeiro.getDay());          // volta até o domingo
  const dias: string[] = [];
  for (let i = 0; i < 42; i += 1) {               // 6 semanas cobrem qualquer mês
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    dias.push(emTexto(d));
  }
  // A sexta semana só entra se tiver dia do mês: senão sobra uma fileira cinza.
  if (!dias.slice(35).some((x) => mesDe(x) === mes)) dias.length = 35;
  return dias;
}

const VAZIO = {
  titulo: '', dia: hojeISO(), hora: '', horaFim: '', diaInteiro: false,
  cliente: '', responsavel: '', local: '', observacao: '',
};

export function Agenda() {
  const [mes, setMes] = useState(mesDeHoje);
  const [eventos, setEventos] = useState<EventoNaAgenda[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [so, setSo] = useState<Tipo | 'tudo'>('tudo');
  const [clientes, setClientes] = useState<ClienteNaLista[]>([]);
  const [equipe, setEquipe] = useState<PessoaDaEquipe[]>([]);

  /** Nulo = fechado; string vazia = marcando; id = corrigindo aquele. */
  const [aberto, setAberto] = useState<string | null>(null);
  const [f, setF] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const grade = diasDaGrade(mes);
      const [ev, cl, eq] = await Promise.all([
        // Pede a GRADE inteira, não só o mês: os dias de fora que aparecem na
        // primeira e na última fileira também mostram o que têm.
        agenda(grade[0] ?? `${mes}-01`, grade[grade.length - 1] ?? `${mes}-28`),
        listaClientes().catch(() => []),
        equipeEConvites().then((x) => x.pessoas).catch(() => []),
      ]);
      setEventos(ev);
      setClientes(cl);
      setEquipe(eq);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir a agenda.');
    }
  }, [mes]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function abrirNovo(dia: string) {
    setConfirmando(false);
    setErro(null);
    setF({ ...VAZIO, dia });
    setAberto('');
  }

  async function abrirCorrecao(id: string) {
    setConfirmando(false);
    setErro(null);
    try {
      const k: CompromissoNaFicha = await pedirCompromisso(id);
      setF({
        titulo: k.titulo,
        dia: k.dia,
        hora: k.hora ?? '',
        horaFim: k.horaFim ?? '',
        diaInteiro: k.diaInteiro,
        cliente: k.clienteId ?? '',
        responsavel: k.responsavelId ?? '',
        local: k.local ?? '',
        observacao: k.observacao ?? '',
      });
      setAberto(id);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir o compromisso.');
    }
  }

  async function salvar() {
    if (salvando || !f.titulo.trim() || !f.dia) return;
    setSalvando(true);
    setErro(null);
    setRecado(null);
    const d = {
      titulo: f.titulo.trim(),
      dia: f.dia,
      hora: f.diaInteiro ? null : (f.hora || null),
      horaFim: f.diaInteiro ? null : (f.horaFim || null),
      diaInteiro: f.diaInteiro,
      clienteId: f.cliente || null,
      responsavelId: f.responsavel || null,
      local: f.local.trim() || null,
      observacao: f.observacao.trim() || null,
    };
    try {
      if (aberto) {
        await editarCompromisso(aberto, d);
        setRecado(`${d.titulo} corrigido.`);
      } else {
        await criarCompromisso(d);
        setRecado(`${d.titulo} entrou na agenda.`);
      }
      setAberto(null);
      await carregar();
    } catch (x) {
      // A recusa fica na tela E o formulário continua aberto: fechar engoliria
      // o erro junto com o que foi digitado.
      setErro(x instanceof Error ? x.message : 'Não consegui salvar.');
    } finally {
      setSalvando(false);
    }
  }

  async function apagar() {
    if (!aberto) return;
    setSalvando(true);
    setErro(null);
    try {
      await apagarCompromisso(aberto);
      setRecado('Compromisso desmarcado.');
      setAberto(null);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui desmarcar.');
    } finally {
      setSalvando(false);
      setConfirmando(false);
    }
  }

  if (erro && !eventos) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!eventos) return <Carregando oQue="a agenda" />;

  const lista = so === 'tudo' ? eventos : eventos.filter((e) => e.tipo === so);
  const grade = diasDaGrade(mes);

  const porDia = new Map<string, EventoNaAgenda[]>();
  for (const e of lista) {
    const atual = porDia.get(e.quando) ?? [];
    atual.push(e);
    porDia.set(e.quando, atual);
  }

  const hoje = hojeISO();
  const doMes = lista.filter((e) => mesDe(e.quando) === mes);
  // Os contadores contam o MÊS e ignoram o filtro: eles são o resumo de
  // quanto o mês tem de cada coisa, e um resumo que muda quando você filtra
  // responde à pergunta errada.
  const noMes = eventos.filter((e) => mesDe(e.quando) === mes);
  const conta = (x: Tipo) => noMes.filter((e) => e.tipo === x).length;

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <div className="rotulo">agenda</div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <h1 className="titulao text-[clamp(1.8rem,5vw,2.8rem)]">
            {porExtensoMes(mes)}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Botao tamanho="pequeno" onClick={() => setMes(mesVizinho(mes, -1))}>
              &lt; mês
            </Botao>
            <Botao
              tamanho="pequeno"
              variante={mes === mesDeHoje() ? 'primario' : 'secundario'}
              onClick={() => setMes(mesDeHoje())}
            >
              hoje
            </Botao>
            <Botao tamanho="pequeno" onClick={() => setMes(mesVizinho(mes, 1))}>
              mês &gt;
            </Botao>
            <Botao
              variante="primario"
              tamanho="pequeno"
              onClick={() => abrirNovo(mes === mesDeHoje() ? hoje : `${mes}-01`)}
            >
              + Marcar
            </Botao>
          </div>
        </div>
      </div>

      <div className="escada mt-7 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Bloco rotulo="Publicações" destaque={String(conta('publicacao'))} />
        <Bloco rotulo="Captações" destaque={String(conta('captacao'))} />
        <Bloco rotulo="Marcos" destaque={String(conta('marco'))} />
        <Bloco rotulo="Cobranças" destaque={String(conta('cobranca'))} />
        <Bloco rotulo="Compromissos" destaque={String(conta('compromisso'))} />
      </div>

      {recado && <p role="status" className="aviso mt-5">{recado}</p>}
      {erro && (
        <div role="alert" className="bloco mt-5 bg-alerta-fundo p-3.5">
          <span className="rotulo-forte text-pink-texto">não deu certo</span>
          <p className="mt-1 text-[13.5px] font-medium">{erro}</p>
        </div>
      )}

      {/* O FORMULÁRIO FICA AQUI EM CIMA, perto do botão que o abriu, e não
          num modal: a grade continua visível enquanto se escolhe a data. */}
      {aberto !== null && (
        <div className="bloco mt-5 p-4">
          <div className="rotulo-forte">
            {aberto ? 'corrigir compromisso' : 'marcar na agenda'}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Campo id="k-titulo" rotulo="O quê">
              <Entrada
                id="k-titulo"
                value={f.titulo}
                placeholder="reunião, gravação, visita…"
                onChange={(e) => setF({ ...f, titulo: e.target.value })}
              />
            </Campo>
            <Campo id="k-dia" rotulo="Dia">
              <Entrada
                id="k-dia"
                type="date"
                value={f.dia}
                onChange={(e) => setF({ ...f, dia: e.target.value })}
              />
            </Campo>
            {!f.diaInteiro && (
              <>
                <Campo id="k-hora" rotulo="Começa">
                  <Entrada
                    id="k-hora"
                    type="time"
                    value={f.hora}
                    onChange={(e) => setF({ ...f, hora: e.target.value })}
                  />
                </Campo>
                <Campo id="k-hora-fim" rotulo="Termina" dica="opcional">
                  <Entrada
                    id="k-hora-fim"
                    type="time"
                    value={f.horaFim}
                    onChange={(e) => setF({ ...f, horaFim: e.target.value })}
                  />
                </Campo>
              </>
            )}
            <Campo id="k-cliente" rotulo="De qual cliente" dica="deixe vazio se for da casa">
              <Escolha
                id="k-cliente"
                value={f.cliente}
                onChange={(e) => setF({ ...f, cliente: e.target.value })}
              >
                <option value="">da casa</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </Escolha>
            </Campo>
            <Campo id="k-responsavel" rotulo="Quem vai">
              <Escolha
                id="k-responsavel"
                value={f.responsavel}
                onChange={(e) => setF({ ...f, responsavel: e.target.value })}
              >
                <option value="">ninguém marcado</option>
                {equipe.map((x) => (
                  <option key={x.userId} value={x.userId}>{x.nome}</option>
                ))}
              </Escolha>
            </Campo>
            <Campo id="k-local" rotulo="Onde">
              <Entrada
                id="k-local"
                value={f.local}
                placeholder="estúdio, endereço, link da chamada…"
                onChange={(e) => setF({ ...f, local: e.target.value })}
              />
            </Campo>
            <Campo id="k-observacao" rotulo="Observação">
              <Entrada
                id="k-observacao"
                value={f.observacao}
                onChange={(e) => setF({ ...f, observacao: e.target.value })}
              />
            </Campo>
          </div>

          <label className="mt-3 flex items-center gap-2 text-[14px]">
            <input
              id="k-dia-inteiro"
              type="checkbox"
              checked={f.diaInteiro}
              onChange={(e) => setF({ ...f, diaInteiro: e.target.checked })}
              className="size-4"
            />
            dia inteiro, sem hora marcada
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Botao
              variante="primario"
              tamanho="pequeno"
              disabled={salvando || !f.titulo.trim() || !f.dia}
              onClick={() => void salvar()}
            >
              {salvando ? 'Salvando…' : aberto ? 'Salvar' : 'Marcar'}
            </Botao>
            <Botao variante="texto" tamanho="pequeno" onClick={() => setAberto(null)}>
              Fechar
            </Botao>
            {aberto && (
              <>
                <span className="ml-auto" />
                {!confirmando ? (
                  <Botao
                    variante="texto"
                    tamanho="pequeno"
                    className="text-pink-texto"
                    onClick={() => setConfirmando(true)}
                  >
                    Desmarcar
                  </Botao>
                ) : (
                  <>
                    <span className="legenda">desmarcar tira da agenda de todo mundo.</span>
                    <Botao
                      variante="primario"
                      tamanho="pequeno"
                      disabled={salvando}
                      onClick={() => void apagar()}
                    >
                      Desmarcar mesmo
                    </Botao>
                    <Botao variante="texto" tamanho="pequeno" onClick={() => setConfirmando(false)}>
                      Deixa
                    </Botao>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="mt-7 flex flex-wrap items-center gap-2">
        <span className="rotulo mr-1">mostrar</span>
        <Botao
          tamanho="pequeno"
          variante={so === 'tudo' ? 'primario' : 'secundario'}
          onClick={() => setSo('tudo')}
        >
          Tudo
        </Botao>
        {(Object.keys(NOME) as Tipo[]).map((t) => (
          <Botao
            key={t}
            tamanho="pequeno"
            variante={so === t ? 'primario' : 'secundario'}
            onClick={() => setSo(t)}
          >
            {NOME[t]}
          </Botao>
        ))}
      </div>

      {/* ---- A GRADE DO MÊS ------------------------------------------------
          No celular ela rola de lado em vez de espremer sete colunas em
          320px: dia de calendário com 40px de largura não se lê. */}
      <div className="mt-6 overflow-x-auto">
        <div className="min-w-[46rem]">
          <div className="grid grid-cols-7 gap-px">
            {CABECA.map((c) => (
              <div key={c} className="rotulo-forte px-2 py-2 text-center text-tinta-3">
                {c}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-linha-fraca">
            {grade.map((dia) => {
              const doDia = porDia.get(dia) ?? [];
              const foraDoMes = mesDe(dia) !== mes;
              const ehHoje = dia === hoje;
              return (
                <div
                  key={dia}
                  data-dia={dia}
                  className={
                    // Dia de fora do mes se distingue pelo FUNDO, nao por
                    // opacidade: `opacity-40` apaga o texto junto e o
                    // contraste cai abaixo do legivel — o roteiro do tema
                    // pegou isso nos dois temas.
                    'min-h-28 p-1.5 '
                    + (foraDoMes ? 'bg-superficie-2 ' : 'bg-superficie ')
                    + (ehHoje ? 'outline outline-2 -outline-offset-2 outline-pink' : '')
                  }
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={
                        'numeros text-[13px] '
                        + (ehHoje ? 'font-extrabold text-pink-texto' : 'text-tinta-3')
                      }
                    >
                      {Number(dia.slice(8))}
                    </span>
                    {/* Marcar NESTE dia. */}
                    <button
                      type="button"
                      aria-label={`Marcar em ${porExtenso(dia)}`}
                      onClick={() => abrirNovo(dia)}
                      className="min-h-6 rounded px-1.5 text-[15px] leading-6 text-tinta-3 hover:text-pink-texto"
                    >
                      +
                    </button>
                  </div>
                  <ul className="mt-1 flex flex-col gap-1">
                    {doDia.map((e) => (
                      <li key={`${e.tipo}-${e.id}`}>
                        {e.editavel ? (
                          <button
                            type="button"
                            onClick={() => void abrirCorrecao(e.id)}
                            className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[12.5px] leading-tight hover:bg-superficie-2"
                          >
                            <span className={'size-1.5 shrink-0 rounded-full ' + COR[e.tipo]} />
                            {e.hora && <span className="numeros shrink-0 text-tinta-3">{e.hora}</span>}
                            <span className="truncate font-medium">{e.oQue}</span>
                          </button>
                        ) : (
                          <div
                            className="flex items-center gap-1 px-1 py-0.5 text-[12.5px] leading-tight"
                            title={`${NOME[e.tipo]}: ${e.oQue}`}
                          >
                            <span className={'size-1.5 shrink-0 rounded-full ' + COR[e.tipo]} />
                            {e.hora && <span className="numeros shrink-0 text-tinta-3">{e.hora}</span>}
                            <span className="truncate text-tinta-2">{e.oQue}</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---- A LISTA, embaixo ----------------------------------------------
          A grade responde "como está o mês"; a lista responde "o que tem,
          com quem, onde". Quem lê no celular lê aqui. */}
      <div className="mt-10">
        <Fita>O mês escrito</Fita>
        {doMes.length === 0 ? (
          <p className="py-6 text-tinta-3">
            Nada marcado em {porExtensoMes(mes)}. Use “+ marcar” para a primeira coisa.
          </p>
        ) : (
          <ul className="mt-3 border-t border-linha-fraca">
            {doMes.map((e) => (
              <li
                key={`lista-${e.tipo}-${e.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-2 py-3"
              >
                <span className="numeros w-16 shrink-0 text-tinta-3">{diaMes(e.quando)}</span>
                <span className="numeros w-12 shrink-0 text-tinta-3">{e.hora ?? '—'}</span>
                <span className="w-28 shrink-0">
                  <Marca forte={e.tipo === 'cobranca' && e.detalhe === 'atrasado'}>
                    {NOME[e.tipo]}
                  </Marca>
                </span>
                {e.clienteId ? (
                  <Link
                    to={`/clientes/${e.clienteId}`}
                    className="risca w-40 shrink-0 font-bold hover:text-pink-texto"
                  >
                    {e.clienteNome}
                  </Link>
                ) : (
                  <span className="w-40 shrink-0 text-tinta-3">casa</span>
                )}
                <span className="min-w-48 flex-1 font-medium">{e.oQue}</span>
                {e.detalhe && <span className="rotulo">{e.detalhe}</span>}
                {e.editavel && (
                  <Botao tamanho="pequeno" variante="texto" onClick={() => void abrirCorrecao(e.id)}>
                    Abrir
                  </Botao>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
