-- Heartbeat para evitar la pausa por inactividad (plan Free de Supabase).
-- Ejecutar UNA vez en Supabase -> SQL Editor.
--
-- Crea una tabla de una sola fila y una funcion que actualiza su fecha.
-- El workflow .github/workflows/supabase-heartbeat.yml llama a la funcion
-- una vez por dia: es una ESCRITURA real en la base, no solo una lectura.

create table if not exists public.heartbeat (
  id        int primary key default 1 check (id = 1),
  last_ping timestamptz not null default now()
);

insert into public.heartbeat (id) values (1) on conflict (id) do nothing;

-- RLS activo y sin politicas: nadie puede leer ni escribir la tabla directo.
alter table public.heartbeat enable row level security;

-- La funcion corre con permisos del dueno y solo actualiza la fecha.
create or replace function public.heartbeat()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  update public.heartbeat set last_ping = now() where id = 1
  returning last_ping;
$$;

revoke all on function public.heartbeat() from public;
grant execute on function public.heartbeat() to anon, authenticated;
