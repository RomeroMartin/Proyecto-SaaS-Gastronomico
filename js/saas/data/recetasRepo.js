// ============================================================
// saas/data/recetasRepo.js — Recetas y sus ingredientes (Supabase)
// ------------------------------------------------------------
// Una receta puede ser un PLATO (se vende) o una PREPARACIÓN (sub-receta).
// Los ingredientes se guardan en ingredientes_receta (insumo XOR sub-receta).
// El costo se calcula con core/costeo.js; acá solo persistimos el snapshot.
// /data no conoce el DOM.
// ============================================================

import { supabase } from "../../config/supabase.js";
import * as insumosRepo from "./insumosRepo.js";
import { costoReceta } from "../../core/costeo.js";

/** Convierte una fila de ingredientes_receta al shape que espera core/costeo. */
function mapIngrediente(row) {
  return {
    id: row.id,
    tipo: row.insumo_id ? "insumo" : "receta",
    ref_id: row.insumo_id || row.subreceta_hija_id,
    cantidad: Number(row.cantidad) || 0,
    porcentaje_merma: Number(row.porcentaje_merma) || 0,
  };
}

/**
 * Lista recetas activas de la empresa, cada una con su array `ingredientes`
 * ya en el shape de core (para poder costear directo).
 */
export async function listar() {
  const [{ data: recetas, error: e1 }, { data: ingredientes, error: e2 }] = await Promise.all([
    supabase.from("recetas").select("*").eq("activo", true).order("nombre", { ascending: true }),
    supabase.from("ingredientes_receta").select("*"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const porReceta = {};
  for (const row of ingredientes || []) {
    (porReceta[row.receta_padre_id] ||= []).push(row);
  }
  return (recetas || []).map((r) => ({
    ...r,
    ingredientes: (porReceta[r.id] || [])
      .sort((a, b) => (a.orden || 0) - (b.orden || 0))
      .map(mapIngrediente),
  }));
}

/** Datos de la receta en el formato de la RPC guardar_receta. */
function datosRpc(datos) {
  return {
    nombre: (datos.nombre || "").trim(),
    tipo: datos.tipo === "preparacion" ? "preparacion" : "plato",
    rendimiento_cantidad: Number(datos.rendimiento_cantidad) || 1,
    rendimiento_unidad: (datos.rendimiento_unidad || "un").trim() || "un",
    precio_venta_publico_centavos: Number(datos.precio_venta_publico_centavos) || 0,
    alicuota_venta: Number(datos.alicuota_venta) || 0,
    sector_venta: (datos.sector_venta || "").trim() || null,
  };
}

/** Ingredientes en el formato de la RPC: [{tipo, ref_id, cantidad}] (cantidad en unidad base). */
function ingredientesRpc(ingredientes) {
  return (ingredientes || []).map((ing) => ({
    tipo: ing.tipo === "receta" ? "receta" : "insumo",
    ref_id: ing.ref_id,
    cantidad: Number(ing.cantidad) || 0,
  }));
}

/**
 * Crea una receta + sus ingredientes (RPC guardar_receta: todo o nada). La base
 * valida ciclos, calcula el costo y asigna el código REC-nnn. Devuelve el id.
 * El 4.º parámetro (costo) se mantiene por compatibilidad y se ignora: el costo
 * lo calcula la base.
 */
export async function crear(empresaId, datos, ingredientes, _costoIgnorado = 0) {
  if (!empresaId) throw new Error("Falta la empresa del usuario.");
  if (!datos.nombre || !datos.nombre.trim()) throw new Error("El nombre es obligatorio.");
  const { data, error } = await supabase.rpc("guardar_receta", {
    p_id: null, p_datos: datosRpc(datos), p_ingredientes: ingredientesRpc(ingredientes),
  });
  if (error) throw error;
  return data;
}

/** Actualiza una receta: datos e ingredientes en una sola transacción (si falla, queda como estaba). */
export async function actualizar(empresaId, id, datos, ingredientes, _costoIgnorado = 0) {
  const { error } = await supabase.rpc("guardar_receta", {
    p_id: id, p_datos: datosRpc(datos), p_ingredientes: ingredientesRpc(ingredientes),
  });
  if (error) throw error;
  return id;
}

/**
 * Recalcula el costo (snapshot) de TODAS las recetas de la empresa en la base
 * (RPC recalcular_costos). Ya no hace falta llamarla tras cambiar un insumo: los
 * triggers y las RPC lo hacen solas; queda para el botón "Recalcular".
 * @returns {number} cantidad de recetas que cambiaron
 */
export async function recalcularTodas() {
  const { data, error } = await supabase.rpc("recalcular_costos");
  if (error) throw error;
  return Number(data) || 0;
}

/** Baja lógica. */
export async function desactivar(id) {
  const { error } = await supabase.from("recetas").update({ activo: false }).eq("id", id);
  if (error) throw error;
}
