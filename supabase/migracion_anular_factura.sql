-- ============================================================================
-- Migración: anular facturas (contraasiento, sin editar)
-- ----------------------------------------------------------------------------
-- Hasta ahora una factura cargada no se podía corregir de ningún modo. Esta
-- migración agrega `anular_factura`, que seguí la misma regla que los pagos
-- (Regla 3.4: los movimientos no se editan, se anulan): revierte la deuda que
-- esa factura le había sumado al proveedor y la marca como 'anulada' (queda
-- en el historial, no se borra). Solo se puede anular una factura que todavía
-- no tiene pagos imputados; si ya los tiene, primero hay que anular esos pagos.
--
-- Para corregir una factura mal cargada (ej. le faltó el impuesto interno):
-- 1) Anulala desde la ficha del proveedor o desde Facturas.
-- 2) Cargá de nuevo la factura con los datos correctos.
--
-- Cómo usar: pegar TODO este archivo en Supabase → SQL Editor → Run.
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- Ya queda incluido también en functions.sql para instalaciones nuevas; este
-- script es solo para aplicarlo a una base ya existente.
-- ============================================================================

create or replace function anular_factura(p_factura_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_fac facturas%rowtype;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  select * into v_fac from facturas where id = p_factura_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Factura inexistente.'; end if;
  if v_fac.estado = 'anulada' then raise exception 'La factura ya está anulada.'; end if;
  if v_fac.saldo_pendiente_centavos <> v_fac.monto_total_centavos then
    raise exception 'No se puede anular: la factura ya tiene pagos imputados. Anulá esos pagos primero.';
  end if;

  update facturas set estado = 'anulada', saldo_pendiente_centavos = 0 where id = p_factura_id;

  update proveedores
    set saldo_total_deuda_centavos = saldo_total_deuda_centavos - v_fac.monto_total_centavos
    where id = v_fac.proveedor_id;
end;
$$;

grant execute on function anular_factura(uuid) to authenticated;

-- ============================================================================
-- FIN.
-- ============================================================================
