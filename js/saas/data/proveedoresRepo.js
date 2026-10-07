// ============================================================
// saas/data/proveedoresRepo.js — Proveedores sobre Supabase (SQL)
// ------------------------------------------------------------
// Misma filosofía que los repos Firestore: /data no conoce el DOM.
// El aislamiento por empresa lo garantiza la RLS; igual seteamos
// empresa_id explícito al insertar (lo exige el WITH CHECK de la política).
// El saldo NO se toca desde acá: lo mueven las RPC de facturas/pagos.
// ============================================================

import { supabase } from "../../config/supabase.js";
import { CONDICIONES_FISCALES } from "../../core/fiscal.js";

export { CONDICIONES_FISCALES };

/** Genera el próximo código legible tipo "PROV-001". */
function siguienteCodigo(prefijo, existentes) {
  let max = 0;
  const re = new RegExp(`^${prefijo}-(\\d+)$`);
  for (const it of existentes || []) {
    const m = re.exec(it.codigo || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefijo}-${String(max + 1).padStart(3, "0")}`;
}

/** Lista los proveedores activos de la empresa (ordenados por nombre). */
export async function listar() {
  const { data, error } = await supabase
    .from("proveedores")
    .select("*")
    .eq("activo", true)
    .order("nombre", { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Trae un proveedor por id (con saldo fresco). */
export async function obtener(id) {
  const { data, error } = await supabase.from("proveedores").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Crea un proveedor. `empresaId` viene del perfil del usuario (sesión).
 * @returns {object} el proveedor creado
 */
export async function crear(empresaId, datos) {
  if (!empresaId) throw new Error("Falta la empresa del usuario.");
  if (!datos.nombre || !datos.nombre.trim()) throw new Error("El nombre de fantasía es obligatorio.");

  const { data: userData } = await supabase.auth.getUser();
  const creadoPor = userData && userData.user ? userData.user.id : null;

  // Código automático a partir de los existentes.
  const { data: existentes } = await supabase.from("proveedores").select("codigo");
  const codigo = (datos.codigo || "").trim() || siguienteCodigo("PROV", existentes || []);

  const payload = {
    empresa_id: empresaId,
    codigo,
    nombre: datos.nombre.trim(),
    razon_social: (datos.razon_social || "").trim() || null,
    cuit: (datos.cuit || "").trim() || null,
    condicion_fiscal: datos.condicion_fiscal || "responsable_inscripto",
    contacto: (datos.contacto || "").trim() || null,
    telefono: (datos.telefono || "").trim() || null,
    email: (datos.email || "").trim() || null,
    rubro_principal: (datos.rubro_principal || "").trim() || null,
    rubros: Array.isArray(datos.rubros) ? datos.rubros : [],
    creado_por: creadoPor,
  };

  const { data, error } = await supabase
    .from("proveedores")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Edita datos de un proveedor (nunca el saldo). */
export async function actualizar(id, datos) {
  const permitidos = ["nombre", "razon_social", "cuit", "condicion_fiscal", "contacto", "telefono", "email", "rubro_principal", "rubros"];
  const payload = {};
  for (const k of permitidos) if (k in datos) payload[k] = datos[k];
  const { error } = await supabase.from("proveedores").update(payload).eq("id", id);
  if (error) throw error;
}

/** Baja lógica (soft delete): activo = false. */
export async function desactivar(id) {
  const { error } = await supabase.from("proveedores").update({ activo: false }).eq("id", id);
  if (error) throw error;
}
