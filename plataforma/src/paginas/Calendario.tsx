import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada, Escolha } from '../componentes/Campo';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { calendarioDoCliente, criarPeca, enviarParaAprovacao } from '../dados/api';
import { diaMes, plural } from '../formato';
import type { MesDeConteudo, PecaNoMes, TipoPeca } from '../dados/tipos';

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

function Chip({ p, equipe }: { p: PecaNoMes; equipe: boolean }) {
  const s = selo(p, equipe);
  return (
    <div className="border-2 border-linha bg-superficie px-1.5 py-1">
      <div className="flex items-center justify-between gap-1">
        <span className="numeros text-[10.5px]">{p.hora}</span>
        <Marca forte={s.forte}>{s.texto}</Marca>
      </div>
      <div className="mt-0.5 line-clamp-2 text-[12px] leading-tight font-medium">{p.titulo}</div>
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
            onClick={() => setNovoDia(novoDia ? null : hojeISO())}
          >
            Nova peça
          </Botao>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
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
        <div className="bloco sombra-dura-p mt-5 bg-superficie p-4 sm:p-5">
          <div className="rotulo-forte">nova peça</div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Campo id="peca-titulo" rotulo="Nome interno" dica="é por ele que a equipe acha a peça">
              <Entrada
                id="peca-titulo"
                value={titulo}
                autoFocus
                placeholder="Ex.: Carrossel do pão de fermentação natural"
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
            <Campo id="peca-hora" rotulo="Hora" dica={`no fuso de ${dados.fusoHorario}`}>
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
            <div role="alert" className="bloco mt-4 border-4 bg-alerta-fundo p-3">
              <span className="rotulo-forte">não deu certo</span>
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
                'rotulo-forte border-b-4 border-linha px-2 py-2 ' +
                (diasDoPlano.includes(i) ? 'bg-superficie-2' : '')
              }
            >
              {d}
            </div>
          ))}
          {celulas.map((dia, i) => (
            <div
              key={dia ?? `vazio-${i}`}
              className={
                'min-h-28 border-r-2 border-b-2 border-linha-fraca p-1.5 ' +
                (dia === hojeISO() ? 'bg-pink-fundo ' : '') +
                (dia && equipe ? 'cursor-pointer hover:bg-superficie-2' : '')
              }
              onClick={dia && equipe ? () => { setNovoDia(dia); setErroForm(null); } : undefined}
            >
              {dia && (
                <>
                  <div className="numeros mb-1 text-[11px] text-tinta-3">{Number(dia.slice(8))}</div>
                  <div className="flex flex-col gap-1">
                    {(porDia.get(dia) ?? []).map((p) => (
                      <Chip key={p.id} p={p} equipe={equipe} />
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* No celular e no tablet, a mesma informação como agenda. */}
      <div className="mt-6 lg:hidden">
        {dados.pecas.length === 0 ? (
          <Vazio
            titulo="Mês vazio."
            explica={equipe ? 'Nenhuma peça marcada para este mês ainda.' : 'Nada publicado nem marcado por aqui.'}
          />
        ) : (
          [...porDia.entries()].map(([dia, lista]) => (
            <div key={dia} className="mb-5">
              <div className="rotulo-forte mb-1.5">
                {diaMes(dia)} · {SEMANA[new Date(`${dia}T12:00:00`).getDay()]}
              </div>
              <div className="flex flex-col gap-2">
                {lista.map((p) => (
                  <Chip key={p.id} p={p} equipe={equipe} />
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
            <p className="py-4 text-tinta-3">
              Nada em rascunho neste mês. O que foi enviado está com o cliente.
            </p>
          ) : (
            <ul className="border-t-2 border-linha">
              {prontas.map((p) => (
                <li
                  key={p.id}
                  className={
                    'flex flex-wrap items-center gap-x-4 gap-y-2 border-x-2 border-b-2 border-linha px-3 py-3 ' +
                    (p.estadoAprovacao === 'com_ajustes' ? 'border-l-8 border-l-pink' : '')
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
                    className="size-4 shrink-0 accent-[var(--pink)]"
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
        <div className="sticky bottom-0 z-10 mt-8 border-t-4 border-linha bg-papel py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rotulo-forte">{plural(marcados.length, 'peça marcada', 'peças marcadas')}</span>
            <Entrada
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder="Recado para o cliente (opcional)"
              aria-label="Recado para o cliente"
              className="max-w-80 flex-1"
            />
            <Botao variante="primario" disabled={enviando} onClick={() => void enviar()}>
              {enviando ? 'Enviando…' : 'Enviar para aprovação'}
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
