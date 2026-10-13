// ============================================================
// saas/data/auditoriaRepo.js — Rastro de cambios sensibles (solo ADMIN, solo lectura)
// ------------------------------------------------------------
// La tabla `auditoria` la llenan las RPC/triggers de la base; el cliente solo
// la lee (y la RLS solo deja leerla al ADMIN).
// ============================================================

import { supabase } from "../../config/supabase.js";

/** Últimos eventos de auditoría de la empresa (más recientes primero). */
export async function listar(limite = 200) {
  const { data, error } = await supabase
    .from("auditoria")
    .select("*")
    .order("creado_en", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}
