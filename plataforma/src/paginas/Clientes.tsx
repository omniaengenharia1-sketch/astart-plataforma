import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bloco, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { Tabela } from '../componentes/Tabela';
import type { Coluna } from '../componentes/Tabela';
import { listaClientes } from '../dados/api';
import { reais, valor } from '../formato';
import type { ClienteNaLista } from '../dados/tipos';

/**
 * De quem é a bola. É a pergunta que a equipe faz olhando a lista, então é a
 * coluna que fica em pé: ajuste pendente aparece chapado, espera aparece calma.
 */
function Bola({ c }: { c: ClienteNaLista }) {
  if (c.precisaDeVoce > 0) {
    return (
      <Marca forte>
        {c.precisaDeVoce} {c.precisaDeVoce === 1 ? 'ajuste' : 'ajustes'}
      </Marca>
    );
  }
  if (c.esperandoCliente > 0) {
    return <Marca>{c.esperandoCliente} no cliente</Marca>;
  }
  return <span className="rotulo">em dia</span>;
}

export function Clientes() {
  const [linhas, setLinhas] = useState<ClienteNaLista[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const navegar = useNavigate();

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setLinhas(await listaClientes());
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui carregar os clientes.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const colunas = useMemo<Coluna<ClienteNaLista>[]>(
    () => [
      {
        chave: 'nome',
        titulo: 'Cliente',
        larguraMin: '13rem',
        busca: (c) => `${c.nome} ${c.slug}`,
        render: (c) => (
          <>
            <Link
              to={`/clientes/${c.id}`}
              className="risca rounded-sm font-bold uppercase hover:text-pink-texto"
              onClick={(e) => e.stopPropagation()}
            >
              {c.nome}
            </Link>
            <div className="rotulo mt-0.5">{c.slug}</div>
          </>
        ),
      },
      {
        chave: 'servicos',
        titulo: 'Contrato',
        larguraMin: '14rem',
        busca: (c) => c.servicos.join(' '),
        render: (c) =>
          c.servicos.length === 0 ? (
            <span className="rotulo">sem serviço ativo</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {c.servicos.map((s) => (
                <Marca key={s}>{s}</Marca>
              ))}
            </div>
          ),
      },
      {
        chave: 'resp',
        titulo: 'Responsável',
        busca: (c) => c.responsaveis.join(' '),
        render: (c) => (c.responsaveis.length ? c.responsaveis.join(', ') : '—'),
      },
      { chave: 'bola', titulo: 'De quem é a bola', render: (c) => <Bola c={c} /> },
      {
        chave: 'mensal',
        titulo: 'Por mês',
        render: (c) =>
          c.mensalCentavos > 0 ? (
            <span className="numeros">{valor(c.mensalCentavos)}</span>
          ) : (
            <span className="rotulo">—</span>
          ),
      },
      {
        chave: 'unico',
        titulo: 'Projeto',
        render: (c) =>
          c.unicoCentavos > 0 ? (
            <span className="numeros">{valor(c.unicoCentavos)}</span>
          ) : (
            <span className="rotulo">—</span>
          ),
      },
    ],
    [],
  );

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!linhas) return <Carregando oQue="os clientes" />;

  const mensal = linhas.reduce((a, c) => a + c.mensalCentavos, 0);
  const ajustes = linhas.reduce((a, c) => a + c.precisaDeVoce, 0);
  const espera = linhas.reduce((a, c) => a + c.esperandoCliente, 0);

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-9">
        <div>
          <div className="rotulo">quem a Astart atende hoje</div>
          <h1 className="titulao mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">Clientes</h1>
        </div>
        <Botao variante="primario" onClick={() => navegar('/clientes/novo')}>
          Novo cliente
        </Botao>
      </div>

      {linhas.length === 0 ? (
        <Vazio
          titulo="Nenhum cliente ainda."
          explica="Cadastre o primeiro pelo formulário ou jogando a proposta no sistema."
          acao={
            <Botao variante="primario" onClick={() => navegar('/clientes/novo')}>
              Cadastrar cliente
            </Botao>
          }
        />
      ) : (
        <>
          <div className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Bloco rotulo="Clientes ativos" destaque={String(linhas.length)} />
            <Bloco rotulo="Recorrente por mês" destaque={reais(mensal)} />
            <Bloco
              rotulo="Ajustes na sua mão"
              destaque={String(ajustes)}
              alerta={ajustes > 0}
              sombra={ajustes > 0}
            />
            <Bloco rotulo="Esperando o cliente" destaque={String(espera)} />
          </div>

          <div className="mt-9">
            <Tabela
              linhas={linhas}
              colunas={colunas}
              chaveDe={(c) => c.id}
              aoClicar={(c) => navegar(`/clientes/${c.id}`)}
              placeholderBusca="buscar cliente ou serviço"
              resumo={(c) => (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      to={`/clientes/${c.id}`}
                      className="font-bold uppercase"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.nome}
                    </Link>
                    <Bola c={c} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.servicos.length === 0 ? (
                      <span className="rotulo">sem serviço ativo</span>
                    ) : (
                      c.servicos.map((s) => <Marca key={s}>{s}</Marca>)
                    )}
                  </div>
                  <div className="numeros mt-2 text-[12.5px] text-tinta-2">
                    {c.mensalCentavos > 0 && <>{valor(c.mensalCentavos)}/mês</>}
                    {c.mensalCentavos > 0 && c.unicoCentavos > 0 && ' · '}
                    {c.unicoCentavos > 0 && <>{valor(c.unicoCentavos)} em projeto</>}
                    {c.mensalCentavos === 0 && c.unicoCentavos === 0 && '—'}
                  </div>
                  <div className="rotulo mt-1.5">
                    {c.responsaveis.length ? c.responsaveis.join(', ') : 'sem responsável'}
                  </div>
                </>
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}
