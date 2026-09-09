import { NavLink, Outlet } from 'react-router-dom';
import { CLIENTES } from '../dados/mock';
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
  estado?: 'no_ar' | 'desenhado' | 'a_fazer';
}

const OPERACAO: ItemNav[] = [
  { para: '/', texto: 'Início', fim: true },
  { para: '/calendario', texto: 'Calendário' },
  { para: '/editor', texto: 'Editor de post' },
  { para: '/fila', texto: 'Fila' },
  { para: '/aprovacao', texto: 'Portal do cliente' },
];

const PLATAFORMA: ItemNav[] = [
  { para: '/clientes', texto: 'Clientes', estado: 'desenhado' },
  { para: '/financeiro', texto: 'Financeiro', estado: 'a_fazer' },
  { para: '/contratos', texto: 'Contratos', estado: 'a_fazer' },
  { para: '/crm', texto: 'CRM', estado: 'a_fazer' },
];

const SELO_ESTADO: Record<string, string> = {
  no_ar: 'no ar',
  desenhado: 'desenhado',
  a_fazer: 'a fazer',
};

function Item({ item }: { item: ItemNav }) {
  return (
    <NavLink
      to={item.para}
      end={item.fim}
      className={({ isActive }) =>
        'flex items-center gap-2.5 rounded-r-md border-l-2 px-2.5 py-2 text-[11px] font-semibold tracking-[0.09em] uppercase transition-colors ' +
        (isActive
          ? 'border-pink bg-superficie-2 text-pink-tinta'
          : 'border-transparent text-tinta-2 hover:bg-superficie-2 hover:text-tinta')
      }
    >
      {item.texto}
      {item.estado && (
        <span className="ml-auto rounded-full border border-linha-forte px-1.5 py-px font-mono text-[9px] font-normal tracking-normal normal-case text-tinta-3">
          {SELO_ESTADO[item.estado]}
        </span>
      )}
    </NavLink>
  );
}

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return (p[0]?.charAt(0) ?? '') + (p[1]?.charAt(0) ?? '');
}

export function Layout({ operador, aoTrocarOperador, clienteAtivo, setClienteAtivo, contexto }: Props) {
  const ativos = CLIENTES.filter((c) => c.ativo);
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[232px_1fr]">
      <nav className="sticky top-0 flex h-auto flex-col gap-5 border-b border-linha bg-superficie py-4 lg:h-screen lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex items-end gap-2.5 px-4.5">
          <span className="text-[16px] leading-[0.98] font-semibold tracking-tight lowercase">
            astart
            <br />
            studi<span className="text-pink">o</span>
          </span>
          <span className="pb-px font-mono text-[9.5px] tracking-wider text-tinta-3">plataforma</span>
        </div>

        <div className="flex flex-col gap-1 px-3">
          <span className="rotulo px-1.5 pb-0.5">Clientes</span>
          {ativos.map((c) => {
            const on = c.id === clienteAtivo;
            const pendentes = contexto.posts.filter((p) => p.clienteId === c.id && p.status !== 'publicado').length;
            return (
              <button
                key={c.id}
                aria-pressed={on}
                onClick={() => setClienteAtivo(c.id)}
                className={
                  'flex items-center gap-2.5 rounded-md border border-transparent px-2 py-1.5 text-left text-[13px] transition-colors ' +
                  (on ? 'bg-pink-suave font-semibold text-tinta' : 'text-tinta-2 hover:bg-superficie-2 hover:text-tinta')
                }
              >
                <i className="size-[7px] shrink-0 rounded-full" style={{ background: c.cor }} />
                <span className="truncate">{c.nome}</span>
                <span className="numeros ml-auto text-[11px] text-tinta-3">{pendentes}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5 px-3">
          <span className="rotulo px-1.5 pb-0.5">Operação</span>
          {OPERACAO.map((i) => (
            <Item key={i.para} item={i} />
          ))}
        </div>

        <div className="flex flex-col gap-1.5 px-3">
          <span className="rotulo px-1.5 pb-0.5">Plataforma</span>
          {PLATAFORMA.map((i) => (
            <Item key={i.para} item={i} />
          ))}
        </div>

        <div className="mt-auto hidden border-t border-linha px-4.5 pt-3 lg:block">
          <button
            onClick={aoTrocarOperador}
            className="mb-3 flex w-full items-center gap-2.5 rounded-full border border-linha p-1 pr-2.5 text-left transition-colors hover:border-pink"
          >
            <span
              className="grid size-6.5 shrink-0 place-items-center rounded-full font-display text-[12px] text-white"
              style={{ background: operador.cor }}
            >
              {iniciais(operador.nome)}
            </span>
            <span className="min-w-0">
              <span className="block text-[11.5px] leading-tight font-semibold">{operador.nome}</span>
              <span className="rotulo block">{operador.papel}</span>
            </span>
            <span className="rotulo ml-auto text-[9px]">trocar</span>
          </button>
          <p className="text-[11px] leading-snug text-tinta-3">
            <b className="text-tinta-2">Fase 1</b> — imagem única no Instagram. Carrossel, Reels e
            Facebook Page entram pelo mesmo adapter.
          </p>
        </div>
      </nav>

      <main className="flex min-w-0 flex-col">
        <Outlet context={contexto} />
      </main>
    </div>
  );
}

export function Cabecalho({
  titulo,
  linha,
  acoes,
}: {
  titulo: string;
  linha?: string;
  acoes?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6 pb-3.5">
      <div className="min-w-0">
        <h1 className="m-0 font-display text-[27px] leading-tight font-medium tracking-tight text-balance">
          {titulo}
        </h1>
        {linha && <p className="mt-1 max-w-[62ch] text-[12.5px] text-tinta-3">{linha}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </header>
  );
}
