#!/usr/bin/env node
// Diz se as esteiras do repositorio estao verdes AGORA, na `main`.
//
// Existe por um erro concreto e caro. A `funcoes.yml` ficou vermelha por quinze
// dias, em duas rodadas seguidas, e eu escrevi "verde" na mensagem de dois
// commits — baseado no que eu tinha rodado na MINHA maquina. O que o CI dizia
// era `permission denied for function limites_de_midia`, e a consequencia foi
// que nenhuma Edge Function subiu nesse periodo: a funcao que devolve a capa da
// galeria estava no repositorio e nao estava no ar.
//
// O `docs/arquitetura.md` ja mandava "conferir que os dois workflows estao
// verdes". Mandar nao basta quando conferir da trabalho: eu nao conferi.
// Entao vira um comando.
//
//   node scripts/conferir-esteiras.mjs
//
// Usa o `gh` quando ele existe (e o caminho autenticado), e cai para a API
// publica do GitHub quando nao. Repositorio publico responde sem token.
import { execFileSync } from 'node:child_process';

const REPO = process.env['REPO'] ?? 'omniaengenharia1-sketch/astart-plataforma';
const RAMO = process.env['RAMO'] ?? 'main';

function pelaApi(caminho) {
  return fetch(`https://api.github.com/repos/${REPO}${caminho}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'astart-conferir-esteiras' },
  }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GitHub respondeu ${r.status}`))));
}

function pelaCli(caminho) {
  try {
    return JSON.parse(
      execFileSync('gh', ['api', `repos/${REPO}${caminho}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
    );
  } catch {
    return null;
  }
}

const buscar = async (caminho) => pelaCli(caminho) ?? (await pelaApi(caminho));

const { workflows } = await buscar('/actions/workflows');
const falhando = [];

console.log(`esteiras de ${REPO}, ramo ${RAMO}\n`);

for (const w of workflows.filter((x) => x.state === 'active')) {
  const { workflow_runs: rodadas } = await buscar(
    `/actions/workflows/${w.id}/runs?branch=${RAMO}&per_page=1`,
  );
  const r = rodadas[0];
  if (!r) {
    console.log(`  ?   ${w.name.padEnd(14)} nunca rodou na ${RAMO}`);
    // Esteira que nunca rodou nao e esteira — foi a decima oitava armadilha.
    falhando.push(`${w.name} (nunca rodou)`);
    continue;
  }
  const verde = r.conclusion === 'success';
  const emCurso = r.status !== 'completed';
  const marca = emCurso ? '…' : verde ? 'OK' : 'X ';
  console.log(
    `  ${marca}  ${w.name.padEnd(14)} ${(r.conclusion ?? r.status).padEnd(10)} ` +
      `${r.created_at.slice(0, 16).replace('T', ' ')}  ${r.head_sha.slice(0, 7)}`,
  );
  if (!verde && !emCurso) falhando.push(`${w.name} — ${r.html_url}`);
}

if (falhando.length > 0) {
  console.log(`\nVERMELHO (${falhando.length}):\n  ${falhando.join('\n  ')}`);
  console.log('\nNao escreva "verde" em commit nenhum ate isto aqui estar limpo.');
  process.exit(1);
}
console.log('\nAs esteiras estao verdes.');
