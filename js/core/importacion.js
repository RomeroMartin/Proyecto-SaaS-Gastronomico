// ============================================================
// core/importacion.js — Importación masiva desde Excel (Fase 5)
// ------------------------------------------------------------
// Lógica pura (sin DOM ni red): define las plantillas de proveedores, insumos y
// gastos fijos, reconoce los encabezados del archivo, valida y normaliza cada
// fila y arma los datos que reciben las RPC `importar_*` (ver f5_importacion.sql).
// El costo de los insumos se calcula con las MISMAS funciones que el formulario
// de Insumos (core/unidades.js), así que un insumo importado y uno cargado a mano
// dan el mismo costo.
// ============================================================

import { FACTORES_A_BASE, UNIDADES_POR_MAGNITUD, MAGNITUDES, costoNetoPorUnidadBase } from "./unidades.js";
import { ALICUOTAS_IVA, CONDICIONES_FISCALES } from "./fiscal.js";
import { pesosACentavos } from "./dinero.js";

export const MAX_FILAS = 2000;
export const MAX_BYTES = 5 * 1024 * 1024;

// ---------- utilidades de lectura ----------
/** Clave comparable de un encabezado: sin tildes, minúsculas, solo letras y números. */
export function normalizarClave(s) {
  return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
const vacio = (v) => v === null || v === undefined || String(v).trim() === "";
const texto = (v) => (vacio(v) ? "" : String(v).trim());

/**
 * Número escrito en cualquier formato habitual: 1500, "1.500,25", "0,125", "0.125", "1.000".
 * @returns {number|null} null si no se puede leer
 */
export function numero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v == null ? "" : v).trim().replace(/[\s$%]/g, "");
  if (s === "") return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const punto = s.includes("."), coma = s.includes(",");
  if (punto && coma) {
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    s = s.split(dec === "," ? "." : ",").join("").replace(dec, ".");
  } else if (coma) {
    s = s.split(",").length > 2 ? s.split(",").join("") : s.replace(",", ".");
  } else if (punto) {
    const partes = s.split(".");
    // "1.000" y "1.000.000" son miles; "0.125" y "2.5" son decimales
    if (partes.length > 2 || (partes[1].length === 3 && partes[0] !== "0" && partes[0] !== "-0")) s = partes.join("");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const SI = new Set(["si", "s", "x", "1", "true", "verdadero", "ok", "coniva", "incluye"]);
const NO = new Set(["no", "n", "0", "false", "falso", "neto", "siniva"]);
/** @returns {boolean|null} null si no se entiende */
export function booleano(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  const k = normalizarClave(v);
  if (k === "") return null;
  if (SI.has(k)) return true;
  if (NO.has(k)) return false;
  return null;
}

// ---------- unidades ----------
const ALIAS_UNIDAD = {
  g: "g", gr: "g", grs: "g", gramo: "g", gramos: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
  mg: "mg", miligramo: "mg", miligramos: "mg",
  ml: "ml", mililitro: "ml", mililitros: "ml",
  l: "l", lt: "l", lts: "l", litro: "l", litros: "l",
  cc: "cc", cm3: "cc",
  oz: "oz", onza: "oz", onzas: "oz",
  un: "un", u: "un", unid: "un", unidad: "un", unidades: "un", porcion: "un", porciones: "un", pieza: "un", piezas: "un",
  docena: "docena", docenas: "docena", ciento: "ciento", cientos: "ciento",
};
/** Unidad canónica (g, kg, ml, l, cc, oz, un…) o null. */
export function unidadCanonica(v) {
  const k = normalizarClave(v);
  return Object.prototype.hasOwnProperty.call(ALIAS_UNIDAD, k) ? ALIAS_UNIDAD[k] : null;
}
/** Magnitud (masa/volumen/unidad) de una unidad canónica. */
export function magnitudDe(unidad) {
  return Object.keys(UNIDADES_POR_MAGNITUD).find((m) => UNIDADES_POR_MAGNITUD[m].includes(unidad)) || null;
}

const ALIAS_CONDICION = {
  ri: "responsable_inscripto", responsableinscripto: "responsable_inscripto", respinscripto: "responsable_inscripto", inscripto: "responsable_inscripto",
  monotributo: "monotributo", monotributista: "monotributo", mono: "monotributo",
  exento: "exento", ex: "exento",
};
export function condicionFiscal(v) {
  const k = normalizarClave(v);
  if (CONDICIONES_FISCALES.includes(v)) return v;
  return Object.prototype.hasOwnProperty.call(ALIAS_CONDICION, k) ? ALIAS_CONDICION[k] : null;
}
const lista = (v) => texto(v).split(/[,;/|]/).map((x) => x.trim()).filter(Boolean);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- definición de las plantillas ----------
// aliases: otros nombres de columna que se aceptan (además del título), ya normalizados.
export const TIPOS = {
  proveedores: {
    titulo: "Proveedores",
    hoja: "Proveedores",
    columnas: [
      { clave: "nombre", titulo: "Nombre", requerida: true, ejemplo: ["Lácteos del Sur", "Verdulería Don Juan"], ayuda: "Nombre de fantasía. Es lo que se usa para detectar proveedores repetidos." },
      { clave: "razon_social", titulo: "Razón social", ejemplo: ["Lácteos del Sur S.R.L.", ""], aliases: ["razonsocial"] },
      { clave: "cuit", titulo: "CUIT", ejemplo: ["30-12345678-9", ""] },
      { clave: "condicion_fiscal", titulo: "Condición fiscal", ejemplo: ["Responsable inscripto", "Monotributo"], ayuda: "Responsable inscripto, Monotributo o Exento. Si queda vacía: Responsable inscripto.", aliases: ["condicion", "iva"] },
      { clave: "contacto", titulo: "Contacto", ejemplo: ["Marcela", "Juan"] },
      { clave: "telefono", titulo: "Teléfono", ejemplo: ["11 5555-1234", "11 4444-0000"], aliases: ["tel", "celular", "whatsapp"] },
      { clave: "email", titulo: "Email", ejemplo: ["ventas@lacteos.com", ""], aliases: ["mail", "correo"] },
      { clave: "rubros", titulo: "Rubros", ejemplo: ["Lácteos, Almacén", "Verdulería"], ayuda: "Uno o varios, separados por coma. El primero es el principal." },
    ],
  },
  insumos: {
    titulo: "Insumos",
    hoja: "Insumos",
    columnas: [
      { clave: "nombre", titulo: "Nombre", requerida: true, ejemplo: ["Aperol 750cc", "Harina 0000 x 25kg"], ayuda: "Conviene incluir la presentación en el nombre. Se usa para detectar insumos repetidos." },
      { clave: "rubro", titulo: "Rubro", ejemplo: ["Bebidas con alcohol", "Almacén"] },
      { clave: "proveedor", titulo: "Proveedor", ejemplo: ["", "Molinos del Sur"], ayuda: "Nombre de un proveedor YA cargado (importá primero los proveedores)." },
      { clave: "presentacion", titulo: "Presentación", ejemplo: ["Botella 750 cc", "Bolsa 25 kg"], ayuda: "Cómo lo comprás (texto libre).", aliases: ["descripcion", "presentaciondecompra"] },
      { clave: "cantidad", titulo: "Cantidad", requerida: true, ejemplo: [750, 25], ayuda: "Cuánto trae la presentación, en la unidad de la columna siguiente.", aliases: ["cantidadquetrae", "contenido"] },
      { clave: "unidad", titulo: "Unidad", requerida: true, ejemplo: ["ml", "kg"], ayuda: "g, kg, mg, ml, l, cc, oz, un (docena, ciento). En esa unidad se cargan luego las recetas." },
      { clave: "precio", titulo: "Precio", requerida: true, ejemplo: [8253.41, 24000], ayuda: "Lo que cuesta TODA la presentación (no por unidad).", aliases: ["preciodelapresentacion", "costo"] },
      { clave: "precio_con_iva", titulo: "Precio incluye IVA", ejemplo: ["No", "Sí"], ayuda: "Sí o No. Si queda vacío se toma como No (precio neto, sin IVA).", aliases: ["incluyeiva", "coniva", "preciocoiniva"] },
      { clave: "iva", titulo: "IVA %", ejemplo: [21, 21], ayuda: "0, 10,5, 21 o 27. Si queda vacío: 21.", aliases: ["alicuota", "alicuotaiva"] },
      { clave: "factor", titulo: "Factor de corrección", ejemplo: [1, 0.85], ayuda: "Rendimiento tras limpieza o desposte. 1 = sin pérdida; 0,85 = queda 85 % útil. Vacío: 1.", aliases: ["factordecorreccion", "merma", "rendimiento"] },
    ],
  },
  gastos: {
    titulo: "Gastos fijos",
    hoja: "Gastos fijos",
    columnas: [
      { clave: "nombre", titulo: "Nombre", requerida: true, ejemplo: ["Alquiler del local", "Luz"], ayuda: "Se usa para detectar gastos repetidos." },
      { clave: "categoria", titulo: "Categoría", requerida: true, ejemplo: ["alquiler", "servicios"] },
      { clave: "monto", titulo: "Monto mensual", requerida: true, ejemplo: [1500000, 80000], ayuda: "En pesos, por mes. Sin sueldos si usás RRHH.", aliases: ["montomensual", "importe"] },
      { clave: "dia", titulo: "Día de vencimiento", ejemplo: [10, ""], ayuda: "Opcional: de 1 a 31.", aliases: ["diavencimiento", "vence", "vencimiento"] },
      { clave: "caja", titulo: "Egresos de caja que cuentan como pagado", ejemplo: ["Alquiler", ""], ayuda: "Opcional: categorías de egreso del Flujo de caja, separadas por coma.", aliases: ["categoriascaja", "categoriasdecaja", "egresos"] },
    ],
  },
};

/** Clave normalizada → columna, para un tipo. */
function indiceColumnas(tipo) {
  const idx = new Map();
  for (const c of TIPOS[tipo].columnas) {
    idx.set(normalizarClave(c.titulo), c);
    idx.set(normalizarClave(c.clave), c);
    for (const a of c.aliases || []) idx.set(normalizarClave(a), c);
  }
  return idx;
}

/**
 * Reconoce los encabezados del archivo.
 * @param {string} tipo
 * @param {string[]} encabezados
 * @returns {{mapa: Object<string,string>, faltantes: string[], desconocidas: string[]}}
 *   mapa: encabezado original → clave de columna
 */
export function reconocerEncabezados(tipo, encabezados) {
  const idx = indiceColumnas(tipo), mapa = {}, vistas = new Set(), desconocidas = [];
  for (const h of encabezados) {
    if (vacio(h)) continue;
    const c = idx.get(normalizarClave(h));
    if (c && !vistas.has(c.clave)) { mapa[h] = c.clave; vistas.add(c.clave); } else desconocidas.push(String(h));
  }
  const faltantes = TIPOS[tipo].columnas.filter((c) => c.requerida && !vistas.has(c.clave)).map((c) => c.titulo);
  return { mapa, faltantes, desconocidas };
}

/**
 * Pasa las filas crudas del archivo (objetos encabezado → valor) a filas con claves canónicas.
 * Ignora las filas totalmente vacías. `n` es el número de fila en el Excel (la 1 son los encabezados).
 */
export function normalizarFilas(tipo, crudas) {
  const encabezados = crudas.length ? Object.keys(crudas[0]) : [];
  const { mapa, faltantes, desconocidas } = reconocerEncabezados(tipo, encabezados);
  const filas = [];
  crudas.forEach((r, i) => {
    const f = { n: i + 2 };
    let algo = false;
    for (const [h, clave] of Object.entries(mapa)) { f[clave] = r[h]; if (!vacio(r[h])) algo = true; }
    if (algo) filas.push(f);
  });
  return { filas, faltantes, desconocidas, encabezadosLeidos: encabezados.length };
}

// ---------- validación por tipo ----------
const claveNombre = (s) => texto(s).toLowerCase();

function validarProveedor(f, ctx) {
  const errores = [], avisos = [];
  const nombre = texto(f.nombre);
  if (!nombre) errores.push("Falta el nombre.");
  else if (nombre.length > 255) errores.push("El nombre es demasiado largo (máx. 255).");
  let cond = null;
  if (!vacio(f.condicion_fiscal)) {
    cond = condicionFiscal(f.condicion_fiscal);
    if (!cond) errores.push(`Condición fiscal no reconocida: «${texto(f.condicion_fiscal)}» (Responsable inscripto, Monotributo o Exento).`);
  }
  const email = texto(f.email);
  if (email && !EMAIL.test(email)) errores.push(`El email «${email}» no es válido.`);
  const cuit = texto(f.cuit);
  if (cuit && !/^[\d-]{8,13}$/.test(cuit.replace(/\s/g, ""))) avisos.push("El CUIT no parece válido (se importa igual).");
  return {
    nombre, errores, avisos,
    datos: { nombre, razon_social: texto(f.razon_social), cuit, condicion_fiscal: cond || "", contacto: texto(f.contacto), telefono: texto(f.telefono), email, rubros: lista(f.rubros) },
    resumen: [cond ? cond.replace("_", " ") : "", texto(f.telefono), lista(f.rubros).join(", ")].filter(Boolean).join(" · "),
  };
}

function validarInsumo(f, ctx) {
  const errores = [], avisos = [];
  const nombre = texto(f.nombre);
  if (!nombre) errores.push("Falta el nombre.");
  else if (nombre.length > 255) errores.push("El nombre es demasiado largo (máx. 255).");

  const unidad = vacio(f.unidad) ? null : unidadCanonica(f.unidad);
  if (vacio(f.unidad)) errores.push("Falta la unidad.");
  else if (!unidad) errores.push(`Unidad no reconocida: «${texto(f.unidad)}» (g, kg, mg, ml, l, cc, oz, un).`);

  const cantidad = vacio(f.cantidad) ? null : numero(f.cantidad);
  if (vacio(f.cantidad)) errores.push("Falta la cantidad que trae la presentación.");
  else if (cantidad === null || cantidad <= 0) errores.push(`La cantidad «${texto(f.cantidad)}» tiene que ser un número mayor a cero.`);

  const precioNum = vacio(f.precio) ? null : numero(f.precio);
  if (vacio(f.precio)) errores.push("Falta el precio.");
  else if (precioNum === null || precioNum <= 0) errores.push(`El precio «${texto(f.precio)}» tiene que ser un número mayor a cero.`);

  let conIva = false;
  if (!vacio(f.precio_con_iva)) {
    conIva = booleano(f.precio_con_iva);
    if (conIva === null) { errores.push(`«Precio incluye IVA» tiene que ser Sí o No (dice «${texto(f.precio_con_iva)}»).`); conIva = false; }
  }
  let iva = 21;
  if (!vacio(f.iva)) {
    iva = numero(f.iva);
    if (iva !== null && iva > 0 && iva < 1) iva = Math.round(iva * 1000) / 10;   // celda con formato % (0,21 = 21 %)
    if (iva === null || !ALICUOTAS_IVA.includes(iva)) { errores.push(`IVA no válido: «${texto(f.iva)}» (${ALICUOTAS_IVA.join(", ")}).`); iva = 21; }
  }
  let factor = 1;
  if (!vacio(f.factor)) {
    factor = numero(f.factor);
    if (factor === null || factor <= 0) { errores.push(`El factor de corrección «${texto(f.factor)}» tiene que ser mayor a cero.`); factor = 1; }
    else if (factor > 1) avisos.push("Factor de corrección mayor a 1: el insumo rendiría más de lo que se compra.");
  }

  let provId = null;
  const prov = texto(f.proveedor);
  if (prov) {
    provId = ctx.proveedores ? ctx.proveedores.get(claveNombre(prov)) || null : null;
    if (!provId) errores.push(`El proveedor «${prov}» no existe: importalo o cargalo antes.`);
  }

  let datos = null, resumen = "";
  if (!errores.length) {
    const magnitud = magnitudDe(unidad);
    const netoPesos = conIva ? precioNum / (1 + iva / 100) : precioNum;
    const precioCentavos = Math.round(netoPesos * 100);
    const cantidadBase = cantidad * FACTORES_A_BASE[unidad];
    const costo = costoNetoPorUnidadBase(precioCentavos, cantidadBase);
    datos = {
      nombre, rubro: texto(f.rubro), magnitud, unidad_base: MAGNITUDES[magnitud].base, costo_neto_por_unidad_base_centavos: costo,
      alicuota_iva: iva, factor_correccion: factor, presentacion_desc: texto(f.presentacion),
      presentacion_cantidad_base: cantidadBase, presentacion_precio_neto_centavos: precioCentavos,
      presentacion_magnitud: magnitud, presentacion_cantidad: cantidad, presentacion_unidad: unidad, unidad_uso: unidad,
      proveedor_habitual_id: provId,
    };
    const porUso = (costo * FACTORES_A_BASE[unidad]) / 100;
    resumen = `${cantidad} ${unidad} · neto $${(precioCentavos / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · $${porUso.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} por ${unidad}`;
    if (costo === 0) avisos.push("El costo por unidad da 0: revisá cantidad y precio.");
  }
  return { nombre, errores, avisos, datos, resumen };
}

function validarGasto(f, ctx) {
  const errores = [], avisos = [];
  const nombre = texto(f.nombre), categoria = texto(f.categoria);
  if (!nombre) errores.push("Falta el nombre.");
  else if (nombre.length > 120) errores.push("El nombre es demasiado largo (máx. 120).");
  if (!categoria) errores.push("Falta la categoría.");
  else if (categoria.length > 40) errores.push("La categoría es demasiado larga (máx. 40).");
  else if (ctx.conRRHH && (ctx.categoriasReservadas || []).includes(categoria.toLowerCase())) {
    errores.push("Los sueldos y cargas salen de RRHH: no se cargan como gasto fijo.");
  }
  let centavos = 0;
  if (vacio(f.monto)) errores.push("Falta el monto mensual.");
  else {
    const m = numero(f.monto);
    centavos = m === null ? 0 : typeof f.monto === "number" ? Math.round(f.monto * 100) : pesosACentavos(f.monto);
    if (m === null || centavos <= 0) errores.push(`El monto «${texto(f.monto)}» tiene que ser mayor a cero.`);
  }
  let dia = null;
  if (!vacio(f.dia)) {
    dia = numero(f.dia);
    if (dia === null || !Number.isInteger(dia) || dia < 1 || dia > 31) { errores.push(`El día de vencimiento «${texto(f.dia)}» va de 1 a 31.`); dia = null; }
  }
  return {
    nombre, errores, avisos,
    datos: { nombre, categoria, monto_mensual_centavos: centavos, dia_vencimiento: dia, categorias_caja: lista(f.caja) },
    resumen: [categoria, centavos > 0 ? `$${(centavos / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mes` : "", dia ? `vence el ${dia}` : ""].filter(Boolean).join(" · "),
  };
}

const VALIDADORES = { proveedores: validarProveedor, insumos: validarInsumo, gastos: validarGasto };

/**
 * Valida todas las filas y las clasifica.
 * @param {string} tipo  proveedores | insumos | gastos
 * @param {object[]} filas  salida de normalizarFilas().filas
 * @param {object} ctx  { existentes:Set<string en minúsculas>, proveedores:Map<nombre en minúsculas, id>,
 *                        conRRHH:boolean, categoriasReservadas:string[] }
 * @returns {{filas: object[], resumen: {total, nuevas, existentes, conError, avisos}}}
 *   cada fila: { n, nombre, estado:'nueva'|'existente'|'error', errores, avisos, datos, resumen }
 */
export function validarFilas(tipo, filas, ctx = {}) {
  const validar = VALIDADORES[tipo];
  if (!validar) throw new Error(`Tipo de importación desconocido: ${tipo}`);
  const existentes = ctx.existentes || new Set();
  const vistos = new Map();
  const salida = filas.map((f) => {
    const r = validar(f, ctx);
    const k = claveNombre(r.nombre);
    if (k) {
      if (vistos.has(k)) r.errores.push(`Repetida en el archivo (ya está en la fila ${vistos.get(k)}).`);
      else vistos.set(k, f.n);
    }
    const estado = r.errores.length ? "error" : existentes.has(k) ? "existente" : "nueva";
    return { n: f.n, nombre: r.nombre, estado, errores: r.errores, avisos: r.avisos, datos: r.datos, resumen: r.resumen };
  });
  return {
    filas: salida,
    resumen: {
      total: salida.length,
      nuevas: salida.filter((x) => x.estado === "nueva").length,
      existentes: salida.filter((x) => x.estado === "existente").length,
      conError: salida.filter((x) => x.estado === "error").length,
      avisos: salida.filter((x) => x.avisos.length).length,
    },
  };
}

/** Datos listos para la RPC: las filas válidas, sin las existentes si no se actualiza. */
export function filasParaImportar(validadas, actualizar) {
  return validadas.filas.filter((x) => x.estado === "nueva" || (actualizar && x.estado === "existente")).map((x) => x.datos);
}

/** Matriz (arreglo de arreglos) de la hoja de datos de la plantilla: solo encabezados. */
export function matrizPlantilla(tipo) {
  return [TIPOS[tipo].columnas.map((c) => c.titulo)];
}
/** Matriz de la hoja de ejemplo. */
export function matrizEjemplo(tipo) {
  const cols = TIPOS[tipo].columnas, n = Math.max(...cols.map((c) => c.ejemplo.length));
  return [cols.map((c) => c.titulo), ...Array.from({ length: n }, (_, i) => cols.map((c) => (c.ejemplo[i] === undefined ? "" : c.ejemplo[i])))];
}
/** Matriz de la hoja de instrucciones. */
export function matrizInstrucciones(tipo) {
  const t = TIPOS[tipo];
  return [
    [`Plantilla de importación — ${t.titulo}`],
    [""],
    ["1. Completá la hoja «Datos» (una fila por cada uno). La hoja «Ejemplo» muestra cómo."],
    ["2. No cambies los títulos de las columnas. El orden no importa."],
    ["3. Las columnas con * son obligatorias."],
    ["4. Guardá el archivo y subilo desde la pantalla de la app (Importar desde Excel)."],
    [""],
    ["Columna", "Obligatoria", "Ayuda"],
    ...t.columnas.map((c) => [c.titulo, c.requerida ? "Sí *" : "No", c.ayuda || ""]),
  ];
}
