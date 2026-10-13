/**
 * O diagnóstico do token da Meta, na tela.
 *
 * Existe por causa de um erro real: a dona clicou em "Conectar conta" e leu
 * "O token de acesso da Meta expirou ou foi revogado". A frase está correta e
 * não serve para nada — ela cobre três situações com três consertos
 * diferentes, e nenhuma pista de qual era.
 *
 * O que esta tela mostra é o que a Meta responde quando perguntamos pelo
 * próprio token: o TIPO (usuário ou usuário do sistema), a VALIDADE e os
 * ESCOPOS. Com isso a pessoa sabe se o problema é o token errado, o token
 * vencido ou uma permissão que não foi marcada — sem abrir log nenhum.
 *
 * Compartilhado entre o calendário (onde o erro aparece) e Ajustes (onde se
 * confere de propósito), porque uma segunda cópia divergiria na primeira
 * correção.
 */
import { Marca } from './Bloco';
import type { SaudeDoToken } from '../dados/tipos';

function quando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** "há 11 horas" diz mais que a data: é o que torna a data um argumento. */
function faz(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `há ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `há ${Math.round(h)} h`;
  return `há ${Math.round(h / 24)} dias`;
}

export function PainelSaudeDoToken({ saude }: { saude: SaudeDoToken }) {
  // Token de usuário do sistema não expira. Qualquer outro tipo é um token que
  // vai morrer sozinho, e essa é a informação que muda o que a pessoa faz.
  const bom = saude.valido && saude.tipo === 'SYSTEM_USER' && saude.expiraEm === null &&
    saude.escoposFaltando.length === 0;

  return (
    <div
      className={
        'mt-3 rounded-[var(--raio-p)] border px-3.5 py-3 text-[13px] ' +
        (bom ? 'border-linha-fraca' : 'border-linha bg-alerta-fundo')
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rotulo-forte">token da meta</span>
        <Marca forte={!bom}>{saude.valido ? 'aceito pela Meta' : 'recusado pela Meta'}</Marca>
        {saude.tipo && <Marca forte={saude.tipo !== 'SYSTEM_USER'}>{saude.tipo}</Marca>}
        {/* Quando a Meta nem aceitou a pergunta, nao ha o que dizer sobre
            expiracao — e inventar "nao expira" seria o oposto da verdade. */}
        {saude.conferidoCom !== 'so_a_data' && (
          <Marca forte={saude.expiraEm !== null}>
            {saude.expiraEm === null
              ? 'não expira'
              : saude.jaExpirou
                ? `expirou em ${quando(saude.expiraEm)}`
                : `expira em ${quando(saude.expiraEm)}`}
          </Marca>
        )}
        {/* A data de cadastro e o argumento que nao depende da Meta: token de
            usuario do sistema nao expira, entao chave trocada hoje e ja
            recusada conta a historia sozinha. */}
        {saude.cadastradaEm && (
          <Marca forte={!bom}>cadastrada {faz(saude.cadastradaEm)}</Marca>
        )}
      </div>

      <p className="mt-2 text-tinta-2">{saude.diagnostico}</p>

      {saude.oQueFazer && (
        <p className="mt-2">
          <span className="rotulo">o que fazer</span>
          <br />
          {saude.oQueFazer}
        </p>
      )}

      {saude.escopos.length > 0 && (
        <p className="rotulo mt-2.5 break-words normal-case">
          escopos: {saude.escopos.join(', ')}
        </p>
      )}

      {/* O formato do texto guardado. Nenhum pedaço do token aparece aqui — são
          respostas de sim ou não, mais o tamanho, que é o que denuncia um valor
          colado incompleto. Serve para separar "o texto está quebrado" de "o
          token está morto": dois problemas, dois consertos. */}
      {saude.formato?.cadastrada && (
        <p className="rotulo mt-2 break-words normal-case">
          texto guardado: {saude.formato.tamanho} caracteres
          {saude.formato.comecaComEAA === false && ' · não começa com EAA'}
          {saude.formato.pontasSujas && ' · com espaço ou quebra de linha nas pontas'}
          {saude.formato.temAspas && ' · com aspas dentro'}
          {saude.formato.temSinaisDeMarcador && ' · com os sinais < e > dentro'}
          {saude.formato.soCaracteresEsperados === false &&
            !saude.formato.temSinaisDeMarcador &&
            ' · com caracteres estranhos'}
        </p>
      )}
    </div>
  );
}
