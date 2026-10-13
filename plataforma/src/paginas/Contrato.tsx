import { useCallback, useEffect, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { Documentos } from '../componentes/Documentos';
import { fichaCliente } from '../dados/api';
import { diaMes, porExtenso, reais } from '../formato';
import { FORMATO, MODULO, PAPEL_CLIENTE, STATUS_SERVICO } from '../rotulos';
import type { FichaCliente as Ficha, ServicoContratado } from '../dados/tipos';

/**
 * Como aquele serviço é cobrado, numa linha. Nulo quando quem lê não cuida do
 * dinheiro: o cliente vê o preço do contrato dele, a equipe de operação não.
 */
function comoCobra(s: ServicoContratado): string | null {
  if (s.valorCentavos === null) return null;
  if (s.formato === 'recorrente') {
    return s.diaVencimento
      ? `${reais(s.valorCentavos)} por mês · vence todo dia ${s.diaVencimento}`
      : `${reais(s.valorCentavos)} por mês`;
  }
  if (s.parcelas && s.parcelas > 1) {
    return `${reais(s.valorCentavos)} em ${s.parcelas}x`;
  }
  return `${reais(s.valorCentavos)} à vista`;
}

/**
 * O contrato do jeito que o cliente lê: o que ele contratou, quanto custa, e o
 * que cada serviço liga na conta dele. A mesma função do banco serve os dois
 * lados — o RLS é que decide o que chega.
 */
export function Contrato({ clienteId, equipe }: { clienteId: string; equipe: boolean }) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setFicha(await fichaCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir o contrato.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!ficha) return <Carregando oQue="o contrato" />;

  const ativos = ficha.servicos.filter((s) => s.status === 'ativo');
  const encerrados = ficha.servicos.filter((s) => s.status !== 'ativo');

  return (
    <div className="mt-7">
      <div
        className={
          'escada grid grid-cols-2 gap-4 ' +
          (ficha.mensalCentavos === null ? '' : 'xl:grid-cols-3')
        }
      >
        <Bloco rotulo="Serviços ativos" destaque={String(ativos.length)} />
        {ficha.mensalCentavos !== null && (
          <Bloco rotulo="Por mês" destaque={reais(ficha.mensalCentavos)} />
        )}
        {ficha.unicoCentavos !== null && (
          <Bloco rotulo="Em projeto" destaque={reais(ficha.unicoCentavos)} />
        )}
      </div>

      {ficha.servicos.length === 0 ? (
        <Vazio
          titulo="Nenhum serviço."
          explica={equipe ? 'Adicione um serviço para liberar as abas.' : 'Fale com a gente.'}
        />
      ) : (
        <div className="mt-9 grid items-start gap-9 lg:grid-cols-[1fr_320px]">
          <div>
            <Fita>O que você contratou</Fita>
            <ul className="mt-3 flex flex-col gap-3">
              {ativos.map((s) => (
                <li key={s.id} className="bloco p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="titulao text-[clamp(1.1rem,3vw,1.35rem)]">
                          {s.servicoNome}
                        </span>
                        <Marca>{FORMATO[s.formato]}</Marca>
                      </div>
                      {comoCobra(s) && (
                        <div className="mt-2 text-[14px] font-medium">{comoCobra(s)}</div>
                      )}
                    </div>
                    {s.entregaEm && (
                      <div className="text-right">
                        <div className="rotulo">entrega</div>
                        <div className="numeros text-[15px] font-bold">{diaMes(s.entregaEm)}</div>
                      </div>
                    )}
                  </div>
                  <div className="rotulo mt-3 normal-case">
                    começou em {porExtenso(s.inicio)}
                    {s.responsavelNome && ` · ${s.responsavelNome} cuida disso`}
                  </div>
                </li>
              ))}
            </ul>

            {encerrados.length > 0 && (
              <>
                <div className="mt-9" />
                <Fita>Fora do ar</Fita>
                <ul className="border-t border-linha-fraca">
                  {encerrados.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-3 py-3.5"
                    >
                      <span className="w-44 shrink-0 font-bold uppercase">{s.servicoNome}</span>
                      <Marca>{STATUS_SERVICO[s.status]}</Marca>
                      <span className="numeros min-w-48 flex-1 text-[13px]">
                        {s.valorCentavos === null ? '' : reais(s.valorCentavos)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <aside aria-label="Abas liberadas e quem responde">
            <Fita>O que o contrato libera</Fita>
            <div className="flex flex-wrap gap-1.5 pt-3">
              {ficha.modulos.map((m) => (
                <Marca key={m}>{MODULO[m]}</Marca>
              ))}
            </div>

            <div className="mt-8" />
            <Fita>Quem responde</Fita>
            {ficha.contatos.length === 0 ? (
              <p className="py-4 text-tinta-3">Ninguém com acesso ainda.</p>
            ) : (
              <ul className="border-t border-linha-fraca">
                {ficha.contatos
                  .filter((c) => c.ativo)
                  .map((c) => (
                    <li key={c.email} className="border-b border-linha-fraca py-3">
                      <div className="font-bold uppercase">{c.nome}</div>
                      <div className="mt-0.5 font-mono text-[11.5px] break-all text-tinta-2">
                        {c.email}
                      </div>
                      <div className="rotulo mt-0.5">{PAPEL_CLIENTE[c.papel]}</div>
                    </li>
                  ))}
              </ul>
            )}
          </aside>
        </div>
      )}

      {/* O contrato assinado. Fica na aba Contrato porque é onde a pergunta
          aparece: quem abre esta tela quer ver o que foi combinado, e o
          combinado está no PDF, não só nas linhas de serviço acima. */}
      <Documentos clienteId={clienteId} equipe={equipe} />
    </div>
  );
}
