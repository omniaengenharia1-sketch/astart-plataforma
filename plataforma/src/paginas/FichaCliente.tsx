import { useCallback, useEffect, useState } from 'react';
import { NavLink, Link, useParams } from 'react-router-dom';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada, Escolha } from '../componentes/Campo';
import { LinksDeAprovacao } from '../componentes/LinksDeAprovacao';
import { Carregando, Falhou, Vazio } from '../componentes/Estado';
import {
  convidar, desativarCliente, fichaCliente, reativarCliente, removerCliente,
  tirarAcessoDoCliente,
} from '../dados/api';
import { souAdmin, veDinheiro } from '../permissao';
import { useSessao } from '../sessao';
import { diaMes, haQuanto, reais } from '../formato';
import { FORMATO, MODULO, PAPEL_CLIENTE, STATUS_SERVICO, TIPO_ITEM } from '../rotulos';
import { Ambientes } from './Ambientes';
import { Calendario } from './Calendario';
import { Campanhas } from './Campanhas';
import { ContaDoCliente } from './ContaDoCliente';
import { Contrato } from './Contrato';
import { FeedbackCliente } from './FeedbackCliente';
import { Galeria } from './Galeria';
import { Grid } from './Grid';
import { Projeto } from './Projeto';
import type {
  ChaveModulo, FichaCliente as Ficha, PapelCliente, ServicoContratado,
} from '../dados/tipos';

const PAPEIS_CLIENTE: { valor: PapelCliente; rotulo: string; explica: string }[] = [
  { valor: 'principal', rotulo: 'Contato principal', explica: 'aprova e fala pelo cliente' },
  { valor: 'financeiro', rotulo: 'Financeiro', explica: 'vê cobrança e contrato' },
  { valor: 'leitura', rotulo: 'Só leitura', explica: 'acompanha, não responde' },
];

/**
 * Como o contrato é lido numa linha: formato manda no que faz sentido mostrar.
 *
 * Nulo quando quem está lendo não cuida do dinheiro — e aí a linha mostra o
 * serviço, o responsável e o prazo, que é o que ela usa para trabalhar.
 */
function comoCobra(s: ServicoContratado): string | null {
  if (s.valorCentavos === null) return null;
  if (s.formato === 'recorrente') {
    return s.diaVencimento ? `${reais(s.valorCentavos)} · todo dia ${s.diaVencimento}` : reais(s.valorCentavos);
  }
  if (s.parcelas && s.parcelas > 1) {
    return `${reais(s.valorCentavos)} · ${s.parcelas}x`;
  }
  return `${reais(s.valorCentavos)} · à vista`;
}

export function FichaCliente() {
  const params = useParams();
  const clienteId = params['clienteId'] ?? '';
  // A aba ativa vem do resto da rota: /clientes/:id/<modulo>. Assim o cabecalho
  // e as abas continuam na tela enquanto a aba de dentro troca.
  const aba = (params['*'] ?? '').split('/')[0] ?? '';
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindoAcesso, setAbrindoAcesso] = useState(false);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [papelCliente, setPapelCliente] = useState<PapelCliente>('principal');
  const [enviando, setEnviando] = useState(false);
  const [erroAcesso, setErroAcesso] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<'ar' | 'apagar' | null>(null);
  /** O nome que a pessoa digita para liberar o apagar (0060). */
  const [nomeDigitado, setNomeDigitado] = useState('');
  const { sessao } = useSessao();
  const admin = souAdmin(sessao);
  const dinheiro = veDinheiro(sessao);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setFicha(await fichaCliente(clienteId));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui abrir este cliente.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function darAcesso() {
    if (enviando) return;
    setEnviando(true);
    setErroAcesso(null);
    setRecado(null);
    try {
      await convidar({
        destino: 'cliente',
        clienteId,
        email: email.trim(),
        nome: nome.trim(),
        papelCliente,
      });
      setRecado(`Convite enviado para ${email.trim()}.`);
      setNome('');
      setEmail('');
      setAbrindoAcesso(false);
      await carregar();
    } catch (x) {
      setErroAcesso(x instanceof Error ? x.message : 'Não consegui dar o acesso.');
    } finally {
      setEnviando(false);
    }
  }

  async function tirar(userId: string, emailDele: string) {
    setErroAcesso(null);
    try {
      await tirarAcessoDoCliente(userId, clienteId, emailDele);
      await carregar();
    } catch (x) {
      setErroAcesso(x instanceof Error ? x.message : 'Não consegui tirar o acesso.');
    }
  }

  /** Tirar do ar, devolver e apagar: as três do admin, com a mesma plumbing. */
  // `oQue` pode devolver a frase do recado quando ela só se sabe DEPOIS da
  // chamada — é o caso de apagar, que volta contando o que saiu junto.
  async function mexerNoCliente(oQue: () => Promise<void | string>, feito: string) {
    setErroAcesso(null);
    setRecado(null);
    try {
      const dito = await oQue();
      setRecado(typeof dito === 'string' ? dito : feito);
      setConfirmando(null);
      await carregar();
    } catch (x) {
      setErroAcesso(x instanceof Error ? x.message : 'Não deu certo.');
      setConfirmando(null);
    }
  }

  if (erro) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!ficha) return <Carregando oQue="o cliente" />;

  const ativos = ficha.servicos.filter((s) => s.status === 'ativo');

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="pt-9">
        <Link to="/clientes" className="rotulo hover:text-pink-texto">
          &lt; clientes
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="titulao text-[clamp(1.8rem,5vw,2.8rem)]">{ficha.cliente.nome}</h1>
            <div className="rotulo mt-1.5">
              {ficha.cliente.slug} · {ficha.cliente.fusoHorario}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!ficha.cliente.ativo && <Marca forte>fora do ar</Marca>}
            {admin && ficha.cliente.ativo && (
              <Botao
                variante="texto"
                tamanho="pequeno"
                onClick={() => setConfirmando(confirmando === 'ar' ? null : 'ar')}
              >
                Tirar do ar
              </Botao>
            )}
            {admin && !ficha.cliente.ativo && (
              <>
                <Botao
                  tamanho="pequeno"
                  onClick={() =>
                    void mexerNoCliente(
                      () => reativarCliente(clienteId),
                      `${ficha.cliente.nome} voltou. O contrato continua encerrado.`,
                    )
                  }
                >
                  Devolver
                </Botao>
                <Botao
                  variante="texto"
                  tamanho="pequeno"
                  onClick={() => setConfirmando(confirmando === 'apagar' ? null : 'apagar')}
                >
                  Apagar
                </Botao>
              </>
            )}
          </div>
        </div>

        {/* Duas ações que doem: confirmar é no lugar, dizendo o que acontece —
            não num "tem certeza?" que ninguém lê. */}
        {confirmando === 'ar' && (
          <div className="bloco mt-4 max-w-xl p-4">
            <p className="text-[14.5px] font-medium">
              O contrato encerra e o portal de {ficha.cliente.nome} fecha. O histórico fica.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Botao
                variante="primario"
                tamanho="pequeno"
                onClick={() =>
                  void mexerNoCliente(
                    () => desativarCliente(clienteId),
                    `${ficha.cliente.nome} saiu do ar.`,
                  )
                }
              >
                Tirar do ar
              </Botao>
              <Botao tamanho="pequeno" onClick={() => setConfirmando(null)}>
                Deixar como está
              </Botao>
            </div>
          </div>
        )}
        {confirmando === 'apagar' && (
          <div className="bloco brilho-p mt-4 max-w-xl bg-alerta-fundo p-4">
            <p className="text-[14.5px] font-medium">
              Apagar some com {ficha.cliente.nome} <strong>e com tudo que está nele</strong>:
              publicações, aprovações, lançamentos, galerias e os arquivos no servidor. Não
              tem volta.
            </p>
            {/* O nome digitado, e não um clique. Até a 0060 isto recusava
                cliente com histórico, então o clique só apagava cadastro
                vazio. Agora ele apaga anos de cliente — a confirmação sobe
                junto com a consequência. */}
            <p className="rotulo mt-3 normal-case">
              digite <strong>{ficha.cliente.nome}</strong> para liberar
            </p>
            <Entrada
              aria-label="Digite o nome do cliente para confirmar"
              placeholder={ficha.cliente.nome}
              value={nomeDigitado}
              onChange={(e) => setNomeDigitado(e.target.value)}
              className="mt-2 max-w-sm"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Botao
                variante="primario"
                tamanho="pequeno"
                disabled={nomeDigitado.trim() !== ficha.cliente.nome.trim()}
                onClick={() =>
                  void mexerNoCliente(async () => {
                    const r = await removerCliente(clienteId);
                    // O que saiu, com número: "apagado" sem contagem não dá
                    // para conferir, e isto não tem desfazer.
                    return (
                      `${r.nome} foi apagado: ${r.publicacoes} publicações, ${r.aprovacoes} aprovações, ` +
                      `${r.lancamentos} lançamentos, ${r.captacoes} captações · ` +
                      `${r.arquivosApagados} arquivos saíram do servidor.`
                    );
                  }, 'Cliente apagado.')
                }
              >
                Apagar
              </Botao>
              <Botao tamanho="pequeno" onClick={() => setConfirmando(null)}>
                Cancelar
              </Botao>
            </div>
          </div>
        )}
      </div>

      {/* As abas são os módulos que o contrato dele liga. Módulo não contratado
          não aparece desabilitado: não existe. */}
      <nav
        aria-label="Seções do cliente"
        className="mt-6 flex gap-2 overflow-x-auto border-y border-linha-fraca py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <NavLink
          to={`/clientes/${clienteId}`}
          end
          className={({ isActive }) =>
            'shrink-0 px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.16em] uppercase ' +
            (isActive ? 'bg-tinta text-papel' : 'text-tinta-3 hover:bg-superficie-2 hover:text-tinta')
          }
        >
          Visão geral
        </NavLink>
        {ficha.modulos
          .filter((m) => m !== 'financeiro' || dinheiro)
          .map((m) => (
          <NavLink
            key={m}
            to={`/clientes/${clienteId}/${m}`}
            className={({ isActive }) =>
              'shrink-0 px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.16em] uppercase whitespace-nowrap ' +
              (isActive ? 'bg-tinta text-papel' : 'text-tinta-3 hover:bg-superficie-2 hover:text-tinta')
            }
          >
            {MODULO[m]}
          </NavLink>
        ))}
      </nav>

      {aba === 'entregaveis' || aba === 'marcos' ? (
        <Projeto clienteId={clienteId} equipe />
      ) : aba === 'calendario' || aba === 'publicacao' ? (
        <Calendario clienteId={clienteId} equipe />
      ) : aba === 'galeria' || aba === 'acervo' ? (
        <Galeria clienteId={clienteId} equipe />
      ) : aba === 'grid' ? (
        <Grid clienteId={clienteId} equipe />
      ) : aba === 'campanhas' ? (
        <Campanhas clienteId={clienteId} equipe />
      ) : aba === 'ambientes' || aba === 'manutencao' ? (
        <Ambientes clienteId={clienteId} equipe />
      ) : aba === 'financeiro' ? (
        <ContaDoCliente clienteId={clienteId} equipe />
      ) : aba === 'contrato' ? (
        <Contrato clienteId={clienteId} equipe />
      ) : aba === 'nps' ? (
        <FeedbackCliente clienteId={clienteId} equipe />
      ) : aba !== '' ? (
        <Vazio
          titulo={MODULO[aba as ChaveModulo] ?? 'Seção'}
          explica="Em breve."
        />
      ) : (
      <>
      <div
        className={
          'escada mt-7 grid grid-cols-2 gap-4 ' +
          (ficha.mensalCentavos === null ? 'xl:grid-cols-2' : 'xl:grid-cols-4')
        }
      >
        <Bloco rotulo="Serviços ativos" destaque={String(ativos.length)} />
        {/* Os dois do dinheiro só existem para quem cuida dele. */}
        {ficha.mensalCentavos !== null && (
          <Bloco rotulo="Por mês" destaque={reais(ficha.mensalCentavos)} />
        )}
        {ficha.unicoCentavos !== null && (
          <Bloco rotulo="Em projeto" destaque={reais(ficha.unicoCentavos)} />
        )}
        <Bloco
          rotulo="Precisa de você"
          destaque={String(ficha.pendencias.length)}
          alerta={ficha.pendencias.length > 0}
          sombra={ficha.pendencias.length > 0}
        />
      </div>

      <div className="mt-9 grid items-start gap-9 lg:grid-cols-[1fr_340px]">
        <div>
          <Fita>Contrato</Fita>
          {ficha.servicos.length === 0 ? (
            <Vazio titulo="Sem contrato." explica="Adicione um serviço para liberar as abas." />
          ) : (
            <ul className="border-t border-linha-fraca">
              {ficha.servicos.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-3 py-3.5"
                >
                  <span className="w-44 shrink-0 font-bold uppercase">{s.servicoNome}</span>
                  <Marca>{FORMATO[s.formato]}</Marca>
                  {s.status !== 'ativo' && <Marca forte>{STATUS_SERVICO[s.status]}</Marca>}
                  <span className="numeros min-w-48 flex-1 text-[13px]">{comoCobra(s) ?? ''}</span>
                  <span className="rotulo w-28 shrink-0">{s.responsavelNome ?? 'sem responsável'}</span>
                  {s.entregaEm && <span className="rotulo w-24 shrink-0">entrega {diaMes(s.entregaEm)}</span>}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-9" />
          <Fita>Precisa de você</Fita>
          {ficha.pendencias.length === 0 ? (
            <p className="py-4 text-tinta-3">Nada voltou com ajuste.</p>
          ) : (
            <ul className="border-t border-linha-fraca">
              {ficha.pendencias.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-l-2 border-linha-fraca border-l-pink px-3 py-3.5"
                >
                  <Marca>{TIPO_ITEM[p.tipo]}</Marca>
                  <span className="min-w-48 flex-1 font-medium">{p.titulo}</span>
                  <span className="rotulo">{haQuanto(p.quando)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-9" />
          <LinksDeAprovacao clienteId={clienteId} />

          <div className="mt-9" />
          <Fita>O que já andou</Fita>
          {ficha.movimentos.length === 0 ? (
            <p className="py-4 text-tinta-3">Nada ainda.</p>
          ) : (
            <ul>
              {ficha.movimentos.map((m, i) => (
                <li
                  key={`${m.quando}-${i}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-linha-fraca py-3"
                >
                  <span className="rotulo w-24 shrink-0">{haQuanto(m.quando)}</span>
                  <span className="flex-1">{m.oQue}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside aria-label="Contatos e módulos do cliente">
          <Fita
            acao={
              <Botao tamanho="pequeno" onClick={() => setAbrindoAcesso((v) => !v)}>
                {abrindoAcesso ? 'Fechar' : 'Dar acesso'}
              </Botao>
            }
          >
            Quem responde
          </Fita>

          {abrindoAcesso && (
            <div className="bloco mt-3 p-3">
              <p className="rotulo normal-case">ele recebe um e-mail para criar a senha.</p>
              <div className="mt-3 grid gap-3">
                <Campo id="ac-nome" rotulo="Nome">
                  <Entrada id="ac-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
                </Campo>
                <Campo id="ac-email" rotulo="E-mail">
                  <Entrada
                    id="ac-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Campo>
                <Campo
                  id="ac-papel"
                  rotulo="Pode o quê"
                  dica={PAPEIS_CLIENTE.find((p) => p.valor === papelCliente)?.explica}
                >
                  <Escolha
                    id="ac-papel"
                    value={papelCliente}
                    onChange={(e) => setPapelCliente(e.target.value as PapelCliente)}
                  >
                    {PAPEIS_CLIENTE.map((p) => (
                      <option key={p.valor} value={p.valor}>
                        {p.rotulo}
                      </option>
                    ))}
                  </Escolha>
                </Campo>
                <Botao
                  variante="primario"
                  disabled={enviando || !email.trim()}
                  onClick={() => void darAcesso()}
                >
                  {enviando ? 'Enviando…' : 'Enviar convite'}
                </Botao>
              </div>
            </div>
          )}

          {recado && (
            <p role="status" className="rotulo-forte mt-3">
              {recado}
            </p>
          )}
          {erroAcesso && (
            <div role="alert" className="bloco mt-3 bg-alerta-fundo p-3.5">
              <span className="rotulo-forte text-pink-texto">não deu certo</span>
              <p className="mt-1 text-[13.5px] font-medium">{erroAcesso}</p>
            </div>
          )}

          {ficha.contatos.length === 0 ? (
            <p className="py-4 text-tinta-3">Ninguém com acesso ainda.</p>
          ) : (
            <ul>
              {ficha.contatos.map((c) => (
                <li key={c.email} className="border-b border-linha-fraca py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold uppercase">{c.nome}</span>
                    {!c.ativo && <Marca>sem acesso</Marca>}
                  </div>
                  <div className="mt-0.5 font-mono text-[11.5px] break-all text-tinta-2">{c.email}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="rotulo">{PAPEL_CLIENTE[c.papel]}</span>
                    {c.ativo && (
                      <Botao
                        variante="texto"
                        tamanho="pequeno"
                        onClick={() => void tirar(c.userId, c.email)}
                      >
                        Tirar
                      </Botao>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-8" />
          <Fita>Abas liberadas</Fita>
          <div className="flex flex-wrap gap-1.5 pt-3">
            {ficha.modulos.map((m) => (
              <Marca key={m}>{MODULO[m]}</Marca>
            ))}
          </div>

        </aside>
      </div>
      </>
      )}
    </div>
  );
}
