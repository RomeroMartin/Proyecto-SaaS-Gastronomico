// ============================================================
// saas/ui/pagos.js — Pagos y cuenta corriente por proveedor
// ------------------------------------------------------------
// Registro (FIFO/manual) y anulación por contraasiento vía RPC.
// Muestra saldo, facturas pendientes e historial de pagos.
// ============================================================

import * as pagosRepo from "../data/pagosRepo.js";
import * as facturasRepo from "../data/facturasRepo.js";
import * as proveedoresRepo from "../data/proveedoresRepo.js";
import { pesosACentavos, formatearCentavos } from "../../core/dinero.js";
import { escapar, setMsg, labelInfo, toast, confirmar, abrirModal, cerrarModal } from "./helpers.js";

let PROVEEDORES = [];
let provSel = null;
let PAGOS = [];
let provMap = {};

const hoy = () => new Date().toISOString().slice(0, 10);
const $ = (c, s) => c.querySelector(s);

const METODOS = [
  ["transferencia", "Transferencia"], ["efectivo", "Efectivo"],
  ["cheque", "Cheque"], ["echeq", "e-Cheq"], ["otro", "Otro"],
];

const fmtFecha = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");

export async function montar(container, perfil) {
  container.innerHTML = `
    <div class="card">
      <div class="topbar">
        <h2 style="margin:0;">Pagos a proveedores</h2>
        <button id="pag-nuevo">+ Registrar pago</button>
      </div>
      <div class="toolbar" style="margin-top:12px;">
        <select id="pag-fprov"><option value="">Todos los proveedores</option></select>
        <select id="pag-fmetodo"><option value="">Todos los métodos</option>${METODOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        <select id="pag-festado">
          <option value="">Todos los estados</option><option value="activo">Activos</option><option value="anulado">Anulados</option>
        </select>
        <label style="margin:0;display:flex;align-items:center;gap:4px;">Desde <input id="pag-desde" type="date" /></label>
        <label style="margin:0;display:flex;align-items:center;gap:4px;">Hasta <input id="pag-hasta" type="date" /></label>
        <select id="pag-orden">
          <option value="fecha-desc">Más recientes primero</option>
          <option value="fecha-asc">Más antiguos primero</option>
          <option value="monto-desc">Mayor monto</option>
          <option value="monto-asc">Menor monto</option>
        </select>
        <span class="cuenta" id="pag-cuenta"></span>
      </div>
      <div id="pag-lista" class="tabla-scroll"><p class="muted">Cargando…</p></div>
    </div>`;

  try {
    PROVEEDORES = await proveedoresRepo.listar();
    provMap = Object.fromEntries(PROVEEDORES.map((p) => [p.id, p]));
  } catch (err) {
    $(container, "#pag-lista").innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`;
    return;
  }
  $(container, "#pag-fprov").innerHTML += PROVEEDORES.map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("");
  ["#pag-fprov", "#pag-fmetodo", "#pag-festado", "#pag-desde", "#pag-hasta", "#pag-orden"].forEach((s) =>
    $(container, s).addEventListener("input", () => dibujarLista(container)));
  $(container, "#pag-nuevo").addEventListener("click", () => abrirNuevo(container));
  await refrescarLista(container);
}

async function refrescarLista(container) {
  try {
    PAGOS = await pagosRepo.listarTodos();
  } catch (err) {
    $(container, "#pag-lista").innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`;
    return;
  }
  dibujarLista(container);
}

function dibujarLista(container) {
  const cont = $(container, "#pag-lista");
  const prov = $(container, "#pag-fprov").value;
  const metodo = $(container, "#pag-fmetodo").value;
  const estado = $(container, "#pag-festado").value;
  const desde = $(container, "#pag-desde").value;
  const hasta = $(container, "#pag-hasta").value;
  const [campo, sentido] = $(container, "#pag-orden").value.split("-");
  const dir = sentido === "asc" ? 1 : -1;

  const lista = PAGOS.filter((p) => {
    if (prov && p.proveedor_id !== prov) return false;
    if (metodo && p.metodo_pago !== metodo) return false;
    if (estado && p.estado !== estado) return false;
    const fp = String(p.fecha_pago || "").slice(0, 10);
    if (desde && fp < desde) return false;
    if (hasta && fp > hasta) return false;
    return true;
  });
  const clave = campo === "monto" ? (p) => Number(p.monto_pagado_centavos) || 0 : (p) => String(p.fecha_pago || "");
  lista.sort((a, b) => { const x = clave(a), y = clave(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });

  $(container, "#pag-cuenta").textContent = `${lista.length} de ${PAGOS.length}`;
  if (!PAGOS.length) { cont.innerHTML = "<p class='muted'>Todavía no hay pagos. Registrá el primero con “+ Registrar pago”.</p>"; return; }
  if (!lista.length) { cont.innerHTML = "<p class='muted'>No hay pagos que coincidan con los filtros.</p>"; return; }

  const total = lista.filter((p) => p.estado === "activo").reduce((a, p) => a + (Number(p.monto_pagado_centavos) || 0), 0);
  const filas = lista.map((p) => {
    const anulable = p.estado === "activo" && (p.monto_pagado_centavos || 0) > 0;
    const pr = provMap[p.proveedor_id];
    return `<tr>
      <td>${fmtFecha(p.fecha_pago)}</td>
      <td>${escapar(pr ? pr.nombre : "—")}</td>
      <td class="num">${formatearCentavos(p.monto_pagado_centavos)}</td>
      <td>${escapar(p.metodo_pago)}</td>
      <td>${escapar(p.referencia || "")}</td>
      <td><span style="color:${p.estado === "anulado" ? "var(--muted)" : "var(--ok)"}">${escapar(p.estado)}</span></td>
      <td style="text-align:right;">${anulable ? `<button class="btn-baja btn-anular" data-id="${p.id}">Anular</button>` : ""}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<table>
    <thead><tr><th>Fecha</th><th>Proveedor</th><th class="num">Monto</th><th>Método</th><th>Ref.</th><th>Estado</th><th></th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr><td colspan="2">Total pagado (sin anulados)</td><td class="num">${formatearCentavos(total)}</td><td colspan="4"></td></tr></tfoot></table>`;
  cont.querySelectorAll(".btn-anular").forEach((b) => b.addEventListener("click", () => anular(container, b.dataset.id)));
}

// ---------- registrar pago (modal) ----------
function abrirNuevo(container) {
  if (!PROVEEDORES.length) { toast("Primero cargá un proveedor.", "error"); return; }
  const body = abrirModal("Registrar pago", { ancho: "lg" });
  const metodoOpts = METODOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  body.innerHTML = `
    <form id="form-pago">
      <div>${labelInfo("pag-prov", "Proveedor *", "A quién le pagás.")}
        <select id="pag-prov" required><option value="">— elegí un proveedor —</option>${PROVEEDORES.map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("")}</select></div>
      <p id="pag-deuda" class="muted" style="margin:8px 0 0;"></p>
      <div id="pag-pendientes" class="tabla-scroll" style="max-height:200px;overflow-y:auto;"></div>
      <div class="fila">
        <div>${labelInfo("pag-monto", "Monto ($)", "Cuánto pagás. Se imputa a las facturas pendientes según el modo elegido.")}
          <input id="pag-monto" placeholder="0,00" /></div>
        <div>${labelInfo("pag-metodo", "Método", "Cómo se paga.")}
          <select id="pag-metodo">${metodoOpts}</select></div>
        <div>${labelInfo("pag-fecha", "Fecha", "Fecha del pago.")}
          <input id="pag-fecha" type="date" value="${hoy()}" /></div>
      </div>
      <div class="fila">
        <div style="flex:2;">${labelInfo("pag-ref", "Referencia", "Nº de transferencia, cheque, etc. (opcional).")}
          <input id="pag-ref" placeholder="Opcional" /></div>
        <div>${labelInfo("pag-modo", "Imputación", "FIFO: paga primero las facturas más viejas. Manual: elegís cuáles con los tildes de arriba.")}
          <select id="pag-modo"><option value="fifo">FIFO (más antiguas primero)</option><option value="manual">Manual (tildadas)</option></select></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;"><button type="submit">Registrar pago</button>
        <button type="button" id="pag-cancelar" class="secundario">Cancelar</button></div>
      <p id="pag-msg" class="msg" hidden></p>
    </form>`;

  $(body, "#pag-prov").addEventListener("change", async () => {
    provSel = PROVEEDORES.find((p) => p.id === $(body, "#pag-prov").value) || null;
    $(body, "#pag-deuda").innerHTML = provSel ? `Deuda actual: <strong>${formatearCentavos(provSel.saldo_total_deuda_centavos || 0)}</strong>` : "";
    if (!provSel) { $(body, "#pag-pendientes").innerHTML = ""; return; }
    await refrescarPendientes(body);
  });
  $(body, "#pag-cancelar").addEventListener("click", cerrarModal);
  $(body, "#form-pago").addEventListener("submit", (e) => registrar(e, body, container));
  $(body, "#pag-prov").focus();
}

async function refrescarPendientes(container) {
  const cont = $(container, "#pag-pendientes");
  cont.innerHTML = "<p class='muted'>Cargando…</p>";
  try {
    const facturas = await facturasRepo.pendientes(provSel.id);
    if (!facturas.length) { cont.innerHTML = "<p class='muted'>No hay facturas pendientes 🎉</p>"; return; }
    const filas = facturas.map((f) => `
      <tr>
        <td><input type="checkbox" class="pag-check" value="${f.id}" style="width:auto;" /></td>
        <td>${escapar(f.numero_factura || "—")}</td>
        <td>${fmtFecha(f.fecha_emision)}</td>
        <td class="num">${formatearCentavos(f.monto_total_centavos)}</td>
        <td class="num">${formatearCentavos(f.saldo_pendiente_centavos)}</td>
      </tr>`).join("");
    cont.innerHTML = `<h3 class="muted" style="margin:10px 0 0;">Facturas pendientes</h3><table>
      <thead><tr><th></th><th>Número</th><th>Emisión</th><th class="num">Total</th><th class="num">Saldo</th></tr></thead>
      <tbody>${filas}</tbody></table>
      <p class="muted" style="margin-top:6px;">Tildá facturas y elegí "Manual" para imputar a esas; si no, se usa FIFO.</p>`;
  } catch (err) {
    cont.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`;
  }
}

async function registrar(e, body, lista) {
  e.preventDefault();
  const msg = $(body, "#pag-msg");
  if (!provSel) { setMsg(msg, "Elegí el proveedor.", "error"); return; }
  const monto = pesosACentavos($(body, "#pag-monto").value);
  if (monto <= 0) { setMsg(msg, "Ingresá un monto mayor a cero.", "error"); return; }

  const modo = $(body, "#pag-modo").value;
  const facturaIds = [...body.querySelectorAll(".pag-check:checked")].map((c) => c.value);
  if (modo === "manual" && !facturaIds.length) {
    setMsg(msg, "En modo manual, tildá al menos una factura.", "error"); return;
  }

  setMsg(msg, "Registrando…");
  try {
    await pagosRepo.registrar({
      proveedorId: provSel.id,
      montoCentavos: monto,
      metodoPago: $(body, "#pag-metodo").value,
      referencia: $(body, "#pag-ref").value,
      fechaPago: $(body, "#pag-fecha").value || hoy(),
      modoImputacion: modo,
      facturaIds,
    });
    cerrarModal();
    toast("Pago registrado ✔");
    await recargar(lista);
  } catch (err) {
    setMsg(msg, "No se pudo registrar: " + (err.message || err), "error");
  }
}

/** Recarga proveedores (saldos frescos) y la lista de pagos. */
async function recargar(container) {
  try {
    PROVEEDORES = await proveedoresRepo.listar();
    provMap = Object.fromEntries(PROVEEDORES.map((p) => [p.id, p]));
  } catch (_e) {}
  await refrescarLista(container);
}

async function anular(container, pagoId) {
  const ok = await confirmar({ titulo: "Anular pago", mensaje: "Se revierten las imputaciones y el saldo. El pago queda anulado (no se borra).", textoOk: "Anular", peligro: true });
  if (!ok) return;
  try {
    await pagosRepo.anular(pagoId);
    toast("Pago anulado ✔");
    await recargar(container);
  } catch (err) {
    toast("Error: " + (err.message || err), "error");
  }
}
