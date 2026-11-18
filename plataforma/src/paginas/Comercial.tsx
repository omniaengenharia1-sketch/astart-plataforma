import { useCallback, useEffect, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada, Escolha } from '../componentes/Campo';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import {
  agendaComercial, apagarLead, converterLead, criarLead, editarLead,
  funil as pedirFunil, listaClientes, moverLead, registrarInteracaoDoLead,
} from '../dados/api';
import { diaMes, haQuanto, plural, reais } from '../formato';
import { ETAPAS_ABERTAS, ETAPA_LEAD } from '../rotulos';
import type {
  AgendaComercial, ClienteNaLista, EtapaLead, Funil, LeadNoFunil,
} from '../dados/tipos';

const DESTINOS: EtapaLead[] = [...ETAPAS_ABERTAS, 'fechado', 'perdido'];

/**
 * O link que abre a conversa no SEU WhatsApp, já com o nome na mensagem.
 *
 * É a porta barata, e foi deliberado começar por ela. O WhatsApp de verdade
 * (Cloud API) custa mensalidade de parceiro, cobrança por conversa, e migrar o
 * número direto faria você PERDER o WhatsApp Business do celular e o histórico
 * — está escrito na documentação da Meta. Isto aqui custa zero e entrega o que
 * importa no dia a dia: sair do sistema para a conversa em um toque.
 *
 * Nulo quando não há número: botão que não leva a lugar nenhum é armadilha.
 */
function linkDoWhatsapp(l: LeadNoFunil): string | null {
  const so = (l.whatsapp ?? '').replace(/\D/g, '');
  if (so.length < 10) return null;
  // Número brasileiro digitado sem o 55 na frente é o caso comum.
  const completo = so.length <= 11 ? `55${so}` : so;
  const oi = encodeURIComponent(`Oi, ${l.nome.split(' ')[0]}! Aqui é da Astart Studio.`);
  return `https://wa.me/${completo}?text=${oi}`;
}

/** Lead com próximo passo para trás é o que some do radar. */
function atrasado(l: LeadNoFunil): boolean {
  return !!l.proximoEm && l.proximoEm < new Date().toISOString().slice(0, 10);
}

function Cartao({
  l,
  aoMover,
  aoAnotar,
  aoEditar,
  aoConverter,
  aoApagar,
  clientes,
}: {
  l: LeadNoFunil;
  aoMover: (etapa: EtapaLead, motivo?: string) => Promise<void>;
  aoAnotar: (oque: string, proximoPasso: string, proximoEm: string) => Promise<void>;
  aoEditar: (d: { nome: string; empresa: string; whatsapp: string; origem: string; valor: string }) => Promise<void>;
  aoConverter: (clienteId: string) => Promise<void>;
  aoApagar: () => Promise<void>;
  clientes: { id: string; nome: string }[];
}) {
  const [abrindo, setAbrindo] = useState(false);
  const [anotando, setAnotando] = useState(false);
  // Editar, converter e apagar vieram DEPOIS da 0071, quando a dona cobrou a
  // varredura: as tres funcoes existiam no banco, testadas, sem caminho.
  const [editando, setEditando] = useState(false);
  const [convertendo, setConvertendo] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [cliente, setCliente] = useState('');
  const [ed, setEd] = useState({
    nome: l.nome,
    empresa: l.empresa ?? '',
    whatsapp: l.whatsapp ?? '',
    origem: l.origem ?? '',
    valor: l.valorCentavos === null ? '' : (l.valorCentavos / 100).toFixed(2).replace('.', ','),
  });
  const [etapa, setEtapa] = useState<EtapaLead>(l.etapa);
  const [motivo, setMotivo] = useState('');
  const [oque, setOque] = useState('');
  const [passo, setPasso] = useState('');
  const [quando, setQuando] = useState('');
  const [salvando, setSalvando] = useState(false);
  const atencao = atrasado(l);
  const zap = linkDoWhatsapp(l);

  async function anotar() {
    if (salvando || !oque.trim()) return;
    setSalvando(true);
    try {
      await aoAnotar(oque, passo, quando);
      setAnotando(false);
      setOque(''); setPasso(''); setQuando('');
    } finally {
      setSalvando(false);
    }
  }

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
          <div className="font-bold">{l.nome}</div>
          {l.empresa && <div className="legenda mt-0.5">{l.empresa}</div>}
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
        {l.responsavelNome && <span className="legenda">· {l.responsavelNome}</span>}
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

      {/* `whitespace-nowrap` e `flex-wrap` juntos: numa coluna de 320px, sem
          isso, "falou agora" quebrava no meio e os botoes desciam em escada.
          Agora ou cabe tudo na linha, ou a linha inteira passa para baixo. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="legenda whitespace-nowrap">
          {l.ultimaEm ? `falou ${haQuanto(l.ultimaEm)}` : 'ninguém falou ainda'}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {/* O WhatsApp primeiro: e o que ela faz com mais frequencia. */}
          {zap && (
            <a
              href={zap}
              target="_blank"
              rel="noreferrer"
              className="min-h-9 rounded-full border border-linha bg-superficie px-3 text-[13px] font-medium leading-9 text-tinta-2 hover:text-pink-texto"
            >
              WhatsApp
            </a>
          )}
          <Botao variante="texto" tamanho="pequeno" onClick={() => setAnotando((v) => !v)}>
            {anotando ? 'Fechar' : 'Anotar'}
          </Botao>
          <Botao variante="texto" tamanho="pequeno" onClick={() => setAbrindo((v) => !v)}>
            {abrindo ? 'Fechar' : 'Mover'}
          </Botao>
          <Botao
            variante="texto"
            tamanho="pequeno"
            onClick={() => {
              // Ao ABRIR, relê do lead. O estado do formulário sobrevive ao
              // recarregamento (o cartão é o mesmo componente, mesma key), e
              // sem isto a segunda abertura mostraria o que foi digitado da
              // vez anterior em vez do que está valendo — inclusive se o
              // salvar tivesse falhado calado.
              if (!editando) {
                setEd({
                  nome: l.nome,
                  empresa: l.empresa ?? '',
                  whatsapp: l.whatsapp ?? '',
                  origem: l.origem ?? '',
                  valor: l.valorCentavos === null
                    ? ''
                    : (l.valorCentavos / 100).toFixed(2).replace('.', ','),
                });
              }
              setEditando((v) => !v);
              setConvertendo(false);
              setApagando(false);
            }}
          >
            {editando ? 'Fechar' : 'Editar'}
          </Botao>
          {/* Converter só aparece em lead ABERTO: num já fechado o botão
              seria uma pergunta sem resposta, e num perdido seria errado. */}
          {l.etapa !== 'fechado' && l.etapa !== 'perdido' && (
            <Botao
              variante="texto"
              tamanho="pequeno"
              onClick={() => { setConvertendo((v) => !v); setEditando(false); setApagando(false); }}
            >
              {convertendo ? 'Fechar' : 'Virou cliente'}
            </Botao>
          )}
        </div>
      </div>

      {/* ANOTAR O QUE FOI CONVERSADO.
          Os tres campos juntos de proposito: o que aconteceu, o que fazer
          depois, e QUANDO. Separados, o terceiro nunca e preenchido — e lead
          sem proxima data e lead esquecido. */}
      {anotando && (
        <div className="mt-3 border-t border-linha-fraca pt-3">
          <Campo id={`oque-${l.id}`} rotulo="O que foi conversado">
            <Entrada
              id={`oque-${l.id}`}
              value={oque}
              onChange={(e) => setOque(e.target.value)}
              placeholder="liguei, tem interesse em gestão de redes…"
            />
          </Campo>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Campo id={`passo-${l.id}`} rotulo="Próximo passo">
              <Entrada
                id={`passo-${l.id}`}
                value={passo}
                onChange={(e) => setPasso(e.target.value)}
                placeholder="mandar proposta"
              />
            </Campo>
            <Campo id={`quando-${l.id}`} rotulo="Quando">
              <Entrada
                id={`quando-${l.id}`}
                type="date"
                value={quando}
                onChange={(e) => setQuando(e.target.value)}
              />
            </Campo>
          </div>
          <Botao
            variante="primario"
            tamanho="pequeno"
            className="mt-3"
            disabled={salvando || !oque.trim()}
            onClick={() => void anotar()}
          >
            {salvando ? 'Anotando…' : 'Anotar'}
          </Botao>
        </div>
      )}

      {/* O que ja foi conversado, do mais novo para o mais velho. */}
      {l.historico && (
        <details className="mt-3">
          <summary className="legenda cursor-pointer">
            histórico ({l.historico.split('\n').length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 border-l-2 border-linha-fraca pl-3">
            {l.historico.split('\n').reverse().map((linha, i) => (
              <li key={i} className="legenda">{linha}</li>
            ))}
          </ul>
        </details>
      )}

      {/* EDITAR: o telefone digitado errado, o nome da empresa que faltava.
          Sem isto, o unico jeito de corrigir era apagar e cadastrar de novo —
          e apagar leva o historico junto. */}
      {editando && (
        <div className="mt-3 border-t border-linha-fraca pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id={`ed-nome-${l.id}`} rotulo="Nome">
              <Entrada
                id={`ed-nome-${l.id}`}
                value={ed.nome}
                onChange={(e) => setEd({ ...ed, nome: e.target.value })}
              />
            </Campo>
            <Campo id={`ed-empresa-${l.id}`} rotulo="Empresa">
              <Entrada
                id={`ed-empresa-${l.id}`}
                value={ed.empresa}
                onChange={(e) => setEd({ ...ed, empresa: e.target.value })}
              />
            </Campo>
            <Campo id={`ed-whatsapp-${l.id}`} rotulo="WhatsApp" dica="com DDD">
              <Entrada
                id={`ed-whatsapp-${l.id}`}
                inputMode="tel"
                value={ed.whatsapp}
                onChange={(e) => setEd({ ...ed, whatsapp: e.target.value })}
              />
            </Campo>
            <Campo id={`ed-origem-${l.id}`} rotulo="Veio de">
              <Entrada
                id={`ed-origem-${l.id}`}
                value={ed.origem}
                onChange={(e) => setEd({ ...ed, origem: e.target.value })}
              />
            </Campo>
            <Campo id={`ed-valor-${l.id}`} rotulo="Valor estimado" dica="em reais">
              <Entrada
                id={`ed-valor-${l.id}`}
                inputMode="decimal"
                value={ed.valor}
                onChange={(e) => setEd({ ...ed, valor: e.target.value })}
              />
            </Campo>
          </div>
          <Botao
            variante="primario"
            tamanho="pequeno"
            className="mt-3"
            disabled={salvando || !ed.nome.trim()}
            onClick={() => void (async () => {
              setSalvando(true);
              try { await aoEditar(ed); setEditando(false); } finally { setSalvando(false); }
            })()}
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </Botao>
        </div>
      )}

      {/* VIROU CLIENTE: amarra o lead ao cliente, para a historia da venda
          nao se perder quando o contrato comeca. Pede um cliente que JA
          existe porque e isso que o banco amarra — criar cliente e outra
          tela, com contrato e modulos. */}
      {convertendo && (
        <div className="mt-3 border-t border-linha-fraca pt-3">
          <Campo id={`conv-${l.id}`} rotulo="Qual cliente" dica="cadastre antes, se ainda não existe">
            <Escolha
              id={`conv-${l.id}`}
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
            >
              <option value="">escolha</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </Escolha>
          </Campo>
          <Botao
            variante="primario"
            tamanho="pequeno"
            className="mt-3"
            disabled={salvando || !cliente}
            onClick={() => void (async () => {
              setSalvando(true);
              try { await aoConverter(cliente); setConvertendo(false); } finally { setSalvando(false); }
            })()}
          >
            {salvando ? 'Amarrando…' : 'Amarrar ao cliente'}
          </Botao>
        </div>
      )}

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

      {/* APAGAR fica por ultimo e so para engano de cadastro. O banco recusa
          lead que virou cliente: ele e o comeco daquele contrato. Para tirar
          da frente o que nao vai acontecer, o caminho e "perdido" com motivo,
          que preserva. */}
      {!apagando ? (
        <div className="mt-3 flex justify-end">
          <Botao variante="texto" tamanho="pequeno" onClick={() => setApagando(true)}>
            Apagar
          </Botao>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <span className="legenda">apagar leva o histórico junto.</span>
          <Botao
            variante="primario"
            tamanho="pequeno"
            disabled={salvando}
            onClick={() => void (async () => {
              setSalvando(true);
              try { await aoApagar(); } finally { setSalvando(false); setApagando(false); }
            })()}
          >
            Apagar mesmo
          </Botao>
          <Botao variante="texto" tamanho="pequeno" onClick={() => setApagando(false)}>
            Deixa
          </Botao>
        </div>
      )}
    </li>
  );
}

export function Comercial() {
  const [funil, setFunil] = useState<Funil | null>(null);
  const [agenda, setAgenda] = useState<AgendaComercial | null>(null);
  // Para o "virou cliente": o banco amarra a um cliente que ja existe.
  const [clientes, setClientes] = useState<ClienteNaLista[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState({ nome: '', empresa: '', whatsapp: '', origem: '' });
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [f, a, c] = await Promise.all([pedirFunil(), agendaComercial(), listaClientes()]);
      setFunil(f);
      setAgenda(a);
      setClientes(c);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir o comercial.');
    }
  }, []);

  async function anotar(l: LeadNoFunil, oque: string, passo: string, quando: string) {
    setErro(null);
    setRecado(null);
    try {
      await registrarInteracaoDoLead(l.id, oque, passo || null, quando || null);
      setRecado(`Anotado em ${l.nome}.`);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui anotar.');
    }
  }

  async function cadastrar() {
    if (salvando || !form.nome.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await criarLead({
        nome: form.nome,
        empresa: form.empresa || null,
        whatsapp: form.whatsapp || null,
        origem: form.origem || null,
      });
      setRecado(`${form.nome.trim()} entrou no funil.`);
      setForm({ nome: '', empresa: '', whatsapp: '', origem: '' });
      setNovo(false);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui cadastrar o lead.');
    } finally {
      setSalvando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // `editar_lead` trata null como "nao mexe" — por isso campo esvaziado
  // entra em `limpar`, senao apagar o telefone errado seria impossivel.
  async function editar(
    l: LeadNoFunil,
    d: { nome: string; empresa: string; whatsapp: string; origem: string; valor: string },
  ) {
    setErro(null);
    setRecado(null);
    const limpar: string[] = [];
    const ou = (campo: string, v: string) => {
      if (v.trim()) return v.trim();
      limpar.push(campo);
      return null;
    };
    const valor = d.valor.trim()
      ? Math.round(Number(d.valor.replace(/\./g, '').replace(',', '.')) * 100)
      : null;
    if (valor !== null && !Number.isFinite(valor)) {
      setErro('O valor não é um número. Use 1500,00.');
      return;
    }
    if (valor === null) limpar.push('valor');
    try {
      await editarLead(l.id, {
        nome: d.nome.trim() || null,
        empresa: ou('empresa', d.empresa),
        whatsapp: ou('whatsapp', d.whatsapp),
        origem: ou('origem', d.origem),
        valorCentavos: valor,
        limpar: limpar.length ? limpar : undefined,
      });
      setRecado(`${d.nome.trim() || l.nome} atualizado.`);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui salvar o lead.');
    }
  }

  async function converter(l: LeadNoFunil, clienteId: string) {
    setErro(null);
    setRecado(null);
    try {
      await converterLead(l.id, clienteId);
      const c = clientes.find((x) => x.id === clienteId);
      setRecado(`${l.nome} agora é ${c ? c.nome : 'cliente'}.`);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui amarrar o lead ao cliente.');
    }
  }

  async function apagar(l: LeadNoFunil) {
    setErro(null);
    setRecado(null);
    try {
      await apagarLead(l.id);
      setRecado(`${l.nome} foi apagado.`);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui apagar o lead.');
    }
  }

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
        <p role="status" className="aviso mt-6">
          {recado}
        </p>
      )}
      {erro && (
        <div role="alert" className="bloco mt-6 bg-alerta-fundo p-3.5">
          <span className="rotulo-forte text-pink-texto">não deu certo</span>
          <p className="mt-1 text-[13.5px] font-medium">{erro}</p>
        </div>
      )}

      {/* ---------------------------------------------------------------
          O QUE EU PRECISO FAZER HOJE
          ---------------------------------------------------------------
          A dona: "ela tem que ter um fundamento, um objetivo". Este bloco e o
          objetivo. O funil abaixo e consulta; aqui em cima e trabalho.

          A ordem e a ordem em que doi: o que passou da data, o que e hoje, o
          que vem na semana. E, por ultimo, a lista que ninguem pensa em
          fazer — quem esta SEM proxima data. E ali que o lead morre, sem
          ninguem decidir que morreu. */}
      {agenda && (
        <div className="mt-9 grid gap-5 lg:grid-cols-2">
          {([
            ['atrasados', 'Passou da data', agenda.atrasados, true],
            ['hoje', 'Para hoje', agenda.hoje, false],
            ['semana', 'Próximos 7 dias', agenda.semana, false],
            ['semFollowup', 'Sem data marcada', agenda.semFollowup, false],
          ] as const).map(([chave, titulo, lista, urgente]) => (
            <section key={chave} aria-label={titulo}>
              <Fita>
                {titulo}
                <span className="numeros ml-2 text-tinta-3">{lista.length}</span>
              </Fita>
              {lista.length === 0 ? (
                <p className="legenda mt-2">
                  {chave === 'semFollowup'
                    ? 'todo mundo com próxima data — é assim que tem de ser'
                    : 'nada aqui'}
                </p>
              ) : (
                <ul className="mt-2 border-t border-linha-fraca">
                  {lista.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-linha-fraca py-2.5">
                      <span className="font-bold">{l.nome}</span>
                      {l.empresa && <span className="legenda">{l.empresa}</span>}
                      <span className="legenda flex-1">{l.proximoPasso ?? 'sem próximo passo'}</span>
                      {l.proximoEm && (
                        <span className={urgente ? 'rotulo-forte text-pink-texto' : 'rotulo'}>
                          {diaMes(l.proximoEm)}
                        </span>
                      )}
                      {linkDoWhatsapp(l) && (
                        <a
                          href={linkDoWhatsapp(l) ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="legenda hover:text-pink-texto"
                        >
                          WhatsApp
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {/* NOVO LEAD: so o nome e obrigatorio.
          Comeca fechado para a agenda acima nao ficar abaixo da dobra no
          telefone — a mesma licao do quadro de tarefas. */}
      <div className="mt-9">
        <Botao variante={novo ? 'secundario' : 'primario'} onClick={() => setNovo((v) => !v)}>
          {novo ? 'Cancelar' : '+ Novo lead'}
        </Botao>
      </div>

      {novo && (
        <div className="bloco mt-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo id="lead-nome" rotulo="Nome" dica="só isto é obrigatório">
              <Entrada
                id="lead-nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="quem é"
              />
            </Campo>
            <Campo id="lead-empresa" rotulo="Empresa">
              <Entrada
                id="lead-empresa"
                value={form.empresa}
                onChange={(e) => setForm({ ...form, empresa: e.target.value })}
              />
            </Campo>
            <Campo id="lead-whatsapp" rotulo="WhatsApp" dica="com DDD">
              <Entrada
                id="lead-whatsapp"
                inputMode="tel"
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                placeholder="11 99999 9999"
              />
            </Campo>
            <Campo id="lead-origem" rotulo="Veio de">
              <Entrada
                id="lead-origem"
                value={form.origem}
                onChange={(e) => setForm({ ...form, origem: e.target.value })}
                placeholder="indicação, Instagram…"
              />
            </Campo>
          </div>
          <Botao
            variante="primario"
            className="mt-4"
            disabled={salvando || !form.nome.trim()}
            onClick={() => void cadastrar()}
          >
            {salvando ? 'Cadastrando…' : 'Cadastrar lead'}
          </Botao>
        </div>
      )}

      {funil.leads.length === 0 ? (
        <Vazio titulo="Funil vazio." explica="Cadastre o primeiro lead acima." />
      ) : (
        // Colunas do funil, roladas na horizontal no desktop e empilhadas no
        // celular. Mover é por campo de escolha, nao por arrastar: arrastar nao
        // funciona com teclado.
        <div className="mt-8 flex snap-x gap-5 overflow-x-auto pb-4 [scrollbar-width:thin] max-lg:flex-col">
          {etapasComGente.map((e) => (
            <section
              key={e}
              aria-label={`Funil: ${ETAPA_LEAD[e]}`}
              className="w-full shrink-0 snap-start lg:w-80"
            >
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
                    aoAnotar={(oque, passo, quando) => anotar(l, oque, passo, quando)}
                    aoEditar={(d) => editar(l, d)}
                    aoConverter={(clienteId) => converter(l, clienteId)}
                    aoApagar={() => apagar(l)}
                    clientes={clientes}
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
