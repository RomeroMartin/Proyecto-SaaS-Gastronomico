// ============================================================
// core/costeo.js — Costeo, escandallos y rentabilidad (Sección 6)
// ------------------------------------------------------------
// Función única y centralizada usada en TODO el sistema.
// El escandallo vive 100 % en NETO (Regla 3.2).
// Este módulo NO conoce Firebase ni el DOM: recibe los datos ya cargados.
// ============================================================

/** Profundidad máxima de anidamiento de sub-recetas (Sección 5.6). */
export const MAX_PROFUNDIDAD_RECETA = 4;

/**
 * Costo REAL por unidad base útil de un insumo, en centavos.
 *
 * ⚠️ POLÍTICA DE COSTEO (decisión de la administración del restaurante,
 *    2026-08): el costo se calcula por el PRECIO FINAL pagado al proveedor,
 *    con IVA INCLUIDO. NO se descuenta el IVA como crédito fiscal, aunque el
 *    comprobante sea Factura A de un Responsable Inscripto.
 *
 *    Antes: la Factura A costeaba por el NETO (IVA = crédito fiscal). Ese
 *    criterio quedó DESACTIVADO a pedido del restaurante. Para volver a él,
 *    reponer la rama con recuperaCreditoFiscal() (ver git / core/fiscal.js).
 *
 *    Nota: las FACTURAS siguen guardando el desglose neto/IVA/total (realidad
 *    fiscal para AFIP). Esto solo cambia cómo se COSTEAN los insumos/recetas.
 *
 * - costo = neto * (1 + alícuota_iva/100)   → precio final con IVA.
 * - el factor de corrección encarece el gramo útil: costo / factor.
 *
 * Los parámetros `proveedor` y `tipoComprobante` se conservan por
 * compatibilidad de firma, pero YA NO afectan el costo.
 *
 * @param {object} insumo
 * @param {number} insumo.costo_neto_por_unidad_base_centavos
 * @param {number} insumo.alicuota_iva
 * @param {number} [insumo.factor_correccion=1]
 * @param {object} [_proveedor]        (ignorado) se mantiene por compatibilidad
 * @param {string} [_tipoComprobante]  (ignorado) se mantiene por compatibilidad
 * @returns {number} centavos por unidad base útil (puede ser fraccionario)
 */
export function costoRealPorUnidadBase(insumo, _proveedor, _tipoComprobante) {
  const neto = Number(insumo.costo_neto_por_unidad_base_centavos) || 0;
  // Precio final: el IVA es costo (no crédito fiscal), siempre se suma.
  const base = neto * (1 + (Number(insumo.alicuota_iva) || 0) / 100);

  const factor = Number(insumo.factor_correccion) || 1;
  return base / factor;
}

/**
 * Costo total de una receta, en centavos (recursivo, con caché y control de ciclos).
 *
 * @param {object} receta  documento de receta (con `ingredientes`)
 * @param {object} ctx
 * @param {(id:string)=>object|null} ctx.getInsumo    resuelve un insumo por id
 * @param {(id:string)=>object|null} ctx.getReceta    resuelve una receta por id
 * @param {(insumo:object)=>{proveedor:object, tipoComprobante:string}} [ctx.contextoInsumo]
 *        devuelve el proveedor y tipo de comprobante a usar para costear el insumo.
 *        Por defecto asume Factura A + Responsable Inscripto (caso más común).
 * @param {Map} [ctx._cache]   caché de costos de receta dentro del ciclo de cálculo
 * @param {Set} [ctx._enCurso] set de ids en la pila de recursión (detección de ciclos)
 * @param {number} [ctx._profundidad=0]
 * @returns {number} centavos (fraccionario; redondear en la capa de presentación)
 */
export function costoReceta(receta, ctx) {
  const {
    getInsumo,
    getReceta,
    contextoInsumo = () => ({
      proveedor: { condicion_fiscal: "responsable_inscripto" },
      tipoComprobante: "A",
    }),
    _cache = new Map(),
    _enCurso = new Set(),
    _profundidad = 0,
  } = ctx;

  if (!receta) return 0;

  if (_profundidad > MAX_PROFUNDIDAD_RECETA) {
    throw new Error(`Se superó la profundidad máxima de sub-recetas (${MAX_PROFUNDIDAD_RECETA}).`);
  }

  const recetaId = receta.id;
  if (recetaId) {
    if (_enCurso.has(recetaId)) {
      throw new Error(`Ciclo de sub-recetas detectado en la receta "${receta.nombre || recetaId}".`);
    }
    if (_cache.has(recetaId)) return _cache.get(recetaId);
    _enCurso.add(recetaId);
  }

  let total = 0;
  for (const ing of receta.ingredientes || []) {
    const cantidad = Number(ing.cantidad) || 0;

    if (ing.tipo === "insumo") {
      const insumo = getInsumo(ing.ref_id);
      if (!insumo) continue; // insumo faltante/inactivo: se ignora (se reporta en la UI)
      const { proveedor, tipoComprobante } = contextoInsumo(insumo);
      total += cantidad * costoRealPorUnidadBase(insumo, proveedor, tipoComprobante);
    } else if (ing.tipo === "receta") {
      const sub = getReceta(ing.ref_id);
      if (!sub) continue;
      const subCosto = costoReceta(sub, {
        ...ctx,
        _cache,
        _enCurso,
        _profundidad: _profundidad + 1,
      });
      const rend = Number(sub.rendimiento_cantidad) || 1;
      const costoUnitarioSub = subCosto / rend;
      total += cantidad * costoUnitarioSub;
    }
  }

  if (recetaId) {
    _enCurso.delete(recetaId);
    _cache.set(recetaId, total);
  }
  return total;
}

/**
 * Detecta ciclos y profundidad excesiva ANTES de escribir una receta (DFS).
 * Se usa al guardar (Sección 5.6). No calcula costos.
 *
 * @param {object} receta       receta candidata (puede no tener id todavía)
 * @param {(id:string)=>object|null} getReceta
 * @param {string} [recetaIdCandidata]  id que tendrá/tiene la receta (para autoreferencia)
 * @returns {{ok:boolean, motivo?:string}}
 */
export function validarGrafoReceta(receta, getReceta, recetaIdCandidata) {
  function dfs(nodo, enPila, profundidad) {
    if (profundidad > MAX_PROFUNDIDAD_RECETA) {
      return { ok: false, motivo: `Máximo ${MAX_PROFUNDIDAD_RECETA} niveles de sub-recetas.` };
    }
    for (const ing of (nodo && nodo.ingredientes) || []) {
      if (ing.tipo !== "receta") continue;
      const hijoId = ing.ref_id;
      if (enPila.has(hijoId)) {
        return { ok: false, motivo: "Referencia circular entre sub-recetas." };
      }
      const hijo = getReceta(hijoId);
      if (!hijo) continue;
      enPila.add(hijoId);
      const r = dfs(hijo, enPila, profundidad + 1);
      enPila.delete(hijoId);
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  const pila = new Set();
  if (recetaIdCandidata) pila.add(recetaIdCandidata);
  return dfs(receta, pila, 1);
}

/**
 * Rentabilidad de un plato (Sección 6.3).
 *
 * ⚠️ POLÍTICA (2026-08): TODO se compara "con IVA". El costo ya incluye IVA
 *    (ver costoRealPorUnidadBase) y el precio de carta se carga con IVA
 *    incluido. Por eso:
 *      food cost % = costo (c/IVA) / precio de carta (c/IVA)
 *      margen bruto = precio de carta − costo (ambos c/IVA)
 *    `precioNetoCentavos` se sigue devolviendo, pero solo como dato
 *    informativo (el neto del precio de carta).
 *
 * @param {object} plato  con `precio_venta_publico_centavos` y `alicuota_venta`
 * @param {number} costoRecetaCentavos  costo de la receta con IVA (centavos)
 * @returns {{precioNetoCentavos:number, foodCostPct:number, margenBrutoCentavos:number, precioPublicoCentavos:number}}
 */
export function rentabilidad(plato, costoRecetaCentavos) {
  const precioPublico = Number(plato.precio_venta_publico_centavos) || 0;
  const ali = Number(plato.alicuota_venta) || 0;
  const precioNeto = precioPublico / (1 + ali / 100); // informativo
  const costo = Number(costoRecetaCentavos) || 0;
  // Food cost y margen contra el PRECIO DE CARTA (con IVA), no contra el neto.
  const foodCostPct = precioPublico > 0 ? (costo / precioPublico) * 100 : 0;
  const margenBruto = precioPublico - costo;
  return {
    precioNetoCentavos: precioNeto,
    foodCostPct,
    margenBrutoCentavos: margenBruto,
    precioPublicoCentavos: precioPublico,
  };
}

/**
 * Calculadora inversa (UX 7.4): ¿a qué PRECIO DE CARTA (con IVA) hay que
 * vender un plato para alcanzar un food cost % objetivo?
 *
 * Como el food cost se mide contra el precio de carta (con IVA):
 *   precio_carta = costo / (foodCostObjetivo/100)
 *   precio_neto  = precio_carta / (1 + alícuota_venta/100)   (informativo)
 *
 * @param {number} costoRecetaCentavos  costo de la receta con IVA (centavos)
 * @param {number} foodCostObjetivoPct  (%) ej. 30
 * @param {number} alicuotaVenta        (%) ej. 21 (solo para el neto informativo)
 * @returns {{precioNetoCentavos:number, precioPublicoCentavos:number}}
 */
export function precioSugerido(costoRecetaCentavos, foodCostObjetivoPct, alicuotaVenta) {
  const costo = Number(costoRecetaCentavos) || 0;
  const objetivo = Number(foodCostObjetivoPct) || 0;
  if (objetivo <= 0) return { precioNetoCentavos: 0, precioPublicoCentavos: 0 };
  const precioPublico = costo / (objetivo / 100);
  const precioNeto = precioPublico / (1 + (Number(alicuotaVenta) || 0) / 100); // informativo
  return {
    precioNetoCentavos: precioNeto,
    precioPublicoCentavos: precioPublico,
  };
}

// ============================================================
// Rentabilidad REAL de lo vendido (Fase 3)
// ------------------------------------------------------------
// OJO con el nombre: costo de lo vendido = unidades × costo de la receta al
// momento de la venta. Es el CMV TEÓRICO: no ve mermas, porciones de más ni
// pérdidas. No es el "food cost real" (eso exige inventario). Se lo contrasta
// con las COMPRAS del período: la diferencia es una señal, no una verdad.
// ============================================================

/** CMV teórico en %: costo de lo vendido sobre el ingreso. null si no hay ingreso. */
export function cmvTeoricoPct(ingresoCentavos, costoCentavos) {
  const ingreso = Number(ingresoCentavos) || 0;
  if (ingreso <= 0) return null;
  return ((Number(costoCentavos) || 0) / ingreso) * 100;
}

/**
 * Mix de ventas: junta las filas por receta (varios días) y calcula participación.
 * @param {Array<{receta_id:string, nombre:string, unidades:number, ingreso_centavos:number, costo_centavos:number}>} filas
 * @returns {Array<{receta_id, nombre, unidades, ingreso, costo, margen, cmvPct, pctUnidades, pctIngreso}>} ordenado por ingreso desc
 */
export function mixDeVentas(filas) {
  const por = new Map();
  for (const f of filas || []) {
    const a = por.get(f.receta_id) || { receta_id: f.receta_id, nombre: f.nombre, unidades: 0, ingreso: 0, costo: 0 };
    a.unidades += Number(f.unidades) || 0;
    a.ingreso += Number(f.ingreso_centavos) || 0;
    a.costo += Number(f.costo_centavos) || 0;
    a.nombre = f.nombre || a.nombre;
    por.set(f.receta_id, a);
  }
  const lista = [...por.values()];
  const totU = lista.reduce((s, x) => s + x.unidades, 0);
  const totI = lista.reduce((s, x) => s + x.ingreso, 0);
  return lista.map((x) => ({
    ...x,
    margen: x.ingreso - x.costo,
    cmvPct: cmvTeoricoPct(x.ingreso, x.costo),
    pctUnidades: totU > 0 ? (x.unidades / totU) * 100 : 0,
    pctIngreso: totI > 0 ? (x.ingreso / totI) * 100 : 0,
  })).sort((a, b) => b.ingreso - a.ingreso || a.nombre.localeCompare(b.nombre));
}

/** Días calendario del rango (ambos extremos incluidos). */
function diasDelRango(desdeISO, hastaISO) {
  const d = new Date(desdeISO + "T00:00:00Z"), h = new Date(hastaISO + "T00:00:00Z");
  return Math.round((h - d) / 86400000) + 1;
}

/** Con menos de estos días el stock inicial/final distorsiona la brecha de compras. */
export const DIAS_MIN_BRECHA = 28;

/**
 * Brecha entre lo COMPRADO y el costo teórico de lo vendido.
 * Positiva = se compró más de lo que "explican" las ventas (posible desperdicio, stock que
 * se acumula o recetas desactualizadas). Con período corto no es confiable.
 * @returns {{brechaCentavos:number, brechaPct:number|null, periodoCorto:boolean, dias:number}}
 */
export function brechaComprasVsCmv(comprasCentavos, cmvTeoricoCentavos, desdeISO, hastaISO) {
  const compras = Number(comprasCentavos) || 0, cmv = Number(cmvTeoricoCentavos) || 0;
  const dias = diasDelRango(desdeISO, hastaISO);
  return {
    brechaCentavos: compras - cmv,
    brechaPct: cmv > 0 ? ((compras - cmv) / cmv) * 100 : null,
    periodoCorto: dias < DIAS_MIN_BRECHA,
    dias,
  };
}

const NOMBRE_DOW = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/**
 * Ventas por día de la semana (1 = lunes … 7 = domingo) a partir de las filas por día.
 * @returns {Array<{dow:number, nombre:string, dias:number, pedidos:number, ingreso:number, promedioPorDia:number}>}
 */
export function ventasPorDiaSemana(filasDia) {
  const acc = Array.from({ length: 7 }, (_, i) => ({ dow: i + 1, nombre: NOMBRE_DOW[i + 1], dias: 0, pedidos: 0, ingreso: 0 }));
  for (const f of filasDia || []) {
    const [a, m, d] = String(f.fecha_operativa).split("-").map(Number);
    const jsDow = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
    const x = acc[jsDow === 0 ? 6 : jsDow - 1];
    x.dias += 1; x.pedidos += Number(f.pedidos) || 0; x.ingreso += Number(f.ingreso_centavos) || 0;
  }
  return acc.map((x) => ({ ...x, promedioPorDia: x.dias ? Math.round(x.ingreso / x.dias) : 0 }));
}

/** Ventas por hora local (suma de todos los días del rango), ordenadas por hora. */
export function ventasPorFranja(filasHora) {
  const por = new Map();
  for (const f of filasHora || []) {
    const x = por.get(f.hora) || { hora: f.hora, pedidos: 0, ingreso: 0 };
    x.pedidos += Number(f.pedidos) || 0; x.ingreso += Number(f.ingreso_centavos) || 0;
    por.set(f.hora, x);
  }
  return [...por.values()].sort((a, b) => a.hora - b.hora);
}

/** Totales del período a partir de las filas por día. */
export function totalesPeriodo(filasDia) {
  const t = { pedidos: 0, ingreso: 0, productosNetos: 0, descuento: 0, envio: 0, costo: 0, anulados: 0, montoAnulado: 0 };
  for (const f of filasDia || []) {
    t.pedidos += Number(f.pedidos) || 0; t.ingreso += Number(f.ingreso_centavos) || 0;
    t.productosNetos += Number(f.productos_netos_centavos) || 0; t.descuento += Number(f.descuento_centavos) || 0;
    t.envio += Number(f.envio_centavos) || 0; t.costo += Number(f.costo_centavos) || 0;
    t.anulados += Number(f.anulados) || 0; t.montoAnulado += Number(f.monto_anulado_centavos) || 0;
  }
  return {
    ...t,
    cmvPct: cmvTeoricoPct(t.productosNetos, t.costo),                 // sobre productos netos de descuento, sin envío
    margenBruto: t.productosNetos - t.costo,
    ticketPromedio: t.pedidos ? Math.round(t.ingreso / t.pedidos) : 0,
    pctAnulados: t.pedidos + t.anulados > 0 ? (t.anulados / (t.pedidos + t.anulados)) * 100 : 0,
  };
}
