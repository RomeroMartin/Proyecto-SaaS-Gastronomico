// ============================================================
// saas/data/importacionRepo.js — Importación masiva (Fase 5)
// ------------------------------------------------------------
// Cada importación es UNA llamada a una RPC (todo o nada, en una transacción).
// Las filas ya vienen validadas y normalizadas por core/importacion.js.
// ============================================================

import { supabase } from "../../config/supabase.js";

const RPC = { proveedores: "importar_proveedores", insumos: "importar_insumos", gastos: "importar_gastos_fijos" };

/**
 * @param {"proveedores"|"insumos"|"gastos"} tipo
 * @param {object[]} filas  datos listos para la RPC
 * @param {boolean} actualizar  true: pisa los existentes; false: los saltea
 * @returns {{creados:number, actualizados:number, salteados:number}}
 */
export async function importar(tipo, filas, actualizar) {
  const rpc = RPC[tipo];
  if (!rpc) throw new Error(`Tipo de importación desconocido: ${tipo}`);
  const { data, error } = await supabase.rpc(rpc, { p_filas: filas, p_actualizar: !!actualizar });
  if (error) throw error;
  return data;
}
