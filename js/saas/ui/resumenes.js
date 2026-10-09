// ============================================================
// saas/ui/resumenes.js — Tableros de inicio por módulo
//   admin()  → Administrativo
//   costos() → Costos
//   carta()  → Rentabilidad de carta
// Solo lectura; tolerante a fallos (si falta una tabla, esa parte se omite).
// ============================================================

import * as proveedoresRepo from "../data/proveedoresRepo.js";
import * as facturasRepo from "../data/facturasRepo.js";
import * as agendaRepo from "../data/pagosProgramadosRepo.js";
import * as cajaRepo from "../data/movimientosCajaRepo.js";
import * as insumosRepo from "../data/insumosRepo.js";
import * as recetasRepo from "../data/recetasRepo.js";
import { costoReceta, rentabilidad } from "../../core/costeo.js";
import { formatearCentavos, formatearPorcentaje } from "../../core/dinero.js";
import { escapar, kpiHTML } from "./helpers.js";
import { verFactura } from "./facturaModal.js";

const UMBRAL_FC = 35, DIAS_VIEJO = 30, DIAS_VENCER = 7, SIN_SECTOR = "Sin sector";
const val = (r) => (r.status === "fulfilled" ? r.value : []);
const sum = (arr, f = (x) => x.monto_centavos) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const hoyStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const addDias = (f, n) => { const d = new Date(f + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const diasHasta = (f) => (f ? Math.ceil((new Date(f + "T12:00:00").getTime() - Date.now()) / 86400000) : null);
const diasDesde = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity);
const fmtFecha = (iso) => (iso ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" }).format(new Date(iso)) : "—");

function tabla(cab, filas, vacio) {
  if (!filas.length) return `<p class="muted">${vacio}</p>`;
  return `<div class="tabla-scroll"><table><thead><tr>${cab.map((c) => `<th${c.num ? ' class="num"' : ""}>${escapar(c.t)}</th>`).join("")}</tr></thead><tbody>${filas.join("")}</tbody></table></div>`;
}

// ================= ADMINISTRATIVO =================
export async function admin(container) {
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  const hoy = hoyStr();
  const [prov, pend, prog, cajaHoy] = await Promise.allSettled([
    proveedoresRepo.listar(), facturasRepo.pendientesGlobal(),
    agendaRepo.listar(), cajaRepo.listarRango(hoy, hoy),
  ]);
  const proveedores = val(prov), pendientes = val(pend);
  const provMap = Object.fromEntries(proveedores.map((p) => [p.id, p]));

  const deuda = sum(proveedores, (p) => p.saldo_total_deuda_centavos);
  const topDeuda = proveedores.filter((p) => (p.saldo_total_deuda_centavos || 0) > 0)
    .sort((a, b) => b.saldo_total_deuda_centavos - a.saldo_total_deuda_centavos).slice(0, 5);
  const porVencer = pendientes.map((f) => ({ f, d: diasHasta(f.fecha_vencimiento) }))
    .filter((x) => x.d !== null && x.d <= DIAS_VENCER).sort((a, b) => a.d - b.d);

  const progPend = val(prog).filter((p) => p.estado === "pendiente" && p.fecha_programada <= addDias(hoy, 7));
  const aPagar7 = sum(progPend);

  const mc = val(cajaHoy);
  const ingHoy = sum(mc.filter((m) => m.tipo === "ingreso"));
  const egrHoy = sum(mc.filter((m) => m.tipo === "egreso"));

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;"><h2 style="margin:0;">Administrativo · Resumen</h2>
      <button id="r-ref" class="secundario">Refrescar</button></div>
    <div class="kpi-grid">
      ${kpiHTML("Deuda total", formatearCentavos(deuda), `${topDeuda.length} con deuda`, deuda > 0 ? "danger" : "ok", "Suma de todos los saldos a proveedores.")}
      ${kpiHTML("Por vencer", String(porVencer.length), "facturas ≤ 7 días", porVencer.length ? "warn" : "ok", "Facturas impagas que vencen en 7 días o menos (incluye vencidas).")}
      ${kpiHTML("A pagar (7 días)", formatearCentavos(aPagar7), "según agenda", aPagar7 ? "warn" : "ok", "Total agendado a pagar en los próximos 7 días.")}
      ${kpiHTML("Balance de caja hoy", formatearCentavos(ingHoy - egrHoy), `${formatearCentavos(ingHoy)} − ${formatearCentavos(egrHoy)}`, (ingHoy - egrHoy) >= 0 ? "ok" : "danger", "Ingresos menos egresos de caja del día de hoy.")}
    </div>
    <div class="dos-col">
      <div class="card"><h3 style="margin:0 0 8px;">Top deuda por proveedor</h3>
        ${tabla([{ t: "Proveedor" }, { t: "Saldo", num: true }], topDeuda.map((p) => `<tr><td>${escapar(p.nombre)}</td><td class="num" style="color:var(--error);font-weight:600;">${formatearCentavos(p.saldo_total_deuda_centavos)}</td></tr>`), "Sin deuda. 🎉")}</div>
      <div class="card"><h3 style="margin:0 0 8px;">Próximas a vencer</h3>
        ${tabla([{ t: "Proveedor" }, { t: "Vence" }, { t: "Saldo", num: true }], porVencer.slice(0, 8).map(({ f, d }) => `<tr class="res-fac" data-id="${f.id}" style="cursor:pointer;" title="Ver factura"><td>${escapar((provMap[f.proveedor_id] || {}).nombre || "—")}</td><td>${d < 0 ? `<span style="color:var(--error)">hace ${-d}d</span>` : d === 0 ? `<span style="color:var(--error)">hoy</span>` : "en " + d + "d"}</td><td class="num">${formatearCentavos(f.saldo_pendiente_centavos)}</td></tr>`), "Nada por vencer. 🎉")}</div>
    </div>`;
  container.querySelector("#r-ref").addEventListener("click", () => admin(container));
  container.querySelectorAll(".res-fac").forEach((tr) =>
    tr.addEventListener("click", () => verFactura(tr.dataset.id, { onCambio: () => admin(container) })));
}

// ================= COSTOS =================
export async function costos(container) {
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  const [ins, camb] = await Promise.allSettled([insumosRepo.listar(), insumosRepo.ultimosCambios(8)]);
  const insumos = val(ins), cambios = val(camb);
  const insMap = Object.fromEntries(insumos.map((i) => [i.id, i]));

  const desact = insumos.map((i) => ({ i, d: diasDesde(i.fecha_ultimo_precio) })).filter((x) => x.d > DIAS_VIEJO).sort((a, b) => b.d - a.d);

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;"><h2 style="margin:0;">Costos · Resumen</h2>
      <button id="r-ref" class="secundario">Refrescar</button></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
      ${kpiHTML("Insumos activos", String(insumos.length), "", "", "Cantidad de insumos cargados y activos.")}
      ${kpiHTML("Precios desactualizados", String(desact.length), `+${DIAS_VIEJO} días`, desact.length ? "danger" : "ok", "Insumos sin actualizar el precio hace más de " + DIAS_VIEJO + " días.")}
      ${kpiHTML("Cambios recientes", String(cambios.length), "últimos registrados", "", "Últimas actualizaciones de precio registradas.")}
    </div>
    <div class="dos-col">
      <div class="card"><h3 style="margin:0 0 8px;">⚠ Precios desactualizados</h3>
        ${tabla([{ t: "Insumo" }, { t: "Hace", num: true }], desact.slice(0, 10).map(({ i, d }) => `<tr><td>${escapar(i.nombre)}</td><td class="num">${d === Infinity ? "sin fecha" : d + " días"}</td></tr>`), "Todo al día. 🎉")}</div>
      <div class="card"><h3 style="margin:0 0 8px;">Últimos aumentos</h3>
        ${tabla([{ t: "Insumo" }, { t: "Fecha" }, { t: "Var.", num: true }], cambios.map((c) => `<tr><td>${escapar((insMap[c.insumo_id] || {}).nombre || "—")}</td><td>${fmtFecha(c.fecha)}</td><td class="num" style="color:${c.variacion_porcentual > 0 ? "var(--error)" : "var(--ok)"};">${c.variacion_porcentual > 0 ? "+" : ""}${escapar(formatearPorcentaje(c.variacion_porcentual))}</td></tr>`), "Sin cambios registrados.")}</div>
    </div>`;
  container.querySelector("#r-ref").addEventListener("click", () => costos(container));
}

// ================= RENTABILIDAD DE CARTA =================
export async function carta(container) {
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  const [rec, ins] = await Promise.allSettled([recetasRepo.listar(), insumosRepo.listar()]);
  const recetas = val(rec), insumos = val(ins);
  const insMap = Object.fromEntries(insumos.map((i) => [i.id, i]));
  const recMap = Object.fromEntries(recetas.map((r) => [r.id, r]));
  const ctx = { getInsumo: (id) => insMap[id] || null, getReceta: (id) => recMap[id] || null };

  const platos = [];
  for (const r of recetas.filter((x) => x.tipo === "plato" && (x.precio_venta_publico_centavos || 0) > 0)) {
    try { const costo = costoReceta(r, ctx); const rent = rentabilidad(r, costo); platos.push({ nombre: r.nombre, sector: r.sector_venta || SIN_SECTOR, foodCost: rent.foodCostPct, margen: rent.margenBrutoCentavos }); } catch (_e) {}
  }
  const fcProm = platos.length ? platos.reduce((a, p) => a + p.foodCost, 0) / platos.length : 0;
  const sobre = platos.filter((p) => p.foodCost > UMBRAL_FC).length;
  const peores = [...platos].sort((a, b) => b.foodCost - a.foodCost).slice(0, 5);

  const porSector = {};
  for (const p of platos) { const s = (porSector[p.sector] ||= { margen: 0, n: 0 }); s.margen += p.margen; s.n++; }

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;"><h2 style="margin:0;">Rentabilidad de carta · Resumen</h2>
      <button id="r-ref" class="secundario">Refrescar</button></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
      ${kpiHTML("Food cost promedio", platos.length ? formatearPorcentaje(fcProm) : "—", `${platos.length} platos`, fcProm > UMBRAL_FC ? "danger" : "ok", "Promedio del food cost de los platos con precio.")}
      ${kpiHTML("Platos caros", String(sobre), `food cost > ${UMBRAL_FC}%`, sobre ? "danger" : "ok", "Platos cuyo food cost supera el umbral objetivo.")}
      ${kpiHTML("Platos en carta", String(platos.length), "con precio", "", "Cantidad de platos con precio de carta cargado.")}
    </div>
    <div class="dos-col">
      <div class="card"><h3 style="margin:0 0 8px;">Peor food cost</h3>
        ${tabla([{ t: "Plato" }, { t: "Food cost", num: true }], peores.map((p) => `<tr><td>${escapar(p.nombre)}</td><td class="num" style="color:${p.foodCost > UMBRAL_FC ? "var(--error)" : "var(--ok)"};font-weight:600;">${escapar(formatearPorcentaje(p.foodCost))}</td></tr>`), "Cargá platos con precio.")}</div>
      <div class="card"><h3 style="margin:0 0 8px;">Margen por sector</h3>
        ${tabla([{ t: "Sector" }, { t: "Platos", num: true }, { t: "Margen", num: true }], Object.entries(porSector).sort((a, b) => a[0].localeCompare(b[0])).map(([s, d]) => `<tr><td>${escapar(s)}</td><td class="num">${d.n}</td><td class="num">${formatearCentavos(d.margen)}</td></tr>`), "Sin datos.")}</div>
    </div>`;
  container.querySelector("#r-ref").addEventListener("click", () => carta(container));
}
