-- =============================================================================
-- Smoke da 0043. O que este teste cobra:
--   1. operação não lê o mapa das chaves — é leitura de direção;
--   2. banco sem chave nenhuma: a Meta aparece com as quatro faltando;
--   3. cadastrada uma chave, ela sai da lista de faltando;
--   4. a resposta NUNCA traz o valor de um segredo — a cobrança mais
--      importante deste arquivo;
--   5. integração não construída aparece como tal, para a tela não mostrar
--      "falta a chave" quando o que falta é o código.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'operacao@astartstudio.com.br');

-- `email` nao e opcional aqui: a 0013 cobra que perfil ativo tenha e-mail,
-- porque sem ele nao ha como convidar nem identificar a pessoa.
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Direcao',  'admin',    true, 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Operacao', 'operacao', true, 'operacao@astartstudio.com.br');

-- ---------------------------------------------------------------------------
-- 1. operação não vê
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000002', false);
  perform public.afirma(
    public.estado_dos_conectores() is null,
    'operacao recebe nulo, nao uma versao filtrada'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2. a casa sem chave nenhuma
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_meta jsonb;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  v := public.estado_dos_conectores();

  perform public.afirma(v is not null, 'admin recebe o mapa');
  perform public.afirma(jsonb_array_length(v) = 3, 'as tres integracoes aparecem');

  select x into v_meta from jsonb_array_elements(v) x where x->>'id' = 'meta';
  perform public.afirma(v_meta is not null, 'a Meta esta no mapa');
  perform public.afirma((v_meta->>'construida')::boolean, 'a Meta aparece como construida');
  perform public.afirma(
    jsonb_array_length(v_meta->'faltando') = 4,
    format('as quatro chaves de Vault da Meta faltam num banco novo, achei %s', v_meta->'faltando')
  );

  -- As variaveis da Edge Function nao dao para conferir daqui, e a resposta
  -- diz isso com `presente = null` em vez de chutar `false`.
  perform public.afirma(
    exists (
      select 1 from jsonb_array_elements(v_meta->'chaves') k
       where k->>'onde' = 'funcao' and k->'presente' = 'null'::jsonb
    ),
    'chave de Edge Function vem com presente nulo, nao falso'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3. cadastrando uma
-- ---------------------------------------------------------------------------
select vault.create_secret('https://exemplo.supabase.co/functions/v1/publicar-tick', 'publicar_tick_url');

do $$
declare
  v_meta jsonb;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  select x into v_meta from jsonb_array_elements(public.estado_dos_conectores()) x where x->>'id' = 'meta';

  perform public.afirma(
    jsonb_array_length(v_meta->'faltando') = 3,
    'a chave cadastrada sai da lista de faltando'
  );
  perform public.afirma(
    not (v_meta->'faltando' @> '"publicar_tick_url"'::jsonb),
    'e e justamente ela que saiu'
  );
  perform public.afirma(
    exists (
      select 1 from jsonb_array_elements(v_meta->'chaves') k
       where k->>'chave' = 'publicar_tick_url' and (k->>'presente')::boolean
    ),
    'a chave aparece como presente'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4. A cobranca que mais importa: o valor nao pode aparecer.
--
-- Um segredo com valor reconhecivel, e a resposta inteira virada em texto. Se
-- em algum dia alguem trocar `vault.secrets` por `vault.decrypted_secrets`
-- "para mostrar os ultimos quatro digitos", este teste cai na hora.
-- ---------------------------------------------------------------------------
select vault.create_secret('TOKEN-SUPER-SECRETO-DA-META-123', 'meta_system_user_token');

do $$
declare
  v_texto text;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  v_texto := public.estado_dos_conectores()::text;

  perform public.afirma(
    position('TOKEN-SUPER-SECRETO' in v_texto) = 0,
    'o valor do segredo NAO aparece na resposta'
  );
  -- E o nome aparece, senao a tela nao teria o que mostrar.
  perform public.afirma(
    position('meta_system_user_token' in v_texto) > 0,
    'o nome da chave aparece, que e o que a tela precisa'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 5. o que falta e o codigo, nao a chave
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  v := public.estado_dos_conectores();

  perform public.afirma(
    (select count(*) from jsonb_array_elements(v) x
      where x->>'id' in ('asaas', 'anthropic') and not (x->>'construida')::boolean) = 2,
    'Asaas e Anthropic aparecem como ainda nao construidas'
  );
end $$;

select 'integracoes conferidas' as resultado;
