import { test } from "node:test";
import assert from "node:assert/strict";
import {
  numero, booleano, unidadCanonica, magnitudDe, condicionFiscal, normalizarClave, reconocerEncabezados, normalizarFilas,
  validarFilas, filasParaImportar, matrizPlantilla, matrizEjemplo, matrizInstrucciones, TIPOS,
} from "../js/core/importacion.js";
import { costoNetoPorUnidadBase, convertirAUnidadBase } from "../js/core/unidades.js";

test("numero: formatos argentinos y de Excel", () => {
  assert.equal(numero(1500), 1500);
  assert.equal(numero("1.500,25"), 1500.25);
  assert.equal(numero("0,125"), 0.125);
  assert.equal(numero("0.125"), 0.125);
  assert.equal(numero("1.000"), 1000);
  assert.equal(numero("1.000.000"), 1000000);
  assert.equal(numero("2.5"), 2.5);
  assert.equal(numero("$ 34.000,00"), 34000);
  assert.equal(numero("21%"), 21);
  assert.equal(numero("10,5"), 10.5);
  assert.equal(numero("abc"), null);
  assert.equal(numero(""), null);
  assert.equal(numero(NaN), null);
});

test("booleano / unidades / condición fiscal: variantes habituales", () => {
  for (const v of ["Sí", "si", "SI", "s", "x", 1, true, "Con IVA"]) assert.equal(booleano(v), true, String(v));
  for (const v of ["No", "no", "n", 0, false, "neto"]) assert.equal(booleano(v), false, String(v));
  assert.equal(booleano("quizás"), null);
  assert.equal(unidadCanonica("Kilos"), "kg");
  assert.equal(unidadCanonica("LT"), "l");
  assert.equal(unidadCanonica("gr"), "g");
  assert.equal(unidadCanonica("Unidad"), "un");
  assert.equal(unidadCanonica("furlong"), null);
  assert.equal(magnitudDe("kg"), "masa");
  assert.equal(magnitudDe("oz"), "volumen");
  assert.equal(magnitudDe("un"), "unidad");
  assert.equal(condicionFiscal("Responsable Inscripto"), "responsable_inscripto");
  assert.equal(condicionFiscal("RI"), "responsable_inscripto");
  assert.equal(condicionFiscal("Monotributista"), "monotributo");
  assert.equal(condicionFiscal("Exento"), "exento");
  assert.equal(condicionFiscal("otra"), null);
});

test("encabezados: acepta tildes, mayúsculas, alias y reporta faltantes y desconocidos", () => {
  const r = reconocerEncabezados("insumos", ["NOMBRE", "Presentación", "Cantidad", "unidad", "Precio", "Incluye IVA", "Color"]);
  assert.deepEqual(r.faltantes, []);
  assert.deepEqual(r.desconocidas, ["Color"]);
  assert.equal(r.mapa["Incluye IVA"], "precio_con_iva");
  assert.deepEqual(reconocerEncabezados("insumos", ["Nombre", "Precio"]).faltantes, ["Cantidad", "Unidad"]);
  assert.equal(normalizarClave("  Día de Vencimiento "), "diadevencimiento");
});

test("normalizarFilas: numera las filas como en Excel e ignora las vacías", () => {
  const r = normalizarFilas("gastos", [
    { Nombre: "Alquiler", Categoría: "alquiler", "Monto mensual": 1000 },
    { Nombre: "", Categoría: "", "Monto mensual": "" },
    { Nombre: "Luz", Categoría: "servicios", "Monto mensual": 80 },
  ]);
  assert.deepEqual(r.filas.map((f) => f.n), [2, 4]);
  assert.equal(r.filas[1].nombre, "Luz");
});

// ---- insumos ----
const fila = (o) => ({ n: 2, ...o });
test("insumo: el costo coincide con el del formulario de Insumos (barra 5 kg a $34.000 neto → 680 ¢/g)", () => {
  const v = validarFilas("insumos", [fila({ nombre: "Queso barra", cantidad: 5, unidad: "kg", precio: 34000 })], { proveedores: new Map() });
  const d = v.filas[0].datos;
  assert.equal(v.filas[0].estado, "nueva");
  assert.equal(d.costo_neto_por_unidad_base_centavos, costoNetoPorUnidadBase(3400000, convertirAUnidadBase(5, "kg")));
  assert.equal(d.costo_neto_por_unidad_base_centavos, 680);
  assert.equal(d.magnitud, "masa"); assert.equal(d.unidad_base, "g"); assert.equal(d.unidad_uso, "kg");
  assert.equal(d.presentacion_cantidad_base, 5000); assert.equal(d.presentacion_precio_neto_centavos, 3400000);
  assert.equal(d.alicuota_iva, 21); assert.equal(d.factor_correccion, 1);
});

test("insumo: precio con IVA se pasa a neto; botella en ml con oz de uso", () => {
  const con = validarFilas("insumos", [fila({ nombre: "A", cantidad: 1000, unidad: "ml", precio: 12100, precio_con_iva: "Sí", iva: 21 })]).filas[0].datos;
  assert.equal(con.presentacion_precio_neto_centavos, 1000000);     // 12.100 / 1,21 = 10.000
  assert.equal(con.costo_neto_por_unidad_base_centavos, 1000);       // 10.000 $ / 1000 ml = 10 $/ml = 1000 ¢/ml
  const oz = validarFilas("insumos", [fila({ nombre: "B", cantidad: 25, unidad: "oz", precio: 100 })]).filas[0].datos;
  assert.equal(oz.magnitud, "volumen"); assert.equal(oz.unidad_base, "ml");
  assert.ok(Math.abs(oz.presentacion_cantidad_base - 25 * 29.5735) < 1e-9);
});

test("insumo: errores claros por fila (unidad, cantidad, precio, IVA, proveedor)", () => {
  const ctx = { proveedores: new Map([["molinos", "p-1"]]) };
  const v = validarFilas("insumos", [
    fila({ nombre: "", cantidad: 1, unidad: "kg", precio: 1 }),
    fila({ nombre: "U", cantidad: 1, unidad: "furlong", precio: 1 }),
    fila({ nombre: "C", cantidad: 0, unidad: "kg", precio: 1 }),
    fila({ nombre: "P", cantidad: 1, unidad: "kg", precio: "gratis" }),
    fila({ nombre: "I", cantidad: 1, unidad: "kg", precio: 1, iva: 19 }),
    fila({ nombre: "V", cantidad: 1, unidad: "kg", precio: 1, proveedor: "No existe" }),
    fila({ nombre: "OK", cantidad: 1, unidad: "kg", precio: 1, proveedor: "Molinos" }),
    fila({ nombre: "F", cantidad: 1, unidad: "kg", precio: 1, precio_con_iva: "tal vez" }),
  ], ctx);
  assert.deepEqual(v.filas.map((f) => f.estado), ["error", "error", "error", "error", "error", "error", "nueva", "error"]);
  assert.match(v.filas[0].errores[0], /nombre/);
  assert.match(v.filas[1].errores[0], /Unidad no reconocida/);
  assert.match(v.filas[5].errores[0], /proveedor/);
  assert.equal(v.filas[6].datos.proveedor_habitual_id, "p-1");
  assert.equal(v.resumen.conError, 7); assert.equal(v.resumen.nuevas, 1);
});

test("existentes y repetidas: se detectan sin distinguir mayúsculas; 'actualizar' decide qué se manda", () => {
  const ctx = { existentes: new Set(["harina 0000"]) };
  const v = validarFilas("insumos", [
    fila({ n: 2, nombre: "Harina 0000", cantidad: 1, unidad: "kg", precio: 100 }),
    fila({ n: 3, nombre: "Sal", cantidad: 1, unidad: "kg", precio: 10 }),
    fila({ n: 4, nombre: "  SAL ", cantidad: 1, unidad: "kg", precio: 11 }),
  ], ctx);
  assert.deepEqual(v.filas.map((f) => f.estado), ["existente", "nueva", "error"]);
  assert.match(v.filas[2].errores[0], /fila 3/);
  assert.equal(filasParaImportar(v, false).length, 1);
  assert.equal(filasParaImportar(v, true).length, 2);
});

// ---- proveedores ----
test("proveedores: condición fiscal, rubros en lista, email y CUIT", () => {
  const v = validarFilas("proveedores", [
    fila({ nombre: "Lácteos", condicion_fiscal: "Monotributo", rubros: "Lácteos, Almacén ; Fiambres", email: "a@b.com", cuit: "30-12345678-9" }),
    fila({ nombre: "Malo", condicion_fiscal: "Otra" }),
    fila({ nombre: "Mail", email: "no-es-mail" }),
    fila({ nombre: "Raro", cuit: "12" }),
  ]);
  assert.equal(v.filas[0].estado, "nueva");
  assert.deepEqual(v.filas[0].datos.rubros, ["Lácteos", "Almacén", "Fiambres"]);
  assert.equal(v.filas[0].datos.condicion_fiscal, "monotributo");
  assert.equal(v.filas[1].estado, "error");
  assert.equal(v.filas[2].estado, "error");
  assert.equal(v.filas[3].estado, "nueva"); assert.equal(v.filas[3].avisos.length, 1);
  assert.equal(v.filas[3].datos.condicion_fiscal, "");   // vacío: la base usa responsable inscripto
});

// ---- gastos fijos ----
test("gastos fijos: monto, día y categorías reservadas con RRHH", () => {
  const ctx = { conRRHH: true, categoriasReservadas: ["sueldos", "cargas_sociales"] };
  const v = validarFilas("gastos", [
    fila({ nombre: "Alquiler", categoria: "alquiler", monto: "1.500.000,50", dia: 10, caja: "Alquiler, Expensas" }),
    fila({ nombre: "Sueldos", categoria: "Sueldos", monto: 1000 }),
    fila({ nombre: "Cero", categoria: "x", monto: 0 }),
    fila({ nombre: "Día", categoria: "x", monto: 10, dia: 40 }),
    fila({ nombre: "Sin cat", monto: 10 }),
    fila({ nombre: "Luz", categoria: "servicios", monto: 80000.5 }),
  ], ctx);
  assert.deepEqual(v.filas.map((f) => f.estado), ["nueva", "error", "error", "error", "error", "nueva"]);
  assert.equal(v.filas[0].datos.monto_mensual_centavos, 150000050);
  assert.deepEqual(v.filas[0].datos.categorias_caja, ["Alquiler", "Expensas"]);
  assert.equal(v.filas[0].datos.dia_vencimiento, 10);
  assert.equal(v.filas[5].datos.monto_mensual_centavos, 8000050);
  assert.match(v.filas[1].errores[0], /RRHH/);
  // sin RRHH, "sueldos" es una categoría común
  assert.equal(validarFilas("gastos", [fila({ nombre: "S", categoria: "sueldos", monto: 5 })], { conRRHH: false }).filas[0].estado, "nueva");
});

test("plantillas: encabezados en la hoja de datos, ejemplos que validan y filas de instrucciones", () => {
  for (const tipo of Object.keys(TIPOS)) {
    const [enc] = matrizPlantilla(tipo);
    assert.deepEqual(enc, TIPOS[tipo].columnas.map((c) => c.titulo));
    // los ejemplos de la plantilla tienen que ser importables (con el proveedor de ejemplo cargado)
    const [h, ...filas] = matrizEjemplo(tipo);
    const crudas = filas.map((f) => Object.fromEntries(h.map((t, i) => [t, f[i]])));
    const { filas: norm, faltantes } = normalizarFilas(tipo, crudas);
    assert.deepEqual(faltantes, [], tipo);
    const v = validarFilas(tipo, norm, { proveedores: new Map([["molinos del sur", "p"]]) });
    assert.equal(v.resumen.conError, 0, `${tipo}: ${JSON.stringify(v.filas.filter((x) => x.errores.length))}`);
    assert.ok(matrizInstrucciones(tipo).length > TIPOS[tipo].columnas.length);
  }
});

test("IVA en celda con formato porcentaje (0,21 / 0,105) se entiende como 21 / 10,5", () => {
  const d = (iva) => validarFilas("insumos", [fila({ nombre: "I" + iva, cantidad: 1, unidad: "kg", precio: 10, iva })]).filas[0];
  assert.equal(d(0.21).datos.alicuota_iva, 21);
  assert.equal(d(0.105).datos.alicuota_iva, 10.5);
  assert.equal(d("21%").datos.alicuota_iva, 21);
  assert.equal(d(0).datos.alicuota_iva, 0);
});

test("insumo: unidad de uso distinta de la de compra (misma magnitud): se calcula la cantidad de uso", () => {
  // botella de 750 ml a $8.253,41 neto, usada en oz → igual que el formulario (cantidad de uso = 750 ml en oz)
  const d = validarFilas("insumos", [fila({ nombre: "Aperol", cantidad: 750, unidad: "ml", precio: 8253.41, unidad_uso: "oz" })]).filas[0];
  assert.equal(d.estado, "nueva");
  const x = d.datos;
  assert.equal(x.unidad_uso, "oz"); assert.equal(x.presentacion_unidad, "ml"); assert.equal(x.presentacion_cantidad, 750);
  assert.equal(x.magnitud, "volumen"); assert.equal(x.unidad_base, "ml"); assert.equal(x.presentacion_cantidad_base, 750);
  assert.equal(x.costo_neto_por_unidad_base_centavos, costoNetoPorUnidadBase(825341, 750));
  // la misma botella cargando la cantidad de uso a mano: 25,36 oz
  const y = validarFilas("insumos", [fila({ nombre: "Aperol 2", cantidad: 750, unidad: "ml", precio: 8253.41, unidad_uso: "oz", cantidad_uso: 25 })]).filas[0].datos;
  assert.ok(Math.abs(y.presentacion_cantidad_base - 25 * 29.5735) < 1e-9);
  assert.equal(y.unidad_uso, "oz");
  // sin unidad de uso: es la de compra
  assert.equal(validarFilas("insumos", [fila({ nombre: "B", cantidad: 5, unidad: "kg", precio: 100 })]).filas[0].datos.unidad_uso, "kg");
  // kg de compra, g de uso
  const k = validarFilas("insumos", [fila({ nombre: "C", cantidad: 5, unidad: "kg", precio: 34000, unidad_uso: "g" })]).filas[0].datos;
  assert.equal(k.unidad_uso, "g"); assert.equal(k.presentacion_cantidad_base, 5000); assert.equal(k.costo_neto_por_unidad_base_centavos, 680);
});

test("insumo: unidad de uso de otra magnitud exige la cantidad de uso; errores de unidad de uso", () => {
  const sin = validarFilas("insumos", [fila({ nombre: "Frutilla", cantidad: 1, unidad: "kg", precio: 8500, unidad_uso: "porción" })]).filas[0];
  assert.equal(sin.estado, "error"); assert.match(sin.errores[0], /Cantidad de uso que trae/);
  const con = validarFilas("insumos", [fila({ nombre: "Frutilla", cantidad: 1, unidad: "kg", precio: 8500, unidad_uso: "porción", cantidad_uso: 6.67 })]).filas[0].datos;
  assert.equal(con.magnitud, "unidad"); assert.equal(con.unidad_base, "un"); assert.equal(con.presentacion_magnitud, "masa");
  assert.equal(con.presentacion_unidad, "kg"); assert.equal(con.unidad_uso, "un"); assert.equal(con.presentacion_cantidad_base, 6.67);
  assert.equal(con.costo_neto_por_unidad_base_centavos, costoNetoPorUnidadBase(850000, 6.67));
  assert.match(validarFilas("insumos", [fila({ nombre: "X", cantidad: 1, unidad: "kg", precio: 1, unidad_uso: "furlong" })]).filas[0].errores[0], /Unidad de uso no reconocida/);
  assert.match(validarFilas("insumos", [fila({ nombre: "X", cantidad: 1, unidad: "kg", precio: 1, unidad_uso: "g", cantidad_uso: -3 })]).filas[0].errores[0], /cantidad de uso/);
});
