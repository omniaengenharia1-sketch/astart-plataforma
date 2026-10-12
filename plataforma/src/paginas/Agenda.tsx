import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { agenda } from '../dados/api';
import { diaMes, plural, porExtenso } from '../formato';
import type { EventoNaAgenda } from '../dados/tipos';

type Tipo = EventoNaAgenda['tipo'];

const NOME: Record<Tipo, string> = {
  publicacao: 'publicação',
  captacao: 'captação',
  marco: 'marco',
  cobranca: 'cobrança',
};

const JANELAS = [
  { dias: 7, rotulo: '7 dias' },
  { dias: 15, rotulo: '15 dias' },
  { dias: 30, rotulo: '30 dias' },
] as const;

const hojeISO = () => new Date().toISOString().slice(0, 10);

function emDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 'hoje' e 'amanhã' valem mais que a data: é como a equipe fala. */
function comoDia(iso: string): string {
  if (iso === hojeISO()) return 'hoje';
  if (iso === emDias(1)) return 'amanhã';
  return porExtenso(iso);
}

export function Agenda() {
  const [dias, setDias] = useState<number>(15);
  const [eventos, setEventos] = useState<EventoNaAgenda[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [so, setSo] = useState<Tipo | 'tudo'>('tudo');

  const carregar = useCallback(async () => {
    setErro(null);
    setEventos(null);
    try {
      setEventos(await agenda(hojeISO(), emDias(dias)));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir a agenda.');
    }
  }, [dias]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!eventos) return <Carregando oQue="a agenda" />;

  const lista = so === 'tudo' ? eventos : eventos.filter((e) => e.tipo === so);
  const conta = (t: Tipo) => eventos.filter((e) => e.tipo === t).length;

  // Agrupado por dia: a agenda é lida por dia, não por item.
  const porDia = new Map<string, EventoNaAgenda[]>();
  for (const e of lista) {
    const atual = porDia.get(e.quando) ?? [];
    atual.push(e);
    porDia.set(e.quando, atual);
  }

  const hoje = eventos.filter((e) => e.quando === hojeISO());

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <div className="rotulo">agenda</div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <h1 className="titulao text-[clamp(1.8rem,5vw,2.8rem)]">
            {hoje.length === 0
              ? 'Hoje está livre.'
              : `Hoje tem ${plural(hoje.length, 'coisa', 'coisas')}.`}
          </h1>
          <div className="flex flex-wrap gap-2">
            {JANELAS.map((j) => (
              <Botao
                key={j.dias}
                tamanho="pequeno"
                variante={dias === j.dias ? 'primario' : 'secundario'}
                onClick={() => setDias(j.dias)}
              >
                {j.rotulo}
              </Botao>
            ))}
          </div>
        </div>
      </div>

      <div className="escada mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Bloco rotulo="Publicações" destaque={String(conta('publicacao'))} />
        <Bloco rotulo="Captações" destaque={String(conta('captacao'))} />
        <Bloco rotulo="Marcos" destaque={String(conta('marco'))} />
        <Bloco rotulo="Cobranças" destaque={String(conta('cobranca'))} />
      </div>

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

      {lista.length === 0 ? (
        <Vazio
          titulo="Nada marcado."
          explica="Peça agendada, captação, marco e cobrança aparecem aqui juntos."
        />
      ) : (
        <div className="mt-8">
          {[...porDia.entries()].map(([dia, doDia]) => (
            <section key={dia} className="mb-8">
              <Fita>
                {comoDia(dia)} <span className="numeros ml-2 text-tinta-3">{diaMes(dia)}</span>
              </Fita>
              <ul className="border-t border-linha-fraca">
                {doDia.map((e, i) => (
                  <li
                    key={`${e.tipo}-${e.oQue}-${i}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-3 py-3.5"
                  >
                    <span className="w-24 shrink-0">
                      <Marca forte={e.tipo === 'cobranca' && e.detalhe === 'atrasado'}>
                        {NOME[e.tipo]}
                      </Marca>
                    </span>
                    <Link
                      to={`/clientes/${e.clienteId}`}
                      className="risca w-40 shrink-0 font-bold uppercase hover:text-pink-texto"
                    >
                      {e.clienteNome}
                    </Link>
                    <span className="min-w-48 flex-1 font-medium">{e.oQue}</span>
                    {e.detalhe && <span className="rotulo">{e.detalhe}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
