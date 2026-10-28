/**
 * O álbum: a entrega como o cliente recebe.
 *
 * Refeito no formato que a dona pediu, olhando o Pixieset ao lado: capa grande
 * com o nome em cima, e embaixo as fotos em fileiras justificadas — sem cartão
 * branco, sem barra de "0 MB · BAIXAR" embaixo de cada uma. A moldura competia
 * com a foto, que é a única coisa que importa aqui.
 *
 * Três defeitos morreram juntos nesta reescrita, todos visíveis na captura que
 * ela mandou:
 *
 *   1. O peso saía "0 MB" em toda foto de menos de meio mega, enquanto o topo
 *      somava 97 MB. `Math.round(0,5)` é 0.
 *   2. Todas as fotos entravam num quadrado 4:3 fixo, então retrato sobrava
 *      branco e paisagem era cortada. Agora a fileira se ajusta à proporção de
 *      cada uma — é o que o Pixieset faz, e é por isso que parece álbum.
 *   3. A grade baixava 77 MB de "miniaturas" que eram PNG do tamanho do
 *      original. Agora pede pelo tamanho em que mostra (ver `dados/imagem.ts`).
 *
 * As fileiras são calculadas aqui, com a largura e a altura que cada item já
 * traz do banco. Sem biblioteca: é uma conta de divisão, e trazer um pacote
 * para isso seria mais código do que a conta.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Botao } from '../componentes/Botao';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { albumDoCliente, definirCapaGaleria, favoritarItem, urlsDosOriginais } from '../dados/api';
import { albumPorToken, baixarItem, baixarTudo, favoritarPorToken, verItem } from '../dados/galeria';
import type { FonteAlbum } from '../dados/galeria';
import { LARGURA, noTamanho } from '../dados/imagem';
import { diaMes, plural } from '../formato';
import type { Album as Alb, ItemGaleria } from '../dados/tipos';

/**
 * O peso do arquivo em palavra de gente.
 *
 * Era `Math.round(bytes / 1e6) + ' MB'`, e uma foto de 500 KB virava "0 MB" na
 * cara do cliente — em 185 fotos de uma vez, na captura que a dona mandou.
 * Abaixo de um mega a unidade é KB; acima, uma casa decimal.
 */
const peso = (bytes: number | null): string => {
  if (!bytes) return '';
  if (bytes >= 1_000_000_000) return `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1e6).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
};

const duracao = (s: number | null): string => {
  if (!s) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};

/** Proporção do item. 3:2 quando o banco não sabe — é o retrato médio de câmera. */
const proporcao = (i: ItemGaleria): number =>
  i.largura && i.altura && i.altura > 0 ? i.largura / i.altura : 3 / 2;

/**
 * Quebra a lista em fileiras que preenchem a largura, como o Pixieset.
 *
 * Enche a fileira até passar da largura, e então acha a altura exata em que
 * aquelas fotos cabem: `altura = (largura - vãos) / soma das proporções`. A
 * última fileira não é esticada — uma foto sozinha ocupando a tela inteira
 * ficaria estranha.
 */
function emFileiras(
  itens: ItemGaleria[],
  largura: number,
  alvo: number,
  vao: number,
): { itens: ItemGaleria[]; altura: number }[] {
  if (largura <= 0) return [];
  const fileiras: { itens: ItemGaleria[]; altura: number }[] = [];
  let atual: ItemGaleria[] = [];
  let soma = 0;

  for (const item of itens) {
    atual.push(item);
    soma += proporcao(item);
    const disponivel = largura - vao * (atual.length - 1);
    if (soma * alvo >= disponivel) {
      fileiras.push({ itens: atual, altura: disponivel / soma });
      atual = [];
      soma = 0;
    }
  }
  if (atual.length > 0) {
    const disponivel = largura - vao * (atual.length - 1);
    fileiras.push({ itens: atual, altura: Math.min(alvo, disponivel / soma) });
  }
  return fileiras;
}

function Coracao({ cheio }: { cheio: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill={cheio ? 'currentColor' : 'none'}>
      <path
        d="M12 20.5s-7.5-4.6-7.5-9.7A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 3.2c0 5.1-7.5 9.7-7.5 9.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A lupa: o item aberto, com teclado. Esc fecha, setas andam. */
function Lente({
  itens,
  indice,
  favoritos,
  fonte,
  aoFechar,
  aoAndar,
  aoFavoritar,
  aoBaixar,
  aoUsarDeCapa,
  podeBaixar,
  ehCapa,
}: {
  itens: ItemGaleria[];
  indice: number;
  favoritos: Set<string>;
  fonte: FonteAlbum;
  aoFechar: () => void;
  aoAndar: (passo: number) => void;
  aoFavoritar: (item: ItemGaleria) => void;
  aoBaixar: (item: ItemGaleria) => void;
  /** Só a equipe recebe isto. Pelo link do cliente, vem `null`. */
  aoUsarDeCapa: ((item: ItemGaleria) => void) | null;
  podeBaixar: boolean;
  ehCapa: (item: ItemGaleria) => boolean;
}) {
  const item = itens[indice];

  /**
   * O endereço do ORIGINAL de cada item, pedido sob demanda.
   *
   * A lupa mostrava `item.miniatura`, que tem 640px de lado — numa tela de
   * 1440 ela aparecia pequena no meio do preto, e parecia defeito. Agora ela
   * mostra a miniatura NA HORA (que já está no cache, vinda da grade) e troca
   * pelo original assim que ele chega. Nunca há um quadro vazio.
   *
   * Guardado num mapa porque andar com as setas volta nas mesmas fotos, e
   * assinar de novo a cada passo seria um pedido por seta.
   */
  const [grandes, setGrandes] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!item || item.tipo === 'video' || grandes[item.id]) return;
    let valeu = true;
    setCarregando(true);
    void verItem(fonte, item.id)
      .then((url) => {
        if (valeu && url) setGrandes((g) => ({ ...g, [item.id]: url }));
      })
      // Falhou? A miniatura continua na tela. Pior que uma foto menos nítida é
      // uma lupa que abre vazia porque a assinatura não voltou.
      .catch(() => {})
      .finally(() => {
        if (valeu) setCarregando(false);
      });
    return () => {
      valeu = false;
    };
  }, [item, fonte, grandes]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
      if (e.key === 'ArrowRight') aoAndar(1);
      if (e.key === 'ArrowLeft') aoAndar(-1);
    };
    document.addEventListener('keydown', tecla);
    // Enquanto a lupa está aberta a página de trás não rola.
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', tecla);
      document.body.style.overflow = antes;
    };
  }, [aoFechar, aoAndar]);

  if (!item) return null;
  const cheio = favoritos.has(item.id);
  const capa = ehCapa(item);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.nome}
      className="fixed inset-0 z-50 flex flex-col bg-[rgb(3_3_8/0.92)] backdrop-blur-2xl"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <span className="rotulo truncate">
          {indice + 1} de {itens.length}
          {item.bytes ? ` · ${peso(item.bytes)}` : ''}
          {carregando && !grandes[item.id] ? ' · carregando em alta…' : ''}
        </span>
        <div className="flex items-center gap-2">
          {aoUsarDeCapa && (
            <Botao
              tamanho="pequeno"
              disabled={capa}
              onClick={() => aoUsarDeCapa(item)}
              title="A primeira coisa que o cliente vê ao abrir o link"
            >
              {capa ? 'É a capa' : 'Usar de capa'}
            </Botao>
          )}
          <Botao
            tamanho="pequeno"
            aria-pressed={cheio}
            onClick={() => aoFavoritar(item)}
            className={cheio ? 'text-pink-texto' : ''}
          >
            <Coracao cheio={cheio} />
            {cheio ? 'Escolhida' : 'Escolher'}
          </Botao>
          {podeBaixar && (
            <Botao tamanho="pequeno" variante="primario" onClick={() => aoBaixar(item)}>
              Baixar em alta
            </Botao>
          )}
          <Botao tamanho="pequeno" onClick={aoFechar} aria-label="Fechar">
            Fechar
          </Botao>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
        <button
          type="button"
          onClick={() => aoAndar(-1)}
          aria-label="Anterior"
          className="absolute left-2 z-10 size-12 rounded-full bg-superficie-2 backdrop-blur-xl"
        >
          ‹
        </button>

        {item.tipo === 'video' ? (
          <video
            src={item.poster ?? undefined}
            poster={item.poster ?? undefined}
            controls
            playsInline
            className="max-h-full max-w-full rounded-[var(--raio)]"
          />
        ) : (
          <img
            // O original quando ele chega; a miniatura enquanto não chega.
            // Os dois passam pelo redimensionador: pedir 6000px para mostrar
            // em 1600 é baixar quinze vezes mais do que a tela usa.
            src={
              noTamanho(grandes[item.id] ?? item.miniatura, LARGURA.lente) ?? ''
            }
            alt={item.nome}
            // MEDIDA DE TELA, não porcentagem. `max-h-full` é `max-height:100%`
            // e precisa que o pai tenha altura DEFINIDA; dentro deste flex ele
            // não tem, então o navegador trata como "sem limite" e desenha a
            // foto no tamanho natural. Medido na galeria da cliente:
            //
            //   natural 1365x2048 · caixa 1365x2048 · janela 1440x900
            //
            // Ou seja: 2048px de altura em 900 de espaço, e o que aparece é um
            // pedaço escuro do meio da foto — a "tela preta". Com a miniatura
            // de 640px o mesmo defeito aparecia como "foto pequena no preto".
            // Uma causa, dois sintomas, e eu tratei os dois como coisas
            // diferentes.
            //
            // `dvh` e `vw` resolvem sempre, em qualquer navegador, sem depender
            // de o pai ter altura. O desconto de 7rem é a barra de ações.
            // MEDIDA DE TELA, não porcentagem. `max-h-full` é `max-height:100%`
            // e exige que o pai tenha altura DEFINIDA; dentro deste flex ele
            // não tem, então o navegador trata como "sem limite" e desenha a
            // foto no tamanho natural. Medido na galeria da cliente:
            //
            //   natural 1365x2048 · caixa 1365x2048 · janela 1440x900
            //
            // São 2048px de altura em 900 de espaço: aparece um pedaço escuro
            // do meio da foto, que é a "tela preta". Com a miniatura de 640px o
            // MESMO defeito aparecia como "foto pequena no preto" — uma causa,
            // dois sintomas, e eu tratei como duas coisas diferentes.
            //
            // `dvh` e `vw` resolvem sempre, sem depender do pai. 7rem é a barra
            // de ações em cima.
            className="max-h-[calc(100dvh-7rem)] max-w-[96vw] rounded-[var(--raio)] object-contain"
          />
        )}

        <button
          type="button"
          onClick={() => aoAndar(1)}
          aria-label="Próxima"
          className="absolute right-2 z-10 size-12 rounded-full bg-superficie-2 backdrop-blur-xl"
        >
          ›
        </button>
      </div>
    </div>
  );
}

export function Album({ fonte, quem }: { fonte: FonteAlbum; quem: string }) {
  // Duas portas para a mesma sala. Quem tem o link não tem conta e passa pela
  // Edge Function; quem está logado lê direto, porque o RLS já sabe quem é.
  const porToken = fonte.tipo === 'token';
  const token = porToken ? fonte.token : '';
  const galeriaId = porToken ? '' : fonte.galeriaId;

  const [album, setAlbum] = useState<Alb | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [soFavoritas, setSoFavoritas] = useState(false);
  const [aberto, setAberto] = useState<number | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erroBaixa, setErroBaixa] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  // A largura real da grade, para calcular as fileiras. Vem do elemento, não
  // da janela: a página tem margem lateral e ela muda com o tamanho da tela.
  const grade = useRef<HTMLDivElement>(null);
  const [larguraGrade, setLarguraGrade] = useState(0);

  useLayoutEffect(() => {
    const el = grade.current;
    if (!el) return;
    const medir = () => setLarguraGrade(el.clientWidth);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [album]);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const a = porToken ? await albumPorToken(token) : await albumDoCliente(galeriaId);
      setAlbum(a);
      setFavoritos(new Set(a.favoritos));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir esta galeria.');
    }
  }, [porToken, token, galeriaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const mostrados = useMemo(
    () => (album ? album.itens.filter((i) => !soFavoritas || favoritos.has(i.id)) : []),
    [album, soFavoritas, favoritos],
  );

  // Fileira mais baixa no celular: com 160px de alvo cabem duas ou três fotos
  // por linha em vez de uma gigante.
  const alvo = larguraGrade < 560 ? 160 : larguraGrade < 1000 ? 230 : 300;
  const fileiras = useMemo(
    () => emFileiras(mostrados, larguraGrade, alvo, 10),
    [mostrados, larguraGrade, alvo],
  );

  async function favoritar(item: ItemGaleria) {
    const ligar = !favoritos.has(item.id);
    // Marca na hora e desfaz se o servidor recusar: escolher 200 fotos com
    // meio segundo de espera por clique é insuportável.
    setFavoritos((f) => {
      const n = new Set(f);
      if (ligar) n.add(item.id);
      else n.delete(item.id);
      return n;
    });
    try {
      if (porToken) await favoritarPorToken(token, item.id, quem, ligar);
      else await favoritarItem(item.id, ligar);
    } catch {
      setFavoritos((f) => {
        const n = new Set(f);
        if (ligar) n.delete(item.id);
        else n.add(item.id);
        return n;
      });
      setErroBaixa('Não salvou a escolha. Tente de novo.');
    }
  }

  async function usarDeCapa(item: ItemGaleria) {
    setErroBaixa(null);
    try {
      await definirCapaGaleria(galeriaId, item.id);
      setRecado('Capa trocada. É o que o cliente vê ao abrir o link.');
      await carregar();
    } catch (x) {
      setErroBaixa(x instanceof Error ? x.message : 'Não consegui trocar a capa.');
    }
  }

  async function baixarUm(item: ItemGaleria) {
    setErroBaixa(null);
    setBaixando(item.id);
    try {
      if (porToken) {
        await baixarItem(token, item.id, item.nome);
      } else {
        const [arquivo] = await urlsDosOriginais(galeriaId, item.id);
        if (!arquivo?.url) throw new Error('Não consegui gerar o link deste arquivo.');
        const a = document.createElement('a');
        a.href = arquivo.url;
        a.download = item.nome;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (x) {
      setErroBaixa(x instanceof Error ? x.message : 'Não consegui baixar.');
    } finally {
      setBaixando(null);
    }
  }

  async function baixarTudoAgora() {
    if (!album) return;
    setErroBaixa(null);
    setBaixando('tudo');
    try {
      // Pelo link, as URLs vêm da função; logado, do storage direto. O zip é
      // montado no navegador dos dois jeitos.
      const modo = await baixarTudo(
        porToken ? { tipo: 'token', token } : { tipo: 'galeria', galeriaId },
        album.titulo,
        (feitos, total) => setBaixando(`tudo:${feitos}/${total}`),
      );
      if (modo === 'um-a-um') {
        setErroBaixa(
          'Vieram um a um — seu navegador não monta zip. No Chrome ou no Edge do computador sai tudo junto.',
        );
      }
    } catch (x) {
      const m = x instanceof Error ? x.message : 'Não consegui baixar.';
      if (!/abort/i.test(m)) setErroBaixa(m);
    } finally {
      setBaixando(null);
    }
  }

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!album) return <Carregando oQue="a galeria" />;

  const nFav = favoritos.size;
  const emLote = baixando?.startsWith('tudo') ?? false;
  const progresso = baixando?.includes('/') ? baixando.split(':')[1] : null;
  const nFotos = album.itens.filter((i) => i.tipo === 'foto').length;
  const nVideos = album.itens.length - nFotos;
  const total = album.itens.reduce((a, i) => a + (i.bytes ?? 0), 0);

  // A capa escolhida, ou a primeira foto. Nunca nada: uma entrega que abre
  // numa parede branca não parece entrega.
  const capa = album.capa ?? album.itens.find((i) => i.tipo === 'foto')?.miniatura ?? null;

  return (
    <div className="pb-20">
      {/* ---- A capa ------------------------------------------------------ */}
      <header className="relative isolate flex min-h-[58vh] items-end overflow-hidden sm:min-h-[72vh]">
        {capa ? (
          <img
            src={noTamanho(capa, LARGURA.capa) ?? ''}
            alt=""
            aria-hidden
            className="absolute inset-0 -z-10 size-full object-cover"
          />
        ) : (
          <div className="aurora absolute inset-0 -z-10" />
        )}
        {/* O véu existe para o nome ser legível sobre qualquer foto — clara,
            escura, com céu branco atrás. Sem ele, metade das capas some. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgb(3_3_8/0.82)_0%,rgb(3_3_8/0.45)_38%,rgb(3_3_8/0.12)_72%)]"
        />

        <div className="w-full px-5 pb-10 sm:px-8 sm:pb-14 lg:px-12">
          <div className="rotulo text-[rgb(255_255_255/0.78)]">
            {album.cliente}
            {album.quando ? ` · ${diaMes(album.quando)}` : ''}
          </div>
          <h1 className="titulao mt-3 max-w-4xl text-[clamp(2.1rem,7vw,4.4rem)] text-white">
            {album.titulo}
          </h1>
          <p className="rotulo mt-3 text-[rgb(255_255_255/0.72)]">
            {plural(nFotos, 'foto', 'fotos')}
            {nVideos > 0 ? ` · ${plural(nVideos, 'vídeo', 'vídeos')}` : ''}
            {total > 0 ? ` · ${peso(total)}` : ''}
          </p>
          {album.recado && (
            <p className="mt-4 max-w-xl text-[15px] text-[rgb(255_255_255/0.88)]">{album.recado}</p>
          )}
        </div>
      </header>

      {/* ---- A barra de ações -------------------------------------------- */}
      <div className="sticky top-0 z-20 border-b border-linha-fraca bg-[rgb(var(--fundo-rgb,3_3_8)/0.72)] px-5 py-3 backdrop-blur-xl sm:px-8 lg:px-12">
        <div className="flex flex-wrap items-center gap-3">
          {nFav > 0 && (
            <Botao
              tamanho="pequeno"
              aria-pressed={soFavoritas}
              onClick={() => setSoFavoritas((v) => !v)}
            >
              <Coracao cheio />
              {soFavoritas ? `Vendo as ${nFav} escolhidas` : `Ver só as ${nFav} escolhidas`}
            </Botao>
          )}
          {!porToken && (
            <span className="rotulo normal-case">
              abra uma foto para escolher a capa
            </span>
          )}
          {album.permiteDownload && (
            <Botao
              variante="primario"
              className="ml-auto"
              disabled={emLote}
              onClick={() => void baixarTudoAgora()}
            >
              {emLote ? `Baixando ${progresso ?? ''}…` : 'Baixar tudo em alta'}
            </Botao>
          )}
        </div>
      </div>

      <div className="px-5 sm:px-8 lg:px-12">
        {(erroBaixa || recado) && (
          <div
            role={erroBaixa ? 'alert' : 'status'}
            className={`bloco mt-5 p-3.5 ${erroBaixa ? 'bg-alerta-fundo' : ''}`}
          >
            <span className="rotulo-forte text-pink-texto">{erroBaixa ? 'atenção' : 'pronto'}</span>
            <p className="mt-1 text-[13.5px]">{erroBaixa ?? recado}</p>
          </div>
        )}

        {mostrados.length === 0 ? (
          <Vazio
            titulo={soFavoritas ? 'Nenhuma escolhida.' : 'Galeria vazia.'}
            explica={
              soFavoritas
                ? 'Marque o coração nas que quiser separar.'
                : 'A gente avisa quando o material subir.'
            }
          />
        ) : (
          // A grade mede a si mesma; as fileiras só aparecem depois da medida.
          <div ref={grade} className="mt-6 flex flex-col gap-2.5">
            {fileiras.map((fileira, nf) => (
              <div key={nf} className="flex gap-2.5">
                {fileira.itens.map((item) => {
                  const cheio = favoritos.has(item.id);
                  const i = mostrados.indexOf(item);
                  return (
                    <figure
                      key={item.id}
                      className="group relative overflow-hidden rounded-[10px] bg-superficie-2"
                      style={{
                        height: `${fileira.altura}px`,
                        width: `${fileira.altura * proporcao(item)}px`,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setAberto(i)}
                        aria-label={`Abrir ${item.nome}`}
                        className="block size-full"
                      >
                        {item.miniatura ? (
                          <img
                            // Pede pelo tamanho em que aparece. Era o arquivo
                            // inteiro, e a grade pesava 77 MB.
                            src={noTamanho(item.miniatura, LARGURA.grade) ?? ''}
                            alt={item.nome}
                            loading="lazy"
                            decoding="async"
                            width={item.largura ?? undefined}
                            height={item.altura ?? undefined}
                            className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                          />
                        ) : (
                          <span className="aurora flex size-full items-center justify-center">
                            <span className="rotulo">{item.nome}</span>
                          </span>
                        )}
                      </button>

                      {item.tipo === 'video' && (
                        <span className="rotulo-forte pointer-events-none absolute top-2 left-2 rounded-full bg-[rgb(3_3_8/0.6)] px-2.5 py-1 text-white backdrop-blur-md">
                          vídeo {duracao(item.duracao)}
                        </span>
                      )}

                      {/* O coração só aparece no hover — menos no que já está
                          escolhido, que precisa se ver de longe. Em tela de
                          toque não há hover, e o `focus-within` cobre teclado. */}
                      <button
                        type="button"
                        aria-pressed={cheio}
                        aria-label={`${cheio ? 'Tirar' : 'Escolher'} ${item.nome}`}
                        onClick={() => void favoritar(item)}
                        className={
                          'absolute top-2 right-2 grid size-9 place-items-center rounded-full ' +
                          'backdrop-blur-md transition-all duration-200 ' +
                          (cheio
                            ? 'bg-[linear-gradient(180deg,var(--pink-topo),var(--pink-base))] text-sobre-pink'
                            : 'bg-[rgb(3_3_8/0.45)] text-white opacity-0 group-hover:opacity-100 ' +
                              'focus-visible:opacity-100 max-[768px]:opacity-100')
                        }
                      >
                        <Coracao cheio={cheio} />
                      </button>

                      {album.permiteDownload && (
                        <button
                          type="button"
                          disabled={baixando === item.id}
                          onClick={() => void baixarUm(item)}
                          className={
                            'rotulo-forte absolute right-2 bottom-2 rounded-full bg-[rgb(3_3_8/0.45)] ' +
                            'px-3 py-1.5 text-white backdrop-blur-md transition-opacity duration-200 ' +
                            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                          }
                        >
                          {baixando === item.id ? 'baixando…' : 'baixar'}
                        </button>
                      )}
                    </figure>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {aberto !== null && (
        <Lente
          itens={mostrados}
          indice={Math.min(aberto, mostrados.length - 1)}
          favoritos={favoritos}
          fonte={fonte}
          podeBaixar={album.permiteDownload}
          ehCapa={(item) => album.capaItemId === item.id}
          aoUsarDeCapa={porToken ? null : (item) => void usarDeCapa(item)}
          aoFechar={() => setAberto(null)}
          aoAndar={(passo) =>
            setAberto((a) => {
              const n = (a ?? 0) + passo;
              if (n < 0) return mostrados.length - 1;
              if (n >= mostrados.length) return 0;
              return n;
            })
          }
          aoFavoritar={(item) => void favoritar(item)}
          aoBaixar={(item) => void baixarUm(item)}
        />
      )}
    </div>
  );
}
