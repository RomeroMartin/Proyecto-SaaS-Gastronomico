import { test } from "node:test";
import assert from "node:assert/strict";
import {
  elegirCmvPct, margenContribucion, puntoEquilibrio, repartirEntero, armarFijos, yaPagado, ventasDeCaja, ventasPorFecha,
  diasConPosibleDuplicado, repartirIngreso, estadoSobres, ritmoDelMes, proyeccionFinDeMes, diasEnElMes,
  CMV_MIN_DIAS, CMV_MIN_UNIDADES, DIAS_MIN_HISTORICO,
} from "../js/core/reparto.js";

const PESOS = (n) => n * 100; // pesos → centavos

test("punto de equilibrio: F = $3.000.000, CMV 35 %, sin variables, 30 días", () => {
  const r = puntoEquilibrio({ fijosCentavos: PESOS(3000000), cmvPct: 35, varPct: 0, diasOperativosMes: 30 });
  assert.equal(Math.round(r.pe / 100), 4615385);     // ≈ $4.615.385
  assert.equal(Math.round(r.ped / 100), 153846);     // ≈ $153.846
});

test("punto de equilibrio con costos variables 6 %", () => {
  const r = puntoEquilibrio({ fijosCentavos: PESOS(3000000), cmvPct: 35, varPct: 6, diasOperativosMes: 30 });
  assert.equal(Math.round(r.pe / 100), 5084746);     // ≈ $5.084.746
});

test("sin gastos fijos no divide por cero; CMV + variables ≥ 100 % falla con mensaje claro", () => {
  assert.deepEqual(puntoEquilibrio({ fijosCentavos: 0, cmvPct: 35, varPct: 0 }).pe, 0);
  assert.throws(() => margenContribucion(100, 0), /100 %/);
  assert.throws(() => margenContribucion(70, 30), /margen/);
  assert.throws(() => puntoEquilibrio({ fijosCentavos: 1000, cmvPct: 95, varPct: 10 }), /100 %/);
  assert.ok(Math.abs(margenContribucion(35, 6) - 0.59) < 1e-12);
});

test("elegirCmvPct: usa el teórico solo con ≥ 7 días y ≥ 100 unidades", () => {
  assert.deepEqual(elegirCmvPct({ cmvTeoricoPct: 31, diasConVentas: CMV_MIN_DIAS, unidades: CMV_MIN_UNIDADES, objetivoPct: 35 }), { pct: 31, fuente: "teorico" });
  assert.equal(elegirCmvPct({ cmvTeoricoPct: 31, diasConVentas: CMV_MIN_DIAS - 1, unidades: 500, objetivoPct: 35 }).fuente, "objetivo");
  assert.equal(elegirCmvPct({ cmvTeoricoPct: 31, diasConVentas: 20, unidades: CMV_MIN_UNIDADES - 1, objetivoPct: 35 }).pct, 35);
  assert.equal(elegirCmvPct({ cmvTeoricoPct: null, diasConVentas: 20, unidades: 500, objetivoPct: 40 }).pct, 40);
});

test("repartirEntero: mayor resto, la suma es EXACTA", () => {
  assert.deepEqual(repartirEntero(100, [1, 1, 1]), [34, 33, 33]);
  for (const total of [1, 7, 100, 999999, 12345678]) {
    for (const pesos of [[1, 2, 3], [0.3, 0.3, 0.4], [5, 0, 5], [1e-9, 1, 1], [33.3, 33.3, 33.4]]) {
      const r = repartirEntero(total, pesos);
      assert.equal(r.reduce((a, b) => a + b, 0), total, `${total} entre ${pesos}`);
      r.forEach((x) => assert.ok(Number.isInteger(x) && x >= 0));
    }
  }
  assert.deepEqual(repartirEntero(100, [0, 0]), [0, 0]);
  assert.deepEqual(repartirEntero(0, [1, 2]), [0, 0]);
});

const FIJOS = [
  { id: "a", nombre: "Alquiler", monto: PESOS(1200000) },
  { id: "b", nombre: "Sueldos", monto: PESOS(1500000) },
  { id: "c", nombre: "Servicios", monto: PESOS(300000) },
];

test("repartirIngreso: la suma de las partes es exactamente el total del cierre", () => {
  const pe = puntoEquilibrio({ fijosCentavos: PESOS(3000000), cmvPct: 35, varPct: 6 }).pe;
  for (const monto of [PESOS(10000), 1234567, 999, 1, PESOS(257345) + 17]) {
    for (const antes of [0, pe - 100, pe + 1]) {
      const r = repartirIngreso({ monto, acumuladoAntes: antes, fijos: FIJOS, cmvPct: 35, varPct: 6, pe });
      assert.equal(r.partes.reduce((a, p) => a + p.centavos, 0), monto, `monto ${monto} antes ${antes}`);
    }
  }
});

test("repartirIngreso bajo el equilibrio: de cada $10.000, proveedores 35 %, variables 6 %, fijos = mc × F_i/F, sin ganancia", () => {
  const pe = puntoEquilibrio({ fijosCentavos: PESOS(3000000), cmvPct: 35, varPct: 6 }).pe;
  const r = repartirIngreso({ monto: PESOS(10000), acumuladoAntes: 0, fijos: FIJOS, cmvPct: 35, varPct: 6, pe });
  const por = Object.fromEntries(r.partes.map((p) => [p.id, p.centavos]));
  assert.equal(por.__proveedores, PESOS(3500));
  assert.equal(por.__variables, PESOS(600));
  assert.equal(por.a, PESOS(10000 * 0.59 * 0.4));     // 2.360
  assert.equal(por.b, PESOS(10000 * 0.59 * 0.5));     // 2.950
  assert.equal(por.c, PESOS(10000 * 0.59 * 0.1));     //   590
  assert.equal(r.ganancia, 0);
});

test("repartirIngreso con el mes ya cubierto: proveedores y variables siguen igual, el resto es ganancia", () => {
  const pe = puntoEquilibrio({ fijosCentavos: PESOS(3000000), cmvPct: 35, varPct: 6 }).pe;
  const r = repartirIngreso({ monto: PESOS(10000), acumuladoAntes: pe + PESOS(1), fijos: FIJOS, cmvPct: 35, varPct: 6, pe });
  const por = Object.fromEntries(r.partes.map((p) => [p.id, p.centavos]));
  assert.equal(por.__proveedores, PESOS(3500));
  assert.equal(por.__variables, PESOS(600));
  assert.equal(por.a + por.b + por.c, 0);
  assert.equal(r.ganancia, PESOS(5900));
});

test("repartirIngreso: un cierre que cruza el equilibrio se parte entre fijos y ganancia", () => {
  const pe = PESOS(1000);
  const fijos = [{ id: "x", nombre: "X", monto: PESOS(650) }];
  const r = repartirIngreso({ monto: PESOS(400), acumuladoAntes: PESOS(800), fijos, cmvPct: 35, varPct: 0, pe }); // 200 bajo, 200 sobre
  const por = Object.fromEntries(r.partes.map((p) => [p.id, p.centavos]));
  assert.equal(por.x, PESOS(130));          // 0,65 × 200
  assert.equal(r.ganancia, PESOS(130));     // 0,65 × 200
  assert.equal(por.__proveedores, PESOS(140));
});

test("repartirIngreso sin gastos fijos: todo el margen es ganancia", () => {
  const r = repartirIngreso({ monto: PESOS(1000), acumuladoAntes: 0, fijos: [], cmvPct: 35, varPct: 0, pe: 0 });
  assert.equal(r.ganancia, PESOS(650));
});

test("armarFijos: sin RRHH los sueldos son un gasto fijo; con RRHH se ignoran y sale el sobre de RRHH", () => {
  const gastos = [
    { id: "1", nombre: "Alquiler", categoria: "alquiler", monto_mensual_centavos: PESOS(1000), activo: true },
    { id: "2", nombre: "Sueldos varios", categoria: "Sueldos", monto_mensual_centavos: PESOS(500), activo: true },
    { id: "3", nombre: "Cargas", categoria: "cargas_sociales", monto_mensual_centavos: PESOS(100), activo: true },
    { id: "4", nombre: "Luz (baja)", categoria: "servicios", monto_mensual_centavos: PESOS(50), activo: false },
  ];
  const sin = armarFijos({ gastos, usaRRHH: false });
  assert.equal(sin.fijos.length, 3);
  assert.equal(sin.totalCentavos, PESOS(1600));
  assert.equal(sin.ignorados.length, 0);
  const con = armarFijos({ gastos, usaRRHH: true, sueldosRRHH: { total_centavos: PESOS(2080000), empleados_incluidos: 2 } });
  assert.equal(con.fijos[0].id, "__sueldos");
  assert.equal(con.fijos[0].monto, PESOS(2080000));
  assert.equal(con.ignorados.length, 2);
  assert.equal(con.totalCentavos, PESOS(2080000) + PESOS(1000));
  assert.equal(armarFijos({ gastos: [], usaRRHH: true, sueldosRRHH: { total_centavos: 0 } }).fijos.length, 0);
});

const MOV = [
  { tipo: "ingreso", categoria: "Ventas", fecha: "2026-10-01", monto_centavos: 1000, origen: "cierre_turno", activo: true },
  { tipo: "ingreso", categoria: " ventas qr ", fecha: "2026-10-01", monto_centavos: 500, origen: "manual", activo: true },
  { tipo: "ingreso", categoria: "Otros ingresos", fecha: "2026-10-02", monto_centavos: 700, origen: "manual", activo: true },
  { tipo: "ingreso", categoria: "Ventas", fecha: "2026-10-03", monto_centavos: 300, origen: "manual", activo: false },
  { tipo: "egreso", categoria: "Alquiler", fecha: "2026-10-05", monto_centavos: 2000, origen: "manual", activo: true },
  { tipo: "egreso", categoria: "alquiler", fecha: "2026-10-06", monto_centavos: 100, origen: "manual", activo: true },
];

test("ventas de caja: solo ingresos activos de las categorías de venta (sin distinguir mayúsculas ni espacios)", () => {
  const v = ventasDeCaja(MOV, ["Ventas", "Ventas QR"]);
  assert.equal(v.length, 2);
  assert.deepEqual(ventasPorFecha(MOV, ["Ventas", "Ventas QR"]), [{ fecha: "2026-10-01", centavos: 1500 }]);
  assert.equal(yaPagado(MOV, ["Alquiler"]), 2100);
  assert.equal(yaPagado(MOV, []), 0);
  assert.deepEqual(diasConPosibleDuplicado(MOV, ["Ventas", "Ventas QR"]), ["2026-10-01"]);
  assert.deepEqual(diasConPosibleDuplicado(MOV, ["Ventas"]), []);
});

test("estadoSobres: apartado, % cubierto, pagado y ritmo", () => {
  const fijos = [
    { id: "a", nombre: "Alquiler", monto: PESOS(1000), diaVencimiento: 10, categoriasCaja: ["Alquiler"] },
    { id: "b", nombre: "Luz", monto: PESOS(500), diaVencimiento: null, categoriasCaja: [] },
  ];
  const { pe } = puntoEquilibrio({ fijosCentavos: PESOS(1500), cmvPct: 35, varPct: 0 });          // 2.307,69
  const s = estadoSobres({ ventasMes: PESOS(1000), fijos, cmvPct: 35, varPct: 0, pe, hoy: "2026-10-05", movimientos: [] });
  const por = Object.fromEntries(s.map((x) => [x.id, x]));
  assert.equal(por.__proveedores.apartado, PESOS(350));
  assert.equal(por.a.apartado + por.b.apartado, PESOS(650));
  assert.ok(por.a.pctCubierto > 0 && por.a.pctCubierto < 100);
  assert.equal(por.a.estado, "atrasado");        // a este ritmo (1000 en 5 días → 2000 al día 10) no llega a cubrir $1000 apartados... 
  // Mes ya cubierto: todos "cubierto".
  const cub = estadoSobres({ ventasMes: pe + PESOS(100), fijos, cmvPct: 35, varPct: 0, pe, hoy: "2026-10-20", movimientos: [] });
  assert.ok(cub.filter((x) => x.tipo === "fijo").every((x) => x.estado === "cubierto" && x.pctCubierto === 100));
  // Pagado: el egreso de caja mapeado alcanza el objetivo.
  const pag = estadoSobres({ ventasMes: PESOS(100), fijos, cmvPct: 35, varPct: 0, pe, hoy: "2026-10-12",
    movimientos: [{ tipo: "egreso", categoria: "alquiler", monto_centavos: PESOS(1000), activo: true }] });
  assert.equal(pag.find((x) => x.id === "a").estado, "pagado");
  assert.equal(pag.find((x) => x.id === "a").yaPagado, PESOS(1000));
});

test("estadoSobres: en ritmo cuando el apartado proyectado alcanza al vencimiento", () => {
  const fijos = [{ id: "a", nombre: "Alquiler", monto: PESOS(300), diaVencimiento: 20, categoriasCaja: [] }];
  const { pe } = puntoEquilibrio({ fijosCentavos: PESOS(300), cmvPct: 35, varPct: 0 });
  const s = estadoSobres({ ventasMes: PESOS(300), fijos, cmvPct: 35, varPct: 0, pe, hoy: "2026-10-05", movimientos: [] });
  assert.equal(s.find((x) => x.id === "a").estado, "en_ritmo");   // apartado $195 en 5 días → proyectado al día 20: $780 ≥ $300
});

test("ritmoDelMes: por encima / por debajo del equilibrio", () => {
  const { pe, ped } = puntoEquilibrio({ fijosCentavos: PESOS(3000000), cmvPct: 35, varPct: 0, diasOperativosMes: 30 });
  const arriba = ritmoDelMes({ ventasMes: PESOS(2000000), pe, ped, diasTranscurridos: 10, diasOperativosMes: 30 });
  assert.equal(arriba.esperado, ped * 10);
  assert.ok(arriba.diferencia > 0);
  const abajo = ritmoDelMes({ ventasMes: PESOS(1000000), pe, ped, diasTranscurridos: 10, diasOperativosMes: 30 });
  assert.ok(abajo.diferencia < 0);
  assert.equal(ritmoDelMes({ ventasMes: 0, pe: 0, ped: 0, diasTranscurridos: 5 }).pctPE, 100);
});

test("proyeccionFinDeMes: sin histórico es lineal ('simple'); con histórico pondera por día de la semana", () => {
  const simple = proyeccionFinDeMes({ ventasPorDia: [{ fecha: "2026-10-01", centavos: 1000 }], hoy: "2026-10-10", acumuladoMes: 10000 });
  assert.equal(simple.tipo, "simple");
  assert.equal(simple.centavos, Math.round((10000 / 10) * 31));
  // Histórico: solo viernes (5) y sábados (6) venden: 10.000 y 20.000. Octubre 2026: el 1 es jueves.
  const hist = [];
  for (const f of ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09"]) hist.push({ fecha: f, centavos: 10000 }); // viernes
  for (const f of ["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03", "2026-10-10"]) hist.push({ fecha: f, centavos: 20000 }); // sábados
  for (const f of ["2026-09-06", "2026-09-13"]) hist.push({ fecha: f, centavos: 5000 }); // domingos
  assert.ok(hist.length >= DIAS_MIN_HISTORICO - 2);
  hist.push({ fecha: "2026-09-27", centavos: 5000 }, { fecha: "2026-09-20", centavos: 5000 }, { fecha: "2026-10-04", centavos: 5000 }); // más domingos → ≥ 14
  const acumulado = 10000 + 20000 + 10000 + 20000 + 5000 + 10000 + 20000 + 5000; // lo vendido del 1 al 10 (ejemplo)
  const p = proyeccionFinDeMes({ ventasPorDia: hist, hoy: "2026-10-10", acumuladoMes: acumulado });
  assert.equal(p.tipo, "ponderada");
  // Del 11 al 31 de octubre: viernes 16,23,30 · sábados 17,24,31 · domingos 11,18,25.
  assert.equal(p.centavos, acumulado + 3 * 10000 + 3 * 20000 + 3 * 5000);
  // Un lineal habría dado otra cosa (engaña a principio de mes).
  assert.notEqual(p.centavos, Math.round((acumulado / 10) * 31));
});

test("diasEnElMes: bisiesto y fin de año", () => {
  assert.equal(diasEnElMes("2024-02-10"), 29);
  assert.equal(diasEnElMes("2026-02-10"), 28);
  assert.equal(diasEnElMes("2026-12-31"), 31);
});
