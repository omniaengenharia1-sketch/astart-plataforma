#!/usr/bin/env bash
# Roda TODOS os roteiros de tela e soma as falhas.
#
# Existe por um erro concreto: o `calendario.mjs` procurava um botao "Nova peça"
# que a 0046 renomeou para "Nova publicação". Ele quebrava na primeira linha, e
# com ele pararam de ser cobradas as outras trinta verificacoes do arquivo —
# navegacao de mes, envio ao cliente, o portal do cliente, a grade no celular.
# Ficou assim por uma semana, porque eu rodava o roteiro do que eu estava
# mexendo, nao todos.
#
# Roteiro que nao roda e pior que roteiro que falha: ele parece verde.
#
# A mesma licao do `supabase/tests/rodar.sh`, que ja casava `[0-9][0-9]_` depois
# de pular o `10_` em silencio por uma rodada inteira.
#
# Uso:
#   # 1. construir em MODO EXEMPLO (sem as variaveis do Supabase), porque os
#   #    roteiros entram pelas personas de exemplo, nao por login de verdade:
#   mv .env.local /tmp/ && npx vite build --outDir dist-exemplo ; mv /tmp/.env.local .
#   # 2. servir:
#   npx vite preview --outDir dist-exemplo --port 4178 --strictPort &
#   # 3. rodar:
#   ./rodar-telas.sh
#
# `aovivo.mjs` fica FORA de proposito: ele bate no site publicado, depende de
# rede e de deploy, e misturar os dois faria uma falha de internet parecer
# defeito de tela.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

BASE="${BASE:-http://localhost:4178}"
ROTEIROS=(
  telas acessos link midia senha galeria olhar cadastro arquivos
  acessibilidade tema calendario compositor contraste projeto
)

if ! curl -sf -o /dev/null "$BASE"; then
  echo "FALHOU: nada respondendo em $BASE."
  echo "Suba o preview em modo exemplo antes (veja o cabecalho deste arquivo)."
  exit 1
fi

falharam=()
for r in "${ROTEIROS[@]}"; do
  if [ ! -f "$r.mjs" ]; then
    echo "FALTA  $r.mjs — esta na lista e nao existe no disco"
    falharam+=("$r (arquivo ausente)")
    continue
  fi

  printf '===== %s\n' "$r"
  if saida=$(BASE="$BASE" node "$r.mjs" 2>&1); then
    echo "$saida" | tail -3
    echo "OK  $r"
  else
    echo "$saida" | tail -25
    echo "FALHOU  $r"
    falharam+=("$r")
  fi
done

echo
# Um roteiro novo que ninguem poe na lista acima tambem e roteiro que nao roda.
# Entao a lista e conferida contra o disco, nos dois sentidos.
# Fora da lista de proposito: `navegador` e biblioteca, `aovivo` bate no site
# publicado, e `onde-fica` so tira foto de onde um botao esta — nao verifica
# nada, entao passar ou falhar nao diz nada sobre a plataforma. `prerender` nao
# verifica, ele GERA, e roda dentro do `npm run build`. `provar-politicas` bate
# no site publicado, como o `aovivo`.
no_disco=$(ls *.mjs 2>/dev/null | sed 's/\.mjs$//' \
  | grep -vx -e navegador -e aovivo -e onde-fica -e onde-arquivos -e prerender -e provar-politicas \
  | sort)
na_lista=$(printf '%s\n' "${ROTEIROS[@]}" | sort)
esquecidos=$(comm -23 <(echo "$no_disco") <(echo "$na_lista"))
if [ -n "$esquecidos" ]; then
  echo "ESQUECIDOS na lista do rodar-telas.sh (existem no disco e ninguem roda):"
  echo "$esquecidos" | sed 's/^/  /'
  falharam+=("roteiros fora da lista")
fi

if [ ${#falharam[@]} -gt 0 ]; then
  echo "FALHARAM ${#falharam[@]}: ${falharam[*]}"
  exit 1
fi
echo "OK  ${#ROTEIROS[@]} roteiros de tela"
