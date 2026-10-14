import { test } from "node:test";
import assert from "node:assert/strict";
import { cmvTeoricoPct, mixDeVentas, brechaComprasVsCmv, ventasPorDiaSemana, ventasPorFranja, totalesPeriodo, DIAS_MIN_BRECHA } from "../js/core/costeo.js";
import { rangoPreset } from "../js/core/utilsFecha.js";

test("cmvTeoricoPct: porcentaje y sin ingreso", () => {
  assert.equal(cmvTeoricoPct(10000, 3000), 30);
  assert.equal(cmvTeoricoPct(0, 100), null);
  assert.equal(cmvTeoricoPct(-5, 100), null);
});

test("mixDeVentas: junta días por receta, participación y orden por ingreso", () => {
  const filas = [
    { receta_id: "a", nombre: "Burger", unidades: 3, ingreso_centavos: 30000, costo_centavos: 9000 },
    { receta_id: "a", nombre: "Burger", unidades: 1, ingreso_centavos: 12000, costo_centavos: 3000 }, // otro día, precio distinto
    { receta_id: "b", nombre: "Gaseosa", unidades: 4, ingreso_centavos: 10000, costo_centavos: 2000 },
  ];
  const m = mixDeVentas(filas);
  assert.equal(m[0].nombre, "Burger");
  assert.equal(m[0].unidades, 4);
  assert.equal(m[0].ingreso, 42000);
  assert.equal(m[0].costo, 12000);
  assert.equal(m[0].margen, 30000);
  assert.ok(Math.abs(m[0].cmvPct - (12000 / 42000) * 100) < 1e-9);
  assert.ok(Math.abs(m[0].pctIngreso - (42000 / 52000) * 100) < 1e-9);
  assert.ok(Math.abs(m[0].pctUnidades - 50) < 1e-9);
  assert.equal(mixDeVentas([]).length, 0);
});

test("brechaComprasVsCmv: monto, % y aviso de período corto", () => {
  const largo = brechaComprasVsCmv(1200000, 1000000, "2026-02-01", "2026-02-28"); // 28 días
  assert.equal(largo.brechaCentavos, 200000);
  assert.equal(largo.brechaPct, 20);
  assert.equal(largo.dias, 28);
  assert.equal(largo.periodoCorto, false);
  const corto = brechaComprasVsCmv(500000, 400000, "2026-03-01", "2026-03-07");
  assert.equal(corto.dias, 7);
  assert.equal(corto.periodoCorto, true);
  assert.equal(DIAS_MIN_BRECHA, 28);
  assert.equal(brechaComprasVsCmv(100, 0, "2026-03-01", "2026-03-31").brechaPct, null);
  assert.equal(brechaComprasVsCmv(900, 1000, "2026-03-01", "2026-03-31").brechaCentavos, -100);
});

test("ventasPorDiaSemana: lunes = 1 … domingo = 7, con promedio por día", () => {
  const filas = [
    { fecha_operativa: "2026-03-09", pedidos: 2, ingreso_centavos: 1000 }, // lunes
    { fecha_operativa: "2026-03-16", pedidos: 4, ingreso_centavos: 3000 }, // lunes
    { fecha_operativa: "2026-03-15", pedidos: 1, ingreso_centavos: 500 },  // domingo
  ];
  const r = ventasPorDiaSemana(filas);
  assert.equal(r.length, 7);
  assert.equal(r[0].nombre, "Lunes");
  assert.deepEqual([r[0].dias, r[0].pedidos, r[0].ingreso, r[0].promedioPorDia], [2, 6, 4000, 2000]);
  assert.equal(r[6].nombre, "Domingo");
  assert.equal(r[6].ingreso, 500);
  assert.equal(r[2].promedioPorDia, 0);
});

test("ventasPorFranja: suma por hora y ordena", () => {
  const r = ventasPorFranja([
    { hora: 22, pedidos: 1, ingreso_centavos: 100 }, { hora: 20, pedidos: 2, ingreso_centavos: 300 }, { hora: 22, pedidos: 3, ingreso_centavos: 50 },
  ]);
  assert.deepEqual(r, [{ hora: 20, pedidos: 2, ingreso: 300 }, { hora: 22, pedidos: 4, ingreso: 150 }]);
});

test("totalesPeriodo: CMV sobre productos netos (sin envío), ticket promedio y % de anulados", () => {
  const t = totalesPeriodo([
    { pedidos: 3, ingreso_centavos: 36800, productos_netos_centavos: 36000, descuento_centavos: 500, envio_centavos: 800, costo_centavos: 12000, anulados: 1, monto_anulado_centavos: 10000 },
    { pedidos: 1, ingreso_centavos: 12000, productos_netos_centavos: 12000, descuento_centavos: 0, envio_centavos: 0, costo_centavos: 3000, anulados: 0, monto_anulado_centavos: 0 },
  ]);
  assert.equal(t.pedidos, 4);
  assert.equal(t.ingreso, 48800);
  assert.equal(t.productosNetos, 48000);
  assert.equal(t.costo, 15000);
  assert.equal(t.margenBruto, 33000);
  assert.ok(Math.abs(t.cmvPct - 31.25) < 1e-9);
  assert.equal(t.ticketPromedio, 12200);
  assert.ok(Math.abs(t.pctAnulados - 20) < 1e-9);
  assert.equal(totalesPeriodo([]).cmvPct, null);
});

test("rangoPreset: 7/30 días, mes actual y mes anterior (incluye bisiesto y cambio de año)", () => {
  assert.deepEqual(rangoPreset("7d", "2026-10-14"), { desde: "2026-10-08", hasta: "2026-10-14" });
  assert.deepEqual(rangoPreset("30d", "2026-10-14"), { desde: "2026-09-15", hasta: "2026-10-14" });
  assert.deepEqual(rangoPreset("mes", "2026-10-14"), { desde: "2026-10-01", hasta: "2026-10-14" });
  assert.deepEqual(rangoPreset("mes_anterior", "2026-10-14"), { desde: "2026-09-01", hasta: "2026-09-30" });
  assert.deepEqual(rangoPreset("mes_anterior", "2026-01-05"), { desde: "2025-12-01", hasta: "2025-12-31" });
  assert.deepEqual(rangoPreset("mes_anterior", "2024-03-10"), { desde: "2024-02-01", hasta: "2024-02-29" });
  assert.equal(rangoPreset("xx", "2026-10-14"), null);
});
