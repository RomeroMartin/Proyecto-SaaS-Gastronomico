// ============================================================
// saas/data/insumosRepo.js — Insumos sobre Supabase (SQL)
// ------------------------------------------------------------
// El costo se guarda SIEMPRE por unidad base (g/ml/un) en centavos (admite decimales).
// Crear/actualizar el costo va por RPC: la base registra el historial y recalcula
// las recetas en la misma transacción. /data no conoce el DOM.
// ============================================================

import { supabase } from "../../config/supabase.js";

/** Lista los insumos activos de la empresa (ordenados por nombre). */
export async function listar() {
  const { data, error } = await supabase
    .from("insumos")
    .select("*")
    .eq("activo", true)
    .order("nombre", { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Crea un insumo (RPC crear_insumo: insumo + primer punto del historial, en una
 * sola transacción; el código INS-nnn lo asigna la base). `datos` trae el costo
 * ya calculado por unidad base (centavos, admite decimales).
 * @returns {{id:string}}
 */
export async function crear(empresaId, datos) {
  if (!empresaId) throw new Error("Falta la empresa del usuario.");
  if (!datos.nombre || !datos.nombre.trim()) throw new Error("El nombre es obligatorio.");
  const { data, error } = await supabase.rpc("crear_insumo", { p_datos: datos });
  if (error) throw error;
  return { id: data };
}

/**
 * Actualiza el costo por unidad base (RPC actualizar_costo_insumo): deja el
 * punto de historial, deriva el precio de la presentación y recalcula las
 * recetas, todo en una transacción.
 * @param {object} meta { origen: 'manual'|'factura', factura_id, presentacion_precio_neto_centavos }
 * @returns {{variacion:number, recetas_recalculadas:number}}
 */
export async function actualizarCosto(empresaId, id, nuevoCostoCentavos, meta = {}) {
  const { data, error } = await supabase.rpc("actualizar_costo_insumo", {
    p_id: id,
    p_costo: nuevoCostoCentavos,
    p_origen: meta.origen || "manual",
    p_factura: meta.factura_id || null,
    p_precio_presentacion: meta.presentacion_precio_neto_centavos > 0 ? Math.round(meta.presentacion_precio_neto_centavos) : null,
  });
  if (error) throw error;
  return data;
}

/**
 * Edita los datos del insumo y, si se pasa `costo`, también su costo por unidad
 * base (RPC actualizar_insumo: todo junto, con historial y recálculo de recetas).
 * @returns {{variacion:number, costo_cambio:boolean, recetas_recalculadas:number}}
 */
export async function actualizar(id, datos, costo = null) {
  const { data, error } = await supabase.rpc("actualizar_insumo", { p_id: id, p_datos: datos, p_costo: costo });
  if (error) throw error;
  return data;
}

/** Baja lógica. */
export async function desactivar(id) {
  const { error } = await supabase.from("insumos").update({ activo: false }).eq("id", id);
  if (error) throw error;
}

/** Historial de precios de un insumo (cronológico). */
export async function historial(insumoId) {
  const { data, error } = await supabase
    .from("historial_precios_insumo")
    .select("*")
    .eq("insumo_id", insumoId)
    .order("fecha", { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Últimos cambios de precio de la empresa (para el resumen de Costos). */
export async function ultimosCambios(limite = 8) {
  const { data, error } = await supabase
    .from("historial_precios_insumo")
    .select("*")
    .neq("origen", "carga_inicial")
    .order("fecha", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}
