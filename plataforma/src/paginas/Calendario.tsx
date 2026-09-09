import { useState } from 'react';
import { Cabecalho } from '../componentes/Layout';
import { Segmentado } from '../componentes/Segmentado';
import { ANO, COR_STATUS, HOJE, MES, ROTULO_STATUS, useApp } from '../contexto';
import type { Post } from '../dados/tipos';

const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PUBLICADOS = ['publicado', 'publicado_parcial'];

const LEGENDA: { cor: string; texto: string }[] = [
  { cor: 'bg-linha-forte', texto: 'Rascunho' },
  { cor: 'bg-espera', texto: 'Aguardando' },
  { cor: 'bg-pink', texto: 'Agendado' },
  { cor: 'bg-ok', texto: 'Publicado' },
  { cor: 'bg-falha', texto: 'Falhou' },
];

export function Calendario() {
  const { clienteAtivo, posts, setPosts, avisar } = useApp();
  const [visao, setVisao] = useState<'mes' | 'semana'>('mes');
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvoSolto, setAlvoSolto] = useState<number | null>(null);

  const doCliente = posts.filter((p) => p.clienteId === clienteAtivo);

  const primeiroDiaSemana = new Date(ANO, MES, 1).getDay();
  const totalDias = new Date(ANO, MES + 1, 0).getDate();

  let inicio = 1;
  let fim = totalDias;
  let deslocamento = primeiroDiaSemana;
  if (visao === 'semana') {
    const diaSemanaHoje = new Date(ANO, MES, HOJE).getDay();
    inicio = HOJE - diaSemanaHoje;
    fim = inicio + 6;
    deslocamento = 0;
  }

  function soltar(dia: number) {
    setAlvoSolto(null);
    const id = arrastando;
    setArrastando(null);
    if (!id) return;

    const post = posts.find((p) => p.id === id);
    if (!post || post.dia === dia) return;

    if (PUBLICADOS.includes(post.status)) {
      avisar('Peça já publicada não é reagendada.');
      return;
    }

    setPosts((antes) =>
      antes.map((p) =>
        p.id === id
          ? { ...p, dia, status: p.status === 'rascunho' || p.status === 'aprovado' ? 'agendado' : p.status }
          : p,
      ),
    );
    avisar(`Reagendado para ${dia}/08 às ${post.hora} — agendado_para reescrito.`);
  }

  function celulaDia(dia: number) {
    const fora = dia < 1 || dia > totalDias;
    if (fora) return <div key={`fora-${dia}`} className="min-h-28 bg-superficie-2" />;

    const doDia = doCliente
      .filter((p) => p.dia === dia)
      .sort((a, b) => (a.hora < b.hora ? -1 : 1));

    return (
      <div
        key={dia}
        onDragOver={(e) => {
          e.preventDefault();
          setAlvoSolto(dia);
        }}
        onDragLeave={() => setAlvoSolto((d) => (d === dia ? null : d))}
        onDrop={(e) => {
          e.preventDefault();
          soltar(dia);
        }}
        className={
          'flex min-h-28 flex-col gap-1 p-1.5 pb-2 ' +
          (alvoSolto === dia ? 'bg-pink-suave outline-1 -outline-offset-2 outline-dashed outline-pink' : 'bg-superficie')
        }
      >
        <div className="numeros flex items-center gap-1.5 text-[11.5px] text-tinta-3">
          {dia === HOJE ? (
            <b className="rounded-sm bg-tinta px-1 font-semibold text-papel">{dia}</b>
          ) : (
            <span>{dia}</span>
          )}
          {dia === HOJE && <span className="rotulo">hoje</span>}
        </div>
        {doDia.map((p) => (
          <Peca key={p.id} post={p} aoArrastar={setArrastando} arrastando={arrastando === p.id} />
        ))}
      </div>
    );
  }

  const celulas = [];
  for (let i = 0; i < deslocamento; i++) celulas.push(<div key={`v${i}`} className="min-h-28 bg-superficie-2" />);
  for (let d = inicio; d <= fim; d++) celulas.push(celulaDia(d));
  if (visao === 'mes') {
    const resto = (7 - ((deslocamento + totalDias) % 7)) % 7;
    for (let i = 0; i < resto; i++) celulas.push(<div key={`f${i}`} className="min-h-28 bg-superficie-2" />);
  }

  return (
    <>
      <Cabecalho
        titulo="Calendário editorial"
        linha="Arraste uma peça para outro dia para reagendar. A cor da borda é o status; o horário é o fuso do cliente."
      />
      <div className="px-6 pb-8">
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <span className="min-w-40 font-display text-[19px] font-medium">Agosto de 2026</span>
          <Segmentado
            rotuloGrupo="Visão do calendário"
            valor={visao}
            aoTrocar={setVisao}
            opcoes={[
              { valor: 'mes', texto: 'Mês' },
              { valor: 'semana', texto: 'Semana' },
            ]}
          />
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {LEGENDA.map((l) => (
              <span key={l.texto} className="flex items-center gap-1.5 text-[11px] text-tinta-3">
                <i className={`size-2 rounded-[2px] ${l.cor}`} />
                {l.texto}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-linha bg-linha">
          {DOW.map((d) => (
            <div key={d} className="bg-superficie-2 px-2 py-1.5">
              <span className="rotulo">{d}</span>
            </div>
          ))}
          {celulas}
        </div>

        <p className="mt-5 max-w-[78ch] border-l-2 border-linha-forte py-1 pl-3.5 text-[11.5px] leading-relaxed text-tinta-3">
          <b className="text-tinta-2">O que está por trás:</b> cada peça é uma linha em{' '}
          <code className="font-mono">posts</code>; a cor vem de <code className="font-mono">posts.status</code>.
          Soltar num outro dia reescreve <code className="font-mono">agendado_para</code>, que é{' '}
          <code className="font-mono">timestamptz</code> — o fuso do cliente fica à parte, só para renderizar.
        </p>
      </div>
    </>
  );
}

function Peca({
  post,
  aoArrastar,
  arrastando,
}: {
  post: Post;
  aoArrastar: (id: string | null) => void;
  arrastando: boolean;
}) {
  const { avisar } = useApp();
  return (
    <button
      draggable
      onDragStart={() => aoArrastar(post.id)}
      onDragEnd={() => aoArrastar(null)}
      onClick={() => avisar(`${ROTULO_STATUS[post.status]} · ${post.tituloInterno} · ${post.hora}`)}
      title={`${ROTULO_STATUS[post.status]} · ${post.hora}`}
      className={
        'flex w-full cursor-grab items-center gap-1.5 overflow-hidden rounded-[4px] border-l-[2.5px] bg-superficie-2 px-1.5 py-1 text-left text-[11.5px] leading-tight hover:bg-superficie-3 ' +
        COR_STATUS[post.status] +
        (arrastando ? ' opacity-35' : '')
      }
    >
      <time className="numeros shrink-0 text-[10.5px] text-tinta-3">{post.hora}</time>
      <span className="truncate">{post.tituloInterno}</span>
    </button>
  );
}
