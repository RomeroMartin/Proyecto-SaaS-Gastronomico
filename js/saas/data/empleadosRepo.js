// ============================================================
// saas/data/empleadosRepo.js — Empleados sobre Supabase (SQL)
// ------------------------------------------------------------
// /data no conoce el DOM. El aislamiento por empresa lo garantiza la RLS;
// igual seteamos empresa_id explícito al insertar (lo exige el WITH CHECK).
// Nunca se hace DELETE: la baja es lógica (estado='inactivo' + fecha_egreso).
// ============================================================

import { supabase } from "../../config/supabase.js";

/** Perfil auth del usuario actual (para creado_por). */
async function uid() {
  const { data } = await supabase.auth.getUser();
  return data && data.user ? data.user.id : null;
}

/**
 * Lista el resumen de empleados (vista vw_empleados_resumen) con sueldo
 * vigente y contadores de documentos para el badge de semáforo.
 * @param {string} filtro 'activos' | 'inactivos' | 'todos'
 */
export async function listarResumen(filtro = "activos") {
  let q = supabase.from("vw_empleados_resumen").select("*");
  if (filtro === "activos") q = q.eq("estado", "activo");
  else if (filtro === "inactivos") q = q.eq("estado", "inactivo");
  q = q.order("apellido", { ascending: true }).order("nombre", { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Trae un empleado por id (tabla base, sin datos sensibles). */
export async function obtener(id) {
  const { data, error } = await supabase.from("empleados").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

const CAMPOS = ["nombre", "apellido", "apodo", "puesto", "fecha_ingreso", "fecha_alta", "telefono", "foto_url"];

/** Crea un empleado. empresaId viene del perfil del usuario (sesión). */
export async function crear(empresaId, datos) {
  if (!empresaId) throw new Error("Falta la empresa del usuario.");
  if (!datos.nombre || !datos.nombre.trim()) throw new Error("El nombre es obligatorio.");
  if (!datos.apellido || !datos.apellido.trim()) throw new Error("El apellido es obligatorio.");
  if (!datos.fecha_ingreso) throw new Error("La fecha de ingreso es obligatoria.");

  const payload = { empresa_id: empresaId, creado_por: await uid() };
  for (const k of CAMPOS) {
    if (k in datos) payload[k] = typeof datos[k] === "string" ? datos[k].trim() || null : datos[k];
  }
  payload.nombre = datos.nombre.trim();
  payload.apellido = datos.apellido.trim();

  const { data, error } = await supabase.from("empleados").insert(payload).select().single();
  if (error) throw error;
  return data;
}

/** Edita datos operativos del empleado (nunca estado ni empresa). */
export async function actualizar(id, datos) {
  const payload = { modificado_por: await uid() };
  for (const k of CAMPOS) {
    if (k in datos) payload[k] = typeof datos[k] === "string" ? datos[k].trim() || null : datos[k];
  }
  const { error } = await supabase.from("empleados").update(payload).eq("id", id);
  if (error) throw error;
}

/** Baja lógica: estado='inactivo' + fecha_egreso. NUNCA borra. */
export async function darDeBaja(id, fechaEgreso) {
  if (!fechaEgreso) throw new Error("Indicá la fecha de egreso.");
  const { error } = await supabase
    .from("empleados")
    .update({ estado: "inactivo", fecha_egreso: fechaEgreso, modificado_por: await uid() })
    .eq("id", id);
  if (error) throw error;
}

/** Reactiva a un empleado dado de baja (limpia fecha_egreso). */
export async function reactivar(id) {
  const { error } = await supabase
    .from("empleados")
    .update({ estado: "activo", fecha_egreso: null, modificado_por: await uid() })
    .eq("id", id);
  if (error) throw error;
}
