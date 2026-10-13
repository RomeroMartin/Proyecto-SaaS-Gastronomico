// ============================================================
// saas/data/ausenciasRepo.js — Ausencias (una tabla para todos los tipos)
// ------------------------------------------------------------
// vacaciones | enfermedad | franco | licencia_especial | injustificada.
// El solapamiento lo bloquea la base (constraint ausencias_sin_solape,
// SQLSTATE 23P01): acá lo traducimos a un mensaje entendible.
// ============================================================

import { supabase } from "../../config/supabase.js";

async function uid() {
  const { data } = await supabase.auth.getUser();
  return data && data.user ? data.user.id : null;
}

export const TIPOS_AUSENCIA = [
  { valor: "vacaciones", label: "Vacaciones" },
  { valor: "enfermedad", label: "Enfermedad" },
  { valor: "franco", label: "Franco" },
  { valor: "licencia_especial", label: "Licencia especial" },
  { valor: "injustificada", label: "Falta injustificada" },
];

/** Lista las ausencias de un empleado (opcionalmente de un año). */
export async function listar(empleadoId, anio) {
  let q = supabase.from("ausencias").select("*").eq("empleado_id", empleadoId).eq("activo", true);
  if (anio) q = q.gte("desde", `${anio}-01-01`).lte("desde", `${anio}-12-31`);
  q = q.order("desde", { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Saldo de vacaciones del año en curso (vista vw_saldo_vacaciones). */
export async function saldoVacaciones(empleadoId) {
  const { data, error } = await supabase
    .from("vw_saldo_vacaciones")
    .select("*")
    .eq("empleado_id", empleadoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Crea una ausencia. dias viene precalculado desde la UI (editable).
 * @param {object} d { tipo, desde, hasta, dias, observaciones }
 */
export async function crear(empleadoId, d) {
  if (!empleadoId) throw new Error("Falta el empleado.");
  if (!d.desde || !d.hasta) throw new Error("Indicá el rango de fechas.");
  if (!(d.dias > 0)) throw new Error("Los días deben ser mayores a cero.");

  const payload = {
    empleado_id: empleadoId,
    tipo: d.tipo,
    desde: d.desde,
    hasta: d.hasta,
    dias: Math.round(d.dias),
    observaciones: (d.observaciones || "").trim() || null,
    creado_por: await uid(),
  };
  const { data, error } = await supabase.from("ausencias").insert(payload).select().single();
  if (error) {
    if (error.code === "23P01") {
      throw new Error("Ya existe una ausencia cargada para ese empleado en esas fechas.");
    }
    throw error;
  }
  return data;
}

/** Baja lógica de una ausencia (nada se borra: queda `activo = false`). */
export async function eliminar(id) {
  const { error } = await supabase.from("ausencias").update({ activo: false }).eq("id", id);
  if (error) throw error;
}
