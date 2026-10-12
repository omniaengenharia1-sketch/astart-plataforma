import { useCallback, useEffect, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { financeiroDoCliente } from '../dados/api';
import { diaMes, reais } from '../formato';
import { SITUACAO, SITUACAO_CLIENTE } from '../rotulos';
import type { ContaDoCliente as Conta, FinanceiroDoCliente } from '../dados/tipos';

/**
 * As cobranças de UM cliente — a mesma tela dos dois lados. O que muda é o
 * verbo: a equipe lê "recebido", o cliente lê "pago". E o pix só aparece para
 * quem vai pagar.
 */
export function ContaDoCliente({ clienteId, equipe }: { clienteId: string; equipe: boolean }) {
  const [conta, setConta] = useState<FinanceiroDoCliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setConta(await financeiroDoCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir as cobranças.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function copiarPix(l: Conta) {
    if (!l.pix) return;
    try {
      await navigator.clipboard.writeText(l.pix);
      setCopiado(l.id);
      window.setTimeout(() => setCopiado(null), 2500);
    } catch {
      // Navegador sem permissão de área de transferência: mostra o código para
      // a pessoa copiar na mão, em vez de piscar um erro que não ajuda.
      setErro('Não consegui copiar. Selecione o código e copie na mão.');
    }
  }

  if (erro && !conta) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!conta) return <Carregando oQue="as cobranças" />;

  const aberto = conta.lancamentos.filter(
    (l) => l.situacao === 'previsto' || l.situacao === 'atrasado',
  );
  const fechado = conta.lancamentos.filter(
    (l) => l.situacao !== 'previsto' && l.situacao !== 'atrasado',
  );
  const nome = equipe ? SITUACAO : SITUACAO_CLIENTE;

  return (
    <div className="mt-7">
      <div className="escada grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Bloco rotulo="A vencer" destaque={reais(conta.aVencerCentavos)} />
        <Bloco
          rotulo={equipe ? 'Atrasado' : 'Vencido'}
          destaque={reais(conta.atrasadoCentavos)}
          alerta={conta.atrasadoCentavos > 0}
          sombra={conta.atrasadoCentavos > 0}
        />
        <Bloco
          rotulo={equipe ? 'Recebido no ano' : 'Pago no ano'}
          destaque={reais(conta.pagoNoAnoCentavos)}
        />
      </div>

      {erro && (
        <div role="alert" className="bloco mt-5 bg-alerta-fundo p-3.5">
          <span className="rotulo-forte text-pink-texto">não deu certo</span>
          <p className="mt-1 text-[13.5px] font-medium">{erro}</p>
        </div>
      )}

      {conta.lancamentos.length === 0 ? (
        <Vazio
          titulo="Nenhuma cobrança."
          explica={
            equipe
              ? 'As mensalidades entram sozinhas quando o contrato começa.'
              : 'Nada para pagar agora.'
          }
        />
      ) : (
        <div className="mt-9 grid items-start gap-9 xl:grid-cols-2">
          <section>
            <Fita>{equipe ? 'Em aberto' : 'Para pagar'}</Fita>
            {aberto.length === 0 ? (
              <p className="py-4 text-tinta-3">Nada em aberto.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {aberto.map((l) => {
                  const vencido = l.situacao === 'atrasado';
                  return (
                    <li
                      key={l.id}
                      className={'bloco p-4 ' + (vencido ? 'brilho-p border-l-2 border-l-pink' : '')}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold uppercase">{l.descricao}</div>
                          <div className="rotulo mt-1">
                            vence {diaMes(l.vencimento)} · {nome[l.situacao]}
                          </div>
                        </div>
                        <div className="numeros text-[clamp(1.1rem,3vw,1.4rem)] font-extrabold">
                          {reais(l.valorCentavos)}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {l.boletoUrl && (
                          <Botao
                            tamanho="pequeno"
                            variante="primario"
                            onClick={() => window.open(l.boletoUrl ?? '', '_blank', 'noopener')}
                          >
                            Abrir boleto
                          </Botao>
                        )}
                        {l.pix && (
                          <Botao tamanho="pequeno" onClick={() => void copiarPix(l)}>
                            {copiado === l.id ? 'Copiado' : 'Copiar pix'}
                          </Botao>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <Fita>{equipe ? 'Fechado' : 'Já pago'}</Fita>
            {fechado.length === 0 ? (
              <p className="py-4 text-tinta-3">Nada fechado ainda.</p>
            ) : (
              <ul className="border-t border-linha-fraca">
                {fechado.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-3 py-3.5"
                  >
                    <span className="min-w-48 flex-1 font-medium">{l.descricao}</span>
                    <Marca>{nome[l.situacao]}</Marca>
                    <span className="rotulo w-20 shrink-0">{diaMes(l.vencimento)}</span>
                    <span className="numeros w-28 shrink-0 text-right font-semibold">
                      {reais(l.valorCentavos)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
