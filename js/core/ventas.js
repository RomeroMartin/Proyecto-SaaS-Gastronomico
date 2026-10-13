// ============================================================
// core/ventas.js — Lógica pura del mostrador (Fase 2)
// ------------------------------------------------------------
// Sin DOM ni Supabase. Los números salen siempre de la base (la RPC
// crear_pedido toma precio y costo de las recetas); acá se replica el
// cálculo SOLO para mostrar el total mientras se arma el pedido, y para
// armar la comanda (texto de WhatsApp o ticket de impresora).
// Todo en centavos enteros (Regla de Oro).
// ============================================================

import { formatearCentavos } from "./dinero.js";

export const MEDIOS_PAGO = ["efectivo", "transferencia", "tarjeta", "qr", "otro"];
export const NOMBRE_MEDIO = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", qr: "QR", otro: "Otro",
};
export const MODOS_COMANDA = ["whatsapp", "impresora", "impresora_whatsapp"];

// ---------- Totales ----------

/**
 * Total de un pedido en armado.
 * @param {Array<{precio_centavos:number, cantidad:number, adicionales?:Array<{precio_centavos:number, cantidad:number}>}>} items
 * @param {{descuento?:number, envio?:number}} [extras]
 * @returns {{subtotal:number, descuento:number, envio:number, total:number}}
 * @throws si el descuento supera el subtotal o hay valores negativos
 */
export function totalPedido(items, { descuento = 0, envio = 0 } = {}) {
  let subtotal = 0;
  for (const it of items || []) {
    subtotal += enteroPositivo(it.precio_centavos, "precio") * enteroPositivo(it.cantidad, "cantidad");
    for (const ad of it.adicionales || []) {
      subtotal += enteroPositivo(ad.precio_centavos, "precio") * enteroPositivo(ad.cantidad, "cantidad");
    }
  }
  descuento = enteroPositivo(descuento, "descuento");
  envio = enteroPositivo(envio, "envío");
  if (descuento > subtotal) throw new Error("El descuento no puede superar el subtotal.");
  return { subtotal, descuento, envio, total: subtotal - descuento + envio };
}

function enteroPositivo(n, que) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 0) throw new Error(`Valor inválido: ${que}.`);
  return v;
}

/**
 * Verifica que los pagos sumen exactamente el total (pago dividido incluido).
 * @param {Array<{medio:string, monto_centavos:number}>} pagos
 * @param {number} total
 * @param {string[]} [habilitados]
 * @returns {{ok:boolean, error?:string, suma:number}}
 */
export function validarPagos(pagos, total, habilitados = MEDIOS_PAGO) {
  if (!Array.isArray(pagos) || pagos.length === 0) return { ok: false, suma: 0, error: "Indicá cómo se cobra el pedido." };
  let suma = 0;
  for (const p of pagos) {
    if (!habilitados.includes(p.medio)) return { ok: false, suma, error: `Medio de pago no habilitado: ${p.medio}.` };
    if (!Number.isInteger(p.monto_centavos) || p.monto_centavos <= 0) return { ok: false, suma, error: "Monto de pago inválido." };
    suma += p.monto_centavos;
  }
  if (suma !== total) return { ok: false, suma, error: "Los pagos no suman el total del pedido." };
  return { ok: true, suma };
}

// ---------- Resumen del turno ----------

/**
 * Resumen de un turno (mismo cálculo que _resumen_turno() de SQL).
 * @param {Array<{estado:string, total_centavos:number, costo_total_centavos?:number, pagos:Array<{medio:string, monto_centavos:number}>}>} pedidos
 * @param {Array<{monto_centavos:number, medio?:string}>} egresos  salidas de caja del turno
 * @param {number} fondoInicial
 */
export function resumenTurno(pedidos, egresos = [], fondoInicial = 0) {
  const validos = (pedidos || []).filter((p) => p.estado !== "anulado");
  const anulados = (pedidos || []).filter((p) => p.estado === "anulado");
  const porMedio = {};
  for (const p of validos) for (const pg of p.pagos || []) porMedio[pg.medio] = (porMedio[pg.medio] || 0) + pg.monto_centavos;
  const ventas = validos.reduce((a, p) => a + p.total_centavos, 0);
  const ventasEfectivo = porMedio.efectivo || 0;
  const egresosEfectivo = (egresos || []).filter((e) => !e.medio || e.medio === "efectivo").reduce((a, e) => a + e.monto_centavos, 0);
  return {
    pedidos: validos.length,
    ventas_centavos: ventas,
    anulados: anulados.length,
    anulados_centavos: anulados.reduce((a, p) => a + p.total_centavos, 0),
    por_medio: porMedio,
    ticket_promedio_centavos: validos.length ? Math.round(ventas / validos.length) : 0,
    costo_total_centavos: validos.reduce((a, p) => a + (p.costo_total_centavos || 0), 0),
    ventas_efectivo_centavos: ventasEfectivo,
    egresos_efectivo_centavos: egresosEfectivo,
    efectivo_esperado_centavos: fondoInicial + ventasEfectivo - egresosEfectivo,
  };
}

/** Diferencia de caja: contado − esperado (negativo = faltante). */
export function diferenciaCaja(contado, esperado) {
  return contado - esperado;
}

// ---------- Comanda ----------

/** Plantilla estándar de la comanda (cada empresa puede definir la suya). */
export const PLANTILLA_COMANDA = [
  "*PEDIDO #{numero}*  ·  {negocio}",
  "{fecha} · {hora}",
  "Cliente: {cliente}",
  "Tel: {telefono}",
  "{modalidad}",
  "Dirección: {direccion}",
  "",
  "{items}",
  "",
  "Aclaraciones: {nota}",
  "",
  "*TOTAL: {total}*",
  "Pago: {pago}",
].join("\n");

const pad = (n, l = 3) => String(n).padStart(l, "0");
const NOMBRE_MODALIDAD = { retiro: "", delivery: "DELIVERY", local: "Consumo en el local" };

/** Líneas de producto ("2× Hamburguesa   $20.000", adicionales con "+"). */
export function lineasItems(items, { ancho = 0 } = {}) {
  const out = [];
  const fila = (txt, monto) => {
    const m = formatearCentavos(monto, { simbolo: true }).replace(/,00$/, "");
    if (!ancho) return `${txt}   ${m}`;
    const libre = Math.max(1, ancho - m.length - 1);
    return `${txt.length > libre ? txt.slice(0, libre) : txt.padEnd(libre)} ${m}`;
  };
  for (const it of items || []) {
    out.push(fila(`${it.cantidad}× ${it.nombre}`, it.precio_unit_centavos * it.cantidad));
    if (it.nota) out.push(`   (${it.nota})`);
    for (const ad of it.adicionales || []) out.push(fila(`   + ${ad.cantidad}× ${ad.nombre}`, ad.precio_unit_centavos * ad.cantidad));
  }
  return out;
}

/**
 * Datos de reemplazo de la plantilla para un pedido.
 * @param {object} p  {numero, creado_en, cliente_nombre, cliente_telefono, modalidad, direccion, nota,
 *                     total_centavos, items:[{nombre,cantidad,precio_unit_centavos,nota,adicionales}], pagos:[{medio,monto_centavos}]}
 */
function valoresComanda(p, { negocio = "", zona = "America/Argentina/Buenos_Aires", ancho = 0 } = {}) {
  const d = p.creado_en ? new Date(p.creado_en) : new Date();
  const f = (o) => new Intl.DateTimeFormat("es-AR", { timeZone: zona, hourCycle: "h23", ...o }).format(d);
  return {
    negocio,
    numero: pad(p.numero),
    fecha: f({ day: "numeric", month: "numeric" }).split("/").map((x) => x.padStart(2, "0")).join("/"),
    hora: f({ hour: "2-digit", minute: "2-digit" }),
    cliente: p.cliente_nombre || "",
    telefono: p.cliente_telefono || "",
    modalidad: NOMBRE_MODALIDAD[p.modalidad] || "",
    direccion: p.modalidad === "delivery" ? p.direccion || "" : "",
    items: lineasItems(p.items, { ancho }).join("\n"),
    nota: p.nota || "",
    total: formatearCentavos(p.total_centavos).replace(/,00$/, ""),
    pago: (p.pagos || []).map((x) => NOMBRE_MEDIO[x.medio] || x.medio).join(" + "),
  };
}

/**
 * Texto de la comanda a partir de una plantilla con {marcas}. Si una línea tiene
 * marcas y TODAS quedan vacías, la línea se omite (sin "Cliente: " huérfano).
 * @param {object} pedido
 * @param {{negocio?:string, plantilla?:string|null, zona?:string, ancho?:number}} [opc]
 * @returns {string}
 */
export function textoComanda(pedido, opc = {}) {
  const plantilla = (opc.plantilla && String(opc.plantilla).trim()) || PLANTILLA_COMANDA;
  const val = valoresComanda(pedido, opc);
  const lineas = [];
  for (const linea of plantilla.split("\n")) {
    const marcas = linea.match(/\{(\w+)\}/g);
    if (marcas && marcas.every((m) => !(val[m.slice(1, -1)] ?? ""))) continue;
    lineas.push(linea.replace(/\{(\w+)\}/g, (_m, k) => (k in val ? val[k] : "")));
  }
  return lineas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Enlace de WhatsApp con el texto de la comanda. */
export function urlWhatsApp(numero, texto) {
  const n = String(numero || "").replace(/\D/g, "");
  if (!n) return "";
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
}

/** Caracteres por línea según el ancho del papel de la impresora (misma tabla que ui/impresion.js). */
export function caracteresPorLinea(anchoMm) {
  return Number(anchoMm) === 58 ? 32 : 42;
}

/**
 * Ticket para impresora térmica: texto monoespaciado del ancho del papel
 * (sin asteriscos de WhatsApp). Se imprime con window.print() en una hoja angosta.
 */
export function textoTicket(pedido, opc = {}) {
  const ancho = caracteresPorLinea(opc.anchoMm);
  const txt = textoComanda(pedido, { ...opc, ancho });
  return txt.replace(/\*/g, "");
}

// ---------- Despacho de la comanda ----------

/**
 * Qué hacer con la comanda según el modo configurado y el estado del entorno.
 * Es una decisión PURA: la pantalla ejecuta las acciones. El respaldo por
 * WhatsApp es un botón que ve una persona (el navegador no siempre sabe si la
 * impresora tiene papel); sale solo cuando la impresión falla de forma detectable.
 * @param {string} modo       whatsapp | impresora | impresora_whatsapp
 * @param {{whatsappConfigurado?:boolean}} [estado]
 * @returns {{principal:string|null, respaldo:string|null, avisos:string[]}}
 */
export function planDespacho(modo, { whatsappConfigurado = true } = {}) {
  const avisos = [];
  if (!MODOS_COMANDA.includes(modo)) modo = "whatsapp";
  if (modo === "whatsapp") {
    if (!whatsappConfigurado) avisos.push("Falta configurar el WhatsApp de cocina.");
    return { principal: whatsappConfigurado ? "whatsapp" : null, respaldo: null, avisos };
  }
  if (modo === "impresora") return { principal: "impresora", respaldo: null, avisos };
  if (!whatsappConfigurado) avisos.push("Sin WhatsApp de respaldo: configuralo para poder usarlo si falla la impresora.");
  return { principal: "impresora", respaldo: whatsappConfigurado ? "whatsapp" : null, avisos };
}
