// ============================================================
// saas/data/documentosRepo.js — Documentos del empleado + Storage
// ------------------------------------------------------------
// Archivos en el bucket PRIVADO rrhh-docs. Path:
//   {empresa_id}/{empleado_id}/{uuid}-{nombre_archivo}
// El empresa_id como primer segmento deja que la política de Storage
// filtre sin joins. Los archivos se muestran SIEMPRE con signed URLs de
// expiración corta; nunca URLs públicas.
// ============================================================

import { supabase } from "../../config/supabase.js";

const BUCKET = "rrhh-docs";
const SIGNED_TTL = 60; // segundos

async function uid() {
  const { data } = await supabase.auth.getUser();
  return data && data.user ? data.user.id : null;
}

/** Sanitiza un nombre de archivo para usarlo como segmento de path. */
function limpiarNombre(nombre) {
  return String(nombre || "archivo")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
}

/** Estado de documentación de un empleado (vista con semáforo). */
export async function listarEstado(empleadoId) {
  const { data, error } = await supabase
    .from("vw_documentos_estado")
    .select("*")
    .eq("empleado_id", empleadoId)
    .order("fecha_vencimiento", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

/**
 * Tablero de vencimientos de toda la empresa: vencidos y por vencer.
 * Orden: vencidos primero, luego por días restantes ascendente.
 */
export async function listarVencimientos() {
  const { data, error } = await supabase
    .from("vw_documentos_estado")
    .select("*")
    .in("estado", ["vencido", "por_vencer"])
    .order("dias_restantes", { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Sube el archivo (ya comprimido/preparado) al bucket y crea el registro.
 * @param {string} empresaId  del perfil (primer segmento del path)
 * @param {string} empleadoId
 * @param {object} d { tipo_documento_id, numero, fecha_emision, fecha_vencimiento }
 * @param {object} archivo { blob, nombre, tipo } (de core/utilsImagen.prepararArchivo)
 */
export async function crear(empresaId, empleadoId, d, archivo) {
  if (!empresaId || !empleadoId) throw new Error("Falta empresa o empleado.");
  if (!d.tipo_documento_id) throw new Error("Elegí el tipo de documento.");

  let archivo_path = null;
  if (archivo && archivo.blob) {
    const uuid = (crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    archivo_path = `${empresaId}/${empleadoId}/${uuid}-${limpiarNombre(archivo.nombre)}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(archivo_path, archivo.blob, {
        contentType: archivo.tipo || "application/octet-stream",
        upsert: false,
      });
    if (upErr) throw upErr;
  }

  const payload = {
    empleado_id: empleadoId,
    tipo_documento_id: d.tipo_documento_id,
    numero: (d.numero || "").trim() || null,
    fecha_emision: d.fecha_emision || null,
    fecha_vencimiento: d.fecha_vencimiento || null,
    archivo_path,
    creado_por: await uid(),
  };
  const { data, error } = await supabase.from("documentos").insert(payload).select().single();
  if (error) {
    // Si falló el insert pero el archivo ya subió, intentar limpiarlo.
    if (archivo_path) await supabase.storage.from(BUCKET).remove([archivo_path]).catch(() => {});
    throw error;
  }
  return data;
}

/** Devuelve el archivo_path de un documento (la vista de estado no lo trae). */
export async function obtenerPath(id) {
  const { data, error } = await supabase
    .from("documentos")
    .select("archivo_path")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? data.archivo_path : null;
}

/** Genera una signed URL de expiración corta para ver/descargar el archivo. */
export async function urlFirmada(archivoPath) {
  if (!archivoPath) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(archivoPath, SIGNED_TTL);
  if (error) throw error;
  return data ? data.signedUrl : null;
}

/**
 * Baja lógica de un documento (nada se borra: queda `activo = false`). El archivo
 * del Storage se conserva por si hace falta recuperarlo.
 */
export async function eliminar(id, _archivoPath) {
  const { error } = await supabase.from("documentos").update({ activo: false }).eq("id", id);
  if (error) throw error;
}
