// ============================================================
// saas/data/pagosRepo.js — Pagos a proveedores (Supabase)
// ------------------------------------------------------------
// Registro (imputación FIFO/manual) y anulación por contraasiento van por RPC
// (SECURITY DEFINER): el cliente solo invoca; los saldos los mueve la base.
// ============================================================

import { supabase } from "../../config/supabase.js";

/** Pagos de un proveedor (más recientes primero). */
export async function listarPorProveedor(proveedorId) {
  const { data, error } = await supabase
    .from("pagos")
    .select("*")
    .eq("proveedor_id", proveedorId)
    .order("fecha_pago", { ascending: false })
    .order("creado_en", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Todos los pagos de la empresa (más recientes primero). */
export async function listarTodos() {
  const { data, error } = await supabase
    .from("pagos")
    .select("*")
    .order("fecha_pago", { ascending: false })
    .order("creado_en", { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Registra un pago e imputa a facturas (FIFO o manual) vía RPC.
 * @returns {string} id del pago
 */
export async function registrar(p) {
  const { data, error } = await supabase.rpc("registrar_pago", {
    p_proveedor_id: p.proveedorId,
    p_monto_centavos: p.montoCentavos,
    p_metodo_pago: p.metodoPago || "transferencia",
    p_referencia: (p.referencia || "").trim() || null,
    p_fecha_pago: p.fechaPago || null,
    p_modo_imputacion: p.modoImputacion === "manual" ? "manual" : "fifo",
    p_factura_ids: p.modoImputacion === "manual" ? (p.facturaIds || []) : null,
  });
  if (error) throw error;
  return data;
}

/** Anula un pago por contraasiento vía RPC. */
export async function anular(pagoId) {
  const { data, error } = await supabase.rpc("anular_pago", { p_pago_id: pagoId });
  if (error) throw error;
  return data;
}
