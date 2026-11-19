import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { Tabela } from '../componentes/Tabela';
import type { Coluna } from '../componentes/Tabela';
import {
  apagarLancamento, cancelarLancamento, categoriasFinanceiras, contratosACobrar,
  criarLancamento, editarLancamento, estornarLancamento, gerarCobrancasDoMes,
  liquidarLancamento, listaClientes, painelFinanceiro,
} from '../dados/api';
import { diaMes, reais, valor } from '../formato';
import { NATUREZA, SITUACAO } from '../rotulos';
import type {
  CategoriaFinanceira, ClienteNaLista, LancamentoNaLista, PainelFinanceiro, RodadaDeCobranca,
} from '../dados/tipos';
import { Campo, Entrada, Escolha } from '../componentes/Campo';

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

const paraCentavos = (s: string): number | null => {
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const paraReais = (c: number) => (c / 100).toFixed(2).replace('.', ',');

const FORMAS = ['pix', 'boleto', 'cartao', 'transferencia', 'dinheiro'] as const;
const NOME_DA_FORMA: Record<string, string> = {
  pix: 'pix', boleto: 'boleto', cartao: 'cartão',
  transferencia: 'transferência', dinheiro: 'dinheiro',
};

/**
 * Lançar e corrigir, no mesmo formulário.
 *
 * Dois formulários com os mesmos oito campos divergem no terceiro ajuste:
 * um ganha a forma de pagamento e o outro não, e aí o que foi lançado não
 * pode ser corrigido inteiro. Um só, com um campo a mais na criação.
 */
function FormLancamento({
  categorias, clientes, lancamento, ocupado, aoCriar, aoEditar, aoFechar, aoCancelar, aoApagar,
}: {
  categorias: CategoriaFinanceira[];
  clientes: ClienteNaLista[];
  /** Nulo = está criando. */
  lancamento: LancamentoNaLista | null;
  ocupado: boolean;
  aoCriar: (d: {
    descricao: string; subcategoriaId: string; valorCentavos: number;
    vencimento: string | null; clienteId: string | null; contraparte: string | null;
    forma: string | null; liquidadoEm: string | null;
  }) => void;
  aoEditar: (d: {
    descricao: string; subcategoriaId: string; valorCentavos: number;
    vencimento: string | null; clienteId: string | null; forma: string | null;
    limpar: string[];
  }) => void;
  aoFechar: () => void;
  aoCancelar: () => void;
  aoApagar: () => void;
}) {
  const l = lancamento;
  // A lista traz os NOMES, não o id da subcategoria. A trinca grupo +
  // categoria + subcategoria é única, então ela acha a folha certa.
  const daLinha = l
    ? categorias.find((c) => c.grupo === l.grupo && c.categoria === l.categoria
        && c.subcategoria === l.subcategoria)
    : undefined;

  const [f, setF] = useState({
    descricao: l?.descricao ?? '',
    categoria: daLinha?.id ?? '',
    valor: l ? paraReais(l.valorCentavos) : '',
    vencimento: l?.vencimento ?? '',
    cliente: l?.clienteId ?? '',
    contraparte: '',
    forma: l?.forma ?? '',
    jaFoi: false,
    quando: new Date().toISOString().slice(0, 10),
  });
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);

  const centavos = paraCentavos(f.valor);
  const pronto = f.descricao.trim() !== '' && f.categoria !== ''
    && centavos !== null && centavos > 0;

  function salvar() {
    if (!pronto || centavos === null) return;
    if (l) {
      const limpar: string[] = [];
      if (!f.vencimento) limpar.push('vencimento');
      if (!f.cliente) limpar.push('cliente');
      if (!f.forma) limpar.push('forma');
      aoEditar({
        descricao: f.descricao.trim(),
        subcategoriaId: f.categoria,
        valorCentavos: centavos,
        vencimento: f.vencimento || null,
        clienteId: f.cliente || null,
        forma: f.forma || null,
        limpar,
      });
      return;
    }
    aoCriar({
      descricao: f.descricao.trim(),
      subcategoriaId: f.categoria,
      valorCentavos: centavos,
      vencimento: f.vencimento || null,
      clienteId: f.cliente || null,
      contraparte: f.contraparte.trim() || null,
      forma: f.forma || null,
      liquidadoEm: f.jaFoi ? f.quando : null,
    });
  }

  return (
    <div className="bloco mt-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo id="l-descricao" rotulo="O quê">
          <Entrada
            id="l-descricao"
            value={f.descricao}
            placeholder="anúncio do mês, freela de edição…"
            onChange={(e) => setF({ ...f, descricao: e.target.value })}
          />
        </Campo>
        {/* A CATEGORIA É QUEM DIZ SE É ENTRADA OU SAÍDA. Não há campo de
            sinal nem de tipo: valor negativo é recusado pelo banco de
            propósito, porque "-500 em Receita" seria duas verdades brigando. */}
        <Campo id="l-categoria" rotulo="Categoria" dica="é ela que diz se entra ou sai">
          <Escolha
            id="l-categoria"
            value={f.categoria}
            onChange={(e) => setF({ ...f, categoria: e.target.value })}
          >
            <option value="">escolha</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>{c.rotulo}</option>
            ))}
          </Escolha>
        </Campo>
        <Campo id="l-valor" rotulo="Valor" dica="em reais">
          <Entrada
            id="l-valor"
            inputMode="decimal"
            value={f.valor}
            placeholder="1500,00"
            onChange={(e) => setF({ ...f, valor: e.target.value })}
          />
        </Campo>
        <Campo id="l-vencimento" rotulo="Vence em">
          <Entrada
            id="l-vencimento"
            type="date"
            value={f.vencimento}
            onChange={(e) => setF({ ...f, vencimento: e.target.value })}
          />
        </Campo>
        <Campo id="l-cliente" rotulo="De qual cliente" dica="deixe vazio se for da casa">
          <Escolha
            id="l-cliente"
            value={f.cliente}
            onChange={(e) => setF({ ...f, cliente: e.target.value })}
          >
            <option value="">da casa</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </Escolha>
        </Campo>
        <Campo id="l-forma" rotulo="Forma">
          <Escolha
            id="l-forma"
            value={f.forma}
            onChange={(e) => setF({ ...f, forma: e.target.value })}
          >
            <option value="">não sei ainda</option>
            {FORMAS.map((x) => (
              <option key={x} value={x}>{NOME_DA_FORMA[x]}</option>
            ))}
          </Escolha>
        </Campo>
        {!l && (
          <Campo id="l-contraparte" rotulo="Para quem" dica="fornecedor, freela — quando não é cliente">
            <Entrada
              id="l-contraparte"
              value={f.contraparte}
              onChange={(e) => setF({ ...f, contraparte: e.target.value })}
            />
          </Campo>
        )}
      </div>

      {/* JÁ FOI PAGO: o caso do dia a dia é registrar o que já saiu da conta,
          não prever. Separar em "criar" e depois "marcar como pago" seriam
          dois passos para um fato só. */}
      {!l && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[14px]">
            <input
              id="l-ja-foi"
              type="checkbox"
              checked={f.jaFoi}
              onChange={(e) => setF({ ...f, jaFoi: e.target.checked })}
              className="size-4"
            />
            já entrou / já saiu
          </label>
          {f.jaFoi && (
            <label className="flex items-center gap-2 text-[14px]">
              <span className="rotulo">quando</span>
              <input
                id="l-quando"
                type="date"
                value={f.quando}
                onChange={(e) => setF({ ...f, quando: e.target.value })}
                className="min-h-10 border border-linha-fraca bg-superficie-2 px-2 text-[14px] text-tinta"
              />
            </label>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Botao variante="primario" tamanho="pequeno" disabled={ocupado || !pronto} onClick={salvar}>
          {ocupado ? 'Salvando…' : l ? 'Salvar' : 'Lançar'}
        </Botao>
        <Botao variante="texto" tamanho="pequeno" onClick={aoFechar}>Fechar</Botao>

        {l && (
          <>
            <span className="ml-auto" />
            {/* Cancelar tira das contas e GUARDA; apagar some. A diferença
                importa: saber que existiu e foi cancelado vale mais que a
                linha sumir do mês. */}
            {l.situacao !== 'cancelado' && (
              <Botao variante="texto" tamanho="pequeno" disabled={ocupado} onClick={aoCancelar}>
                Não vai acontecer
              </Botao>
            )}
            {!confirmandoApagar ? (
              <Botao
                variante="texto"
                tamanho="pequeno"
                className="text-pink-texto"
                onClick={() => setConfirmandoApagar(true)}
              >
                Apagar
              </Botao>
            ) : (
              <>
                <span className="legenda">apagar não deixa rastro.</span>
                <Botao variante="primario" tamanho="pequeno" disabled={ocupado} onClick={aoApagar}>
                  Apagar mesmo
                </Botao>
                <Botao variante="texto" tamanho="pequeno" onClick={() => setConfirmandoApagar(false)}>
                  Deixa
                </Botao>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
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
  // Lançar na mão (0077). Antes disto nao havia NENHUMA funcao que
  // escrevesse em `lancamentos`: so entrava mensalidade de contrato.
  const [categorias, setCategorias] = useState<CategoriaFinanceira[]>([]);
  const [clientes, setClientes] = useState<ClienteNaLista[]>([]);
  const [lancando, setLancando] = useState(false);
  const [editando, setEditando] = useState<LancamentoNaLista | null>(null);
  const [mexendo, setMexendo] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    setPainel(null);
    setPerguntando(false);
    setRodada(null);
    setRecado(null);
    try {
      const [p, n, cs, cl] = await Promise.all([
        painelFinanceiro(mes), contratosACobrar(mes), categoriasFinanceiras(), listaClientes(),
      ]);
      setPainel(p);
      setContratos(n);
      setCategorias(cs);
      setClientes(cl);
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
        // O QUE FAZER COM ESTA LINHA.
        //
        // O botao principal muda com a situacao, porque a pergunta muda: numa
        // linha prevista a pergunta e "ja entrou?", numa recebida e "foi
        // engano?". Mostrar os dois sempre seria pedir para alguem estornar
        // sem querer.
        chave: 'acoes',
        titulo: 'O que fazer',
        larguraMin: '12rem',
        render: (l) => (
          <div className="flex flex-wrap items-center gap-1">
            {(l.situacao === 'previsto' || l.situacao === 'atrasado') && (
              <Botao
                tamanho="pequeno"
                variante="primario"
                disabled={mexendo}
                onClick={() => void mexer(
                  () => liquidarLancamento(l.id),
                  `${l.descricao}: ${l.natureza === 'receita' ? 'recebido' : 'pago'}.`,
                )}
              >
                {l.natureza === 'receita' ? 'Recebi' : 'Paguei'}
              </Botao>
            )}
            {(l.situacao === 'recebido' || l.situacao === 'pago' || l.situacao === 'cancelado') && (
              <Botao
                tamanho="pequeno"
                variante="texto"
                disabled={mexendo}
                onClick={() => void mexer(
                  () => estornarLancamento(l.id),
                  `${l.descricao} voltou para previsto.`,
                )}
              >
                Desfazer
              </Botao>
            )}
            <Botao tamanho="pequeno" variante="texto" onClick={() => setEditando(l)}>
              Editar
            </Botao>
          </div>
        ),
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

  // SO troca a tela inteira quando nao HA tela: erro ao carregar. Depois que
  // o painel existe, a recusa do banco pertence ao lado da acao que a causou.
  // Antes disto, apagar um lançamento pago substituia a pagina pelo erro e
  // levava junto o formulario aberto e o que a pessoa tinha digitado.
  if (erro && !painel) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!painel) return <Carregando oQue="o financeiro" />;

  const sobra = painel.receitaCentavos - painel.custoCentavos;
  const aReceber = painel.receitaCentavos - painel.recebidoCentavos;

  /** Uma acao qualquer sobre um lançamento: faz, recarrega, e nunca cala o erro. */
  async function mexer(fn: () => Promise<unknown>, oQue: string): Promise<boolean> {
    setMexendo(true);
    setErro(null);
    setRecado(null);
    try {
      await fn();
      setRecado(oQue);
      const [p, n] = await Promise.all([painelFinanceiro(mes), contratosACobrar(mes)]);
      setPainel(p);
      setContratos(n);
      return true;
    } catch (x) {
      // Erro NAO fecha o formulario: a recusa do banco fica na tela e o que
      // foi digitado continua la para ser corrigido.
      setErro(x instanceof Error ? x.message : 'Não consegui.');
      return false;
    } finally {
      setMexendo(false);
    }
  }

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
          {recado && (
          <p role="status" className="aviso mt-4">{recado}</p>
        )}
        {erro && (
          <div role="alert" className="bloco mt-4 bg-alerta-fundo p-3.5">
            <span className="rotulo-forte text-pink-texto">não deu certo</span>
            <p className="mt-1 text-[13.5px] font-medium">{erro}</p>
          </div>
        )}

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
                {/* LANÇAR NA MÃO. Antes da 0077 nao existia: so entrava
                    mensalidade de contrato, e custo nenhum. */}
                <Botao
                  tamanho="pequeno"
                  variante={lancando ? 'secundario' : 'primario'}
                  onClick={() => { setLancando((v) => !v); setEditando(null); }}
                >
                  {lancando ? 'Fechar' : '+ Lançar'}
                </Botao>
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

          {lancando && (
            <FormLancamento
              categorias={categorias}
              clientes={clientes}
              lancamento={null}
              ocupado={mexendo}
              aoCriar={(d) => void mexer(
                () => criarLancamento({ ...d, competencia: null }),
                `${d.descricao} lançado.`,
              ).then((deu) => { if (deu) setLancando(false); })}
              aoEditar={() => {}}
              aoFechar={() => setLancando(false)}
              aoCancelar={() => {}}
              aoApagar={() => {}}
            />
          )}

          {editando && (
            <FormLancamento
              key={editando.id}
              categorias={categorias}
              clientes={clientes}
              lancamento={editando}
              ocupado={mexendo}
              aoCriar={() => {}}
              aoEditar={(d) => void mexer(
                () => editarLancamento(editando.id, { ...d, competencia: null }),
                `${d.descricao} corrigido.`,
              ).then((deu) => { if (deu) setEditando(null); })}
              aoFechar={() => setEditando(null)}
              aoCancelar={() => void mexer(
                () => cancelarLancamento(editando.id),
                `${editando.descricao} saiu das contas do mês.`,
              ).then((deu) => { if (deu) setEditando(null); })}
              aoApagar={() => void mexer(
                () => apagarLancamento(editando.id),
                `${editando.descricao} foi apagado.`,
              ).then((deu) => { if (deu) setEditando(null); })}
            />
          )}

          {painel.lancamentos.length === 0 ? (
            <Vazio
              titulo="Mês sem lançamento."
              explica={
                contratos && contratos > 0
                  ? 'Use "gerar mensalidades" aqui em cima para os contratos ativos, ou "+ lançar" para um custo ou uma entrada avulsa.'
                  : 'Use "+ lançar" para registrar uma entrada ou uma saída.'
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
