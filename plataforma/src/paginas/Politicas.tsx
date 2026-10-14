/**
 * As três páginas públicas que a homologação da Meta exige.
 *
 * O App Review pede, em campos do próprio painel do app: endereço da política
 * de privacidade, dos termos de uso, e das instruções de exclusão de dados. Os
 * três têm de abrir SEM LOGIN — o revisor não tem conta aqui.
 *
 * Por isso elas entram antes da checagem de sessão, junto com os dois links
 * sem conta. E por isso o texto é factual: descreve o que o sistema faz de
 * verdade, com os nomes das coisas. Política genérica copiada da internet é o
 * motivo mais citado de reprovação, e aqui seria mentira — a plataforma guarda
 * token no Vault, publica por conta de terceiro, e isso precisa estar escrito.
 *
 * Isto NÃO é peça jurídica. É a descrição técnica do que acontece com o dado,
 * escrita para o revisor da Meta e para o cliente que perguntar. Antes de valer
 * como documento legal, advogado tem de ler.
 */
import { Logo } from '../componentes/Marca';

const ATUALIZADO = '14 de outubro de 2026';

/**
 * O endereço para onde o titular dos dados escreve — e para onde o revisor da
 * Meta escreve, se escrever.
 *
 * É PROVISÓRIO, e um Gmail de propósito. O endereço da agência é
 * `projetos@astartstudio.com.br`, mas **nenhum endereço desse domínio recebe
 * hoje**: a zona tem um `MX 0 .` (o null MX da RFC 7505, que declara que o
 * domínio não aceita e-mail) ao lado do MX de verdade, e o Google honra o
 * ponto. Teste de 14/10: bounce em três segundos, *"o domínio
 * astartstudio.com.br não foi encontrado"*. Com `adm@` e `contato@`, idêntico.
 *
 * Política que manda escrever para um endereço que recusa é pior que política
 * sem endereço: ela promete um canal que não existe, e quem descobre é o
 * revisor da Meta tentando falar com a agência.
 *
 * **Quando a zona for consertada** (apagar `MX 0 .` e `TXT v=spf1 -all`, ver
 * `docs/homologacao-meta.md`), isto volta para `projetos@astartstudio.com.br` —
 * aqui e no `provar-politicas.mjs`, que guarda a regra que proíbe endereço
 * desse domínio enquanto ele recusar.
 *
 * Uma constante, não o texto repetido nas duas páginas: antes era
 * `contato@astartstudio.com.br`, escrito à mão em quatro lugares, e era um
 * PALPITE meu — está registrado como tal no `docs/decisoes.md`.
 *
 * O `provar-politicas.mjs` cobra este endereço exato nas páginas publicadas, e
 * de propósito ele o tem escrito à mão também: prover que lê o valor da fonte
 * que está conferindo não prova nada.
 */
const CONTATO = 'astartagencia@gmail.com';

function Pagina({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh px-5 py-10 text-tinta sm:px-8">
      <main className="bloco mx-auto w-full max-w-[46rem] p-7 sm:p-10">
        <Logo altura={34} />
        <h1 className="titulao mt-7 text-[clamp(1.6rem,5vw,2.2rem)]">{titulo}</h1>
        <p className="rotulo mt-2 normal-case">atualizado em {ATUALIZADO}</p>
        <div className="mt-7 flex flex-col gap-4 text-[14.5px] leading-relaxed text-tinta-2">
          {children}
        </div>
        <div className="mt-9 border-t border-linha-fraca pt-5">
          <p className="text-[12.5px] text-tinta-3">
            Astart Studio · dúvidas sobre dados:{' '}
            <a href={`mailto:${CONTATO}`} className="risca hover:text-pink-texto">
              {CONTATO}
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

const T = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mt-4 text-[15px] font-bold text-tinta">{children}</h2>
);

export function Privacidade() {
  return (
    <Pagina titulo="Política de privacidade">
      <p>
        Esta plataforma é a ferramenta interna da Astart Studio para gerir o trabalho dos clientes
        da agência: planejar conteúdo, aprovar peças, publicar nas redes sociais do cliente,
        acompanhar entregas e cobranças. Não é um serviço aberto: só entra quem a Astart convida.
      </p>

      <T>Quem somos</T>
      <p>
        Astart Studio, agência de social media. O responsável pelos dados é a direção da agência, no
        e-mail acima.
      </p>

      <T>Que dados a plataforma guarda</T>
      <p>
        <strong>Da equipe da Astart:</strong> nome, e-mail, cargo e o papel que define o que cada
        pessoa vê. A senha nunca é guardada em texto — quem cuida da autenticação é o Supabase.
      </p>
      <p>
        <strong>Dos clientes da agência:</strong> nome, endereço, fuso horário, serviços
        contratados, valores e vencimentos do contrato, e o e-mail das pessoas que recebem acesso ao
        portal do cliente.
      </p>
      <p>
        <strong>Do conteúdo:</strong> as peças planejadas, legendas, hashtags, as imagens e vídeos
        enviados, as decisões de aprovação com nome de quem decidiu, e o registro de cada
        publicação — o que foi publicado, quando, em qual conta, e o erro quando falha.
      </p>
      <p>
        <strong>Das contas de rede social conectadas:</strong> o identificador da conta
        (<span className="font-mono">ig_user_id</span>, <span className="font-mono">page_id</span>),
        o nome de exibição, e uma <em>referência</em> ao token de acesso.
      </p>

      <T>Onde fica o token da rede social</T>
      <p>
        O token de acesso nunca é guardado junto com os outros dados nem chega ao navegador de
        ninguém. Ele fica criptografado no Supabase Vault, e só é lido no servidor, no momento de
        publicar. A tabela de contas guarda apenas o <em>nome da chave</em> onde o token está — não
        o token.
      </p>
      <p>
        O que a plataforma faz com ele: publica o conteúdo que a equipe da Astart agendou, na conta
        que o cliente autorizou, e lê o limite de publicações restante na janela de 24 horas. Nada
        mais. A plataforma não lê mensagens diretas, não publica sem agendamento feito por uma
        pessoa, e não usa os dados das contas para treinar modelo nenhum.
      </p>

      <T>Com quem compartilhamos</T>
      <p>
        <strong>Supabase</strong> (banco de dados, autenticação, armazenamento de arquivos e
        execução das funções) e <strong>Cloudflare</strong> (entrega do site). As plataformas de
        rede social — <strong>Meta</strong> (Instagram e Facebook) — recebem o conteúdo que você
        agenda, porque é o que publicar significa.
      </p>
      <p>
        Não vendemos dado nenhum, não usamos para publicidade, e não compartilhamos com mais
        ninguém.
      </p>

      <T>Por quanto tempo guardamos</T>
      <p>
        Enquanto o cliente estiver ativo na agência. Desligar um cliente não apaga o histórico,
        porque o registro do que foi publicado e do que foi pago é o que protege as duas partes
        numa divergência. A exclusão definitiva é feita a pedido, do jeito descrito na página de
        exclusão de dados.
      </p>

      <T>Seus direitos</T>
      <p>
        Pela LGPD você pode pedir acesso, correção, portabilidade ou exclusão dos seus dados, e
        revogar uma autorização a qualquer momento. Pedido pelo e-mail acima, respondido em até 15
        dias.
      </p>
      <p>
        Desconectar a conta de rede social é imediato e não depende de nós: basta remover o acesso
        da Astart nas configurações do Instagram ou do Business Manager. A plataforma para de
        publicar na hora.
      </p>

      <T>Cookies</T>
      <p>
        A plataforma guarda no seu navegador só o necessário para manter você conectado e lembrar
        preferências de tela. Não há cookie de publicidade nem de rastreamento de terceiros.
      </p>
    </Pagina>
  );
}

export function Termos() {
  return (
    <Pagina titulo="Termos de uso">
      <p>
        Ferramenta interna da Astart Studio. O acesso é por convite da agência, pessoal e não
        transferível.
      </p>

      <T>Quem pode usar</T>
      <p>
        Pessoas da equipe da Astart, com o papel que a direção definir, e pessoas indicadas pelos
        clientes para acompanhar e aprovar o trabalho do próprio contrato. Cada pessoa vê apenas o
        que o papel dela permite.
      </p>

      <T>O que a plataforma faz</T>
      <p>
        Planeja e agenda publicações, envia peças para aprovação do cliente, publica nas contas de
        rede social que o cliente autorizou, e registra entregas, cobranças e avaliações.
      </p>

      <T>Responsabilidade pelo conteúdo</T>
      <p>
        O conteúdo publicado é de responsabilidade da Astart e do cliente que o aprovou. Cada rede
        social tem as regras dela, e uma publicação pode ser recusada ou removida por elas — a
        plataforma mostra o motivo quando a rede informa.
      </p>

      <T>Contas de rede social</T>
      <p>
        Conectar uma conta significa autorizar a Astart a publicar nela, em nome do cliente,
        segundo o contrato de serviço. A autorização pode ser revogada a qualquer momento pelo
        próprio cliente, nas configurações da rede social, e a plataforma para de publicar
        imediatamente.
      </p>

      <T>Disponibilidade</T>
      <p>
        A plataforma depende de serviços de terceiros (Supabase, Cloudflare, APIs das redes
        sociais). Quando um deles falha, a publicação pode atrasar; a plataforma registra o erro e
        avisa a equipe, em vez de falhar em silêncio.
      </p>

      <T>Encerramento</T>
      <p>
        A direção da Astart pode retirar o acesso de qualquer pessoa a qualquer momento. Retirar
        acesso não apaga o histórico do trabalho feito.
      </p>
    </Pagina>
  );
}

export function ExclusaoDeDados() {
  return (
    <Pagina titulo="Exclusão de dados">
      <p>
        Esta página existe porque a Meta exige um endereço público explicando como pedir a exclusão
        dos dados — e porque é justo que exista.
      </p>

      <T>Como pedir</T>
      <p>
        Mande um e-mail para{' '}
        <a href={`mailto:${CONTATO}`} className="risca hover:text-pink-texto">
          {CONTATO}
        </a>{' '}
        com o assunto <strong>“Exclusão de dados”</strong>, dizendo de qual conta ou de qual
        empresa. Respondemos em até 15 dias, confirmando o que foi apagado.
      </p>

      <T>O que é apagado</T>
      <p>
        Os dados cadastrais, as contas de rede social conectadas e os tokens de acesso
        correspondentes, as peças de conteúdo e os arquivos enviados.
      </p>

      <T>O que pode ficar, e por quê</T>
      <p>
        O registro contábil das cobranças, pelo prazo que a lei exige. E o registro de que uma
        publicação aconteceu — data, conta e identificador do post — porque ele é a prova do serviço
        prestado. Esse registro não contém o conteúdo, apenas o fato.
      </p>

      <T>Desconectar sem depender de nós</T>
      <p>
        Para parar de dar acesso à sua conta de rede social agora, sem esperar resposta nossa:
      </p>
      <p>
        <strong>Instagram:</strong> Configurações → Apps e sites → remover o app da Astart.
        <br />
        <strong>Facebook / Business Manager:</strong> Configurações do negócio → Parceiros → remover
        a Astart, ou Configurações → Apps e sites.
      </p>
      <p>
        Assim que o acesso sai, a plataforma para de publicar naquela conta e passa a mostrar a
        conexão como expirada para a equipe.
      </p>
    </Pagina>
  );
}
