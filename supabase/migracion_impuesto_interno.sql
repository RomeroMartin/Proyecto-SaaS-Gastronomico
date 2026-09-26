-- ============================================================================
-- Migración: impuesto interno / otros impuestos no recuperables en facturas
-- ----------------------------------------------------------------------------
-- Para proveedores cuyas facturas incluyen, además de IVA y percepciones,
-- un impuesto interno (ej. bebidas alcohólicas) u otro cargo no recuperable.
-- Agrega la columna `otros_impuestos_centavos` a `facturas`, amplía la
-- cuadratura obligatoria y actualiza la RPC `crear_factura` para aceptarla.
--
-- Cómo usar: pegar TODO este archivo en Supabase → SQL Editor → Run.
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- Ya queda incluido también en schema.sql y functions.sql para instalaciones
-- nuevas; este script es solo para aplicarlo a una base ya existente.
-- ============================================================================

alter table facturas add column if not exists otros_impuestos_centavos bigint not null default 0 check (otros_impuestos_centavos >= 0);

alter table facturas drop constraint if exists chk_cuadratura_factura;
alter table facturas add constraint chk_cuadratura_factura
  check (neto_gravado_centavos + iva_discriminado_centavos
         + percepciones_centavos + otros_impuestos_centavos = monto_total_centavos);

create or replace function crear_factura(
  p_proveedor_id uuid,
  p_tipo_comprobante char,
  p_numero_factura text,
  p_fecha_emision date,
  p_fecha_vencimiento date,
  p_neto_centavos bigint,
  p_iva_centavos bigint,
  p_percepciones_centavos bigint,
  p_total_centavos bigint,
  p_sucursal_id uuid default null,
  p_observaciones text default null,
  p_otros_impuestos_centavos bigint default 0
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_factura uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not exists (select 1 from proveedores where id = p_proveedor_id and empresa_id = v_empresa) then
    raise exception 'Proveedor inexistente en la empresa.';
  end if;
  if (p_neto_centavos + p_iva_centavos + p_percepciones_centavos + p_otros_impuestos_centavos) <> p_total_centavos then
    raise exception 'La factura no cuadra: neto + IVA + percepciones + otros impuestos <> total.';
  end if;

  insert into facturas (
    empresa_id, sucursal_id, proveedor_id, tipo_comprobante, numero_factura,
    fecha_emision, fecha_vencimiento, neto_gravado_centavos, iva_discriminado_centavos,
    percepciones_centavos, otros_impuestos_centavos, monto_total_centavos, saldo_pendiente_centavos, estado,
    observaciones, creado_por
  ) values (
    v_empresa, p_sucursal_id, p_proveedor_id, p_tipo_comprobante, p_numero_factura,
    p_fecha_emision, p_fecha_vencimiento, p_neto_centavos, p_iva_centavos,
    p_percepciones_centavos, p_otros_impuestos_centavos, p_total_centavos, p_total_centavos, 'pendiente',
    p_observaciones, auth.uid()
  ) returning id into v_factura;

  update proveedores
    set saldo_total_deuda_centavos = saldo_total_deuda_centavos + p_total_centavos
    where id = p_proveedor_id;

  return v_factura;
end;
$$;

grant execute on function crear_factura(uuid, char, text, date, date, bigint, bigint, bigint, bigint, uuid, text, bigint) to authenticated;

-- ============================================================================
-- FIN.
-- ============================================================================
