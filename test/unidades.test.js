// Tests de core/unidades.js — Regla de Oro 3.1 (unidad base)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  convertirAUnidadBase,
  costoNetoPorUnidadBase,
  unidadBaseDe,
  convertirDesdeUnidadBase,
  factorAUnidadBase,
} from "../js/core/unidades.js";

test("unidadBaseDe devuelve la base canónica", () => {
  assert.equal(unidadBaseDe("masa"), "g");
  assert.equal(unidadBaseDe("volumen"), "ml");
  assert.equal(unidadBaseDe("unidad"), "un");
});

test("convertirAUnidadBase: masa", () => {
  assert.equal(convertirAUnidadBase(5, "kg"), 5000);
  assert.equal(convertirAUnidadBase(400, "g"), 400);
  assert.equal(convertirAUnidadBase(500, "mg"), 0.5);
});

test("convertirAUnidadBase: volumen", () => {
  assert.equal(convertirAUnidadBase(5, "l"), 5000);
  assert.equal(convertirAUnidadBase(750, "ml"), 750);
});

test("convertirAUnidadBase: unidad", () => {
  assert.equal(convertirAUnidadBase(1, "docena"), 12);
  assert.equal(convertirAUnidadBase(2, "ciento"), 200);
});

test("convertirAUnidadBase: unidad desconocida lanza", () => {
  assert.throws(() => convertirAUnidadBase(1, "galon"));
});

test("costoNetoPorUnidadBase: barra 5kg a $34.000 → 680 c/g", () => {
  // 3.400.000 centavos / 5000 g = 680 centavos por gramo
  assert.equal(costoNetoPorUnidadBase(3400000, 5000), 680);
});

test("costoNetoPorUnidadBase: conserva 4 decimales (no redondea a centavos enteros)", () => {
  // 100000 / 3 = 33333,3333…
  assert.equal(costoNetoPorUnidadBase(100000, 3), 33333.3333);
});

test("costoNetoPorUnidadBase: insumos baratos por gramo no pierden precisión", () => {
  // $125/kg = 12.500 centavos / 1000 g = 12,5 ¢/g (antes se redondeaba a 13)
  assert.equal(costoNetoPorUnidadBase(12500, 1000), 12.5);
  // $0,40/g de sal: 400 centavos / 1000 g = 0,4 ¢/g
  assert.equal(costoNetoPorUnidadBase(400, 1000), 0.4);
});

test("costoNetoPorUnidadBase: cantidad base 0 lanza (evita división por cero)", () => {
  assert.throws(() => costoNetoPorUnidadBase(1000, 0));
});

test("oz (onza líquida) convierte a ml y vuelve", () => {
  assert.equal(factorAUnidadBase("oz"), 29.5735);
  assert.ok(Math.abs(convertirAUnidadBase(1.5, "oz") - 44.36025) < 1e-9);
  assert.ok(Math.abs(convertirDesdeUnidadBase(59.147, "oz") - 2) < 1e-9);
  assert.equal(convertirDesdeUnidadBase(1000, "l"), 1);
});
