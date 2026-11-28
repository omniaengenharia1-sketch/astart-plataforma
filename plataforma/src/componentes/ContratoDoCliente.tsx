/**
 * O contrato de um cliente que já existe — agora com tela.
 *
 * A dona pediu em voz alta: "preciso tbm ficar liberada para alterar o valor e
 * informações de clientes cadastrados". Eu construí o banco inteiro para isso
 * na 0052 — o título daquela migration é literalmente "o contrato de um
 * cliente que JÁ EXISTE" —, escrevi os testes, e parei ali. Semanas depois,
 * corrigir o valor da Publika exigiu que EU rodasse SQL na produção, porque
 * ela não tinha onde clicar.
 *
 * A varredura que fiz depois achou outras treze funções na mesma situação.
 * Motor sem porta não aparece em teste nenhum: o teste chama a função direto.
 *
 * AS QUATRO AÇÕES, E POR QUE SÃO QUATRO E NÃO UMA
 *
 *   alterar   trocar valor, dia, prazo, quem cuida. O caso de todo dia.
 *   pausar    o cliente parou por um mês e volta. O contrato fica.
 *   encerrar  acabou. Guarda a data e o histórico inteiro.
 *   remover   só para engano de cadastro, e o banco recusa se já andou.
 *
 * "Encerrar" e "remover" parecem a mesma coisa e não são: a primeira preserva
 * o passado — entregas, aprovações, lançamentos — e a segunda apaga a linha.
 * Por isso remover fica atrás de uma confirmação e o próprio banco recusa
 * quando há história, em vez de deixar a escolha só com a tela.
 */
import { useEffect, useState } from 'react';
import { Botao } from './Botao';
import { Marca } from './Bloco';
import { Campo, Entrada, Escolha } from './Campo';
import {
  adicionarServico, alterarServico, encerrarServico, equipeEConvites,
  mudarEstadoDoServico, removerServico, servicosParaAdicionar,
} from '../dados/api';
import { reais } from '../formato';
import { FORMATO, STATUS_SERVICO } from '../rotulos';
import type { PessoaDaEquipe, ServicoContratado, ServicoDisponivel } from '../dados/tipos';

/** Centavos para o que se digita, e de volta. Nunca float em dinheiro. */
function paraReais(centavos: number | null): string {
  return centavos === null ? '' : (centavos / 100).toFixed(2).replace('.', ',');
}
function paraCentavos(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  if (limpo.trim() === '') return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

interface Form {
  apelido: string;
  valor: string;
  diaVencimento: string;
  parcelas: string;
  entregaEm: string;
  dataEvento: string;
  observacao: string;
  responsaveis: string[];
}

function doServico(s: ServicoContratado): Form {
  return {
    apelido: s.apelido ?? '',
    valor: paraReais(s.valorCentavos),
    diaVencimento: s.diaVencimento === null ? '' : String(s.diaVencimento),
    parcelas: s.parcelas === null ? '' : String(s.parcelas),
    entregaEm: s.entregaEm ?? '',
    dataEvento: s.dataEvento ?? '',
    observacao: s.observacao ?? '',
    responsaveis: s.responsaveisIds,
  };
}

function Quem({
  equipe, marcados, aoMarcar,
}: {
  equipe: PessoaDaEquipe[];
  marcados: string[];
  aoMarcar: (ids: string[]) => void;
}) {
  return (
    <fieldset className="mt-3">
      <legend className="rotulo">quem cuida</legend>
      {/* Caixas de marcar, não `<select multiple>`: no telefone o seletor de
          vários exige segurar e arrastar, e quase ninguém descobre que dá para
          marcar o segundo. Mesma decisão do cadastro (0070). */}
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
        {equipe.length === 0 && <span className="legenda">ninguém na equipe ainda</span>}
        {equipe.map((p) => {
          const marcado = marcados.includes(p.userId);
          return (
            <label key={p.userId} className="flex items-center gap-2 text-[13.5px]">
              <input
                type="checkbox"
                checked={marcado}
                onChange={() =>
                  aoMarcar(
                    marcado
                      ? marcados.filter((x) => x !== p.userId)
                      : [...marcados, p.userId],
                  )}
                className="size-4 accent-[var(--pink-base)]"
              />
              {p.nome ?? p.email}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Campos({
  form, setForm, equipe, recorrente,
}: {
  form: Form;
  setForm: (f: Form) => void;
  equipe: PessoaDaEquipe[];
  recorrente: boolean;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo id="c-valor" rotulo="Valor" dica="em reais">
          <Entrada
            id="c-valor"
            inputMode="decimal"
            value={form.valor}
            onChange={(e) => setForm({ ...form, valor: e.target.value })}
            placeholder="1600,00"
          />
        </Campo>
        {recorrente ? (
          <Campo id="c-dia" rotulo="Vence todo dia" dica="1 a 31">
            <Entrada
              id="c-dia"
              inputMode="numeric"
              value={form.diaVencimento}
              onChange={(e) => setForm({ ...form, diaVencimento: e.target.value })}
              placeholder="20"
            />
          </Campo>
        ) : (
          <Campo id="c-parcelas" rotulo="Parcelas">
            <Entrada
              id="c-parcelas"
              inputMode="numeric"
              value={form.parcelas}
              onChange={(e) => setForm({ ...form, parcelas: e.target.value })}
              placeholder="1"
            />
          </Campo>
        )}
        <Campo id="c-entrega" rotulo="Entrega em">
          <Entrada
            id="c-entrega"
            type="date"
            value={form.entregaEm}
            onChange={(e) => setForm({ ...form, entregaEm: e.target.value })}
          />
        </Campo>
        <Campo id="c-evento" rotulo="Data do evento">
          <Entrada
            id="c-evento"
            type="date"
            value={form.dataEvento}
            onChange={(e) => setForm({ ...form, dataEvento: e.target.value })}
          />
        </Campo>
      </div>

      {/* O NOME DESTA LINHA (0090).
          Primeiro campo do formulário porque é o que separa uma linha da
          outra: com duas captações no mesmo cliente, é por aqui que ela diz
          qual é o ensaio e qual é o aniversário. Vai no boleto também. */}
      <Campo
        id="c-apelido"
        rotulo="Nome deste trabalho"
        dica="opcional · aparece no boleto do cliente"
        className="mt-3"
      >
        <Entrada
          id="c-apelido"
          value={form.apelido}
          maxLength={60}
          onChange={(e) => setForm({ ...form, apelido: e.target.value })}
          placeholder="Ex.: Aniversário da Zilda"
        />
      </Campo>

      <Campo id="c-obs" rotulo="Observação" className="mt-3">
        <Entrada
          id="c-obs"
          value={form.observacao}
          onChange={(e) => setForm({ ...form, observacao: e.target.value })}
          placeholder="o que mais precisa ficar escrito"
        />
      </Campo>

      <Quem
        equipe={equipe}
        marcados={form.responsaveis}
        aoMarcar={(ids) => setForm({ ...form, responsaveis: ids })}
      />
    </>
  );
}

function Linha({
  s, equipe, aoMudar,
}: {
  s: ServicoContratado;
  equipe: PessoaDaEquipe[];
  aoMudar: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(() => doServico(s));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  // Reabrir tem de mostrar o que está valendo AGORA, não o que estava quando
  // a tela carregou. Sem isto, salvar uma vez e reabrir mostraria o antigo.
  useEffect(() => { if (!aberto) setForm(doServico(s)); }, [aberto, s]);

  const recorrente = s.formato === 'recorrente';
  const encerrado = s.status === 'encerrado';

  async function fazer(oque: () => Promise<void>) {
    setOcupado(true);
    setErro(null);
    try {
      await oque();
      await aoMudar();
      setAberto(false);
      setConfirmando(false);
    } catch (x) {
      // A recusa do banco é a frase boa: ela diz por que não dá e o que fazer.
      setErro(x instanceof Error ? x.message : 'Não consegui salvar.');
    } finally {
      setOcupado(false);
    }
  }

  const salvar = () => fazer(() => alterarServico(s.id, {
    valorCentavos: paraCentavos(form.valor),
    diaVencimento: form.diaVencimento === '' ? null : Number(form.diaVencimento),
    parcelas: form.parcelas === '' ? null : Number(form.parcelas),
    entregaEm: form.entregaEm || null,
    dataEvento: form.dataEvento || null,
    observacao: form.observacao || null,
    apelido: form.apelido,
    responsaveis: form.responsaveis,
  }));

  return (
    <li className="border-b border-linha-fraca px-3 py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* O NOME DA LINHA NA FRENTE, quando ela tem um (0090).
            Com duas captações no mesmo cliente, "Audiovisual" duas vezes não
            diz qual é qual — e o que ela precisa ver é "Aniversário da
            Zilda". O serviço continua logo abaixo, menor: é ele que decide
            quais abas o cliente enxerga. */}
        <span className="w-44 shrink-0">
          <span className="block font-bold">{s.apelido ?? s.servicoNome}</span>
          {s.apelido && <span className="rotulo block">{s.servicoNome}</span>}
        </span>
        <Marca>{FORMATO[s.formato]}</Marca>
        {s.status !== 'ativo' && <Marca forte>{STATUS_SERVICO[s.status]}</Marca>}
        <span className="legenda min-w-48 flex-1 text-[13px]">
          {s.valorCentavos === null ? '' : reais(s.valorCentavos)}
          {recorrente && s.diaVencimento ? ` · todo dia ${s.diaVencimento}` : ''}
          {!recorrente && s.parcelas ? ` · ${s.parcelas}x` : ''}
        </span>
        <span className="legenda w-28 shrink-0">
          {s.responsaveis.length ? s.responsaveis.join(', ') : 'sem responsável'}
        </span>
        <Botao
          variante="texto"
          tamanho="pequeno"
          onClick={() => setAberto((v) => !v)}
        >
          {aberto ? 'Fechar' : 'Editar'}
        </Botao>
      </div>

      {aberto && (
        <div className="mt-3 border-t border-linha-fraca pt-3">
          {encerrado ? (
            <p className="legenda">
              Serviço encerrado{s.fim ? ` em ${s.fim}` : ''}. Encerrado não se altera —
              ele é o registro do que valeu até ali.
            </p>
          ) : (
            <>
              <Campos form={form} setForm={setForm} equipe={equipe} recorrente={recorrente} />

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Botao variante="primario" disabled={ocupado} onClick={() => void salvar()}>
                  {ocupado ? 'Salvando…' : 'Salvar'}
                </Botao>

                <Botao
                  variante="secundario"
                  tamanho="pequeno"
                  disabled={ocupado}
                  onClick={() => void fazer(() =>
                    mudarEstadoDoServico(s.id, s.status === 'pausado' ? 'ativo' : 'pausado'))}
                >
                  {s.status === 'pausado' ? 'Retomar' : 'Pausar'}
                </Botao>

                {/* Encerrar e remover ficam no fim, e remover atrás de
                    confirmação: encerrar guarda o passado, remover apaga. */}
                <Botao
                  variante="texto"
                  tamanho="pequeno"
                  disabled={ocupado}
                  onClick={() => void fazer(() => encerrarServico(s.id, null))}
                >
                  Encerrar
                </Botao>

                {!confirmando ? (
                  <Botao
                    variante="texto"
                    tamanho="pequeno"
                    className="ml-auto"
                    disabled={ocupado}
                    onClick={() => { setConfirmando(true); setErro(null); }}
                  >
                    Remover
                  </Botao>
                ) : (
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <span className="legenda">remover apaga o histórico junto.</span>
                    <Botao
                      variante="primario"
                      tamanho="pequeno"
                      disabled={ocupado}
                      onClick={() => void fazer(() => removerServico(s.id))}
                    >
                      Remover mesmo
                    </Botao>
                    <Botao
                      variante="texto"
                      tamanho="pequeno"
                      onClick={() => setConfirmando(false)}
                    >
                      Deixa
                    </Botao>
                  </div>
                )}
              </div>
            </>
          )}

          {erro && (
            <p
              role="alert"
              className="mt-3 rounded-[var(--raio-p)] border border-linha bg-alerta-fundo px-3.5 py-2.5 text-[13px]"
            >
              {erro}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function ContratoDoCliente({
  clienteId, servicos, aoMudar,
}: {
  clienteId: string;
  servicos: ServicoContratado[];
  aoMudar: () => Promise<void>;
}) {
  const [equipe, setEquipe] = useState<PessoaDaEquipe[]>([]);
  const [disponiveis, setDisponiveis] = useState<ServicoDisponivel[]>([]);
  const [novo, setNovo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState('');
  const [formato, setFormato] = useState('recorrente');
  const [form, setForm] = useState<Form>({
    apelido: '',
    valor: '', diaVencimento: '', parcelas: '', entregaEm: '',
    dataEvento: '', observacao: '', responsaveis: [],
  });

  useEffect(() => {
    void (async () => {
      // Falha aqui não pode derrubar a ficha: sem a equipe dá para editar
      // valor e prazo, só não dá para marcar quem cuida.
      try { setEquipe((await equipeEConvites()).pessoas.filter((p) => p.ativo)); } catch { /* */ }
      try { setDisponiveis(await servicosParaAdicionar(clienteId)); } catch { /* */ }
    })();
  }, [clienteId, servicos]);

  async function adicionar() {
    if (!escolhido) return;
    setOcupado(true);
    setErro(null);
    try {
      await adicionarServico(clienteId, {
        servico: escolhido,
        formato,
        inicio: new Date().toISOString().slice(0, 10),
        valorCentavos: paraCentavos(form.valor),
        diaVencimento: form.diaVencimento === '' ? null : Number(form.diaVencimento),
        parcelas: form.parcelas === '' ? null : Number(form.parcelas),
        entregaEm: form.entregaEm || null,
        dataEvento: form.dataEvento || null,
        observacao: form.observacao || null,
        apelido: form.apelido,
        responsaveis: form.responsaveis,
      });
      setNovo(false);
      setEscolhido('');
      setForm({
        apelido: '', valor: '', diaVencimento: '', parcelas: '', entregaEm: '',
        dataEvento: '', observacao: '', responsaveis: [],
      });
      await aoMudar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui adicionar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      {servicos.length > 0 && (
        <ul className="border-t border-linha-fraca">
          {servicos.map((s) => (
            <Linha key={s.id} s={s} equipe={equipe} aoMudar={aoMudar} />
          ))}
        </ul>
      )}

      <div className="mt-4">
        <Botao
          variante={servicos.length === 0 ? 'primario' : 'secundario'}
          tamanho="pequeno"
          onClick={() => setNovo((v) => !v)}
        >
          {novo ? 'Cancelar' : '+ Adicionar serviço'}
        </Botao>
      </div>

      {novo && (
        <div className="bloco mt-3 p-4 sm:p-5">
          {disponiveis.length === 0 ? (
            <p className="legenda">
              Este cliente já tem todos os serviços do catálogo contratados.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo id="c-servico" rotulo="Serviço">
                  <Escolha
                    id="c-servico"
                    value={escolhido}
                    onChange={(e) => setEscolhido(e.target.value)}
                  >
                    <option value="">escolha</option>
                    {disponiveis.map((d) => (
                      <option key={d.chave} value={d.chave}>{d.nome}</option>
                    ))}
                  </Escolha>
                </Campo>
                <Campo id="c-formato" rotulo="Como cobra">
                  <Escolha
                    id="c-formato"
                    value={formato}
                    onChange={(e) => setFormato(e.target.value)}
                  >
                    <option value="recorrente">Mensal</option>
                    <option value="pontual">Projeto</option>
                  </Escolha>
                </Campo>
              </div>

              <div className="mt-3">
                <Campos
                  form={form}
                  setForm={setForm}
                  equipe={equipe}
                  recorrente={formato === 'recorrente'}
                />
              </div>

              <Botao
                variante="primario"
                className="mt-4"
                disabled={ocupado || !escolhido}
                onClick={() => void adicionar()}
              >
                {ocupado ? 'Adicionando…' : 'Adicionar ao contrato'}
              </Botao>
            </>
          )}

          {erro && (
            <p
              role="alert"
              className="mt-3 rounded-[var(--raio-p)] border border-linha bg-alerta-fundo px-3.5 py-2.5 text-[13px]"
            >
              {erro}
            </p>
          )}
        </div>
      )}
    </>
  );
}
