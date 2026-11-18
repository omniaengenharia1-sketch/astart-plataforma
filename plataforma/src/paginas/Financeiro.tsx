import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { Tabela } from '../componentes/Tabela';
import type { Coluna } from '../componentes/Tabela';
import { contratosACobrar, gerarCobrancasDoMes, painelFinanceiro } from '../dados/api';
import { diaMes, reais, valor } from '../formato';
import { NATUREZA, SITUACAO } from '../rotulos';
import type { LancamentoNaLista, PainelFinanceiro, RodadaDeCobranca } from '../dados/tipos';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const mesDeHoje = () => `${new Date().toISOString().slice(0, 7)}-01`;

function mesVizinho(mes: string, passo: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a ?? 2026, (m ?? 1) - 1 + passo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function porExtensoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[(m ?? 1) - 1]} de ${a}`;
}

/** Atrasado grita; o resto é cápsula de vidro. Um vermelho por tela é o limite. */
function SeloSituacao({ l }: { l: LancamentoNaLista }) {
  return <Marca forte={l.situacao === 'atrasado'}>{SITUACAO[l.situacao]}</Marca>;
}

export function Financeiro() {
  const [mes, setMes] = useState(mesDeHoje);
  const [painel, setPainel] = useState<PainelFinanceiro | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [so, setSo] = useState<'tudo' | 'receita' | 'custo' | 'aberto'>('tudo');
  // A cobranca do mes (0076). `gerar_cobrancas_do_contrato` existia desde a
  // 0020 e nunca foi chamada: oito contratos ativos, zero lancamentos. Isto
  // aqui e a porta que faltava.
  const [contratos, setContratos] = useState<number | null>(null);
  const [perguntando, setPerguntando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [rodada, setRodada] = useState<RodadaDeCobranca | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    setPainel(null);
    setPerguntando(false);
    setRodada(null);
    try {
      const [p, n] = await Promise.all([painelFinanceiro(mes), contratosACobrar(mes)]);
      setPainel(p);
      setContratos(n);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir o financeiro.');
    }
  }, [mes]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const colunas: Coluna<LancamentoNaLista>[] = useMemo(
    () => [
      {
        chave: 'descricao',
        titulo: 'O quê',
        larguraMin: '15rem',
        busca: (l) => `${l.descricao} ${l.clienteNome ?? ''} ${l.categoria} ${l.subcategoria}`,
        render: (l) => (
          <div>
            <div className="font-medium">{l.descricao}</div>
            <div className="rotulo mt-0.5">
              {l.grupo} · {l.categoria}
              {l.sugestao && (
                <>
                  {' · '}
                  <span className="text-pink-texto">sugestão: {l.sugestao}</span>
                </>
              )}
            </div>
          </div>
        ),
      },
      {
        chave: 'cliente',
        titulo: 'De quem',
        render: (l) =>
          l.clienteId ? (
            <Link to={`/clientes/${l.clienteId}`} className="risca hover:text-pink-texto">
              {l.clienteNome}
            </Link>
          ) : (
            <span className="text-tinta-3">casa</span>
          ),
      },
      {
        chave: 'natureza',
        titulo: 'Tipo',
        render: (l) => <Marca>{NATUREZA[l.natureza] ?? l.natureza}</Marca>,
      },
      {
        chave: 'vencimento',
        titulo: 'Vence',
        render: (l) => <span className="numeros">{diaMes(l.vencimento)}</span>,
      },
      { chave: 'situacao', titulo: 'Situação', render: (l) => <SeloSituacao l={l} /> },
      {
        chave: 'valor',
        titulo: 'Quanto',
        render: (l) => (
          <span className={'numeros font-semibold ' + (l.natureza === 'receita' ? '' : 'text-tinta-2')}>
            {l.natureza === 'receita' ? '' : '− '}
            {valor(l.valorCentavos)}
          </span>
        ),
      },
    ],
    [],
  );

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!painel) return <Carregando oQue="o financeiro" />;

  const sobra = painel.receitaCentavos - painel.custoCentavos;
  const aReceber = painel.receitaCentavos - painel.recebidoCentavos;

  async function gerar() {
    setGerando(true);
    setErro(null);
    try {
      const r = await gerarCobrancasDoMes(mes);
      // Recarrega ANTES de mostrar o resultado: numero na tela e numero no
      // banco tem de ser o mesmo, senao o resultado vira promessa.
      const [p, n] = await Promise.all([painelFinanceiro(mes), contratosACobrar(mes)]);
      setPainel(p);
      setContratos(n);
      setRodada(r);
      setPerguntando(false);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui gerar as cobranças.');
    } finally {
      setGerando(false);
    }
  }

  const lista = painel.lancamentos.filter((l) => {
    if (so === 'receita') return l.natureza === 'receita';
    if (so === 'custo') return l.natureza !== 'receita';
    if (so === 'aberto') return l.situacao === 'previsto' || l.situacao === 'atrasado';
    return true;
  });

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <div className="rotulo">financeiro</div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <h1 className="titulao text-[clamp(1.8rem,5vw,2.8rem)]">
            {painel.atrasadoCentavos > 0
              ? `${reais(painel.atrasadoCentavos)} atrasados.`
              : 'Nada atrasado.'}
          </h1>
          <div className="flex items-center gap-2">
            <Botao tamanho="pequeno" onClick={() => setMes(mesVizinho(mes, -1))}>
              &lt; mês
            </Botao>
            <span className="rotulo-forte w-36 text-center">{porExtensoMes(mes)}</span>
            <Botao tamanho="pequeno" onClick={() => setMes(mesVizinho(mes, 1))}>
              mês &gt;
            </Botao>
          </div>
        </div>

        {/* GERAR AS MENSALIDADES.
            Fica aqui em cima, ao lado do mês, porque é o que faz o resto da
            tela existir. Não é automático de propósito: é dinheiro de
            cliente, e quem aperta olha antes. Apertar duas vezes não cobra
            duas vezes — o banco recusa duplicata e o resultado diz quantas
            já existiam. */}
        {contratos !== null && contratos > 0 && (
          <div className="mt-5">
            {!perguntando ? (
              <Botao variante="secundario" tamanho="pequeno" onClick={() => setPerguntando(true)}>
                Gerar mensalidades de {porExtensoMes(mes)}
              </Botao>
            ) : (
              <div className="bloco p-3.5">
                <p className="text-[13.5px] font-medium">
                  Lançar as mensalidades de {porExtensoMes(mes)} dos{' '}
                  {contratos === 1 ? 'contrato ativo' : `${contratos} contratos ativos`}?
                </p>
                <p className="legenda mt-1">
                  Isto cria lançamentos de verdade. Quem já estiver lançado fica como está —
                  ninguém é cobrado duas vezes. Projetos lançam as parcelas a partir do mês em
                  que começaram.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Botao
                    variante="primario"
                    tamanho="pequeno"
                    disabled={gerando}
                    onClick={() => void gerar()}
                  >
                    {gerando ? 'Lançando…' : 'Lançar'}
                  </Botao>
                  <Botao variante="texto" tamanho="pequeno" onClick={() => setPerguntando(false)}>
                    Deixa
                  </Botao>
                </div>
              </div>
            )}
          </div>
        )}

        {/* O RESULTADO, LINHA POR LINHA.
            Uma rodada pode dar certo pela metade: contrato de cortesia tem
            valor zero e a tabela de lançamentos recusa. Os outros passam, e
            o que falhou aparece aqui com o motivo em vez de sumir. */}
        {rodada && (
          <div
            role="status"
            className={'bloco mt-4 p-3.5 ' + (rodada.erros > 0 ? 'bg-alerta-fundo' : '')}
          >
            <p className="aviso">
              {rodada.criadas === 0
                ? `Nada novo: ${rodada.jaExistiam === 1
                    ? 'o contrato já estava lançado'
                    : `${rodada.jaExistiam} contratos já estavam lançados`}.`
                : `${rodada.criadas === 1 ? '1 lançamento criado' : `${rodada.criadas} lançamentos criados`} em ${rodada.competencia}.`}
              {rodada.jaExistiam > 0 && rodada.criadas > 0
                && ` ${rodada.jaExistiam} já estavam lançados.`}
            </p>
            {rodada.erros > 0 && (
              <p className="rotulo-forte mt-2 text-pink-texto">
                {rodada.erros === 1 ? '1 contrato não passou' : `${rodada.erros} contratos não passaram`}:
              </p>
            )}
            <ul className="mt-2">
              {rodada.linhas
                .filter((l) => l.erro !== null || l.criadas > 0)
                .map((l) => (
                  <li key={`${l.cliente}-${l.servico}`} className="text-[13.5px]">
                    <span className="font-medium">{l.cliente}</span>
                    <span className="legenda"> · {l.servico}</span>
                    {l.erro ? (
                      <span className="text-pink-texto"> — {l.erro}</span>
                    ) : (
                      <span className="legenda">
                        {' '}
                        — {l.criadas === 1 ? `mensalidade de ${l.competencia}` : `${l.criadas} parcelas a partir de ${l.competencia}`}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>

      <div className="escada mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Bloco rotulo="Entrou" destaque={reais(painel.recebidoCentavos)}>
          <p className="legenda mt-1">
            de {reais(painel.receitaCentavos)} faturados
          </p>
        </Bloco>
        <Bloco
          rotulo="Atrasado"
          destaque={reais(painel.atrasadoCentavos)}
          alerta={painel.atrasadoCentavos > 0}
          sombra={painel.atrasadoCentavos > 0}
        />
        <Bloco rotulo="A receber" destaque={reais(aReceber)} />
        <Bloco rotulo="Sobra do mês" destaque={reais(sobra)}>
          <p className="legenda mt-1">custo de {reais(painel.custoCentavos)}</p>
        </Bloco>
      </div>

      <div className="mt-9 grid items-start gap-9 lg:grid-cols-[1fr_320px]">
        <div>
          <Fita
            acao={
              <div className="flex flex-wrap gap-2">
                {([
                  ['tudo', 'Tudo'],
                  ['aberto', 'Em aberto'],
                  ['receita', 'Entradas'],
                  ['custo', 'Saídas'],
                ] as const).map(([v, r]) => (
                  <Botao
                    key={v}
                    tamanho="pequeno"
                    variante={so === v ? 'primario' : 'secundario'}
                    onClick={() => setSo(v)}
                  >
                    {r}
                  </Botao>
                ))}
              </div>
            }
          >
            Lançamentos
          </Fita>

          {painel.lancamentos.length === 0 ? (
            <Vazio
              titulo="Mês sem lançamento."
              explica={
                contratos && contratos > 0
                  ? 'Use "gerar mensalidades" aqui em cima para lançar os contratos ativos deste mês.'
                  : 'Nenhum contrato ativo em vigor neste mês.'
              }
            />
          ) : (
            <div className="mt-3">
              <Tabela
                linhas={lista}
                colunas={colunas}
                chaveDe={(l) => l.id}
                placeholderBusca="buscar lançamento"
                vazio="Nada neste filtro."
                resumo={(l) => (
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium">{l.descricao}</span>
                      <span className="numeros shrink-0 font-semibold">
                        {l.natureza === 'receita' ? '' : '− '}
                        {valor(l.valorCentavos)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <SeloSituacao l={l} />
                      <span className="rotulo">vence {diaMes(l.vencimento)}</span>
                      {l.clienteNome && <span className="legenda">· {l.clienteNome}</span>}
                    </div>
                  </div>
                )}
              />
            </div>
          )}
        </div>

        <aside aria-label="Receita por cliente">
          <Fita>Por cliente</Fita>
          {painel.porCliente.length === 0 ? (
            <p className="py-4 text-tinta-3">Nada faturado neste mês.</p>
          ) : (
            <ul className="border-t border-linha-fraca">
              {painel.porCliente.map((c) => (
                <li key={c.clienteId} className="border-b border-linha-fraca py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link
                      to={`/clientes/${c.clienteId}`}
           className="risca font-bold hover:text-pink-texto"
                    >
                      {c.clienteNome}
                    </Link>
                    <span className="numeros shrink-0 font-semibold">
                      {valor(c.receitaCentavos)}
                    </span>
                  </div>
                  {c.atrasadoCentavos > 0 && (
                    <div className="rotulo-forte mt-1 text-pink-texto">
                      {reais(c.atrasadoCentavos)} atrasados
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
