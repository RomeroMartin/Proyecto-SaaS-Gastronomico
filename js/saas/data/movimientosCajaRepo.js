// ============================================================
// saas/data/movimientosCajaRepo.js — Flujo de caja (libro diario)
// ============================================================

import { supabase } from "../../config/supabase.js";

/** Movimientos entre dos fechas (inclusive), ordenados. */
export async function listarRango(desde, hasta) {
  const { data, error } = await supabase
    .from("movimientos_caja")
    .select("*")
    .eq("activo", true)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: false })
    .order("creado_en", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Crea un movimiento de caja. */
export async function crear(empresaId, datos) {
  if (!empresaId) throw new Error("Falta la empresa.");
  const { data: userData } = await supabase.auth.getUser();
  const payload = {
    empresa_id: empresaId,
    fecha: datos.fecha,
    tipo: datos.tipo === "egreso" ? "egreso" : "ingreso",
    categoria: (datos.categoria || "").trim() || null,
    medio: datos.medio || "efectivo",
    monto_centavos: datos.monto_centavos,
    nota: (datos.nota || "").trim() || null,
    creado_por: userData && userData.user ? userData.user.id : null,
  };
  const { data, error } = await supabase.from("movimientos_caja").insert(payload).select().single();
  if (error) throw error;
  return data;
}

/** Elimina un movimiento: en la base es una baja lógica auditada (los del cierre de caja no se pueden borrar). */
export async function eliminar(id) {
  const { error } = await supabase.from("movimientos_caja").delete().eq("id", id);
  if (error) throw error;
}
