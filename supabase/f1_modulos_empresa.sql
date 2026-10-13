-- ============================================================================
-- SaaS Gastronómico — Fase 1: módulos activables por empresa
-- ----------------------------------------------------------------------------
-- Cada empresa ve solo los módulos que contrató (`empresas.modulos`).
--   • Módulos válidos: admin, costos, carta, rrhh, ventas, reparto.
--   • Las empresas existentes quedan con {admin,costos,carta,rrhh} (lo que ya usaban).
--   • Dependencias: ventas requiere carta y admin; reparto requiere admin.
--     Se validan en la base (mensaje claro), no solo en pantalla.
--   • QUIEN ACTIVA MÓDULOS ES EL DUEÑO DEL PRODUCTO, no el cliente: la columna
--     NO tiene permiso de escritura para `authenticated` ni hay RPC para el
--     cliente. Se cambia desde el SQL Editor, p. ej.:
--         update empresas set modulos = '{admin,costos,carta,rrhh,ventas}'
--          where nombre = 'Mi cliente';
--   • Cada cambio queda en `auditoria` (con usuario si lo hizo un usuario, sin
--     usuario si fue desde el SQL Editor).
--   • El gating por módulo es de EXPERIENCIA (menú); la seguridad de datos
--     sigue siendo empresa + rol (RLS).
-- Orden: después de f0_empresas_columnas.sql y f0_auditoria.sql. Idempotente.
-- ============================================================================

alter table empresas add column if not exists modulos text[] not null
  default '{admin,costos,carta,rrhh}';

-- Backstop: solo valores de la lista (la validación con mensajes está en el trigger).
alter table empresas drop constraint if exists empresas_modulos_check;
alter table empresas add constraint empresas_modulos_check
  check (modulos <@ array['admin','costos','carta','rrhh','ventas','reparto']::text[]);

-- ---- Validación con mensajes claros + normalización (sin duplicados, ordenado) ----
create or replace function _trg_validar_modulos()
returns trigger language plpgsql set search_path = public as $$
declare v_validos text[] := array['admin','costos','carta','rrhh','ventas','reparto'];
        v_mal text[];
begin
  if new.modulos is null then
    raise exception 'La lista de módulos no puede ser nula.';
  end if;
  select coalesce(array_agg(distinct m), '{}') into v_mal
    from unnest(new.modulos) m where m is null or m <> all (v_validos);
  if array_length(v_mal, 1) > 0 then
    raise exception 'Módulo(s) desconocido(s): %. Válidos: %.', array_to_string(v_mal, ', '), array_to_string(v_validos, ', ');
  end if;
  -- Normaliza: sin repetidos y en el orden canónico.
  new.modulos := array(select m from unnest(v_validos) m where m = any (new.modulos));
  if array_length(new.modulos, 1) is null then
    raise exception 'La empresa debe tener al menos un módulo activo.';
  end if;
  if 'ventas' = any (new.modulos) and not ('carta' = any (new.modulos) and 'admin' = any (new.modulos)) then
    raise exception 'El módulo ventas requiere los módulos carta y admin.';
  end if;
  if 'reparto' = any (new.modulos) and not 'admin' = any (new.modulos) then
    raise exception 'El módulo reparto requiere el módulo admin.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_validar_modulos on empresas;
create trigger trg_validar_modulos before insert or update of modulos on empresas
  for each row execute function _trg_validar_modulos();

-- ---- Auditoría de cambios de módulos (también los hechos desde el SQL Editor) ----
create or replace function _trg_auditar_modulos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.modulos is distinct from old.modulos then
    insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, antes, despues)
    values (new.id, auth.uid(), 'modulos_empresa', 'empresas', new.id,
            jsonb_build_object('modulos', to_jsonb(old.modulos)),
            jsonb_build_object('modulos', to_jsonb(new.modulos)));
  end if;
  return new;
end;
$$;
revoke all on function _trg_auditar_modulos() from public, authenticated;
drop trigger if exists trg_auditar_modulos on empresas;
create trigger trg_auditar_modulos after update of modulos on empresas
  for each row execute function _trg_auditar_modulos();

-- Un ADMIN (u otro rol) NO puede escribir `modulos`: el grant por columna de
-- f0_empresas_columnas.sql no la incluye. Se re-afirma por si alguien amplió el grant.
revoke update (modulos) on empresas from authenticated;

-- ---- ¿La empresa del usuario tiene este módulo? (para RLS/RPC de fases siguientes) ----
create or replace function modulo_activo(p_modulo text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p_modulo = any (modulos) from empresas where id = mi_empresa()), false);
$$;
grant execute on function modulo_activo(text) to authenticated;
