// =============================================================================
// avisar-tarefa — manda os avisos do quadro que estao na fila.
//
// Pedido da dona, ao desenhar o quadro: "fazer criativo - responsavel: raquel,
// ai eu coloco o nome dela e chega pra ela a solicitacao por email".
//
// A fila existe desde a 0065; o envio e esta funcao. Quem enfileira e o banco,
// na mesma transacao que cria ou repassa a tarefa — entao nenhum aviso depende
// desta funcao estar de pe no momento em que a pessoa clica.
//
// REGRAS QUE GOVERNAM ESTE ARQUIVO
//
//   1. A CHAVE NAO PASSA PELO NAVEGADOR. Ela vive no Vault e e lida aqui, com
//      service role. E por isso que o envio e uma Edge Function e nao uma
//      chamada do front.
//
//   2. RESERVA ANTES DE ENVIAR. `reservar_avisos_de_tarefa` marca o lote com
//      `for update skip locked`. Duas invocacoes que se cruzem pegam lotes
//      diferentes; nenhuma manda o mesmo e-mail duas vezes. Receber o mesmo
//      aviso tres vezes ensina a pessoa a ignorar os avisos.
//
//   3. UM TICK, UM LOTE, SEM SLEEP. Pega ate 20, manda, devolve o controle. O
//      que sobrou sai no tick seguinte.
//
//   4. FALHA VIRA ESTADO VISIVEL. Erro grava motivo e reagenda com espera que
//      dobra; na sexta tentativa desiste e fica escrito. A direcao ve por
//      `avisos_de_tarefa_travados`.
// =============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const LOTE = Number(Deno.env.get('AVISOS_LOTE_MAX') ?? '20');

/**
 * De onde o e-mail sai.
 *
 * `projetos@` e nao `noreply@`: quem recebe um aviso de tarefa as vezes
 * responde, e responder para o nada e pior que nao receber. Este endereco
 * existe e cai na caixa da agencia.
 */
const REMETENTE = Deno.env.get('AVISOS_REMETENTE') ?? 'Astart Studio <projetos@astartstudio.com.br>';

/** Onde o quadro mora, para o aviso ter um link em vez de so um texto. */
const ENDERECO_DO_QUADRO =
  Deno.env.get('AVISOS_URL_QUADRO') ?? 'https://app.astartstudio.com.br/tarefas';

interface AvisoNaFila {
  id: string;
  tipo: 'atribuida' | 'mencionada';
  para_nome: string;
  para_email: string | null;
  tarefa_titulo: string;
  tarefa_prazo: string | null;
  cliente: string | null;
  quem_fez: string;
  tentativas: number;
}

function exigir(nome: string): string {
  const v = Deno.env.get(nome);
  if (!v) throw new Error(`Variavel de ambiente ${nome} nao configurada.`);
  return v;
}

/** 16/11, como no resto do sistema. */
function diaMes(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * O corpo do aviso.
 *
 * Curto de proposito. Quem recebe quer saber tres coisas: o que e, de quem
 * veio, e para quando. O resto esta no quadro, a um clique — repetir a
 * descricao aqui faria o e-mail competir com a ferramenta.
 */
function montar(a: AvisoNaFila): { assunto: string; texto: string; html: string } {
  const verbo = a.tipo === 'atribuida'
    ? `${a.quem_fez} passou uma tarefa para você`
    : `${a.quem_fez} mencionou você numa tarefa`;

  const partes = [
    a.cliente ? `Cliente: ${a.cliente}` : null,
    a.tarefa_prazo ? `Prazo: ${diaMes(a.tarefa_prazo)}` : null,
  ].filter(Boolean) as string[];

  const assunto = a.tipo === 'atribuida'
    ? `Nova tarefa: ${a.tarefa_titulo}`
    : `Mencionaram você: ${a.tarefa_titulo}`;

  const texto = [
    `Oi, ${a.para_nome}.`,
    '',
    `${verbo}:`,
    '',
    a.tarefa_titulo,
    ...partes,
    '',
    `Abrir o quadro: ${ENDERECO_DO_QUADRO}`,
    '',
    '— Astart Studio',
  ].join('\n');

  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#faf7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1420">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
  <p style="margin:0 0 18px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7f90">Astart Studio</p>
  <p style="margin:0 0 6px;font-size:15px;color:#4a4350">Oi, ${escapar(a.para_nome)}.</p>
  <p style="margin:0 0 20px;font-size:15px;color:#4a4350">${escapar(verbo)}:</p>
  <p style="margin:0 0 10px;font-size:19px;font-weight:700;line-height:1.3">${escapar(a.tarefa_titulo)}</p>
  ${partes.length ? `<p style="margin:0 0 22px;font-size:14px;color:#6b6272">${partes.map(escapar).join(' &middot; ')}</p>` : ''}
  <a href="${escapar(ENDERECO_DO_QUADRO)}" style="display:inline-block;background:#d6186e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px;font-weight:600">Abrir o quadro</a>
</div>
</body></html>`;

  return { assunto, texto, html };
}

/** A chave do Resend, do Vault. Nunca de variavel de ambiente do front. */
async function chaveDoResend(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb.rpc('segredo_do_cofre', { p_nome: 'resend_api_key' });
  if (error) throw new Error(`Nao consegui ler a chave do Resend: ${error.message}`);
  const chave = (data as string | null)?.trim();
  if (!chave) {
    throw new Error(
      'A chave do Resend nao esta no Vault. Cadastre com ' +
      "select vault.create_secret('<chave>', 'resend_api_key');",
    );
  }
  return chave;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const responder = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });

  if (req.method !== 'POST') return responder({ erro: 'Use POST.' }, 405);

  // Mesma porta do publicar-tick: quem chama e o cron, com o segredo. Sem
  // isto, qualquer um na internet esvazia a fila de e-mails da agencia.
  const segredo = Deno.env.get('TICK_SECRET');
  if (!segredo) {
    return responder({ erro: 'TICK_SECRET nao configurado nesta funcao.' }, 500);
  }
  if (req.headers.get('x-tick-secret') !== segredo) {
    return responder({ erro: 'Nao autorizado.' }, 401);
  }

  const sb = createClient(exigir('SUPABASE_URL'), exigir('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  const { data, error } = await sb.rpc('reservar_avisos_de_tarefa', { p_limite: LOTE });
  if (error) return responder({ erro: `Nao consegui ler a fila: ${error.message}` }, 500);

  const fila = (data ?? []) as AvisoNaFila[];
  if (fila.length === 0) return responder({ enviados: 0, falharam: 0, fila: 0 });

  let chave: string;
  try {
    chave = await chaveDoResend(sb);
  } catch (x) {
    // A chave falta: devolve TODO o lote para a fila com o motivo, em vez de
    // queimar uma tentativa de cada um por um problema que nao e deles.
    const motivo = x instanceof Error ? x.message : 'Chave do Resend indisponivel.';
    for (const a of fila) {
      await sb.rpc('aviso_de_tarefa_falhou', { p_aviso: a.id, p_erro: motivo });
    }
    return responder({ erro: motivo, devolvidos: fila.length }, 500);
  }

  let enviados = 0;
  const falhas: { id: string; motivo: string }[] = [];

  for (const a of fila) {
    try {
      if (!a.para_email) throw new Error('Essa pessoa nao tem e-mail cadastrado no perfil.');

      const { assunto, texto, html } = montar(a);
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${chave}`,
          'content-type': 'application/json',
          // A MESMA chave para o mesmo aviso, sempre. Se esta funcao morrer
          // depois de o Resend aceitar mas antes de marcar enviado, o tick
          // seguinte repete a chamada e o Resend reconhece em vez de mandar
          // de novo. Sem isto, a reserva protege contra corrida mas nao
          // contra queda no meio.
          'Idempotency-Key': `aviso-${a.id}`,
        },
        body: JSON.stringify({
          from: REMETENTE,
          to: [a.para_email],
          subject: assunto,
          text: texto,
          html,
        }),
      });

      if (!r.ok) {
        const corpo = await r.text();
        throw new Error(`Resend respondeu ${r.status}: ${corpo.slice(0, 200)}`);
      }

      await sb.rpc('aviso_de_tarefa_saiu', { p_aviso: a.id });
      enviados += 1;
    } catch (x) {
      const motivo = x instanceof Error ? x.message : 'Falha desconhecida ao enviar.';
      await sb.rpc('aviso_de_tarefa_falhou', { p_aviso: a.id, p_erro: motivo });
      falhas.push({ id: a.id, motivo });
    }
  }

  return responder({ enviados, falharam: falhas.length, falhas });
});
