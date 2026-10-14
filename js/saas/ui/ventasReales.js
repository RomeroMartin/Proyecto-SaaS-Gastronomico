// ============================================================
// saas/ui/ventasReales.js — Rentabilidad de carta → Ventas reales
// ------------------------------------------------------------
// Lo que REALMENTE se vendió y cuánto costó. El costo de lo vendido es el
// CMV TEÓRICO (unidades × costo de receta al vender): no ve mermas ni
// pérdidas, y por eso NUNCA se lo llama "real". Se lo contrasta con las
// compras del período: la diferencia es una señal, no una verdad.
// ============================================================

import * as repo from "../data/reportesVentasRepo.js";
import * as recetasRepo from "../data/recetasRepo.js";
import * as insumosRepo from "../data/insumosRepo.js";
import { cmvTeoricoPct, mixDeVentas, brechaComprasVsCmv, ventasPorDiaSemana, ventasPorFranja, totalesPeriodo } from "../../core/costeo.js";
import { formatearCentavos, formatearPorcentaje } from "../../core/dinero.js";
import { hoyISO, rangoPreset, formatearFecha } from "../../core/utilsFecha.js";
import { exportarExcel } from "../../export/excel.js";
import { escapar, kpiHTML, toast, abrirModal, cerrarModal, setMsg } from "./helpers.js";

const $ = (c, s) => c.querySelector(s);
const money = (c) => formatearCentavos(c);
const pct = (n) => (n == null ? "—" : formatearPorcentaje(n));
const DIAS_VIEJO = 30;

let rango = null, preset = "30d", PERFIL = null;

export async function montar(container, perfil) {
  PERFIL = perfil;
  if (!rango) rango = rangoPreset(preset, hoyISO());
  await cargar(container);
}

async function cargar(container) {
  container.innerHTML = "<p class='muted'>Calculando ventas…</p>";
  const { desde, hasta } = rango;
  let dia, plato, hora, comp, recetas = [], insumos = [];
  try {
    [dia, plato, hora, comp] = await Promise.all([repo.porDia(desde, hasta), repo.porPlato(desde, hasta), repo.porHora(desde, hasta), repo.compras(desde, hasta)]);
    [recetas, insumos] = await Promise.all([recetasRepo.listar().catch(() => []), insumosRepo.listar().catch(() => [])]);
  } catch (err) {
    container.innerHTML = `<div class="card"><p class="error">No se pudieron cargar las ventas: ${escapar(err.message || String(err))}</p>
      <p class="muted">¿Corriste supabase/f3_ventas_reportes.sql?</p></div>`;
    return;
  }
  render(container, { dia, plato, hora, comp, recetas, insumos });
}

function render(container, d) {
  const t = totalesPeriodo(d.dia);
  const mix = mixDeVentas(d.plato);
  const unidades = mix.reduce((s, x) => s + x.unidades, 0);
  const brecha = brechaComprasVsCmv(d.comp.compras_centavos, t.costo, rango.desde, rango.hasta);
  const carta = Object.fromEntries(d.recetas.map((r) => [r.id, r]));
  const viejos = d.insumos.filter((i) => i.fecha_ultimo_precio && (Date.now() - new Date(i.fecha_ultimo_precio).getTime()) / 86400000 > DIAS_VIEJO).length;
  const admin = PERFIL.rol === "ADMIN";
  const esRI = PERFIL.empresa && PERFIL.empresa.condicion_fiscal === "responsable_inscripto";
  const presets = [["7d", "7 días"], ["30d", "30 días"], ["mes", "Este mes"], ["mes_anterior", "Mes anterior"]];

  const filasPlato = mix.map((x) => {
    const r = carta[x.receta_id];
    const fcCarta = r && r.precio_venta_publico_centavos > 0 ? cmvTeoricoPct(r.precio_venta_publico_centavos, r.costo_calculado_centavos) : null;
    const dif = x.cmvPct != null && fcCarta != null ? x.cmvPct - fcCarta : null;
    return `<tr>
      <td>${escapar(x.nombre)}</td><td class="num">${x.unidades}</td><td class="num">${money(x.ingreso)}</td><td class="num">${money(x.costo)}</td>
      <td class="num">${pct(x.cmvPct)}</td><td class="num">${pct(x.pctIngreso)}</td>
      <td class="num" title="Food cost teórico de la carta de hoy (costo actual ÷ precio actual)">${pct(fcCarta)}${dif != null && Math.abs(dif) >= 0.5 ? ` <span class="muted" style="font-size:11px;">(${dif > 0 ? "+" : "−"}${Math.abs(dif).toFixed(1).replace(".", ",")} pp)</span>` : ""}</td></tr>`;
  }).join("");

  const dow = ventasPorDiaSemana(d.dia);
  const maxDow = Math.max(1, ...dow.map((x) => x.ingreso));
  const franjas = ventasPorFranja(d.hora);
  const maxF = Math.max(1, ...franjas.map((x) => x.ingreso));
  const barra = (v, max) => `<div style="background:#e4e4e7;border-radius:4px;height:10px;min-width:60px;"><div style="background:var(--tinta);border-radius:4px;height:10px;width:${Math.round((v / max) * 100)}%;"></div></div>`;

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:10px;"><h2 style="margin:0;">Rentabilidad · Ventas reales</h2>
      <button id="vr-excel" class="secundario">Exportar a Excel</button></div>
    <div class="card" style="margin-top:0;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${presets.map(([k, l]) => `<button class="secundario vr-preset ${preset === k ? "resaltado" : ""}" data-p="${k}">${l}</button>`).join("")}
        <span class="muted" style="margin-left:6px;">o</span>
        <input id="vr-desde" type="date" value="${rango.desde}" style="width:auto;" /> <span class="muted">a</span>
        <input id="vr-hasta" type="date" value="${rango.hasta}" style="width:auto;" />
        <button id="vr-aplicar" class="secundario">Aplicar</button>
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:12.5px;">${formatearFecha(rango.desde)} al ${formatearFecha(rango.hasta)} · por <b>día operativo</b> · pedidos anulados excluidos${esRI ? " · los importes incluyen IVA" : ""}.</p>
    </div>

    ${viejos ? `<div class="card" style="border-color:#fed7aa;background:#fff7ed;">⚠ Hay <b>${viejos}</b> insumo(s) con el precio sin actualizar hace más de ${DIAS_VIEJO} días: el costo de lo vendido puede estar subestimado.</div>` : ""}

    ${t.pedidos === 0 ? `<div class="card"><p class="muted">No hay ventas en este rango.</p></div>` : `
    <div class="kpi-grid" style="margin-top:14px;">
      ${kpiHTML("Ventas cobradas", money(t.ingreso), `${t.pedidos} pedidos`, "", "Lo cobrado en el período (productos, descuentos y envíos). Coincide con los cierres de caja.")}
      ${kpiHTML("Costo de lo vendido (teórico)", money(t.costo), "unidades × costo de receta", "", "CMV TEÓRICO: costo de las recetas al momento de vender. No ve mermas, porciones de más ni pérdidas.")}
      ${kpiHTML("CMV teórico", pct(t.cmvPct), "sobre productos netos", t.cmvPct != null && t.cmvPct > 35 ? "danger" : "ok", "Costo de lo vendido ÷ productos vendidos (netos de descuento, sin envío).")}
      ${kpiHTML("Margen bruto", money(t.margenBruto), "productos netos − costo", "", "Lo que queda de los productos vendidos después del costo teórico.")}
      ${kpiHTML("Unidades vendidas", String(unidades), "incluye adicionales", "", "")}
      ${kpiHTML("Ticket promedio", money(t.ticketPromedio), "por pedido", "", "Ventas cobradas ÷ pedidos.")}
      ${kpiHTML("Pedidos anulados", pct(t.pctAnulados), `${t.anulados} · ${money(t.montoAnulado)}`, t.pctAnulados > 5 ? "warn" : "", "Un porcentaje alto puede indicar errores de carga o algo para revisar.")}
      ${kpiHTML("Descuentos / envíos", money(t.descuento), `envíos cobrados ${money(t.envio)}`, "", "Descuentos otorgados en el período y envíos cobrados.")}
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px;">Compras del período vs costo teórico</h3>
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:8px;">
        ${kpiHTML("Compras del período", money(d.comp.compras_centavos), `${d.comp.facturas} facturas`, "", "Facturas no anuladas por fecha de emisión (neto + IVA) de rubros que cuentan como mercadería.")}
        ${kpiHTML("Costo teórico de lo vendido", money(t.costo), "", "", "")}
        ${kpiHTML("Brecha", (brecha.brechaCentavos >= 0 ? "+" : "−") + money(Math.abs(brecha.brechaCentavos)), brecha.brechaPct == null ? "" : `${brecha.brechaPct >= 0 ? "+" : "−"}${formatearPorcentaje(Math.abs(brecha.brechaPct))} sobre el costo teórico`, brecha.periodoCorto ? "" : (brecha.brechaPct != null && brecha.brechaPct > 10 ? "danger" : "ok"), "Compras − costo teórico de lo vendido.")}
      </div>
      ${brecha.periodoCorto ? `<p class="muted" style="margin:0 0 6px;color:#b45309;">⚠ El período tiene ${brecha.dias} días (menos de 28): el stock que entra y sale distorsiona la brecha. No la tomes como confiable.</p>` : ""}
      <p class="muted" style="margin:0;font-size:12.5px;">Una brecha positiva sostenida puede indicar <b>desperdicio, porciones de más, stock que se acumula o recetas desactualizadas</b>; no es una medición exacta (eso exige inventario).
        No cuentan ${money(d.comp.excluidas_centavos)} de rubros excluidos (por defecto Limpieza y Descartables).${admin ? ` <button id="vr-rubros" class="secundario" style="padding:2px 10px;font-size:12.5px;">Cambiar rubros</button>` : ""}</p>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px;">Por plato</h3>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Plato</th><th class="num">Unidades</th><th class="num">Ingreso</th><th class="num">Costo teórico</th><th class="num">CMV teórico</th><th class="num">% de las ventas</th><th class="num">Food cost de la carta</th></tr></thead>
        <tbody>${filasPlato}</tbody></table></div>
      <p class="muted" style="margin:8px 0 0;font-size:12px;">El ingreso es a precio de lista por producto, tal como se cobró en cada momento (si cambiaste un precio a mitad del período, cada venta mantiene el suyo). La última columna es el food cost teórico de la carta de hoy; entre paréntesis, la diferencia en puntos porcentuales.</p>
    </div>

    <div class="dos-col">
      <div class="card"><h3 style="margin:0 0 6px;">Por día de la semana</h3>
        <div class="tabla-scroll"><table><thead><tr><th>Día</th><th class="num">Promedio por día</th><th class="num">Total</th><th></th></tr></thead><tbody>
          ${dow.map((x) => `<tr><td>${x.nombre}</td><td class="num">${x.dias ? money(x.promedioPorDia) : "—"}</td><td class="num">${money(x.ingreso)}</td><td style="width:90px;">${barra(x.ingreso, maxDow)}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="card"><h3 style="margin:0 0 6px;">Por franja horaria</h3>
        <div class="tabla-scroll"><table><thead><tr><th>Hora</th><th class="num">Pedidos</th><th class="num">Total</th><th></th></tr></thead><tbody>
          ${franjas.map((x) => `<tr><td>${String(x.hora).padStart(2, "0")}:00</td><td class="num">${x.pedidos}</td><td class="num">${money(x.ingreso)}</td><td style="width:90px;">${barra(x.ingreso, maxF)}</td></tr>`).join("")}</tbody></table></div></div>
    </div>`}`;

  const aplicar = (p, r) => { preset = p; rango = r; cargar(container); };
  container.querySelectorAll(".vr-preset").forEach((b) => b.addEventListener("click", () => aplicar(b.dataset.p, rangoPreset(b.dataset.p, hoyISO()))));
  $(container, "#vr-aplicar").addEventListener("click", () => {
    const desde = $(container, "#vr-desde").value, hasta = $(container, "#vr-hasta").value;
    if (!desde || !hasta || hasta < desde) { toast("Revisá las fechas del rango.", "error"); return; }
    aplicar("custom", { desde, hasta });
  });
  $(container, "#vr-excel").addEventListener("click", () => {
    try {
      exportarExcel(mix.map((x) => ({
        Plato: x.nombre, Unidades: x.unidades, "Ingreso ($)": x.ingreso / 100, "Costo teórico ($)": x.costo / 100,
        "CMV teórico (%)": x.cmvPct == null ? "" : Math.round(x.cmvPct * 10) / 10, "% de las ventas": Math.round(x.pctIngreso * 10) / 10,
        Desde: rango.desde, Hasta: rango.hasta,
      })), "ventas-por-plato", "Por plato");
    } catch (err) { toast(err.message || String(err), "error"); }
  });
  const rb = $(container, "#vr-rubros");
  if (rb) rb.addEventListener("click", () => editarRubros(container));
}

function editarRubros(container) {
  const body = abrirModal("Rubros que no cuentan como mercadería");
  body.innerHTML = `<p style="margin:0 0 8px;">Las facturas de proveedores de estos rubros no se suman a las compras del período. Uno por línea.</p>
    <textarea id="rb-lista" rows="6" style="width:100%;"></textarea>
    <p id="rb-msg" class="msg" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button class="secundario" id="rb-no">Cancelar</button><button id="rb-si">Guardar</button></div>`;
  $(body, "#rb-lista").value = (PERFIL.empresa && PERFIL.empresa.rubros_excluidos_cmv || ["Limpieza", "Descartables"]).join("\n");
  $(body, "#rb-no").addEventListener("click", cerrarModal);
  $(body, "#rb-si").addEventListener("click", async () => {
    const msg = $(body, "#rb-msg");
    const lista = $(body, "#rb-lista").value.split("\n").map((x) => x.trim()).filter(Boolean);
    setMsg(msg, "Guardando…");
    try {
      await repo.setRubrosExcluidos(lista);
      if (PERFIL.empresa) PERFIL.empresa.rubros_excluidos_cmv = lista;
      cerrarModal(); toast("Guardado ✔"); cargar(container);
    } catch (err) { setMsg(msg, err.message || String(err), "error"); }
  });
}
