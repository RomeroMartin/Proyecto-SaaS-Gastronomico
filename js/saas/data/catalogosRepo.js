// ============================================================
// saas/data/catalogosRepo.js — Opciones de desplegables por empresa
// ------------------------------------------------------------
// Combos "abiertos": muestran opciones por defecto + las que el usuario
// agregó (tabla `catalogos`). Al escribir una opción nueva, se guarda sola.
// Degrada con elegancia: si la tabla no existe todavía, usa solo defaults.
// ============================================================

import { supabase } from "../../config/supabase.js";
import { RUBROS } from "../../core/rubros.js";

/** Opciones por defecto por tipo (siempre presentes). */
export const DEFAULTS = {
  rubro: RUBROS,
  sector: ["Cocina", "Parrilla", "Barra", "Fríos", "Pastelería", "Cafetería"],
  unidad_rendimiento: ["un", "porción", "ml", "l", "g", "kg", "docena"],
  cat_venta: [],
  cat_ingreso: ["Ventas", "Ventas tarjeta", "Ventas QR", "Otros ingresos"],
  cat_egreso: ["Pago a proveedor", "Sueldos", "Servicios", "Mantenimiento", "Impuestos", "Retiro", "Otros gastos"],
};

/** Etiquetas amigables de los tipos de catálogo (para la pantalla de Configuración). */
export const TIPOS_CATALOGO = {
  rubro: "Rubros",
  sector: "Sectores",
  unidad_rendimiento: "Unidades de rendimiento",
  cat_venta: "Categorías de venta (mostrador)",
  cat_ingreso: "Categorías de ingreso (caja)",
  cat_egreso: "Categorías de egreso (caja)",
};

let CACHE = {}; // { tipo: Set<valor> } — valores agregados por el usuario

/** Carga el catálogo de la empresa a memoria. Best-effort. */
export async function cargar() {
  CACHE = {};
  try {
    const { data, error } = await supabase.from("catalogos").select("tipo, valor").eq("activo", true);
    if (error) throw error;
    for (const row of data || []) (CACHE[row.tipo] ||= new Set()).add(row.valor);
  } catch (_e) {
    // La tabla puede no existir aún: seguimos con defaults.
  }
  return CACHE;
}

/** Opciones combinadas (defaults + agregadas), ordenadas. */
export function opciones(tipo) {
  const set = new Set([...(DEFAULTS[tipo] || []), ...(CACHE[tipo] || [])]);
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}

/** ¿Ya existe ese valor (default o agregado)? Compara sin distinguir mayúsculas. */
function yaExiste(tipo, valor) {
  const v = valor.toLowerCase();
  return opciones(tipo).some((o) => o.toLowerCase() === v);
}

/** Guarda una opción nueva si no existía. Best-effort (no rompe el guardado). */
export async function asegurar(empresaId, tipo, valor) {
  const v = (valor || "").trim();
  if (!v || !empresaId || yaExiste(tipo, v)) return;
  (CACHE[tipo] ||= new Set()).add(v);
  try {
    await supabase.from("catalogos").insert({ empresa_id: empresaId, tipo, valor: v });
  } catch (_e) {
    // Ignorar (tabla inexistente o duplicado): la opción igual queda en memoria.
  }
}

/** Opciones agregadas por el usuario (sin los defaults), para gestionarlas. */
export function agregadas(tipo) {
  return [...(CACHE[tipo] || [])].sort((a, b) => a.localeCompare(b, "es"));
}

/** Elimina una opción agregada (los defaults no se pueden borrar). */
export async function eliminar(empresaId, tipo, valor) {
  const v = (valor || "").trim();
  if (CACHE[tipo]) CACHE[tipo].delete(v);
  const { error } = await supabase.from("catalogos")
    .delete().eq("empresa_id", empresaId).eq("tipo", tipo).eq("valor", v);
  if (error) throw error;
}
