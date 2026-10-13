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
  assert.ok(medidasTicket(texto + "\nmás\nlíneas", 80).altoMm > m80.altoMm, "más líneas → más alto");
  assert.equal(medidasTicket(texto, 99).anchoMm, 80); // ancho desconocido → 80
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
