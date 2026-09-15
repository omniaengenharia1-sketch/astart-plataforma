import { useState } from 'react';
import { Cabecalho } from '../componentes/Layout';
import { Tabela, type Coluna } from '../componentes/Tabela';
import { Pilula } from '../componentes/Pilula';
import { Botao } from '../componentes/Botao';
import { Segmentado } from '../componentes/Segmentado';
import { clientePorId, contaPorId, postPorId } from '../dados/mock';
import { ESTADOS_EM_VOO, useApp } from '../contexto';
import type { EstadoAlvo, EventoAlvo, PostAlvo } from '../dados/tipos';

const MAX_TENTATIVAS = 6;

// Pink e so da marca e do que quebrou. Estado em andamento e ambar; parado e neutro.
const TOM_ESTADO: Record<EstadoAlvo, 'ok' | 'espera' | 'falha' | 'acao' | 'neutro'> = {
  pendente: 'neutro',
  container_criando: 'espera',
  container_aguardando: 'espera',
  container_pronto: 'espera',
  publicando: 'espera',
  publicado: 'ok',
  falhou: 'falha',
  cancelado: 'neutro',
};

/** Um passo por tick, igual ao worker. Nunca dois. */
const AVANCO: Partial<Record<EstadoAlvo, EstadoAlvo>> = {
  pendente: 'container_criando',
  container_criando: 'container_pronto',
  container_aguardando: 'container_pronto',
  container_pronto: 'publicando',
};

export function Fila() {
  const { clienteAtivo, alvos, setAlvos, setPosts, eventos, setEventos, avisar } = useApp();
  const [escopo, setEscopo] = useState<'todos' | 'cliente'>('todos');
  const [aberto, setAberto] = useState<string | null>(null);

  const visiveis = alvos.filter((a) => escopo === 'todos' || a.clienteId === clienteAtivo);

  function registrar(alvoId: string, ev: EventoAlvo) {
    setEventos((antes) => ({ ...antes, [alvoId]: [...(antes[alvoId] ?? []), ev] }));
  }

  function reprocessar(a: PostAlvo) {
    setAlvos((antes) =>
      antes.map((x) =>
        x.id === a.id
          ? { ...x, estado: x.mediaId ? x.estado : 'pendente', tentativas: 0, proximaTentativa: 'agora', erroCodigo: null, erroMensagem: 'Reprocesso manual solicitado. Backoff zerado.' }
          : x,
      ),
    );
    setPosts((antes) => antes.map((p) => (p.id === a.postId && p.status === 'falhou' ? { ...p, status: 'publicando' } : p)));
    registrar(a.id, {
      hora: 'agora',
      evento: 'reprocesso_manual',
      tom: 'neutro',
      detalhe: 'Alvo devolvido à fila pelo monitor. O post volta para publicando.',
    });
    avisar('Alvo devolvido à fila. O tick pega no próximo minuto.');
  }

  function rodarTick() {
    let mexeu = 0;
    const novos = alvos.map((a) => {
      if (a.estado === 'falhou' || a.estado === 'publicado') return a;

      if (a.estado === 'publicando') {
        mexeu++;
        registrar(a.id, {
          hora: 'agora',
          evento: 'publicado_reconciliado',
          tom: 'ok',
          detalhe: 'Container PUBLISHED. Marcado como publicado — sem nova chamada de media_publish.',
        });
        return {
          ...a,
          estado: 'publicado' as EstadoAlvo,
          mediaId: `179…${Math.floor(Math.random() * 9000 + 1000)}`,
          proximaTentativa: '—',
          erroCodigo: null,
          erroMensagem: 'Reconciliado: a Meta confirmou que a publicação saiu.',
        };
      }

      const proximo = AVANCO[a.estado];
      if (!proximo) return a;
      mexeu++;
      registrar(a.id, {
        hora: 'agora',
        evento: 'avancou_um_passo',
        tom: 'meta',
        detalhe: 'Um passo por tick. O worker não fica esperando dentro da mesma invocação.',
      });
      return { ...a, estado: proximo, proximaTentativa: 'agora', erroCodigo: null, erroMensagem: null };
    });

    setAlvos(novos);

    // Passo 4 do worker: status do post derivado dos alvos.
    setPosts((antes) =>
      antes.map((p) => {
        const irmaos = novos.filter((x) => x.postId === p.id);
        if (irmaos.length === 0 || irmaos.some((x) => ESTADOS_EM_VOO.includes(x.estado))) return p;
        const pub = irmaos.filter((x) => x.estado === 'publicado').length;
        const falha = irmaos.filter((x) => x.estado === 'falhou').length;
        if (pub > 0 && falha === 0) return { ...p, status: 'publicado' as const };
        if (pub > 0 && falha > 0) return { ...p, status: 'publicado_parcial' as const };
        if (falha > 0) return { ...p, status: 'falhou' as const };
        return p;
      }),
    );

    avisar(mexeu ? `Tick: ${mexeu} item(ns) avançaram um passo.` : 'Tick: nada elegível neste minuto.');
  }

  const colunas: Coluna<PostAlvo>[] = [
    {
      chave: 'peca',
      titulo: 'Peça',
      larguraMin: '210px',
      busca: (a) => `${postPorId(a.postId)?.tituloInterno ?? ''} ${clientePorId(a.clienteId)?.nome ?? ''}`,
      render: (a) => {
        const p = postPorId(a.postId);
        return (
          <>
            <b className="block text-[13px] font-semibold">{p?.tituloInterno ?? a.postId}</b>
            <span className="block text-[11px] text-tinta-3">
              {clientePorId(a.clienteId)?.nome} · {p ? `${p.dia}/08 ${p.hora}` : ''}
            </span>
          </>
        );
      },
    },
    {
      chave: 'conta',
      titulo: 'Conta',
      busca: (a) => contaPorId(a.contaSocialId)?.nomeExibicao ?? '',
      render: (a) => {
        const c = contaPorId(a.contaSocialId);
        return (
          <>
            <span className="block">{c?.nomeExibicao}</span>
            <span className="rotulo block">{c?.plataforma}</span>
          </>
        );
      },
    },
    { chave: 'estado', titulo: 'Estado', render: (a) => <Pilula tom={TOM_ESTADO[a.estado]}>{a.estado}</Pilula> },
    {
      chave: 'tentativas',
      titulo: 'Tentativas',
      render: (a) => (
        <>
          <span className="flex items-center gap-0.5">
            {Array.from({ length: MAX_TENTATIVAS }, (_, i) => (
              <i key={i} className={`block h-3 w-1 rounded-[1px] ${i < a.tentativas ? 'bg-espera' : 'bg-linha-forte'}`} />
            ))}
          </span>
          <span className="rotulo block">
            {a.tentativas} de {MAX_TENTATIVAS}
          </span>
        </>
      ),
    },
    {
      chave: 'proxima',
      titulo: 'Próxima tentativa',
      render: (a) => <span className="numeros text-[12px] text-tinta-2">{a.proximaTentativa}</span>,
    },
    {
      chave: 'motivo',
      titulo: 'Motivo',
      busca: (a) => a.erroMensagem ?? '',
      render: (a) =>
        a.erroMensagem ? (
          <>
            <span className="block max-w-[44ch] leading-snug text-tinta-2">{a.erroMensagem}</span>
            {a.erroCodigo && <span className="mt-0.5 block font-mono text-[10.5px] text-tinta-3">{a.erroCodigo}</span>}
          </>
        ) : a.mediaId ? (
          <span className="block text-tinta-2">Publicado. media_id {a.mediaId}</span>
        ) : (
          <span className="text-tinta-3">—</span>
        ),
    },
  ];

  const alvoAberto = visiveis.find((a) => a.id === aberto) ?? null;

  return (
    <>
      <Cabecalho
        titulo="Fila de publicação"
        linha="Uma linha por peça × conta de destino. O mesmo post pode ir para Instagram e Facebook e falhar só em um — por isso o estado vive aqui, não no post."
      />
      <div className="px-6 pb-8">
        <Tabela
          linhas={visiveis}
          colunas={colunas}
          chaveDe={(a) => a.id}
          selecionada={aberto}
          aoClicar={(a) => setAberto((x) => (x === a.id ? null : a.id))}
          placeholderBusca="Buscar peça ou motivo…"
          vazio={`Nada na fila para ${clientePorId(clienteAtivo)?.nome ?? 'este cliente'}.`}
          acoes={
            <>
              <Segmentado
                rotuloGrupo="Escopo da fila"
                valor={escopo}
                aoTrocar={(v) => {
                  setEscopo(v);
                  setAberto(null);
                }}
                opcoes={[
                  { valor: 'todos', texto: 'Todos os clientes' },
                  { valor: 'cliente', texto: `Só ${clientePorId(clienteAtivo)?.nome ?? ''}` },
                ]}
              />
              <Botao tamanho="pequeno" onClick={rodarTick}>
                Rodar o tick agora
              </Botao>
            </>
          }
        />

        {alvoAberto && (
          <div className="mt-4 overflow-hidden rounded-lg border border-linha bg-superficie">
            <div className="flex flex-wrap items-center gap-3 border-b border-linha bg-superficie-2 px-4 py-3">
              <h3 className="m-0 font-display text-[16px] font-medium">
                {postPorId(alvoAberto.postId)?.tituloInterno}
              </h3>
              <Pilula tom={TOM_ESTADO[alvoAberto.estado]}>{alvoAberto.estado}</Pilula>
              <span className="rotulo">
                {contaPorId(alvoAberto.contaSocialId)?.nomeExibicao} · alvo {alvoAberto.id}
              </span>
              <span className="ml-auto flex items-center gap-2.5">
                {alvoAberto.estado === 'falhou' && (
                  <Botao variante="primario" tamanho="pequeno" onClick={() => reprocessar(alvoAberto)}>
                    Tentar novamente
                  </Botao>
                )}
                {alvoAberto.estado === 'publicando' && (
                  <span className="rotulo text-espera">
                    aguardando reconciliação — nunca republicado às cegas
                  </span>
                )}
              </span>
            </div>
            <div className="flex flex-col px-4 py-3.5">
              {(eventos[alvoAberto.id] ?? []).map((e, i, arr) => (
                <div key={i} className="grid grid-cols-[64px_16px_1fr] items-start gap-2.5">
                  <span className="numeros pt-px text-right text-[11px] text-tinta-3">{e.hora}</span>
                  <span className="flex h-full flex-col items-center">
                    <i
                      className={
                        'mt-1 size-2.5 shrink-0 rounded-full border-2 ' +
                        (e.tom === 'ok'
                          ? 'border-ok bg-ok'
                          : e.tom === 'erro'
                            ? 'border-falha bg-falha'
                            : e.tom === 'meta'
                              ? 'border-pink bg-superficie'
                              : 'border-tinta-3 bg-superficie')
                      }
                    />
                    <i className={`w-px flex-1 ${i === arr.length - 1 ? 'bg-transparent' : 'bg-linha'}`} />
                  </span>
                  <span className="pb-3">
                    <span
                      className={
                        'block font-mono text-[12px] font-medium ' +
                        (e.tom === 'erro' ? 'text-falha' : e.tom === 'ok' ? 'text-ok' : '')
                      }
                    >
                      {e.evento}
                    </span>
                    <span className="mt-0.5 block max-w-[70ch] text-[11.5px] leading-relaxed text-tinta-3">
                      {e.detalhe}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mt-5 max-w-[82ch] border-l-2 border-linha-forte py-1 pl-3.5 text-[11.5px] leading-relaxed text-tinta-3">
          <b className="text-tinta-2">Estados:</b>{' '}
          <code className="font-mono">
            pendente → container_criando → container_aguardando → container_pronto → publicando → publicado
          </code>
          . Um item interrompido em <code className="font-mono">publicando</code> nunca é republicado: o worker
          pergunta à Meta se o post saiu e só volta a publicar quando fica provado que não saiu.
        </p>
      </div>
    </>
  );
}
