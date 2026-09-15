import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cabecalho } from '../componentes/Layout';
import { Tabela, type Coluna } from '../componentes/Tabela';
import { Pilula, type TomPilula } from '../componentes/Pilula';
import { Botao } from '../componentes/Botao';
import { Segmentado } from '../componentes/Segmentado';
import { CLIENTES, POSTS } from '../dados/mock';
import type { AcessoParceiro, Cliente, Perfil } from '../dados/tipos';

const TOM_ACESSO: Record<AcessoParceiro, TomPilula> = {
  concedido: 'ok',
  pendente: 'espera',
  expirado: 'falha',
};

/** O acesso de um cliente é o pior acesso entre as contas dele. */
export function piorAcesso(c: Cliente): AcessoParceiro {
  const ordem: Record<AcessoParceiro, number> = { expirado: 0, pendente: 1, concedido: 2 };
  const ativas = c.contas.filter((x) => x.ativo);
  if (ativas.length === 0) return 'expirado';
  return ativas.reduce<AcessoParceiro>(
    (pior, x) => (ordem[x.acessoParceiro] < ordem[pior] ? x.acessoParceiro : pior),
    'concedido',
  );
}

export function Clientes({ operador }: { operador: Perfil }) {
  const nav = useNavigate();
  const [filtro, setFiltro] = useState<'ativos' | 'todos'>('ativos');

  const podeCadastrar = operador.papel === 'admin';
  const linhas = CLIENTES.filter((c) => filtro === 'todos' || c.ativo);

  const colunas: Coluna<Cliente>[] = [
    {
      chave: 'cliente',
      titulo: 'Cliente',
      larguraMin: '220px',
      busca: (c) => `${c.nome} ${c.slug}`,
      render: (c) => (
        <>
          <span className="flex items-center gap-2">
            <i className="size-[7px] shrink-0 rounded-full" style={{ background: c.cor }} />
            <b className="text-[13px] font-semibold">{c.nome}</b>
            {!c.ativo && <Pilula tom="neutro">inativo</Pilula>}
          </span>
          <span className="block text-[11px] text-tinta-3">
            {c.slug} · {c.fusoHorario.split('/')[1]?.replace('_', ' ')} · desde {c.desde}
          </span>
        </>
      ),
    },
    {
      chave: 'contas',
      titulo: 'Contas conectadas',
      busca: (c) => c.contas.map((x) => x.nomeExibicao).join(' '),
      render: (c) =>
        c.contas.length === 0 ? (
          <span className="rotulo">nenhuma conta</span>
        ) : (
          <span className="flex flex-col gap-0.5">
            {c.contas.map((x) => (
              <span key={x.id}>
                <span className="text-[12px]">{x.nomeExibicao}</span>{' '}
                <span className="rotulo">{x.plataforma}</span>
              </span>
            ))}
          </span>
        ),
    },
    {
      chave: 'acesso',
      titulo: 'Acesso',
      render: (c) => {
        const a = piorAcesso(c);
        return <Pilula tom={TOM_ACESSO[a]}>{a}</Pilula>;
      },
    },
    {
      chave: 'token',
      titulo: 'Token',
      render: (c) => {
        const oauth = c.contas.find((x) => x.origemToken === 'oauth');
        return (
          <>
            <span className="block text-[12px]">{oauth ? 'OAuth do cliente' : 'System User'}</span>
            <span className="rotulo block">
              {oauth ? `vence ${oauth.tokenExpiraEm}` : 'BM da Astart · não expira'}
            </span>
          </>
        );
      },
    },
    {
      chave: 'aprovacao',
      titulo: 'Aprovação',
      render: (c) =>
        c.linkAprovacao && !c.linkAprovacao.revogado ? (
          <>
            <Pilula tom="ok">ativo</Pilula>
            <span className="rotulo mt-0.5 block">expira {c.linkAprovacao.expiraEm}</span>
          </>
        ) : (
          <span className="rotulo">sem link</span>
        ),
    },
    {
      chave: 'mes',
      titulo: 'No mês',
      render: (c) => {
        const doMes = POSTS.filter((p) => p.clienteId === c.id);
        const pub = doMes.filter((p) => p.status === 'publicado' || p.status === 'publicado_parcial').length;
        return (
          <>
            <span className="numeros block text-[13px]">
              {pub} / {doMes.length}
            </span>
            <span className="rotulo block">publicados</span>
          </>
        );
      },
    },
  ];

  return (
    <>
      <Cabecalho
        titulo="Clientes"
        linha="O cadastro que os outros módulos consomem. É aqui que se vê se o acesso de parceiro no Business Manager está de pé — sem ele, nada publica."
      />
      <div className="px-6 pb-8">
        <Tabela
          linhas={linhas}
          colunas={colunas}
          chaveDe={(c) => c.id}
          aoClicar={(c) => nav(`/clientes/${c.id}`)}
          placeholderBusca="Buscar cliente…"
          vazio="Nenhum cliente neste filtro."
          acoes={
            <>
              <Segmentado
                rotuloGrupo="Filtro de clientes"
                valor={filtro}
                aoTrocar={setFiltro}
                opcoes={[
                  { valor: 'ativos', texto: 'Ativos' },
                  { valor: 'todos', texto: 'Todos' },
                ]}
              />
              {podeCadastrar && (
                <Botao variante="primario" tamanho="pequeno">
                  Novo cliente
                </Botao>
              )}
            </>
          }
        />

        {!podeCadastrar && (
          <p className="mt-3 text-[11.5px] text-tinta-3">
            Cadastrar cliente mexe em token e em acesso de Business Manager, então é restrito a{' '}
            <b className="text-tinta-2">admin</b>. Você está como <b className="text-tinta-2">{operador.papel}</b>.
          </p>
        )}

        <p className="mt-5 max-w-[78ch] border-l-2 border-linha-forte py-1 pl-3.5 text-[11.5px] leading-relaxed text-tinta-3">
          <b className="text-tinta-2">O que já existe no banco:</b> <code className="font-mono">clientes</code>,{' '}
          <code className="font-mono">contas_sociais</code> e <code className="font-mono">links_aprovacao</code>{' '}
          foram criadas nas migrations da Fase 1, com RLS. O que falta é esta tela gravar nelas — hoje o
          cadastro só acontece por SQL.
        </p>
      </div>
    </>
  );
}
