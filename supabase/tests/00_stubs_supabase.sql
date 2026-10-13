-- Stubs do que o Supabase fornece pronto. So para validar as migrations local.
create database astart;
\c astart

create role anon nologin;
create role authenticated nologin;
-- No Supabase de verdade o service_role passa por cima do RLS: e com ele que a
-- Edge Function le o que o visitante sem conta nao pode ler. Sem `bypassrls`
-- aqui, um teste do caminho da Edge Function falharia por RLS e daria a
-- impressao de bug no produto — foi o que aconteceu com o link de aprovacao.
create role service_role nologin bypassrls;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists vault;
create schema if not exists cron;
create schema if not exists net;

create table auth.users (id uuid primary key default gen_random_uuid(), email text);

create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;

-- `created_at` e `updated_at` existem no Vault de verdade, e faltavam aqui.
--
-- Normalmente o stub e MAIS generoso que a realidade, e e isso que esconde bug
-- (foi a licao do teste 22: o Vault do stub nascia com as chaves prontas). Aqui
-- foi o contrario: o stub era mais POBRE, e a migration 0049 quebrou no teste
-- em vez de quebrar em producao. Esse e o lado bom — o que nao pode e o stub
-- divergir da realidade sem ninguem saber em qual direcao.
--
-- E as duas datas sao MANTIDAS pelas funcoes abaixo, nao so declaradas: um
-- `updated_at` que nunca muda faria a 0049 parecer certa e responder errado,
-- que e pior que nao existir.
create table vault.secrets (
  id         uuid primary key default gen_random_uuid(),
  name       text unique,
  secret     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace view vault.decrypted_secrets as
  select id, name, secret as decrypted_secret, created_at, updated_at from vault.secrets;
create or replace function vault.create_secret(p_secret text, p_name text, p_desc text default null)
returns uuid language sql as $$
  insert into vault.secrets (name, secret) values (p_name, p_secret)
  on conflict (name) do update set secret = excluded.secret, updated_at = now() returning id;
$$;
create or replace function vault.update_secret(p_id uuid, p_secret text)
returns void language sql as $$
  update vault.secrets set secret = p_secret, updated_at = now() where id = p_id
$$;

create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create or replace function cron.schedule(jobname text, schedule text, command text)
returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (jobname, schedule, command)
  returning jobid;
$$;
create or replace function cron.unschedule(jobname text)
returns boolean language sql as $$ delete from cron.job where jobname = $1; select true; $$;

create table net._http_response (id bigserial primary key, created timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ select 1::bigint $$;

-- No Supabase real os papeis alcancam auth.uid(); auth.users continua fechado.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- No Supabase de verdade `authenticated` alcanca storage.objects e e o RLS que
-- decide linha por linha. Sem estes grants, um teste de politica de bucket
-- falharia por falta de permissao de schema e passaria a impressao de que a
-- politica negou — negar por motivo errado nao prova nada.
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- Privilegios default equivalentes aos do Supabase.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Chaves que a migration 0009 (pg_cron) exige antes de agendar o job.
-- O Vault comeca VAZIO, de proposito.
--
-- Ele vinha com as quatro chaves que as migrations do agendador exigiam, e por
-- isso toda rodada de teste passava enquanto uma instalacao nova falhava no
-- primeiro paste: o ambiente de teste estava mais configurado que a realidade.
-- Stub generoso testa so o caminho felizmente configurado.
--
-- Teste que precisa de uma chave cria a dele, e assim o pre-requisito fica
-- escrito onde ele vale.
