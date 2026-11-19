// =============================================================================
// agenda-google — a ponte de mao dupla com o Google Agenda.
//
// A dona: "a agenda eu preciso que vc deixe ela integrada no google agenda",
// nos dois sentidos, com a conta de cada pessoa da equipe.
//
// POR QUE CONTA DE SERVICO, E NAO "ENTRAR COM O GOOGLE"
//
// Os e-mails da agencia sao de cPanel, nao de Google Workspace. Um app OAuth
// fica entao em modo "externo", onde o escopo de agenda e sensivel: ou passa
// por uma analise de semanas, ou a autorizacao EXPIRA A CADA SETE DIAS e cada
// pessoa religa toda semana. Ninguem usa um sistema assim.
//
// Com conta de servico nao ha tela de consentimento nem token de usuario:
// cada pessoa COMPARTILHA a propria agenda com o endereco robo, uma vez, e
// escolhe "Fazer alteracoes e ver todos os detalhes dos eventos". Conferido
// na tela dela antes de escrever este arquivo — a opcao existe.
//
// O limite conhecido, e que aqui nao atrapalha: conta de servico nao consegue
// CONVIDAR participantes sem delegacao de dominio. "Quem vai" e um campo
// nosso, nao convite do Google, entao nunca mandamos `attendees`.
//
// AS REGRAS QUE GOVERNAM ESTE ARQUIVO
//
//   1. Um tick faz um passo de cada fila e devolve o controle. Sem sleep,
//      sem polling dentro de uma invocacao — igual ao `publicar-tick`.
//   2. O pior bug possivel desta ponte e DUPLICAR o compromisso na agenda de
//      alguem. Toda escrita passa pelo par (agenda, evento), que tem indice
//      unico desde a 0078; e evento que veio do Google nunca e empurrado de
//      volta, senao vira pingue-pongue.
//   3. Falha silenciosa e proibida: o erro de cada agenda e gravado em
//      portugues e aparece na tela de Ajustes da pessoa.
//   4. A chave da conta de servico vive so nas variaveis desta funcao. Nunca
//      no banco, nunca no front.
// =============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_CAL = 'https://www.googleapis.com/calendar/v3';
const ESCOPO = 'https://www.googleapis.com/auth/calendar.events';

/** Quanto do passado a primeira leitura traz. Antes disso nao interessa. */
const DIAS_PARA_TRAS = 30;
const DIAS_PARA_FRENTE = 400;
const LIMITE_TEMPO_MS = 45_000;

interface Agenda {
  userId: string;
  calendarId: string;
  syncToken: string | null;
  nome: string;
}

interface ParaEmpurrar {
  id: string;
  calendarId: string;
  eventId: string | null;
  /**
   * O instante em que a fila viu esta versao. Volta no `casar_...`: carimbar
   * com `now()` na hora de gravar perderia uma correcao feita no meio da
   * rodada, e o Google ficaria com o titulo velho para sempre, calado.
   */
  atualizadoEm: string;
  titulo: string;
  quando: string;
  terminaEm: string | null;
  diaInteiro: boolean;
  fuso: string;
  local: string | null;
  observacao: string | null;
  cliente: string | null;
}

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// --- O token do robo --------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A chave vem do painel como PEM de uma linha so, com `\n` escrito em texto.
 * Colar com as quebras reais tambem funciona: os dois casos caem aqui.
 */
function pemParaDer(pem: string): ArrayBuffer {
  const limpo = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(limpo);
  // ArrayBuffer e nao Uint8Array: a tipagem do Web Crypto no Deno so aceita
  // um buffer que nao pode ser compartilhado, e o Uint8Array generico nao
  // prova isso ao TypeScript.
  const out = new ArrayBuffer(bin.length);
  const vista = new Uint8Array(out);
  for (let i = 0; i < bin.length; i += 1) vista[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Troca um JWT assinado pela chave do robo por um token de acesso.
 *
 * Nao guardo o token em lugar nenhum: ele vale uma hora e a funcao vive
 * segundos. Guardar economizaria uma chamada e criaria um segredo a mais
 * para vazar.
 */
async function tokenDoRobo(email: string, chavePem: string): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  const cabeca = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const corpo = base64url(new TextEncoder().encode(JSON.stringify({
    iss: email,
    scope: ESCOPO,
    aud: GOOGLE_TOKEN,
    iat: agora,
    exp: agora + 3600,
  })));

  const chave = await crypto.subtle.importKey(
    'pkcs8',
    pemParaDer(chavePem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const assinatura = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    chave,
    new TextEncoder().encode(`${cabeca}.${corpo}`),
  ));

  const r = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${cabeca}.${corpo}.${base64url(assinatura)}`,
    }),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      `O Google recusou a chave da conta de serviço (${r.status}): ` +
      `${dados.error_description ?? dados.error ?? 'sem detalhe'}.`,
    );
  }
  return dados.access_token as string;
}

// --- Conversao entre os dois formatos ---------------------------------------

const soDia = (iso: string, fuso: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));

/** O corpo do evento como o Google quer. Sem `attendees`, de propósito. */
function paraOGoogle(k: ParaEmpurrar): Record<string, unknown> {
  const descricao = [
    k.cliente ? `Cliente: ${k.cliente}` : null,
    k.observacao,
    'Marcado na plataforma da Astart.',
  ].filter(Boolean).join('\n');

  if (k.diaInteiro) {
    const dia = soDia(k.quando, k.fuso);
    const seguinte = new Date(`${dia}T00:00:00Z`);
    seguinte.setUTCDate(seguinte.getUTCDate() + 1);
    return {
      summary: k.titulo,
      location: k.local ?? undefined,
      description: descricao,
      // Dia inteiro no Google e `date`, e o fim e o dia SEGUINTE (exclusivo).
      start: { date: dia },
      end: { date: seguinte.toISOString().slice(0, 10) },
    };
  }

  const fim = k.terminaEm
    ?? new Date(new Date(k.quando).getTime() + 3_600_000).toISOString();
  return {
    summary: k.titulo,
    location: k.local ?? undefined,
    description: descricao,
    start: { dateTime: new Date(k.quando).toISOString(), timeZone: k.fuso },
    end: { dateTime: new Date(fim).toISOString(), timeZone: k.fuso },
  };
}

// --- As tres filas ----------------------------------------------------------

async function empurrar(
  sb: SupabaseClient, token: string, limiteEm: number,
): Promise<{ criados: number; atualizados: number; erros: string[] }> {
  const erros: string[] = [];
  let criados = 0;
  let atualizados = 0;

  const { data, error } = await sb.rpc('compromissos_para_empurrar', { p_limite: 100 });
  if (error) throw new Error(`compromissos_para_empurrar: ${error.message}`);

  for (const k of (data ?? []) as ParaEmpurrar[]) {
    if (Date.now() > limiteEm) break;
    const corpo = paraOGoogle(k);
    const base = `${GOOGLE_CAL}/calendars/${encodeURIComponent(k.calendarId)}/events`;
    // Com id, ATUALIZA. Sem id, cria. Nunca "cria de novo por via das
    // duvidas": e assim que a agenda de alguem enche de duplicata.
    const url = k.eventId ? `${base}/${encodeURIComponent(k.eventId)}` : base;
    const r = await fetch(url, {
      method: k.eventId ? 'PATCH' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const resposta = await r.json().catch(() => ({}));

    if (r.status === 404 && k.eventId) {
      // Apagado no Google por fora. Solta o vinculo para a proxima rodada
      // recriar, em vez de ficar tentando atualizar um evento que nao existe.
      // Soltar o vinculo e um "melhor esforco": se falhar, a proxima rodada
      // tenta de novo. Nao vale parar a fila inteira por causa disto.
      const { error: eSolta } = await sb.rpc('casar_compromisso_com_google', {
        p_compromisso: k.id, p_calendar_id: null, p_event_id: null,
        p_visto_em: k.atualizadoEm,
      });
      if (eSolta) erros.push(`"${k.titulo}": sumiu do Google e não consegui soltar o vínculo.`);
      continue;
    }
    if (!r.ok) {
      erros.push(
        `"${k.titulo}": o Google recusou (${r.status}) ` +
        `${resposta?.error?.message ?? ''}`.trim(),
      );
      continue;
    }

    const { error: e2 } = await sb.rpc('casar_compromisso_com_google', {
      p_compromisso: k.id,
      p_calendar_id: k.calendarId,
      p_event_id: resposta.id as string,
      p_visto_em: k.atualizadoEm,
    });
    if (e2) erros.push(`"${k.titulo}": gravei no Google mas nao consegui marcar aqui: ${e2.message}`);
    else if (k.eventId) atualizados += 1;
    else criados += 1;
  }

  return { criados, atualizados, erros };
}

async function apagarLa(
  sb: SupabaseClient, token: string, limiteEm: number,
): Promise<{ apagados: number; erros: string[] }> {
  const erros: string[] = [];
  let apagados = 0;

  const { data, error } = await sb.rpc('apagados_para_o_google', { p_limite: 100 });
  if (error) throw new Error(`apagados_para_o_google: ${error.message}`);

  for (const a of (data ?? []) as { calendarId: string; eventId: string }[]) {
    if (Date.now() > limiteEm) break;
    const r = await fetch(
      `${GOOGLE_CAL}/calendars/${encodeURIComponent(a.calendarId)}/events/${encodeURIComponent(a.eventId)}`,
      { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
    );
    // 404 e 410 querem dizer "ja nao existe la" — que e o objetivo. Tratar
    // como erro deixaria a lapide presa para sempre, tentando toda rodada.
    if (r.ok || r.status === 404 || r.status === 410) {
      await sb.rpc('esquecer_apagado', { p_calendar_id: a.calendarId, p_event_id: a.eventId });
      apagados += 1;
      continue;
    }
    erros.push(`nao consegui apagar um evento no Google (${r.status})`);
  }

  return { apagados, erros };
}

async function puxar(
  sb: SupabaseClient, token: string, agenda: Agenda, limiteEm: number,
): Promise<{ entraram: number; sumiram: number; syncToken: string | null }> {
  let entraram = 0;
  let sumiram = 0;
  let pagina: string | null = null;
  let novoToken: string | null = null;
  let usarSync = agenda.syncToken;

  for (let volta = 0; volta < 20; volta += 1) {
    if (Date.now() > limiteEm) break;

    const q = new URLSearchParams({ maxResults: '250', singleEvents: 'true' });
    if (usarSync) {
      // Com cursor: so o que mudou desde a ultima vez.
      q.set('syncToken', usarSync);
    } else {
      const de = new Date(); de.setDate(de.getDate() - DIAS_PARA_TRAS);
      const ate = new Date(); ate.setDate(ate.getDate() + DIAS_PARA_FRENTE);
      q.set('timeMin', de.toISOString());
      q.set('timeMax', ate.toISOString());
    }
    if (pagina) q.set('pageToken', pagina);

    const r = await fetch(
      `${GOOGLE_CAL}/calendars/${encodeURIComponent(agenda.calendarId)}/events?${q}`,
      { headers: { authorization: `Bearer ${token}` } },
    );

    if (r.status === 410 && usarSync) {
      // O Google venceu o cursor. Recomeca a janela inteira, uma vez.
      usarSync = null;
      pagina = null;
      continue;
    }
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(
        r.status === 404
          ? 'O robô não enxerga esta agenda. Confira se ela foi compartilhada com ' +
            'o endereço da conta de serviço, com permissão de fazer alterações.'
          : `O Google recusou a leitura (${r.status}): ${d?.error?.message ?? ''}`.trim(),
      );
    }

    const dados = await r.json();
    for (const ev of (dados.items ?? []) as Record<string, any>[]) {
      if (ev.status === 'cancelled') {
        const { data: achou } = await sb.rpc('apagar_compromisso_do_google', {
          p_calendar_id: agenda.calendarId, p_event_id: ev.id,
        });
        if (achou) sumiram += 1;
        continue;
      }
      const diaInteiro = Boolean(ev.start?.date);
      const inicio = diaInteiro
        ? `${ev.start.date}T00:00:00-03:00`
        : ev.start?.dateTime;
      if (!inicio) continue;

      const { error } = await sb.rpc('aplicar_evento_do_google', {
        p_user: agenda.userId,
        p_calendar_id: agenda.calendarId,
        p_event_id: ev.id,
        p_titulo: ev.summary ?? null,
        p_quando: new Date(inicio).toISOString(),
        p_termina_em: diaInteiro || !ev.end?.dateTime
          ? null
          : new Date(ev.end.dateTime).toISOString(),
        p_dia_inteiro: diaInteiro,
        p_local: ev.location ?? null,
        p_observacao: ev.description ?? null,
        p_fuso: ev.start?.timeZone ?? 'America/Sao_Paulo',
      });
      if (error) throw new Error(`aplicar_evento_do_google: ${error.message}`);
      entraram += 1;
    }

    pagina = dados.nextPageToken ?? null;
    novoToken = dados.nextSyncToken ?? novoToken;
    if (!pagina) break;
  }

  return { entraram, sumiram, syncToken: novoToken };
}

// --- A porta ----------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, erro: 'Use POST.' });

  const faltando = (['TICK_SECRET', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_PRIVATE_KEY'] as const)
    .filter((nome) => !Deno.env.get(nome)?.trim());
  if (faltando.length > 0) {
    return json(500, {
      ok: false,
      erro:
        `Faltam variáveis nesta função: ${faltando.join(', ')}. ` +
        'Defina em Settings > Edge Functions > Secrets. A GOOGLE_SA_PRIVATE_KEY é a ' +
        'chave privada do arquivo JSON da conta de serviço, inteira, incluindo as ' +
        'linhas BEGIN e END.',
    });
  }
  if (req.headers.get('x-tick-secret') !== Deno.env.get('TICK_SECRET')) {
    return json(401, { ok: false, erro: 'Requisição não autorizada.' });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !chave) return json(500, { ok: false, erro: 'Function mal configurada.' });

  const sb = createClient(url, chave, { auth: { persistSession: false } });
  const limiteEm = Date.now() + LIMITE_TEMPO_MS;

  let token: string;
  try {
    token = await tokenDoRobo(
      Deno.env.get('GOOGLE_SA_EMAIL')!.trim(),
      Deno.env.get('GOOGLE_SA_PRIVATE_KEY')!,
    );
  } catch (x) {
    const erro = x instanceof Error ? x.message : 'Falha ao autenticar no Google.';
    console.error(JSON.stringify({ nivel: 'erro', detalhe: erro }));
    return json(502, { ok: false, erro });
  }

  const resumo: Record<string, unknown> = {};
  try {
    resumo.enviados = await empurrar(sb, token, limiteEm);
    resumo.desmarcados = await apagarLa(sb, token, limiteEm);
  } catch (x) {
    resumo.falhaGeral = x instanceof Error ? x.message : String(x);
  }

  const { data: agendas, error } = await sb.rpc('agendas_google_ativas');
  if (error) return json(500, { ok: false, erro: `agendas_google_ativas: ${error.message}` });

  const porAgenda: unknown[] = [];
  for (const g of (agendas ?? []) as Agenda[]) {
    if (Date.now() > limiteEm) break;
    try {
      const r = await puxar(sb, token, g, limiteEm);
      await sb.rpc('registrar_sincronia', {
        p_user: g.userId, p_sync_token: r.syncToken, p_erro: null,
      });
      porAgenda.push({ pessoa: g.nome, ...r });
    } catch (x) {
      // Falha silenciosa e proibida: o erro fica gravado na linha da pessoa e
      // aparece em Ajustes, em portugues.
      const erro = x instanceof Error ? x.message : String(x);
      await sb.rpc('registrar_sincronia', {
        p_user: g.userId, p_sync_token: null, p_erro: erro,
      });
      porAgenda.push({ pessoa: g.nome, erro });
    }
  }

  return json(200, { ok: true, ...resumo, agendas: porAgenda });
});
