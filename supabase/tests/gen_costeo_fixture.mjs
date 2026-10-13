// Genera el SQL que carga los casos de test/fixtures/costeo.json en la empresa A
// y deja una tabla temporal con los valores esperados. Lo usa 15_costeo.sql.
import { readFileSync } from "node:fs";

const fx = JSON.parse(readFileSync(new URL("../../test/fixtures/costeo.json", import.meta.url), "utf8"));
const EMPRESA = "11111111-1111-1111-1111-111111111111";
const uuid = (pref, n) => `${pref}000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const insIds = Object.fromEntries(Object.keys(fx.insumos).map((k, n) => [k, uuid("e1", n + 1)]));
const recIds = Object.fromEntries(Object.keys(fx.recetas).map((k, n) => [k, uuid("e2", n + 1)]));

const out = [];
out.push("-- GENERADO por gen_costeo_fixture.mjs — no editar a mano.");
for (const [k, i] of Object.entries(fx.insumos)) {
  out.push(`insert into insumos (id, empresa_id, nombre, magnitud, unidad_base, costo_neto_por_unidad_base_centavos, alicuota_iva, factor_correccion, activo) values ('${insIds[k]}', '${EMPRESA}', '${k}', 'masa', 'g', ${i.costo}, ${i.iva}, ${i.factor}, ${i.activo});`);
}
for (const [k, r] of Object.entries(fx.recetas)) {
  out.push(`insert into recetas (id, empresa_id, nombre, tipo, rendimiento_cantidad, activo) values ('${recIds[k]}', '${EMPRESA}', '${k}', '${r.tipo}', ${r.rend}, ${r.activo});`);
}
for (const [k, r] of Object.entries(fx.recetas)) {
  r.ings.forEach(([tipo, ref, cant], orden) => {
    const col = tipo === "insumo" ? "insumo_id" : "subreceta_hija_id";
    const refId = tipo === "insumo" ? insIds[ref] : recIds[ref];
    out.push(`insert into ingredientes_receta (empresa_id, receta_padre_id, ${col}, cantidad, orden) values ('${EMPRESA}', '${recIds[k]}', '${refId}', ${cant}, ${orden});`);
  });
}
out.push("create temp table t_costeo_esperado (nombre text, receta_id uuid, esperado numeric);");
for (const [k, v] of Object.entries(fx.esperado)) {
  out.push(`insert into t_costeo_esperado values ('${k}', '${recIds[k]}', ${v === null ? "null" : v});`);
}
out.push("grant select on t_costeo_esperado to authenticated;");
console.log(out.join("\n"));
