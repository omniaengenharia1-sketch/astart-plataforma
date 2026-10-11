import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Botao } from '../componentes/Botao';
import { Bloco, Fita } from '../componentes/Bloco';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { painelEquipe } from '../dados/api';
import { haQuanto, porExtenso, reais } from '../formato';
import type { PainelEquipe } from '../dados/tipos';

export function InicioEquipe() {
  const [painel, setPainel] = useState<PainelEquipe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const navegar = useNavigate();

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setPainel(await painelEquipe());
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui montar o painel.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!painel) return <Carregando oQue="o seu dia" />;

  const n = painel.pendencias.length;

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <div className="rotulo">{porExtenso(painel.hoje)}</div>
        <h1 className="titulao mt-3 text-[clamp(1.9rem,6vw,3.2rem)]">
          {n === 0
            ? 'Nada travado hoje.'
            : `${n} ${n === 1 ? 'coisa precisa' : 'coisas precisam'} de você.`}
        </h1>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Bloco rotulo="Precisa de você" destaque={String(n)} alerta={n > 0} sombra={n > 0} />
        <Bloco rotulo="Sai hoje" destaque={String(painel.saiHoje.length)} />
        <Bloco rotulo="Esperando o cliente" destaque={String(painel.esperandoCliente)} />
        <Bloco rotulo="Vencido" destaque={reais(painel.vencidoCentavos)} />
      </div>

      <div className="mt-9 grid items-start gap-9 lg:grid-cols-[1fr_360px]">
        <section>
          <Fita>Precisa de você</Fita>
          {n === 0 ? (
            <Vazio
              titulo="Tudo em dia."
              explica="Nenhuma peça parada, nenhuma publicação falha, nenhuma cobrança vencida."
            />
          ) : (
            <ul className="border-t-2 border-linha">
              {painel.pendencias.map((p) => (
                <li
                  key={p.id}
                  className={
                    'flex flex-wrap items-center gap-x-4 gap-y-2 border-x-2 border-b-2 border-linha ' +
                    'px-3 py-3.5 ' +
                    (p.urgente ? 'border-l-8 border-l-pink' : '')
                  }
                >
                  <span className="w-40 shrink-0 font-bold uppercase">{p.clienteNome}</span>
                  <span className="min-w-48 flex-1">{p.oQue}</span>
                  <span className="rotulo w-24 shrink-0">{haQuanto(p.quando)}</span>
                  <Botao tamanho="pequeno" onClick={() => navegar(`/${p.rota}`)}>
                    {p.acao}
                  </Botao>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside>
          <Fita>Sai hoje</Fita>
          {painel.saiHoje.length === 0 ? (
            <p className="py-4 text-tinta-3">Nada sai hoje.</p>
          ) : (
            <ul>
              {painel.saiHoje.map((s) => (
                <li key={s.id} className="flex items-baseline gap-3 border-b-2 border-linha-fraca py-3">
                  <span className="numeros w-12 shrink-0 text-[12.5px]">{s.hora}</span>
                  <span className="flex-1">{s.clienteNome}</span>
                  <span className="rotulo">{s.tipo}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-8" />
          <Fita>Esta semana</Fita>
          {painel.semana.length === 0 ? (
            <p className="py-4 text-tinta-3">Semana sem marco nem captação.</p>
          ) : (
            <ul>
              {painel.semana.map((c) => (
                <li key={c.id} className="flex items-baseline gap-3 border-b-2 border-linha-fraca py-3">
                  <span className="numeros w-14 shrink-0 text-[12.5px]">
                    {c.data.slice(8, 10)}/{c.data.slice(5, 7)}
                  </span>
                  <span className="flex-1">{c.titulo}</span>
                  <span className="rotulo">{c.responsavelNome ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
