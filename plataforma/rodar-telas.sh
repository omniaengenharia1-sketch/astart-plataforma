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
# DUAS LISTAS DE ROTEIROS ERAM UMA LISTA A MAIS
#
# Este arquivo tinha uma lista de 15 roteiros e o `npm run roteiros` tinha
# outra, de 26. Treze roteiros existiam no disco e esta lista nao os chamava —
# e a conferencia la embaixo, que existe exatamente para apontar isso, nunca
# foi vista porque a cadeia que eu rodava era a outra.
#
# Agora ha uma lista so: esta. O `npm run roteiros` chama este arquivo.
#
# As instrucoes de build tambem estavam velhas: diziam `--outDir dist-exemplo`,
# e o `navegador.mjs` confere a idade de `dist/index.html`. Quem seguisse o
# cabecalho construia numa pasta e era conferido contra a outra.
#
# Uso:
#   npm run roteiros          # constroi, sobe o preview, roda tudo
#   ./rodar-telas.sh          # so roda (precisa do preview no ar)
#
# `aovivo.mjs` fica FORA de proposito: ele bate no site publicado, depende de
# rede e de deploy, e misturar os dois faria uma falha de internet parecer
# defeito de tela.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

BASE="${BASE:-http://localhost:4178}"
# A ORDEM IMPORTA. `barreira` e `versao` primeiro: eles conferem que o bundle
# no ar e o do disco e que o modo exemplo esta de fato em modo exemplo. Falhar
# neles invalida todos os outros, e e melhor saber na primeira linha.
ROTEIROS=(
  barreira versao enderecos
  telas olhar tema link senha midia compositor projeto
  cadastro contrato cobranca lancamento arquivos
  calendario agenda google acessos galeria tarefas comercial
  tipografia safari acessibilidade contraste
)

# O PREVIEW SOBE AQUI, se ninguem respondeu.
#
# Antes era tarefa de quem rodava, e esquecer dela nao dava erro: dava
# "FALHOU: nada respondendo". Pior, quem deixava um preview VELHO no ar rodava
# a cadeia inteira contra o bundle anterior — o `navegador.mjs` existe por
# causa disso. Subir aqui, depois do build, fecha a porta.
NOSSO_PREVIEW=""
if ! curl -sf -o /dev/null "$BASE"; then
  if [ "$BASE" != "http://localhost:4178" ]; then
    echo "FALHOU: nada respondendo em $BASE."
    exit 1
  fi
  if [ ! -f dist/index.html ]; then
    echo "FALHOU: nao ha dist/index.html. Rode \`npm run build:exemplo\` primeiro."
    exit 1
  fi
  echo "subindo o preview em $BASE..."
  npx vite preview --port 4178 --strictPort > /tmp/preview-roteiros.log 2>&1 &
  NOSSO_PREVIEW=$!
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null "$BASE" && break
    sleep 0.5
  done
  if ! curl -sf -o /dev/null "$BASE"; then
    echo "FALHOU: o preview nao subiu. Veja /tmp/preview-roteiros.log"
    kill "$NOSSO_PREVIEW" 2>/dev/null
    exit 1
  fi
fi
# Derrubar o que subimos, inclusive se alguem apertar Ctrl-C no meio: preview
# esquecido no ar e o que faz a proxima rodada testar o bundle de ontem.
trap '[ -n "$NOSSO_PREVIEW" ] && kill "$NOSSO_PREVIEW" 2>/dev/null' EXIT INT TERM

falharam=()
for r in "${ROTEIROS[@]}"; do
  if [ ! -f "$r.mjs" ]; then
    echo "FALTA  $r.mjs — esta na lista e nao existe no disco"
    falharam+=("$r (arquivo ausente)")
    continue
  fi
  # Rodar por `node $r.mjs` deixava de fora a flag de cada roteiro: o
  # `enderecos` precisa de `--experimental-strip-types` e morria aqui com erro
  # de sintaxe, nao com defeito de tela. A flag certa mora no package.json.
  if ! node -e "process.exit(require('./package.json').scripts['$r'] ? 0 : 1)"; then
    echo "FALTA  o script \"$r\" no package.json"
    falharam+=("$r (sem script npm)")
    continue
  fi

  printf '===== %s\n' "$r"
  if saida=$(BASE="$BASE" npm run -s "$r" 2>&1); then
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
# no site publicado, como o `aovivo`. `entrega-producao` tambem bate em
# producao e pede um token de galeria como argumento. `safari` FICA na cadeia:
# o arrastar do quadro de tarefas ficou morto no Safari dela por meses, verde
# no Chromium, e o roteiro ja recusa com instrucao quando falta o WebKit — um
# vermelho que ensina o conserto, em vez de um verde que esconde.
no_disco=$(ls *.mjs 2>/dev/null | sed 's/\.mjs$//' \
  | grep -vx -e navegador -e aovivo -e onde-fica -e onde-arquivos -e prerender \
            -e provar-politicas -e entrega-producao \
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
