// ============================================================
// saas/auth.js — Autenticación y sesión sobre Supabase Auth
// ------------------------------------------------------------
// Reemplaza a js/auth.js (Firebase) en la versión SaaS.
// No conoce el DOM: expone funciones que la UI consume.
// ============================================================

import { supabase } from "../config/supabase.js";

/** Inicia sesión con email + contraseña. Lanza error si falla. */
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: (email || "").trim(),
    password: password || "",
  });
  if (error) throw error;
  return data;
}

/** Cierra la sesión actual. */
export async function logout() {
  await supabase.auth.signOut();
}

/** Devuelve la sesión activa (o null si no hay). */
export async function sesionActual() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

/**
 * Perfil del usuario logueado: fila de `usuarios` + nombre de su empresa.
 * Devuelve null si el usuario autenticado todavía no tiene empresa asignada.
 * Un usuario DESACTIVADO viene con `activo: false` (la app lo desloguea).
 */
export async function miPerfil() {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData && userData.user;
  if (!user) return null;

  const { data: perfil, error } = await supabase
    .from("usuarios")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!perfil) return null;

  const { data: empresa } = await supabase
    .from("empresas")
    .select("id, nombre, costea_con_iva, zona_horaria, condicion_fiscal")
    .eq("id", perfil.empresa_id)
    .maybeSingle();

  return { ...perfil, empresa: empresa || null };
}

/** Suscribe cambios de sesión (login/logout). Devuelve la subscripción. */
export function onCambioAuth(cb) {
  const { data } = supabase.auth.onAuthStateChange((_evento, session) => cb(session));
  return data.subscription;
}
