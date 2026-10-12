import { useCallback, useEffect, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import { gridDoCliente } from '../dados/api';
import { diaMes } from '../formato';
import { STATUS_PUBLICACAO, TIPO_PECA } from '../rotulos';
import type { ItemDoGrid } from '../dados/tipos';

/**
 * O feed como ele vai ficar. Três colunas, como o Instagram mostra — grid em
 * quatro colunas parece bonito aqui e mente sobre o resultado.
 */
function Quadro({ i, equipe }: { i: ItemDoGrid; equipe: boolean }) {
  const noAr = i.status === 'publicado';
  return (
    <li className="bloco group relative aspect-square overflow-hidden p-0">
      {i.capa ? (
        <img
          src={i.capa}
          alt={i.titulo}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
      ) : (
        // Sem capa a peça continua existindo: mostra o título, não um ícone de
        // imagem partida.
        <div className="flex h-full w-full items-center justify-center p-3">
          <span className="rotulo text-center">{i.titulo}</span>
        </div>
      )}

      {/* A tarja só sobe no hover e no foco; parada em cima da foto o tempo
          todo, o grid deixa de parecer um feed. */}
      <div
        className="vidro-chapa absolute inset-x-0 bottom-0 translate-y-full p-2.5
 transition-transform duration-300 group-hover:translate-y-0 group-focus-within:translate-y-0"
      >
        <div className="truncate text-[12.5px] font-semibold">{i.titulo}</div>
        <div className="rotulo mt-0.5">
          {TIPO_PECA[i.tipo]}
          {i.quando && ` · ${diaMes(i.quando)}`}
        </div>
      </div>

      {!noAr && (
        <span className="absolute top-2 right-2">
          <Marca forte={equipe && i.estado === 'em_aprovacao'}>
            {equipe ? STATUS_PUBLICACAO[i.status] : i.status === 'agendado' ? 'agendada' : 'a sair'}
          </Marca>
        </span>
      )}
    </li>
  );
}

export function Grid({ clienteId, equipe }: { clienteId: string; equipe: boolean }) {
  const [itens, setItens] = useState<ItemDoGrid[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setItens(await gridDoCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir o grid.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!itens) return <Carregando oQue="o grid" />;

  const noAr = itens.filter((i) => i.status === 'publicado');
  const aSair = itens.filter((i) => i.status !== 'publicado');

  return (
    <div className="mt-7">
      <div className="escada grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Bloco rotulo="No grid" destaque={String(itens.length)} />
        <Bloco rotulo="No ar" destaque={String(noAr.length)} />
        <Bloco rotulo={equipe ? 'Para sair' : 'A caminho'} destaque={String(aSair.length)} />
      </div>

      {itens.length === 0 ? (
        <Vazio
          titulo="Grid vazio."
          explica={
            equipe
              ? 'Peça aprovada entra no grid na data que você marcou.'
              : 'Assim que as peças do mês forem aprovadas, elas aparecem aqui.'
          }
        />
      ) : (
        <div className="mt-8">
          <Fita>Como o perfil vai ficar</Fita>
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
            {itens.map((i) => (
              <Quadro key={i.id} i={i} equipe={equipe} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
