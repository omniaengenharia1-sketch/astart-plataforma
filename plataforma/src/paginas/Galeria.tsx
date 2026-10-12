import { useCallback, useEffect, useRef, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada } from '../componentes/Campo';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import {
  criarGaleria, criarLinkGaleria, galeriasDoCliente, itensDaGaleria, revogarLinkGaleria,
} from '../dados/api';
import { naFila, subirItem } from '../dados/galeria';
import { Album } from './Album';
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

function Cartao({
  g,
  aoAbrir,
  aberta,
  itens,
  equipe,
}: {
  g: GaleriaNaLista;
  aoAbrir: () => void;
  aberta: boolean;
  itens: ItemGaleria[] | null;
  equipe: boolean;
}) {
  return (
    <article className="bloco overflow-hidden">
      <button type="button" onClick={aoAbrir} className="block w-full text-left">
        <span className="block aspect-[16/7] w-full overflow-hidden">
          {g.capa ? (
            <img src={g.capa} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <span className="aurora block size-full" />
          )}
        </span>
        <span className="block px-4 pt-3.5 pb-2 sm:px-5">
          <span className="rotulo">
            {diaMes(g.quando)}
            {g.local ? ` · ${g.local}` : ''}
          </span>
          <span className="titulao mt-1.5 block text-[clamp(1.05rem,3vw,1.35rem)]">{g.titulo}</span>
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-5">
        <Marca>{plural(g.fotos, 'foto', 'fotos')}</Marca>
        {g.videos > 0 && <Marca>{plural(g.videos, 'vídeo', 'vídeos')}</Marca>}
        {g.bytes > 0 && <Marca>{peso(g.bytes)}</Marca>}
        {g.favoritos > 0 && <Marca forte>{g.favoritos} escolhidas</Marca>}
        {equipe && g.baixou && <Marca>já baixou</Marca>}
        {equipe && g.links.length === 0 && g.publicadaEm === null && <Marca>sem link</Marca>}
      </div>

      {aberta && (
        <div className="border-t border-linha-fraca px-4 py-4 sm:px-5">
          {itens === null ? (
            <Carregando oQue="os arquivos" />
          ) : itens.length === 0 ? (
            <p className="text-tinta-3">Nada subiu ainda.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
              {itens.map((i) => (
                <li
                  key={i.id}
                  title={i.nome}
                  className="relative aspect-square overflow-hidden rounded-[12px] border border-linha-fraca"
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
                </li>
              ))}
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

      {galerias.length === 0 ? (
        <Vazio
          titulo="Nenhuma entrega."
          explica={
            equipe
              ? 'Crie a galeria, suba os arquivos e mande o link.'
              : 'As entregas aparecem aqui.'
          }
        />
      ) : (
        <div className="escada grid gap-5 lg:grid-cols-2">
          {galerias.map((g) => (
            <div key={g.id}>
              <Cartao
                g={g}
                equipe={equipe}
                aberta={aberta === g.id}
                itens={aberta === g.id ? itens : null}
                aoAbrir={() => void abrir(g.id)}
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
