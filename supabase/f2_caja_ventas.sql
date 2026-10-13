-- ============================================================================
-- SaaS Gastronómico — Fase 2 (2/3): cambios en `movimientos_caja`
-- ----------------------------------------------------------------------------
-- El cierre de un turno de ventas vuelca sus totales al Flujo de caja:
--   • origen      'manual' (cargado a mano) | 'cierre_turno' (ventas del cierre)
--                 | 'turno' (salida de efectivo registrada durante el turno)
--   • turno_id    turno que lo generó
--   • activo      baja lógica: nada se borra (si se reabre un turno, sus
--                 movimientos de cierre quedan inactivos)
-- Un movimiento de cierre ACTIVO por (turno, medio, tipo, categoría): no se duplican cierres.
-- "Borrar" desde la app pasa a ser baja lógica (se intercepta el DELETE), para
-- que el frontend anterior siga funcionando; los movimientos que no son
-- manuales no se pueden borrar (para corregirlos se reabre el turno).
-- Los clientes no pueden fijar origen / turno_id / activo al insertar.
-- Orden: después de f2_ventas.sql (turnos_caja). Idempotente.
-- ============================================================================

alter table movimientos_caja add column if not exists origen varchar(20) not null default 'manual';
alter table movimientos_caja drop constraint if exists movimientos_caja_origen_check;
alter table movimientos_caja add constraint movimientos_caja_origen_check
  check (origen in ('manual', 'cierre_turno', 'turno'));
alter table movimientos_caja add column if not exists turno_id uuid references turnos_caja(id) on delete restrict;
alter table movimientos_caja add column if not exists activo boolean not null default true;

-- (el cierre genera un ingreso 'Ventas' por medio y, si hay diferencia, una línea de 'Diferencia de caja')
drop index if exists ux_movcaja_cierre_turno;
create unique index if not exists ux_movcaja_cierre_turno_v2
  on movimientos_caja (turno_id, medio, tipo, categoria) where origen = 'cierre_turno' and activo;
create index if not exists ix_movcaja_turno on movimientos_caja (turno_id) where turno_id is not null;

-- Permisos por columna: lo manual se escribe directo; origen/turno_id/activo, no.
revoke insert, update on movimientos_caja from authenticated;
grant insert (empresa_id, fecha, tipo, categoria, medio, monto_centavos, nota, creado_por)
  on movimientos_caja to authenticated;
grant update (fecha, tipo, categoria, medio, monto_centavos, nota) on movimientos_caja to authenticated;

-- Un movimiento no manual no se edita a mano (las políticas ya limitan a ADMIN/GERENTE).
create or replace function _trg_movcaja_manual()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Las RPC de turnos (reabrir_turno) habilitan el cambio con app.permite_mov.
  if old.origen <> 'manual' and coalesce(current_setting('app.permite_mov', true), '') <> '1' then
    raise exception 'Este movimiento lo generó el cierre de caja y no se edita: reabrí el turno para corregirlo.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_movcaja_manual on movimientos_caja;
create trigger trg_movcaja_manual before update on movimientos_caja
  for each row execute function _trg_movcaja_manual();

-- DELETE → baja lógica (con auditoría); los no manuales se rechazan.
create or replace function _trg_movcaja_baja()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.origen <> 'manual' then
    raise exception 'Este movimiento lo generó el cierre de caja y no se borra: reabrí el turno para corregirlo.';
  end if;
  update movimientos_caja set activo = false where id = old.id;
  perform auditar('baja_movimiento_caja', 'movimientos_caja', old.id,
    jsonb_build_object('tipo', old.tipo, 'medio', old.medio, 'monto_centavos', old.monto_centavos, 'fecha', old.fecha),
    jsonb_build_object('activo', false));
  return null;   -- no se borra la fila
end;
$$;
revoke all on function _trg_movcaja_baja() from public, authenticated;
drop trigger if exists trg_movcaja_baja on movimientos_caja;
create trigger trg_movcaja_baja before delete on movimientos_caja
  for each row execute function _trg_movcaja_baja();
