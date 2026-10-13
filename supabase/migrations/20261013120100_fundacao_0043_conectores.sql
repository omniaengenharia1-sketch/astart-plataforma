-- 0043 — o caminho das chaves: um lugar para cada uma, e estado honesto.
--
-- A dona pediu "o caminho pras três chaves". O caminho não é só onde a chave
-- mora — é poder OLHAR e saber: está cadastrada? está funcionando? o que falta?
-- Sem isso, "cadastrei a chave da Meta" é fé, e o primeiro post que não sai
-- vira investigação.
--
-- Três decisões que valem explicar:
--
-- 1. Esta função NUNCA devolve valor de chave. Lê `vault.secrets`, que guarda
--    só o nome, e não `vault.decrypted_secrets`, que descriptografa. Não é a
--    mesma coisa com um filtro na frente: aqui a descriptografia não acontece,
--    ponto. O teste 24 cobra isso procurando o valor na resposta.
--
-- 2. O registro diz quais integrações estão CONSTRUÍDAS, e isso aparece na
--    tela. A Asaas e a Anthropic têm o schema e não têm o código — cadastrar a
--    chave delas hoje deixaria segredo parado no Vault, que é segredo que
--    ninguém vigia. A tela precisa dizer isso em vez de mostrar um quadradinho
--    vermelho que parece defeito.
--
-- 3. As variáveis que vivem na Edge Function (META_API_VERSION e companhia) não
--    dão para conferir do banco. Em vez de omitir, elas aparecem com
--    `onde = 'funcao'` e a tela diz "não consigo conferir daqui". Lacuna
--    declarada é lacuna que alguém fecha; lacuna escondida fica.

-- ---------------------------------------------------------------------------
-- O registro
--
-- `conectores`, e nao `integracoes`: o nome estava ocupado. A `0023` ja criou
-- `public.integracoes` para OUTRA coisa — as integracoes instaladas no site do
-- cliente, amarradas a `cliente_servicos`. Estas aqui sao da agencia.
--
-- O `create table if not exists` nao reclamou de nada: nao criou, nao avisou,
-- seguiu. Quem denunciou foi a chave estrangeira, por sorte — `id` text contra
-- `id` uuid. Se as duas tabelas usassem uuid, esta migration teria se pendurado
-- silenciosamente na tabela errada, e o estrago apareceria meses depois.
-- ---------------------------------------------------------------------------
create table if not exists public.conectores (
  id          text primary key,
  nome        text not null,
  para_que    text not null,
  -- Falso enquanto só existe schema. É isto que separa "falta a chave" de
  -- "falta eu escrever o código".
  construida  boolean not null default false,
  ordem       smallint not null default 0,
  criado_em   timestamptz not null default now()
);

create table if not exists public.conector_chaves (
  conector_id text not null references public.conectores(id) on delete cascade,
  chave         text not null,
  -- 'vault'  -> dá para conferir a presença daqui
  -- 'funcao' -> vive nos secrets da Edge Function, fora do alcance do banco
  onde          text not null check (onde in ('vault', 'funcao')),
  obrigatoria   boolean not null default true,
  para_que      text not null,
  primary key (conector_id, chave)
);

alter table public.conectores        enable row level security;
alter table public.conector_chaves  enable row level security;

-- Registro é catálogo, não dado de cliente: quem está logado e ativo pode ler.
-- Escrita não tem política nenhuma, de propósito — muda por migration.
drop policy if exists conectores_le on public.conectores;
create policy conectores_le on public.conectores
  for select to authenticated using (public.usuario_ativo());

drop policy if exists conector_chaves_le on public.conector_chaves;
create policy conector_chaves_le on public.conector_chaves
  for select to authenticated using (public.usuario_ativo());

-- ---------------------------------------------------------------------------
-- As três
-- ---------------------------------------------------------------------------
insert into public.conectores (id, nome, para_que, construida, ordem) values
  ('meta',      'Meta',      'publicar no Instagram e Facebook na hora marcada', true,  1),
  ('asaas',     'Asaas',     'emitir cobrança e saber quem pagou',               false, 2),
  ('anthropic', 'Anthropic', 'ler proposta em PDF e preencher o cadastro',       false, 3)
on conflict (id) do update
   set nome = excluded.nome,
       para_que = excluded.para_que,
       construida = excluded.construida,
       ordem = excluded.ordem;

insert into public.conector_chaves (conector_id, chave, onde, obrigatoria, para_que) values
  ('meta', 'meta_system_user_token', 'vault',  true,  'token do System User do Business Manager da Astart'),
  ('meta', 'tick_secret',            'vault',  true,  'segredo entre o agendador e as funções'),
  ('meta', 'publicar_tick_url',      'vault',  true,  'endereço da função que publica'),
  ('meta', 'renovar_tokens_url',     'vault',  true,  'endereço da função que renova token'),
  ('meta', 'META_API_VERSION',       'funcao', true,  'versão da API da Meta, sem default no código'),
  ('meta', 'TICK_SECRET',            'funcao', true,  'o mesmo valor do tick_secret'),
  ('meta', 'TICK_LOTE_MAX',          'funcao', false, 'quantos posts por rodada'),
  ('meta', 'SIGNED_URL_TTL_SEGUNDOS','funcao', false, 'validade da URL assinada da mídia'),
  ('asaas', 'asaas_api_key',         'vault',  true,  'chave da API da Asaas'),
  ('asaas', 'asaas_base_url',        'vault',  true,  'endereço da API: sandbox ou produção, escrito e não adivinhado'),
  ('asaas', 'asaas_webhook_token',   'vault',  true,  'segredo que confere se o aviso de pagamento é da Asaas'),
  ('anthropic', 'anthropic_api_key', 'vault',  true,  'chave da API da Anthropic')
on conflict (conector_id, chave) do update
   set onde = excluded.onde,
       obrigatoria = excluded.obrigatoria,
       para_que = excluded.para_que;

-- ---------------------------------------------------------------------------
-- O estado
-- ---------------------------------------------------------------------------
create or replace function public.estado_dos_conectores()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  v_resposta jsonb;
begin
  -- Admin, e só. O que está aqui não é segredo, mas é o mapa de onde os
  -- segredos ficam e do que falta — leitura de direção, não de operação.
  if not public.usuario_admin() then
    return null;
  end if;

  select jsonb_agg(linha order by (linha->>'ordem')::int)
    into v_resposta
    from (
      select jsonb_build_object(
               'id',         i.id,
               'nome',       i.nome,
               'paraQue',    i.para_que,
               'construida', i.construida,
               'ordem',      i.ordem,
               'chaves',     (
                 select jsonb_agg(
                          jsonb_build_object(
                            'chave',       k.chave,
                            'onde',        k.onde,
                            'obrigatoria', k.obrigatoria,
                            'paraQue',     k.para_que,
                            -- Presença, nunca valor. `vault.secrets` guarda o
                            -- nome; a descriptografia nem acontece.
                            'presente',    case
                                             when k.onde = 'funcao' then null
                                             else exists (
                                               select 1 from vault.secrets s where s.name = k.chave
                                             )
                                           end
                          )
                          order by k.onde desc, k.obrigatoria desc, k.chave
                        )
                   from public.conector_chaves k
                  where k.conector_id = i.id
               ),
               'faltando', (
                 select coalesce(jsonb_agg(k.chave order by k.chave), '[]'::jsonb)
                   from public.conector_chaves k
                  where k.conector_id = i.id
                    and k.obrigatoria
                    and k.onde = 'vault'
                    and not exists (select 1 from vault.secrets s where s.name = k.chave)
               ),
               'agendador', case
                 when i.id <> 'meta' then null
                 else jsonb_build_object(
                        'publicar', exists (select 1 from cron.job j where j.jobname = 'publicar-tick'),
                        'renovar',  exists (select 1 from cron.job j where j.jobname = 'renovar-tokens')
                      )
               end
             ) as linha
        from public.conectores i
    ) t;

  return coalesce(v_resposta, '[]'::jsonb);
exception
  -- `cron` não existe em todo ambiente, e a tela não pode morrer por isso: ela
  -- existe justamente para dizer o que está faltando.
  when undefined_table or invalid_schema_name then
    return v_resposta;
end;
$$;

revoke all on function public.estado_dos_conectores() from public, anon;
grant execute on function public.estado_dos_conectores() to authenticated, service_role;
