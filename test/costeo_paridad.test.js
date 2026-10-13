// Paridad de costeo JS ↔ SQL: este test y supabase/tests/15_costeo.sql usan los
// MISMOS casos (test/fixtures/costeo.json) y deben dar el mismo resultado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { costoReceta } from "../js/core/costeo.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures/costeo.json", import.meta.url), "utf8"));

// Como la app: solo los insumos y recetas ACTIVOS están disponibles.
const insumos = Object.fromEntries(Object.entries(fx.insumos).map(([id, i]) => [id, {
  id, costo_neto_por_unidad_base_centavos: i.costo, alicuota_iva: i.iva, factor_correccion: i.factor, activo: i.activo,
}]));
const recetas = Object.fromEntries(Object.entries(fx.recetas).map(([id, r]) => [id, {
  id, nombre: id, tipo: r.tipo, rendimiento_cantidad: r.rend, activo: r.activo,
  ingredientes: r.ings.map(([tipo, ref_id, cantidad]) => ({ tipo, ref_id, cantidad })),
}]));
const ctx = {
  getInsumo: (id) => (insumos[id] && insumos[id].activo ? insumos[id] : null),
  getReceta: (id) => (recetas[id] && recetas[id].activo ? recetas[id] : null),
};

for (const [nombre, esperado] of Object.entries(fx.esperado)) {
  test(`costeo (paridad con SQL): ${nombre}`, () => {
    if (esperado === null) {
      assert.throws(() => costoReceta(recetas[nombre], ctx));
    } else {
      assert.ok(Math.abs(costoReceta(recetas[nombre], ctx) - esperado) < 1e-6,
        `esperado ${esperado}, obtuvo ${costoReceta(recetas[nombre], ctx)}`);
    }
  });
}
