import { useCallback, useEffect, useRef, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada } from '../componentes/Campo';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import {
  arquivarGaleria, criarGaleria, criarLinkGaleria, definirCapaGaleria, excluirGaleria,
  galeriasDoCliente, itensDaGaleria, revogarLinkGaleria,
} from '../dados/api';
import { naFila, subirItem } from '../dados/galeria';
import { Album } from './Album';
import { useSessao } from '../sessao';
import { LARGURA, noTamanho } from '../dados/imagem';
import { diaMes, haQuanto, plural } from '../formato';
import type { EnvioEmCurso, GaleriaNaLista, ItemGaleria } from '../dados/tipos';

const peso = (bytes: number): string => {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1).replace('.', ',')} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
};

/** Dois de cada vez: um por um demora, dez de uma vez derruba a conexão. */
const AO_MESMO_TEMPO = 2;

function Progresso({ fracao }: { fracao: number }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-superficie-2">
      <span
        className="block h-full rounded-full bg-[linear-gradient(90deg,var(--pink),var(--violeta))] transition-[width] duration-300"
        style={{ width: `${Math.round(fracao * 100)}%` }}
      />
    </span>
  );
}

/**
 * O menu de três pontos de uma coleção.
 *
 * É o do Pixieset, que a dona mandou de referência: as ações da entrega ficam
 * aqui, não espalhadas pelo cartão. Fecha com Esc e com clique fora — menu que
 * só fecha clicando de novo no botão é menu que fica aberto por engano.
 */
function MenuDaColecao({ acoes }: { acoes: { texto: string; perigo?: boolean; aoClicar: () => void }[] }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        aria-label="Ações desta coleção"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className={
          'grid size-9 place-items-center rounded-full bg-[rgb(3_3_8/0.5)] text-white ' +
          'backdrop-blur-md transition-opacity duration-200 ' +
          (aberto ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-[768px]:opacity-100')
        }
      >
        <span aria-hidden className="text-[18px] leading-none">⋯</span>
      </button>

      {/* Fundo SÓLIDO, não o vidro do `bloco`: este menu abre em cima de uma
          foto, e vidro sobre foto clara deixa o texto ilegível — a opção de
          apagar some justamente por ser a mais clara. */}
      {aberto && (
        <div
          role="menu"
          className={
            'absolute top-11 right-0 z-30 w-60 overflow-hidden rounded-[var(--raio)] ' +
            'border border-linha bg-[var(--papel-2)] p-1.5 text-left ' +
            'shadow-[0_18px_50px_rgb(0_0_0/0.55)]'
          }
        >
          {acoes.map((a) => (
            <button
              key={a.texto}
              type="button"
              role="menuitem"
              onClick={() => {
                setAberto(false);
                a.aoClicar();
              }}
              className={
                'block w-full rounded-[var(--raio-p)] px-3 py-2 text-left text-[13.5px] ' +
                'hover:bg-superficie-2 ' +
                (a.perigo ? 'text-pink-texto' : 'text-tinta')
              }
            >
              {a.texto}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Cartao({
  g,
  aoAbrir,
  aberta,
  itens,
  equipe,
  acoes,
  aoEscolherCapa,
}: {
  g: GaleriaNaLista;
  aoAbrir: () => void;
  aberta: boolean;
  itens: ItemGaleria[] | null;
  equipe: boolean;
  acoes: { texto: string; perigo?: boolean; aoClicar: () => void }[];
  aoEscolherCapa: (item: ItemGaleria) => void;
}) {
  return (
    <article className={'group bloco overflow-hidden' + (g.arquivadaEm ? ' opacity-70' : '')}>
      <div className="relative">
        <button type="button" onClick={aoAbrir} className="block w-full text-left">
          {/* 4:3 como no Pixieset: a capa é a coisa, não uma faixa fina. */}
          <span className="block aspect-[4/3] w-full overflow-hidden">
            {g.capa ? (
              <img
                src={noTamanho(g.capa, LARGURA.grade) ?? g.capa}
                alt=""
                className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                loading="lazy"
              />
            ) : (
              <span className="aurora block size-full" />
            )}
          </span>
        </button>
        {equipe && acoes.length > 0 && (
          <div className="absolute top-2.5 right-2.5">
            <MenuDaColecao acoes={acoes} />
          </div>
        )}
      </div>

      <button type="button" onClick={aoAbrir} className="block w-full px-4 pt-3.5 text-left sm:px-5">
        <span className="block text-[15.5px] font-bold text-tinta">{g.titulo}</span>
        <span className="rotulo mt-1.5 flex flex-wrap items-center gap-x-2 normal-case">
          {/* A bolinha de status, como na referência: verde no ar, apagada
              fora. É o que se lê de relance numa grade de vinte entregas. */}
          <span
            aria-hidden
            className={
              'inline-block size-2 rounded-full ' +
              (g.arquivadaEm ? 'bg-tinta-3' : g.publicadaEm ? 'bg-[#22c55e]' : 'bg-tinta-3')
            }
          />
          <span>{plural(g.fotos + g.videos, 'item', 'itens')}</span>
          <span>· {diaMes(g.quando)}</span>
          {g.local ? <span>· {g.local}</span> : null}
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-2 px-4 pt-2.5 pb-4 sm:px-5">
        {g.bytes > 0 && <Marca>{peso(g.bytes)}</Marca>}
        {g.favoritos > 0 && <Marca forte>{g.favoritos} escolhidas</Marca>}
        {equipe && g.baixou && <Marca>já baixou</Marca>}
        {equipe && g.links.length === 0 && g.publicadaEm === null && <Marca>sem link</Marca>}
        {/* Fora do ar precisa gritar: a equipe pode estar olhando a galeria e
            achando que a cliente ve a mesma coisa. */}
        {g.arquivadaEm && <Marca forte>na lixeira</Marca>}
      </div>

      {aberta && (
        <div className="border-t border-linha-fraca px-4 py-4 sm:px-5">
          {itens === null ? (
            <Carregando oQue="os arquivos" />
          ) : itens.length === 0 ? (
            <p className="text-tinta-3">Nada subiu ainda.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
              {itens.map((i) => {
                const ehCapa = i.id === g.capaItemId;
                return (
                  <li
                    key={i.id}
                    title={i.nome}
                    className={
                      'group/foto relative aspect-square overflow-hidden rounded-[12px] border ' +
                      (ehCapa ? 'border-pink' : 'border-linha-fraca')
                    }
                  >
                    {i.miniatura ? (
                      <img src={i.miniatura} alt={i.nome} loading="lazy" className="size-full object-cover" />
                    ) : (
                      <span className="aurora grid size-full place-items-center px-1 text-center">
                        <span className="rotulo truncate">{i.nome}</span>
                      </span>
                    )}
                    {i.tipo === 'video' && (
                      <span className="rotulo-forte absolute bottom-1 left-1 rounded-full bg-[rgb(3_3_8/0.6)] px-1.5 text-[9px] text-tinta">
                        vídeo
                      </span>
                    )}

                    {/* ESCOLHER A CAPA, aqui.
                        Este botão só existia dentro da lupa, e a lupa só abre
                        no modo cliente — ou seja, a equipe não tinha tela
                        nenhuma para trocar a capa. A capa da entrega da
                        Confraria era a primeira foto por falta de caminho, não
                        por escolha.

                        Num canto, e não na foto inteira: clicar na foto para
                        trocar a capa troca a capa sem querer o tempo todo. No
                        celular fica sempre visível, porque não há passar o
                        mouse. */}
                    {equipe && i.tipo === 'foto' && (
                      <button
                        type="button"
                        onClick={() => aoEscolherCapa(i)}
                        disabled={ehCapa}
                        aria-pressed={ehCapa}
                        aria-label={ehCapa ? `${i.nome} é a capa` : `Usar ${i.nome} de capa`}
                        title={ehCapa ? 'Esta é a capa da entrega' : 'Usar esta foto de capa'}
                        className={
                          'rotulo-forte absolute top-1 right-1 rounded-full px-2 py-1 text-[9px] ' +
                          'backdrop-blur-md transition-opacity duration-200 ' +
                          (ehCapa
                            ? 'bg-[linear-gradient(180deg,var(--pink-topo),var(--pink-base))] text-sobre-pink'
                            : 'bg-[rgb(3_3_8/0.55)] text-white opacity-0 ' +
                              'group-hover/foto:opacity-100 focus-visible:opacity-100 max-[768px]:opacity-100')
                        }
                      >
                        capa
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

export function Galeria({
  clienteId,
  equipe,
  quem = 'cliente',
}: {
  clienteId: string;
  equipe: boolean;
  quem?: string;
}) {
  const [galerias, setGalerias] = useState<GaleriaNaLista[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [itens, setItens] = useState<ItemGaleria[] | null>(null);

  const [novoTitulo, setNovoTitulo] = useState('');
  const [criando, setCriando] = useState(false);
  const [fila, setFila] = useState<EnvioEmCurso[]>([]);
  const [subindo, setSubindo] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const entrada = useRef<HTMLInputElement>(null);

  // Tirar do ar / apagar (0058). `confirmando` guarda qual galeria esta com a
  // confirmacao aberta, e `digitado` o nome que a pessoa esta escrevendo.
  const [mexendo, setMexendo] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [digitado, setDigitado] = useState('');
  const [vendoLixeira, setVendoLixeira] = useState(false);

  const { sessao } = useSessao();
  // Excluir e da direcao. O portao de verdade e o `usuario_admin()` da funcao
  // no banco — isto aqui so evita mostrar um botao que seria recusado.
  const ehDirecao = equipe && sessao.tipo === 'equipe' && sessao.perfil.papel === 'admin';

  /**
   * Trocar a capa da entrega.
   *
   * Recarrega a lista porque a capa muda o cartao: a foto grande do cartao E a
   * capa, e deixar a antiga na tela depois de trocar e a tela discordando do
   * banco bem na hora em que a pessoa quer conferir se deu certo.
   */
  async function escolherCapa(galeriaId: string, item: ItemGaleria) {
    setErro(null);
    setMexendo(galeriaId);
    try {
      await definirCapaGaleria(galeriaId, item.id);
      setRecado(`"${item.nome}" virou a capa. E a primeira coisa que a cliente ve ao abrir o link.`);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Nao consegui trocar a capa.');
    } finally {
      setMexendo(null);
    }
  }

  async function arquivar(g: GaleriaNaLista, arquivarAgora: boolean) {
    setErro(null);
    setMexendo(g.id);
    try {
      await arquivarGaleria(g.id, arquivarAgora);
      setRecado(
        arquivarAgora
          ? `"${g.titulo}" saiu do ar. O link parou de abrir; os arquivos continuam aqui.`
          : `"${g.titulo}" voltou ao ar, com o mesmo link de antes.`,
      );
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui arquivar.');
    } finally {
      setMexendo(null);
    }
  }

  async function excluir(g: GaleriaNaLista) {
    setErro(null);
    setMexendo(g.id);
    try {
      const r = await excluirGaleria(g.id);
      setConfirmando(null);
      setDigitado('');
      setAberta(null);
      const base =
        `"${r.titulo}" foi apagada: ${plural(r.itens, 'mídia', 'mídias')}, ` +
        `${r.arquivosApagados} ${r.arquivosApagados === 1 ? 'arquivo saiu' : 'arquivos saíram'} do servidor.`;
      // Arquivo que NAO saiu vira aviso, nao silencio.
      //
      // A linha ja foi: a galeria sumiu e nao da para desfazer. Mas o arquivo
      // ficou ocupando espaco, e antes isso era engolido — foi assim que 175 MB
      // se acumularam sem ninguem saber. Agora a tela diz, e diz onde limpar.
      if (r.arquivosQueFicaram > 0) {
        setErro(
          `${r.arquivosQueFicaram} ${r.arquivosQueFicaram === 1 ? 'arquivo não saiu' : 'arquivos não saíram'} ` +
            'do servidor e estão ocupando espaço. A galeria foi apagada mesmo assim — isso não tem volta. ' +
            'Para tirar os arquivos, vá em Ajustes › Arquivos sem dono.',
        );
      }
      setRecado(base);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui apagar.');
    } finally {
      setMexendo(null);
    }
  }

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setGalerias(await galeriasDoCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui carregar as galerias.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abrir = useCallback(async (id: string) => {
    // Para o cliente, abrir é entrar no álbum inteiro — a mesma tela de quem
    // chega pelo link. Para a equipe, é expandir a grade de conferência.
    if (!equipe) {
      setAberta(id);
      return;
    }
    if (aberta === id) {
      setAberta(null);
      return;
    }
    setAberta(id);
    setItens(null);
    try {
      setItens(await itensDaGaleria(id));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir a galeria.');
      setItens([]);
    }
  }, [aberta, equipe]);

  async function criar() {
    if (criando || !novoTitulo.trim()) return;
    setCriando(true);
    setErro(null);
    try {
      const id = await criarGaleria(clienteId, novoTitulo.trim());
      setNovoTitulo('');
      await carregar();
      await abrir(id);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui criar a galeria.');
    } finally {
      setCriando(false);
    }
  }

  async function enviar(galeriaId: string, arquivos: File[]) {
    if (arquivos.length === 0 || subindo) return;
    setSubindo(true);
    setRecado(null);

    const novos = arquivos.map(naFila);
    setFila(novos);

    const atualizar = (id: string, mudanca: Partial<EnvioEmCurso>) =>
      setFila((f) => f.map((x) => (x.id === id ? { ...x, ...mudanca } : x)));

    let proximo = 0;
    const trabalhar = async () => {
      for (;;) {
        const meu = proximo++;
        const arquivo = arquivos[meu];
        const linha = novos[meu];
        if (!arquivo || !linha) return;
        try {
          await subirItem(galeriaId, arquivo, (f) => atualizar(linha.id, { progresso: f }));
          atualizar(linha.id, { pronto: true, progresso: 1 });
        } catch (x) {
          atualizar(linha.id, {
            erro: x instanceof Error ? x.message : 'Falhou.',
            progresso: 0,
          });
        }
      }
    };

    await Promise.all(Array.from({ length: AO_MESMO_TEMPO }, trabalhar));
    setSubindo(false);
    setRecado(`${plural(arquivos.length, 'arquivo subiu', 'arquivos subiram')}.`);
    await carregar();
    setItens(await itensDaGaleria(galeriaId));
    // A fila some sozinha depois que o olho confirma que terminou.
    setTimeout(() => setFila([]), 4000);
  }

  async function gerarLink(galeriaId: string) {
    setErro(null);
    try {
      const { token } = await criarLinkGaleria(galeriaId);
      setTokens((t) => ({ ...t, [galeriaId]: token }));
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui criar o link.');
    }
  }

  const enderecoDe = (token: string) => `${window.location.origin}/g/${token}`;

  if (erro && !galerias) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!galerias) return <Carregando oQue="as galerias" />;

  // A lixeira e a mesma lista, filtrada. O banco so manda as arquivadas para
  // quem edita (0058), entao para o cliente as duas listas sao iguais.
  const noAr = galerias.filter((g) => !g.arquivadaEm);
  const naLixeira = galerias.filter((g) => g.arquivadaEm);
  const visiveis = vendoLixeira ? naLixeira : noAr;

  /**
   * As ações do menu "⋯", montadas por galeria.
   *
   * Compartilhar e Visualizar só entram quando já existe link: oferecer
   * "compartilhar" numa entrega sem link daria um menu que falha ao ser usado.
   * Na lixeira a lista é outra — restaurar e apagar, nada de compartilhar o
   * que está fora do ar.
   */
  function acoesDa(g: GaleriaNaLista) {
    if (!equipe) return [];
    const token = tokens[g.id];

    if (g.arquivadaEm) {
      return [
        { texto: 'Restaurar', aoClicar: () => void arquivar(g, false) },
        ...(ehDirecao
          ? [
              {
                texto: 'Apagar de vez',
                perigo: true,
                aoClicar: () => {
                  void abrir(g.id);
                  setConfirmando(g.id);
                  setDigitado('');
                },
              },
            ]
          : []),
      ];
    }

    return [
      ...(token
        ? [
            {
              texto: 'Copiar link do cliente',
              aoClicar: () => void navigator.clipboard?.writeText(enderecoDe(token)),
            },
            {
              texto: 'Visualizar como cliente',
              aoClicar: () => window.open(`/g/${token}`, '_blank', 'noopener'),
            },
          ]
        : [{ texto: 'Criar link do cliente', aoClicar: () => void gerarLink(g.id) }]),
      { texto: 'Subir arquivos', aoClicar: () => void abrir(g.id) },
      { texto: 'Mover para a lixeira', perigo: true, aoClicar: () => void arquivar(g, true) },
    ];
  }

  if (!equipe && aberta) {
    return (
      <div>
        <div className="pt-6">
          <Botao variante="texto" tamanho="pequeno" onClick={() => setAberta(null)}>
            &lt; todas as entregas
          </Botao>
        </div>
        <Album fonte={{ tipo: 'galeria', galeriaId: aberta }} quem={quem} />
      </div>
    );
  }

  return (
    <div className="pt-7">
      {equipe && (
        <div className="bloco mb-7 p-4 sm:p-5">
          <div className="rotulo-forte">nova galeria</div>
          <p className="rotulo mt-1.5 normal-case">
            o cliente abre por link, sem conta, e baixa em alta
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Campo id="gal-titulo" rotulo="Nome da entrega" className="min-w-64 flex-1">
              <Entrada
                id="gal-titulo"
                value={novoTitulo}
                placeholder="Ex.: Captação na fábrica"
                onChange={(e) => setNovoTitulo(e.target.value)}
              />
            </Campo>
            <Botao variante="primario" disabled={criando || !novoTitulo.trim()} onClick={() => void criar()}>
              {criando ? 'Criando…' : 'Criar galeria'}
            </Botao>
          </div>
        </div>
      )}

      {erro && galerias && <Falhou mensagem={erro} />}

      {/* Coleções / Lixeira — as duas abas da referência que a dona mandou.
          A lixeira não é uma tela separada de propósito: ela é a mesma lista
          filtrada, e o número do lado diz que há algo lá sem ninguém precisar
          entrar para descobrir. */}
      {equipe && (naLixeira.length > 0 || vendoLixeira) && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Botao
            tamanho="pequeno"
            aria-pressed={!vendoLixeira}
            onClick={() => setVendoLixeira(false)}
          >
            Coleções {noAr.length > 0 ? `· ${noAr.length}` : ''}
          </Botao>
          <Botao
            tamanho="pequeno"
            aria-pressed={vendoLixeira}
            onClick={() => setVendoLixeira(true)}
          >
            Lixeira {naLixeira.length > 0 ? `· ${naLixeira.length}` : ''}
          </Botao>
          {vendoLixeira && (
            <span className="rotulo normal-case">
              fora do ar: o link não abre e a cliente não vê. os arquivos continuam aqui.
            </span>
          )}
        </div>
      )}

      {visiveis.length === 0 ? (
        <Vazio
          titulo={vendoLixeira ? 'A lixeira está vazia.' : 'Nenhuma entrega.'}
          explica={
            vendoLixeira
              ? 'O que você mover para cá aparece aqui, e dá para restaurar.'
              : equipe
                ? 'Crie a galeria, suba os arquivos e mande o link.'
                : 'As entregas aparecem aqui.'
          }
        />
      ) : (
        <div className="escada grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((g) => (
            <div key={g.id}>
              <Cartao
                g={g}
                equipe={equipe}
                aberta={aberta === g.id}
                itens={aberta === g.id ? itens : null}
                aoAbrir={() => void abrir(g.id)}
                acoes={acoesDa(g)}
                aoEscolherCapa={(i) => void escolherCapa(g.id, i)}
              />

              {equipe && aberta === g.id && (
                <div className="bloco mt-3 p-4 sm:p-5">
                  <Fita>Subir arquivos</Fita>
                  <input
                    ref={entrada}
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    className="sr-only"
                    onChange={(e) => {
                      const arquivos = [...(e.target.files ?? [])];
                      e.target.value = '';
                      void enviar(g.id, arquivos);
                    }}
                  />
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void enviar(g.id, [...e.dataTransfer.files]);
                    }}
                    className="mt-3 rounded-[var(--raio)] border border-dashed border-linha p-5 text-center"
                  >
                    <p className="text-tinta-2">Arraste fotos e vídeos aqui</p>
                    <Botao
                      className="mt-3"
                      disabled={subindo}
                      onClick={() => entrada.current?.click()}
                    >
                      {subindo ? 'Subindo…' : 'Escolher arquivos'}
                    </Botao>
                    <p className="rotulo mt-3 normal-case">
                      o original sobe inteiro, sem recompressão
                    </p>
                  </div>

                  {fila.length > 0 && (
                    <ul className="mt-4 flex flex-col gap-2.5">
                      {fila.map((f) => (
                        <li key={f.id} className="flex items-center gap-3">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px]">{f.nome}</span>
                            <span className="mt-1 block">
                              <Progresso fracao={f.erro ? 0 : f.progresso} />
                            </span>
                          </span>
                          <span className="rotulo w-20 shrink-0 text-right">
                            {f.erro ? 'falhou' : f.pronto ? 'pronto' : peso(f.bytes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {recado && (
                    <p role="status" className="rotulo-forte mt-4">
                      {recado}
                    </p>
                  )}

                  <div className="mt-6" />
                  <Fita>Link do cliente</Fita>
                  {tokens[g.id] ? (
                    <div className="mt-3">
                      <p className="rotulo normal-case">copie agora — aparece uma vez só</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-[var(--raio-p)] border border-linha bg-superficie px-3 py-2 font-mono text-[12px]">
                          {enderecoDe(tokens[g.id] as string)}
                        </code>
                        <Botao
                          tamanho="pequeno"
                          onClick={() => void navigator.clipboard?.writeText(enderecoDe(tokens[g.id] as string))}
                        >
                          Copiar
                        </Botao>
                        <Botao
                          tamanho="pequeno"
                          variante="texto"
                          onClick={() => window.open(`/g/${tokens[g.id]}`, '_blank', 'noopener')}
                        >
                          Abrir como cliente
                        </Botao>
                      </div>
                    </div>
                  ) : (
                    <Botao className="mt-3" onClick={() => void gerarLink(g.id)}>
                      {g.links.length > 0 ? 'Criar outro link' : 'Criar link para o cliente'}
                    </Botao>
                  )}

                  {g.links.length > 0 && (
                    <ul className="mt-4 flex flex-col gap-2">
                      {g.links.map((l) => (
                        <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="rotulo flex-1">
                            link de {haQuanto(l.criadoEm)} · {plural(l.acessos, 'acesso', 'acessos')}
                            {l.ultimoAcessoEm ? ` · último ${haQuanto(l.ultimoAcessoEm)}` : ''}
                          </span>
                          <Botao
                            tamanho="pequeno"
                            variante="texto"
                            onClick={() =>
                              void revogarLinkGaleria(l.id).then(carregar)
                            }
                          >
                            Revogar
                          </Botao>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* ---- tirar do ar / apagar ---------------------------- */}
                  <div className="mt-6" />
                  <Fita>Lixeira</Fita>
                  <p className="rotulo mt-2 normal-case">
                    {g.arquivadaEm
                      ? 'está na lixeira: o link não abre e a cliente não vê esta entrega'
                      : 'mover para a lixeira tira do ar sem apagar nada — o mesmo link volta a abrir se você restaurar'}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Botao
                      tamanho="pequeno"
                      disabled={mexendo === g.id}
                      onClick={() => void arquivar(g, !g.arquivadaEm)}
                    >
                      {g.arquivadaEm ? 'Restaurar' : 'Mover para a lixeira'}
                    </Botao>

                    {/* Excluir é da direção, e pede o nome digitado. Apagar a
                        captação de um cliente não tem desfazer — confirmação de
                        um clique é a diferença entre engano e catástrofe. */}
                    {ehDirecao &&
                      (confirmando === g.id ? (
                        <>
                          <Entrada
                            aria-label="Digite o nome da galeria para confirmar"
                            placeholder={g.titulo}
                            value={digitado}
                            onChange={(e) => setDigitado(e.target.value)}
                            className="w-56"
                          />
                          <Botao
                            tamanho="pequeno"
                            variante="primario"
                            disabled={digitado.trim() !== g.titulo.trim() || mexendo === g.id}
                            onClick={() => void excluir(g)}
                          >
                            {mexendo === g.id ? 'Apagando…' : 'Apagar de vez'}
                          </Botao>
                          <Botao
                            tamanho="pequeno"
                            variante="texto"
                            onClick={() => {
                              setConfirmando(null);
                              setDigitado('');
                            }}
                          >
                            Cancelar
                          </Botao>
                        </>
                      ) : (
                        <Botao
                          tamanho="pequeno"
                          variante="texto"
                          onClick={() => {
                            setConfirmando(g.id);
                            setDigitado('');
                          }}
                        >
                          Apagar de vez
                        </Botao>
                      ))}
                  </div>
                  {confirmando === g.id && (
                    <p className="mt-2 rounded-[var(--raio-p)] border border-linha bg-alerta-fundo px-3 py-2 text-[12.5px]">
                      Isto apaga as {g.fotos + g.videos} mídias do servidor e{' '}
                      <strong>não tem volta</strong>. Digite <strong>{g.titulo}</strong> para
                      confirmar.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!equipe && galerias.length > 0 && (
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          <Bloco rotulo="Entregas" destaque={String(galerias.length)} />
          <Bloco
            rotulo="Arquivos"
            destaque={String(galerias.reduce((a, g) => a + g.fotos + g.videos, 0))}
          />
        </div>
      )}
    </div>
  );
}
