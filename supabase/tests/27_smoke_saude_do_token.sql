-- =============================================================================
-- Smoke da 0048. O que este teste cobra:
--   1. as duas chaves novas entraram, e como OPCIONAIS — chave opcional não
--      pode fazer a tela de Integrações acusar falta vermelha;
--   2. sem nenhuma das duas, `credenciais_do_app_meta()` devolve ZERO LINHA, e
--      não exceção: a conferência tem um caminho degradado que depende disso;
--   3. com só uma das duas, LEVANTA — meia configuração é erro, e silenciar
--      aqui montaria `app_id|undefined` e mandaria para a Meta;
--   4. com as duas, devolve o par;
--   5. nem anon nem authenticated executam — é leitura de segredo;
--   6. anon não tem privilégio nas tabelas de conector (o conserto da 0043).
--
-- O que este arquivo NÃO cobra, e é bom dizer: se a resposta da Meta é lida
-- certo. Isso é TypeScript, mora na Edge Function, e nenhum teste de SQL
-- alcança. É a mesma fronteira do CORS, que me custou caro nesta semana.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

-- Um admin, porque `estado_dos_conectores()` devolve NULO para quem nao e.
--
-- Isto faltava, e a falta se disfarcou de vazamento de segredo: a assercao
-- `position('SEGREDO' in resposta) = 0` virou `position('SEGREDO' in NULL)`,
-- que e NULL, que nao e `true`, que o `afirma` recusa. A mensagem dizia "o
-- valor do app_secret aparece na resposta" quando resposta nenhuma havia.
--
-- Licao, e ela vale para toda assercao de ausencia: provar que algo NAO esta
-- numa resposta exige antes provar que a resposta EXISTE. Senao o teste passa a
-- acusar duas coisas diferentes com a mesma frase — e a frase escolhe a
-- errada.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'direcao@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Direcao', 'admin', true, 'direcao@astartstudio.com.br');

-- ---------------------------------------------------------------------------
-- 1. as chaves novas, e opcionais
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.afirma(
    (select count(*) from public.conector_chaves
      where conector_id = 'meta' and chave in ('meta_app_id', 'meta_app_secret')) = 2,
    'as duas chaves do app entraram no registro'
  );
  perform public.afirma(
    not exists (
      select 1 from public.conector_chaves
       where conector_id = 'meta' and chave in ('meta_app_id', 'meta_app_secret')
         and obrigatoria
    ),
    'e entraram como OPCIONAIS: sem elas a conferencia ainda funciona, degradada'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2. nenhuma das duas: zero linha, nao excecao
--
-- Parece detalhe e nao e. A Edge Function faz `credenciais[0]` e, quando nao
-- ha, confere o token com o proprio token. Trocar isto por uma excecao
-- derrubaria a conferencia em toda instalacao que nao cadastrou o app — que e
-- justamente a instalacao que mais precisa de diagnostico.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.afirma(
    (select count(*) from public.credenciais_do_app_meta()) = 0,
    'sem as chaves, devolve zero linha'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3. meia configuracao levanta
-- ---------------------------------------------------------------------------
select vault.create_secret('1234567890', 'meta_app_id');

do $$
declare ok boolean;
begin
  begin
    perform * from public.credenciais_do_app_meta();
    ok := false;
  exception when others then
    -- A mensagem tem de DIZER QUAL FALTA. "Configuracao invalida" faria a
    -- pessoa conferir as duas.
    ok := position('pela metade' in sqlerrm) > 0
      and position('meta_app_secret' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'com so o id, levanta dizendo que falta o secret');
end $$;

-- ---------------------------------------------------------------------------
-- 4. com as duas, devolve o par
-- ---------------------------------------------------------------------------
select vault.create_secret('SEGREDO-DO-APP-DA-META-999', 'meta_app_secret');

do $$
declare
  v_id  text;
  v_seg text;
begin
  select c.app_id, c.app_secret into v_id, v_seg from public.credenciais_do_app_meta() c;
  perform public.afirma(v_id = '1234567890', 'devolve o app_id');
  perform public.afirma(v_seg = 'SEGREDO-DO-APP-DA-META-999', 'e o app_secret');
end $$;

-- ---------------------------------------------------------------------------
-- 5. quem pode executar
--
-- Esta funcao LE SEGREDO EM CLARO. É a única razão de ela ser SECURITY
-- DEFINER, e é a razão de o teste 23 (declarações) e este cobrarem o grant em
-- dois lugares: um grant a mais aqui vale um token da agência.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.afirma(
    not has_function_privilege('anon', 'public.credenciais_do_app_meta()', 'EXECUTE'),
    'anon nao executa'
  );
  perform public.afirma(
    not has_function_privilege('authenticated', 'public.credenciais_do_app_meta()', 'EXECUTE'),
    'authenticated tambem nao — nem a direcao logada le segredo em claro'
  );
  perform public.afirma(
    has_function_privilege('service_role', 'public.credenciais_do_app_meta()', 'EXECUTE'),
    'service_role executa, que e a Edge Function'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 6. o conserto da 0043
--
-- As duas tabelas nasceram com o grant que o `alter default privileges` do
-- Supabase da ao anon. Com RLS ligada e politica so `to authenticated`, anon
-- chegava a zero linha — mas privilegio sem politica e porta trancada por fora.
-- O teste 08 ja cobrava isto em geral e estava vermelho; aqui fica nominal,
-- para o dia em que alguem criar a terceira tabela de conector.
-- ---------------------------------------------------------------------------
do $$
declare achou text;
begin
  select string_agg(format('%s.%s', t, v), ', ') into achou
    from unnest(array['conectores', 'conector_chaves']) as t
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) as v
   where has_table_privilege('anon', format('public.%I', t), v);
  perform public.afirma(achou is null, format('anon ainda tem privilegio em: %s', achou));
end $$;

-- ---------------------------------------------------------------------------
-- 7. A data da chave (0049)
--
-- O diagnostico que NAO depende da Meta. Virou necessario porque a conferencia
-- da 0048 tinha um buraco que apareceu no caso real: para perguntar
-- `debug_token` voce precisa de um token valido, e sem o app token cadastrado o
-- unico token disponivel e o que morreu. A pergunta morria com ele.
--
-- Token de usuario do sistema NAO EXPIRA, entao "cadastrada ha 11 horas e a
-- Meta ja recusa" fecha o caso sem uma chamada de rede.
-- ---------------------------------------------------------------------------
do $$
declare
  v_quando timestamptz;
  v_texto  text;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  v_quando := public.quando_a_chave_mudou('meta_app_id');
  perform public.afirma(v_quando is not null, 'devolve a data de uma chave que existe');
  perform public.afirma(
    v_quando <= now() and v_quando > now() - interval '1 hour',
    'e a data e de agora, nao do epoch'
  );

  perform public.afirma(
    public.quando_a_chave_mudou('chave_que_nunca_existiu') is null,
    'chave que nao existe devolve nulo, nao excecao'
  );

  -- A data entra na tela de Integracoes, e o VALOR continua fora dela. Esta
  -- afirmacao e irma da do item 4 do teste 24: so que agora a resposta carrega
  -- um campo novo, e campo novo e onde segredo vaza.
  --
  -- A resposta e conferida ANTES: ausencia de segredo numa resposta vazia nao
  -- prova nada, e foi exatamente a confusao que este arquivo criou na primeira
  -- versao.
  v_texto := public.estado_dos_conectores()::text;
  perform public.afirma(
    v_texto is not null and v_texto <> 'null',
    'o admin recebe o mapa (sem isto, a assercao de baixo nao prova nada)'
  );
  perform public.afirma(
    position('SEGREDO-DO-APP-DA-META' in v_texto) = 0,
    'o valor do app_secret NAO aparece na resposta, mesmo com a data entrando'
  );
  perform public.afirma(
    position('atualizadaEm' in v_texto) > 0,
    'e a data aparece, que e o que a tela precisa'
  );

  -- Chave de Edge Function nao da para conferir daqui: nem presenca, nem data.
  perform public.afirma(
    exists (
      select 1
        from jsonb_array_elements(public.estado_dos_conectores()) c,
             jsonb_array_elements(c->'chaves') k
       where k->>'onde' = 'funcao' and k->'atualizadaEm' = 'null'::jsonb
    ),
    'chave de funcao vem com data nula, nao chutada'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 8. Quem pode ler a data
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.afirma(
    not has_function_privilege('anon', 'public.quando_a_chave_mudou(text)', 'EXECUTE'),
    'anon nao le a data'
  );
  perform public.afirma(
    not has_function_privilege('authenticated', 'public.quando_a_chave_mudou(text)', 'EXECUTE'),
    'authenticated tambem nao: quem quiser a data pelo navegador usa '
    'estado_dos_conectores(), que passa pelo portao de admin'
  );
  perform public.afirma(
    has_function_privilege('service_role', 'public.quando_a_chave_mudou(text)', 'EXECUTE'),
    'service_role le, que e a Edge Function'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 9. O formato do token (0050)
--
-- Separa "o texto esta quebrado" de "o token esta morto". Veio de uma correcao
-- de rota: eu concluira que o token era curto e tinha expirado, e o banco
-- desmentiu — a chave havia sido trocada doze minutos antes e era recusada
-- igual. Token nenhum expira em doze minutos; o que quebra e o texto.
--
-- A cobranca que mais importa aqui e a mesma do teste 24: NADA do valor pode
-- aparecer na resposta. So sim, nao, e o tamanho.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  -- Sem chave nenhuma: diz que nao esta cadastrada, e nao estoura.
  perform public.afirma(
    (public.formato_do_token_meta()->>'cadastrada')::boolean is false,
    'sem a chave, responde cadastrada=false'
  );
end $$;

-- Token com as tres doencas de uma vez: aspas, quebra de linha, e curto.
select vault.create_secret(E'  "EAAcurtinho"\n ', 'meta_system_user_token');

do $$
declare v jsonb;
begin
  v := public.formato_do_token_meta();

  perform public.afirma((v->>'cadastrada')::boolean, 'cadastrada');
  perform public.afirma((v->>'pontasSujas')::boolean, 'acusa espaco/quebra nas pontas');
  perform public.afirma((v->>'temQuebraDeLinha')::boolean, 'acusa a quebra de linha');
  perform public.afirma((v->>'temAspas')::boolean, 'acusa as aspas dentro do valor');
  perform public.afirma(
    not (v->>'soCaracteresEsperados')::boolean,
    'e as aspas tambem caem no alfabeto de token'
  );
  -- O tamanho e do valor APARADO: senao o espaco contaria como token.
  perform public.afirma((v->>'tamanho')::int = 13, format('tamanho do valor aparado, achei %s', v->>'tamanho'));

  -- A cobranca central: nem o valor, nem pedaco dele.
  perform public.afirma(
    position('curtinho' in v::text) = 0,
    'NADA do valor aparece na resposta do formato'
  );
end $$;

-- E `token_do_sistema()` passa a devolver o valor APARADO (o defeito da 0044:
-- o btrim existia na linha de cima, usado so para decidir se estava vazio).
do $$
declare v_token text;
begin
  v_token := public.token_do_sistema();
  perform public.afirma(
    v_token = '"EAAcurtinho"',
    format('o token sai sem espaco e sem quebra de linha, achei [%s]', v_token)
  );
end $$;

-- O CASO REAL (0051): token certo, colado dentro do marcador de lugar.
--
-- A instrucao dizia `'<valor novo>'`, e a leitura natural disso e "troque
-- `valor novo` pelo token" — nao "apague os sinais tambem". O valor foi para o
-- Vault como `<TOKEN>`, a Meta recusou com 190, e 190 e a MESMA mensagem de
-- token expirado. Eu fui atras de validade por duas migrations.
--
-- Por isso o sinalizador e proprio: "tem caracteres estranhos" manda procurar;
-- "tire o < e o >" se resolve em cinco segundos.
select vault.update_secret(
  (select id from vault.secrets where name = 'meta_system_user_token'),
  '<' || 'EAA' || repeat('z', 193) || '>'
);

do $$
declare v jsonb;
begin
  v := public.formato_do_token_meta();
  perform public.afirma((v->>'temSinaisDeMarcador')::boolean, 'acusa os sinais do marcador');
  perform public.afirma(
    not (v->>'comecaComEAA')::boolean,
    'e nao comeca com EAA, porque o < esta na frente'
  );
  perform public.afirma(
    not (v->>'soCaracteresEsperados')::boolean,
    'os sinais tambem caem no alfabeto'
  );
  -- Nenhum outro sinalizador acende: o token DENTRO dos sinais esta perfeito, e
  -- a tela nao pode mandar a pessoa gerar outro.
  perform public.afirma(not (v->>'temAspas')::boolean,    'sem aspas');
  perform public.afirma(not (v->>'pontasSujas')::boolean, 'sem espaco nas pontas');
end $$;

-- Token bem formado: nenhum sinalizador aceso.
select vault.update_secret(
  (select id from vault.secrets where name = 'meta_system_user_token'),
  'EAA' || repeat('x', 200)
);

do $$
declare v jsonb;
begin
  v := public.formato_do_token_meta();
  perform public.afirma(not (v->>'pontasSujas')::boolean,           'valor limpo: pontas ok');
  perform public.afirma(not (v->>'temAspas')::boolean,              'valor limpo: sem aspas');
  perform public.afirma(not (v->>'temSinaisDeMarcador')::boolean,   'valor limpo: sem < e >');
  perform public.afirma((v->>'soCaracteresEsperados')::boolean,     'valor limpo: alfabeto ok');
  perform public.afirma((v->>'comecaComEAA')::boolean,              'valor limpo: comeca com EAA');
  perform public.afirma((v->>'tamanho')::int = 203,                 'valor limpo: tamanho certo');
end $$;

-- ---------------------------------------------------------------------------
-- 10. Quem pode ler o formato
--
-- Esta funcao LE O SEGREDO EM CLARO para medi-lo. Nao devolve nada dele, e
-- continua sendo service_role: o que protege a chave e o grant, nao a boa
-- intencao do corpo da funcao.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.afirma(
    not has_function_privilege('anon', 'public.formato_do_token_meta()', 'EXECUTE'),
    'anon nao executa'
  );
  perform public.afirma(
    not has_function_privilege('authenticated', 'public.formato_do_token_meta()', 'EXECUTE'),
    'authenticated tambem nao — ela descriptografa para medir'
  );
  perform public.afirma(
    has_function_privilege('service_role', 'public.formato_do_token_meta()', 'EXECUTE'),
    'service_role executa, que e a Edge Function'
  );
end $$;

select 'saude do token conferida' as resultado;
