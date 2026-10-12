import { useNavigate } from 'react-router-dom';
import { Botao } from '../componentes/Botao';
import { Bloco as Caixa } from '../componentes/Bloco';
import { Vazio } from '../componentes/Estado';
import { reais } from '../formato';
import type { PainelCliente } from '../dados/tipos';

function diasAte(iso: string | null): string {
  if (!iso) return 'sem data';
  const d = Math.round((new Date(`${iso}T12:00:00`).getTime() - Date.now()) / 86_400_000);
  if (d < 0) return `venceu há ${-d} ${-d === 1 ? 'dia' : 'dias'}`;
  if (d === 0) return 'vence hoje';
  if (d === 1) return 'vence amanhã';
  return `vence em ${d} dias`;
}

function Cartao({
  rotulo,
  destaque,
  children,
  forte,
}: {
  rotulo: string;
  destaque?: string;
  children?: React.ReactNode;
  forte?: boolean;
}) {
  return (
    <Caixa rotulo={rotulo} destaque={destaque} alerta={forte} sombra={forte}>
      {children}
    </Caixa>
  );
}

export function InicioCliente({ painel, nome }: { painel: PainelCliente; nome: string }) {
  const navegar = useNavigate();
  const aprovar = painel.paraAprovar.length;
  const primeiroNome = nome.split(' ')[0] ?? nome;

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <div className="rotulo">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
        <h1 className="titulao mt-3 text-[clamp(1.9rem,6vw,3.2rem)]">
          {aprovar === 0
            ? `${primeiroNome}, nada esperando você.`
            : `${primeiroNome}, ${aprovar} ${aprovar === 1 ? 'item espera' : 'itens esperam'} você.`}
        </h1>
      </div>

      <div className="mt-7 grid gap-4 lg:grid-cols-[1.6fr_1fr_1fr]">
        {aprovar > 0 ? (
          <Cartao rotulo="Para aprovar" destaque={`${aprovar} ${aprovar === 1 ? 'item' : 'itens'}`} forte>
            {/* Dentro do cartao pink TODO texto e do pink: tinta-2 aqui dava
                branco sobre pink, 1,57:1. */}
            <p className="mt-1 text-[13px] text-sobre-pink">
              {painel.paraAprovar
                .slice(0, 3)
                .map((i) => i.titulo)
                .join(' · ')}
              {aprovar > 3 && ` · e mais ${aprovar - 3}`}
            </p>
            <Botao variante="inverso" className="mt-4" onClick={() => navegar('/portal/aprovar')}>
              Abrir
            </Botao>
          </Cartao>
        ) : (
          <Cartao rotulo="Para aprovar" destaque="Nada pendente">
            <p className="mt-1 text-[13px] text-tinta-2">A Astart avisa quando tiver algo.</p>
          </Cartao>
        )}

        {painel.proximaCobranca ? (
          <Cartao rotulo="Boleto" destaque={reais(painel.proximaCobranca.valorCentavos)}>
            <p className="mt-1 text-[13px] text-tinta-2">
              {painel.proximaCobranca.descricao} · {diasAte(painel.proximaCobranca.vencimento)}
            </p>
            <Botao className="mt-4" onClick={() => navegar('/portal/financeiro')}>
              Pagar com PIX
            </Botao>
          </Cartao>
        ) : (
          <Cartao rotulo="Boleto" destaque="Em dia">
            <p className="mt-1 text-[13px] text-tinta-2">Nenhuma cobrança em aberto.</p>
          </Cartao>
        )}

        <Cartao rotulo="Como estamos indo?">
          <p className="mt-2 text-[15px]">
            {painel.npsPendente ? 'Sua nota do mês.' : 'Obrigado pela última nota.'}
          </p>
          <p className="mt-1 text-[13px] text-tinta-2">
            {painel.npsPendente ? 'Leva menos de um minuto.' : 'A próxima pesquisa chega no fim do mês.'}
          </p>
          <Botao className="mt-4" onClick={() => navegar('/portal/feedback')}>
            {painel.npsPendente ? 'Responder' : 'Ver respostas'}
          </Botao>
        </Cartao>
      </div>

      {/* Um bloco por serviço contratado. Quem só contratou captação vê um. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {painel.redes && (
          <Cartao rotulo="Suas redes">
            <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
              {([
                ['Publicados', painel.redes.publicados],
                ['Agendados', painel.redes.agendados],
                ['Esperando você', painel.redes.esperandoVoce],
                ['Em produção', painel.redes.emProducao],
              ] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt>{k}</dt>
                  <dd className="numeros">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Botao tamanho="pequeno" onClick={() => navegar('/portal/calendario')}>
                Calendário
              </Botao>
              <Botao tamanho="pequeno" onClick={() => navegar('/portal/grid')}>
                Grid
              </Botao>
            </div>
          </Cartao>
        )}

        {painel.projeto && (
          <Cartao rotulo={`Seu ${painel.projeto.servicoNome.toLowerCase()}`}>
            <div className="mt-3 flex gap-1" aria-hidden>
              {Array.from({ length: painel.projeto.total }, (_, i) => (
                <span
                  key={i}
                  className={
                    'h-3 flex-1 border border-linha ' +
                    (i < painel.projeto!.entregues ? 'bg-pink' : 'bg-superficie')
                  }
                />
              ))}
            </div>
            <div className="rotulo mt-2">
              {painel.projeto.entregues} de {painel.projeto.total} entregues · {painel.projeto.fase ?? '—'}
            </div>
            {painel.projeto.proximo && (
              <p className="mt-3 text-[13px] text-tinta-2">
                Próximo: <strong className="text-tinta">{painel.projeto.proximo}</strong>
              </p>
            )}
            <Botao tamanho="pequeno" className="mt-4" onClick={() => navegar('/portal/projeto')}>
              Ver o projeto
            </Botao>
          </Cartao>
        )}

        {painel.captacao && (
          <Cartao rotulo="Sua captação">
            {painel.captacao.proximaData ? (
              <p className="mt-3 text-[15px]">
                {painel.captacao.proximoTitulo} ·{' '}
                {new Date(`${painel.captacao.proximaData}T12:00:00`).toLocaleDateString('pt-BR')}
              </p>
            ) : (
              <p className="mt-3 text-tinta-2">Nenhuma captação agendada.</p>
            )}
            {painel.captacao.ultimaTitulo && (
              <p className="mt-2 text-[13px] text-tinta-2">
                {painel.captacao.ultimaTitulo}: {painel.captacao.ultimaFotos} fotos e{' '}
                {painel.captacao.ultimaVideos} vídeos.
              </p>
            )}
            <Botao tamanho="pequeno" className="mt-4" onClick={() => navegar('/portal/galeria')}>
              Abrir galeria
            </Botao>
          </Cartao>
        )}
      </div>

      {!painel.redes && !painel.projeto && !painel.captacao && (
        <Vazio
          titulo="Seu portal está sendo montado."
          explica="Assim que a Astart ligar os serviços contratados, eles aparecem aqui."
        />
      )}
    </div>
  );
}
