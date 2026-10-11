import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSessao } from '../sessao';
import type { ChaveModulo } from '../dados/tipos';

const PAPEL: Record<string, string> = {
  admin: 'direção',
  operacao: 'operação',
  financeiro: 'financeiro',
  leitura: 'leitura',
};

/** Item de menu que depende de um módulo contratado. Sem ele, não é renderizado. */
export interface ItemMenu {
  para: string;
  rotulo: string;
  modulo?: ChaveModulo;
  selo?: number;
}

const MENU_EQUIPE: ItemMenu[] = [
  { para: '/', rotulo: 'Início' },
  { para: '/clientes', rotulo: 'Clientes' },
  { para: '/aprovacoes', rotulo: 'Aprovações' },
  { para: '/agenda', rotulo: 'Agenda' },
  { para: '/fila', rotulo: 'Fila' },
  { para: '/financeiro', rotulo: 'Financeiro' },
  { para: '/comercial', rotulo: 'Comercial' },
  { para: '/ajustes', rotulo: 'Ajustes' },
];

function Menu({ itens, modulos }: { itens: ItemMenu[]; modulos?: ChaveModulo[] }) {
  const { pathname } = useLocation();
  // Aba de módulo não contratado não existe: não fica cinza, não fica com
  // cadeado. É a mesma regra que o RLS aplica no banco.
  const visiveis = itens.filter((i) => !i.modulo || (modulos ?? []).includes(i.modulo));

  return (
    <nav
      aria-label="Seções"
      className="flex gap-6 overflow-x-auto border-b border-linha px-5 py-2.5 sm:px-8 lg:px-12
 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {visiveis.map((i) => {
        const ativo = i.para === '/' ? pathname === '/' : pathname.startsWith(i.para);
        return (
          <NavLink
            key={i.para}
            to={i.para}
            aria-current={ativo ? 'page' : undefined}
            className={
              'flex shrink-0 items-center gap-2 whitespace-nowrap px-2.5 py-1.5 font-mono ' +
              'text-[10px] font-semibold tracking-[0.16em] uppercase ' +
              (ativo ? 'bg-tinta text-papel' : 'text-tinta-3 hover:bg-superficie-2 hover:text-tinta')
            }
          >
            {i.rotulo}
            {i.selo !== undefined && i.selo > 0 && (
              <span
                className={
                  'px-1.5 py-px text-[9px] ' +
                  (ativo ? 'bg-pink text-sobre-pink' : 'bg-pink text-sobre-pink')
                }
              >
                {i.selo}
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

function Nameplate({ marca, sub, quem }: { marca: string; sub: string; quem: string }) {
  const { sair } = useSessao();
  return (
    <header className="flex items-end justify-between gap-4 border-b-2 border-tinta px-5 pt-5 pb-3 sm:px-8 lg:px-12">
      <div>
        <div className="titulao text-[clamp(1.5rem,4vw,2.1rem)]">{marca}</div>
        <div className="rotulo mt-1">{sub}</div>
      </div>
      {/* No celular so a palavra: o botao de sair existia apenas em sm+, e quem
          entrasse pelo telefone nao tinha como sair da propria conta. */}
      <button onClick={() => void sair()} className="rotulo shrink-0 hover:text-pink">
        <span className="hidden sm:inline">{quem} · </span>sair
      </button>
    </header>
  );
}

function AvisoExemplo() {
  const { ligado } = useSessao();
  if (ligado) return null;
  return (
    <div className="border-b-2 border-linha bg-pink px-5 py-2 sm:px-8 lg:px-12">
      <span className="rotulo-forte text-sobre-pink">
        modo exemplo — sem Supabase configurado, os dados desta tela são fictícios
      </span>
    </div>
  );
}

export function CascaEquipe({ children }: { children: ReactNode }) {
  const { sessao } = useSessao();
  const quem =
    sessao.tipo === 'equipe'
      ? `${sessao.perfil.nome ?? sessao.perfil.email} · ${PAPEL[sessao.perfil.papel] ?? sessao.perfil.papel}`
      : '';
  return (
    <div className="min-h-dvh bg-papel text-tinta">
      <Nameplate marca="Astart" sub="Plataforma interna" quem={quem} />
      <Menu itens={MENU_EQUIPE} />
      <AvisoExemplo />
      <main>{children}</main>
    </div>
  );
}

export function CascaCliente({
  modulos,
  aprovacoesAbertas,
  children,
}: {
  modulos: ChaveModulo[];
  aprovacoesAbertas: number;
  children: ReactNode;
}) {
  const { sessao } = useSessao();
  const nome = sessao.tipo === 'cliente' ? sessao.clienteAtual.nome : '';
  const quem = sessao.tipo === 'cliente' ? sessao.nome : '';

  const itens: ItemMenu[] = [
    { para: '/portal', rotulo: 'Início' },
    { para: '/portal/aprovar', rotulo: 'Para aprovar', selo: aprovacoesAbertas },
    { para: '/portal/projeto', rotulo: 'Meu projeto', modulo: 'entregaveis' },
    { para: '/portal/calendario', rotulo: 'Calendário', modulo: 'calendario' },
    { para: '/portal/grid', rotulo: 'Grid', modulo: 'grid' },
    { para: '/portal/campanhas', rotulo: 'Campanhas', modulo: 'campanhas' },
    { para: '/portal/galeria', rotulo: 'Galeria', modulo: 'galeria' },
    { para: '/portal/site', rotulo: 'Meu site', modulo: 'ambientes' },
    { para: '/portal/acervo', rotulo: 'Acervo', modulo: 'acervo' },
    { para: '/portal/financeiro', rotulo: 'Financeiro', modulo: 'financeiro' },
    { para: '/portal/contrato', rotulo: 'Contrato', modulo: 'contrato' },
    { para: '/portal/feedback', rotulo: 'Feedback', modulo: 'nps' },
  ];

  return (
    <div className="min-h-dvh bg-papel text-tinta">
      <Nameplate marca={nome} sub="por Astart Studio" quem={quem} />
      <Menu itens={itens} modulos={modulos} />
      <AvisoExemplo />
      <main>{children}</main>
    </div>
  );
}
