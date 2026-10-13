-- ============================================================================
-- Tests SQL — helpers de aserción (solo pruebas)
-- ----------------------------------------------------------------------------
-- t_ok(cond, desc)            falla si cond no es true
-- t_igual(a, b, desc)         falla si a is distinct from b
-- t_falla(sql, desc, patron)  ejecuta `sql` y exige que lance un error (opcional:
--                             que el mensaje coincida con el patrón regex)
-- t_uid(alias) / t_login(alias)  usuarios de prueba (ver 02_datos_base.sql)
-- Un test que falla aborta el script (ON_ERROR_STOP) y run.sh termina con error.
-- ============================================================================

create or replace function t_ok(p_cond boolean, p_desc text) returns void
language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALLA: %', p_desc; end if;
  raise notice 'OK: %', p_desc;
end $$;

create or replace function t_igual(p_a anyelement, p_b anyelement, p_desc text) returns void
language plpgsql as $$
begin
  if p_a is distinct from p_b then
    raise exception 'FALLA: % (obtuvo %, esperaba %)', p_desc, p_a, p_b;
  end if;
  raise notice 'OK: %', p_desc;
end $$;

create or replace function t_falla(p_sql text, p_desc text, p_patron text default null) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_patron is not null and sqlerrm !~* p_patron then
      raise exception 'FALLA: % (error inesperado: %)', p_desc, sqlerrm;
    end if;
    raise notice 'OK: % [%]', p_desc, left(sqlerrm, 90);
    return;
  end;
  raise exception 'FALLA: % (se esperaba un error y no hubo)', p_desc;
end $$;

-- Usuarios de prueba: alias → uuid fijo.
create or replace function t_uid(p_alias text) returns uuid
language sql immutable as $$
  select case p_alias
    when 'admA' then 'a0000000-0000-0000-0000-000000000001'
    when 'gerA' then 'a0000000-0000-0000-0000-000000000002'
    when 'cocA' then 'a0000000-0000-0000-0000-000000000003'
    when 'audA' then 'a0000000-0000-0000-0000-000000000004'
    when 'cajA' then 'a0000000-0000-0000-0000-000000000005'
    when 'inaA' then 'a0000000-0000-0000-0000-000000000006'
    when 'admB' then 'b0000000-0000-0000-0000-000000000001'
  end::uuid $$;

-- Simula el login de un usuario (el rol de base se fija con `set role authenticated`).
create or replace function t_login(p_alias text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', t_uid(p_alias)::text, false);
end $$;

-- Ejecuta una sentencia DML y exige que haya afectado exactamente N filas
-- (la RLS no lanza error al filtrar un UPDATE/DELETE: simplemente afecta 0).
create or replace function t_filas(p_sql text, p_esperadas int, p_desc text) returns void
language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if n <> p_esperadas then
    raise exception 'FALLA: % (afectó % filas, esperaba %)', p_desc, n, p_esperadas;
  end if;
  raise notice 'OK: %', p_desc;
end $$;
