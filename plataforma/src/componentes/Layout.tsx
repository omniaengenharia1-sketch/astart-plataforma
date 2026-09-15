import { NavLink, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { CLIENTES } from '../dados/mock';
import { ANO, HOJE, MES } from '../contexto';
import type { CtxApp } from '../contexto';
import type { Perfil } from '../dados/tipos';

interface Props {
  operador: Perfil;
  aoTrocarOperador: () => void;
  clienteAtivo: string;
  setClienteAtivo: (id: string) => void;
  contexto: CtxApp;
}

interface ItemNav {
  para: string;
  texto: string;
  fim?: boolean;
  /** Módulo sem tela ainda: aparece apagado, mas aparece. */
  futuro?: boolean;
}

const NAV: ItemNav[] = [
  { para: '/', texto: 'Início', fim: true },
  { para: '/calendario', texto: 'Calendário' },
  { para: '/editor', texto: 'Editor' },
  { para: '/fila', texto: 'Fila' },
  { para: '/aprovacao', texto: 'Portal' },
  { para: '/clientes', texto: 'Clientes' },
  { para: '/financeiro', texto: 'Financeiro', futuro: true },
  { para: '/contratos', texto: 'Contratos', futuro: true },
  { para: '/crm', texto: 'CRM', futuro: true },
];

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function dataPorExtenso(d: Date) {
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/**
 * Chrome da plataforma: chapa de jornal e menu horizontal, não trilho lateral.
 * O trilho era a parte mais genérica do desenho anterior — todo SaaS tem um.
 */
export function Layout({ operador, aoTrocarOperador, clienteAtivo, setClienteAtivo, contexto }: Props) {
  const ativos = CLIENTES.filter((c) => c.ativo);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="px-6 pt-5 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-tinta pb-2.5">
          <span className="text-[22px] leading-none font-bold tracking-[0.34em] uppercase">
            Astart<span className="text-pink">.</span>
          </span>
          <button
            onClick={aoTrocarOperador}
            className="font-mono text-[11px] tracking-[0.08em] text-tinta-2 uppercase hover:text-pink-tinta"
            title="Trocar de operador"
          >
            {dataPorExtenso(new Date(ANO, MES, HOJE))} · {operador.nome} · {operador.papel}
          </button>
        </div>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-tinta py-2">
          {NAV.map((i) => (
            <NavLink
              key={i.para}
              to={i.para}
              end={i.fim}
              className={({ isActive }) =>
                'text-[10.5px] font-semibold tracking-[0.16em] uppercase transition-colors ' +
                (isActive
                  ? '-mb-[9px] border-b-2 border-pink pb-[7px] text-tinta'
                  : i.futuro
                    ? 'text-linha-forte hover:text-tinta-3'
                    : 'text-tinta-3 hover:text-tinta')
              }
            >
              {i.texto}
            </NavLink>
          ))}
          <Tick />
        </nav>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-linha py-1.5">
          <span className="rotulo">Clientes</span>
          {ativos.map((c) => {
            const on = c.id === clienteAtivo;
            const pendentes = contexto.posts.filter(
              (p) => p.clienteId === c.id && p.status !== 'publicado',
            ).length;
            return (
              <button
                key={c.id}
                aria-pressed={on}
                onClick={() => setClienteAtivo(c.id)}
                className={
                  'flex items-center gap-1.5 text-[11.5px] transition-colors ' +
                  (on ? 'font-semibold text-tinta' : 'text-tinta-3 hover:text-tinta')
                }
              >
                {on && <i className="size-[6px] rounded-full" style={{ background: c.cor }} />}
                {c.nome}
                <span className="numeros text-[10px] text-tinta-3">{pendentes}</span>
              </button>
            );
          })}
        </div>
      </header>

      <main className="flex min-w-0 flex-1 flex-col px-6 lg:px-10">
        <Outlet context={contexto} />
      </main>
    </div>
  );
}

/**
 * O batimento do tick. Nenhum outro painel tem isto porque nenhum outro é
 * movido por um cron de um minuto — por isso ele fica visível.
 */
function Tick() {
  const agora = new Date();
  const segundos = agora.getSeconds();
  return (
    <span className="ml-auto flex items-center gap-2 font-mono text-[10.5px] tracking-[0.06em] text-tinta-3">
      TICK
      <span className="relative h-[3px] w-20 bg-linha">
        <i
          className="absolute inset-y-0 left-0 bg-pink"
          style={{ right: `${100 - (segundos / 60) * 100}%` }}
        />
      </span>
      <b className="font-medium text-tinta">{agora.toLocaleTimeString('pt-BR', { hour12: false })}</b>
      <span>· próximo em {60 - segundos}s</span>
    </span>
  );
}

/** Cabeçalho das telas internas. O Início não usa: lá a manchete faz esse papel. */
export function Cabecalho({
  titulo,
  linha,
  acoes,
}: {
  titulo: string;
  linha?: string;
  acoes?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-tinta pt-6 pb-3">
      <div className="min-w-0">
        <h1 className="m-0 font-display text-[30px] leading-tight font-normal tracking-tight text-balance">
          {titulo}
        </h1>
        {linha && <p className="mt-1.5 max-w-[68ch] text-[12.5px] text-tinta-3">{linha}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  );
}
