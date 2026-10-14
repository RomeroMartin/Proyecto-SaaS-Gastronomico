// ============================================================
// saas/data/reportesVentasRepo.js — Rentabilidad real (Fase 3)
// ------------------------------------------------------------
// Lee las vistas v_ventas_* y la función compras_periodo (RLS: solo
// ADMIN, GERENTE y AUDITOR ven datos). Todo agrupa por día operativo.
// ============================================================

import { supabase } from "../../config/supabase.js";

async function vista(nombre, desde, hasta) {
  const { data, error } = await supabase.from(nombre).select("*")
    .gte("fecha_operativa", desde).lte("fecha_operativa", hasta)
    .order("fecha_operativa", { ascending: true });
  if (error) throw error;
  return data || [];
}

export const porPlato = (desde, hasta) => vista("v_ventas_por_plato", desde, hasta);
export const porDia = (desde, hasta) => vista("v_ventas_por_dia", desde, hasta);
export const porHora = (desde, hasta) => vista("v_ventas_por_hora", desde, hasta);

/** Compras del período (neto + IVA, sin rubros excluidos). @returns {{compras_centavos, excluidas_centavos, facturas}} */
export async function compras(desde, hasta) {
  const { data, error } = await supabase.rpc("compras_periodo", { p_desde: desde, p_hasta: hasta });
  if (error) throw error;
  return data;
}

/** Rubros de proveedor que no cuentan como mercadería (solo ADMIN; auditado). */
export async function setRubrosExcluidos(lista) {
  const { error } = await supabase.rpc("set_config_reportes", { p_clave: "rubros_excluidos_cmv", p_valor: lista });
  if (error) throw error;
}
