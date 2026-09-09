import { Cabecalho } from '../componentes/Layout';
import { Botao } from '../componentes/Botao';
import { clientePorId, LEGENDAS_EXEMPLO } from '../dados/mock';
import { useApp } from '../contexto';
import type { Post } from '../dados/tipos';

/** Tinta de capa derivada do id, para as peças não ficarem todas iguais. */
function capa(semente: string) {
  let h = 0;
  for (let i = 0; i < semente.length; i++) h = (h * 31 + semente.charCodeAt(i)) % 360;
  return `linear-gradient(145deg, hsl(${h} 42% 26%) 0%, hsl(${(h + 38) % 360} 46% 44%) 52%, hsl(${(h + 96) % 360} 40% 62%) 100%)`;
}

export function Portal() {
  const { clienteAtivo, posts, setPosts, aprovacoes, setAprovacoes, avisar } = useApp();
  const cliente = clientePorId(clienteAtivo);

  const pecas = posts.filter(
    (p) => p.clienteId === clienteAtivo && (p.status === 'aguardando_aprovacao' || aprovacoes.some((a) => a.postId === p.id)),
  );

  function decidir(post: Post, decisao: 'sim' | 'nao', comentario: string) {
    setAprovacoes((antes) => [...antes.filter((a) => a.postId !== post.id), { postId: post.id, decisao, comentario }]);
    setPosts((antes) =>
      antes.map((p) => (p.id === post.id ? { ...p, status: decisao === 'sim' ? 'agendado' : 'rascunho' } : p)),
    );
    avisar(
      decisao === 'sim'
        ? 'Aprovado — a peça foi direto para agendado.'
        : 'Reprovado — voltou para rascunho com o seu comentário.',
    );
  }

  return (
    <>
      <Cabecalho
        titulo="Portal de aprovação"
        linha="O que o cliente vê ao abrir o link. Sem cadastro, sem senha — o token no link já diz de quem é a conta."
      />
      <div className="px-6 pb-8">
        <div className="rounded-lg border border-linha bg-superficie p-6 shadow-sm">
          <div className="mb-5 border-b border-linha pb-3.5">
            <h2 className="m-0 mb-1.5 font-display text-[24px] font-medium">Olá, {cliente?.nome}</h2>
            <p className="m-0 text-[12.5px] text-tinta-3">
              Peças aguardando sua aprovação. Aprovar já coloca na fila para o horário combinado.
            </p>
            <p className="mt-2.5 inline-flex rounded-md border border-linha bg-papel px-2.5 py-1.5 font-mono text-[11px] text-tinta-3">
              {cliente?.linkAprovacao && !cliente.linkAprovacao.revogado
                ? `astart.app/aprovar/${cliente.slug}-9f3c1a7e…  ·  expira em ${cliente.linkAprovacao.expiraEm}`
                : 'este cliente ainda não tem link de aprovação ativo'}
            </p>
          </div>

          {pecas.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-tinta-3">
              Nenhuma peça aguardando aprovação agora.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {pecas.map((p) => (
                <CartaoPeca
                  key={p.id}
                  post={p}
                  decisao={aprovacoes.find((a) => a.postId === p.id)?.decisao ?? null}
                  aoDecidir={decidir}
                />
              ))}
            </div>
          )}
        </div>

        <p className="mt-5 max-w-[80ch] border-l-2 border-linha-forte py-1 pl-3.5 text-[11.5px] leading-relaxed text-tinta-3">
          <b className="text-tinta-2">Segurança:</b> o banco guarda o <b className="text-tinta-2">hash</b> do token,
          nunca o valor. O portal não fala com o Postgres direto —{' '}
          <code className="font-mono">anon</code> não tem privilégio nenhum. Toda leitura passa por uma Edge Function
          que valida o link e devolve só as peças daquele cliente.
        </p>
      </div>
    </>
  );
}

function CartaoPeca({
  post,
  decisao,
  aoDecidir,
}: {
  post: Post;
  decisao: 'sim' | 'nao' | null;
  aoDecidir: (p: Post, d: 'sim' | 'nao', comentario: string) => void;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-linha">
      <div className="relative flex aspect-4/5 items-end p-2.5" style={{ background: capa(post.id + post.tituloInterno) }}>
        <span className="rounded-[3px] bg-black/50 px-1.5 py-0.5 font-mono text-[9.5px] text-white">
          {post.id}.jpg · 1080×1350
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3 py-3">
        <span className="numeros text-[11px] text-tinta-3">
          {post.dia}/08/2026 · {post.hora}
        </span>
        <span className="text-[13.5px] font-semibold">{post.tituloInterno}</span>
        <p className="m-0 line-clamp-4 text-[12px] leading-relaxed text-tinta-2">
          {LEGENDAS_EXEMPLO[post.id] ?? 'Legenda em edição pelo time da Astart.'}
        </p>

        {decisao === 'sim' && (
          <p className="mt-auto flex gap-2 rounded-md bg-ok-suave px-2.5 py-2 text-[12px] text-ok">
            <span aria-hidden>✓</span>
            Aprovado. Entrou na fila para {post.dia}/08 às {post.hora}.
          </p>
        )}
        {decisao === 'nao' && (
          <p className="mt-auto flex gap-2 rounded-md bg-falha-suave px-2.5 py-2 text-[12px] text-falha">
            <span aria-hidden>✕</span>
            Reprovado. O time da Astart foi avisado com o seu comentário.
          </p>
        )}
        {decisao === null && <Decidir post={post} aoDecidir={aoDecidir} />}
      </div>
    </div>
  );
}

function Decidir({
  post,
  aoDecidir,
}: {
  post: Post;
  aoDecidir: (p: Post, d: 'sim' | 'nao', comentario: string) => void;
}) {
  return (
    <form
      className="mt-auto flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <textarea
        name="comentario"
        placeholder="Comentário para o time (opcional)"
        className="min-h-14 w-full resize-y rounded-md border border-linha-forte bg-papel px-2 py-1.5 text-[12px] text-tinta placeholder:text-tinta-3 focus:border-pink"
      />
      <span className="flex gap-2">
        <Botao
          variante="primario"
          tamanho="pequeno"
          className="flex-1"
          onClick={(e) => {
            const form = (e.currentTarget as HTMLElement).closest('form');
            const texto = (form?.elements.namedItem('comentario') as HTMLTextAreaElement | null)?.value ?? '';
            aoDecidir(post, 'sim', texto);
          }}
        >
          Aprovar
        </Botao>
        <Botao
          tamanho="pequeno"
          className="flex-1"
          onClick={(e) => {
            const form = (e.currentTarget as HTMLElement).closest('form');
            const texto = (form?.elements.namedItem('comentario') as HTMLTextAreaElement | null)?.value ?? '';
            aoDecidir(post, 'nao', texto);
          }}
        >
          Reprovar
        </Botao>
      </span>
    </form>
  );
}
