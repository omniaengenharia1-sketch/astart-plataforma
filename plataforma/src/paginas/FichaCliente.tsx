import { useCallback, useEffect, useState } from 'react';
import { NavLink, Link, useParams } from 'react-router-dom';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { fichaCliente } from '../dados/api';
import { diaMes, haQuanto, reais } from '../formato';
import { FORMATO, MODULO, PAPEL_CLIENTE, STATUS_SERVICO, TIPO_ITEM } from '../rotulos';
import { Calendario } from './Calendario';
import { Projeto } from './Projeto';
import type { ChaveModulo, FichaCliente as Ficha, ServicoContratado } from '../dados/tipos';

/** Como o contrato é lido numa linha: formato manda no que faz sentido mostrar. */
function comoCobra(s: ServicoContratado): string {
  if (s.formato === 'recorrente') {
    return s.diaVencimento ? `${reais(s.valorCentavos)} · todo dia ${s.diaVencimento}` : reais(s.valorCentavos);
  }
  if (s.parcelas && s.parcelas > 1) {
    return `${reais(s.valorCentavos)} · ${s.parcelas}x`;
  }
  return `${reais(s.valorCentavos)} · à vista`;
}

export function FichaCliente() {
  const params = useParams();
  const clienteId = params['clienteId'] ?? '';
  // A aba ativa vem do resto da rota: /clientes/:id/<modulo>. Assim o cabecalho
  // e as abas continuam na tela enquanto a aba de dentro troca.
  const aba = (params['*'] ?? '').split('/')[0] ?? '';
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setFicha(await fichaCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir este cliente.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!ficha) return <Carregando oQue="o cliente" />;

  const ativos = ficha.servicos.filter((s) => s.status === 'ativo');

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <Link to="/clientes" className="rotulo hover:text-pink">
          &lt; clientes
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="titulao text-[clamp(1.8rem,5vw,2.8rem)]">{ficha.cliente.nome}</h1>
            <div className="rotulo mt-1.5">
              {ficha.cliente.slug} · {ficha.cliente.fusoHorario}
            </div>
          </div>
          {!ficha.cliente.ativo && <Marca forte>cliente inativo</Marca>}
        </div>
      </div>

      {/* As abas são os módulos que o contrato dele liga. Módulo não contratado
          não aparece desabilitado: não existe. */}
      <nav
        aria-label="Seções do cliente"
        className="mt-6 flex gap-2 overflow-x-auto border-y-2 border-linha py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <NavLink
          to={`/clientes/${clienteId}`}
          end
          className={({ isActive }) =>
            'shrink-0 px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.16em] uppercase ' +
            (isActive ? 'bg-tinta text-papel' : 'text-tinta-3 hover:bg-superficie-2 hover:text-tinta')
          }
        >
          Visão geral
        </NavLink>
        {ficha.modulos.map((m) => (
          <NavLink
            key={m}
            to={`/clientes/${clienteId}/${m}`}
            className={({ isActive }) =>
              'shrink-0 px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.16em] uppercase whitespace-nowrap ' +
              (isActive ? 'bg-tinta text-papel' : 'text-tinta-3 hover:bg-superficie-2 hover:text-tinta')
            }
          >
            {MODULO[m]}
          </NavLink>
        ))}
      </nav>

      {aba === 'entregaveis' || aba === 'marcos' ? (
        <Projeto clienteId={clienteId} equipe />
      ) : aba === 'calendario' || aba === 'publicacao' ? (
        <Calendario clienteId={clienteId} equipe />
      ) : aba !== '' ? (
        <Vazio
          titulo={MODULO[aba as ChaveModulo] ?? 'Seção'}
          explica="Esta aba ainda não foi construída. O contrato deste cliente já a liga, e ela aparece aqui porque o serviço contratado pede."
        />
      ) : (
      <>
      <div className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Bloco rotulo="Serviços ativos" destaque={String(ativos.length)} />
        <Bloco rotulo="Por mês" destaque={reais(ficha.mensalCentavos)} />
        <Bloco rotulo="Em projeto" destaque={reais(ficha.unicoCentavos)} />
        <Bloco
          rotulo="Precisa de você"
          destaque={String(ficha.pendencias.length)}
          alerta={ficha.pendencias.length > 0}
          sombra={ficha.pendencias.length > 0}
        />
      </div>

      <div className="mt-9 grid items-start gap-9 lg:grid-cols-[1fr_340px]">
        <div>
          <Fita>Contrato</Fita>
          {ficha.servicos.length === 0 ? (
            <Vazio titulo="Sem serviço contratado." explica="É o contrato que liga as telas deste cliente." />
          ) : (
            <ul className="border-t-2 border-linha">
              {ficha.servicos.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-x-2 border-b-2 border-linha px-3 py-3.5"
                >
                  <span className="w-44 shrink-0 font-bold uppercase">{s.servicoNome}</span>
                  <Marca>{FORMATO[s.formato]}</Marca>
                  {s.status !== 'ativo' && <Marca forte>{STATUS_SERVICO[s.status]}</Marca>}
                  <span className="numeros min-w-48 flex-1 text-[13px]">{comoCobra(s)}</span>
                  <span className="rotulo w-28 shrink-0">{s.responsavelNome ?? 'sem responsável'}</span>
                  {s.entregaEm && <span className="rotulo w-24 shrink-0">entrega {diaMes(s.entregaEm)}</span>}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-9" />
          <Fita>Precisa de você</Fita>
          {ficha.pendencias.length === 0 ? (
            <p className="py-4 text-tinta-3">Nada voltou com ajuste.</p>
          ) : (
            <ul className="border-t-2 border-linha">
              {ficha.pendencias.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-x-2 border-b-2 border-l-8 border-linha border-l-pink px-3 py-3.5"
                >
                  <Marca>{TIPO_ITEM[p.tipo]}</Marca>
                  <span className="min-w-48 flex-1 font-medium">{p.titulo}</span>
                  <span className="rotulo">{haQuanto(p.quando)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-9" />
          <Fita>O que já andou</Fita>
          {ficha.movimentos.length === 0 ? (
            <p className="py-4 text-tinta-3">Nenhuma resposta do cliente ainda.</p>
          ) : (
            <ul>
              {ficha.movimentos.map((m, i) => (
                <li
                  key={`${m.quando}-${i}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 border-linha-fraca py-3"
                >
                  <span className="rotulo w-24 shrink-0">{haQuanto(m.quando)}</span>
                  <span className="flex-1">{m.oQue}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside>
          <Fita>Quem responde</Fita>
          {ficha.contatos.length === 0 ? (
            <p className="py-4 text-tinta-3">Ninguém com acesso ainda.</p>
          ) : (
            <ul>
              {ficha.contatos.map((c) => (
                <li key={c.email} className="border-b-2 border-linha-fraca py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold uppercase">{c.nome}</span>
                    {!c.ativo && <Marca>sem acesso</Marca>}
                  </div>
                  <div className="mt-0.5 font-mono text-[11.5px] break-all text-tinta-2">{c.email}</div>
                  <div className="rotulo mt-0.5">{PAPEL_CLIENTE[c.papel]}</div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-8" />
          <Fita>Ligado para ele</Fita>
          <div className="flex flex-wrap gap-1.5 pt-3">
            {ficha.modulos.map((m) => (
              <Marca key={m}>{MODULO[m]}</Marca>
            ))}
          </div>
          <p className="rotulo mt-3">
            {ativos.length === 0
              ? 'só o que todo cliente tem'
              : `ligado pelos ${ativos.length === 1 ? 'serviço' : 'serviços'} do contrato`}
          </p>
        </aside>
      </div>
      </>
      )}
    </div>
  );
}
