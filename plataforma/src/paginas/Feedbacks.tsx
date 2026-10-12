import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { npsResumo } from '../dados/api';
import { haQuanto, plural } from '../formato';
import type { ResumoNps } from '../dados/tipos';

/** 9 e 10 promove, 7 e 8 fica em cima do muro, 6 ou menos reclama. */
function faixa(nota: number): { rotulo: string; forte: boolean } {
  if (nota >= 9) return { rotulo: 'promotor', forte: false };
  if (nota >= 7) return { rotulo: 'neutro', forte: false };
  return { rotulo: 'detrator', forte: true };
}

/** A barra das três faixas. Proporção é mais rápida de ler que três números. */
function Barra({ r }: { r: ResumoNps }) {
  const total = Math.max(1, r.respostas);
  const pedaco = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <div>
      <div
        className="flex h-2.5 overflow-hidden rounded-full border border-linha bg-superficie"
        role="img"
        aria-label={`${r.promotores} promotores, ${r.neutros} neutros, ${r.detratores} detratores`}
      >
        <span
          className="bg-[linear-gradient(180deg,var(--pink-topo),var(--pink-base))]"
          style={{ width: pedaco(r.promotores) }}
        />
        <span className="bg-superficie-3" style={{ width: pedaco(r.neutros) }} />
        <span className="bg-tinta-3/40" style={{ width: pedaco(r.detratores) }} />
      </div>
      <div className="rotulo mt-2 flex flex-wrap gap-x-4">
        <span>{r.promotores} promotores</span>
        <span>{r.neutros} neutros</span>
        <span>{r.detratores} detratores</span>
      </div>
    </div>
  );
}

export function Feedbacks() {
  const [resumo, setResumo] = useState<ResumoNps | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setResumo(await npsResumo());
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui carregar os feedbacks.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!resumo) return <Carregando oQue="os feedbacks" />;

  const reclamacoes = resumo.ultimas.filter((u) => u.nota <= 6);

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <div className="rotulo">feedbacks · últimos 6 meses</div>
        <h1 className="titulao mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">
          {reclamacoes.length === 0
            ? 'Ninguém reclamando.'
            : `${plural(reclamacoes.length, 'cliente insatisfeito', 'clientes insatisfeitos')}.`}
        </h1>
      </div>

      <div className="escada mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Bloco rotulo="NPS" destaque={resumo.nps === null ? '—' : String(resumo.nps)} />
        <Bloco rotulo="Respostas" destaque={String(resumo.respostas)} />
        <Bloco
          rotulo="Reclamando"
          destaque={String(resumo.detratores)}
          alerta={resumo.detratores > 0}
          sombra={resumo.detratores > 0}
        />
        <Bloco rotulo="Sem responder" destaque={String(resumo.semResposta.length)} />
      </div>

      {resumo.respostas > 0 && (
        <div className="bloco mt-5 p-4 sm:p-5">
          <div className="rotulo">como estão divididos</div>
          <div className="mt-3">
            <Barra r={resumo} />
          </div>
        </div>
      )}

      {resumo.respostas === 0 ? (
        <Vazio
          titulo="Nenhuma resposta."
          explica="A pesquisa sai todo mês para quem tem contrato ativo."
        />
      ) : (
        <div className="mt-9 grid items-start gap-9 lg:grid-cols-[1fr_320px]">
          <div>
            <Fita>O que escreveram</Fita>
            {resumo.ultimas.length === 0 ? (
              <p className="py-4 text-tinta-3">Notas sem comentário.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {resumo.ultimas.map((u, i) => {
                  const f = faixa(u.nota);
                  return (
                    <li
                      key={`${u.clienteId}-${u.quando}-${i}`}
                      className={'bloco p-4 ' + (f.forte ? 'brilho-p border-l-2 border-l-pink' : '')}
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="numeros text-[22px] leading-none font-extrabold">
                          {u.nota}
                        </span>
                        <Marca forte={f.forte}>{f.rotulo}</Marca>
                        {u.clienteId ? (
                          <Link
                            to={`/clientes/${u.clienteId}`}
                            className="risca font-bold uppercase hover:text-pink-texto"
                          >
                            {u.clienteNome}
                          </Link>
                        ) : (
                          <span className="font-bold uppercase">{u.clienteNome}</span>
                        )}
                        <span className="rotulo">{haQuanto(u.quando)}</span>
                      </div>
                      {u.comentario && <p className="mt-2 text-[14.5px]">“{u.comentario}”</p>}
                      {u.quem && <div className="rotulo mt-2">— {u.quem}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <aside aria-label="Pesquisas sem resposta">
            <Fita>Sem responder</Fita>
            {resumo.semResposta.length === 0 ? (
              <p className="py-4 text-tinta-3">Todo mundo respondeu.</p>
            ) : (
              <ul className="border-t border-linha-fraca">
                {resumo.semResposta.map((s, i) => (
                  <li
                    key={`${s.clienteNome}-${s.competencia}-${i}`}
                    className="flex items-baseline justify-between gap-3 border-b border-linha-fraca py-3"
                  >
                    <span className="font-bold uppercase">{s.clienteNome}</span>
                    <span className="rotulo shrink-0">{s.competencia.slice(0, 7)}</span>
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
