import { useState } from 'react';
import { Botao } from '../componentes/Botao';
import { Logo } from '../componentes/Marca';
import { entrarComoExemplo } from '../dados/api';
import { useSessao } from '../sessao';

const CAMPO =
  'min-h-12 w-full rounded-[var(--raio-p)] border border-linha bg-superficie px-3.5 ' +
  'font-mono text-[14px] text-tinta backdrop-blur-xl focus:outline-none';

export function Entrar() {
  const { entrar, ligado, recarregar } = useSessao();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email, senha);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui entrar.');
    } finally {
      setEnviando(false);
    }
  }

  async function comoExemplo(persona: 'dono' | 'equipe' | 'cliente') {
    await entrarComoExemplo(persona);
    await recarregar();
  }

  return (
    <div className="grid min-h-dvh place-items-center px-5 py-10 text-tinta">
      <main className="bloco entra w-full max-w-[26rem] p-7 sm:p-9">
        <Logo altura={38} />
        <h1 className="titulao mt-7 text-[clamp(1.8rem,6vw,2.4rem)]">Entrar</h1>
        <p className="mt-2 text-tinta-2">Use o e-mail do seu convite.</p>

        <form onSubmit={(e) => void enviar(e)} className="mt-7 flex flex-col gap-4" noValidate>
          <label className="flex flex-col gap-2">
            <span className="rotulo-forte">E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className={CAMPO}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="rotulo-forte">Senha</span>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
              className={CAMPO}
            />
          </label>

          {erro && (
            <p
              role="alert"
              className="rounded-[var(--raio-p)] border border-linha bg-alerta-fundo px-3.5 py-2.5 text-[13px]"
            >
              {erro}
            </p>
          )}

          <Botao type="submit" variante="primario" disabled={enviando} className="mt-2 w-full">
            {enviando ? 'Entrando…' : 'Entrar'}
          </Botao>
        </form>

        <div className="mt-8 border-t border-linha-fraca pt-5">
          <p className="text-[12.5px] text-tinta-3">
            Primeiro acesso? Abra o link do convite para criar sua senha.
          </p>

          {!ligado && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="rotulo">modo exemplo</span>
              {/* Três personas, porque o que cada uma vê é diferente: a direção
                  vê o dinheiro, a operação não, o cliente vê só o dele. */}
              <button
                onClick={() => void comoExemplo('dono')}
                className="rotulo risca rounded-full hover:text-pink-texto"
              >
                entrar como direção
              </button>
              <button
                onClick={() => void comoExemplo('equipe')}
                className="rotulo risca rounded-full hover:text-pink-texto"
              >
                entrar como operação
              </button>
              <button
                onClick={() => void comoExemplo('cliente')}
                className="rotulo risca rounded-full hover:text-pink-texto"
              >
                entrar como cliente
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
