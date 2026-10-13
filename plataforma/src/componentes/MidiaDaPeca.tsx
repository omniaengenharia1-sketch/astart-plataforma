/**
 * O arquivo da peça — extraído do calendário porque o compositor usa o mesmo.
 *
 * Duas telas, uma regra: deixar cópia em cada uma era garantir que um dia
 * divergissem, e a que divergisse seria a menos usada, descoberta por último.
 */
import { useCallback, useEffect, useState } from 'react';
import { FORMATOS, PEDE } from '../dados/formatos';
import { midiasDaPeca, removerMidiaDaPeca, subirMidiaDaPeca } from '../dados/pecaMidia';
import type { MidiaDaPeca, StatusPublicacao, TipoPeca } from '../dados/tipos';

/** Só o que o painel precisa saber da peça: o compositor não tem uma inteira. */
export interface PecaParaMidia {
  id: string;
  tipo: TipoPeca;
  statusPublicacao: StatusPublicacao;
}

/** O `accept` do seletor de arquivos, por natureza. JPEG só, porque a Meta só. */
const ACEITA = {
  imagem: 'image/jpeg',
  video: 'video/*',
  imagem_ou_video: 'image/jpeg,video/*',
} as const;

/**
 * O arquivo da peça, arrastado na própria peça.
 *
 * Sem isto a peça vai para a Meta sem imagem e volta com erro de madrugada,
 * quando ninguém está olhando. Então o estado "falta arquivo" aparece aqui, na
 * peça, enquanto a pessoa ainda tem o arquivo na mão.
 */
export function MidiaDaPecaPainel({
  peca,
  clienteId,
  equipe,
  aoMudar,
}: {
  peca: PecaParaMidia;
  clienteId: string;
  equipe: boolean;
  aoMudar: () => void;
}) {
  const [midias, setMidias] = useState<MidiaDaPeca[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [subindo, setSubindo] = useState<number | null>(null);
  const [sobre, setSobre] = useState(false);

  const ler = useCallback(async () => {
    try {
      setMidias(await midiasDaPeca(peca.id));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui ler os arquivos.');
    }
  }, [peca.id]);

  useEffect(() => {
    void ler();
  }, [ler]);

  async function receber(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    setErro(null);
    // Um por vez, em ordem: o banco decide a `ordem` e recusa quando enche.
    // Mandar em paralelo daria duas linhas disputando a mesma posição.
    for (const arquivo of Array.from(arquivos)) {
      try {
        setSubindo(0);
        await subirMidiaDaPeca(peca.id, clienteId, arquivo, setSubindo, peca.tipo);
      } catch (x) {
        setErro(x instanceof Error ? x.message : `Não consegui subir ${arquivo.name}.`);
        break;
      } finally {
        setSubindo(null);
      }
    }
    await ler();
    aoMudar();
  }

  async function tirar(id: string) {
    setErro(null);
    try {
      await removerMidiaDaPeca(id);
      await ler();
      aoMudar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui tirar o arquivo.');
    }
  }

  if (midias === null) return <p className="rotulo mt-3 normal-case">lendo os arquivos…</p>;

  // Peça no ar é histórico: o banco recusa trocar a mídia, e a tela não pode
  // oferecer o que vai ser recusado. Formulário que não pode funcionar não
  // deve aparecer — a mesma regra do link de senha vencido.
  const congelada =
    peca.statusPublicacao === 'publicado' ||
    peca.statusPublicacao === 'publicando' ||
    peca.statusPublicacao === 'publicado_parcial';

  return (
    <div className="mt-3 border-t border-linha-fraca pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rotulo-forte">arquivo</span>
        <span className="rotulo">{peca.tipo} pede {PEDE[peca.tipo]}</span>
      </div>

      {congelada ? (
        <p className="mt-1.5 text-[13px] text-tinta-2">
          Esta peça já foi publicada. O arquivo do que foi publicado não muda — duplique a peça
          se quiser outra imagem.
        </p>
      ) : (
        midias.length === 0 && (
          // A consequência, não o estado: "vazio" não diz o que acontece depois.
          <p className="mt-1.5 text-[13px] text-tinta-2">
            Sem arquivo, esta peça <strong>não publica</strong> — a Meta recusa legenda sozinha.
          </p>
        )
      )}

      {midias.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-2">
          {midias.map((m) => (
            <li key={m.id} className="relative">
              {m.url && m.mime.startsWith('image/') ? (
                <img
                  src={m.url}
                  alt={`Arquivo ${m.ordem + 1} da peça`}
                  className="size-20 rounded-[10px] border border-linha object-cover"
                />
              ) : (
                <div className="grid size-20 place-items-center rounded-[10px] border border-linha bg-superficie text-[11px] text-tinta-3">
                  {m.mime.startsWith('video/') ? 'vídeo' : 'arquivo'}
                </div>
              )}
              {equipe && !congelada && (
                <button
                  type="button"
                  onClick={() => void tirar(m.id)}
                  aria-label={`Tirar arquivo ${m.ordem + 1}`}
                  className="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full border border-linha bg-fundo text-[13px] hover:text-pink-texto"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {equipe && !congelada && (
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
            'mt-2.5 flex min-h-14 cursor-pointer items-center justify-center rounded-[10px] ' +
            'border border-dashed px-3 py-2 text-center text-[12.5px] ' +
            (sobre ? 'border-pink text-pink-texto' : 'border-linha text-tinta-3')
          }
        >
          {subindo === null ? (
            <span>arraste o arquivo aqui, ou clique para escolher — {PEDE[peca.tipo]}</span>
          ) : (
            <span className="numeros">subindo… {Math.round(subindo * 100)}%</span>
          )}
          {/* O `accept` segue o formato da peça em vez de aceitar tudo: num
              carrossel o seletor de arquivos nem mostra vídeo, porque o banco
              recusaria (0056). Deixar escolher para recusar depois é fazer a
              pessoa descobrir batendo. */}
          <input
            type="file"
            multiple={FORMATOS[peca.tipo].maximo > 1}
            accept={ACEITA[FORMATOS[peca.tipo].natureza]}
            className="hidden"
            onChange={(e) => void receber(e.target.files)}
          />
        </label>
      )}

      {erro && (
        <p
          role="alert"
          className="mt-2.5 rounded-[var(--raio-p)] border border-linha bg-alerta-fundo px-3 py-2 text-[12.5px]"
        >
          {erro}
        </p>
      )}
    </div>
  );
}

/**
 * A peça no calendário. Com `abrir`, ela abre o painel do arquivo; sem, fica
 * seca.
 *
 * A versão seca não é preguiça: no grid do mês, o DIA inteiro já é um
 * `<button>` — é assim que se cria peça clicando num dia vazio. Botão dentro de
 * botão é HTML inválido e quebra teclado e leitor de tela. Então no grid a peça
 * só informa, e quem trabalha a peça é a lista por dia, que é onde a pessoa
 * está quando quer anexar o arquivo.
 */
