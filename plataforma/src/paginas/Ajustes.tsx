import { useCallback, useEffect, useState } from 'react';
import { Bloco, Fita, Marca } from '../componentes/Bloco';
import { Botao } from '../componentes/Botao';
import { Campo, Entrada, Escolha } from '../componentes/Campo';
import { Carregando, Falhou } from '../componentes/Estado';
import {
  convidar, equipeEConvites, mudarAcesso, mudarPapel, revogarConvite,
} from '../dados/api';
import { haQuanto } from '../formato';
import type { EquipeEConvites, PapelEquipe } from '../dados/tipos';

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

export function Ajustes() {
  const [dados, setDados] = useState<EquipeEConvites | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [abrindo, setAbrindo] = useState(false);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [cargo, setCargo] = useState('');
  const [papel, setPapel] = useState<PapelEquipe>('operacao');
  const [enviando, setEnviando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await equipeEConvites());
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui carregar a equipe.');
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
    </div>
  );
}
