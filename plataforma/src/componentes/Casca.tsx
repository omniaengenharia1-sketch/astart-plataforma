import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSessao } from '../sessao';
import { Logo } from './Marca';
import type { ChaveModulo } from '../dados/tipos';

/**
 * O título da aba do navegador. Sem isso toda tela se chama "Astart —
 * Plataforma", e quem trabalha com seis abas abertas não acha nenhuma.
 */
function useTitulo(itens: ItemMenu[], pathname: string, sufixo: string) {
  useEffect(() => {
    const atual = itens
      .filter((i) => (i.para === '/' ? pathname === '/' : pathname.startsWith(i.para)))
      .sort((a, b) => b.para.length - a.para.length)[0];
    document.title = atual ? `${atual.rotulo} · ${sufixo}` : sufixo;
  }, [itens, pathname, sufixo]);
}

/** Primeiro foco da página: pula o menu inteiro e cai no conteúdo. */
function PularParaConteudo() {
  return (
    <a
      href="#conteudo"
      className="sr-only rounded-full bg-superficie-3 px-4 py-2 focus:not-sr-only focus:absolute
 focus:top-3 focus:left-3 focus:z-50 focus:inline-block"
    >
      Pular para o conteúdo
    </a>
  );
}

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
  { para: '/feedbacks', rotulo: 'Feedbacks' },
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
      className="vidro-chapa sticky top-0 z-30 flex gap-2 overflow-x-auto border-b border-linha-fraca
 px-5 py-2 sm:px-8 lg:px-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {visiveis.map((i) => {
        const ativo = i.para === '/' ? pathname === '/' : pathname.startsWith(i.para);
        return (
          <NavLink
            key={i.para}
            to={i.para}
            aria-current={ativo ? 'page' : undefined}
            className={
              'risca flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 font-mono ' +
              'text-[10.5px] font-semibold tracking-[0.14em] whitespace-nowrap uppercase ' +
              'transition-colors duration-150 ' +
              (ativo
                ? 'bg-superficie-3 text-tinta shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]'
                : 'text-tinta-3 hover:text-tinta')
            }
          >
            {i.rotulo}
            {i.selo !== undefined && i.selo > 0 && (
              <span className="rounded-full bg-[linear-gradient(180deg,var(--pink-topo),var(--pink-base))] px-2 py-px text-[9.5px] text-sobre-pink shadow-[0_6px_16px_-8px_rgb(255_61_154/0.9)]">
                {i.selo}
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

/**
 * `marca` nulo = o cabeçalho é da Astart e mostra a logo. No portal do cliente
 * quem aparece grande é o nome DELE: a plataforma é nossa, a marca da tela é a
 * dele. A assinatura da Astart fica pequena embaixo.
 */
function Nameplate({ marca, sub, quem }: { marca: string | null; sub: string; quem: string }) {
  const { sair } = useSessao();
  return (
    <header className="flex items-end justify-between gap-4 px-5 pt-6 pb-4 sm:px-8 lg:px-12">
      <div className="min-w-0">
        {marca === null ? (
          <Logo altura={34} />
        ) : (
          <div className="titulao truncate text-[clamp(1.5rem,4vw,2.1rem)]">{marca}</div>
        )}
        <div className="rotulo mt-1.5 flex items-center gap-2">
          {sub}
          {marca !== null && <Logo altura={13} className="opacity-70" />}
        </div>
      </div>
      {/* No celular so a palavra: o botao de sair existia apenas em sm+, e quem
          entrasse pelo telefone nao tinha como sair da propria conta. */}
      <button
        onClick={() => void sair()}
        className="rotulo risca shrink-0 rounded-full px-1 hover:text-pink-texto"
      >
        <span className="hidden sm:inline">{quem} · </span>sair
      </button>
    </header>
  );
}

function AvisoExemplo() {
  const { ligado } = useSessao();
  if (ligado) return null;
  return (
    // <aside> e nao <div>: todo conteudo da pagina tem de morar dentro de uma
    // regiao com nome, senao quem navega por marcos pula este aviso.
    <aside
      aria-label="Aviso do ambiente"
      className="border-b border-linha-fraca bg-pink-fundo px-5 py-2 sm:px-8 lg:px-12"
    >
      <span className="rotulo-forte text-pink-texto">
        modo exemplo · dados fictícios
      </span>
    </aside>
  );
}

export function CascaEquipe({ children }: { children: ReactNode }) {
  const { sessao } = useSessao();
  const { pathname } = useLocation();
  const quem =
    sessao.tipo === 'equipe'
      ? `${sessao.perfil.nome ?? sessao.perfil.email} · ${PAPEL[sessao.perfil.papel] ?? sessao.perfil.papel}`
      : '';
  useTitulo(MENU_EQUIPE, pathname, 'Astart');

  return (
    <div className="min-h-dvh text-tinta">
      <PularParaConteudo />
      <Nameplate marca={null} sub="plataforma interna" quem={quem} />
      <Menu itens={MENU_EQUIPE} />
      <AvisoExemplo />
      {/* A chave e a rota: sem ela a animacao de entrada roda uma vez so, na
          primeira tela, e as outras aparecem secas. */}
      <main id="conteudo" key={pathname} className="entra" tabIndex={-1}>
        {children}
      </main>
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
  const { pathname } = useLocation();
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

  useTitulo(itens, pathname, nome || 'Astart');

  return (
    <div className="min-h-dvh text-tinta">
      <PularParaConteudo />
      <Nameplate marca={nome} sub="por" quem={quem} />
      <Menu itens={itens} modulos={modulos} />
      <AvisoExemplo />
      <main id="conteudo" key={pathname} className="entra" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
