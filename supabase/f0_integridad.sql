-- ============================================================================
-- SaaS Gastronómico — Fase 0.5: integridad financiera y bajas lógicas
-- ----------------------------------------------------------------------------
--   • registrar_pago / anular_pago: exigen rol ADMIN/GERENTE, usan la fecha de
--     la empresa (hoy_empresa) y anular_pago RECHAZA anular un contraasiento
--     (antes dejaba la contabilidad incoherente si se llamaba directo).
--   • RRHH: `documentos` y `ausencias` pasan a BAJA LÓGICA (columna `activo`);
--     el cliente ya no puede hacer DELETE. La restricción de ausencias sin
--     solapamiento solo considera las activas. Las vistas filtran las activas
--     y usan la fecha de la empresa.
-- Orden: después de f0_zona_horaria.sql. Idempotente.
-- Compatibilidad: el DELETE de documentos/ausencias desde la app anterior
-- falla → se publica junto con la versión nueva del frontend.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- registrar_pago — imputa FIFO (o manual) a las facturas del proveedor.
-- ----------------------------------------------------------------------------
create or replace function registrar_pago(
  p_proveedor_id uuid,
  p_monto_centavos bigint,
  p_metodo_pago text default 'transferencia',
  p_referencia text default null,
  p_fecha_pago date default null,
  p_modo_imputacion text default 'fifo',
  p_factura_ids uuid[] default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_pago uuid; v_restante bigint; v_aplica bigint; f record;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE') then raise exception 'Sin permiso: tu rol no puede realizar esta operación.'; end if;
  if p_monto_centavos <= 0 then raise exception 'El monto del pago debe ser mayor a cero.'; end if;
  if not exists (select 1 from proveedores where id = p_proveedor_id and empresa_id = v_empresa) then
    raise exception 'Proveedor inexistente en la empresa.';
  end if;

  insert into pagos (
    empresa_id, proveedor_id, fecha_pago, monto_pagado_centavos, metodo_pago,
    referencia, modo_imputacion, estado, creado_por
  ) values (
    v_empresa, p_proveedor_id, coalesce(p_fecha_pago, hoy_empresa()), p_monto_centavos,
    coalesce(p_metodo_pago, 'transferencia'), p_referencia,
    case when p_modo_imputacion = 'manual' then 'manual' else 'fifo' end, 'activo', auth.uid()
  ) returning id into v_pago;

  v_restante := p_monto_centavos;

  for f in
    select id, saldo_pendiente_centavos, monto_total_centavos
    from facturas
    where empresa_id = v_empresa and proveedor_id = p_proveedor_id
      and estado <> 'anulada' and activo = true and saldo_pendiente_centavos > 0
      and (p_modo_imputacion <> 'manual' or id = any(coalesce(p_factura_ids, '{}'::uuid[])))
    order by
      case when p_modo_imputacion = 'manual'
           then array_position(p_factura_ids, id) end asc nulls last,
      fecha_emision asc
    for update
  loop
    exit when v_restante <= 0;
    v_aplica := least(v_restante, f.saldo_pendiente_centavos);

    insert into pago_imputaciones (empresa_id, pago_id, factura_id, monto_imputado_centavos)
      values (v_empresa, v_pago, f.id, v_aplica);

    -- En el CASE, saldo_pendiente_centavos es el valor ANTERIOR (pre-update).
    update facturas
      set saldo_pendiente_centavos = saldo_pendiente_centavos - v_aplica,
          estado = case
            when saldo_pendiente_centavos - v_aplica <= 0 then 'pagada'
            when saldo_pendiente_centavos - v_aplica >= monto_total_centavos then 'pendiente'
            else 'parcial' end
      where id = f.id;

    v_restante := v_restante - v_aplica;
  end loop;

  update proveedores
    set saldo_total_deuda_centavos = saldo_total_deuda_centavos - p_monto_centavos
    where id = p_proveedor_id;

  return v_pago;
end;
$$;

-- ----------------------------------------------------------------------------
-- anular_pago — contraasiento: revierte imputaciones y saldos.
-- ----------------------------------------------------------------------------
create or replace function anular_pago(p_pago_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_orig pagos%rowtype; v_contra uuid; imp record;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE') then raise exception 'Sin permiso: tu rol no puede realizar esta operación.'; end if;
  select * into v_orig from pagos where id = p_pago_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Pago inexistente.'; end if;
  if v_orig.estado = 'anulado' then raise exception 'El pago ya está anulado.'; end if;
  if v_orig.anula_a_pago_id is not null then raise exception 'No se puede anular un contraasiento.'; end if;

  insert into pagos (
    empresa_id, proveedor_id, fecha_pago, monto_pagado_centavos, metodo_pago,
    referencia, modo_imputacion, estado, anula_a_pago_id, creado_por
  ) values (
    v_empresa, v_orig.proveedor_id, hoy_empresa(), -v_orig.monto_pagado_centavos, v_orig.metodo_pago,
    'ANULACIÓN de pago ' || p_pago_id::text, v_orig.modo_imputacion, 'activo', p_pago_id, auth.uid()
  ) returning id into v_contra;

  for imp in
    select factura_id, monto_imputado_centavos from pago_imputaciones where pago_id = p_pago_id
  loop
    update facturas
      set saldo_pendiente_centavos = saldo_pendiente_centavos + imp.monto_imputado_centavos,
          estado = case
            when saldo_pendiente_centavos + imp.monto_imputado_centavos >= monto_total_centavos then 'pendiente'
            when saldo_pendiente_centavos + imp.monto_imputado_centavos <= 0 then 'pagada'
            else 'parcial' end
      where id = imp.factura_id;

    insert into pago_imputaciones (empresa_id, pago_id, factura_id, monto_imputado_centavos)
      values (v_empresa, v_contra, imp.factura_id, -imp.monto_imputado_centavos);
  end loop;

  update pagos set estado = 'anulado', anulado_por_pago_id = v_contra where id = p_pago_id;
  update proveedores
    set saldo_total_deuda_centavos = saldo_total_deuda_centavos + v_orig.monto_pagado_centavos
    where id = v_orig.proveedor_id;

  return v_contra;
end;
$$;

grant execute on function registrar_pago(uuid, bigint, text, text, date, text, uuid[]) to authenticated;
grant execute on function anular_pago(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RRHH: baja lógica de documentos y ausencias.
-- ----------------------------------------------------------------------------
alter table documentos add column if not exists activo boolean not null default true;
alter table ausencias  add column if not exists activo boolean not null default true;
revoke delete on documentos, ausencias from authenticated;

-- Sin solapamiento SOLO entre ausencias activas.
alter table ausencias drop constraint if exists ausencias_sin_solape;
alter table ausencias add constraint ausencias_sin_solape
  exclude using gist (
    empleado_id with =,
    daterange(desde, hasta, '[]') with &&
  ) where (activo);

-- Estado de documentación (solo activos), con la fecha de la empresa.
create or replace view vw_documentos_estado
with (security_invoker = true) as
select
  d.id,
  d.empleado_id,
  e.empresa_id,
  e.nombre || ' ' || e.apellido as empleado,
  td.nombre as tipo,
  d.fecha_vencimiento,
  (d.fecha_vencimiento - hoy_empresa()) as dias_restantes,
  case
    when d.fecha_vencimiento is null then 'sin_vencimiento'
    when d.fecha_vencimiento < hoy_empresa() then 'vencido'
    when d.fecha_vencimiento <= hoy_empresa() + 30 then 'por_vencer'
    else 'vigente'
  end as estado
from documentos d
join empleados e on e.id = d.empleado_id
join tipos_documento td on td.id = d.tipo_documento_id
where e.estado = 'activo' and d.activo;

-- Saldo de vacaciones del año en curso (solo ausencias activas).
create or replace view vw_saldo_vacaciones
with (security_invoker = true) as
select
  e.id as empleado_id,
  e.empresa_id,
  e.nombre || ' ' || e.apellido as empleado,
  dias_vacaciones(e.id, extract(year from hoy_empresa())::int) as corresponden,
  coalesce(sum(a.dias), 0)::int as tomados,
  dias_vacaciones(e.id, extract(year from hoy_empresa())::int)
    - coalesce(sum(a.dias), 0)::int as saldo
from empleados e
left join ausencias a
  on a.empleado_id = e.id
 and a.activo
 and a.tipo = 'vacaciones'
 and extract(year from a.desde) = extract(year from hoy_empresa())
where e.estado = 'activo'
group by e.id;
