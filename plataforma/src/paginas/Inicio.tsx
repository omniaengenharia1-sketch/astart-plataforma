import { useNavigate } from 'react-router-dom';
import { Cabecalho } from '../componentes/Layout';
import { CLIENTES } from '../dados/mock';
import { ESTADOS_EM_VOO, useApp } from '../contexto';
import type { Perfil } from '../dados/tipos';

type Estado = 'no_ar' | 'desenhado' | 'a_fazer';

const SELO: Record<Estado, { texto: string; classe: string }> = {
  no_ar: { texto: 'no ar', classe: 'bg-ok-suave text-ok' },
  desenhado: { texto: 'desenhado', classe: 'bg-espera-suave text-espera' },
  a_fazer: { texto: 'a fazer', classe: 'border border-linha-forte text-tinta-3' },
};

interface Bloco {
  titulo: string;
  desc: string;
  para: string;
  estado: Estado;
}

const CONTEUDO: Bloco[] = [
  { titulo: 'Calendário', desc: 'O mês inteiro por cliente. Arraste para reagendar.', para: '/calendario', estado: 'desenhado' },
  { titulo: 'Editor de post', desc: 'Legenda, arquivo, destino e preview do feed.', para: '/editor', estado: 'desenhado' },
  { titulo: 'Fila de publicação', desc: 'O que está saindo, o que falhou e por quê.', para: '/fila', estado: 'desenhado' },
  { titulo: 'Portal do cliente', desc: 'O link de aprovação, do lado de quem aprova.', para: '/aprovacao', estado: 'desenhado' },
];

const RESTO: Bloco[] = [
  { titulo: 'Clientes', desc: 'O cadastro único que costura os módulos.', para: '/clientes', estado: 'desenhado' },
  { titulo: 'Financeiro', desc: 'Quanto entra por cliente, quando entra e o que não entrou.', para: '/financeiro', estado: 'a_fazer' },
  { titulo: 'Contratos', desc: 'Vigência, escopo e reajuste em um lugar só.', para: '/contratos', estado: 'a_fazer' },
  { titulo: 'CRM', desc: 'O funil antes do cliente virar cliente.', para: '/crm', estado: 'a_fazer' },
];

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function Alerta({
  n,
  titulo,
  desc,
  tom,
  para,
}: {
  n: number;
  titulo: string;
  desc: string;
  tom: 'falha' | 'espera' | 'ok';
  para: string;
}) {
  const nav = useNavigate();
  const borda = n === 0 ? 'border-l-ok' : tom === 'falha' ? 'border-l-falha' : tom === 'espera' ? 'border-l-espera' : 'border-l-ok';
  const cor = n === 0 ? 'text-ok' : tom === 'falha' ? 'text-falha' : tom === 'espera' ? 'text-espera' : 'text-ok';
  return (
    <button
      onClick={() => nav(para)}
      className={`flex flex-col items-start gap-1 rounded-md border border-l-3 border-linha bg-superficie px-3.5 py-3 text-left transition-colors hover:border-linha-forte ${borda}`}
    >
      <span className={`numeros text-[25px] leading-none font-medium ${cor}`}>{n}</span>
      <span className="text-[12.5px] font-semibold">{titulo}</span>
      <span className="text-[11px] leading-snug text-tinta-3">{desc}</span>
    </button>
  );
}

function CartaoBloco({ b }: { b: Bloco }) {
  const nav = useNavigate();
  const futuro = b.estado === 'a_fazer';
  return (
    <button
      onClick={() => nav(b.para)}
      className={
        'flex min-h-32 flex-col items-start gap-1.5 rounded-lg border p-4 text-left transition-all ' +
        (futuro
          ? 'border-dashed border-linha bg-superficie-2'
          : 'border-linha bg-superficie hover:-translate-y-0.5 hover:border-pink')
      }
    >
      <span className="text-[13.5px] font-semibold">{b.titulo}</span>
      <span className="text-[11.5px] leading-relaxed text-tinta-3">{b.desc}</span>
      <span className={`mt-auto rounded-full px-2 py-0.5 font-mono text-[9px] tracking-wider ${SELO[b.estado].classe}`}>
        {SELO[b.estado].texto}
      </span>
    </button>
  );
}

export function Inicio({ operador }: { operador: Perfil }) {
  const { posts, alvos } = useApp();
  const falhas = alvos.filter((a) => a.estado === 'falhou').length;
  const esperando = posts.filter((p) => p.status === 'aguardando_aprovacao').length;
  const naFila = alvos.filter((a) => ESTADOS_EM_VOO.includes(a.estado)).length;
  const clientesAtivos = CLIENTES.filter((c) => c.ativo).length;
  const acessoTravado = CLIENTES.filter((c) =>
    c.contas.some((x) => x.ativo && x.acessoParceiro !== 'concedido'),
  ).length;

  return (
    <>
      <Cabecalho
        titulo={`${saudacao()}, ${operador.nome}.`}
        linha={
          falhas
            ? `Tem ${falhas} peça(s) travada(s) esperando alguém. O resto está andando sozinho.`
            : 'Nada travado. A fila está andando sozinha.'
        }
      />

      <div className="px-6 pb-8">
        <p className="rotulo mb-3">Precisa de você agora</p>
        <div className="mb-7 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          <Alerta n={falhas} titulo="Falharam" desc="Motivo legível e botão de tentar de novo." tom="falha" para="/fila" />
          <Alerta n={esperando} titulo="Esperando o cliente" desc="Peças paradas no portal de aprovação." tom="espera" para="/aprovacao" />
          <Alerta n={naFila} titulo="Na fila agora" desc="Avançando um passo por minuto." tom="ok" para="/fila" />
          <Alerta n={acessoTravado} titulo="Acesso pendente" desc="Conta sem permissão de parceiro no BM." tom="espera" para="/clientes" />
        </div>

        <div className="mb-3.5 flex items-center gap-3">
          <span className="rotulo whitespace-nowrap">Operação de conteúdo</span>
          <span className="h-px flex-1 bg-linha" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-3.5">
          {CONTEUDO.map((b) => (
            <CartaoBloco key={b.para} b={b} />
          ))}
        </div>

        <div className="mt-7 mb-3.5 flex items-center gap-3">
          <span className="rotulo whitespace-nowrap">Resto da plataforma</span>
          <span className="h-px flex-1 bg-linha" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-3.5">
          {RESTO.map((b) => (
            <CartaoBloco key={b.para} b={b} />
          ))}
        </div>

        <p className="mt-6 max-w-[78ch] border-l-2 border-linha-forte py-1 pl-3.5 text-[11.5px] leading-relaxed text-tinta-3">
          <b className="text-tinta-2">Como ler esta home:</b> <b className="text-tinta-2">no ar</b> tem
          código rodando. <b className="text-tinta-2">desenhado</b> tem a tela e as regras acordadas, mas
          ainda não grava nada. <b className="text-tinta-2">a fazer</b> é só estrutura. Estamos indo módulo
          a módulo — primeiro o visual, depois a API. Os {clientesAtivos} clientes ativos são a mesma
          tabela em todos eles.
        </p>
      </div>
    </>
  );
}
