import { useNavigate } from 'react-router-dom';
import { clientePorId, contaPorId } from '../dados/mock';
import { ESTADOS_EM_VOO, HOJE, useApp } from '../contexto';
import type { EstadoAlvo, Perfil, PostAlvo } from '../dados/tipos';

const ROTULO_ESTADO: Record<EstadoAlvo, string> = {
  pendente: 'Pendente',
  container_criando: 'Criando container',
  container_aguardando: 'Container aguardando',
  container_pronto: 'Container pronto',
  publicando: 'Publicando',
  publicado: 'Publicado',
  falhou: 'Falhou',
  cancelado: 'Cancelado',
};

const COR_ESTADO: Record<EstadoAlvo, string> = {
  pendente: 'text-tinta-3',
  container_criando: 'text-espera',
  container_aguardando: 'text-espera',
  container_pronto: 'text-espera',
  publicando: 'text-espera',
  publicado: 'text-ok',
  falhou: '',
  cancelado: 'text-tinta-3',
};

/**
 * A manchete do dia. Quando algo trava, ela nomeia o problema; quando nada
 * trava, ela dá o número do dia. Uma home que abre com "Bom dia, fulano" não
 * diz nada — esta é obrigada a ter uma opinião sobre o dia.
 */
function manchete(falhas: PostAlvo[], saemHoje: number, acessoPendente: number) {
  if (falhas.length > 0) {
    const primeira = falhas[0]!;
    const cliente = clientePorId(primeira.clienteId)?.nome ?? '';
    return falhas.length === 1
      ? { antes: 'Uma peça ', destaque: 'travada', depois: ` na ${cliente}.`, nota: primeira.erroMensagem }
      : {
          antes: `${falhas.length} peças `,
          destaque: 'travadas',
          depois: ' hoje.',
          nota: primeira.erroMensagem,
        };
  }
  if (acessoPendente > 0) {
    return {
      antes: 'Uma conta sem ',
      destaque: 'acesso',
      depois: ' no Business Manager.',
      nota: 'Enquanto o cliente não aceitar o convite de parceiro, essa conta não publica.',
    };
  }
  if (saemHoje === 0) {
    return { antes: 'Nada ', destaque: 'sai', depois: ' hoje.', nota: 'A fila está vazia para o dia.' };
  }
  return {
    antes: `${saemHoje === 1 ? 'Uma peça sai' : `${saemHoje} peças saem`} hoje. Nenhuma `,
    destaque: 'parada',
    depois: '.',
    nota: 'O worker está avançando a fila sozinho, um passo por minuto.',
  };
}

export function Inicio({ operador }: { operador: Perfil }) {
  const nav = useNavigate();
  const { posts, alvos } = useApp();

  const falhas = alvos.filter((a) => a.estado === 'falhou');
  const emVoo = alvos.filter((a) => ESTADOS_EM_VOO.includes(a.estado));
  const esperando = posts.filter((p) => p.status === 'aguardando_aprovacao').length;

  const doDia = posts
    .filter((p) => p.dia === HOJE && p.status !== 'rascunho')
    .sort((a, b) => (a.hora < b.hora ? -1 : 1));

  const acessoPendente = alvos.filter(
    (a) => contaPorId(a.contaSocialId)?.acessoParceiro !== 'concedido',
  ).length;

  const m = manchete(falhas, doDia.length, acessoPendente);
  const publicados = posts.filter(
    (p) => p.status === 'publicado' || p.status === 'publicado_parcial',
  ).length;

  return (
    <>
      {/* Manchete — a única serifada da tela, e só aparece uma vez. */}
      <div className="flex flex-wrap items-end justify-between gap-8 border-b border-tinta pt-6 pb-4">
        <div className="min-w-0">
          <h1 className="m-0 max-w-[20ch] font-display text-[clamp(28px,3.4vw,44px)] leading-[1.06] font-normal tracking-tight">
            {m.antes}
            <em className="text-pink italic">{m.destaque}</em>
            {m.depois}
          </h1>
          {m.nota && <p className="mt-2.5 max-w-[62ch] text-[12.5px] leading-relaxed text-tinta-2">{m.nota}</p>}
        </div>

        <div className="flex shrink-0">
          <Numero valor={doDia.length} rotulo="Saem hoje" aoClicar={() => nav('/calendario')} />
          <Numero valor={esperando} rotulo="Esperando o cliente" alerta={esperando > 0} aoClicar={() => nav('/aprovacao')} />
          <Numero valor={acessoPendente} rotulo="Acesso pendente" alerta={acessoPendente > 0} aoClicar={() => nav('/clientes')} />
          <Numero valor="11/50" rotulo="Cota 24h" />
        </div>
      </div>

      {/* Quadro do dia — tudo que é máquina vive em mono. */}
      <div className="pt-4 pb-2">
        <div className="flex items-center gap-3 text-[9.5px] font-bold tracking-[0.2em] uppercase">
          Quadro do dia
          <span className="h-px flex-1 bg-linha-forte" />
          <span className="font-mono text-[10.5px] font-normal tracking-[0.06em] text-tinta-3 normal-case">
            {doDia.length} {doDia.length === 1 ? 'peça' : 'peças'} · {falhas.length} parada
            {falhas.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="mt-3 w-full min-w-[840px] border-collapse">
            <thead>
              <tr>
                {['Hora', 'Peça', 'Estado', 'Motivo'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="border-b border-tinta pb-2 text-left text-[9px] font-semibold tracking-[0.18em] text-tinta-3 uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doDia.map((p) => {
                const alvo = alvos.find((a) => a.postId === p.id);
                const conta = alvo ? contaPorId(alvo.contaSocialId) : undefined;
                const falhou = alvo?.estado === 'falhou';
                return (
                  <tr
                    key={p.id}
                    onClick={() => nav('/fila')}
                    className={
                      'cursor-pointer border-b border-linha ' +
                      (falhou ? 'bg-pink-suave' : 'hover:bg-superficie-2')
                    }
                  >
                    <td className="w-24 py-3 align-middle">
                      <span
                        className={
                          'numeros text-[21px] font-medium tracking-tight ' +
                          (falhou ? 'text-pink-tinta' : '')
                        }
                      >
                        {p.hora}
                      </span>
                    </td>
                    <td className="py-3 align-middle">
                      <span className="block text-[13.5px] leading-tight font-semibold">
                        {p.tituloInterno}
                      </span>
                      <span className="mt-0.5 block text-[10px] font-semibold tracking-[0.11em] text-tinta-3 uppercase">
                        {clientePorId(p.clienteId)?.nome}
                        {conta && ` · ${conta.nomeExibicao}`}
                      </span>
                    </td>
                    <td className="w-44 py-3 align-middle">
                      {alvo ? (
                        falhou ? (
                          <span className="bg-pink px-2.5 py-1 font-mono text-[10.5px] font-semibold tracking-[0.13em] text-white uppercase">
                            Falhou
                          </span>
                        ) : (
                          <span
                            className={`font-mono text-[10.5px] tracking-[0.13em] uppercase ${COR_ESTADO[alvo.estado]}`}
                          >
                            {ROTULO_ESTADO[alvo.estado]}
                          </span>
                        )
                      ) : (
                        <span className="font-mono text-[10.5px] tracking-[0.13em] text-tinta-3 uppercase">
                          Agendado
                        </span>
                      )}
                    </td>
                    <td className="py-3 align-middle">
                      <span
                        className={
                          'block max-w-[46ch] font-mono text-[10.5px] leading-relaxed ' +
                          (falhou ? 'text-pink-tinta' : 'text-tinta-3')
                        }
                      >
                        {alvo?.erroMensagem ?? `Elegível às ${p.hora}.`}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {doDia.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center font-mono text-[11px] text-tinta-3">
                    Nenhuma peça agendada para hoje.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap gap-x-7 gap-y-1 border-t-2 border-tinta py-2.5 font-mono text-[10.5px] tracking-[0.05em] text-tinta-3 uppercase">
        <span>
          Publicados no mês <b className="font-medium text-tinta">{publicados}</b>
        </span>
        <span>
          Na fila agora <b className="font-medium text-tinta">{emVoo.length}</b>
        </span>
        <span>
          Falhas <b className="font-medium text-tinta">{falhas.length}</b>
        </span>
        <span>
          Operador <b className="font-medium text-tinta">{operador.nome}</b>
        </span>
      </div>
    </>
  );
}

function Numero({
  valor,
  rotulo,
  alerta,
  aoClicar,
}: {
  valor: number | string;
  rotulo: string;
  alerta?: boolean;
  aoClicar?: () => void;
}) {
  const Tag = aoClicar ? 'button' : 'div';
  return (
    <Tag
      onClick={aoClicar}
      className={
        'border-l border-linha px-5 text-right first:border-l-0 ' +
        (aoClicar ? 'transition-colors hover:text-pink-tinta' : '')
      }
    >
      <div className={`numeros text-[26px] leading-none font-medium ${alerta ? 'text-espera' : ''}`}>
        {valor}
      </div>
      <div className="rotulo mt-1.5">{rotulo}</div>
    </Tag>
  );
}
