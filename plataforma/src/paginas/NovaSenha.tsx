import { useEffect, useState } from 'react';
import { Botao } from '../componentes/Botao';
import { Logo } from '../componentes/Marca';
import { definirSenha, motivoDoLink, pedirLinkDeSenha } from '../dados/api';
import type { MotivoDoLink } from '../dados/api';

const CAMPO =
  'min-h-12 w-full rounded-[var(--raio-p)] border border-linha bg-superficie px-3.5 ' +
  'font-mono text-[14px] text-tinta backdrop-blur-xl focus:outline-none';

/** Curta demais é o erro mais comum, e o Supabase recusa com texto em inglês. */
const MINIMO = 8;

const TITULO: Record<MotivoDoLink, string> = {
  convite: 'Crie sua senha',
  recuperacao: 'Escolha uma senha nova',
  trocar: 'Trocar senha',
  expirado: 'Este link não serve mais',
  semLink: 'Este endereço precisa de um link',
};

const EXPLICA: Record<MotivoDoLink, string> = {
  convite: 'É o seu primeiro acesso. Depois de salvar, é com ela que você entra.',
  recuperacao: 'Você pediu para recuperar o acesso. A senha antiga deixa de valer agora.',
  trocar: 'A senha antiga deixa de valer assim que você salvar.',
  expirado: 'Links de senha valem por pouco tempo, e esse já passou. Peça outro aqui.',
  semLink: 'Para criar uma senha é preciso abrir o link que chegou no seu e-mail. Peça um aqui.',
};

export function NovaSenha() {
  const [motivo, setMotivo] = useState<MotivoDoLink | null>(null);
  const [senha, setSenha] = useState('');
  const [outraVez, setOutraVez] = useState('');
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // O Supabase consome o endereço ao carregar: ou deixa uma sessão de
  // recuperação, ou deixa um erro no hash. Ler isso é o que separa "crie sua
  // senha" de "este link expirou" — e sem a leitura a pessoa veria um
  // formulário que falha ao salvar, sem saber por quê.
  useEffect(() => {
    let vivo = true;
    void motivoDoLink().then((m) => {
      if (vivo) setMotivo(m);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const podeSalvar = motivo === 'convite' || motivo === 'recuperacao' || motivo === 'trocar';

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha.length < MINIMO) {
      setErro(`A senha precisa de pelo menos ${MINIMO} caracteres.`);
      return;
    }
    if (senha !== outraVez) {
      setErro('As duas senhas não são iguais.');
      return;
    }
    setEnviando(true);
    try {
      await definirSenha(senha);
      // Sai da sessão do link de propósito: a próxima entrada é com a senha
      // nova, digitada. É o único jeito de a pessoa descobrir hoje, e não
      // amanhã, que guardou a senha errada.
      window.location.assign('/?senha=trocada');
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui salvar a senha.');
      setEnviando(false);
    }
  }

  async function pedirOutro(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setRecado(null);
    setEnviando(true);
    try {
      await pedirLinkDeSenha(email.trim());
      setRecado('Se existe conta com esse e-mail, o link já está a caminho. Confira a caixa de entrada e o spam.');
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui enviar o link.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-5 py-10 text-tinta">
      <main className="bloco entra w-full max-w-[26rem] p-7 sm:p-9">
        <Logo altura={38} />
        <h1 className="titulao mt-7 text-[clamp(1.7rem,5.5vw,2.2rem)]">
          {motivo ? TITULO[motivo] : 'Um instante'}
        </h1>
        <p className="mt-2 text-tinta-2">{motivo ? EXPLICA[motivo] : 'Conferindo o seu link.'}</p>

        {podeSalvar && (
          <form onSubmit={(e) => void salvar(e)} className="mt-7 flex flex-col gap-4" noValidate>
            <label className="flex flex-col gap-2">
              <span className="rotulo-forte">Senha nova</span>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="new-password"
                required
                className={CAMPO}
              />
              <span className="text-[12px] text-tinta-3">Pelo menos {MINIMO} caracteres.</span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="rotulo-forte">De novo</span>
              <input
                type="password"
                value={outraVez}
                onChange={(e) => setOutraVez(e.target.value)}
                autoComplete="new-password"
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
              {enviando ? 'Salvando…' : 'Salvar e entrar'}
            </Botao>
          </form>
        )}

        {(motivo === 'expirado' || motivo === 'semLink') && (
          <form onSubmit={(e) => void pedirOutro(e)} className="mt-7 flex flex-col gap-4" noValidate>
            <label className="flex flex-col gap-2">
              <span className="rotulo-forte">Seu e-mail</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
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
            {recado && (
              <p className="rounded-[var(--raio-p)] border border-linha-fraca px-3.5 py-2.5 text-[13px] text-tinta-2">
                {recado}
              </p>
            )}

            <Botao type="submit" variante="primario" disabled={enviando} className="mt-2 w-full">
              {enviando ? 'Enviando…' : 'Mandar link'}
            </Botao>
          </form>
        )}

        <div className="mt-8 border-t border-linha-fraca pt-5">
          <a href="/" className="text-[12.5px] text-tinta-3 risca hover:text-pink-texto">
            Voltar para a entrada
          </a>
        </div>
      </main>
    </div>
  );
}
