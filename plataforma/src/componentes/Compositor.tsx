/**
 * O compositor: a publicação inteira numa tela.
 *
 * Arquivo, canal, legenda, hashtags, e embaixo agendar na hora que quiser ou
 * postar agora. É o fluxo que a dona pediu, com o nome que ela usa.
 *
 * CANAL, não "formato" e "onde publica" separados. Era assim até a 0055, e as
 * duas perguntas não eram só mais cliques: elas deixavam montar combinação
 * impossível — Reel numa Página do Facebook, que não tem adaptador nenhum. A
 * tela aceitava, o banco aceitava, e a recusa vinha na hora de publicar, de
 * madrugada, com o cliente sem receber nada. A dona descreveu o mLabs e pediu
 * igual: *"seleciona a rede social e o formato"*, num clique. Então o banco
 * responde a pergunta inteira (`canais_do_cliente`) e a tela desenha o que ele
 * diz — inclusive os canais que NÃO publicam, apagados, com o motivo escrito.
 * "Não aparece" é pior que "aparece apagado dizendo por quê": a pessoa fica
 * procurando o que não existe.
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
import { useEffect, useMemo, useState } from 'react';
import { Botao } from './Botao';
import { Marca } from './Bloco';
import { Campo, Entrada } from './Campo';
import { MidiaDaPecaPainel } from './MidiaDaPeca';
import { agendarPublicacao, canaisDoCliente, criarPublicacao } from '../dados/api';
import { FORMATOS, ORDEM_FORMATOS, PEDE } from '../dados/formatos';
import { midiasDaPeca } from '../dados/pecaMidia';
import type { Canal, TipoPeca } from '../dados/tipos';

/** `datetime-local` quer `YYYY-MM-DDTHH:MM` na hora local, sem fuso. */
function agoraLocal(daquiAHoras = 1): string {
  const d = new Date(Date.now() + daquiAHoras * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Uma conta com os seus quatro canais, para desenhar uma fileira de chips. */
interface FileiraDeConta {
  contaId: string;
  conta: string;
  plataforma: 'instagram' | 'facebook';
  canais: Canal[];
  /** Os motivos distintos dos canais recusados, para escrever embaixo. */
  motivos: string[];
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
  const [canais, setCanais] = useState<Canal[] | null>(null);
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  // Dito quando trocar o formato tira uma conta da escolha. Troca silenciosa
  // publicaria em menos lugares do que a pessoa marcou.
  const [avisoDeTroca, setAvisoDeTroca] = useState<string | null>(null);
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
    void canaisDoCliente(clienteId)
      .then((lista) => {
        setCanais(lista);
        // O primeiro canal que publica manda no padrão — a lista já vem na
        // ordem certa do banco (Instagram antes, post antes de story, e canal
        // que publica antes do que não publica). Quem tem um perfil só não
        // devia ter de marcar nada.
        const primeiro = lista.find((c) => c.publicavel);
        if (!primeiro) return;
        setTipo(primeiro.tipo);
        setEscolhidas(
          lista.filter((c) => c.tipo === primeiro.tipo && c.publicavel).map((c) => c.contaId),
        );
      })
      .catch(() => setCanais([]));
  }, [clienteId]);

  /**
   * Os canais agrupados por conta. O agrupamento é aqui porque o banco ordena
   * por (rede, formato) para a lista ficar previsível, e a tela desenha por
   * conta — uma fileira de chips por perfil é o que se lê de relance.
   */
  const fileiras = useMemo<FileiraDeConta[]>(() => {
    const porConta = new Map<string, FileiraDeConta>();
    for (const c of canais ?? []) {
      let f = porConta.get(c.contaId);
      if (!f) {
        f = { contaId: c.contaId, conta: c.conta, plataforma: c.plataforma, canais: [], motivos: [] };
        porConta.set(c.contaId, f);
      }
      f.canais.push(c);
      if (!c.publicavel && c.motivo && !f.motivos.includes(c.motivo)) f.motivos.push(c.motivo);
    }
    for (const f of porConta.values()) {
      f.canais.sort((a, b) => ORDEM_FORMATOS.indexOf(a.tipo) - ORDEM_FORMATOS.indexOf(b.tipo));
    }
    return [...porConta.values()];
  }, [canais]);

  const temCanalQuePublica = (canais ?? []).some((c) => c.publicavel);
  const nomeDaConta = (id: string) =>
    (canais ?? []).find((c) => c.contaId === id)?.conta ?? 'conta';

  /**
   * Um clique num chip escolhe a conta E o formato.
   *
   * Clicar num formato diferente troca o formato da publicação inteira, porque
   * um post tem UM formato — é assim na tabela e é assim na Meta. As contas já
   * marcadas que também publicam no formato novo continuam marcadas; as que não
   * publicam saem, e a tela diz quais e por quê.
   */
  function escolher(canal: Canal) {
    setAvisoDeTroca(null);
    if (canal.tipo === tipo) {
      setEscolhidas((a) =>
        a.includes(canal.contaId) ? a.filter((x) => x !== canal.contaId) : [...a, canal.contaId],
      );
      return;
    }

    const publicaNoNovo = new Set(
      (canais ?? []).filter((c) => c.tipo === canal.tipo && c.publicavel).map((c) => c.contaId),
    );
    const ficam = escolhidas.filter((id) => publicaNoNovo.has(id));
    const saem = escolhidas.filter((id) => !publicaNoNovo.has(id));

    setTipo(canal.tipo);
    setEscolhidas(ficam.includes(canal.contaId) ? ficam : [...ficam, canal.contaId]);
    if (saem.length > 0) {
      setAvisoDeTroca(
        `${saem.map((id) => '@' + nomeDaConta(id)).join(', ')} ${saem.length > 1 ? 'saíram' : 'saiu'} da escolha: ` +
          `${FORMATOS[canal.tipo].rotulo} não sai nessa conta. Para publicar lá, crie outra publicação.`,
      );
    }
  }

  const minimo = FORMATOS[tipo].minimo;
  const faltaMidia = Math.max(0, minimo - temMidia);
  // Cliente sem canal nenhum ainda pode escrever e guardar — foi decisão da
  // dona. Com canal, escolher um é obrigatório: rascunho sem destino é peça que
  // nunca publica, e ninguém olha de novo.
  const faltaCanal = temCanalQuePublica && escolhidas.length === 0;

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

      {canais !== null && fileiras.length === 0 && (
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
            <span className="rotulo-forte">Onde e em que formato</span>
            <p className="rotulo mt-1 normal-case">
              a rede e o formato num clique só · um canal por publicação
            </p>

            {canais === null ? (
              <p className="rotulo mt-2 normal-case">lendo os canais…</p>
            ) : fileiras.length === 0 ? (
              // Sem conta conectada não há canal, e sem canal não haveria como
              // escolher formato nenhum — a publicação nasceria sempre "Post".
              // Mas escrever e guardar sem conta é caminho de propósito (foi
              // decisão da dona), então aqui a escolha volta a ser só o
              // formato. O aviso em cima já diz que nada vai ao ar.
              <div className="mt-2 flex flex-wrap gap-2">
                {ORDEM_FORMATOS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={t === tipo}
                    disabled={postId !== null}
                    onClick={() => setTipo(t)}
                    className={
                      'rounded-full border px-3 py-1.5 text-[12.5px] ' +
                      (t === tipo ? 'border-pink text-pink-texto' : 'border-linha text-tinta-2')
                    }
                  >
                    {FORMATOS[t].rotulo}
                  </button>
                ))}
              </div>
            ) : (
              <ul className="mt-2.5 flex flex-col gap-3">
                {fileiras.map((f) => (
                  <li key={f.contaId}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px]">@{f.conta}</span>
                      <Marca>{f.plataforma}</Marca>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {f.canais.map((c) => {
                        const marcado = c.tipo === tipo && escolhidas.includes(c.contaId);
                        const travado = !c.publicavel || postId !== null;
                        return (
                          <button
                            key={c.tipo}
                            type="button"
                            aria-pressed={marcado}
                            disabled={travado}
                            // O motivo no `title` E embaixo da fileira: o
                            // `title` é para quem passa o mouse num chip
                            // específico, a linha de baixo é para quem não
                            // passa. Nenhum dos dois sozinho basta.
                            title={c.publicavel ? undefined : (c.motivo ?? undefined)}
                            onClick={() => escolher(c)}
                            className={
                              'rounded-full border px-3 py-1.5 text-[12.5px] ' +
                              (marcado
                                ? 'border-pink text-pink-texto'
                                : c.publicavel
                                  ? 'border-linha text-tinta-2'
                                  : 'cursor-not-allowed border-dashed border-linha-fraca text-tinta-3')
                            }
                          >
                            {FORMATOS[c.tipo].rotulo}
                          </button>
                        );
                      })}
                    </div>
                    {f.motivos.map((m) => (
                      <p key={m} className="rotulo mt-1 normal-case">
                        {m}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            )}

            <p className="rotulo mt-2.5 normal-case">
              {FORMATOS[tipo].rotulo}: {FORMATOS[tipo].explica} · pede {PEDE[tipo]}
              {postId !== null && ' · o canal não muda depois de criar'}
            </p>

            {avisoDeTroca && (
              <p className="mt-2 rounded-[var(--raio-p)] border border-linha-fraca px-3 py-2 text-[12.5px] text-tinta-2">
                {avisoDeTroca}
              </p>
            )}
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
          <>
            <Botao
              variante="primario"
              disabled={ocupado || !titulo.trim() || faltaCanal}
              onClick={() => void criar()}
            >
              {ocupado ? 'Criando…' : 'Criar rascunho'}
            </Botao>
            {/* O motivo ao lado do botão desabilitado. Botão cinza sem
                explicação é a pior coisa de uma tela. */}
            {faltaCanal && (
              <span className="rotulo normal-case">escolha onde publica, acima</span>
            )}
          </>
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
