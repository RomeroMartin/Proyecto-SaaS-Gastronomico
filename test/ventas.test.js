import { test } from "node:test";
import assert from "node:assert/strict";
import {
  totalPedido, validarPagos, resumenTurno, diferenciaCaja, textoComanda, textoTicket,
  urlWhatsApp, caracteresPorLinea, planDespacho, PLANTILLA_COMANDA,
} from "../js/core/ventas.js";

test("totalPedido: ítems, adicionales, descuento y envío en centavos", () => {
  const r = totalPedido(
    [{ precio_centavos: 10000, cantidad: 2, adicionales: [{ precio_centavos: 1500, cantidad: 1 }] }, { precio_centavos: 2500, cantidad: 1 }],
    { descuento: 1000, envio: 500 });
  assert.deepEqual(r, { subtotal: 24000, descuento: 1000, envio: 500, total: 23500 });
});

test("totalPedido: descuento mayor al subtotal falla; valores inválidos fallan", () => {
  assert.throws(() => totalPedido([{ precio_centavos: 100, cantidad: 1 }], { descuento: 101 }), /descuento/);
  assert.throws(() => totalPedido([{ precio_centavos: 100, cantidad: 1.5 }]), /inválido/);
  assert.throws(() => totalPedido([{ precio_centavos: -1, cantidad: 1 }]), /inválido/);
  assert.equal(totalPedido([]).total, 0);
});

test("validarPagos: pago dividido, suma exacta y medios habilitados", () => {
  const h = ["efectivo", "transferencia"];
  assert.equal(validarPagos([{ medio: "efectivo", monto_centavos: 4000 }, { medio: "transferencia", monto_centavos: 6000 }], 10000, h).ok, true);
  assert.equal(validarPagos([{ medio: "efectivo", monto_centavos: 9999 }], 10000, h).ok, false);
  assert.equal(validarPagos([{ medio: "tarjeta", monto_centavos: 10000 }], 10000, h).ok, false);
  assert.equal(validarPagos([], 10000, h).ok, false);
  assert.equal(validarPagos([{ medio: "efectivo", monto_centavos: 0 }], 0, h).ok, false);
});

test("resumenTurno: anulados fuera de los totales y esperado de efectivo con egresos", () => {
  const pedidos = [
    { estado: "entregado", total_centavos: 24000, costo_total_centavos: 7000, pagos: [{ medio: "efectivo", monto_centavos: 24000 }] },
    { estado: "confirmado", total_centavos: 10000, costo_total_centavos: 3000, pagos: [{ medio: "efectivo", monto_centavos: 4000 }, { medio: "transferencia", monto_centavos: 6000 }] },
    { estado: "anulado", total_centavos: 10000, pagos: [{ medio: "efectivo", monto_centavos: 10000 }] },
  ];
  const r = resumenTurno(pedidos, [{ monto_centavos: 1200 }], 5000);
  assert.equal(r.pedidos, 2);
  assert.equal(r.ventas_centavos, 34000);
  assert.equal(r.anulados, 1);
  assert.equal(r.anulados_centavos, 10000);
  assert.deepEqual(r.por_medio, { efectivo: 28000, transferencia: 6000 });
  assert.equal(r.efectivo_esperado_centavos, 5000 + 28000 - 1200);
  assert.equal(r.ticket_promedio_centavos, 17000);
  assert.equal(r.costo_total_centavos, 10000);
  assert.equal(diferenciaCaja(31500, r.efectivo_esperado_centavos), -300);
});

test("resumenTurno: turno vacío", () => {
  const r = resumenTurno([], [], 0);
  assert.equal(r.pedidos, 0);
  assert.equal(r.ticket_promedio_centavos, 0);
  assert.equal(r.efectivo_esperado_centavos, 0);
});

// Importes en centavos: 10000 = $100.
const pedido = {
  numero: 7, creado_en: "2026-03-11T03:40:00Z", // 00:40 en Buenos Aires
  cliente_nombre: "Ana", cliente_telefono: "", modalidad: "retiro", direccion: "", nota: "sin cebolla",
  total_centavos: 24000,
  items: [
    { nombre: "Hamburguesa", cantidad: 2, precio_unit_centavos: 10000, nota: "", adicionales: [{ nombre: "Medallón extra", cantidad: 1, precio_unit_centavos: 1500 }] },
    { nombre: "Gaseosa", cantidad: 1, precio_unit_centavos: 2500 },
  ],
  pagos: [{ medio: "efectivo", monto_centavos: 24000 }],
};

test("textoComanda: plantilla estándar, hora en la zona de la empresa, sin líneas vacías", () => {
  const t = textoComanda(pedido, { negocio: "Mi Local" });
  assert.match(t, /\*PEDIDO #007\*  ·  Mi Local/);
  assert.match(t, /11\/03 · 00:40/);
  assert.match(t, /Cliente: Ana/);
  assert.doesNotMatch(t, /Tel:/);          // teléfono vacío → línea omitida
  assert.doesNotMatch(t, /Dirección:/);    // retiro → sin dirección
  assert.match(t, /2× Hamburguesa {3}\$200/);
  assert.match(t, /\+ 1× Medallón extra {3}\$15/);
  assert.match(t, /Aclaraciones: sin cebolla/);
  assert.match(t, /\*TOTAL: \$240\*/);
  assert.match(t, /Pago: Efectivo/);
  assert.doesNotMatch(t, /\n{3,}/);
});

test("textoComanda: plantilla propia de la empresa y delivery", () => {
  const t = textoComanda({ ...pedido, modalidad: "delivery", direccion: "Calle 1 N° 2", cliente_telefono: "221" },
    { negocio: "X", plantilla: "N{numero} {modalidad}\n{direccion}\n{telefono}\n{items}" });
  assert.match(t, /^N007 DELIVERY\nCalle 1 N° 2\n221\n/);
  assert.equal(textoComanda(pedido, { plantilla: "   " }).includes("PEDIDO"), true); // plantilla vacía → estándar
  assert.ok(PLANTILLA_COMANDA.includes("{items}"));
});

test("textoTicket: sin asteriscos y líneas que no pasan del ancho del papel", () => {
  for (const mm of [58, 80]) {
    const t = textoTicket(pedido, { negocio: "Mi Local", anchoMm: mm });
    assert.equal(t.includes("*"), false);
    const max = caracteresPorLinea(mm);
    for (const l of t.split("\n")) assert.ok(l.length <= max + 2, `línea de ${l.length} en ${mm} mm: "${l}"`);
  }
  assert.equal(caracteresPorLinea(58), 32);
  assert.equal(caracteresPorLinea(80), 42);
});

test("urlWhatsApp: solo dígitos y texto codificado", () => {
  assert.equal(urlWhatsApp("+54 9 221 200-8160", "hola mundo"), "https://wa.me/5492212008160?text=hola%20mundo");
  assert.equal(urlWhatsApp("", "x"), "");
});

test("planDespacho: whatsapp, impresora e impresora con respaldo", () => {
  assert.deepEqual(planDespacho("whatsapp"), { principal: "whatsapp", respaldo: null, avisos: [] });
  assert.equal(planDespacho("whatsapp", { whatsappConfigurado: false }).principal, null);
  assert.deepEqual(planDespacho("impresora"), { principal: "impresora", respaldo: null, avisos: [] });
  const p = planDespacho("impresora_whatsapp");
  assert.equal(p.principal, "impresora");
  assert.equal(p.respaldo, "whatsapp");
  const sin = planDespacho("impresora_whatsapp", { whatsappConfigurado: false });
  assert.equal(sin.respaldo, null);
  assert.equal(sin.avisos.length, 1);
  assert.equal(planDespacho("rara").principal, "whatsapp"); // modo desconocido → seguro
});
