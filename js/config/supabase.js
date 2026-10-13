// ============================================================
// config/supabase.js — Cliente de Supabase (SaaS multi-tenant)
// ------------------------------------------------------------
// Reemplaza a config/firebase.js en la versión SaaS.
// La "publishable key" es PÚBLICA por diseño: puede vivir en el frontend.
// El aislamiento entre empresas lo garantizan las políticas RLS de la base
// (ver supabase/schema.sql), no el secreto de esta clave.
// ============================================================

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

/** URL del proyecto Supabase. */
export const SUPABASE_URL = "https://jcumjycveeemgcfxqydd.supabase.co";

/** Clave publicable (frontend). Protegida por RLS. */
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rPhnKUEqQCpktTCR8-2Waw_RN1XhTjl";

/** Cliente único de Supabase para toda la app. */
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,     // recuerda la sesión entre recargas
    autoRefreshToken: true,   // renueva el token solo
    detectSessionInUrl: true, // soporta links de confirmación/recuperación
  },
});

/** UID del usuario autenticado (o null). Helper de conveniencia. */
export async function uidActual() {
  const { data } = await supabase.auth.getUser();
  return data && data.user ? data.user.id : null;
}
