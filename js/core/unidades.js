// ============================================================
// core/unidades.js — Conversiones a unidad base (Regla de Oro 3.1)
// ------------------------------------------------------------
// TODA magnitud física se almacena en UNIDAD BASE:
//   masa    → gramo (g)
//   volumen → mililitro (ml)
//   unidad  → unidad (un)
// La "presentación de compra" existe SOLO para la UI y la conversión;
// la lógica de negocio jamás la usa para calcular.
// Este módulo NO conoce Firebase ni el DOM.
// ============================================================

import { redondearCentavos } from "./dinero.js";

/** Magnitudes soportadas y su unidad base canónica. */
export const MAGNITUDES = {
  masa: { base: "g", nombre: "Masa" },
  volumen: { base: "ml", nombre: "Volumen" },
  unidad: { base: "un", nombre: "Unidad" },
};

/**
 * Factores de conversión a la unidad base de cada magnitud.
 * clave: unidad ingresada → cuántas unidades base equivale 1 de ellas.
 */
export const FACTORES_A_BASE = {
  // masa → g
  g: 1,
  kg: 1000,
  mg: 0.001,
  // volumen → ml
  ml: 1,
  l: 1000,
  cc: 1,
  oz: 29.5735, // onza líquida (US)
  // unidad → un
  un: 1,
  docena: 12,
  ciento: 100,
};

/** Unidades válidas para cada magnitud (para poblar selects de la UI). */
export const UNIDADES_POR_MAGNITUD = {
  masa: ["g", "kg", "mg"],
  volumen: ["ml", "l", "cc", "oz"],
  unidad: ["un", "docena", "ciento"],
};

/**
 * Devuelve la unidad base ("g" | "ml" | "un") de una magnitud.
 * @param {string} magnitud
 * @returns {string}
 */
export function unidadBaseDe(magnitud) {
  const m = MAGNITUDES[magnitud];
  if (!m) throw new Error(`Magnitud desconocida: ${magnitud}`);
  return m.base;
}

/**
 * Convierte una cantidad expresada en cualquier unidad a la unidad base.
 * Ej: convertirAUnidadBase(5, "kg") → 5000  (gramos)
 * @param {number} cantidad
 * @param {string} unidad
 * @returns {number} cantidad en unidad base
 */
export function convertirAUnidadBase(cantidad, unidad) {
  const factor = FACTORES_A_BASE[String(unidad).toLowerCase()];
  if (factor === undefined) throw new Error(`Unidad desconocida: ${unidad}`);
  return (Number(cantidad) || 0) * factor;
}

/**
 * Cuántas unidades base equivale 1 de `unidad` (ej: "oz" → 29.5735 ml).
 * @param {string} unidad
 * @returns {number}
 */
export function factorAUnidadBase(unidad) {
  const factor = FACTORES_A_BASE[String(unidad).toLowerCase()];
  if (factor === undefined) throw new Error(`Unidad desconocida: ${unidad}`);
  return factor;
}

/**
 * Convierte una cantidad en unidad base a otra unidad de la misma magnitud.
 * Ej: convertirDesdeUnidadBase(59.147, "oz") → 2
 * @param {number} cantidadBase
 * @param {string} unidad
 * @returns {number}
 */
export function convertirDesdeUnidadBase(cantidadBase, unidad) {
  return (Number(cantidadBase) || 0) / factorAUnidadBase(unidad);
}

/**
 * A partir de una presentación de compra, deriva el costo NETO por unidad base,
 * en centavos (entero). Es el valor que se guarda en
 * `insumo.costo_neto_por_unidad_base_centavos`.
 *
 * Ej: barra 5 kg (5000 g) a $34.000 neto (3.400.000 centavos)
 *     → 3.400.000 / 5000 = 680 centavos por gramo.
 *
 * @param {number} precioNetoCentavos  precio neto de la presentación, en centavos
 * @param {number} cantidadBase        cantidad de la presentación, en unidad base
 * @returns {number} centavos por unidad base (entero, redondeado)
 */
export function costoNetoPorUnidadBase(precioNetoCentavos, cantidadBase) {
  if (!cantidadBase || cantidadBase <= 0) {
    throw new Error("La cantidad base de la presentación debe ser > 0.");
  }
  return redondearCentavos((Number(precioNetoCentavos) || 0) / cantidadBase);
}
