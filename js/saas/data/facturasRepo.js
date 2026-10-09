// ============================================================
// saas/data/facturasRepo.js — Facturas de compra (Supabase)
// ------------------------------------------------------------
// El alta va por la RPC crear_factura (valida cuadratura + suma al saldo del
// proveedor de forma atómica). El saldo NUNCA se escribe desde el cliente.
// ============================================================

import { supabase } from "../../config/supabase.js";

/** Facturas de un proveedor (más recientes primero). */
export async function listarPorProveedor(proveedorId) {
  const { data, error } = await supabase
    .from("facturas")
    .select("*")
    .eq("proveedor_id", proveedorId)
    .eq("activo", true)
    .order("fecha_emision", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Todas las facturas activas de la empresa (más recientes primero). */
export async function listarTodas() {
  const { data, error } = await supabase
    .from("facturas")
    .select("*")
    .eq("activo", true)
    .order("fecha_emision", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Todas las facturas con saldo pendiente (para KPIs del listado). */
export async function pendientesGlobal() {
  const { data, error } = await supabase
    .from("facturas")
    .select("*")
    .eq("activo", true)
    .neq("estado", "anulada")
    .gt("saldo_pendiente_centavos", 0);
  if (error) throw error;
  return data || [];
}

/** Facturas con saldo pendiente (FIFO: más antiguas primero). */
export async function pendientes(proveedorId) {
  const { data, error } = await supabase
    .from("facturas")
    .select("*")
    .eq("proveedor_id", proveedorId)
    .eq("activo", true)
    .neq("estado", "anulada")
    .gt("saldo_pendiente_centavos", 0)
    .order("fecha_emision", { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Crea una factura vía RPC (atómico). Importes ya en centavos.
 * @returns {string} id de la factura
 */
export async function crear(datos) {
  const { data, error } = await supabase.rpc("crear_factura", {
    p_proveedor_id: datos.proveedor_id,
    p_tipo_comprobante: datos.tipo_comprobante,
    p_numero_factura: (datos.numero_factura || "").trim() || null,
    p_fecha_emision: datos.fecha_emision,
    p_fecha_vencimiento: datos.fecha_vencimiento || null,
    p_neto_centavos: datos.neto_gravado_centavos,
    p_iva_centavos: datos.iva_discriminado_centavos,
    p_percepciones_centavos: datos.percepciones_centavos || 0,
    p_total_centavos: datos.monto_total_centavos,
    p_sucursal_id: datos.sucursal_id || null,
    p_observaciones: (datos.observaciones || "").trim() || null,
    p_otros_impuestos_centavos: datos.otros_impuestos_centavos || 0,
  });
  if (error) throw error;
  return data;
}

/** Trae una factura por id. */
export async function obtener(id) {
  const { data, error } = await supabase.from("facturas").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Pagos imputados a una factura (con los datos del pago). */
export async function imputaciones(facturaId) {
  const { data, error } = await supabase
    .from("pago_imputaciones")
    .select("*, pagos(fecha_pago, metodo_pago, referencia, estado)")
    .eq("factura_id", facturaId);
  if (error) throw error;
  return data || [];
}

/**
 * Edita una factura vía RPC (atómico; ajusta el saldo del proveedor).
 * Con pagos imputados solo acepta cambios en comprobante, número, fechas y
 * observaciones (lo valida la base).
 */
export async function editar(facturaId, datos) {
  const { error } = await supabase.rpc("editar_factura", {
    p_factura_id: facturaId,
    p_proveedor_id: datos.proveedor_id,
    p_tipo_comprobante: datos.tipo_comprobante,
    p_numero_factura: (datos.numero_factura || "").trim() || null,
    p_fecha_emision: datos.fecha_emision,
    p_fecha_vencimiento: datos.fecha_vencimiento || null,
    p_neto_centavos: datos.neto_gravado_centavos,
    p_iva_centavos: datos.iva_discriminado_centavos,
    p_percepciones_centavos: datos.percepciones_centavos || 0,
    p_otros_impuestos_centavos: datos.otros_impuestos_centavos || 0,
    p_total_centavos: datos.monto_total_centavos,
    p_observaciones: (datos.observaciones || "").trim() || null,
  });
  if (error) throw error;
}

/** Anula una factura sin pagos imputados, por contraasiento (Regla 3.4). */
export async function anular(facturaId) {
  const { error } = await supabase.rpc("anular_factura", { p_factura_id: facturaId });
  if (error) throw error;
}
