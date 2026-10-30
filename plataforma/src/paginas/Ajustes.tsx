import { useCallback, useEffect, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada, Escolha } from '../componentes/Campo';
import { Carregando, Falhou } from '../componentes/Estado';
import {
  apagarArquivosOrfaos, arquivosOrfaos,
  conectores, conferirTokenDaMeta, convidar, equipeEConvites, FalhaDaMeta, mudarAcesso, mudarPapel,
  revogarConvite,
} from '../dados/api';
import { haQuanto } from '../formato';
import { PainelSaudeDoToken } from '../componentes/SaudeDoTokenMeta';
import type {
  ChaveDeConector, Conector, EquipeEConvites, PapelEquipe, SaudeDoToken,
} from '../dados/tipos';

const PAPEIS: { valor: PapelEquipe; rotulo: string; explica: string }[] = [
  { valor: 'admin', rotulo: 'Direção', explica: 'vê tudo, convida gente, mexe no contrato' },
  { valor: 'operacao', rotulo: 'Operação', explica: 'produz, envia e responde cliente' },
  { valor: 'financeiro', rotulo: 'Financeiro', explica: 'vê e mexe no dinheiro' },
  { valor: 'leitura', rotulo: 'Só leitura', explica: 'olha, não muda nada' },
];

const NOME_PAPEL: Record<PapelEquipe, string> = {
  admin: 'direção',
  operacao: 'operação',
  financeiro: 'financeiro',
  leitura: 'só leitura',
};

/**
 * Chave nenhuma passa pelo navegador — nem para cadastrar.
 *
 * A tela mostra o ESTADO e o comando que a pessoa cola no SQL Editor. Um campo
 * aqui que aceitasse o token faria o segredo atravessar o navegador, o bundle e
 * a rede para chegar ao mesmo lugar onde ele já podia ser escrito direto. Seria
 * conveniência paga com a única regra que não se negocia neste projeto.
 */
/** "há 11 h", "há 3 dias" — a data só vira argumento quando é um intervalo. */
function desdeQuando(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} dias`;
}

function comandoParaCadastrar(chave: ChaveDeConector): string {
  if (chave.onde === 'funcao') {
    return `Settings › Edge Functions › Secrets  →  ${chave.chave}`;
  }

  // Chave que JÁ EXISTE se troca com `update_secret`, não com `create_secret`:
  // o nome é único no Vault, e um segundo `create_secret` falha. Esta tela
  // mostrava `create_secret` sempre — e só quando a chave faltava, então quem
  // precisava TROCAR um token vencido não via comando nenhum.
  //
  // E o marcador NÃO usa < > — usa COLE_O_TOKEN_AQUI. O `'<valor novo>'` que
  // estava aqui custou duas horas de diagnóstico errado: o token foi gravado
  // como `<TOKEN>`, com os sinais dentro, a Meta recusou com o mesmo código de
  // token expirado, e eu fui atrás de validade. `<algo>` é convenção de
  // documentação técnica, e esta tela não é lida por quem escreve SQL.
  //
  // Se o marcador ficar esquecido, o tamanho e o `comecaComEAA` da 0050
  // denunciam na hora — ao contrário dos sinais, que passavam por token.
  if (chave.presente === true) {
    return `select vault.update_secret((select id from vault.secrets where name = '${chave.chave}'), 'COLE_O_VALOR_AQUI');`;
  }
  return `select vault.create_secret('COLE_O_VALOR_AQUI', '${chave.chave}');`;
}


const peso = (bytes: number): string => {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1).replace('.', ',')} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
};

/**
 * Arquivos sem dono — a faxina do balde (0062).
 *
 * Por que existe: apagar galeria apaga as linhas e manda o navegador tirar os
 * arquivos do balde. Quando um lote falha, os arquivos ficam. Isso era
 * engolido em silêncio, e 175 MB — 60% do balde — se acumularam de uma galeria
 * apagada em 28/10 sem ninguém saber.
 *
 * Fica aqui, e não na tela da galeria, porque é manutenção do servidor e não
 * do trabalho: pergunta do balde inteiro, não de uma entrega.
 *
 * Carrega sob demanda, com um botão, em vez de ao abrir a tela: é uma varredura
 * de todos os arquivos de todos os clientes, e ninguém precisa dela toda vez
 * que entra em Ajustes.
 */
function ArquivosSemDono() {
  const [achado, setAchado] = useState<{ arquivos: number; bytes: number; caminhos: string[] } | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  async function procurar() {
    setErro(null);
    setRecado(null);
    setConfirmando(false);
    setProcurando(true);
    try {
      setAchado(await arquivosOrfaos(60));
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui procurar.');
    } finally {
      setProcurando(false);
    }
  }

  async function apagar() {
    if (!achado) return;
    setErro(null);
    setApagando(true);
    try {
      const r = await apagarArquivosOrfaos(achado.caminhos);
      setRecado(
        `${r.apagados} ${r.apagados === 1 ? 'arquivo saiu' : 'arquivos saíram'} do servidor.` +
          (r.ficaram > 0 ? ` ${r.ficaram} não saiu — tente de novo em alguns minutos.` : ''),
      );
      setConfirmando(false);
      await procurar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui apagar.');
    } finally {
      setApagando(false);
    }
  }

  return (
    <section className="bloco p-4 sm:p-5">
      <Fita>Arquivos sem dono</Fita>
      <p className="rotulo mt-2 normal-case">
        Foto que ficou no servidor depois que a galeria foi apagada. Ocupa espaço e
        não aparece para ninguém.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Botao tamanho="pequeno" disabled={procurando} onClick={() => void procurar()}>
          {procurando ? 'Procurando…' : 'Procurar'}
        </Botao>
        {achado && (
          <span className="rotulo normal-case">
            {achado.arquivos === 0
              ? 'Nada sobrando — o servidor está limpo.'
              : `${achado.arquivos} ${achado.arquivos === 1 ? 'arquivo' : 'arquivos'} · ${peso(achado.bytes)}`}
          </span>
        )}
      </div>

      {achado && achado.arquivos > 0 && (
        <div className="mt-4">
          {/* Só conta o que está parado há mais de uma hora. Durante um upload o
              arquivo chega ao servidor ANTES da linha no banco, e nessa janela
              ele é idêntico a um arquivo sem dono — apagar ali seria apagar
              foto de cliente no meio da subida. */}
          <p className="rotulo normal-case text-tinta-3">
            Fotos que você está subindo agora não entram nesta conta.
          </p>
          {!confirmando ? (
            <Botao tamanho="pequeno" className="mt-3 text-pink-texto" onClick={() => setConfirmando(true)}>
              Apagar do servidor
            </Botao>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="rotulo normal-case">Apagar não tem volta.</span>
              <Botao tamanho="pequeno" variante="primario" disabled={apagando} onClick={() => void apagar()}>
                {apagando ? 'Apagando…' : `Apagar ${achado.arquivos}`}
              </Botao>
              <Botao tamanho="pequeno" variante="texto" onClick={() => setConfirmando(false)}>
                Cancelar
              </Botao>
            </div>
          )}
        </div>
      )}

      {recado && <p className="mt-3 text-[14px] text-tinta-2">{recado}</p>}
      {erro && <p className="mt-3 text-[14px] text-pink-texto">{erro}</p>}
    </section>
  );
}

export function Ajustes() {
  const [dados, setDados] = useState<EquipeEConvites | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ligacoes, setLigacoes] = useState<Conector[] | null>(null);

  const [abrindo, setAbrindo] = useState(false);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [cargo, setCargo] = useState('');
  const [papel, setPapel] = useState<PapelEquipe>('operacao');
  const [enviando, setEnviando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  // A saúde do token da Meta (0048). Separada do estado das chaves de
  // propósito: aquilo é cadastro, isto é funcionamento.
  const [saude, setSaude] = useState<SaudeDoToken | null>(null);
  const [erroSaude, setErroSaude] = useState<string | null>(null);
  const [conferindo, setConferindo] = useState(false);

  async function conferirToken() {
    setErroSaude(null);
    setConferindo(true);
    try {
      setSaude(await conferirTokenDaMeta());
    } catch (x) {
      setErroSaude(x instanceof Error ? x.message : 'Não consegui conferir o token.');
      if (x instanceof FalhaDaMeta) setSaude(x.saude);
    } finally {
      setConferindo(false);
    }
  }

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await equipeEConvites());
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui carregar a equipe.');
    }
    // As integrações vêm numa tentativa própria: se o mapa das chaves falhar,
    // a tela de equipe continua funcionando. Uma falha não derruba a outra.
    try {
      setLigacoes(await conectores());
    } catch {
      setLigacoes(null);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function enviarConvite() {
    if (enviando) return;
    setEnviando(true);
    setErroForm(null);
    setRecado(null);
    try {
      await convidar({ destino: 'equipe', email: email.trim(), nome: nome.trim(), papel, cargo: cargo.trim() });
      setRecado(`Convite enviado para ${email.trim()}.`);
      setNome('');
      setEmail('');
      setCargo('');
      setAbrindo(false);
      await carregar();
    } catch (x) {
      setErroForm(x instanceof Error ? x.message : 'Não consegui convidar.');
    } finally {
      setEnviando(false);
    }
  }

  async function acao(fn: () => Promise<void>) {
    setErro(null);
    try {
      await fn();
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui fazer isso.');
    }
  }

  if (erro && !dados) return <Falhou mensagem={erro} tentar={() => void carregar()} />;
  if (!dados) return <Carregando oQue="a equipe" />;

  const ativos = dados.pessoas.filter((p) => p.ativo);

  return (
    <div className="px-5 pb-16 sm:px-8 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-9">
        <div>
          <div className="rotulo">acessos</div>
          <h1 className="titulao mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">Equipe</h1>
        </div>
        {dados.souAdmin && (
          <Botao variante="primario" onClick={() => setAbrindo((v) => !v)}>
            {abrindo ? 'Fechar' : 'Convidar pessoa'}
          </Botao>
        )}
      </div>

      <div className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Bloco rotulo="Na equipe" destaque={String(ativos.length)} />
        <Bloco rotulo="Convite aberto" destaque={String(dados.convites.length)} />
        <Bloco rotulo="Sem acesso" destaque={String(dados.pessoas.length - ativos.length)} />
        <Bloco rotulo="Direção" destaque={String(ativos.filter((p) => p.papel === 'admin').length)} />
      </div>

      {abrindo && dados.souAdmin && (
        <div className="bloco mt-7 p-4 sm:p-5">
          <div className="rotulo-forte">convidar para a equipe</div>
          <p className="rotulo mt-1.5 normal-case">
            ela recebe um e-mail para criar a senha.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Campo id="conv-nome" rotulo="Nome">
              <Entrada id="conv-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </Campo>
            <Campo id="conv-email" rotulo="E-mail">
              <Entrada
                id="conv-email"
                type="email"
                value={email}
                placeholder="nome@astartstudio.com.br"
                onChange={(e) => setEmail(e.target.value)}
              />
            </Campo>
            <Campo id="conv-cargo" rotulo="Cargo">
              <Entrada id="conv-cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} />
            </Campo>
            <Campo
              id="conv-papel"
              rotulo="Pode o quê"
              dica={PAPEIS.find((p) => p.valor === papel)?.explica}
            >
              <Escolha
                id="conv-papel"
                value={papel}
                onChange={(e) => setPapel(e.target.value as PapelEquipe)}
              >
                {PAPEIS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.rotulo}
                  </option>
                ))}
              </Escolha>
            </Campo>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Botao
              variante="primario"
              disabled={enviando || !email.trim()}
              onClick={() => void enviarConvite()}
            >
              {enviando ? 'Enviando…' : 'Enviar convite'}
            </Botao>
            <Botao variante="texto" disabled={enviando} onClick={() => setAbrindo(false)}>
              Cancelar
            </Botao>
          </div>
          {erroForm && (
            <div role="alert" className="bloco mt-4 bg-alerta-fundo p-3.5">
              <span className="rotulo-forte text-pink-texto">não deu certo</span>
              <p className="mt-1 text-[13.5px] font-medium">{erroForm}</p>
            </div>
          )}
        </div>
      )}

      {recado && (
        <p role="status" className="rotulo-forte mt-6">
          {recado}
        </p>
      )}
      {erro && dados && <Falhou mensagem={erro} />}

      {dados.convites.length > 0 && (
        <section className="mt-9">
          <Fita>Convite aberto</Fita>
          <ul className="border-t border-linha-fraca">
            {dados.convites.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-3 py-3"
              >
                <span className="w-44 shrink-0 font-bold uppercase">{c.nome ?? '—'}</span>
                <span className="min-w-48 flex-1 font-mono text-[12.5px] break-all">{c.email}</span>
                <Marca>
                  {c.destino === 'equipe'
                    ? NOME_PAPEL[c.papel ?? 'leitura']
                    : `cliente · ${c.clienteNome ?? ''}`}
                </Marca>
                <span className="rotulo w-24 shrink-0">{haQuanto(c.criadoEm)}</span>
                {dados.souAdmin && (
                  <Botao
                    tamanho="pequeno"
                    onClick={() => void acao(() => revogarConvite(c.id))}
                  >
                    Cancelar
                  </Botao>
                )}
              </li>
            ))}
          </ul>
          <p className="rotulo mt-2 normal-case">o convite não vence.</p>
        </section>
      )}

      <section className="mt-9">
        <Fita>Quem tem acesso</Fita>
        <ul className="border-t border-linha-fraca">
          {dados.pessoas.map((p) => (
            <li
              key={p.userId}
              className={
                'flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha-fraca px-3 py-3 ' +
                (p.ativo ? '' : 'text-tinta-3')
              }
            >
              <span className="w-44 shrink-0 font-bold uppercase">{p.nome ?? '—'}</span>
              <span className="min-w-44 flex-1 font-mono text-[12.5px] break-all">
                {p.email ?? 'sem e-mail'}
              </span>
              {dados.souAdmin && p.ativo ? (
                // O papel e o que decide o que a pessoa ve — inclusive o
                // dinheiro. Trocar e aqui, numa linha, nao num novo convite.
                <label className="shrink-0">
                  <span className="sr-only">Papel de {p.nome ?? p.email}</span>
                  <Escolha
                    value={p.papel}
                    onChange={(e) =>
                      void acao(() => mudarPapel(p.userId, e.target.value as PapelEquipe))
                    }
                    className="min-h-9 w-40 py-0"
                  >
                    {PAPEIS.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </option>
                    ))}
                  </Escolha>
                </label>
              ) : (
                <Marca>{NOME_PAPEL[p.papel]}</Marca>
              )}
              {p.cargo && <span className="rotulo w-28 shrink-0">{p.cargo}</span>}
              {p.ativo ? (
                dados.souAdmin && (
                  <Botao
                    tamanho="pequeno"
                    onClick={() => void acao(() => mudarAcesso(p.userId, false))}
                  >
                    Tirar acesso
                  </Botao>
                )
              ) : (
                <>
                  <Marca forte>sem acesso</Marca>
                  {dados.souAdmin && (
                    <Botao
                      tamanho="pequeno"
                      onClick={() => void acao(() => mudarAcesso(p.userId, true))}
                    >
                      Devolver
                    </Botao>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="rotulo mt-2 normal-case">
          tirar o acesso não apaga o histórico.
          {dados.souAdmin && ' direção e financeiro veem o dinheiro da agência.'}
        </p>
      </section>

      {ligacoes && ligacoes.length > 0 && (
        <section className="mt-10">
          <div className="rotulo">integrações</div>
          <h2 className="titulao mt-1 text-[clamp(1.3rem,3.6vw,1.7rem)]">O que está ligado</h2>
          <p className="rotulo mt-1.5 normal-case">
            chave nenhuma passa por esta tela. aqui você vê o estado e o comando para cadastrar.
          </p>

          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            {ligacoes.map((c) => {
              const faltam = c.faltando.length;
              const pronta = c.construida && faltam === 0;
              return (
                <article key={c.id} className="bloco p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold uppercase">{c.nome}</div>
                      <p className="rotulo mt-1 normal-case">{c.paraQue}</p>
                    </div>
                    {!c.construida ? (
                      <Marca>em construção</Marca>
                    ) : pronta ? (
                      <Marca forte>pronta</Marca>
                    ) : (
                      <Marca forte>faltam {faltam}</Marca>
                    )}
                  </div>

                  {!c.construida && (
                    // A distinção que evita uma tarde perdida: aqui o que falta
                    // é código, não chave. Sem dizer isso, a pessoa vai buscar
                    // uma chave que não tem onde entrar.
                    <p className="mt-3 text-[13px] text-tinta-2">
                      O código desta integração ainda não existe — só o lugar dela no banco.
                      Cadastrar a chave agora deixaria segredo parado, sem nada usando.
                    </p>
                  )}

                  {c.agendador && (
                    <p className="mt-3 text-[13px] text-tinta-2">
                      Agendador:{' '}
                      {c.agendador.publicar ? 'publicando' : 'desligado'} ·{' '}
                      {c.agendador.renovar ? 'renovando token' : 'renovação desligada'}
                      {!c.agendador.publicar && faltam === 0 && (
                        <>
                          {' '}— falta rodar <code className="font-mono">select public.agendar_tick();</code>
                        </>
                      )}
                    </p>
                  )}

                  {c.id === 'meta' && (
                    // "Cadastrada" não quer dizer "funciona". O ● abaixo só
                    // conta que existe uma chave com aquele nome no Vault;
                    // quem responde se ela serve é a Meta, e é o que este
                    // botão pergunta.
                    <div className="mt-3 border-t border-linha-fraca pt-3">
                      <Botao
                        variante="texto"
                        tamanho="pequeno"
                        disabled={conferindo}
                        onClick={() => void conferirToken()}
                      >
                        {conferindo ? 'Perguntando à Meta…' : 'Conferir se o token funciona'}
                      </Botao>
                      {erroSaude && (
                        <p
                          role="alert"
                          className="mt-2 rounded-[var(--raio-p)] border border-linha bg-alerta-fundo px-3 py-2 text-[12.5px]"
                        >
                          {erroSaude}
                        </p>
                      )}
                      {saude && <PainelSaudeDoToken saude={saude} />}
                    </div>
                  )}

                  <ul className="mt-4 flex flex-col gap-2.5 border-t border-linha-fraca pt-3">
                    {c.chaves.map((k) => (
                      <li key={k.chave} className="text-[13px]">
                        <div className="flex items-center gap-2">
                          <span aria-hidden="true" className="shrink-0">
                            {k.presente === true ? '●' : k.presente === false ? '○' : '—'}
                          </span>
                          <span className="font-mono break-all">{k.chave}</span>
                          {!k.obrigatoria && <span className="rotulo">opcional</span>}
                          {/* Desde quando. Chave cadastrada hoje e ja recusada
                              pela Meta diz o que o ● sozinho nao diz. */}
                          {k.atualizadaEm && (
                            <span className="rotulo">desde {desdeQuando(k.atualizadaEm)}</span>
                          )}
                        </div>
                        <p className="rotulo mt-0.5 ml-5 normal-case">{k.paraQue}</p>
                        {/* O comando aparece TAMBÉM com a chave cadastrada: a
                            operação mais comum depois do primeiro dia não é
                            cadastrar, é trocar — token vence, segredo roda. */}
                        <p className="ml-5 mt-1 font-mono text-[11.5px] text-tinta-3 break-all">
                          {comandoParaCadastrar(k)}
                        </p>
                      </li>
                    ))}
                  </ul>

                  <p className="rotulo mt-3 normal-case">
                    ● cadastrada · ○ falta · — vive na função, não dá para conferir daqui
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <ArquivosSemDono />
    </div>
  );
}
