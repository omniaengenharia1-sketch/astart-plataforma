import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Botao } from '../componentes/Botao';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { painelEquipe } from '../dados/api';
import type { PainelEquipe } from '../dados/tipos';

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function porExtenso(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function haQuanto(iso: string | null): string {
  if (!iso) return '—';
  // Data sem hora e lida como meia-noite UTC e escorrega um dia no Brasil.
  const quando = iso.includes('T') ? new Date(iso) : new Date(`${iso}T12:00:00`);
  const dias = Math.round((Date.now() - quando.getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'há 1 dia';
  return `há ${dias} dias`;
}

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function Bloco({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className={`bg-superficie p-5 ${forte ? 'border-2 border-tinta' : 'border border-linha'}`}>
      <div className="rotulo">{rotulo}</div>
      <div className="numeros mt-1.5 text-2xl font-semibold">{valor}</div>
    </div>
  );
}

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
        <h1 className="font-display mt-2 text-[clamp(1.6rem,5vw,2.5rem)] leading-tight font-semibold tracking-tight">
          {n === 0
            ? 'Nada travado hoje.'
            : `${n} ${n === 1 ? 'coisa precisa' : 'coisas precisam'} de você.`}
        </h1>
      </div>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Bloco rotulo="Precisa de você" valor={String(n)} forte={n > 0} />
        <Bloco rotulo="Sai hoje" valor={String(painel.saiHoje.length)} />
        <Bloco rotulo="Esperando o cliente" valor={String(painel.esperandoCliente)} />
        <Bloco rotulo="Vencido" valor={reais(painel.vencidoCentavos)} />
      </div>

      <div className="mt-9 grid items-start gap-9 lg:grid-cols-[1fr_360px]">
        <section>
          <h2 className="rotulo border-b-2 border-tinta pb-2.5 text-tinta">Precisa de você</h2>
          {n === 0 ? (
            <Vazio
              titulo="Tudo em dia."
              explica="Nenhuma peça parada, nenhuma publicação falha, nenhuma cobrança vencida."
            />
          ) : (
            <ul>
              {painel.pendencias.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha py-3.5"
                >
                  <span className="w-40 shrink-0 font-semibold">{p.clienteNome}</span>
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
          <h2 className="rotulo border-b-2 border-tinta pb-2.5 text-tinta">Sai hoje</h2>
          {painel.saiHoje.length === 0 ? (
            <p className="py-4 text-tinta-3">Nada sai hoje.</p>
          ) : (
            <ul>
              {painel.saiHoje.map((s) => (
                <li key={s.id} className="flex items-baseline gap-3 border-b border-linha py-3">
                  <span className="numeros w-12 shrink-0 text-[12.5px]">{s.hora}</span>
                  <span className="flex-1">{s.clienteNome}</span>
                  <span className="rotulo">{s.tipo}</span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="rotulo mt-8 border-b-2 border-tinta pb-2.5 text-tinta">Esta semana</h2>
          {painel.semana.length === 0 ? (
            <p className="py-4 text-tinta-3">Semana sem marco nem captação.</p>
          ) : (
            <ul>
              {painel.semana.map((c) => (
                <li key={c.id} className="flex items-baseline gap-3 border-b border-linha py-3">
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
