import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo, CampoDinheiro, Entrada, Escolha, Segmento } from '../componentes/Campo';
import { Carregando, Falhou } from '../componentes/Estado';
import { catalogo as lerCatalogo, criarCliente } from '../dados/api';
import { reais, sluguificar } from '../formato';
import { MODULO } from '../rotulos';
import type {
  Catalogo, ChaveModulo, ChaveServico, FormatoContrato, ServicoCatalogo, ServicoEscolhido,
} from '../dados/tipos';

const hojeISO = () => new Date().toISOString().slice(0, 10);

/**
 * Que formatos fazem sentido oferecer. O banco guarda só o padrão de cada
 * serviço; aqui a tela abre a alternativa que a Astart de fato vende — o
 * Audiovisual não tem padrão nenhum, então ela pergunta sem pré-selecionar.
 */
function formatosDe(s: ServicoCatalogo): { valor: FormatoContrato; rotulo: string }[] {
  if (s.formatoPadrao === 'recorrente') {
    return [
      { valor: 'recorrente', rotulo: 'Por mês' },
      { valor: 'pontual', rotulo: 'Pontual' },
    ];
  }
  if (s.formatoPadrao === 'projeto') {
    return [
      { valor: 'projeto', rotulo: 'Projeto' },
      { valor: 'pontual', rotulo: 'Pontual' },
    ];
  }
  return [
    { valor: 'recorrente', rotulo: 'Por mês' },
    { valor: 'pontual', rotulo: 'Pontual' },
  ];
}

const DIAS_VENCIMENTO = Array.from({ length: 28 }, (_, i) => i + 1);

const FUSOS = [
  'America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba',
  'America/Belem', 'America/Fortaleza', 'America/Rio_Branco',
];

function LinhaServico({
  s,
  escolha,
  equipe,
  aoMudar,
  aoTirar,
}: {
  s: ServicoCatalogo;
  escolha: ServicoEscolhido;
  equipe: Catalogo['equipe'];
  aoMudar: (e: ServicoEscolhido) => void;
  aoTirar: () => void;
}) {
  const recorrente = escolha.formato === 'recorrente';
  const opcionais = s.modulos.filter((m) => m.opcional);
  const id = `srv-${s.chave}`;

  return (
    <div className="bloco sombra-dura-p bg-superficie p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="titulao text-[clamp(1.05rem,3vw,1.3rem)]">{s.nome}</h3>
        <Botao variante="texto" tamanho="pequeno" onClick={aoTirar}>
          Tirar
        </Botao>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Como cobra"
          dica={
            s.formatoPadrao === null && escolha.formato === null
              ? 'o audiovisual pode ser mensal ou de uma vez — diga qual'
              : undefined
          }
        >
          <Segmento
            rotuloGrupo={`Formato de ${s.nome}`}
            opcoes={formatosDe(s)}
            valor={escolha.formato}
            aoEscolher={(formato) =>
              aoMudar({
                ...escolha,
                formato,
                diaVencimento: formato === 'recorrente' ? (escolha.diaVencimento ?? 10) : null,
                parcelas: formato === 'recorrente' ? null : (escolha.parcelas ?? 1),
              })
            }
          />
        </Campo>

        <Campo id={`${id}-valor`} rotulo={recorrente ? 'Valor por mês' : 'Valor total'}>
          <CampoDinheiro
            id={`${id}-valor`}
            centavos={escolha.valorCentavos}
            aoMudar={(valorCentavos) => aoMudar({ ...escolha, valorCentavos })}
          />
        </Campo>

        {recorrente ? (
          <Campo id={`${id}-dia`} rotulo="Vence todo dia" dica="até o 28, que existe em todo mês">
            <Escolha
              id={`${id}-dia`}
              value={escolha.diaVencimento ?? 10}
              onChange={(e) => aoMudar({ ...escolha, diaVencimento: Number(e.target.value) })}
            >
              {DIAS_VENCIMENTO.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Escolha>
          </Campo>
        ) : (
          <Campo id={`${id}-parcelas`} rotulo="Parcelas">
            <Entrada
              id={`${id}-parcelas`}
              type="number"
              min={1}
              max={36}
              value={escolha.parcelas ?? 1}
              onChange={(e) =>
                aoMudar({ ...escolha, parcelas: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </Campo>
        )}

        <Campo id={`${id}-inicio`} rotulo="Começa em">
          <Entrada
            id={`${id}-inicio`}
            type="date"
            value={escolha.inicio}
            onChange={(e) => aoMudar({ ...escolha, inicio: e.target.value })}
          />
        </Campo>

        {!recorrente && (
          <Campo id={`${id}-entrega`} rotulo="Entrega prevista" dica="pode ficar em branco">
            <Entrada
              id={`${id}-entrega`}
              type="date"
              value={escolha.entregaEm ?? ''}
              onChange={(e) => aoMudar({ ...escolha, entregaEm: e.target.value || null })}
            />
          </Campo>
        )}

        <Campo id={`${id}-resp`} rotulo="Responsável">
          <Escolha
            id={`${id}-resp`}
            value={escolha.responsavelId ?? ''}
            onChange={(e) => aoMudar({ ...escolha, responsavelId: e.target.value || null })}
          >
            <option value="">quem cuida disso</option>
            {equipe.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.nome ?? m.userId}
              </option>
            ))}
          </Escolha>
        </Campo>
      </div>

      {opcionais.length > 0 && (
        <div className="mt-4 border-t-2 border-linha-fraca pt-3">
          <span className="rotulo-forte">ligar também</span>
          <div className="mt-2 flex flex-wrap gap-4">
            {opcionais.map((m) => (
              <label key={m.chave} className="flex items-center gap-2 text-[13.5px]">
                <input
                  type="checkbox"
                  checked={escolha.modulos.includes(m.chave)}
                  onChange={(e) =>
                    aoMudar({
                      ...escolha,
                      modulos: e.target.checked
                        ? [...escolha.modulos, m.chave]
                        : escolha.modulos.filter((x) => x !== m.chave),
                    })
                  }
                  className="size-4 accent-[var(--pink)]"
                />
                {m.nome}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function NovoCliente() {
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [erroCat, setErroCat] = useState<string | null>(null);
  const [aba, setAba] = useState<'mao' | 'proposta'>('mao');

  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [editandoSlug, setEditandoSlug] = useState(false);
  const [fuso, setFuso] = useState('America/Sao_Paulo');
  const [escolhidos, setEscolhidos] = useState<ServicoEscolhido[]>([]);
  const [abrindo, setAbrindo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const navegar = useNavigate();

  const carregar = useCallback(async () => {
    setErroCat(null);
    try {
      setCat(await lerCatalogo());
    } catch (x) {
      setErroCat(x instanceof Error ? x.message : 'Não consegui carregar os serviços.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const endereco = editandoSlug ? sluguificar(slug) : sluguificar(nome);

  const disponiveis = useMemo(
    () => (cat?.servicos ?? []).filter((s) => !escolhidos.some((e) => e.servico === s.chave)),
    [cat, escolhidos],
  );

  const mensal = escolhidos
    .filter((e) => e.formato === 'recorrente')
    .reduce((a, e) => a + e.valorCentavos, 0);
  const unico = escolhidos
    .filter((e) => e.formato !== 'recorrente')
    .reduce((a, e) => a + e.valorCentavos, 0);

  /** O que o contrato liga — a mesma matriz que o banco aplica no RLS. */
  const modulos = useMemo(() => {
    if (!cat) return [];
    const ligados = new Set<ChaveModulo>(cat.modulosSempre.map((m) => m.chave));
    for (const e of escolhidos) {
      const s = cat.servicos.find((x) => x.chave === e.servico);
      for (const m of s?.modulos ?? []) {
        if (!m.opcional || e.modulos.includes(m.chave)) ligados.add(m.chave);
      }
    }
    return [...ligados];
  }, [cat, escolhidos]);

  function adicionar(chave: ChaveServico) {
    const s = cat?.servicos.find((x) => x.chave === chave);
    if (!s) return;
    setEscolhidos((a) => [
      ...a,
      {
        servico: chave,
        formato: s.formatoPadrao,
        valorCentavos: 0,
        diaVencimento: s.formatoPadrao === 'recorrente' ? 10 : null,
        parcelas: s.formatoPadrao === 'recorrente' ? null : 1,
        inicio: hojeISO(),
        entregaEm: null,
        responsavelId: null,
        modulos: [],
      },
    ]);
    setAbrindo(false);
  }

  const semFormato = escolhidos.filter((e) => e.formato === null);
  const podeEnviar =
    nome.trim().length > 0 && endereco !== '' && escolhidos.length > 0 && semFormato.length === 0;

  async function enviar() {
    if (enviando || !podeEnviar) return; // Clique duplo não cadastra dois clientes.
    setEnviando(true);
    setErro(null);
    try {
      const novo = await criarCliente(nome, escolhidos, endereco, fuso);
      navegar(`/clientes/${novo.id}`);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui cadastrar o cliente.');
      setEnviando(false);
    }
  }

  if (erroCat) return <Falhou mensagem={erroCat} tentar={() => void carregar()} />;
  if (!cat) return <Carregando oQue="os serviços" />;

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <Link to="/clientes" className="rotulo hover:text-pink">
          &lt; clientes
        </Link>
        <h1 className="titulao mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">Novo cliente</h1>
        <p className="mt-3 max-w-xl text-tinta-2">
          O contrato é o que liga as telas dele. Serviço contratado abre aba; serviço
          que não entrou não aparece em lugar nenhum.
        </p>
      </div>

      <div className="mt-6 flex gap-2 border-y-2 border-linha py-2">
        {([
          ['mao', 'Preencher à mão'],
          ['proposta', 'Jogar a proposta'],
        ] as const).map(([chave, texto]) => (
          <button
            key={chave}
            type="button"
            onClick={() => setAba(chave)}
            className={
              'px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.16em] uppercase ' +
              (aba === chave ? 'bg-tinta text-papel' : 'text-tinta-3 hover:bg-superficie-2 hover:text-tinta')
            }
          >
            {texto}
          </button>
        ))}
      </div>

      {aba === 'proposta' ? (
        <div className="bloco sombra-dura mt-7 max-w-2xl border-4 bg-superficie p-5 sm:p-7">
          <div className="rotulo">ainda não ligado</div>
          <h2 className="titulao mt-2 text-[clamp(1.2rem,4vw,1.7rem)]">
            Ler a proposta e montar o cliente sozinho
          </h2>
          <p className="mt-3 text-tinta-2">
            O desenho está pronto: você joga o PDF da proposta ou cola o link, e a plataforma
            preenche nome, serviços e valores para você só conferir.
          </p>
          <p className="mt-3 text-tinta-2">Faltam duas coisas, e as duas são suas:</p>
          <ul className="mt-3 space-y-2">
            <li className="border-l-4 border-pink pl-3">
              A chave da API da Anthropic, que é quem lê o PDF.
            </li>
            <li className="border-l-4 border-pink pl-3">
              A sua decisão de que a proposta de um cliente pode sair da nossa infraestrutura
              para ser lida. Enquanto isso não estiver decidido, não vou mandar documento de
              cliente para lugar nenhum.
            </li>
          </ul>
          <Botao className="mt-6" onClick={() => setAba('mao')}>
            Preencher à mão por enquanto
          </Botao>
        </div>
      ) : (
        <>
          <div className="mt-7 grid items-start gap-9 lg:grid-cols-[1fr_320px]">
            <div>
              <Fita>Quem é</Fita>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Campo id="nome" rotulo="Nome do cliente" dica="o nome que aparece na plataforma">
                  <Entrada
                    id="nome"
                    value={nome}
                    autoFocus
                    placeholder="Ex.: Padaria Aurora"
                    onChange={(e) => setNome(e.target.value)}
                  />
                </Campo>

                <Campo
                  id="slug"
                  rotulo="Endereço"
                  dica={
                    editandoSlug ? (
                      'só letras, números e hífen'
                    ) : (
                      <>
                        sai do nome —{' '}
                        <button
                          type="button"
                          className="underline hover:text-pink"
                          onClick={() => {
                            setSlug(endereco);
                            setEditandoSlug(true);
                          }}
                        >
                          escrever outro
                        </button>
                      </>
                    )
                  }
                >
                  {editandoSlug ? (
                    <Entrada id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
                  ) : (
                    <div className="numeros flex min-h-11 items-center border-2 border-linha-fraca bg-superficie-2 px-3 text-[13px] text-tinta-2">
                      {endereco || '—'}
                    </div>
                  )}
                </Campo>

                <Campo id="fuso" rotulo="Fuso do cliente" dica="só para mostrar hora certa a ele">
                  <Escolha id="fuso" value={fuso} onChange={(e) => setFuso(e.target.value)}>
                    {FUSOS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </Escolha>
                </Campo>
              </div>

              <div className="mt-9" />
              <Fita>O que ele contratou</Fita>

              {escolhidos.length > 0 && (
                <div className="mt-4 grid gap-5">
                  {escolhidos.map((e, i) => {
                    const s = cat.servicos.find((x) => x.chave === e.servico);
                    if (!s) return null;
                    return (
                      <LinhaServico
                        key={e.servico}
                        s={s}
                        escolha={e}
                        equipe={cat.equipe}
                        aoMudar={(novo) =>
                          setEscolhidos((a) => a.map((x, j) => (j === i ? novo : x)))
                        }
                        aoTirar={() => setEscolhidos((a) => a.filter((_, j) => j !== i))}
                      />
                    );
                  })}
                </div>
              )}

              {/* A barrinha: clicar abre a lista do que ainda não entrou. */}
              {disponiveis.length > 0 && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setAbrindo((v) => !v)}
                    aria-expanded={abrindo}
                    className="flex min-h-12 w-full items-center justify-between border-2 border-dashed border-linha bg-superficie px-4 hover:bg-superficie-2"
                  >
                    <span className="rotulo-forte">
                      {escolhidos.length === 0 ? 'escolher serviço' : 'adicionar outro serviço'}
                    </span>
                    <span className="rotulo-forte">{abrindo ? '×' : '+'}</span>
                  </button>

                  {abrindo && (
                    <ul className="border-x-2 border-b-2 border-linha">
                      {disponiveis.map((s) => (
                        <li key={s.chave}>
                          <button
                            type="button"
                            onClick={() => adicionar(s.chave)}
                            className="flex w-full items-center justify-between gap-3 border-b-2 border-linha-fraca px-4 py-3 text-left last:border-0 hover:bg-pink hover:text-sobre-pink"
                          >
                            <span className="font-bold uppercase">{s.nome}</span>
                            <span className="rotulo">
                              {s.formatoPadrao === 'recorrente'
                                ? 'por mês'
                                : s.formatoPadrao === 'projeto'
                                  ? 'projeto'
                                  : 'mensal ou pontual'}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {escolhidos.length === 0 && !abrindo && (
                <p className="rotulo mt-3">sem serviço o cliente não tem tela nenhuma</p>
              )}
            </div>

            <aside className="lg:sticky lg:top-5">
              <Fita>Vai ficar assim</Fita>
              <div className="mt-4 grid gap-4">
                <Bloco rotulo="Por mês" destaque={reais(mensal)} />
                <Bloco rotulo="Projeto e pontual" destaque={reais(unico)} />
              </div>

              <div className="mt-6">
                <span className="rotulo-forte">abas que o contrato liga</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {modulos.map((m) => (
                    <Marca key={m}>{MODULO[m]}</Marca>
                  ))}
                </div>
              </div>

              {semFormato.length > 0 && (
                <p className="rotulo mt-4 normal-case text-tinta">
                  falta dizer como cobra{' '}
                  {semFormato
                    .map((e) => cat.servicos.find((s) => s.chave === e.servico)?.nome)
                    .filter(Boolean)
                    .join(', ')}
                </p>
              )}

              <Botao
                variante="primario"
                className="mt-6 w-full"
                disabled={!podeEnviar || enviando}
                onClick={() => void enviar()}
              >
                {enviando ? 'Cadastrando…' : 'Cadastrar cliente'}
              </Botao>

              {erro && (
                <div role="alert" className="bloco mt-4 border-4 bg-alerta-fundo p-3">
                  <span className="rotulo-forte">não deu certo</span>
                  <p className="mt-1 text-[13.5px] font-medium">{erro}</p>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
