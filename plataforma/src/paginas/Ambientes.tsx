import { useCallback, useEffect, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada, Escolha } from '../componentes/Campo';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { abrirChamado, ambientesDoCliente } from '../dados/api';
import { diaMes, haQuanto } from '../formato';
import { PRIORIDADE, STATUS_CHAMADO } from '../rotulos';
import type { AmbientesDoCliente } from '../dados/tipos';

type Prioridade = 'baixa' | 'media' | 'alta' | 'urgente';

const PRIORIDADES: { valor: Prioridade; rotulo: string; explica: string }[] = [
  { valor: 'baixa', rotulo: 'Pode esperar', explica: 'resolvemos na próxima rodada' },
  { valor: 'media', rotulo: 'Normal', explica: 'entra na fila do dia' },
  { valor: 'alta', rotulo: 'Incomoda muito', explica: 'olhamos hoje' },
  { valor: 'urgente', rotulo: 'Site fora do ar', explica: 'paramos tudo' },
];

const FECHADOS = ['resolvido', 'cancelado'];

/** Certificado que vence em menos de duas semanas é problema, não informação. */
function sslApertado(iso: string | null): boolean {
  if (!iso) return false;
  const faltam = (new Date(`${iso}T12:00:00`).getTime() - Date.now()) / 86_400_000;
  return faltam < 14;
}

export function Ambientes({ clienteId, equipe }: { clienteId: string; equipe: boolean }) {
  const [dados, setDados] = useState<AmbientesDoCliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [prioridade, setPrioridade] = useState<Prioridade>('media');
  const [enviando, setEnviando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await ambientesDoCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir o site.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function pedirSocorro() {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    setRecado(null);
    try {
      await abrirChamado(clienteId, titulo, descricao, prioridade);
      setRecado('Chamado aberto. A equipe já está vendo.');
      setTitulo('');
      setDescricao('');
      setAbrindo(false);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir o chamado.');
    } finally {
      setEnviando(false);
    }
  }

  if (erro && !dados) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!dados) return <Carregando oQue="o site" />;

  const abertos = dados.chamados.filter((c) => !FECHADOS.includes(c.status));
  const fora = dados.ambientes.filter((a) => !a.noAr);

  return (
    <div className="mt-7">
      <div className="escada grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Bloco rotulo="Ambientes" destaque={String(dados.ambientes.length)} />
        <Bloco
          rotulo="Fora do ar"
          destaque={String(fora.length)}
          alerta={fora.length > 0}
          sombra={fora.length > 0}
        />
        <Bloco rotulo="Domínios" destaque={String(dados.dominios.length)} />
        <Bloco rotulo="Chamados abertos" destaque={String(abertos.length)} />
      </div>

      {recado && (
        <p role="status" className="rotulo-forte mt-6 text-pink-texto">
          {recado}
        </p>
      )}
      {erro && (
        <div role="alert" className="bloco mt-6 bg-alerta-fundo p-3.5">
          <span className="rotulo-forte text-pink-texto">não deu certo</span>
          <p className="mt-1 text-[13.5px] font-medium">{erro}</p>
        </div>
      )}

      {dados.ambientes.length === 0 && dados.dominios.length === 0 ? (
        <Vazio
          titulo="Nenhum ambiente."
          explica={
            equipe
              ? 'Cadastre o endereço do site e o domínio para acompanhar aqui.'
              : 'Assim que o site subir, o endereço aparece aqui.'
          }
        />
      ) : (
        <div className="mt-9 grid items-start gap-9 lg:grid-cols-[1fr_320px]">
          <div>
            <Fita>Onde o site mora</Fita>
            <ul className="mt-3 flex flex-col gap-3">
              {dados.ambientes.map((a) => (
                <li key={a.id} className={'bloco p-4 ' + (a.noAr ? '' : 'brilho-p border-l-2 border-l-pink')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold uppercase">{a.nome}</span>
                        <Marca forte={!a.noAr}>{a.noAr ? 'no ar' : 'fora do ar'}</Marca>
                      </div>
                      {a.url && (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="risca mt-1 inline-block font-mono text-[12px] break-all text-tinta-2 hover:text-pink-texto"
                        >
                          {a.url}
                        </a>
                      )}
                    </div>
                    <div className="rotulo text-right">
                      {a.hospedagem && <div>{a.hospedagem}</div>}
                      {a.sslRenovaEm && (
                        <div className={sslApertado(a.sslRenovaEm) ? 'text-pink-texto' : ''}>
                          ssl até {diaMes(a.sslRenovaEm)}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-9" />
            <Fita
              acao={
                // Só o cliente abre chamado por aqui: a equipe abre de dentro do
                // atendimento, com o histórico na mão.
                !equipe ? (
                  <Botao tamanho="pequeno" onClick={() => setAbrindo((v) => !v)}>
                    {abrindo ? 'Fechar' : 'Pedir ajuda'}
                  </Botao>
                ) : undefined
              }
            >
              Chamados
            </Fita>

            {abrindo && (
              <div className="bloco mt-3 p-4">
                <div className="grid gap-3">
                  <Campo id="ch-titulo" rotulo="O que está acontecendo" dica="uma linha basta">
                    <Entrada
                      id="ch-titulo"
                      value={titulo}
                      onChange={(e) => setTitulo(e.target.value)}
                      placeholder="o formulário não envia no celular"
                    />
                  </Campo>
                  <Campo id="ch-desc" rotulo="Mais detalhes" dica="opcional">
                    <textarea
                      id="ch-desc"
                      rows={3}
                      value={descricao}
                      onChange={(e) => setDescricao(e.target.value)}
                      className="w-full rounded-[var(--raio-p)] border border-linha bg-superficie px-3.5 py-3 text-[14px] backdrop-blur-xl placeholder:text-tinta-3 focus:outline-none"
                    />
                  </Campo>
                  <Campo
                    id="ch-prio"
                    rotulo="Quão urgente"
                    dica={PRIORIDADES.find((p) => p.valor === prioridade)?.explica}
                  >
                    <Escolha
                      id="ch-prio"
                      value={prioridade}
                      onChange={(e) => setPrioridade(e.target.value as Prioridade)}
                    >
                      {PRIORIDADES.map((p) => (
                        <option key={p.valor} value={p.valor}>
                          {p.rotulo}
                        </option>
                      ))}
                    </Escolha>
                  </Campo>
                  <Botao
                    variante="primario"
                    disabled={enviando || !titulo.trim()}
                    onClick={() => void pedirSocorro()}
                  >
                    {enviando ? 'Enviando…' : 'Abrir chamado'}
                  </Botao>
                </div>
              </div>
            )}

            {dados.chamados.length === 0 ? (
              <p className="py-4 text-tinta-3">Nenhum chamado aberto.</p>
            ) : (
              <ul className="mt-3 border-t border-linha-fraca">
                {dados.chamados.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-3 py-3.5"
                  >
                    <span className="min-w-48 flex-1 font-medium">{c.titulo}</span>
                    <Marca forte={c.prioridade === 'urgente' || c.prioridade === 'alta'}>
                      {PRIORIDADE[c.prioridade] ?? c.prioridade}
                    </Marca>
                    <span className="rotulo w-28 shrink-0">
                      {STATUS_CHAMADO[c.status] ?? c.status}
                    </span>
                    <span className="rotulo w-24 shrink-0">{haQuanto(c.abertoEm)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside aria-label="Domínios">
            <Fita>Domínios</Fita>
            {dados.dominios.length === 0 ? (
              <p className="py-4 text-tinta-3">Nenhum domínio cadastrado.</p>
            ) : (
              <ul className="border-t border-linha-fraca">
                {dados.dominios.map((d) => (
                  <li key={d.dominio} className="border-b border-linha-fraca py-3">
                    <div className="font-mono text-[12.5px] font-semibold break-all">
                      {d.dominio}
                    </div>
                    <div className="rotulo mt-1">
                      {d.registrador ?? 'registrador não informado'}
                      {d.venceEm && ` · vence ${diaMes(d.venceEm)}`}
                    </div>
                    {d.titular && <div className="rotulo mt-0.5">no nome de {d.titular}</div>}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
