-- ============================================================================
-- Tests SQL — Supabase simulado (solo para pruebas locales / CI; NUNCA en producción)
-- ----------------------------------------------------------------------------
-- Simula lo mínimo de Supabase para ejecutar los scripts del repo y probarlos
-- contra un PostgreSQL común: roles anon/authenticated, el esquema `auth`
-- (auth.users + auth.uid() leído de un setting) y un `storage` mínimo.
-- ============================================================================

-- Los roles son del clúster (no de la base): se crean solo si faltan.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[]
  language sql as $$ select string_to_array(name, '/') $$;

grant usage on schema public, auth to authenticated, anon;
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on functions to authenticated;
alter default privileges in schema public grant all on sequences to authenticated;
