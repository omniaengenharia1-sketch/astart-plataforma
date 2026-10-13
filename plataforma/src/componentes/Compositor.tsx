/**
 * O compositor: a publicação inteira numa tela.
 *
 * Arquivo, rede, formato, legenda, hashtags, e embaixo agendar na hora que
 * quiser ou postar agora. É o fluxo que a dona pediu, com o nome que ela usa.
 *
 * A ordem da tela segue a ordem do sistema, e isso não é acaso: o arquivo
 * precisa do id da publicação para ir ao bucket (0045), então a publicação
 * nasce rascunho, o arquivo entra, e só aí o botão de agendar fica de pé. Uma
 * tela que fingisse aceitar o arquivo antes teria de guardar o arquivo em
 * algum lugar provisório — e arquivo provisório é arquivo que sobra.
 *
 * O botão de agendar fica desabilitado enquanto falta arquivo, com o motivo
 * escrito ao lado. Deixar clicável para mostrar o erro depois seria fazer a
 * pessoa descobrir batendo.
 */
import { useEffect, useState } from 'react';
import { Botao } from './Botao';
import { Marca } from './Bloco';
import { Campo, Entrada } from './Campo';
import { MidiaDaPecaPainel, PEDE } from './MidiaDaPeca';
import { agendarPublicacao, contasDoCliente, criarPublicacao } from '../dados/api';
import { midiasDaPeca } from '../dados/pecaMidia';
import type { ContaSocial, TipoPeca } from '../dados/tipos';

/**
 * Os nomes que a pessoa usa, não os do banco.
 *
 * "post" é o que se chama de `imagem` ou `carrossel` aqui dentro — e a diferença
 * entre os dois é quantos arquivos entram, não uma escolha a fazer antes. Então
 * a tela pergunta o que ela pergunta no Instagram: post, story ou reel. Quem
 * tem mais de um arquivo é carrossel, e isso se resolve sozinho.
 */
const FORMATOS: { valor: TipoPeca; rotulo: string; explica: string }[] = [
  { valor: 'imagem', rotulo: 'Post', explica: 'uma foto no feed' },
  { valor: 'carrossel', rotulo: 'Carrossel', explica: 'de 2 a 10 no feed' },
  { valor: 'reel', rotulo: 'Reel', explica: 'um vídeo' },
  { valor: 'story', rotulo: 'Story', explica: 'foto ou vídeo, 24h' },
];

/** `datetime-local` quer `YYYY-MM-DDTHH:MM` na hora local, sem fuso. */
function agoraLocal(daquiAHoras = 1): string {
  const d = new Date(Date.now() + daquiAHoras * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function Compositor({
  clienteId,
  aoFechar,
  aoSalvar,
  diaSugerido,
}: {
  clienteId: string;
  aoFechar: () => void;
  aoSalvar: () => void;
  diaSugerido?: string | null;
}) {
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<TipoPeca>('imagem');
  const [legenda, setLegenda] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [noComentario, setNoComentario] = useState(false);
  const [contas, setContas] = useState<ContaSocial[]>([]);
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [quando, setQuando] = useState(() =>
    diaSugerido ? `${diaSugerido}T12:00` : agoraLocal(1),
  );

  const [postId, setPostId] = useState<string | null>(null);
  const [temMidia, setTemMidia] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  // Agendada: o compositor NAO fecha sozinho.
  //
  // Fechava, e era um bug de experiencia: a pessoa clicava em "Postar agora",
  // o painel desaparecia junto com a confirmacao, e ela ficava sem saber se
  // saiu. Confirmacao que desaparece com a tela e confirmacao que nao
  // aconteceu. Quem fecha e ela, depois de ler.
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    void contasDoCliente(clienteId)
      .then((c) => {
        setContas(c);
        // Por padrão, todas as que publicam. Quem tem um perfil só não devia
        // ter de marcar nada; quem tem dois escolhe.
        setEscolhidas(c.filter((x) => x.prontaParaPublicar).map((x) => x.id));
      })
      .catch(() => setContas([]));
  }, [clienteId]);

  const minimo = tipo === 'carrossel' ? 2 : 1;
  const faltaMidia = Math.max(0, minimo - temMidia);

  async function criar() {
    setErro(null);
    setOcupado(true);
    try {
      const id = await criarPublicacao({
        clienteId,
        titulo,
        tipo,
        legenda,
        hashtags,
        noComentario,
        contas: escolhidas,
      });
      setPostId(id);
      setRecado('Rascunho criado. Agora o arquivo.');
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui criar.');
    } finally {
      setOcupado(false);
    }
  }

  async function agendar(agora: boolean) {
    if (!postId) return;
    setErro(null);
    setOcupado(true);
    try {
      // `null` significa agora: o banco põe `now()` e o worker pega na próxima
      // rodada, pelo mesmo caminho de sempre.
      const r = await agendarPublicacao(postId, agora ? null : new Date(quando).toISOString());
      setRecado(
        r.agora
          ? 'Vai sair em instantes — o agendador roda a cada minuto.'
          : `Agendada para ${new Date(r.quando).toLocaleString('pt-BR')}.`,
      );
      setPronto(true);
      // Atualiza o calendario atras, sem fechar: a peca ja aparece lá na data.
      aoSalvar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui agendar.');
    } finally {
      setOcupado(false);
    }
  }

  const prontas = contas.filter((c) => c.prontaParaPublicar);

  return (
    <section className="bloco mt-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="rotulo-forte">nova publicação</div>
          <p className="rotulo mt-1 normal-case">
            {postId ? 'rascunho criado — anexe o arquivo e agende' : 'o rascunho nasce primeiro, o arquivo depois'}
          </p>
        </div>
        <Botao variante="texto" tamanho="pequeno" onClick={aoFechar}>
          Fechar
        </Botao>
      </div>

      {prontas.length === 0 && (
        // Dito aqui, no começo, porque é o que faz a publicação não sair — e
        // descobrir isso só no botão de agendar seria tarde.
        <p className="mt-3 rounded-[var(--raio-p)] border border-linha bg-alerta-fundo px-3.5 py-2.5 text-[13px]">
          Este cliente não tem conta conectada. Dá para escrever e guardar, mas{' '}
          <strong>nada vai ao ar</strong> até conectar em "onde publica".
        </p>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {/* `id` nos dois lados: o `Campo` poe `htmlFor` e sem o `id` no
              controle o rotulo aponta para o vazio — leitor de tela le "campo
              de texto" e pronto. */}
          <Campo id="pub-titulo" rotulo="Nome interno" dica="só a equipe vê; serve para achar depois">
            <Entrada id="pub-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </Campo>

          <div>
            <span className="rotulo-forte">Formato</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {FORMATOS.map((f) => (
                <button
                  key={f.valor}
                  type="button"
                  onClick={() => setTipo(f.valor)}
                  disabled={postId !== null}
                  className={
                    'rounded-full border px-3 py-1.5 text-[12.5px] ' +
                    (tipo === f.valor ? 'border-pink text-pink-texto' : 'border-linha text-tinta-2')
                  }
                >
                  {f.rotulo}
                </button>
              ))}
            </div>
            <p className="rotulo mt-1.5 normal-case">
              {FORMATOS.find((f) => f.valor === tipo)?.explica} · pede {PEDE[tipo]}
              {postId !== null && ' · o formato não muda depois de criar'}
            </p>
          </div>

          <Campo id="pub-legenda" rotulo="Legenda">
            <textarea
              id="pub-legenda"
              value={legenda}
              onChange={(e) => setLegenda(e.target.value)}
              rows={5}
              className="min-h-28 w-full rounded-[var(--raio-p)] border border-linha bg-superficie px-3.5 py-2.5 text-[14px] text-tinta backdrop-blur-xl focus:outline-none"
            />
          </Campo>

          <Campo
            id="pub-hashtags"
            rotulo="Hashtags"
            dica="separadas da legenda, para você editar uma sem mexer na outra"
          >
            <textarea
              id="pub-hashtags"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              rows={2}
              className="w-full rounded-[var(--raio-p)] border border-linha bg-superficie px-3.5 py-2.5 font-mono text-[13px] text-tinta backdrop-blur-xl focus:outline-none"
            />
          </Campo>

          <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
            <input
              type="checkbox"
              checked={noComentario}
              onChange={(e) => setNoComentario(e.target.checked)}
              className="size-4.5 cursor-pointer accent-[var(--pink)]"
            />
            <span>Hashtags no primeiro comentário, para a legenda ficar limpa no feed</span>
          </label>
        </div>

        <div className="flex flex-col gap-4">
          {prontas.length > 1 && (
            <div>
              <span className="rotulo-forte">Onde publica</span>
              <ul className="mt-2 flex flex-col gap-1.5">
                {prontas.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
                      <input
                        type="checkbox"
                        checked={escolhidas.includes(c.id)}
                        onChange={(e) =>
                          setEscolhidas((a) =>
                            e.target.checked ? [...a, c.id] : a.filter((x) => x !== c.id),
                          )
                        }
                        className="size-4.5 cursor-pointer accent-[var(--pink)]"
                      />
                      <span>@{c.nome}</span>
                      <Marca>{c.plataforma}</Marca>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {postId === null ? (
            <div className="rounded-[10px] border border-dashed border-linha px-3.5 py-6 text-center text-[13px] text-tinta-3">
              O arquivo entra depois de criar o rascunho — ele precisa saber a qual publicação
              pertence.
            </div>
          ) : (
            <MidiaDaPecaPainel
              peca={{ id: postId, tipo, statusPublicacao: 'rascunho' }}
              clienteId={clienteId}
              equipe
              aoMudar={() => {
                void midiasDaPeca(postId).then((m) => setTemMidia(m.length));
              }}
            />
          )}

          <Campo id="pub-quando" rotulo="Quando" dica={`no fuso do cliente · ${PEDE[tipo]}`}>
            <Entrada
              id="pub-quando"
              type="datetime-local"
              value={quando}
              onChange={(e) => setQuando(e.target.value)}
            />
          </Campo>
        </div>
      </div>

      {erro && (
        <p
          role="alert"
          className="mt-4 rounded-[var(--raio-p)] border border-linha bg-alerta-fundo px-3.5 py-2.5 text-[13px]"
        >
          {erro}
        </p>
      )}
      {recado && !erro && (
        <p className="mt-4 rounded-[var(--raio-p)] border border-linha-fraca px-3.5 py-2.5 text-[13px] text-tinta-2">
          {recado}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-linha-fraca pt-4">
        {pronto ? (
          <Botao variante="primario" onClick={aoFechar}>
            Fechar
          </Botao>
        ) : postId === null ? (
          <Botao
            variante="primario"
            disabled={ocupado || !titulo.trim()}
            onClick={() => void criar()}
          >
            {ocupado ? 'Criando…' : 'Criar rascunho'}
          </Botao>
        ) : (
          <>
            <Botao
              variante="primario"
              disabled={ocupado || faltaMidia > 0}
              onClick={() => void agendar(false)}
            >
              {ocupado ? 'Salvando…' : 'Agendar'}
            </Botao>
            <Botao disabled={ocupado || faltaMidia > 0} onClick={() => void agendar(true)}>
              Postar agora
            </Botao>
            {/* O motivo ao lado do botão desabilitado. Botão cinza sem
                explicação é a pior coisa de uma tela. */}
            {faltaMidia > 0 && (
              <span className="rotulo normal-case">
                falta {faltaMidia} arquivo{faltaMidia > 1 ? 's' : ''} para agendar
              </span>
            )}
          </>
        )}
      </div>
    </section>
  );
}
