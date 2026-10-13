import { test } from "node:test";
import assert from "node:assert/strict";
import { medidasTicket, htmlTicket, columnasPapel } from "../js/saas/ui/impresion.js";
import { caracteresPorLinea } from "../js/core/ventas.js";

const texto = Array.from({ length: 12 }, (_, i) => "línea " + i).join("\n");

test("columnas del papel coinciden con las que usa el armado del ticket", () => {
  for (const mm of [58, 80]) assert.equal(columnasPapel(mm), caracteresPorLinea(mm));
});

test("medidasTicket: la página mide el ancho del rollo y el alto del contenido (no A4)", () => {
  const m80 = medidasTicket(texto, 80), m58 = medidasTicket(texto, 58);
  assert.equal(m80.anchoMm, 80);
  assert.equal(m58.anchoMm, 58);
  assert.ok(m80.altoMm > 30 && m80.altoMm < 120, "alto razonable: " + m80.altoMm);
  const largo = Array.from({ length: 40 }, (_, i) => "línea " + i).join("\n");
  assert.ok(medidasTicket(largo, 80).altoMm > medidasTicket(texto, 80).altoMm, "más líneas → más alto");
  assert.equal(medidasTicket(texto, 99).anchoMm, 80); // ancho desconocido → 80
});

test("la página SIEMPRE es más alta que ancha (si no, el driver la gira 90°)", () => {
  for (const mm of [58, 80]) {
    for (const n of [1, 3, 12, 40]) {
      const m = medidasTicket(Array.from({ length: n }, () => "x").join("\n"), mm);
      assert.ok(m.altoMm > m.anchoMm, `${n} líneas en ${mm} mm: ${m.anchoMm} x ${m.altoMm}`);
    }
  }
});

test("modo 'driver': no declara tamaño de página (usa el papel del driver)", () => {
  const html = htmlTicket("hola", 80, "driver");
  assert.match(html, /@page \{ margin: 0; \}/);
  assert.doesNotMatch(html, /size:/);
  assert.match(html, /width: 80mm/);
});

test("la letra hace entrar exactamente las columnas en el ancho imprimible", () => {
  const m = medidasTicket("x", 80);
  const anchoPx = m.columnas * 0.6 * m.fuentePx;                 // ancho de una línea llena
  assert.ok(Math.abs(anchoPx / (96 / 25.4) - 72) < 0.5, "ocupa ~72 mm");
});

test("htmlTicket: @page con medidas explícitas (sin 'auto'), sin márgenes y con el texto escapado", () => {
  const html = htmlTicket("a <b> & c", 80);
  assert.match(html, /@page \{ size: 80mm \d+mm; margin: 0; \}/);
  assert.doesNotMatch(html, /size:[^;]*auto/);
  assert.match(html, /a &lt;b&gt; &amp; c/);
});

test("espacio en blanco al final: configurable, acotado y presente en el alto y en el HTML", () => {
  assert.equal(medidasTicket(texto, 80, 500).colaMm, 80);   // tope
  assert.equal(medidasTicket(texto, 80, -5).colaMm, 0);
  assert.match(htmlTicket(texto, 80, "driver", 25), /padding: 3mm 4mm 25mm/);
  const largo = Array.from({ length: 40 }, (_, i) => "l" + i).join("\n");
  assert.equal(medidasTicket(largo, 80, 30).altoMm - medidasTicket(largo, 80, 0).altoMm, 30);
});
