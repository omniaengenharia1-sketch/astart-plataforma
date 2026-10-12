import { useCallback, useEffect, useState } from 'react';
import { Fita, Marca } from './Bloco';
import { Botao } from './Botao';
import { criarLinkAprovacao, enviosDoCliente, revogarLinkAprovacao } from '../dados/api';
import { haQuanto, plural } from '../formato';
import type { EnvioNaFicha } from '../dados/tipos';

/**
 * Os lotes enviados e os links de quem não tem conta.
 *
 * Duas coisas que esta lista responde e nenhuma outra tela respondia:
 * "ele abriu?" — que é diferente de "ele respondeu?" — e "como eu tiro este
 * link do ar?", já que o link não vence por data: revogar é a única saída.
 */
function enderecoDo(token: string): string {
  return `${window.location.origin}/a/${token}`;
}

export function LinksDeAprovacao({ clienteId }: { clienteId: string }) {
  const [envios, setEnvios] = useState<EnvioNaFicha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setEnvios(await enviosDoCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui carregar os envios.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * O token aparece UMA vez, na resposta da função: depois disso só existe o
   * hash no banco. Por isso ele vai direto para a área de transferência, e a
   * tela mostra o endereço inteiro para quem não puder copiar.
   */
  async function mandar(envioId: string) {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      const token = await criarLinkAprovacao(envioId);
      const endereco = enderecoDo(token);
      try {
        await navigator.clipboard.writeText(endereco);
        setCopiado(endereco);
      } catch {
        // Sem permissão de área de transferência o endereço aparece na tela
        // para a pessoa copiar na mão — perder o token aqui seria perder o
        // link, porque ele não é mostrado de novo.
        setCopiado(endereco);
      }
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui criar o link.');
    } finally {
      setOcupado(false);
    }
  }

  async function revogar(linkId: string) {
    setErro(null);
    try {
      await revogarLinkAprovacao(linkId);
      setCopiado(null);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui revogar.');
    }
  }

  if (!envios) return null;

  return (
    <div>
      <Fita>Enviados</Fita>

      {copiado && (
        <div role="status" className="bloco brilho-p mt-3 p-4">
          <div className="rotulo-forte text-pink-texto">link copiado · mande agora</div>
          <p className="mt-2 font-mono text-[12px] break-all select-all">{copiado}</p>
          <p className="rotulo mt-2 normal-case">
            ele não vence e não pede senha. aparece uma vez só — se perder, crie outro.
          </p>
        </div>
      )}

      {erro && (
        <div role="alert" className="bloco mt-3 bg-alerta-fundo p-3.5">
          <span className="rotulo-forte text-pink-texto">não deu certo</span>
          <p className="mt-1 text-[13.5px] font-medium">{erro}</p>
        </div>
      )}

      {envios.length === 0 ? (
        <p className="py-4 text-tinta-3">
          Nenhum lote enviado. Mande material do calendário ou dos entregáveis.
        </p>
      ) : (
        <ul className="mt-3 border-t border-linha-fraca">
          {envios.map((e) => {
            const falta = e.itens - e.respondidos;
            const link = e.links[0];
            return (
              <li key={e.id} className="border-b border-linha-fraca py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="font-bold uppercase">
                    {plural(e.itens, 'item', 'itens')}
                  </span>
                  {e.fechadoEm ? (
                    <Marca>respondido</Marca>
                  ) : (
                    <Marca forte={falta > 0}>{falta} na mão dele</Marca>
                  )}
                  <span className="rotulo">{haQuanto(e.quando)}</span>
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {!e.fechadoEm && (
                      <Botao tamanho="pequeno" disabled={ocupado} onClick={() => void mandar(e.id)}>
                        {link ? 'Outro link' : 'Mandar link'}
                      </Botao>
                    )}
                    {link && (
                      <Botao
                        variante="texto"
                        tamanho="pequeno"
                        onClick={() => void revogar(link.id)}
                      >
                        Tirar do ar
                      </Botao>
                    )}
                  </span>
                </div>

                {e.mensagem && <p className="rotulo mt-1 normal-case">“{e.mensagem}”</p>}

                {link && (
                  <div className="rotulo mt-1.5">
                    {link.acessos === 0
                      ? 'link no ar · ele ainda não abriu'
                      : `aberto ${plural(link.acessos, 'vez', 'vezes')} · última ${haQuanto(link.ultimoAcessoEm)}`}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
