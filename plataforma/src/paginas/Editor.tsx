import { useEffect, useMemo, useRef, useState } from 'react';
import { Cabecalho } from '../componentes/Layout';
import { Cartao } from '../componentes/Cartao';
import { Botao } from '../componentes/Botao';
import { CampoArea, CampoSelecao, CampoTexto } from '../componentes/Campo';
import { PreviewFeed } from '../componentes/PreviewFeed';
import { Pilula } from '../componentes/Pilula';
import { clientePorId } from '../dados/mock';
import { useApp } from '../contexto';
import type { TipoPost } from '../dados/tipos';

const MAX_CARACTERES = 2200;
const MAX_HASHTAGS = 30;
const MIMES_IMAGEM = ['image/jpeg', 'image/png'];

interface Achado {
  tom: 'ok' | 'espera' | 'falha';
  texto: string;
}

/**
 * Validação antes do upload. Bloquear o erro aqui custa muito menos do que
 * descobrir que a Meta recusou na hora de publicar — e a Meta só devolve o
 * motivo em inglês, num código numérico.
 */
function validarArquivo(arq: File | null, largura: number, altura: number, tipo: TipoPost): Achado[] {
  if (!arq) return [{ tom: 'espera', texto: 'Escolha um arquivo para ver a validação e o preview.' }];

  const achados: Achado[] = [];
  const proporcao = altura > 0 ? largura / altura : 0;

  if (!MIMES_IMAGEM.includes(arq.type)) {
    achados.push({
      tom: 'falha',
      texto: `O Instagram aceita JPEG ou PNG para imagem. Arquivo enviado: ${arq.type || 'desconhecido'}.`,
    });
    return achados;
  }

  if (tipo === 'reel' || tipo === 'story') {
    const alvo = 9 / 16;
    const desvio = Math.abs(proporcao - alvo) / alvo;
    achados.push(
      desvio < 0.03
        ? { tom: 'ok', texto: `${largura}×${altura} — 9:16, dentro do padrão para ${tipo}.` }
        : {
            tom: 'espera',
            texto: `${largura}×${altura} (${proporcao.toFixed(3)}:1). ${tipo === 'reel' ? 'Reels' : 'Stories'} pedem 9:16 (0.563:1); fora disso o Instagram corta ou coloca barras.`,
          },
    );
  } else if (proporcao < 0.8 || proporcao > 1.91) {
    achados.push({
      tom: 'falha',
      texto: `${largura}×${altura} (${proporcao.toFixed(3)}:1) está fora do aceito. O Instagram só publica entre 4:5 (0.800) e 1.91:1 — a Meta vai recusar este arquivo.`,
    });
  } else {
    achados.push({
      tom: 'ok',
      texto: `${largura}×${altura} (${proporcao.toFixed(3)}:1), ${(arq.size / 1024).toFixed(0)} KB. Proporção dentro do aceito.`,
    });
  }

  if (tipo === 'carrossel') {
    achados.push({
      tom: 'espera',
      texto: 'Carrossel precisa de 2 a 10 itens, e o Instagram recorta todos na proporção do primeiro. Publicação de carrossel entra na fase 2.',
    });
  }
  if (tipo !== 'imagem') {
    achados.push({
      tom: 'espera',
      texto: `A Fase 1 publica apenas imagem única no Instagram. Um post do tipo "${tipo}" pode ser agendado, mas o worker vai recusá-lo com mensagem explícita.`,
    });
  }

  return achados;
}

export function Editor() {
  const { clienteAtivo, avisar } = useApp();
  const cliente = clientePorId(clienteAtivo);

  const [titulo, setTitulo] = useState('Marca nominativa, mista e figurativa');
  const [tipo, setTipo] = useState<TipoPost>('imagem');
  const [legenda, setLegenda] = useState(
    'Registrou a marca e acha que está tudo resolvido? Existem três tipos de registro no INPI, e escolher o errado deixa buraco na sua proteção.\n\nSalva esse post para consultar antes de entrar com o pedido.\n\n#registrodemarca #INPI #propriedadeintelectual #marcas #empreendedorismo',
  );
  const [comentario, setComentario] = useState('Dúvida sobre qual tipo se aplica ao seu caso? Chama a gente no direct.');
  const [data, setData] = useState('2026-09-15');
  const [hora, setHora] = useState('09:30');
  const [destinos, setDestinos] = useState<string[]>(() =>
    cliente ? cliente.contas.filter((c) => c.plataforma === 'instagram').map((c) => c.id) : [],
  );

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [src, setSrc] = useState<string>('');
  const [dim, setDim] = useState({ largura: 0, altura: 0 });
  const inputArquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDestinos(cliente ? cliente.contas.filter((c) => c.plataforma === 'instagram').map((c) => c.id) : []);
  }, [cliente]);

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  function escolherArquivo(f: File | null) {
    if (src) URL.revokeObjectURL(src);
    if (!f) {
      setArquivo(null); setSrc(''); setDim({ largura: 0, altura: 0 });
      return;
    }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => setDim({ largura: img.naturalWidth, altura: img.naturalHeight });
    img.onerror = () => setDim({ largura: 0, altura: 0 });
    img.src = url;
    setArquivo(f);
    setSrc(url);
  }

  const caracteres = legenda.length;
  const hashtags = (legenda.match(/#[\wÀ-ÿ]+/g) ?? []).length;
  const achados = useMemo(() => validarArquivo(arquivo, dim.largura, dim.altura, tipo), [arquivo, dim, tipo]);
  const impedeAgendar = achados.some((a) => a.tom === 'falha') || caracteres > MAX_CARACTERES || hashtags > MAX_HASHTAGS;

  const contaPreview = cliente?.contas.find((c) => destinos.includes(c.id)) ?? cliente?.contas[0];
  const proporcao = dim.largura && dim.altura ? `${dim.largura} / ${dim.altura}` : '4 / 5';
  const [, mes, diaStr] = data.split("-");

  return (
    <>
      <Cabecalho
        titulo="Editor de post"
        linha="A validação acontece aqui, antes do upload — bloquear o erro na tela custa muito menos do que descobrir que a Meta recusou na hora de publicar."
      />
      <div className="grid grid-cols-1 items-start gap-6 px-6 pb-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Cartao className="flex flex-col gap-3.5">
            <CampoTexto rotulo="Título interno" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            <CampoSelecao
              rotulo="Tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoPost)}
              opcoes={[
                { valor: 'imagem', texto: 'Feed — imagem única' },
                { valor: 'carrossel', texto: 'Feed — carrossel' },
                { valor: 'reel', texto: 'Reels' },
                { valor: 'story', texto: 'Story' },
              ]}
            />
            <CampoArea rotulo="Legenda" value={legenda} onChange={(e) => setLegenda(e.target.value)} />
            <div className="flex flex-wrap gap-3.5 text-[11px] text-tinta-3">
              <span>
                Caracteres{' '}
                <b className={`numeros font-medium ${caracteres > MAX_CARACTERES ? 'text-falha' : 'text-tinta-2'}`}>
                  {caracteres.toLocaleString('pt-BR')}
                </b>{' '}
                / {MAX_CARACTERES.toLocaleString('pt-BR')}
              </span>
              <span>
                Hashtags{' '}
                <b className={`numeros font-medium ${hashtags > MAX_HASHTAGS ? 'text-falha' : 'text-tinta-2'}`}>
                  {hashtags}
                </b>{' '}
                / {MAX_HASHTAGS}
              </span>
              {caracteres > MAX_CARACTERES && <span className="text-falha">Acima do limite — a Meta vai recusar.</span>}
              {caracteres > 1900 && caracteres <= MAX_CARACTERES && (
                <span className="text-espera">Chegando no limite.</span>
              )}
            </div>
            <CampoTexto
              rotulo="Primeiro comentário"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              dica="Publicado logo depois do post. Se falhar, o post não cai — só gera aviso."
            />
          </Cartao>

          <Cartao className="flex flex-col gap-3.5">
            <span className="rotulo">Arquivo</span>
            <input
              ref={inputArquivo}
              type="file"
              accept="image/jpeg,image/png"
              onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)}
              className="text-[12px] file:mr-3 file:rounded-full file:border file:border-tinta file:bg-superficie file:px-3.5 file:py-1.5 file:text-[11px] file:font-semibold file:text-tinta hover:file:bg-tinta hover:file:text-superficie"
            />
            {achados.map((a, i) => (
              <p
                key={i}
                className={
                  'rounded-md px-3 py-2 text-[12px] leading-relaxed ' +
                  (a.tom === 'ok'
                    ? 'bg-ok-suave text-ok'
                    : a.tom === 'falha'
                      ? 'bg-falha-suave text-falha'
                      : 'bg-espera-suave text-espera')
                }
              >
                {a.texto}
              </p>
            ))}

            <span className="rotulo mt-1">Destinos</span>
            <div className="flex flex-col gap-2">
              {cliente?.contas.map((c) => {
                const on = destinos.includes(c.id);
                const travada = c.acessoParceiro !== 'concedido';
                return (
                  <label
                    key={c.id}
                    className={
                      'flex items-center gap-2.5 rounded-md border px-2.5 py-2 ' +
                      (travada
                        ? 'border-linha bg-superficie-2 opacity-70'
                        : on
                          ? 'border-pink bg-pink-suave'
                          : 'border-linha-forte bg-papel')
                    }
                  >
                    <input
                      type="checkbox"
                      checked={on && !travada}
                      disabled={travada}
                      onChange={(e) =>
                        setDestinos((d) => (e.target.checked ? [...d, c.id] : d.filter((x) => x !== c.id)))
                      }
                      className="size-4 accent-pink"
                    />
                    <span className="text-[13px]">{c.nomeExibicao}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <Pilula tom={c.plataforma === 'instagram' ? 'acao' : 'neutro'}>{c.plataforma}</Pilula>
                      {travada && <Pilula tom="espera">acesso {c.acessoParceiro}</Pilula>}
                    </span>
                  </label>
                );
              })}
              {cliente?.contas.some((c) => c.acessoParceiro !== 'concedido') && (
                <p className="text-[11px] leading-relaxed text-tinta-3">
                  Conta sem acesso de parceiro concedido não pode ser destino. O worker recusaria a publicação com essa
                  mesma mensagem, mas só na hora de publicar.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <CampoTexto rotulo="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
              <CampoTexto
                rotulo={`Hora (${cliente?.fusoHorario.split('/')[1]?.replace('_', ' ') ?? ''})`}
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Botao
                variante="primario"
                disabled={impedeAgendar || destinos.length === 0}
                onClick={() => avisar('Post agendado. O alvo entra na fila e só fica elegível no horário.')}
              >
                Agendar
              </Botao>
              <Botao onClick={() => avisar('Enviado ao cliente. Ele recebe o link do portal, sem cadastro.')}>
                Enviar para aprovação
              </Botao>
              <Botao variante="texto" onClick={() => avisar('Rascunho salvo.')}>
                Salvar rascunho
              </Botao>
            </div>
            {impedeAgendar && (
              <p className="text-[11.5px] text-falha">
                Agendamento bloqueado enquanto houver erro acima. Corrija o arquivo ou a legenda.
              </p>
            )}
            {!impedeAgendar && destinos.length === 0 && (
              <p className="text-[11.5px] text-espera">Escolha ao menos uma conta de destino.</p>
            )}
          </Cartao>
        </div>

        <div>
          <p className="rotulo mb-2">Preview do feed</p>
          <PreviewFeed
            conta={contaPreview?.nomeExibicao ?? '—'}
            cliente={cliente?.nome ?? ''}
            legenda={legenda}
            arquivo={arquivo ? `${arquivo.name} · ${dim.largura}×${dim.altura}` : 'nenhum arquivo escolhido'}
            proporcao={proporcao}
            quando={`${diaStr}/${mes} ${hora}`}
            primeiroComentario={comentario}
            src={src || undefined}
          />
          <p className="mt-3 text-[11px] leading-relaxed text-tinta-3">
            O arquivo fica só no seu navegador — nada sobe enquanto o Storage não estiver ligado.
          </p>
        </div>
      </div>
    </>
  );
}
