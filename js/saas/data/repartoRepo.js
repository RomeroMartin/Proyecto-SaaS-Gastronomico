// ============================================================
// saas/data/repartoRepo.js — Tablero de reparto (Fase 4). Solo ADMIN (RLS + RPC).
// ============================================================

import { supabase } from "../../config/supabase.js";

// ---------- Gastos fijos (baja lógica) ----------
export async function listarGastos() {
  const { data, error } = await supabase.from("gastos_fijos").select("*").eq("activo", true)
    .order("orden", { ascending: true }).order("nombre", { ascending: true });
  if (error) throw error;
  return data || [];
}

function payload(d) {
  const monto = Number(d.monto_mensual_centavos);
  if (!d.nombre || !d.nombre.trim()) throw new Error("El nombre es obligatorio.");
  if (!d.categoria || !d.categoria.trim()) throw new Error("La categoría es obligatoria.");
  if (!Number.isInteger(monto) || monto <= 0) throw new Error("El monto mensual tiene que ser mayor a cero.");
  const dia = d.dia_vencimiento === "" || d.dia_vencimiento == null ? null : Number(d.dia_vencimiento);
  if (dia != null && !(Number.isInteger(dia) && dia >= 1 && dia <= 31)) throw new Error("El día de vencimiento va de 1 a 31.");
  return {
    nombre: d.nombre.trim(), categoria: d.categoria.trim(), monto_mensual_centavos: monto, dia_vencimiento: dia,
    categorias_caja: (d.categorias_caja || []).map((x) => String(x).trim()).filter(Boolean), orden: Number(d.orden) || 0,
  };
}

export async function crearGasto(empresaId, datos) {
  const { error } = await supabase.from("gastos_fijos").insert({ empresa_id: empresaId, ...payload(datos) });
  if (error) throw error;
}
export async function actualizarGasto(id, datos) {
  const { error } = await supabase.from("gastos_fijos").update(payload(datos)).eq("id", id);
  if (error) throw error;
}
export async function darDeBajaGasto(id) {
  const { error } = await supabase.from("gastos_fijos").update({ activo: false }).eq("id", id);
  if (error) throw error;
}

// ---------- Sueldos desde RRHH (solo agregados) ----------
export async function gastoEmpleados(fechaISO) {
  const { data, error } = await supabase.rpc("gasto_empleados_mensual", { p_fecha: fechaISO || null });
  if (error) throw error;
  return data;
}

// ---------- Parámetros (set_config_reparto: validado y auditado) ----------
export async function setConfig(clave, valor) {
  const { error } = await supabase.rpc("set_config_reparto", { p_clave: clave, p_valor: valor });
  if (error) throw error;
}
