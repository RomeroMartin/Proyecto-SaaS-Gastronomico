// ============================================================
// core/reparto.js — Tablero de reparto ("apartados") — lógica pura (Fase 4)
// ------------------------------------------------------------
// Sin DOM ni Supabase. TODO en centavos. Recibe los "sobres" ya armados (no sabe
// si vienen de gastos fijos o de RRHH: eso lo decide la UI con armarFijos()).
// Es INFORMATIVO: nada de esto mueve plata ni genera movimientos de caja.
//
// Reparto: método proporcional. De cada $1 que entra:
//   proveedores = cmvPct · costos variables = varPct · cada gasto fijo i = mc × F_i / F
//   (mientras el mes no cubrió el punto de equilibrio) · cubierto el PE, el resto (mc) es ganancia.
// Redondeo por mayor resto: la suma de las partes da EXACTAMENTE el total.
// ============================================================

/** Datos mínimos para confiar en el CMV propio del mes (si no, se usa el objetivo). */
export const CMV_MIN_DIAS = 7;
export const CMV_MIN_UNIDADES = 100;
/** Días con ventas necesarios para proyectar por día de la semana (si no, estimación simple). */
export const DIAS_MIN_HISTORICO = 14;

/** Categorías de gasto que, con RRHH activo, se calculan desde RRHH. */
export const CATEGORIAS_RESERVADAS = ["sueldos", "cargas_sociales"];

const norm = (s) => String(s || "").trim().toLowerCase();

// ---------- Parámetros ----------

/**
 * % de CMV a usar: el teórico del mes (Fase 3) si hay datos suficientes
 * (≥ 7 días con ventas y ≥ 100 unidades); si no, el objetivo de la empresa.
 * @returns {{pct:number, fuente:"teorico"|"objetivo"}}
 */
export function elegirCmvPct({ cmvTeoricoPct = null, diasConVentas = 0, unidades = 0, objetivoPct = 35 } = {}) {
  const hayDatos = cmvTeoricoPct != null && diasConVentas >= CMV_MIN_DIAS && unidades >= CMV_MIN_UNIDADES;
  return hayDatos ? { pct: cmvTeoricoPct, fuente: "teorico" } : { pct: Number(objetivoPct) || 0, fuente: "objetivo" };
}

/** Margen de contribución (fracción): 1 − cmv − variables. Error claro si es ≤ 0. */
export function margenContribucion(cmvPct, varPct = 0) {
  const mc = 1 - (Number(cmvPct) || 0) / 100 - (Number(varPct) || 0) / 100;
  if (mc <= 1e-9) throw new Error("El CMV más los costos variables suman 100 % o más: no queda margen para cubrir los gastos fijos.");
  return mc;
}

/**
 * Punto de equilibrio mensual y diario.
 * @returns {{mc:number, pe:number, ped:number}}  pe/ped en centavos; sin gastos fijos, 0 (no divide por cero)
 */
export function puntoEquilibrio({ fijosCentavos, cmvPct, varPct = 0, diasOperativosMes = 30 }) {
  const mc = margenContribucion(cmvPct, varPct);
  const F = Number(fijosCentavos) || 0;
  const pe = F > 0 ? Math.round(F / mc) : 0;
  const dias = Math.max(1, Number(diasOperativosMes) || 30);
  return { mc, pe, ped: Math.round(pe / dias) };
}

// ---------- Redondeo ----------

/**
 * Reparte un total entero en partes proporcionales a `pesos` por el método del mayor resto:
 * la suma da EXACTAMENTE `total`.
 * @param {number} total  entero (centavos)
 * @param {number[]} pesos  no negativos
 */
export function repartirEntero(total, pesos) {
  total = Math.round(Number(total) || 0);
  const suma = pesos.reduce((a, p) => a + Math.max(0, p), 0);
  if (!pesos.length) return [];
  if (suma <= 0 || total === 0) return pesos.map(() => 0);
  const exactas = pesos.map((p) => (Math.max(0, p) / suma) * total);
  const base = exactas.map(Math.floor);
  let resto = total - base.reduce((a, b) => a + b, 0);
  const orden = exactas.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; resto > 0 && k < orden.length; k++, resto--) base[orden[k].i] += 1;
  return base;
}

// ---------- Armado de sobres ----------

/**
 * Gastos fijos efectivos. Con RRHH activo, las categorías `sueldos`/`cargas_sociales` de los gastos
 * fijos se IGNORAN (se avisa para darlos de baja) y el sobre Sueldos sale de RRHH.
 * @param {{gastos:Array, usaRRHH:boolean, sueldosRRHH?:object|null}} p
 * @returns {{fijos:Array<{id,nombre,categoria,monto,diaVencimiento,categoriasCaja,origen}>, ignorados:Array, totalCentavos:number}}
 */
export function armarFijos({ gastos = [], usaRRHH = false, sueldosRRHH = null }) {
  const activos = gastos.filter((g) => g.activo !== false);
  const esReservada = (g) => CATEGORIAS_RESERVADAS.includes(norm(g.categoria));
  const ignorados = usaRRHH ? activos.filter(esReservada) : [];
  const fijos = activos.filter((g) => !(usaRRHH && esReservada(g))).map((g) => ({
    id: g.id, nombre: g.nombre, categoria: g.categoria, monto: Number(g.monto_mensual_centavos) || 0,
    diaVencimiento: g.dia_vencimiento || null, categoriasCaja: g.categorias_caja || [], origen: "gasto_fijo",
  }));
  if (usaRRHH && sueldosRRHH && Number(sueldosRRHH.total_centavos) > 0) {
    fijos.unshift({
      id: "__sueldos", nombre: "Sueldos", categoria: "sueldos", monto: Number(sueldosRRHH.total_centavos), diaVencimiento: null,
      categoriasCaja: ["Sueldos"], origen: "rrhh", detalle: sueldosRRHH,
    });
  }
  return { fijos, ignorados, totalCentavos: fijos.reduce((a, f) => a + f.monto, 0) };
}

/** Egresos de caja que cuentan como "ya pagado" de un sobre (categorías mapeadas, sin distinguir mayúsculas). */
export function yaPagado(movimientos, categoriasCaja) {
  const set = new Set((categoriasCaja || []).map(norm));
  if (!set.size) return 0;
  return (movimientos || []).filter((m) => m.tipo === "egreso" && set.has(norm(m.categoria)) && m.activo !== false)
    .reduce((a, m) => a + (Number(m.monto_centavos) || 0), 0);
}

/** Ingresos de caja que cuentan como ventas (categoría ∈ categoriasVenta, activos). */
export function ventasDeCaja(movimientos, categoriasVenta) {
  const set = new Set((categoriasVenta || []).map(norm));
  return (movimientos || []).filter((m) => m.tipo === "ingreso" && m.activo !== false && set.has(norm(m.categoria)));
}

/** Total y detalle por fecha de las ventas de caja. */
export function ventasPorFecha(movimientos, categoriasVenta) {
  const por = new Map();
  for (const m of ventasDeCaja(movimientos, categoriasVenta)) por.set(m.fecha, (por.get(m.fecha) || 0) + (Number(m.monto_centavos) || 0));
  return [...por.entries()].map(([fecha, centavos]) => ({ fecha, centavos })).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Días que tienen un cierre automático Y ventas cargadas a mano (posible doble carga). */
export function diasConPosibleDuplicado(movimientos, categoriasVenta) {
  const ventas = ventasDeCaja(movimientos, categoriasVenta);
  const conCierre = new Set(ventas.filter((m) => m.origen === "cierre_turno").map((m) => m.fecha));
  return [...new Set(ventas.filter((m) => (m.origen || "manual") === "manual" && conCierre.has(m.fecha)).map((m) => m.fecha))].sort();
}

// ---------- Reparto ----------

/**
 * Reparte un ingreso (un cierre, un día o todo el mes) entre los sobres.
 * `acumuladoAntes` = lo ya vendido en el mes ANTES de este monto: la parte que cae bajo el punto de
 * equilibrio se reparte a gastos fijos; la que lo supera, a ganancia (proveedores y variables siguen igual).
 * @returns {{total:number, partes:Array<{id,nombre,tipo,centavos}>, ganancia:number}} partes suman EXACTO `monto`
 */
export function repartirIngreso({ monto, acumuladoAntes = 0, fijos = [], cmvPct, varPct = 0, pe }) {
  monto = Math.round(Number(monto) || 0);
  const mc = margenContribucion(cmvPct, varPct);
  const F = fijos.reduce((a, f) => a + f.monto, 0);
  const bajo = F > 0 ? Math.min(monto, Math.max(0, pe - (Number(acumuladoAntes) || 0))) : 0;
  const alto = monto - bajo;
  const items = [
    { id: "__proveedores", nombre: "Proveedores (mercadería)", tipo: "proveedores", peso: monto * (cmvPct / 100) },
    { id: "__variables", nombre: "Costos variables", tipo: "variables", peso: monto * (varPct / 100) },
    ...fijos.map((f) => ({ id: f.id, nombre: f.nombre, tipo: "fijo", peso: F > 0 ? mc * (f.monto / F) * bajo : 0 })),
    { id: "__ganancia", nombre: "Te queda", tipo: "ganancia", peso: mc * alto },
  ];
  const cent = repartirEntero(monto, items.map((i) => i.peso));
  const partes = items.map((i, k) => ({ id: i.id, nombre: i.nombre, tipo: i.tipo, centavos: cent[k] }));
  return { total: monto, partes, ganancia: partes[partes.length - 1].centavos };
}

/** Meses de calendario: días del mes de una fecha ISO. */
export function diasEnElMes(iso) {
  const [a, m] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}
const diaDelMes = (iso) => Number(String(iso).slice(8, 10));

/**
 * Estado de cada sobre al día de hoy: apartado acumulado (el mes repartido con el mismo método), objetivo
 * mensual, % cubierto, ya pagado (egresos de caja mapeados) y si llega a su vencimiento al ritmo actual.
 * @returns {Array<{id,nombre,tipo,objetivo,apartado,pctCubierto,yaPagado,diaVencimiento,estado}>}
 *   estado: pagado | cubierto | en_ritmo | atrasado
 */
export function estadoSobres({ ventasMes, fijos, cmvPct, varPct = 0, pe, hoy, movimientos = [] }) {
  const dia = Math.max(1, diaDelMes(hoy)), dEnMes = diasEnElMes(hoy);
  const rep = repartirIngreso({ monto: ventasMes, acumuladoAntes: 0, fijos, cmvPct, varPct, pe });
  const porId = Object.fromEntries(rep.partes.map((p) => [p.id, p.centavos]));
  const sobres = [
    { id: "__proveedores", nombre: "Proveedores (mercadería)", tipo: "proveedores", objetivo: Math.round(pe * cmvPct / 100) },
    { id: "__variables", nombre: "Costos variables", tipo: "variables", objetivo: Math.round(pe * varPct / 100) },
  ].map((s) => ({ ...s, apartado: porId[s.id] || 0 }));
  const lista = [...sobres, ...fijos.map((f) => ({ id: f.id, nombre: f.nombre, tipo: "fijo", objetivo: f.monto, apartado: porId[f.id] || 0,
    diaVencimiento: f.diaVencimiento, categoriasCaja: f.categoriasCaja, detalle: f.detalle }))];
  return lista.map((s) => {
    const pagado = s.tipo === "fijo" ? yaPagado(movimientos, s.categoriasCaja) : 0;
    const pctCubierto = s.objetivo > 0 ? Math.min(100, (s.apartado / s.objetivo) * 100) : 100;
    let estado;
    if (s.tipo === "fijo" && s.objetivo > 0 && pagado >= s.objetivo) estado = "pagado";
    else if (s.objetivo <= 0 || s.apartado >= s.objetivo) estado = "cubierto";
    else {
      const hasta = s.diaVencimiento || dEnMes;
      if (s.diaVencimiento && s.diaVencimiento <= dia) estado = "atrasado";           // ya venció y no está cubierto
      else estado = (s.apartado / dia) * hasta >= s.objetivo ? "en_ritmo" : "atrasado";
    }
    return { ...s, pctCubierto, yaPagado: pagado, estado };
  });
}

/**
 * Ritmo del mes: ventas acumuladas contra lo que correspondería al equilibrio a esta altura.
 * @returns {{esperado:number, diferencia:number, pctPE:number}}  diferencia > 0 = vas por encima del equilibrio
 */
export function ritmoDelMes({ ventasMes, pe, ped, diasTranscurridos, diasOperativosMes = 30 }) {
  const dias = Math.min(Math.max(0, diasTranscurridos), diasOperativosMes);
  const esperado = Math.round(ped * dias);
  return { esperado, diferencia: Math.round(ventasMes - esperado), pctPE: pe > 0 ? (ventasMes / pe) * 100 : 100 };
}

/**
 * Proyección de ventas a fin de mes. Con histórico suficiente (≥ 14 días con ventas) se pondera por
 * DÍA DE LA SEMANA (un local de mostrador vende mucho más viernes y sábado); si no, lineal ("simple").
 * @param {{ventasPorDia:Array<{fecha:string, centavos:number}>, hoy:string, acumuladoMes:number}} p
 * @returns {{centavos:number, tipo:"ponderada"|"simple"}}
 */
export function proyeccionFinDeMes({ ventasPorDia, hoy, acumuladoMes }) {
  const dEnMes = diasEnElMes(hoy), dia = Math.max(1, diaDelMes(hoy));
  const conVentas = (ventasPorDia || []).filter((v) => v.centavos > 0);
  if (conVentas.length < DIAS_MIN_HISTORICO) {
    return { centavos: Math.round((acumuladoMes / dia) * dEnMes), tipo: "simple" };
  }
  const isoDow = (iso) => { const [a, m, d] = iso.split("-").map(Number); const w = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); return w === 0 ? 7 : w; };
  const suma = Array(8).fill(0), cuenta = Array(8).fill(0);
  for (const v of conVentas) { const w = isoDow(v.fecha); suma[w] += v.centavos; cuenta[w] += 1; }
  const prom = suma.map((s, w) => (cuenta[w] ? s / cuenta[w] : 0));
  let resto = 0;
  const [a, m] = hoy.split("-").map(Number);
  for (let d = dia + 1; d <= dEnMes; d++) resto += prom[isoDow(`${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`)];
  return { centavos: Math.round(acumuladoMes + resto), tipo: "ponderada" };
}
