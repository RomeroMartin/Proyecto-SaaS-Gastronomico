// ============================================================
// saas/data/usuariosRepo.js — Usuarios de la empresa (Configuración)
// ------------------------------------------------------------
// La cuenta se crea en Supabase → Authentication y se VINCULA a la empresa con
// vincular_usuario(); acá además se gestiona rol y estado (solo ADMIN, por RLS).
// ============================================================

import { supabase } from "../../config/supabase.js";

/** Lista los usuarios de la empresa. */
export async function listar() {
  const { data, error } = await supabase
    .from("usuarios")
    .select("*")
    .order("nombre", { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Actualiza rol y/o estado de un usuario. */
export async function actualizar(id, datos) {
  const permitidos = ["rol", "activo", "nombre"];
  const payload = {};
  for (const k of permitidos) if (k in datos) payload[k] = datos[k];
  const { error } = await supabase.from("usuarios").update(payload).eq("id", id);
  if (error) throw error;
}

/**
 * Vincula a la empresa una cuenta ya creada en Supabase → Authentication
 * (RPC vincular_usuario, solo ADMIN). Devuelve el id del usuario.
 */
export async function vincular(email, rol, nombre) {
  const { data, error } = await supabase.rpc("vincular_usuario", {
    p_email: (email || "").trim(), p_rol: rol, p_nombre: (nombre || "").trim() || null,
  });
  if (error) throw error;
  return data;
}
