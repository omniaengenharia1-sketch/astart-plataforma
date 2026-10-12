import { useCallback, useEffect, useMemo, useState } from 'react';
import { Botao } from '../componentes/Botao';
import { Marca } from '../componentes/Bloco';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { albumDoCliente, favoritarItem, urlsDosOriginais } from '../dados/api';
import { albumPorToken, baixarItem, baixarTudo, favoritarPorToken } from '../dados/galeria';
import type { FonteAlbum } from '../dados/galeria';
import { diaMes, plural } from '../formato';
import type { Album as Alb, ItemGaleria } from '../dados/tipos';

const peso = (bytes: number | null): string => {
  if (!bytes) return '';
  const giga = bytes / 1_000_000_000;
  if (giga >= 1) return `${giga.toFixed(1).replace('.', ',')} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
};

const duracao = (s: number | null): string => {
  if (!s) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};

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
  aoFechar,
  aoAndar,
  aoFavoritar,
  aoBaixar,
  podeBaixar,
}: {
  itens: ItemGaleria[];
  indice: number;
  favoritos: Set<string>;
  aoFechar: () => void;
  aoAndar: (passo: number) => void;
  aoFavoritar: (item: ItemGaleria) => void;
  aoBaixar: (item: ItemGaleria) => void;
  podeBaixar: boolean;
}) {
  const item = itens[indice];

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.nome}
      className="fixed inset-0 z-50 flex flex-col bg-[rgb(3_3_8/0.86)] backdrop-blur-2xl"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <span className="rotulo truncate">
          {item.nome} · {indice + 1} de {itens.length}
        </span>
        <div className="flex items-center gap-2">
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
            src={item.miniatura ?? ''}
            alt={item.nome}
            className="max-h-full max-w-full rounded-[var(--raio)] object-contain"
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
      setErroBaixa('Não consegui salvar a sua escolha. Tente de novo.');
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
          'Seu navegador não monta o zip: os arquivos vieram um a um. No Chrome ou no Edge do computador, sai tudo num arquivo só.',
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

  return (
    <div className="px-5 pb-20 sm:px-8 lg:px-12">
      <header className="pt-9">
        <div className="rotulo">
          {album.cliente}
          {album.quando ? ` · ${diaMes(album.quando)}` : ''}
        </div>
        <h1 className="titulao mt-3 text-[clamp(1.9rem,6vw,3.2rem)]">{album.titulo}</h1>
        {album.recado && <p className="mt-3 max-w-xl text-tinta-2">{album.recado}</p>}
      </header>

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Marca>{plural(album.itens.filter((i) => i.tipo === 'foto').length, 'foto', 'fotos')}</Marca>
        {album.itens.some((i) => i.tipo === 'video') && (
          <Marca>
            {plural(album.itens.filter((i) => i.tipo === 'video').length, 'vídeo', 'vídeos')}
          </Marca>
        )}
        <Marca>{peso(album.itens.reduce((a, i) => a + (i.bytes ?? 0), 0))}</Marca>

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

      {erroBaixa && (
        <div role="alert" className="bloco mt-5 bg-alerta-fundo p-3.5">
          <span className="rotulo-forte text-pink-texto">atenção</span>
          <p className="mt-1 text-[13.5px]">{erroBaixa}</p>
        </div>
      )}

      {mostrados.length === 0 ? (
        <Vazio
          titulo={soFavoritas ? 'Nenhuma escolhida ainda.' : 'Galeria vazia.'}
          explica={
            soFavoritas
              ? 'Marque o coração nas que você quiser separar.'
              : 'Assim que a Astart subir o material, ele aparece aqui.'
          }
        />
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {mostrados.map((item, i) => {
            const cheio = favoritos.has(item.id);
            return (
              <li key={item.id} className="group bloco erguer relative overflow-hidden">
                <button
                  type="button"
                  onClick={() => setAberto(i)}
                  className="block w-full"
                  aria-label={`Abrir ${item.nome}`}
                >
                  <span className="block aspect-[4/3] w-full overflow-hidden">
                    {item.miniatura ? (
                      <img
                        src={item.miniatura}
                        alt={item.nome}
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                      />
                    ) : (
                      <span className="aurora flex size-full items-center justify-center">
                        <span className="rotulo">{item.nome}</span>
                      </span>
                    )}
                  </span>
                </button>

                {item.tipo === 'video' && (
                  <span className="rotulo-forte pointer-events-none absolute top-2 left-2 rounded-full bg-[rgb(3_3_8/0.6)] px-2.5 py-1 text-tinta backdrop-blur-md">
                    vídeo {duracao(item.duracao)}
                  </span>
                )}

                <button
                  type="button"
                  aria-pressed={cheio}
                  aria-label={`${cheio ? 'Tirar' : 'Escolher'} ${item.nome}`}
                  onClick={() => void favoritar(item)}
                  className={
                    'absolute top-2 right-2 grid size-10 place-items-center rounded-full ' +
                    'backdrop-blur-md transition-colors ' +
                    (cheio
                      ? 'bg-[linear-gradient(180deg,var(--pink-topo),var(--pink-base))] text-sobre-pink'
                      : 'bg-[rgb(3_3_8/0.5)] text-tinta hover:text-pink-texto')
                  }
                >
                  <Coracao cheio={cheio} />
                </button>

                {album.permiteDownload && (
                  <span className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="rotulo truncate">{peso(item.bytes)}</span>
                    <Botao
                      variante="texto"
                      tamanho="pequeno"
                      disabled={baixando === item.id}
                      onClick={() => void baixarUm(item)}
                    >
                      {baixando === item.id ? 'baixando…' : 'baixar'}
                    </Botao>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {aberto !== null && (
        <Lente
          itens={mostrados}
          indice={Math.min(aberto, mostrados.length - 1)}
          favoritos={favoritos}
          podeBaixar={album.permiteDownload}
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
