import { useCallback, useEffect, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada, Escolha } from '../componentes/Campo';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { funil as pedirFunil, moverLead } from '../dados/api';
import { diaMes, haQuanto, plural, reais } from '../formato';
import { ETAPAS_ABERTAS, ETAPA_LEAD } from '../rotulos';
import type { EtapaLead, Funil, LeadNoFunil } from '../dados/tipos';

const DESTINOS: EtapaLead[] = [...ETAPAS_ABERTAS, 'fechado', 'perdido', 'descartado'];

/** Lead com próximo passo para trás é o que some do radar. */
function atrasado(l: LeadNoFunil): boolean {
  return !!l.proximoEm && l.proximoEm < new Date().toISOString().slice(0, 10);
}

function Cartao({
  l,
  aoMover,
}: {
  l: LeadNoFunil;
  aoMover: (etapa: EtapaLead, motivo?: string) => Promise<void>;
}) {
  const [abrindo, setAbrindo] = useState(false);
  const [etapa, setEtapa] = useState<EtapaLead>(l.etapa);
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const atencao = atrasado(l);

  async function mover() {
    if (salvando) return;
    setSalvando(true);
    try {
      await aoMover(etapa, motivo);
      setAbrindo(false);
      setMotivo('');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <li className={'bloco p-4 ' + (atencao ? 'border-l-2 border-l-pink' : '')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold uppercase">{l.nome}</div>
          {l.empresa && <div className="rotulo mt-0.5">{l.empresa}</div>}
        </div>
        {l.valorCentavos !== null && (
          <span className="numeros shrink-0 text-[14px] font-extrabold">
            {reais(l.valorCentavos)}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Marca>{ETAPA_LEAD[l.etapa]}</Marca>
        {l.origem && <span className="rotulo">veio de {l.origem}</span>}
        {l.responsavelNome && <span className="rotulo">· {l.responsavelNome}</span>}
      </div>

      {l.proximoPasso && (
        <p className="mt-3 text-[13.5px]">
          <span className="rotulo">próximo passo</span>
          <br />
          {l.proximoPasso}
          {l.proximoEm && (
            <span className={atencao ? 'rotulo-forte ml-2 text-pink-texto' : 'rotulo ml-2'}>
              {diaMes(l.proximoEm)}
            </span>
          )}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="rotulo">
          {l.ultimaEm ? `falou ${haQuanto(l.ultimaEm)}` : 'ninguém falou ainda'}
        </span>
        <Botao variante="texto" tamanho="pequeno" onClick={() => setAbrindo((v) => !v)}>
          {abrindo ? 'Fechar' : 'Mover'}
        </Botao>
      </div>

      {abrindo && (
        <div className="mt-3 border-t border-linha-fraca pt-3">
          <Campo id={`etapa-${l.id}`} rotulo="Para onde">
            <Escolha
              id={`etapa-${l.id}`}
              value={etapa}
              onChange={(e) => setEtapa(e.target.value as EtapaLead)}
            >
              {DESTINOS.map((d) => (
                <option key={d} value={d}>
                  {ETAPA_LEAD[d]}
                </option>
              ))}
            </Escolha>
          </Campo>

          {/* A regra é do banco: perdido sem motivo não grava. A tela avisa
              antes para a pessoa não descobrir isso com um erro. */}
          {etapa === 'perdido' && (
            <Campo id={`motivo-${l.id}`} rotulo="Por quê" dica="obrigatório" className="mt-3">
              <Entrada
                id={`motivo-${l.id}`}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="achou caro, fechou com outra…"
              />
            </Campo>
          )}

          <Botao
            variante="primario"
            tamanho="pequeno"
            className="mt-3"
            disabled={salvando || (etapa === 'perdido' && !motivo.trim())}
            onClick={() => void mover()}
          >
            {salvando ? 'Movendo…' : 'Mover'}
          </Botao>
        </div>
      )}
    </li>
  );
}

export function Comercial() {
  const [funil, setFunil] = useState<Funil | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setFunil(await pedirFunil());
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir o funil.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function mover(l: LeadNoFunil, etapa: EtapaLead, motivo?: string) {
    setErro(null);
    setRecado(null);
    try {
      await moverLead(l.id, etapa, motivo);
      setRecado(`${l.nome} agora está em ${ETAPA_LEAD[etapa]}.`);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui mover o lead.');
    }
  }

  if (erro && !funil) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!funil) return <Carregando oQue="o funil" />;

  const atrasados = funil.leads.filter(atrasado);
  const comEtapa = (e: EtapaLead) => funil.leads.filter((l) => l.etapa === e);
  const etapasComGente = ETAPAS_ABERTAS.filter((e) => comEtapa(e).length > 0);

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <div className="rotulo">comercial</div>
        <h1 className="titulao mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">
          {atrasados.length === 0
            ? 'Ninguém esperando resposta.'
            : `${plural(atrasados.length, 'lead parado', 'leads parados')}.`}
        </h1>
      </div>

      <div className="escada mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Bloco rotulo="Em aberto" destaque={String(funil.abertos)} />
        <Bloco rotulo="Na mesa" destaque={reais(funil.valorAbertoCentavos)} />
        <Bloco rotulo="Fechados no mês" destaque={String(funil.fechadosNoMes)} />
        <Bloco
          rotulo="Parados"
          destaque={String(atrasados.length)}
          alerta={atrasados.length > 0}
          sombra={atrasados.length > 0}
        />
      </div>

      {recado && (
        <p role="status" className="rotulo-forte mt-6">
          {recado}
        </p>
      )}
      {erro && (
        <div role="alert" className="bloco mt-6 bg-alerta-fundo p-3.5">
          <span className="rotulo-forte text-pink-texto">não deu certo</span>
          <p className="mt-1 text-[13.5px] font-medium">{erro}</p>
        </div>
      )}

      {funil.leads.length === 0 ? (
        <Vazio titulo="Funil vazio." explica="Lead novo entra aqui e você move pelas etapas." />
      ) : (
        // Colunas do funil, roladas na horizontal no desktop e empilhadas no
        // celular. Mover é por campo de escolha, nao por arrastar: arrastar nao
        // funciona com teclado.
        <div className="mt-8 flex snap-x gap-5 overflow-x-auto pb-4 [scrollbar-width:thin] max-lg:flex-col">
          {etapasComGente.map((e) => (
            <section key={e} className="w-full shrink-0 snap-start lg:w-80">
              <Fita>
                {ETAPA_LEAD[e]}
                <span className="numeros ml-2 text-tinta-3">{comEtapa(e).length}</span>
              </Fita>
              <ul className="mt-3 flex flex-col gap-3">
                {comEtapa(e).map((l) => (
                  <Cartao
                    key={l.id}
                    l={l}
                    aoMover={(etapa, motivo) => mover(l, etapa, motivo)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
