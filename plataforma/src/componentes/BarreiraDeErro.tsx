/**
 * A barreira que impede a tela branca.
 *
 * POR QUE ELA EXISTE
 *
 * A dona apagou um cliente e a plataforma inteira virou uma tela em branco —
 * sem menu, sem mensagem, sem caminho de volta. Ela mandou a captura e a tela
 * era literalmente o fundo da página e nada mais.
 *
 * O React desmonta a árvore inteira quando um componente estoura durante o
 * desenho e ninguém segura o erro. Sem alguém segurando, UM defeito em UMA
 * tela apaga todas as outras, inclusive o menu que levaria a pessoa para longe
 * do problema. Quem está do outro lado não tem como distinguir isso de "a
 * internet caiu" ou "o sistema sumiu".
 *
 * Isso contraria a regra que organiza este projeto desde o início: falha
 * silenciosa é proibida, todo erro vira status visível e mensagem legível em
 * português. Uma tela branca é a falha mais silenciosa que existe — não há nem
 * onde ler o que aconteceu.
 *
 * O QUE ELA FAZ
 *
 *   1. SEGURA o erro e desenha uma tela com o que aconteceu, em português;
 *   2. MOSTRA a mensagem técnica junto, recolhida. Sem isso, socorrer alguém
 *      exige pedir que a pessoa abra o console do navegador — que é pedir para
 *      alguém que está no celular, no meio de uma entrega, virar programadora;
 *   3. DÁ UMA SAÍDA: um botão que volta para o início. A tela branca não tinha
 *      nenhuma, e é por isso que ela prende;
 *   4. SE RECUPERA SOZINHA ao trocar de rota: sair da tela quebrada volta a
 *      funcionar sem recarregar a página.
 *
 * O 4 é o que a torna uma barreira e não um muro: sem ele, depois do primeiro
 * erro a pessoa fica presa na tela de erro até recarregar na mão.
 *
 * Precisa ser classe: `componentDidCatch` não existe em componente de função,
 * e em 2026 ainda não existe equivalente com hooks.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Botao } from './Botao';

interface Props {
  children: ReactNode;
  /** Muda quando a rota muda. Trocar de valor limpa o erro. */
  chave: string;
}

interface Estado {
  erro: Error | null;
  /** A rota em que o erro aconteceu, para saber quando ele ficou para trás. */
  onde: string | null;
}

export class BarreiraDeErro extends Component<Props, Estado> {
  override state: Estado = { erro: null, onde: null };

  static getDerivedStateFromError(erro: Error): Partial<Estado> {
    return { erro };
  }

  override componentDidMount(): void {
    if (this.state.erro && !this.state.onde) {
      this.setState({ onde: this.props.chave });
    }
  }

  override componentDidUpdate(anterior: Props): void {
    // Saiu da rota que quebrou: a barreira abaixa sozinha.
    if (this.state.erro && this.props.chave !== anterior.chave && this.state.onde !== null) {
      this.setState({ erro: null, onde: null });
    } else if (this.state.erro && this.state.onde === null) {
      this.setState({ onde: this.props.chave });
    }
  }

  override componentDidCatch(erro: Error, info: ErrorInfo): void {
    // Vai para o console com o componente que estourou. Não substitui o item
    // 2 acima — é para quem tem o console aberto, e é o complemento dele.
    console.error('A plataforma quebrou nesta tela:', erro, info.componentStack);
  }

  private recomecar = () => {
    this.setState({ erro: null, onde: null });
    window.location.assign('/');
  };

  override render(): ReactNode {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-5 py-10">
        <p className="rotulo-forte">algo quebrou aqui</p>
        <h1 className="titulao mt-3 text-[clamp(1.4rem,5vw,2rem)]">
          Esta tela não conseguiu abrir.
        </h1>
        <p className="mt-4 text-[15px] text-tinta-2">
          O resto da plataforma continua de pé — nada do seu trabalho se perdeu. Foi só esta
          tela que não desenhou.
        </p>

        <div className="mt-7 self-start">
          <Botao onClick={this.recomecar}>Voltar para o início</Botao>
        </div>

        {/* Recolhido de propósito: quem está trabalhando não quer ler isso, e
            quem for consertar precisa. Aberto, assustaria sem ajudar. */}
        <details className="mt-8">
          <summary className="legenda cursor-pointer">
            o que deu errado, em linguagem de máquina
          </summary>
          <pre className="mt-3 overflow-x-auto rounded-[var(--raio-p)] border border-linha bg-superficie px-3 py-2 font-mono text-[11.5px] break-words whitespace-pre-wrap text-tinta-2">
            {erro.name}: {erro.message}
          </pre>
          <p className="legenda mt-2">
            Se for mandar para quem cuida do sistema, mande este texto junto.
          </p>
        </details>
      </div>
    );
  }
}
