// Tests de core/fiscal.js — Regla de Oro 3.2 (IVA / crédito fiscal / neto↔total)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recuperaCreditoFiscal,
  calcularIVA,
  netoATotal,
  totalANeto,
  desglosarFactura,
  validarCuadraturaFactura,
} from "../js/core/fiscal.js";

test("recuperaCreditoFiscal: solo Factura A de Responsable Inscripto", () => {
  assert.equal(recuperaCreditoFiscal("A", "responsable_inscripto"), true);
  assert.equal(recuperaCreditoFiscal("B", "responsable_inscripto"), false);
  assert.equal(recuperaCreditoFiscal("C", "monotributo"), false);
  assert.equal(recuperaCreditoFiscal("A", "monotributo"), false);
});

test("calcularIVA", () => {
  assert.equal(calcularIVA(100000, 21), 21000);
  assert.equal(calcularIVA(100000, 10.5), 10500);
  assert.equal(calcularIVA(100000, 0), 0);
});

test("netoATotal y totalANeto son inversos (21%)", () => {
  assert.equal(netoATotal(100000, 21), 121000);
  assert.equal(totalANeto(121000, 21), 100000);
});

test("desglosarFactura desde neto", () => {
  const r = desglosarFactura({ desde: "neto", montoCentavos: 100000, alicuota: 21 });
  assert.deepEqual(r, { neto: 100000, iva: 21000, percepciones: 0, otrosImpuestos: 0, total: 121000 });
});

test("desglosarFactura desde total con percepciones cierra exacto", () => {
  const r = desglosarFactura({
    desde: "total",
    montoCentavos: 125000,
    alicuota: 21,
    percepcionesCentavos: 4000,
  });
  // La cuadratura debe cerrar SIEMPRE (el IVA absorbe el redondeo)
  assert.equal(r.neto + r.iva + r.percepciones + r.otrosImpuestos, r.total);
  assert.equal(r.total, 125000);
  assert.equal(r.percepciones, 4000);
});

test("desglosarFactura desde neto con percepciones", () => {
  const r = desglosarFactura({
    desde: "neto",
    montoCentavos: 20661157,
    alicuota: 21,
    percepcionesCentavos: 0,
  });
  assert.equal(r.neto + r.iva + r.percepciones + r.otrosImpuestos, r.total);
});

test("desglosarFactura con impuesto interno (otrosImpuestos), desde neto", () => {
  const r = desglosarFactura({
    desde: "neto",
    montoCentavos: 100000,
    alicuota: 21,
    percepcionesCentavos: 3000,
    otrosImpuestosCentavos: 15000,
  });
  // 100000 neto + 21000 IVA + 3000 percep + 15000 imp. interno
  assert.equal(r.iva, 21000);
  assert.equal(r.otrosImpuestos, 15000);
  assert.equal(r.total, 139000);
});

test("desglosarFactura con impuesto interno, desde total cierra exacto", () => {
  const r = desglosarFactura({
    desde: "total",
    montoCentavos: 139000,
    alicuota: 21,
    percepcionesCentavos: 3000,
    otrosImpuestosCentavos: 15000,
  });
  assert.equal(r.neto + r.iva + r.percepciones + r.otrosImpuestos, r.total);
  assert.equal(r.neto, 100000);
});

test("validarCuadraturaFactura detecta descuadre", () => {
  const ok = validarCuadraturaFactura({
    netoCentavos: 20661157,
    ivaCentavos: 4338843,
    percepcionesCentavos: 0,
    totalCentavos: 25000000,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.diferenciaCentavos, 0);

  const mal = validarCuadraturaFactura({
    netoCentavos: 100000,
    ivaCentavos: 21000,
    percepcionesCentavos: 0,
    totalCentavos: 130000,
  });
  assert.equal(mal.ok, false);
  assert.equal(mal.diferenciaCentavos, 9000);

  const okOtros = validarCuadraturaFactura({
    netoCentavos: 100000,
    ivaCentavos: 21000,
    percepcionesCentavos: 3000,
    otrosImpuestosCentavos: 15000,
    totalCentavos: 139000,
  });
  assert.equal(okOtros.ok, true);
});
