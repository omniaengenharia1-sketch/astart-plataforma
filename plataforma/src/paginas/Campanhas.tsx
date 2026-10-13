import { useCallback, useEffect, useState } from 'react';
import { Bloco, Fita } from '../componentes/Bloco';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import {
  AbrirArquivo, RelatorioDeCampanhaPainel, TirarRelatorio,
} from '../componentes/RelatorioDeCampanhaPainel';
import { campanhasDoCliente } from '../dados/api';
import { diaMes, reais } from '../formato';
import type { RelatorioDeCampanha } from '../dados/tipos';

/**
 * Número de métrica não é dinheiro nem é inteiro sempre: custo por conversa
 * tem centavo, alcance não tem. Quem decide é o próprio valor.
 */
function comoNumero(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString('pt-BR')
    : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function periodo(r: RelatorioDeCampanha): string {
  return `${diaMes(r.de)} a ${diaMes(r.ate)}`;
}

export function Campanhas({ clienteId, equipe }: { clienteId: string; equipe: boolean }) {
  const [relatorios, setRelatorios] = useState<RelatorioDeCampanha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setRelatorios(await campanhasDoCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir as campanhas.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!relatorios) return <Carregando oQue="as campanhas" />;

  const ultimo = relatorios[0];

  return (
    <div className="mt-7">
      {!ultimo ? (
        <Vazio
          titulo="Nenhum relatório."
          explica={
            equipe
              ? 'Anexe o relatório do período no painel abaixo.'
              : 'O relatório do mês aparece aqui quando fecha o período.'
          }
        />
      ) : (
        <>
          {/* Os blocos de métrica só existem quando alguém cadastrou métrica
              estruturada — e nesta versão o relatório é o ARQUIVO. Renderizar
              uma fileira vazia de cartões seria pior que não renderizar: dá a
              entender que o número existe e é zero. */}
          {ultimo.metricas.length > 0 && (
            <div className="escada grid grid-cols-2 gap-4 xl:grid-cols-4">
              {ultimo.metricas.slice(0, 4).map((m) => (
                <Bloco key={m.rotulo} rotulo={m.rotulo} destaque={comoNumero(m.valor)} />
              ))}
            </div>
          )}

          {ultimo.arquivo && (
            <div className="bloco mt-5 flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="rotulo">relatório do período</div>
                <div className="mt-1 break-words font-bold">{ultimo.arquivo}</div>
              </div>
              <AbrirArquivo caminho={ultimo.arquivoCaminho ?? null} />
            </div>
          )}

          <div className="mt-9">
            <Fita>Último período · {periodo(ultimo)}</Fita>
            {ultimo.campanhas.length === 0 ? (
              <p className="py-4 text-tinta-3">Nenhuma campanha no período.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {ultimo.campanhas.map((c) => (
                  <li key={c.nome} className="bloco p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-bold uppercase">{c.nome}</div>
                        <div className="rotulo mt-1">
                          {c.plataforma}
                          {c.objetivo && ` · ${c.objetivo}`}
                        </div>
                      </div>
                      <div className="text-right">
                        {c.verbaCentavos !== null && (
                          <div className="numeros text-[15px] font-bold">
                            {reais(c.verbaCentavos)}
                          </div>
                        )}
                        {c.resultadoValor !== null && (
                          <div className="rotulo mt-0.5">
                            {comoNumero(c.resultadoValor)} {c.resultadoRotulo ?? ''}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {relatorios.length > 1 && (
            <div className="mt-9">
              <Fita>Meses anteriores</Fita>
              <ul className="border-t border-linha-fraca">
                {relatorios.slice(1).map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-3 py-3.5"
                  >
                    <span className="w-36 shrink-0 font-bold uppercase">{periodo(r)}</span>
                    <span className="rotulo min-w-48 flex-1 break-words normal-case">
                      {r.arquivo ??
                        r.metricas.map((m) => `${m.rotulo}: ${comoNumero(m.valor)}`).join(' · ')}
                    </span>
                    <AbrirArquivo caminho={r.arquivoCaminho ?? null} />
                    {equipe && <TirarRelatorio id={r.id} aoMudar={() => void carregar()} />}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* O painel de anexar fica FORA do `!ultimo`, e de propósito: o caso em
          que mais se precisa dele é justamente o do cliente que ainda não tem
          relatório nenhum. Dentro do ramo de cima ele só apareceria depois do
          primeiro — e o primeiro não teria como entrar. */}
      {equipe && (
        <RelatorioDeCampanhaPainel clienteId={clienteId} aoMudar={() => void carregar()} />
      )}
    </div>
  );
}
