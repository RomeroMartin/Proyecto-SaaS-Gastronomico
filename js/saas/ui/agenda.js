// ============================================================
// saas/ui/agenda.js — Agenda de pagos y flujo de caja
// ------------------------------------------------------------
// Administración planifica los pagos futuros (proveedor, monto, método, fecha)
// y ve cuánto EFECTIVO y cuánto EN CUENTA necesita cada día. Es planificación:
// no toca la cuenta corriente (eso se hace en el módulo Pagos).
// ============================================================

import * as agendaRepo from "../data/pagosProgramadosRepo.js";
import * as proveedoresRepo from "../data/proveedoresRepo.js";
import { pesosACentavos, formatearCentavos } from "../../core/dinero.js";
import { hoyISO, addDias } from "../../core/utilsFecha.js";
import { escapar, setMsg, labelInfo, kpiHTML, toast, confirmar } from "./helpers.js";

const LABEL_METODO = { efectivo: "Efectivo", transferencia: "Transferencia", cheque: "Cheque", echeq: "e-Cheq", otro: "Otro" };

let PERFIL = null;
let PROVEEDORES = [];
let provMap = {};
let PROGRAMADOS = [];
let rangoDias = 7;

const $ = (c, s) => c.querySelector(s);

function fondoDe(metodo) { return metodo === "efectivo" || metodo === "otro" ? "efectivo" : "cuenta"; }
function nombreProv(id) { return (provMap[id] && provMap[id].nombre) || "—"; }
function etiquetaFecha(str) {
  const hoy = hoyISO();
  if (str === hoy) return "Hoy";
  if (str === addDias(hoy, 1)) return "Mañana";
  const d = new Date(str + "T00:00:00");
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "short" }).format(d);
}

export async function montar(container, perfil) {
  PERFIL = perfil;
  await cargar(container);
}

async function cargar(container) {
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  try {
    [PROVEEDORES, PROGRAMADOS] = await Promise.all([proveedoresRepo.listar(), agendaRepo.listar()]);
    provMap = Object.fromEntries(PROVEEDORES.map((p) => [p.id, p]));
    render(container);
  } catch (err) {
    container.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}
      <br><span class="muted">¿Corriste supabase/pagos_programados.sql?</span></p>`;
  }
}

function render(container) {
  const hoy = hoyISO();
  const limite = addDias(hoy, rangoDias);
  const pend = PROGRAMADOS.filter((p) => p.estado === "pendiente");

  const vencidos = pend.filter((p) => p.fecha_programada < hoy);
  const enRango = pend.filter((p) => p.fecha_programada >= hoy && p.fecha_programada <= limite);
  const sum = (arr) => arr.reduce((a, p) => a + (Number(p.monto_centavos) || 0), 0);
  const totHoy = sum(pend.filter((p) => p.fecha_programada === hoy));
  const totManana = sum(pend.filter((p) => p.fecha_programada === addDias(hoy, 1)));

  const aCubrir = [...vencidos, ...enRango];
  const efectivo = sum(aCubrir.filter((p) => fondoDe(p.metodo_pago) === "efectivo"));
  const cuenta = sum(aCubrir.filter((p) => fondoDe(p.metodo_pago) === "cuenta"));

  const provOpts = PROVEEDORES.map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("");
  const metodoOpts = Object.entries(LABEL_METODO).map(([v, l]) => `<option value="${v}">${l}</option>`).join("");

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;">
      <h2 style="margin:0;">Agenda de pagos</h2>
      <select id="ag-rango" style="width:auto;">
        <option value="7">Próximos 7 días</option>
        <option value="15">Próximos 15 días</option>
        <option value="30">Próximos 30 días</option>
        <option value="90">Próximos 90 días</option>
      </select>
    </div>

    <div class="kpi-grid">
      ${kpiHTML("Vencido", formatearCentavos(sum(vencidos)), `${vencidos.length} pago(s)`, vencidos.length ? "danger" : "ok",
        "Pagos agendados con fecha anterior a hoy que siguen pendientes. Hay que regularizarlos.")}
      ${kpiHTML("Hoy", formatearCentavos(totHoy), "", "warn",
        "Total de pagos agendados para el día de hoy.")}
      ${kpiHTML("Mañana", formatearCentavos(totManana), "", "",
        "Total de pagos agendados para mañana. Sirve para tener la plata lista.")}
      ${kpiHTML("Total a cubrir", formatearCentavos(sum(aCubrir)), `vencido + ${rangoDias} días`, "",
        "Suma de lo vencido más lo agendado en el rango elegido. Es la caja total que necesitás.")}
    </div>

    <div class="card" style="display:flex;gap:24px;flex-wrap:wrap;">
      <div>${labelInfo("", "Efectivo necesario", "Suma (vencido + rango) de pagos en efectivo/otros. Es la plata en mano que hay que tener.")}
        <div style="font-size:20px;font-weight:700;">${formatearCentavos(efectivo)}</div></div>
      <div>${labelInfo("", "En cuenta necesario", "Suma (vencido + rango) de transferencias, cheques y e-Cheq. Es el saldo bancario que hay que tener.")}
        <div style="font-size:20px;font-weight:700;">${formatearCentavos(cuenta)}</div></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0;">Agendar un pago</h2>
      <form id="ag-form">
        <div class="fila">
          <div style="flex:2;">${labelInfo("ag-prov", "Proveedor", "A quién le vas a pagar.")}
            <select id="ag-prov"><option value="">— elegí —</option>${provOpts}</select></div>
          <div>${labelInfo("ag-fecha", "Fecha del pago", "Qué día planeás pagarlo.")}
            <input id="ag-fecha" type="date" value="${addDias(hoy, 1)}" /></div>
        </div>
        <div class="fila">
          <div>${labelInfo("ag-monto", "Monto ($)", "Cuánto vas a pagar.")}<input id="ag-monto" placeholder="0,00" /></div>
          <div>${labelInfo("ag-metodo", "Cómo vas a pagar", "Efectivo cuenta como plata en mano; transferencia/cheque/e-Cheq como dinero en cuenta.")}
            <select id="ag-metodo">${metodoOpts}</select></div>
          <div style="flex:2;">${labelInfo("ag-nota", "Nota", "Detalle opcional (nº de factura, aclaración…).")}<input id="ag-nota" placeholder="Opcional" /></div>
        </div>
        <div style="margin-top:14px;"><button type="submit">Agendar pago</button></div>
        <p id="ag-msg" class="msg" hidden></p>
      </form>
    </div>

    <div id="ag-lista"></div>`;

  $(container, "#ag-rango").value = String(rangoDias);
  $(container, "#ag-rango").addEventListener("change", (e) => { rangoDias = Number(e.target.value) || 7; render(container); });
  $(container, "#ag-form").addEventListener("submit", (e) => agendar(e, container));

  renderLista(container, vencidos, enRango, hoy, limite);
}

function renderLista(container, vencidos, enRango, hoy, limite) {
  const cont = $(container, "#ag-lista");
  const bloques = [];

  if (vencidos.length) bloques.push(bloqueDia(container, "⚠ Atrasados", vencidos, true));

  // Agrupar enRango por fecha.
  const porFecha = {};
  for (const p of enRango) (porFecha[p.fecha_programada] ||= []).push(p);
  const fechas = Object.keys(porFecha).sort();
  for (const f of fechas) bloques.push(bloqueDia(container, etiquetaFecha(f), porFecha[f], false));

  if (!bloques.length) {
    cont.innerHTML = `<div class="card"><p class="muted">No hay pagos agendados en este rango. Agendá el primero 👆</p></div>`;
    return;
  }
  cont.innerHTML = bloques.join("");

  cont.querySelectorAll(".ag-pagado").forEach((b) => b.addEventListener("click", () => cambiarEstado(container, b.dataset.id, "pagado")));
  cont.querySelectorAll(".ag-cancelar").forEach((b) => b.addEventListener("click", () => cambiarEstado(container, b.dataset.id, "cancelado")));
}

function bloqueDia(container, titulo, pagos, esAtrasado) {
  const sum = (arr) => arr.reduce((a, p) => a + (Number(p.monto_centavos) || 0), 0);
  const efec = sum(pagos.filter((p) => fondoDe(p.metodo_pago) === "efectivo"));
  const cta = sum(pagos.filter((p) => fondoDe(p.metodo_pago) === "cuenta"));
  const total = sum(pagos);

  const filas = pagos.map((p) => `<tr>
      <td>${escapar(nombreProv(p.proveedor_id))}${p.nota ? `<div class="muted" style="font-size:11.5px;">${escapar(p.nota)}</div>` : ""}</td>
      <td>${escapar(LABEL_METODO[p.metodo_pago] || p.metodo_pago)}</td>
      <td class="num">${formatearCentavos(p.monto_centavos)}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="secundario ag-pagado" data-id="${p.id}">Pagado</button>
        <button class="btn-baja ag-cancelar" data-id="${p.id}">Quitar</button>
      </td>
    </tr>`).join("");

  return `<div class="card">
    <div class="topbar" style="margin-bottom:4px;">
      <h3 style="margin:0;text-transform:capitalize;${esAtrasado ? "color:var(--error);" : ""}">${escapar(titulo)}</h3>
      <div class="muted" style="font-size:12.5px;">
        Efectivo ${formatearCentavos(efec)} · En cuenta ${formatearCentavos(cta)} · <strong>Total ${formatearCentavos(total)}</strong>
      </div>
    </div>
    <div class="tabla-scroll"><table>
      <thead><tr><th>Proveedor</th><th>Método</th><th class="num">Monto</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div>
  </div>`;
}

async function agendar(e, container) {
  e.preventDefault();
  const msg = $(container, "#ag-msg");
  const monto = pesosACentavos($(container, "#ag-monto").value);
  const fecha = $(container, "#ag-fecha").value;
  const prov = $(container, "#ag-prov").value;
  if (!prov) { setMsg(msg, "Elegí un proveedor.", "error"); return; }
  if (!fecha) { setMsg(msg, "Elegí la fecha del pago.", "error"); return; }
  if (monto <= 0) { setMsg(msg, "Ingresá un monto mayor a cero.", "error"); return; }

  setMsg(msg, "Agendando…");
  try {
    await agendaRepo.crear(PERFIL.empresa_id, {
      proveedor_id: prov,
      fecha_programada: fecha,
      monto_centavos: monto,
      metodo_pago: $(container, "#ag-metodo").value,
      nota: $(container, "#ag-nota").value,
    });
    await cargar(container);
  } catch (err) {
    setMsg(msg, "No se pudo agendar: " + (err.message || err), "error");
  }
}

async function cambiarEstado(container, id, estado) {
  const ok = await confirmar(estado === "pagado"
    ? { titulo: "Marcar pagado", mensaje: "¿Marcar este pago como realizado?", textoOk: "Marcar pagado" }
    : { titulo: "Quitar de la agenda", mensaje: "¿Quitar este pago de la agenda?", textoOk: "Quitar", peligro: true });
  if (!ok) return;
  try { await agendaRepo.actualizarEstado(id, estado); await cargar(container); toast(estado === "pagado" ? "Marcado como pagado ✔" : "Quitado de la agenda"); }
  catch (err) { toast("Error: " + (err.message || err), "error"); }
}
