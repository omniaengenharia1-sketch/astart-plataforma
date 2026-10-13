/**
 * Os documentos do cliente: contrato, proposta, NPS, o que vier.
 *
 * Foi o que a dona pediu depois de eu propor três formulários de digitar dado:
 * *"eu acho que é só você deixar um campo pra upload do contrato, relatório e
 * nps"*. Ela estava certa — uma agência não digita o contrato, ela anexa o PDF
 * assinado.
 *
 * Duas coisas aparecem na tela porque elas mudam o que a pessoa faz:
 *
 *   1. QUEM VÊ CADA DOCUMENTO, em cima de cada linha. Contrato nasce visível
 *      ao cliente — decisão dela, e a razão é boa: o documento assinado é dos
 *      dois lados. Proposta nasce fechada, porque tem preço de custo. Sem esse
 *      aviso na linha, a diferença viraria surpresa.
 *   2. O TIPO É ESCOLHIDO ANTES de arrastar, não depois. É o tipo que decide a
 *      visibilidade, e descobrir isso depois de o arquivo já estar no ar é
 *      tarde — proposta que apareceu para o cliente não se desfaz com um
 *      clique.
 */
import { useCallback, useEffect, useState } from 'react';
import { Marca } from './Bloco';
import { Botao } from './Botao';
import {
  ACEITA_NO_INPUT, TIPOS_DE_DOCUMENTO, documentosDoCliente, mudarVisibilidade,
  removerDocumento, subirDocumento,
} from '../dados/arquivos';
import { haQuanto } from '../formato';
import type { DocumentoDoCliente, TipoDocumento } from '../dados/tipos';

const ROTULO: Record<TipoDocumento, string> = {
  contrato: 'contrato',
  proposta: 'proposta',
  outro: 'outro',
};

export function Documentos({ clienteId, equipe }: { clienteId: string; equipe: boolean }) {
  const [docs, setDocs] = useState<DocumentoDoCliente[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoDocumento>('contrato');
  const [subindo, setSubindo] = useState<number | null>(null);
  const [sobre, setSobre] = useState(false);

  const ler = useCallback(async () => {
    setErro(null);
    try {
      setDocs(await documentosDoCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui ler os documentos.');
    }
  }, [clienteId]);

  useEffect(() => {
    void ler();
  }, [ler]);

  async function receber(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    setErro(null);
    // Um por vez: a mensagem de recusa precisa dizer QUAL arquivo, e em
    // paralelo a pessoa não saberia qual dos cinco foi recusado.
    for (const arquivo of Array.from(arquivos)) {
      try {
        setSubindo(0);
        await subirDocumento(clienteId, tipo, arquivo.name, arquivo, setSubindo);
      } catch (x) {
        setErro(x instanceof Error ? x.message : `Não consegui subir ${arquivo.name}.`);
        break;
      } finally {
        setSubindo(null);
      }
    }
    await ler();
  }

  async function tirar(doc: DocumentoDoCliente) {
    setErro(null);
    try {
      await removerDocumento(doc.id);
      await ler();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui tirar o documento.');
    }
  }

  async function alternar(doc: DocumentoDoCliente) {
    setErro(null);
    try {
      await mudarVisibilidade(doc.id, !doc.visivelAoCliente);
      await ler();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui mudar a visibilidade.');
    }
  }

  if (docs === null) return <p className="rotulo mt-3 normal-case">lendo os documentos…</p>;

  const escolhido = TIPOS_DE_DOCUMENTO.find((t) => t.valor === tipo);

  return (
    <section className="mt-9">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-linha-fraca pb-2">
        <div>
          <span className="rotulo-forte">documentos</span>
          <p className="rotulo mt-1 normal-case">
            {equipe
              ? 'contrato assinado, proposta, NPS — o arquivo, não o formulário'
              : 'os documentos que a Astart liberou para você'}
          </p>
        </div>
      </div>

      {docs.length === 0 ? (
        <p className="mt-3 text-[13px] text-tinta-2">
          {equipe
            ? 'Nenhum documento anexado ainda.'
            : 'Nenhum documento por aqui ainda. Quando a Astart liberar um, ele aparece nesta lista.'}
        </p>
      ) : (
        <ul className="mt-2 border-t border-linha-fraca">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-1 py-3"
            >
              <span className="min-w-0 flex-1 break-words font-bold">{d.nome}</span>
              <Marca>{ROTULO[d.tipo]}</Marca>
              {/* Quem vê, dito na linha. A equipe precisa saber de cabeça o
                  que o cliente já está olhando. */}
              {equipe && (
                <Marca forte={d.visivelAoCliente}>
                  {d.visivelAoCliente ? 'o cliente vê' : 'só a equipe'}
                </Marca>
              )}
              <span className="rotulo whitespace-nowrap">{haQuanto(d.enviadoEm)}</span>

              {d.url ? (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="risca text-[13px] hover:text-pink-texto"
                >
                  abrir
                </a>
              ) : (
                // Link que não assinou não vira endereço quebrado: a linha
                // mostra o documento sem o botão, em vez de um erro no clique.
                <span className="rotulo">sem link</span>
              )}

              {equipe && (
                <>
                  <Botao variante="texto" tamanho="pequeno" onClick={() => void alternar(d)}>
                    {d.visivelAoCliente ? 'Esconder' : 'Mostrar ao cliente'}
                  </Botao>
                  <Botao variante="texto" tamanho="pequeno" onClick={() => void tirar(d)}>
                    Tirar
                  </Botao>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {equipe && (
        <div className="mt-4">
          {/* O tipo vem ANTES do arquivo, porque é ele que decide quem vê. */}
          <span className="rotulo-forte">o que você vai anexar</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {TIPOS_DE_DOCUMENTO.map((t) => (
              <button
                key={t.valor}
                type="button"
                onClick={() => setTipo(t.valor)}
                className={
                  'rounded-full border px-3 py-1.5 text-[12.5px] ' +
                  (tipo === t.valor ? 'border-pink text-pink-texto' : 'border-linha text-tinta-2')
                }
              >
                {t.rotulo}
              </button>
            ))}
          </div>
          <p className="rotulo mt-1.5 normal-case">{escolhido?.dica}</p>

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
              'mt-3 flex min-h-16 cursor-pointer items-center justify-center rounded-[10px] ' +
              'border border-dashed px-3 py-3 text-center text-[12.5px] ' +
              (sobre ? 'border-pink text-pink-texto' : 'border-linha text-tinta-3')
            }
          >
            {subindo === null ? (
              <span>
                arraste o {escolhido?.rotulo.toLowerCase()} aqui, ou clique para escolher — PDF,
                imagem, planilha, documento ou apresentação
              </span>
            ) : (
              <span className="numeros">subindo… {Math.round(subindo * 100)}%</span>
            )}
            <input
              type="file"
              multiple
              accept={ACEITA_NO_INPUT}
              className="hidden"
              onChange={(e) => void receber(e.target.files)}
            />
          </label>
        </div>
      )}

      {erro && (
        <p
          role="alert"
          className="mt-3 rounded-[var(--raio-p)] border border-linha bg-alerta-fundo px-3.5 py-2.5 text-[13px]"
        >
          {erro}
        </p>
      )}
    </section>
  );
}
