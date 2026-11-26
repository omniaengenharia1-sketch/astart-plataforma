import { useCallback, useEffect, useState } from 'react';
import { Botao } from './Botao';
import { Campo, Entrada } from './Campo';
import { Fita } from './Bloco';
import {
  documentoValido, mascaraDocumento, mascaraTelefone, soDigitos,
} from '../formato';
import { dadosDeCobranca, salvarDadosDeCobranca } from '../dados/api';
import type { DadosDeCobranca } from '../dados/tipos';

/**
 * CPF/CNPJ, e-mail e telefone de cobrança de um cliente que já existe.
 *
 * POR QUE ISTO VIROU TELA
 *
 * `cobrancas_para_emitir` só olha cliente com `cnpj_cpf` preenchido. Todos os
 * clientes cadastrados antes da 0086 têm esse campo nulo — e a rodada passa por
 * cima deles sem erro, sem log, sem nada. A cobrança simplesmente não acontece.
 * Era a pior forma possível de defeito: a que não reclama.
 *
 * O painel mostra o que já está gravado antes de deixar editar. Formulário que
 * abre vazio é formulário onde a pessoa digita de novo o que já estava certo —
 * ou, pior, salva em branco por cima.
 */
export function DadosDeCobrancaPainel({ clienteId }: { clienteId: string }) {
  const [dados, setDados] = useState<DadosDeCobranca | null>(null);
  const [erroLer, setErroLer] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [doc, setDoc] = useState('');
  const [email, setEmail] = useState('');
  const [tel, setTel] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErroLer(null);
    try {
      setDados(await dadosDeCobranca(clienteId));
    } catch (x) {
      setErroLer(x instanceof Error ? x.message : 'Não consegui ler os dados de cobrança.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function abrir() {
    // Os campos partem do que ESTÁ gravado, não do vazio.
    setDoc(mascaraDocumento(dados?.cnpjCpf ?? ''));
    setEmail(dados?.email ?? '');
    setTel(mascaraTelefone(dados?.telefone ?? ''));
    setErro(null);
    setEditando(true);
  }

  const docOk = documentoValido(doc);

  async function salvar() {
    if (salvando || !docOk) return;
    setSalvando(true);
    setErro(null);
    try {
      await salvarDadosDeCobranca(clienteId, {
        cnpjCpf: soDigitos(doc),
        email: email.trim(),
        telefone: soDigitos(tel),
      });
      await carregar();
      setEditando(false);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Fita
        acao={
          dados && (
            <Botao tamanho="pequeno" onClick={() => (editando ? setEditando(false) : abrir())}>
              {editando ? 'Fechar' : dados.cnpjCpf ? 'Editar' : 'Preencher'}
            </Botao>
          )
        }
      >
        Para cobrar
      </Fita>

      {erroLer && (
        <p role="alert" className="legenda mt-3 bg-alerta-fundo px-3 py-2">
          {erroLer}
        </p>
      )}

      {dados && !editando && (
        <div className="mt-3">
          {dados.cnpjCpf ? (
            <dl className="grid gap-2 text-[13px]">
              <div>
                <dt className="rotulo">CPF/CNPJ</dt>
                <dd className="numeros">{mascaraDocumento(dados.cnpjCpf)}</dd>
              </div>
              {dados.email && (
                <div>
                  <dt className="rotulo">E-mail</dt>
                  <dd className="break-all">{dados.email}</dd>
                </div>
              )}
              {dados.telefone && (
                <div>
                  <dt className="rotulo">Telefone</dt>
                  <dd className="numeros">{mascaraTelefone(dados.telefone)}</dd>
                </div>
              )}
            </dl>
          ) : (
            /* Não é um "campo em branco": é a cobrança dele desligada, e isso
               tem de estar escrito com todas as letras. */
            <p role="alert" className="legenda bg-alerta-fundo px-3 py-2">
              Sem CPF ou CNPJ, este cliente não entra na cobrança: a plataforma não
              emite boleto nem pix para ele e não avisa nada.
            </p>
          )}
        </div>
      )}

      {dados && editando && (
        <div className="bloco mt-3 grid gap-3 p-3">
          <Campo
            id="cob-doc"
            rotulo="CPF ou CNPJ"
            dica={doc.trim() === '' ? 'quem vai no boleto' : docOk ? 'conferido' : undefined}
            erro={doc.trim() !== '' && !docOk ? 'Esse número não fecha. Confira os dígitos.' : undefined}
          >
            <Entrada
              id="cob-doc"
              value={doc}
              inputMode="numeric"
              placeholder="Ex.: 12.345.678/0001-90"
              onChange={(e) => setDoc(mascaraDocumento(e.target.value))}
            />
          </Campo>

          <Campo id="cob-email" rotulo="E-mail de cobrança" dica="opcional">
            <Entrada
              id="cob-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Campo>

          <Campo id="cob-tel" rotulo="Telefone" dica="opcional">
            <Entrada
              id="cob-tel"
              value={tel}
              inputMode="numeric"
              onChange={(e) => setTel(mascaraTelefone(e.target.value))}
            />
          </Campo>

          {dados.naAsaas && (
            <p className="legenda">
              Este cliente já tem cadastro na Asaas ({dados.ambiente ?? 'ambiente antigo'}).
              Trocar o documento aqui não muda o cadastro de lá — a próxima cobrança
              cria um cliente novo com o documento novo.
            </p>
          )}

          {/* Campo vazio não apaga o que está gravado — o banco usa `coalesce`.
              Dizer isso evita a pessoa achar que precisa redigitar tudo. */}
          <p className="legenda">Deixar um campo vazio mantém o que já está salvo.</p>

          {erro && (
            <p role="alert" className="legenda bg-alerta-fundo px-3 py-2">
              {erro}
            </p>
          )}

          <div className="flex gap-2">
            <Botao variante="primario" onClick={() => void salvar()} disabled={salvando || !docOk}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Botao>
            <Botao variante="texto" onClick={() => setEditando(false)}>
              Cancelar
            </Botao>
          </div>
        </div>
      )}
    </>
  );
}
