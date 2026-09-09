-- Stubs do que o Supabase fornece pronto. So para validar as migrations local.
create database astart;
\c astart

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

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

create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
create or replace view vault.decrypted_secrets as
  select id, name, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(p_secret text, p_name text, p_desc text default null)
returns uuid language sql as $$
  insert into vault.secrets (name, secret) values (p_name, p_secret)
  on conflict (name) do update set secret = excluded.secret returning id;
$$;
create or replace function vault.update_secret(p_id uuid, p_secret text)
returns void language sql as $$ update vault.secrets set secret = p_secret where id = p_id $$;

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

-- Privilegios default equivalentes aos do Supabase.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Chaves que a migration 0009 (pg_cron) exige antes de agendar o job.
select vault.create_secret('https://exemplo.supabase.co/functions/v1/publicar-tick', 'publicar_tick_url');
select vault.create_secret('segredo-de-teste', 'tick_secret');
select vault.create_secret('TOKEN_FAKE_DO_SYSTEM_USER', 'meta_system_user_token');
select vault.create_secret('https://exemplo.supabase.co/functions/v1/renovar-tokens', 'renovar_tokens_url');
