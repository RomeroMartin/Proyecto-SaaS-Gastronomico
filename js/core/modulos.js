// ============================================================
// core/modulos.js — Módulos activables por empresa (Fase 1)
// ------------------------------------------------------------
// Lógica pura: qué módulos existen, sus dependencias y si una
// empresa tiene uno activo. La base valida lo mismo (trigger
// _trg_validar_modulos); acá sirve para el menú y los mensajes.
// El gating por módulo es de EXPERIENCIA, no de seguridad.
// ============================================================

/** Módulos que se pueden activar (el orden es el canónico). */
export const MODULOS_VALIDOS = ["admin", "costos", "carta", "rrhh", "ventas", "reparto"];

/** Lo que tenían todas las empresas antes de la Fase 1. */
export const MODULOS_POR_DEFECTO = ["admin", "costos", "carta", "rrhh"];

/** módulo → módulos que necesita para poder activarse. */
export const DEPENDENCIAS = {
  ventas: ["carta", "admin"],
  reparto: ["admin"],
};

/** Grupos del menú que no son módulos: siempre visibles. */
const SIEMPRE = new Set(["config"]);

/**
 * Normaliza la lista de módulos de una empresa. Si no vino (columna aún no
 * creada / perfil viejo) se asume lo que ya usaban: MODULOS_POR_DEFECTO.
 * @param {string[]|null|undefined} modulos
 * @returns {string[]} sin repetidos ni valores desconocidos, en orden canónico
 */
export function normalizarModulos(modulos) {
  if (!Array.isArray(modulos)) return [...MODULOS_POR_DEFECTO];
  return MODULOS_VALIDOS.filter((m) => modulos.includes(m));
}

/**
 * ¿La empresa tiene activo este grupo del menú? `config` siempre.
 * @param {string[]|null|undefined} modulos
 * @param {string} id
 */
export function moduloActivo(modulos, id) {
  if (SIEMPRE.has(id)) return true;
  return normalizarModulos(modulos).includes(id);
}

/**
 * Valida una lista de módulos con las mismas reglas que la base.
 * @returns {{ok: boolean, errores: string[]}}
 */
export function validarModulos(modulos) {
  const errores = [];
  if (!Array.isArray(modulos)) return { ok: false, errores: ["La lista de módulos es obligatoria."] };
  const desconocidos = modulos.filter((m) => !MODULOS_VALIDOS.includes(m));
  if (desconocidos.length) errores.push(`Módulo(s) desconocido(s): ${[...new Set(desconocidos)].join(", ")}.`);
  const validos = modulos.filter((m) => MODULOS_VALIDOS.includes(m));
  if (!validos.length) errores.push("La empresa debe tener al menos un módulo activo.");
  for (const [m, reqs] of Object.entries(DEPENDENCIAS)) {
    if (validos.includes(m) && !reqs.every((r) => validos.includes(r))) {
      errores.push(`El módulo ${m} requiere los módulos ${reqs.join(" y ")}.`);
    }
  }
  return { ok: errores.length === 0, errores };
}
