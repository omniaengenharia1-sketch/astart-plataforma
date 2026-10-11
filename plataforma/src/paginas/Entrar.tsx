import { useState } from 'react';
import { Botao } from '../componentes/Botao';
import { entrarComoExemplo } from '../dados/api';
import { useSessao } from '../sessao';

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

  async function comoExemplo(persona: 'equipe' | 'cliente') {
    await entrarComoExemplo(persona);
    await recarregar();
  }

  return (
    <div className="grid min-h-dvh bg-papel text-tinta lg:grid-cols-2">
      <aside className="flex flex-col justify-between gap-10 border-b border-linha bg-superficie-2 px-6 py-6 sm:px-10 lg:border-r lg:border-b-0 lg:py-12">
        <div>
          <div className="font-display text-3xl font-semibold tracking-tight">Astart</div>
          <div className="rotulo mt-1">Plataforma</div>
        </div>
        <div className="hidden flex-1 items-center justify-center border border-dashed border-linha-forte lg:flex">
          <span className="rotulo">imagem de marca</span>
        </div>
        <div className="rotulo">astartstudio.com.br</div>
      </aside>

      <section className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Entrar</h1>
          <p className="mt-2 text-tinta-2">Equipe e clientes, mesmo acesso.</p>

          <form onSubmit={(e) => void enviar(e)} className="mt-8 flex flex-col gap-4" noValidate>
            <label className="flex flex-col gap-1.5">
              <span className="rotulo">E-mail</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className="min-h-11 border border-linha-forte bg-superficie px-3 text-tinta focus:border-pink focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="rotulo">Senha</span>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
                required
                className="min-h-11 border border-linha-forte bg-superficie px-3 text-tinta focus:border-pink focus:outline-none"
              />
            </label>

            {erro && (
              <p role="alert" className="border border-falha bg-falha-suave px-3 py-2 text-[12.5px] text-falha">
                {erro}
              </p>
            )}

            <Botao type="submit" variante="primario" disabled={enviando} className="mt-2 w-full min-h-11">
              {enviando ? 'Entrando…' : 'Entrar'}
            </Botao>
          </form>

          <div className="mt-10 border-t border-linha pt-4">
            <p className="text-[12px] text-tinta-3">
              Primeiro acesso? Use o link do convite e crie sua senha aqui mesmo.
            </p>

            {!ligado && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="rotulo">modo exemplo</span>
                <button onClick={() => void comoExemplo('equipe')} className="rotulo underline underline-offset-4 hover:text-pink-tinta">
                  entrar como equipe
                </button>
                <button onClick={() => void comoExemplo('cliente')} className="rotulo underline underline-offset-4 hover:text-pink-tinta">
                  entrar como cliente
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
