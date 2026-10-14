// ============================================================
// core/utilsFecha.js — Helpers de fechas para RRHH (lógica pura)
// ------------------------------------------------------------
// Sin DOM, sin Supabase. Todas las fechas se manejan como strings
// ISO "YYYY-MM-DD" para evitar corrimientos por zona horaria (el
// constructor Date("2024-01-01") interpreta UTC y puede restar un día
// según la TZ del navegador). Acá parseamos a mano.
// ============================================================

/** Parsea "YYYY-MM-DD" a partes numéricas {a, m, d}. Devuelve null si no válida. */
function partes(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  return { a: +m[1], m: +m[2], d: +m[3] };
}

// ---------- Zona horaria de la empresa ----------
// La fecha de negocio ("hoy") se calcula SIEMPRE en la zona de la empresa, no en
// la del dispositivo ni en UTC (entre las 21:00 y las 24:00 de Argentina, UTC ya
// es "mañana"). La app fija la zona al iniciar sesión con setZonaHoraria().
// Espejo de fecha_en_zona()/hoy_empresa() de supabase/f0_zona_horaria.sql: los
// tests de ambos lados usan los mismos casos.
export const ZONA_POR_DEFECTO = "America/Argentina/Buenos_Aires";
let ZONA = ZONA_POR_DEFECTO;

/** Fija la zona horaria de la empresa (IANA). Una zona inválida se ignora. */
export function setZonaHoraria(zona) {
  if (!zona) return;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: zona }); ZONA = zona; } catch (_e) { /* zona inválida */ }
}

export function getZonaHoraria() { return ZONA; }

/** Fecha ISO "YYYY-MM-DD" de un instante en una zona horaria. */
export function fechaEnZona(instante = new Date(), zona = ZONA) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona || ZONA_POR_DEFECTO, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instante);
}

/**
 * Día de negocio ("fecha operativa") de un instante: si en la zona de la empresa
 * es anterior a la hora de corte, pertenece al día anterior (un local que cierra
 * pasada la medianoche vende "el día de ayer"). Espejo de fecha_operativa() en
 * supabase/f2_ventas.sql: los tests de ambos lados usan los mismos casos.
 * @param {Date} instante
 * @param {string} zona   IANA
 * @param {string} corte  "HH:MM" (default "06:00")
 */
export function fechaOperativa(instante = new Date(), zona = ZONA, corte = "06:00") {
  const hm = /^(\d{1,2}):(\d{2})/.exec(String(corte || "06:00")) || [null, "6", "00"];
  const corteMin = (+hm[1]) * 60 + (+hm[2]);
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: zona || ZONA_POR_DEFECTO, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instante);
  const h = +f.find((x) => x.type === "hour").value, m = +f.find((x) => x.type === "minute").value;
  const fecha = fechaEnZona(instante, zona);
  return (h * 60 + m) < corteMin ? addDias(fecha, -1) : fecha;
}

/** Fecha de hoy en formato ISO "YYYY-MM-DD", en la zona horaria de la empresa. */
export function hoyISO(zona = ZONA, ahora = new Date()) {
  return fechaEnZona(ahora, zona);
}

/** Suma (o resta) días a una fecha ISO. Aritmética de calendario, sin husos. */
export function addDias(iso, n) {
  const p = partes(iso);
  if (!p) return "";
  const d = new Date(Date.UTC(p.a, p.m - 1, p.d + Math.trunc(Number(n) || 0)));
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Días de diferencia (hastaISO − desdeISO). Positivo si "hasta" es posterior. */
export function diasEntre(desdeISO, hastaISO) {
  const d = partes(desdeISO), h = partes(hastaISO);
  if (!d || !h) return null;
  return Math.round((Date.UTC(h.a, h.m - 1, h.d) - Date.UTC(d.a, d.m - 1, d.d)) / 86400000);
}

/**
 * Días CORRIDOS entre dos fechas ISO, ambos extremos incluidos.
 *   diasCorridos("2024-01-01", "2024-01-01") === 1
 *   diasCorridos("2024-01-01", "2024-01-10") === 10
 * Devuelve 0 si falta algún dato o el rango es inválido (hasta < desde).
 */
export function diasCorridos(desdeISO, hastaISO) {
  const d = partes(desdeISO), h = partes(hastaISO);
  if (!d || !h) return 0;
  const a = Date.UTC(d.a, d.m - 1, d.d);
  const b = Date.UTC(h.a, h.m - 1, h.d);
  if (b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Antigüedad en años cumplidos entre fecha de ingreso y una fecha de
 * referencia (por defecto hoy). Cuenta años completos.
 */
export function antiguedadAnios(ingresoISO, refISO = hoyISO()) {
  const i = partes(ingresoISO), r = partes(refISO);
  if (!i || !r) return 0;
  let anios = r.a - i.a;
  if (r.m < i.m || (r.m === i.m && r.d < i.d)) anios -= 1;
  return Math.max(0, anios);
}

/**
 * Texto amigable de antigüedad: "2 años y 3 meses", "8 meses", "recién ingresó".
 */
export function antiguedadTexto(ingresoISO, refISO = hoyISO()) {
  const i = partes(ingresoISO), r = partes(refISO);
  if (!i || !r) return "";
  let meses = (r.a - i.a) * 12 + (r.m - i.m);
  if (r.d < i.d) meses -= 1;
  if (meses < 0) meses = 0;
  const anios = Math.floor(meses / 12);
  const rem = meses % 12;
  if (anios === 0 && rem === 0) return "menos de un mes";
  const pa = anios > 0 ? `${anios} ${anios === 1 ? "año" : "años"}` : "";
  const pm = rem > 0 ? `${rem} ${rem === 1 ? "mes" : "meses"}` : "";
  return [pa, pm].filter(Boolean).join(" y ");
}

/**
 * Suma meses a una fecha ISO y devuelve ISO. Ajusta fin de mes (ej. sumar
 * 1 mes a "2024-01-31" da "2024-02-29"). Útil para autocompletar el
 * vencimiento = emisión + vigencia_meses.
 * Devuelve "" si la fecha o los meses no son válidos.
 */
export function sumarMeses(isoBase, meses) {
  const p = partes(isoBase);
  if (!p || meses == null || !Number.isFinite(+meses)) return "";
  const total = p.m - 1 + Math.trunc(+meses);
  const a = p.a + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12; // 0..11
  const ultimoDia = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  const d = Math.min(p.d, ultimoDia);
  return `${a}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Formatea "YYYY-MM-DD" como "DD/MM/YYYY". Devuelve "—" si vacío/invalid. */
export function formatearFecha(iso) {
  const p = partes(iso);
  if (!p) return "—";
  return `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.a}`;
}

/**
 * Rangos predefinidos de reportes, a partir de "hoy" (ISO).
 * 7d / 30d: los últimos N días incluido hoy · mes: del 1.º a hoy · mes_anterior: mes calendario previo completo.
 * @returns {{desde:string, hasta:string}|null}
 */
export function rangoPreset(clave, hoy) {
  const p = partes(hoy);
  if (!p) return null;
  const iso = (a, m, d) => `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (clave === "7d") return { desde: addDias(hoy, -6), hasta: hoy };
  if (clave === "30d") return { desde: addDias(hoy, -29), hasta: hoy };
  if (clave === "mes") return { desde: iso(p.a, p.m, 1), hasta: hoy };
  if (clave === "mes_anterior") {
    const am = p.m === 1 ? { a: p.a - 1, m: 12 } : { a: p.a, m: p.m - 1 };
    const ult = new Date(Date.UTC(am.a, am.m, 0)).getUTCDate();
    return { desde: iso(am.a, am.m, 1), hasta: iso(am.a, am.m, ult) };
  }
  return null;
}
