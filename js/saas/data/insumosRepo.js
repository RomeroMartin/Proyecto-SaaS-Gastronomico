// ============================================================
// saas/data/insumosRepo.js — Insumos sobre Supabase (SQL)
// ------------------------------------------------------------
// El costo se guarda SIEMPRE por unidad base (g/ml/un) en centavos.
// Al crear/actualizar el costo se registra en historial_precios_insumo.
// /data no conoce el DOM; reutiliza core/ para el costo por unidad base.
// ============================================================

import { supabase } from "../../config/supabase.js";

/** Genera el próximo código legible tipo "INS-001". */
function siguienteCodigo(prefijo, existentes) {
  let max = 0;
  const re = new RegExp(`^${prefijo}-(\\d+)$`);
  for (const it of existentes || []) {
    const m = re.exec(it.codigo || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefijo}-${String(max + 1).padStart(3, "0")}`;
}

/** Lista los insumos activos de la empresa (ordenados por nombre). */
export async function listar() {
  const { data, error } = await supabase
    .from("insumos")
    .select("*")
    .eq("activo", true)
    .order("nombre", { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Crea un insumo. `datos` trae el costo ya calculado por unidad base:
 *   costo_neto_por_unidad_base_centavos (entero).
 * Registra el primer punto del historial de precios.
 */
export async function crear(empresaId, datos) {
  if (!empresaId) throw new Error("Falta la empresa del usuario.");
  if (!datos.nombre || !datos.nombre.trim()) throw new Error("El nombre es obligatorio.");

  const { data: userData } = await supabase.auth.getUser();
  const creadoPor = userData && userData.user ? userData.user.id : null;

  const { data: existentes } = await supabase.from("insumos").select("codigo");
  const codigo = (datos.codigo || "").trim() || siguienteCodigo("INS", existentes || []);

  const costo = Number(datos.costo_neto_por_unidad_base_centavos) || 0;

  const payload = {
    empresa_id: empresaId,
    codigo,
    nombre: datos.nombre.trim(),
    rubro: (datos.rubro || "").trim() || null,
    magnitud: datos.magnitud,
    unidad_base: datos.unidad_base,
    costo_neto_por_unidad_base_centavos: costo,
    alicuota_iva: Number(datos.alicuota_iva) || 0,
    factor_correccion: Number(datos.factor_correccion) || 1,
    presentacion_desc: (datos.presentacion_desc || "").trim() || null,
    presentacion_cantidad_base: datos.presentacion_cantidad_base || null,
    presentacion_precio_neto_centavos: datos.presentacion_precio_neto_centavos || null,
    presentacion_magnitud: datos.presentacion_magnitud || null,
    presentacion_cantidad: datos.presentacion_cantidad || null,
    presentacion_unidad: datos.presentacion_unidad || null,
    unidad_uso: datos.unidad_uso || null,
    proveedor_habitual_id: datos.proveedor_habitual_id || null,
    fecha_ultimo_precio: new Date().toISOString(),
    creado_por: creadoPor,
  };

  const { data, error } = await supabase.from("insumos").insert(payload).select().single();
  if (error) throw error;

  // Primer punto del historial.
  await supabase.from("historial_precios_insumo").insert({
    empresa_id: empresaId,
    insumo_id: data.id,
    costo_anterior_centavos: 0,
    costo_nuevo_centavos: costo,
    variacion_porcentual: 0,
    origen: "carga_inicial",
    usuario: creadoPor,
  });

  return data;
}

/**
 * Actualiza el costo por unidad base y registra el historial.
 * @returns {number} variación porcentual respecto del costo anterior.
 */
export async function actualizarCosto(empresaId, id, nuevoCostoCentavos, meta = {}) {
  const { data: actual } = await supabase
    .from("insumos").select("costo_neto_por_unidad_base_centavos, presentacion_cantidad_base").eq("id", id).maybeSingle();
  const anterior = actual ? Number(actual.costo_neto_por_unidad_base_centavos) || 0 : 0;
  const variacion = anterior > 0 ? ((nuevoCostoCentavos - anterior) / anterior) * 100 : 0;

  const { data: userData } = await supabase.auth.getUser();
  const usuario = userData && userData.user ? userData.user.id : null;

  const cambios = {
    costo_neto_por_unidad_base_centavos: nuevoCostoCentavos,
    fecha_ultimo_precio: new Date().toISOString(),
  };
  // Mantiene al día el precio de la presentación (botella, caja…): el exacto si
  // se conoce, o el derivado del nuevo costo por unidad base.
  const cantPres = actual ? Number(actual.presentacion_cantidad_base) || 0 : 0;
  if (meta.presentacion_precio_neto_centavos > 0) cambios.presentacion_precio_neto_centavos = meta.presentacion_precio_neto_centavos;
  else if (cantPres > 0) cambios.presentacion_precio_neto_centavos = Math.round(nuevoCostoCentavos * cantPres);
  const { error } = await supabase.from("insumos").update(cambios).eq("id", id);
  if (error) throw error;

  await supabase.from("historial_precios_insumo").insert({
    empresa_id: empresaId,
    insumo_id: id,
    costo_anterior_centavos: anterior,
    costo_nuevo_centavos: nuevoCostoCentavos,
    variacion_porcentual: Number(variacion.toFixed(2)),
    origen: meta.origen || "manual",
    factura_id: meta.factura_id || null,
    usuario,
  });

  return variacion;
}

/** Edita datos del insumo. El costo por unidad base va por actualizarCosto (con historial). */
export async function actualizarMeta(id, datos) {
  const permitidos = [
    "nombre", "rubro", "alicuota_iva", "factor_correccion", "proveedor_habitual_id",
    "magnitud", "unidad_base", "unidad_uso",
    "presentacion_desc", "presentacion_cantidad_base", "presentacion_precio_neto_centavos",
    "presentacion_magnitud", "presentacion_cantidad", "presentacion_unidad",
  ];
  const payload = {};
  for (const k of permitidos) if (k in datos) payload[k] = datos[k];
  payload.modificado_en = new Date().toISOString();
  const { error } = await supabase.from("insumos").update(payload).eq("id", id);
  if (error) throw error;
}

/** Baja lógica. */
export async function desactivar(id) {
  const { error } = await supabase.from("insumos").update({ activo: false }).eq("id", id);
  if (error) throw error;
}

/** Historial de precios de un insumo (cronológico). */
export async function historial(insumoId) {
  const { data, error } = await supabase
    .from("historial_precios_insumo")
    .select("*")
    .eq("insumo_id", insumoId)
    .order("fecha", { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Últimos cambios de precio de la empresa (para el resumen de Costos). */
export async function ultimosCambios(limite = 8) {
  const { data, error } = await supabase
    .from("historial_precios_insumo")
    .select("*")
    .neq("origen", "carga_inicial")
    .order("fecha", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}
