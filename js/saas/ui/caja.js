// ============================================================
// saas/ui/caja.js — Flujo de caja (libro diario: ingresos, egresos, balance)
// ============================================================

import * as cajaRepo from "../data/movimientosCajaRepo.js";
import * as catalogos from "../data/catalogosRepo.js";
import { pesosACentavos, formatearCentavos } from "../../core/dinero.js";
import { hoyISO, addDias, fechaOperativa } from "../../core/utilsFecha.js";
import { escapar, setMsg, labelInfo, datalist, kpiHTML, toast, confirmar } from "./helpers.js";

const MEDIOS = [["efectivo", "Efectivo"], ["tarjeta", "Tarjeta"], ["qr", "QR"], ["transferencia", "Transferencia"], ["cheque", "Cheque"], ["otro", "Otro"]];
const labelMedio = (m) => (MEDIOS.find((x) => x[0] === m) || [m, m])[1];

let PERFIL = null;
let dia = null; // día visible (se inicializa con el día operativo en la zona de la empresa)

function diaDeTrabajo() {
  const corte = PERFIL && PERFIL.empresa && PERFIL.empresa.hora_corte_dia;
  const conVentas = PERFIL && PERFIL.empresa && Array.isArray(PERFIL.empresa.modulos) && PERFIL.empresa.modulos.includes("ventas");
  return conVentas && corte ? fechaOperativa(new Date(), undefined, corte) : hoyISO();
}

const $ = (c, s) => c.querySelector(s);
function fmtDia(f) { return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(f + "T00:00:00")); }
const sum = (arr) => arr.reduce((a, m) => a + (Number(m.monto_centavos) || 0), 0);

export async function montar(container, perfil) {
  PERFIL = perfil;
  // Día en pantalla: el DÍA OPERATIVO actual (si el local cierra pasada la medianoche, las ventas de la
  // madrugada cuentan para el día anterior). Sin módulo de ventas es simplemente hoy.
  if (!dia) dia = diaDeTrabajo();
  await cargar(container);
}

async function cargar(container) {
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  let movimientos = [];
  try {
    movimientos = await cajaRepo.listarRango(addDias(dia, -6), dia);
  } catch (err) {
    container.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}
      <br><span class="muted">¿Corriste supabase/movimientos_caja.sql?</span></p>`;
    return;
  }
  render(container, movimientos);
}

function render(container, movimientos) {
  const delDia = movimientos.filter((m) => m.fecha === dia);
  const ingresos = delDia.filter((m) => m.tipo === "ingreso");
  const egresos = delDia.filter((m) => m.tipo === "egreso");
  const totIng = sum(ingresos), totEgr = sum(egresos), balance = totIng - totEgr;

  const catIng = catalogos.opciones("cat_ingreso");
  const catEgr = catalogos.opciones("cat_egreso");
  const medioOpts = MEDIOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;">
      <h2 style="margin:0;">Flujo de caja</h2>
      <div style="display:flex;gap:6px;align-items:center;">
        <button id="caja-prev" class="secundario">‹</button>
        <input id="caja-fecha" type="date" value="${dia}" style="width:auto;" />
        <button id="caja-next" class="secundario">›</button>
      </div>
    </div>
    <p class="muted" style="margin-top:-8px;text-transform:capitalize;">${escapar(fmtDia(dia))}</p>

    ${avisoDuplicado(delDia)}
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
      ${kpiHTML("Ingresos del día", formatearCentavos(totIng), `${ingresos.length} mov.`, "ok",
        "Todo lo que entró: ventas en efectivo, tarjeta, QR, transferencias, etc.")}
      ${kpiHTML("Egresos del día", formatearCentavos(totEgr), `${egresos.length} mov.`, "danger",
        "Todo lo que salió: pagos a proveedores, sueldos, servicios, mantenimiento, retiros…")}
      ${kpiHTML("Balance del día", formatearCentavos(balance), balance >= 0 ? "a favor" : "en rojo", balance >= 0 ? "ok" : "danger",
        "Ingresos menos egresos del día. En verde si entró más de lo que salió.")}
    </div>

    <div class="card">
      <h2 style="margin-top:0;">Cargar movimiento</h2>
      <form id="caja-form">
        <div class="fila">
          <div>${labelInfo("caja-tipo", "Tipo", "Ingreso = entra plata. Egreso = sale plata.")}
            <select id="caja-tipo"><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></div>
          <div>${labelInfo("caja-cat", "Categoría", "En qué concepto. Elegí o escribí una nueva: se guarda para la próxima.")}
            <input id="caja-cat" list="dl-cat-caja" placeholder="Elegí o escribí…" /></div>
          <div>${labelInfo("caja-medio", "Medio", "Cómo se cobró/pagó.")}
            <select id="caja-medio">${medioOpts}</select></div>
        </div>
        <div class="fila">
          <div>${labelInfo("caja-monto", "Monto ($)", "Importe del movimiento.")}<input id="caja-monto" placeholder="0,00" /></div>
          <div style="flex:2;">${labelInfo("caja-nota", "Nota", "Detalle opcional.")}<input id="caja-nota" placeholder="Opcional" /></div>
        </div>
        <div style="margin-top:14px;"><button type="submit">Agregar al día</button></div>
        <p id="caja-msg" class="msg" hidden></p>
      </form>
      ${datalist("dl-cat-caja", catIng)}
    </div>

    <div class="dos-col">
      <div class="card">
        <h3 style="margin:0 0 6px;color:var(--ok);">Ingresos</h3>
        ${tablaMov(ingresos)}
      </div>
      <div class="card">
        <h3 style="margin:0 0 6px;color:var(--error);">Egresos</h3>
        ${tablaMov(egresos)}
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px;">Últimos 7 días</h3>
      ${tabla7dias(movimientos)}
    </div>`;

  $(container, "#caja-prev").addEventListener("click", () => { dia = addDias(dia, -1); cargar(container); });
  $(container, "#caja-next").addEventListener("click", () => { dia = addDias(dia, 1); cargar(container); });
  $(container, "#caja-fecha").addEventListener("change", (e) => { dia = e.target.value || diaDeTrabajo(); cargar(container); });

  const tipoSel = $(container, "#caja-tipo");
  const dl = $(container, "#dl-cat-caja");
  const refrescarCats = () => {
    const arr = tipoSel.value === "egreso" ? catEgr : catIng;
    dl.innerHTML = arr.map((o) => `<option value="${escapar(o)}"></option>`).join("");
  };
  tipoSel.addEventListener("change", refrescarCats);

  $(container, "#caja-form").addEventListener("submit", (e) => agregar(e, container));
  container.querySelectorAll(".caja-del").forEach((b) => b.addEventListener("click", () => eliminar(container, b.dataset.id)));
}

// Los movimientos que genera una venta (cierre de caja / salida del turno) no se borran:
// para corregirlos un ADMIN reabre el turno en Ventas.
const ETIQUETA_ORIGEN = { cierre_turno: "Cierre de caja", turno: "Salida del turno" };

// Ingresos de ventas cargados a mano el mismo día que hay un cierre automático: posible doble carga.
function avisoDuplicado(delDia) {
  const hayCierre = delDia.some((m) => m.origen === "cierre_turno");
  const manualVentas = delDia.filter((m) => (m.origen || "manual") === "manual" && m.tipo === "ingreso" && /^ventas/i.test(m.categoria || ""));
  if (!hayCierre || !manualVentas.length) return "";
  return `<div class="card" style="border-color:#fed7aa;background:#fff7ed;"><b>Posible duplicado:</b> este día tiene un cierre de caja automático y además
    ${manualVentas.length} ingreso(s) de ventas cargado(s) a mano. Revisá que no estés contando dos veces.</div>`;
}

function tablaMov(movs) {
  if (!movs.length) return "<p class='muted'>Sin movimientos.</p>";
  const filas = movs.map((m) => `<tr>
    <td>${escapar(m.categoria || "—")}${ETIQUETA_ORIGEN[m.origen] ? ` <span class="rrhh-pill">${ETIQUETA_ORIGEN[m.origen]}</span>` : ""}<div class="muted" style="font-size:11px;">${escapar(labelMedio(m.medio))}${m.nota ? " · " + escapar(m.nota) : ""}</div></td>
    <td class="num">${formatearCentavos(m.monto_centavos)}</td>
    <td style="text-align:right;">${(m.origen || "manual") === "manual" ? `<button class="btn-baja caja-del" data-id="${m.id}">✕</button>` : ""}</td>
  </tr>`).join("");
  return `<div class="tabla-scroll"><table><tbody>${filas}</tbody></table></div>`;
}

function tabla7dias(movimientos) {
  const dias = [];
  for (let i = 0; i < 7; i++) dias.push(addDias(dia, -i));
  const filas = dias.map((f) => {
    const md = movimientos.filter((m) => m.fecha === f);
    const ing = sum(md.filter((m) => m.tipo === "ingreso"));
    const egr = sum(md.filter((m) => m.tipo === "egreso"));
    const bal = ing - egr;
    return `<tr>
      <td style="text-transform:capitalize;">${escapar(new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short" }).format(new Date(f + "T00:00:00")))}</td>
      <td class="num" style="color:var(--ok);">${formatearCentavos(ing)}</td>
      <td class="num" style="color:var(--error);">${formatearCentavos(egr)}</td>
      <td class="num" style="font-weight:600;color:${bal >= 0 ? "var(--ok)" : "var(--error)"};">${formatearCentavos(bal)}</td>
    </tr>`;
  }).join("");
  return `<div class="tabla-scroll"><table>
    <thead><tr><th>Día</th><th class="num">Ingresos</th><th class="num">Egresos</th><th class="num">Balance</th></tr></thead>
    <tbody>${filas}</tbody></table></div>`;
}

async function agregar(e, container) {
  e.preventDefault();
  const msg = $(container, "#caja-msg");
  const monto = pesosACentavos($(container, "#caja-monto").value);
  if (monto <= 0) { setMsg(msg, "Ingresá un monto mayor a cero.", "error"); return; }
  const tipo = $(container, "#caja-tipo").value;
  const categoria = $(container, "#caja-cat").value.trim();
  setMsg(msg, "Guardando…");
  try {
    if (categoria) await catalogos.asegurar(PERFIL.empresa_id, tipo === "egreso" ? "cat_egreso" : "cat_ingreso", categoria);
    await cajaRepo.crear(PERFIL.empresa_id, {
      fecha: dia, tipo, categoria, medio: $(container, "#caja-medio").value,
      monto_centavos: monto, nota: $(container, "#caja-nota").value,
    });
    await cargar(container);
  } catch (err) {
    setMsg(msg, "No se pudo guardar: " + (err.message || err), "error");
  }
}

async function eliminar(container, id) {
  if (!(await confirmar({ titulo: "Eliminar movimiento", mensaje: "¿Eliminar este movimiento de caja?", textoOk: "Eliminar", peligro: true }))) return;
  try { await cajaRepo.eliminar(id); await cargar(container); toast("Movimiento eliminado"); }
  catch (err) { toast("Error: " + (err.message || err), "error"); }
}
