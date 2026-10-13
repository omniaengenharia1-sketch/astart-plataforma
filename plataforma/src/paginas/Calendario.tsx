import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada, Escolha } from '../componentes/Campo';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import {
  calendarioDoCliente, conferirTokenDaMeta, contasDoCliente, criarPeca, descobrirContas,
  enviarParaAprovacao, FalhaDaMeta, salvarContaSocial,
} from '../dados/api';
import { diaMes, plural } from '../formato';
import { Compositor } from '../componentes/Compositor';
import { MidiaDaPecaPainel } from '../componentes/MidiaDaPeca';
import { PainelSaudeDoToken } from '../componentes/SaudeDoTokenMeta';
import type {
  ContaDescoberta, ContaSocial, MesDeConteudo, PecaNoMes, SaudeDoToken, TipoPeca,
} from '../dados/tipos';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const TIPOS: { valor: TipoPeca; rotulo: string }[] = [
  { valor: 'imagem', rotulo: 'Imagem' },
  { valor: 'carrossel', rotulo: 'Carrossel' },
  { valor: 'reel', rotulo: 'Reel' },
  { valor: 'story', rotulo: 'Story' },
];

/**
 * Conectar a conta — o elo que faltava entre "peça agendada" e "post no ar".
 *
 * Fica no calendário, e não em Ajustes, porque é aqui que a pergunta aparece:
 * a pessoa agenda a semana e quer saber por que nada publicou. Um aviso em
 * outra tela seria um aviso que ninguém lê.
 *
 * O fluxo tem duas etapas de propósito. A primeira pergunta à Meta o que o
 * token alcança e MOSTRA os nomes; a segunda grava a conta escolhida. Um campo
 * para digitar o `ig_user_id` seria mais curto e publicaria o post do cliente
 * na conta de outra pessoa no dia em que alguém errasse um dígito — e isso não
 * se desfaz.
 */
function ConectarConta({ clienteId, equipe }: { clienteId: string; equipe: boolean }) {
  const [contas, setContas] = useState<ContaSocial[] | null>(null);
  const [achadas, setAchadas] = useState<ContaDescoberta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [saude, setSaude] = useState<SaudeDoToken | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const ler = useCallback(async () => {
    try {
      setContas(await contasDoCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui ler as contas.');
    }
  }, [clienteId]);

  useEffect(() => {
    void ler();
  }, [ler]);

  async function procurar() {
    setErro(null);
    setSaude(null);
    setOcupado(true);
    try {
      setAchadas(await descobrirContas(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui falar com a Meta.');
      // A recusa da Meta vem com o diagnóstico do token no mesmo corpo (0048).
      // Sem ele, a pessoa lê "expirou ou foi revogado" e não sabe qual dos três
      // casos é o dela — foi exatamente o que aconteceu aqui.
      if (x instanceof FalhaDaMeta) setSaude(x.saude);
    } finally {
      setOcupado(false);
    }
  }

  /** Conferir sem tentar conectar: serve para saber ANTES de precisar. */
  async function conferir() {
    setErro(null);
    setOcupado(true);
    try {
      setSaude(await conferirTokenDaMeta());
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui conferir o token.');
      if (x instanceof FalhaDaMeta) setSaude(x.saude);
    } finally {
      setOcupado(false);
    }
  }

  async function ligar(conta: ContaDescoberta) {
    setErro(null);
    setOcupado(true);
    try {
      await salvarContaSocial(clienteId, conta);
      setAchadas(null);
      await ler();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui salvar a conta.');
    } finally {
      setOcupado(false);
    }
  }

  if (contas === null) return null;

  const prontas = contas.filter((c) => c.prontaParaPublicar);

  return (
    <section className="bloco mt-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="rotulo-forte">onde publica</div>
          {prontas.length > 0 ? (
            <p className="mt-1.5 text-[13.5px]">
              {prontas.map((c) => `@${c.nome}`).join(' · ')}
            </p>
          ) : (
            // O texto que evita a investigação: diz a consequência, não o estado.
            <p className="mt-1.5 text-[13.5px] text-tinta-2">
              Nenhuma conta conectada. As peças ficam agendadas e{' '}
              <strong>nada é publicado</strong> até ligar uma conta aqui.
            </p>
          )}
        </div>
        {equipe && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Conferir o token é separado de conectar de propósito: dá para
                saber que o token vai morrer ANTES de a pessoa precisar dele. */}
            <Botao variante="texto" tamanho="pequeno" disabled={ocupado} onClick={() => void conferir()}>
              Conferir token
            </Botao>
            <Botao tamanho="pequeno" disabled={ocupado} onClick={() => void procurar()}>
              {ocupado ? 'Procurando…' : contas.length > 0 ? 'Conectar outra' : 'Conectar conta'}
            </Botao>
          </div>
        )}
      </div>

      {contas.some((c) => !c.prontaParaPublicar) && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-linha-fraca pt-3">
          {contas
            .filter((c) => !c.prontaParaPublicar)
            .map((c) => (
              <li key={c.id} className="text-[13px]">
                <span className="font-bold">@{c.nome}</span>{' '}
                <Marca>
                  {!c.ativo
                    ? 'desligada'
                    : c.acessoParceiro === 'pendente'
                      ? 'o cliente ainda não aceitou o parceiro'
                      : c.acessoParceiro === 'expirado'
                        ? 'acesso de parceiro removido'
                        : 'falta o id do Instagram'}
                </Marca>
              </li>
            ))}
        </ul>
      )}

      {erro && (
        <p
          role="alert"
          className="mt-3 rounded-[var(--raio-p)] border border-linha bg-alerta-fundo px-3.5 py-2.5 text-[13px]"
        >
          {erro}
        </p>
      )}

      {saude && <PainelSaudeDoToken saude={saude} />}

      {achadas && (
        <div className="mt-4 border-t border-linha-fraca pt-3">
          <div className="rotulo">o que o token da agência alcança</div>
          <ul className="mt-2 flex flex-col gap-2">
            {achadas.map((a) => {
              const jaLigada = contas.some((c) => c.igUserId === a.igUserId);
              return (
                <li key={a.pageId} className="flex flex-wrap items-center gap-2.5 text-[13.5px]">
                  <span className="font-bold">{a.igUsername ? `@${a.igUsername}` : a.pageName}</span>
                  <span className="rotulo">{a.pageName}</span>
                  {!a.igUserId ? (
                    // Página sem Instagram vinculado não publica. Dizer o motivo
                    // aqui poupa uma viagem ao Business Manager às cegas.
                    <Marca>sem Instagram vinculado</Marca>
                  ) : jaLigada ? (
                    <Marca forte>já conectada</Marca>
                  ) : (
                    <Botao tamanho="pequeno" disabled={ocupado} onClick={() => void ligar(a)}>
                      Ligar a este cliente
                    </Botao>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="rotulo mt-2.5 normal-case">
            confira o @ antes de ligar. conta errada publica o post deste cliente no perfil de outro.
          </p>
        </div>
      )}
    </section>
  );
}

const hojeISO = () => new Date().toISOString().slice(0, 10);
const primeiroDoMes = (iso: string) => `${iso.slice(0, 7)}-01`;

function mesVizinho(mes: string, passo: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date((a ?? 2026), (m ?? 1) - 1 + passo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function porExtensoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[(m ?? 1) - 1]} de ${a}`;
}

/**
 * O que a peça está esperando, em uma palavra. Publicação manda sobre
 * aprovação: peça no ar já não está esperando ninguém.
 */
function selo(p: PecaNoMes, equipe: boolean): { texto: string; forte: boolean } {
  if (p.statusPublicacao === 'publicado') return { texto: 'no ar', forte: false };
  // Saiu numa conta e falhou na outra: pede olho, e por isso vem forte. Antes
  // este caso nao existia na lista e a peca aparecia como "rascunho".
  if (p.statusPublicacao === 'publicado_parcial') return { texto: 'parcial', forte: true };
  if (p.statusPublicacao === 'falhou') return { texto: 'falhou', forte: true };
  if (p.statusPublicacao === 'publicando') return { texto: 'saindo', forte: false };
  if (p.estadoAprovacao === 'com_ajustes') return { texto: 'ajuste', forte: true };
  if (p.estadoAprovacao === 'em_aprovacao') {
    return { texto: equipe ? 'no cliente' : 'ver', forte: !equipe };
  }
  if (p.estadoAprovacao === 'aprovado') return { texto: 'aprovada', forte: false };
  if (p.estadoAprovacao === 'declinado') return { texto: 'declinada', forte: false };
  return { texto: equipe ? 'rascunho' : 'em produção', forte: false };
}

function Chip({
  p,
  equipe,
  clienteId,
  aberta,
  abrir,
  aoMudar,
}: {
  p: PecaNoMes;
  equipe: boolean;
  clienteId?: string;
  aberta?: boolean;
  abrir?: () => void;
  aoMudar?: () => void;
}) {
  const s = selo(p, equipe);
  return (
    <div
      className={
        'rounded-[10px] border bg-superficie px-2 py-1.5 ' +
        (aberta ? 'border-pink' : 'border-linha')
      }
    >
      {/* A peça inteira é clicável: um ícone pequeno de "anexar" seria menos
          descobrível, e a mídia é a coisa que falta em toda peça nova. */}
      {abrir ? (
        <button type="button" onClick={abrir} className="w-full text-left" aria-expanded={aberta}>
          <span className="flex items-center justify-between gap-1">
            <span className="numeros text-[10.5px]">{p.hora}</span>
            <Marca forte={s.forte}>{s.texto}</Marca>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[12px] leading-tight font-medium">
            {p.titulo}
          </span>
        </button>
      ) : (
        <div title={`${p.titulo} · ${p.hora}`}>
          <div className="flex items-center justify-between gap-1">
            <span className="numeros text-[10.5px]">{p.hora}</span>
            <Marca forte={s.forte}>{s.texto}</Marca>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[12px] leading-tight font-medium">{p.titulo}</div>
        </div>
      )}

      {aberta && clienteId && (
        <MidiaDaPecaPainel
          peca={p}
          clienteId={clienteId}
          equipe={equipe}
          aoMudar={aoMudar ?? (() => {})}
        />
      )}
    </div>
  );
}

export function Calendario({ clienteId, equipe }: { clienteId: string; equipe: boolean }) {
  const [mes, setMes] = useState(() => primeiroDoMes(hojeISO()));
  const [dados, setDados] = useState<MesDeConteudo | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [novoDia, setNovoDia] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<TipoPeca>('imagem');
  const [hora, setHora] = useState('12:00');
  const [criando, setCriando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const [marcados, setMarcados] = useState<string[]>([]);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  // O compositor e o caminho completo: arquivo, rede, formato, legenda,
  // hashtags e o botao de agendar. O formulario pequeno continua existindo
  // para marcar o mes rapido, clicando num dia vazio do grid — planejar e uma
  // tarefa, publicar e outra, e obrigar a abrir o compositor para rabiscar uma
  // ideia seria trocar uma tela certa por uma tela completa.
  const [compondo, setCompondo] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await calendarioDoCliente(clienteId, mes));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir o mês.');
    }
  }, [clienteId, mes]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, PecaNoMes[]>();
    for (const p of dados?.pecas ?? []) {
      const lista = mapa.get(p.dia);
      if (lista) lista.push(p);
      else mapa.set(p.dia, [p]);
    }
    return mapa;
  }, [dados]);

  const celulas = useMemo(() => {
    const [a, m] = mes.split('-').map(Number);
    const ano = a ?? 2026;
    const mm = m ?? 1;
    const primeiro = new Date(ano, mm - 1, 1);
    const dias = new Date(ano, mm, 0).getDate();
    const vazios = primeiro.getDay();
    const lista: (string | null)[] = Array.from({ length: vazios }, () => null);
    for (let d = 1; d <= dias; d += 1) {
      lista.push(`${ano}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return lista;
  }, [mes]);

  async function criar() {
    if (criando || !novoDia) return;
    setCriando(true);
    setErroForm(null);
    try {
      await criarPeca(clienteId, titulo, tipo, novoDia, hora);
      setTitulo('');
      setNovoDia(null);
      await carregar();
    } catch (x) {
      setErroForm(x instanceof Error ? x.message : 'Não consegui criar a peça.');
    } finally {
      setCriando(false);
    }
  }

  async function enviar() {
    if (enviando || marcados.length === 0) return;
    setEnviando(true);
    setErroEnvio(null);
    setRecado(null);
    try {
      const n = await enviarParaAprovacao(marcados, mensagem);
      setMarcados([]);
      setMensagem('');
      setRecado(`${plural(n, 'peça foi', 'peças foram')} para o cliente.`);
      await carregar();
    } catch (x) {
      setErroEnvio(x instanceof Error ? x.message : 'Não consegui enviar.');
    } finally {
      setEnviando(false);
      await carregar();
    }
  }

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!dados) return <Carregando oQue="o mês" />;

  const prontas = dados.pecas.filter(
    (p) =>
      p.itemId !== null &&
      (p.estadoAprovacao === 'produzindo' || p.estadoAprovacao === 'com_ajustes') &&
      p.statusPublicacao !== 'publicado',
  );
  const cota = dados.plano?.cota ?? null;
  const diasDoPlano = dados.plano?.diasSemana ?? [];

  return (
    <div className={'pt-7 ' + (equipe && marcados.length > 0 ? 'pb-24' : '')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Botao tamanho="pequeno" onClick={() => setMes(mesVizinho(mes, -1))} aria-label="Mês anterior">
            &lt;
          </Botao>
          <h2 className="titulao text-[clamp(1.2rem,4vw,1.7rem)]">{porExtensoMes(mes)}</h2>
          <Botao tamanho="pequeno" onClick={() => setMes(mesVizinho(mes, 1))} aria-label="Próximo mês">
            &gt;
          </Botao>
        </div>
        {equipe && (
          <Botao
            variante="primario"
            tamanho="pequeno"
            onClick={() => {
              setCompondo(!compondo);
              setNovoDia(null);
            }}
          >
            Nova publicação
          </Botao>
        )}
      </div>

      <ConectarConta clienteId={clienteId} equipe={equipe} />

      {equipe && compondo && (
        <Compositor
          clienteId={clienteId}
          diaSugerido={novoDia}
          aoFechar={() => setCompondo(false)}
          // Atualiza o mes atras do compositor, sem fecha-lo: quem fecha e a
          // pessoa, depois de ler a confirmacao.
          aoSalvar={() => void carregar()}
        />
      )}

      <div className="escada mt-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Bloco
          rotulo={cota ? 'No mês · cota' : 'No mês'}
          destaque={cota ? `${dados.noMes}/${cota}` : String(dados.noMes)}
        />
        <Bloco
          rotulo={equipe ? 'Esperando o cliente' : 'Esperando você'}
          destaque={String(dados.esperandoCliente)}
          alerta={!equipe && dados.esperandoCliente > 0}
        />
        <Bloco
          rotulo="Com ajuste"
          destaque={String(dados.comAjustes)}
          alerta={equipe && dados.comAjustes > 0}
        />
        <Bloco rotulo={dados.falhas > 0 ? 'Falharam' : 'Publicadas'} destaque={String(dados.falhas > 0 ? dados.falhas : dados.publicadas)} alerta={dados.falhas > 0} />
      </div>

      {equipe && novoDia && (
        <div className="bloco mt-5 p-4 sm:p-5">
          <div className="rotulo-forte">nova peça</div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Campo id="peca-titulo" rotulo="Nome interno" dica="só a equipe vê">
              <Entrada
                id="peca-titulo"
                value={titulo}
                autoFocus
                placeholder="Ex.: Carrossel do pão"
                onChange={(e) => setTitulo(e.target.value)}
              />
            </Campo>
            <Campo id="peca-tipo" rotulo="Tipo">
              <Escolha id="peca-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoPeca)}>
                {TIPOS.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.rotulo}
                  </option>
                ))}
              </Escolha>
            </Campo>
            <Campo id="peca-dia" rotulo="Sai em">
              <Entrada
                id="peca-dia"
                type="date"
                value={novoDia}
                onChange={(e) => setNovoDia(e.target.value)}
              />
            </Campo>
            <Campo id="peca-hora" rotulo="Hora" dica="fuso do cliente">
              <Entrada
                id="peca-hora"
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </Campo>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Botao variante="primario" disabled={criando || !titulo.trim()} onClick={() => void criar()}>
              {criando ? 'Criando…' : 'Criar peça'}
            </Botao>
            <Botao variante="texto" disabled={criando} onClick={() => setNovoDia(null)}>
              Cancelar
            </Botao>
          </div>
          {erroForm && (
            <div role="alert" className="bloco mt-4 bg-alerta-fundo p-3.5">
              <span className="rotulo-forte text-pink-texto">não deu certo</span>
              <p className="mt-1 text-[13.5px] font-medium">{erroForm}</p>
            </div>
          )}
        </div>
      )}

      {/* Grade de mês no desktop; no celular ela viraria sete colunas de 50px. */}
      <div className="mt-6 hidden lg:block">
        <div className="grid grid-cols-7">
          {SEMANA.map((d, i) => (
            <div
              key={d}
              className={
                'rotulo-forte border-b border-linha px-2 py-2 ' +
                (diasDoPlano.includes(i) ? 'bg-superficie-2' : '')
              }
            >
              {d}
            </div>
          ))}
          {celulas.map((dia, i) => {
            const pecasDoDia = dia ? (porDia.get(dia) ?? []) : [];
            const conteudo = dia && (
              <>
                <div className="numeros mb-1 text-left text-[11px] text-tinta-3">
                  {Number(dia.slice(8))}
                </div>
                <div className="flex flex-col gap-1">
                  {pecasDoDia.map((p) => (
                    <Chip key={p.id} p={p} equipe={equipe} />
                  ))}
                </div>
              </>
            );
            const classe =
              'min-h-28 w-full border-r border-b border-linha-fraca p-1.5 text-left ' +
              (dia === hojeISO() ? 'bg-pink-fundo ' : '');

            // Dia clicavel e <button>, nao <div onClick>: com div, criar peca
            // existia so para quem tem mouse.
            return dia && equipe ? (
              <button
                key={dia}
                type="button"
                aria-label={`Criar peça no dia ${Number(dia.slice(8))}${
                  pecasDoDia.length ? ` · ${pecasDoDia.length} já marcada(s)` : ''
                }`}
                onClick={() => {
                  setNovoDia(dia);
                  setErroForm(null);
                }}
                className={classe + 'cursor-pointer transition-colors hover:aurora'}
              >
                {conteudo}
              </button>
            ) : (
              <div key={dia ?? `vazio-${i}`} className={classe}>
                {conteudo}
              </div>
            );
          })}
        </div>
      </div>

      {/*
        A agenda por dia, em TODAS as larguras — e isto mudou de propósito.

        Ela era `lg:hidden`: no celular aparecia a agenda, no desktop só o grid
        do mês. Fazia sentido quando a peça só informava. Deixou de fazer no
        instante em que ela passou a abrir o arquivo, porque o grid não pode
        abrir nada: o dia inteiro já é um `<button>` que cria peça, e botão
        dentro de botão é HTML inválido.

        Resultado: por um momento, anexar arquivo funcionava só no celular — a
        funcionalidade existia e era inalcançável em metade das telas. O grid
        continua sendo a visão do mês; a agenda é onde se trabalha a peça.
      */}
      <div className="mt-6">
        {equipe && dados.pecas.length > 0 && (
          <Fita>Peça por peça — toque para abrir o arquivo</Fita>
        )}
        {dados.pecas.length === 0 ? (
          <Vazio
            titulo="Mês vazio."
            explica={equipe ? 'Nenhuma peça marcada.' : 'Nada marcado neste mês.'}
          />
        ) : (
          [...porDia.entries()].map(([dia, lista]) => (
            <div key={dia} className="mb-5">
              <div className="rotulo-forte mb-1.5">
                {diaMes(dia)} · {SEMANA[new Date(`${dia}T12:00:00`).getDay()]}
              </div>
              <div className="flex flex-col gap-2">
                {lista.map((p) => (
                  <Chip
                    key={p.id}
                    p={p}
                    equipe={equipe}
                    clienteId={clienteId}
                    aberta={abertaId === p.id}
                    abrir={() => setAbertaId(abertaId === p.id ? null : p.id)}
                    aoMudar={() => void carregar()}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {equipe && (
        <section className="mt-9">
          <Fita>Pronto para mandar</Fita>
          {prontas.length === 0 ? (
            <p className="py-4 text-tinta-3">Nada em rascunho.</p>
          ) : (
            <ul className="border-t border-linha-fraca">
              {prontas.map((p) => (
                <li
                  key={p.id}
                  className={
                    'flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-3 py-3 ' +
                    (p.estadoAprovacao === 'com_ajustes' ? 'border-l-2 border-l-pink' : '')
                  }
                >
                  <input
                    type="checkbox"
                    checked={marcados.includes(p.itemId ?? '')}
                    onChange={(e) =>
                      setMarcados((a) =>
                        e.target.checked
                          ? [...a, p.itemId ?? '']
                          : a.filter((x) => x !== (p.itemId ?? '')),
                      )
                    }
                    aria-label={`Enviar ${p.titulo}`}
                    className="size-5 shrink-0 cursor-pointer accent-[var(--pink)]"
                  />
                  <span className="numeros w-20 shrink-0 text-[12px]">
                    {diaMes(p.dia)} {p.hora}
                  </span>
                  <span className="min-w-48 flex-1 font-medium">{p.titulo}</span>
                  <Marca>{p.tipo}</Marca>
                  <Marca forte={p.estadoAprovacao === 'com_ajustes'}>
                    {selo(p, true).texto}
                  </Marca>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {recado && (
        <p role="status" className="rotulo-forte mt-6">
          {recado}
        </p>
      )}
      {erroEnvio && <Falhou mensagem={erroEnvio} />}

      {equipe && marcados.length > 0 && (
        <div className="vidro-chapa sticky bottom-0 z-10 mt-8 border-t border-linha px-1 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rotulo-forte">{plural(marcados.length, 'peça marcada', 'peças marcadas')}</span>
            <Entrada
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder="Recado (opcional)"
              aria-label="Recado para o cliente"
              className="max-w-80 flex-1"
            />
            <Botao variante="primario" disabled={enviando} onClick={() => void enviar()}>
              {enviando ? 'Enviando…' : 'Enviar ao cliente'}
            </Botao>
            <Botao variante="texto" disabled={enviando} onClick={() => setMarcados([])}>
              Limpar
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}
