/**
 * O relatório de campanha: o arquivo que a agência já produz, anexado por
 * período.
 *
 * Por que é o arquivo e não um formulário de métricas: a dona pediu assim, e o
 * schema concordava com ela desde 2021 — `relatorios_campanha` nasceu com
 * `arquivo_nome` e `arquivo_caminho`. Eu ia construir campos de digitar
 * alcance e verba; a agência exporta o relatório do Gerenciador de Anúncios e
 * anexa. A tabela `campanhas`, com o detalhe estruturado, continua existindo
 * para o dia em que fizer falta.
 *
 * Duas decisões ficam visíveis na tela:
 *
 *   1. O CLIENTE VÊ NA HORA. Relatório é entrega — foi feito para ele. Não tem
 *      chave de visibilidade como os documentos têm; o portão é o módulo de
 *      campanhas no contrato. A tela diz isso para ninguém anexar um rascunho
 *      achando que fica guardado.
 *   2. REENVIAR O MESMO PERÍODO TROCA o arquivo, e o antigo sai do bucket.
 *      Corrigir relatório é rotina; a alternativa seria a pessoa inventar um
 *      período de um dia a mais para conseguir subir a versão certa.
 */
import { useState } from 'react';
import { Botao } from './Botao';
import { Campo, Entrada } from './Campo';
import {
  ACEITA_NO_INPUT, enderecoDoArquivo, removerRelatorioDeCampanha, subirRelatorioDeCampanha,
} from '../dados/arquivos';

/**
 * Abre o arquivo do relatório, assinando o endereço só no clique.
 *
 * Assinar na hora de montar a lista geraria uma URL para cada relatório de cada
 * mês, a cada abertura da tela — endereços de validade curta que quase nunca
 * são usados. E o endereço assinado é um acesso concedido: gerar doze por
 * engano é doze a mais do que o necessário.
 */
export function AbrirArquivo({ caminho }: { caminho: string | null }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(false);

  if (!caminho) return <span className="rotulo">sem arquivo</span>;

  return (
    <Botao
      variante="texto"
      tamanho="pequeno"
      disabled={ocupado}
      onClick={() => {
        setOcupado(true);
        setErro(false);
        void enderecoDoArquivo(caminho)
          .then((url) => {
            if (url) window.open(url, '_blank', 'noreferrer');
            else setErro(true);
          })
          .catch(() => setErro(true))
          .finally(() => setOcupado(false));
      }}
    >
      {erro ? 'não abriu' : ocupado ? 'abrindo…' : 'Abrir'}
    </Botao>
  );
}

/** O mês passado, que é o período que se fecha na prática. */
function mesPassado(): { de: string; ate: string } {
  const hoje = new Date();
  const primeiro = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const ultimo = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { de: iso(primeiro), ate: iso(ultimo) };
}

export function RelatorioDeCampanhaPainel({
  clienteId,
  aoMudar,
}: {
  clienteId: string;
  aoMudar: () => void;
}) {
  const inicial = mesPassado();
  const [de, setDe] = useState(inicial.de);
  const [ate, setAte] = useState(inicial.ate);
  const [nome, setNome] = useState('');
  const [subindo, setSubindo] = useState<number | null>(null);
  const [sobre, setSobre] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  async function receber(arquivos: FileList | null) {
    const arquivo = arquivos?.[0];
    if (!arquivo) return;
    setErro(null);
    setRecado(null);
    try {
      setSubindo(0);
      await subirRelatorioDeCampanha(clienteId, de, ate, nome || arquivo.name, arquivo, setSubindo);
      setRecado(`"${nome || arquivo.name}" no ar. O cliente já consegue abrir.`);
      setNome('');
      aoMudar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : `Não consegui subir ${arquivo.name}.`);
    } finally {
      setSubindo(null);
    }
  }

  return (
    <section className="bloco mt-9 p-4 sm:p-5">
      <div className="rotulo-forte">anexar relatório</div>
      <p className="rotulo mt-1 normal-case">
        um relatório por período · o cliente vê assim que você sobe
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Campo id="rel-de" rotulo="De">
          <Entrada id="rel-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </Campo>
        <Campo id="rel-ate" rotulo="Até">
          <Entrada id="rel-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </Campo>
        <Campo id="rel-nome" rotulo="Nome" dica="vazio = o nome do arquivo">
          <Entrada
            id="rel-nome"
            value={nome}
            placeholder="Ex.: Resultado de setembro"
            onChange={(e) => setNome(e.target.value)}
          />
        </Campo>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setSobre(true);
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSobre(false);
          void receber(e.dataTransfer.files);
        }}
        className={
          'mt-4 flex min-h-16 cursor-pointer items-center justify-center rounded-[10px] ' +
          'border border-dashed px-3 py-3 text-center text-[12.5px] ' +
          (sobre ? 'border-pink text-pink-texto' : 'border-linha text-tinta-3')
        }
      >
        {subindo === null ? (
          <span>
            arraste o relatório aqui, ou clique para escolher — PDF, planilha ou apresentação
          </span>
        ) : (
          <span className="numeros">subindo… {Math.round(subindo * 100)}%</span>
        )}
        <input
          type="file"
          accept={ACEITA_NO_INPUT}
          className="hidden"
          onChange={(e) => void receber(e.target.files)}
        />
      </label>

      <p className="rotulo mt-2 normal-case">
        reenviar o mesmo período troca o arquivo — o antigo sai, e não fica duplicado
      </p>

      {erro && (
        <p
          role="alert"
          className="mt-3 rounded-[var(--raio-p)] border border-linha bg-alerta-fundo px-3.5 py-2.5 text-[13px]"
        >
          {erro}
        </p>
      )}
      {recado && !erro && (
        <p className="mt-3 rounded-[var(--raio-p)] border border-linha-fraca px-3.5 py-2.5 text-[13px] text-tinta-2">
          {recado}
        </p>
      )}
    </section>
  );
}

/** Tirar um relatório da lista. Separado porque vive dentro de cada linha. */
export function TirarRelatorio({ id, aoMudar }: { id: string; aoMudar: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  return (
    <Botao
      variante="texto"
      tamanho="pequeno"
      disabled={ocupado}
      onClick={() => {
        setOcupado(true);
        void removerRelatorioDeCampanha(id)
          .then(aoMudar)
          .finally(() => setOcupado(false));
      }}
    >
      Tirar
    </Botao>
  );
}
