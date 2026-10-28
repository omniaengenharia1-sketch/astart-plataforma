-- 0059 — o prover de canais volta a conseguir ler os limites em producao.
--
-- A esteira `funcoes.yml` esta VERMELHA desde 13 de outubro, em duas rodadas
-- seguidas, e eu nao olhei. Pior: escrevi "verde, prover nos 8 canais" na
-- mensagem do commit, baseado na minha rodada LOCAL. O que o CI dizia era:
--
--   FALHOU: a API respondeu 400:
--   ERROR: 42501: permission denied for function limites_de_midia
--
-- Consequencia real: as Edge Functions nunca foram publicadas desde entao. A
-- `galeria/index.ts` que devolve a capa (0057) esta no repositorio e NAO esta
-- no ar — e por isso a capa nao aparecia pelo link da cliente.
--
-- A CAUSA. A 0056 escreveu, por habito:
--
--   revoke all on function public.limites_de_midia(...) from public, anon;
--   grant execute ... to authenticated, service_role;
--
-- O `scripts/provar-canais.mjs --producao` consulta pela Management API com
-- `read_only: true`, e nesse modo o Supabase roda a consulta como
-- `supabase_read_only_user` — que nao e nenhum dos dois. Medido no projeto:
--
--   papel                      executa limites_de_midia   le formatos_suportados
--   supabase_read_only_user    NAO                        sim
--   authenticated              sim                        sim
--   postgres                   sim                        sim
--
-- Ele le a tabela e tropeca na funcao. O prover precisa das duas.
--
-- A SAIDA ESCOLHIDA, e as que foram descartadas:
--
--   tirar `read_only: true` do prover — rodaria como `postgres`, que pode
--   escrever. Trocar uma trava de seguranca por conveniencia num script que so
--   le e o caminho errado.
--
--   grant para `anon` — o `23_smoke_declaracoes` cobra que `anon` nao executa
--   NADA, e essa regra vale mais que este caso.
--
--   dar o grant a quem de fato precisa. `limites_de_midia` e constante: ela
--   devolve "carrossel aceita de 2 a 10 imagens" e nada mais. Nao ha segredo a
--   proteger, e o papel ja le a tabela irma.
--
-- O `if exists` nao e cosmetico: `supabase_read_only_user` e papel do Supabase
-- gerenciado, e nao existe no Postgres cru onde `supabase/tests/rodar.sh` roda.
-- Sem o guarda, esta migration quebraria a suite inteira de testes locais.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    execute 'grant execute on function public.limites_de_midia(public.tipo_post)
               to supabase_read_only_user';
  end if;
end $$;

-- E a licao de metodo, que vale mais que o grant: "verde" nao e o que eu rodei
-- na minha maquina, e o que a esteira diz. O `scripts/conferir-esteiras.mjs`
-- passa a responder isso em um comando, para a afirmacao deixar de depender da
-- minha memoria.
