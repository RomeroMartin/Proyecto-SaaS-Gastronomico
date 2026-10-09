-- ============================================================================
-- SaaS Gastronómico — Migración: editar facturas + validación de fechas
-- ----------------------------------------------------------------------------
-- 1) `editar_factura`: corrige una factura ya cargada.
--      • Sin pagos imputados: se puede cambiar TODO (proveedor, comprobante,
--        número, fechas, importes, observaciones). El saldo de deuda del/los
--        proveedor(es) se ajusta solo, de forma atómica.
--      • Con pagos imputados: solo comprobante, número, fechas y
--        observaciones. Para tocar importes o proveedor hay que anular antes
--        los pagos.
--      • Una factura anulada no se edita.
-- 2) Las fechas de emisión/vencimiento deben estar entre 2000 y 2100 (evita
--    errores de tipeo como el año 0026). La restricción es NOT VALID: no
--    revisa las facturas ya cargadas, pero se exige en cada alta/edición.
--    Si tenés una factura con una fecha absurda, corregila desde la app
--    (Facturas → Editar).
-- Idempotente. Ejecutar en Supabase → SQL Editor → Run.
-- ============================================================================

alter table facturas drop constraint if exists chk_fechas_factura;
alter table facturas add constraint chk_fechas_factura
  check (
    fecha_emision between date '2000-01-01' and date '2100-12-31'
    and (fecha_vencimiento is null or fecha_vencimiento between date '2000-01-01' and date '2100-12-31')
  ) not valid;

create or replace function editar_factura(
  p_factura_id uuid,
  p_proveedor_id uuid,
  p_tipo_comprobante char(1),
  p_numero_factura varchar,
  p_fecha_emision date,
  p_fecha_vencimiento date,
  p_neto_centavos bigint,
  p_iva_centavos bigint,
  p_percepciones_centavos bigint,
  p_otros_impuestos_centavos bigint,
  p_total_centavos bigint,
  p_observaciones text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_fac facturas%rowtype; v_tiene_pagos boolean;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  select * into v_fac from facturas where id = p_factura_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Factura inexistente.'; end if;
  if v_fac.estado = 'anulada' then raise exception 'Una factura anulada no se puede editar.'; end if;
  if p_total_centavos <= 0 then raise exception 'El total de la factura debe ser mayor a cero.'; end if;
  if (p_neto_centavos + p_iva_centavos + p_percepciones_centavos + p_otros_impuestos_centavos) <> p_total_centavos then
    raise exception 'La factura no cuadra: neto + IVA + percepciones + otros impuestos <> total.';
  end if;
  if p_fecha_emision not between date '2000-01-01' and date '2100-12-31'
     or (p_fecha_vencimiento is not null and p_fecha_vencimiento not between date '2000-01-01' and date '2100-12-31') then
    raise exception 'Fecha inválida: revisá el año (debe estar entre 2000 y 2100).';
  end if;

  v_tiene_pagos := v_fac.saldo_pendiente_centavos <> v_fac.monto_total_centavos;

  if v_tiene_pagos then
    if p_proveedor_id <> v_fac.proveedor_id
       or p_neto_centavos <> v_fac.neto_gravado_centavos
       or p_iva_centavos <> v_fac.iva_discriminado_centavos
       or p_percepciones_centavos <> v_fac.percepciones_centavos
       or p_otros_impuestos_centavos <> v_fac.otros_impuestos_centavos
       or p_total_centavos <> v_fac.monto_total_centavos then
      raise exception 'La factura ya tiene pagos imputados: solo podés corregir comprobante, número, fechas y observaciones. Para cambiar importes o proveedor, anulá primero esos pagos.';
    end if;
  else
    if not exists (select 1 from proveedores where id = p_proveedor_id and empresa_id = v_empresa) then
      raise exception 'Proveedor inexistente en la empresa.';
    end if;
    if p_proveedor_id = v_fac.proveedor_id then
      update proveedores
        set saldo_total_deuda_centavos = saldo_total_deuda_centavos + (p_total_centavos - v_fac.monto_total_centavos)
        where id = p_proveedor_id;
    else
      update proveedores
        set saldo_total_deuda_centavos = saldo_total_deuda_centavos - v_fac.monto_total_centavos
        where id = v_fac.proveedor_id;
      update proveedores
        set saldo_total_deuda_centavos = saldo_total_deuda_centavos + p_total_centavos
        where id = p_proveedor_id;
    end if;
  end if;

  update facturas set
    proveedor_id = p_proveedor_id,
    tipo_comprobante = p_tipo_comprobante,
    numero_factura = nullif(trim(p_numero_factura), ''),
    fecha_emision = p_fecha_emision,
    fecha_vencimiento = p_fecha_vencimiento,
    neto_gravado_centavos = p_neto_centavos,
    iva_discriminado_centavos = p_iva_centavos,
    percepciones_centavos = p_percepciones_centavos,
    otros_impuestos_centavos = p_otros_impuestos_centavos,
    monto_total_centavos = p_total_centavos,
    saldo_pendiente_centavos = case when v_tiene_pagos then v_fac.saldo_pendiente_centavos else p_total_centavos end,
    observaciones = nullif(trim(coalesce(p_observaciones, '')), ''),
    modificado_por = auth.uid()
  where id = p_factura_id;
end;
$$;

grant execute on function editar_factura(uuid, uuid, char, varchar, date, date, bigint, bigint, bigint, bigint, bigint, text) to authenticated;
