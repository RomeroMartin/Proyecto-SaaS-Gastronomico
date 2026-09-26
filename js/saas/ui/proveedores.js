// ============================================================
// saas/ui/proveedores.js — Proveedores: listado, KPIs, filtros,
// ficha de cuenta corriente (facturas + pagos) y export a Excel.
// La UI no calcula: usa repos y core/.
// ============================================================

import * as proveedoresRepo from "../data/proveedoresRepo.js";
import * as facturasRepo from "../data/facturasRepo.js";
import * as pagosRepo from "../data/pagosRepo.js";
import * as catalogos from "../data/catalogosRepo.js";
import { CONDICIONES_FISCALES, ALICUOTAS_IVA, desglosarFactura } from "../../core/fiscal.js";
import { pesosACentavos, formatearCentavos } from "../../core/dinero.js";
import { exportarExcel } from "../../export/excel.js";
import { escapar, setMsg, labelInfo, datalist, kpiHTML, abrirModal, cerrarModal, toast, confirmar } from "./helpers.js";

const LABEL_COND = { responsable_inscripto: "Resp. Inscripto", monotributo: "Monotributo", exento: "Exento" };
const LABEL_METODO = { efectivo: "Efectivo", transferencia: "Transferencia", cheque: "Cheque", echeq: "e-Cheq", otro: "Otro" };
const SIN_RUBRO = "Sin rubro";
const DIAS_POR_VENCER = 7;
const hoy = () => new Date().toISOString().slice(0, 10);

let PERFIL = null;
let PROVEEDORES = [];
let PENDIENTES = [];
let CONTENEDOR = null;

const saldoDe = (p) => Number(p.saldo_total_deuda_centavos) || 0;
function rubroPrincipalDe(p) {
  if (p.rubro_principal) return p.rubro_principal;
  if (Array.isArray(p.rubros) && p.rubros.length) return p.rubros[0];
  return SIN_RUBRO;
}
function rubrosSecundariosDe(p) {
  const pr = rubroPrincipalDe(p);
  return (Array.isArray(p.rubros) ? p.rubros : []).filter((r) => r && r !== pr);
}
function diasHasta(fechaStr) {
  if (!fechaStr) return null;
  return Math.ceil((new Date(fechaStr + "T12:00:00").getTime() - Date.now()) / 86400000);
}

export async function montar(container, perfil) {
  PERFIL = perfil;
  CONTENEDOR = container;
  await cargar();
}

async function cargar() {
  CONTENEDOR.innerHTML = "<p class='muted'>Cargando…</p>";
  try {
    PROVEEDORES = await proveedoresRepo.listar();
  } catch (err) {
    CONTENEDOR.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`;
    return;
  }
  try { PENDIENTES = await facturasRepo.pendientesGlobal(); } catch (_e) { PENDIENTES = []; }
  render();
}

function render() {
  const totalDeuda = PROVEEDORES.reduce((a, p) => a + saldoDe(p), 0);
  const conDeuda = PROVEEDORES.filter((p) => saldoDe(p) > 0).length;
  const porVencer = PENDIENTES.filter((f) => {
    const d = diasHasta(f.fecha_vencimiento);
    return d !== null && d <= DIAS_POR_VENCER;
  }).length;

  const rubros = [...new Set(PROVEEDORES.map(rubroPrincipalDe))]
    .sort((a, b) => (a === SIN_RUBRO ? 1 : b === SIN_RUBRO ? -1 : a.localeCompare(b)));

  CONTENEDOR.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;">
      <h2 style="margin:0;">Proveedores</h2>
      <button id="prov-nuevo">+ Nuevo proveedor</button>
    </div>

    <div class="kpi-grid">
      ${kpiHTML("Deuda total", formatearCentavos(totalDeuda), `${conDeuda} con deuda`, totalDeuda > 0 ? "danger" : "ok",
        "Suma de todo lo que le debés a tus proveedores (todos los saldos). El subtítulo indica cuántos tienen deuda.")}
      ${kpiHTML("Facturas pendientes", String(PENDIENTES.length), "impagas", "",
        "Cantidad de facturas con saldo (total o parcial). No incluye las pagadas ni las anuladas.")}
      ${kpiHTML("Por vencer", String(porVencer), "en 7 días o menos", porVencer ? "warn" : "ok",
        "Facturas impagas que vencen en 7 días o menos. Incluye las que ya están vencidas.")}
      ${kpiHTML("Proveedores", String(PROVEEDORES.length), "activos", "",
        "Cantidad de proveedores activos cargados.")}
    </div>

    <div class="toolbar">
      <input id="prov-buscar" type="search" placeholder="Buscar por nombre, código o CUIT…" />
      <select id="prov-frubro"><option value="">Todos los rubros</option>${rubros.map((r) => `<option value="${escapar(r)}">${escapar(r)}</option>`).join("")}</select>
      <select id="prov-orden"><option value="desc">Deuda: mayor a menor</option><option value="asc">Deuda: menor a mayor</option></select>
      <button id="prov-limpiar" class="secundario">Limpiar</button>
      <button id="prov-export" class="secundario">Exportar Excel</button>
      <span class="cuenta" id="prov-cuenta"></span>
    </div>

    <div class="card"><div id="prov-tabla" class="tabla-scroll"></div></div>`;

  CONTENEDOR.querySelector("#prov-nuevo").addEventListener("click", () => abrirForm(null));
  CONTENEDOR.querySelector("#prov-limpiar").addEventListener("click", () => {
    CONTENEDOR.querySelector("#prov-buscar").value = "";
    CONTENEDOR.querySelector("#prov-frubro").value = "";
    CONTENEDOR.querySelector("#prov-orden").value = "desc";
    dibujar();
  });
  CONTENEDOR.querySelector("#prov-export").addEventListener("click", exportar);
  ["#prov-buscar", "#prov-frubro", "#prov-orden"].forEach((s) =>
    CONTENEDOR.querySelector(s).addEventListener("input", dibujar));
  dibujar();
}

function dibujar() {
  const f = (CONTENEDOR.querySelector("#prov-buscar").value || "").toLowerCase().trim();
  const rub = CONTENEDOR.querySelector("#prov-frubro").value;
  const dir = CONTENEDOR.querySelector("#prov-orden").value === "asc" ? 1 : -1;

  let filtrados = PROVEEDORES.filter((p) => {
    if (f && !((p.nombre || "").toLowerCase().includes(f) || (p.codigo || "").toLowerCase().includes(f) || (p.cuit || "").includes(f))) return false;
    if (rub && rubroPrincipalDe(p) !== rub) return false;
    return true;
  });
  CONTENEDOR.querySelector("#prov-cuenta").textContent = `${filtrados.length} de ${PROVEEDORES.length}`;

  const rk = (p) => { const r = rubroPrincipalDe(p); return r === SIN_RUBRO ? "￿" : r.toLowerCase(); };
  filtrados.sort((a, b) => rk(a).localeCompare(rk(b)) || (saldoDe(a) - saldoDe(b)) * dir);

  const cont = CONTENEDOR.querySelector("#prov-tabla");
  if (!PROVEEDORES.length) { cont.innerHTML = "<p class='muted'>Todavía no hay proveedores. Cargá el primero.</p>"; return; }
  if (!filtrados.length) { cont.innerHTML = "<p class='muted'>No hay proveedores que coincidan.</p>"; return; }

  const filas = filtrados.map((p) => {
    const saldo = saldoDe(p);
    const sec = rubrosSecundariosDe(p);
    return `<tr>
      <td style="color:var(--muted);">${escapar(rubroPrincipalDe(p))}</td>
      <td>
        <div>${escapar(p.nombre)}</div>
        <div class="muted" style="font-size:12px;">${escapar(p.codigo || "")}${p.cuit ? " · " + escapar(p.cuit) : ""}</div>
        <div class="muted" style="font-size:11.5px;">${rubroPrincipalDe(p) !== SIN_RUBRO ? escapar(rubroPrincipalDe(p)) : ""}${sec.length ? (rubroPrincipalDe(p) !== SIN_RUBRO ? " · también: " : "también: ") + escapar(sec.join(" · ")) : ""}</div>
      </td>
      <td class="num" style="color:${saldo > 0 ? "var(--error)" : saldo < 0 ? "var(--ok)" : "var(--muted)"};font-weight:600;">${formatearCentavos(saldo)}</td>
      <td style="white-space:nowrap;text-align:right;">
        <button class="secundario prov-ficha" data-id="${p.id}">Ver ficha</button>
        <button class="secundario prov-editar" data-id="${p.id}">Editar</button>
      </td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<table>
    <thead><tr><th>Rubro</th><th>Proveedor</th><th class="num">Saldo</th><th></th></tr></thead>
    <tbody>${filas}</tbody></table>`;
  cont.querySelectorAll(".prov-ficha").forEach((b) => b.addEventListener("click", () => abrirFicha(b.dataset.id)));
  cont.querySelectorAll(".prov-editar").forEach((b) => b.addEventListener("click", () => {
    abrirForm(PROVEEDORES.find((p) => p.id === b.dataset.id));
  }));
}

function exportar() {
  try {
    const filas = PROVEEDORES.map((p) => ({
      Rubro: rubroPrincipalDe(p),
      "Rubros secundarios": rubrosSecundariosDe(p).join(" · "),
      Codigo: p.codigo || "", Proveedor: p.nombre, CUIT: p.cuit || "",
      "Condicion fiscal": LABEL_COND[p.condicion_fiscal] || p.condicion_fiscal,
      Contacto: p.contacto || "", Telefono: p.telefono || "", Email: p.email || "",
      "Saldo deuda ($)": saldoDe(p) / 100,
    }));
    filas.sort((a, b) => (a.Rubro || "~").localeCompare(b.Rubro || "~") || b["Saldo deuda ($)"] - a["Saldo deuda ($)"]);
    exportarExcel(filas, "deuda-proveedores", "Deuda");
  } catch (e) { toast(e.message || "No se pudo exportar.", "error"); }
}

// ---------- alta / edición ----------
function abrirForm(prov) {
  const editar = !!prov;
  const cond = CONDICIONES_FISCALES.map((c) =>
    `<option value="${c}" ${prov && prov.condicion_fiscal === c ? "selected" : ""}>${LABEL_COND[c]}</option>`).join("");
  const body = abrirModal(editar ? "Editar proveedor" : "Nuevo proveedor");
  body.innerHTML = `
    <form id="pform">
      <div>${labelInfo("pf-nombre", "Nombre *", "Razón social o nombre del proveedor.")}<input id="pf-nombre" value="${escapar(prov?.nombre || "")}" required /></div>
      <div class="fila">
        <div>${labelInfo("pf-cuit", "CUIT", "Opcional. Ej: 30-12345678-9.")}<input id="pf-cuit" value="${escapar(prov?.cuit || "")}" /></div>
        <div>${labelInfo("pf-cond", "Condición fiscal", "Define si el IVA se puede tomar como crédito fiscal.")}<select id="pf-cond">${cond}</select></div>
      </div>
      <div class="fila">
        <div>${labelInfo("pf-contacto", "Contacto", "Nombre de la persona de contacto (opcional).")}<input id="pf-contacto" value="${escapar(prov?.contacto || "")}" /></div>
        <div>${labelInfo("pf-tel", "Teléfono", "Opcional.")}<input id="pf-tel" value="${escapar(prov?.telefono || "")}" /></div>
      </div>
      <div>${labelInfo("pf-email", "Email", "Opcional.")}<input id="pf-email" type="email" value="${escapar(prov?.email || "")}" /></div>

      <div style="margin-top:6px;">${labelInfo("pf-rubro-add", "Rubros", "Qué te vende. Agregá uno o varios. El principal se usa para agrupar y registrar la deuda.")}
        <div class="fila" style="align-items:stretch;">
          <input id="pf-rubro-add" list="dl-rubro-form" placeholder="Elegí o escribí y agregá…" style="flex:2;" />
          <button type="button" id="pf-rubro-btn" class="secundario" style="flex:0 0 auto;">Agregar</button>
        </div>
        <div class="chips" id="pf-chips"></div>
      </div>
      <div style="margin-top:8px;">${labelInfo("pf-principal", "Rubro principal", "Con este rubro se agrupa el proveedor.")}<select id="pf-principal"></select></div>

      <div style="margin-top:16px;display:flex;gap:8px;">
        <button type="submit">${editar ? "Guardar" : "Crear"}</button>
        <button type="button" id="pf-cancelar" class="secundario">Cancelar</button>
      </div>
      <p id="pf-msg" class="msg" hidden></p>
    </form>
    ${datalist("dl-rubro-form", catalogos.opciones("rubro"))}`;

  const rubrosSel = new Set(Array.isArray(prov?.rubros) ? prov.rubros : (prov?.rubro_principal ? [prov.rubro_principal] : []));
  const principalActual = prov?.rubro_principal || "";

  function pintarRubros() {
    const chips = body.querySelector("#pf-chips");
    chips.innerHTML = [...rubrosSel].map((r) =>
      `<span class="chip">${escapar(r)}<button type="button" data-r="${escapar(r)}">✕</button></span>`).join("");
    chips.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { rubrosSel.delete(b.dataset.r); pintarRubros(); }));
    const sel = body.querySelector("#pf-principal");
    const arr = [...rubrosSel];
    const prev = sel.value;
    sel.innerHTML = arr.length ? arr.map((r) => `<option value="${escapar(r)}">${escapar(r)}</option>`).join("")
      : `<option value="">— agregá un rubro —</option>`;
    const target = arr.includes(prev) ? prev : (arr.includes(principalActual) ? principalActual : arr[0] || "");
    if (target) sel.value = target;
  }
  pintarRubros();

  const agregarRubro = () => {
    const inp = body.querySelector("#pf-rubro-add");
    const v = inp.value.trim();
    if (v) { rubrosSel.add(v); inp.value = ""; pintarRubros(); }
  };
  body.querySelector("#pf-rubro-btn").addEventListener("click", agregarRubro);
  body.querySelector("#pf-rubro-add").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); agregarRubro(); } });
  body.querySelector("#pf-cancelar").addEventListener("click", cerrarModal);

  body.querySelector("#pform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = body.querySelector("#pf-msg");
    const nombre = body.querySelector("#pf-nombre").value.trim();
    if (!nombre) { setMsg(msg, "El nombre es obligatorio.", "error"); return; }
    const rubros = [...rubrosSel];
    const rubro_principal = body.querySelector("#pf-principal").value || rubros[0] || "";
    const datos = {
      nombre,
      cuit: body.querySelector("#pf-cuit").value,
      condicion_fiscal: body.querySelector("#pf-cond").value,
      contacto: body.querySelector("#pf-contacto").value,
      telefono: body.querySelector("#pf-tel").value,
      email: body.querySelector("#pf-email").value,
      rubros, rubro_principal,
    };
    setMsg(msg, "Guardando…");
    try {
      for (const r of rubros) await catalogos.asegurar(PERFIL.empresa_id, "rubro", r);
      if (editar) await proveedoresRepo.actualizar(prov.id, datos);
      else await proveedoresRepo.crear(PERFIL.empresa_id, datos);
      cerrarModal();
      await cargar();
    } catch (err) {
      setMsg(msg, "No se pudo guardar: " + (err.message || err), "error");
    }
  });
}

// ---------- ficha de cuenta corriente ----------
async function abrirFicha(id) {
  const body = abrirModal("Cuenta corriente", { ancho: "lg" });
  body.innerHTML = "<p class='muted'>Cargando…</p>";
  await pintarFicha(body, id);
}

async function pintarFicha(body, id) {
  const [prov, facturas, pagos] = await Promise.all([
    proveedoresRepo.obtener(id),
    facturasRepo.listarPorProveedor(id),
    pagosRepo.listarPorProveedor(id),
  ]);
  if (!prov) { body.innerHTML = "<p class='error'>Proveedor no encontrado.</p>"; return; }

  const saldo = saldoDe(prov);
  const totalFacturado = facturas.filter((f) => f.estado !== "anulada").reduce((a, f) => a + (Number(f.monto_total_centavos) || 0), 0);
  const totalPagado = pagos.filter((p) => p.estado === "activo").reduce((a, p) => a + (Number(p.monto_pagado_centavos) || 0), 0);
  const sec = rubrosSecundariosDe(prov);

  const filasFac = facturas.length ? facturas.map((f) => `<tr>
      <td>${escapar(f.fecha_emision)}<div class="muted" style="font-size:11px;">${escapar(f.estado)}</div></td>
      <td>${escapar(f.tipo_comprobante)} ${escapar(f.numero_factura || "")}</td>
      <td class="num">${formatearCentavos(f.monto_total_centavos)}</td>
      <td class="num">${formatearCentavos(f.saldo_pendiente_centavos)}</td>
    </tr>`).join("") : `<tr><td colspan="4" class="muted">Sin facturas.</td></tr>`;

  const filasPag = pagos.length ? pagos.map((p) => `<tr>
      <td>${escapar(p.fecha_pago)}<div class="muted" style="font-size:11px;">${escapar(p.referencia || "")}</div></td>
      <td>${escapar(LABEL_METODO[p.metodo_pago] || p.metodo_pago)}${p.estado === "anulado" ? ' <span class="muted">(anulado)</span>' : ""}</td>
      <td class="num">${formatearCentavos(p.monto_pagado_centavos)}</td>
      <td style="text-align:right;">${p.estado === "activo" && p.monto_pagado_centavos > 0 ? `<button class="btn-baja ficha-anular" data-id="${p.id}">Anular</button>` : ""}</td>
    </tr>`).join("") : `<tr><td colspan="4" class="muted">Sin pagos.</td></tr>`;

  body.innerHTML = `
    <div class="topbar" style="margin-bottom:12px;">
      <div>
        <div style="font-size:17px;font-weight:700;">${escapar(prov.nombre)}</div>
        <div class="muted" style="font-size:12.5px;">${escapar(LABEL_COND[prov.condicion_fiscal] || prov.condicion_fiscal)}${prov.cuit ? " · " + escapar(prov.cuit) : ""}${rubroPrincipalDe(prov) !== SIN_RUBRO ? " · " + escapar(rubroPrincipalDe(prov)) : ""}${sec.length ? " (también: " + escapar(sec.join(" · ")) + ")" : ""}</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px;color:${saldo > 0 ? "var(--error)" : "var(--ok)"};">Deuda: ${formatearCentavos(saldo)}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="secundario resaltado" id="ficha-factura">Cargar factura</button>
        <button id="ficha-pago">Registrar pago</button>
      </div>
    </div>

    <div class="tabs" id="ficha-tabs">
      <button class="tab activo" data-tab="facturas">Facturas</button>
      <button class="tab" data-tab="pagos">Pagos</button>
      <button class="tab" data-tab="resumen">Debe / Haber</button>
    </div>
    <div id="ficha-tab-content"></div>`;

  const panelFacturas = `
    <div class="tabla-scroll"><table>
      <thead><tr><th>Fecha</th><th>Comprobante</th><th class="num">Total</th><th class="num">Saldo</th></tr></thead>
      <tbody>${filasFac}</tbody>
      <tfoot><tr><td colspan="2">Total facturado</td><td class="num">${formatearCentavos(totalFacturado)}</td><td></td></tr></tfoot>
    </table></div>`;
  const panelPagos = `
    <div class="tabla-scroll"><table>
      <thead><tr><th>Fecha</th><th>Método</th><th class="num">Monto</th><th></th></tr></thead>
      <tbody>${filasPag}</tbody>
      <tfoot><tr><td>Total pagado</td><td></td><td class="num">${formatearCentavos(totalPagado)}</td><td></td></tr></tfoot>
    </table></div>`;
  const panelResumen = `
    <div class="resumen-grid">
      <div class="resumen-box">
        <div class="kpi-t">Debe (total facturado)</div>
        <div class="kpi-v">${formatearCentavos(totalFacturado)}</div>
      </div>
      <div class="resumen-box">
        <div class="kpi-t">Haber (total pagado)</div>
        <div class="kpi-v">${formatearCentavos(totalPagado)}</div>
      </div>
    </div>`;

  function pintarTab(tab) {
    const cont = body.querySelector("#ficha-tab-content");
    cont.innerHTML = tab === "pagos" ? panelPagos : tab === "resumen" ? panelResumen : panelFacturas;
    cont.querySelectorAll(".ficha-anular").forEach((b) => b.addEventListener("click", () => anularPago(b.dataset.id, id)));
  }
  body.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    body.querySelectorAll(".tab").forEach((x) => x.classList.remove("activo"));
    b.classList.add("activo");
    pintarTab(b.dataset.tab);
  }));
  pintarTab("facturas");

  body.querySelector("#ficha-factura").addEventListener("click", () => modalFactura(prov, () => reabrirFicha(id)));
  body.querySelector("#ficha-pago").addEventListener("click", () =>
    modalPago(prov, facturas.filter((f) => (Number(f.saldo_pendiente_centavos) || 0) > 0 && f.estado !== "anulada"), () => reabrirFicha(id)));
}

async function reabrirFicha(id) {
  const body = abrirModal("Cuenta corriente", { ancho: "lg" });
  body.innerHTML = "<p class='muted'>Cargando…</p>";
  await pintarFicha(body, id);
  await cargar(); // refresca KPIs/lista de fondo
}

async function anularPago(pagoId, provId) {
  if (!(await confirmar({ titulo: "Anular pago", mensaje: "Se revierten las imputaciones y el saldo. El pago queda anulado (no se borra).", textoOk: "Anular", peligro: true }))) return;
  try { await pagosRepo.anular(pagoId); await reabrirFicha(provId); toast("Pago anulado ✔"); }
  catch (err) { toast("Error: " + (err.message || err), "error"); }
}

// ---------- modal: cargar factura ----------
function modalFactura(prov, onDone) {
  const body = abrirModal(`Cargar factura — ${prov.nombre}`);
  const ivaOpts = ALICUOTAS_IVA.map((a) => `<option value="${a}" ${a === 21 ? "selected" : ""}>${a}%</option>`).join("");
  body.innerHTML = `
    <form id="ff">
      <div class="fila">
        <div>${labelInfo("ff-tipo", "Comprobante", "A discrimina IVA; B/C no.")}<select id="ff-tipo"><option>A</option><option>B</option><option>C</option></select></div>
        <div>${labelInfo("ff-num", "Número", "Como figura en el papel.")}<input id="ff-num" placeholder="A-0002-000841" /></div>
      </div>
      <div class="fila">
        <div>${labelInfo("ff-emi", "Emisión", "Fecha de emisión.")}<input id="ff-emi" type="date" value="${hoy()}" /></div>
        <div>${labelInfo("ff-venc", "Vencimiento", "Opcional (para alertas).")}<input id="ff-venc" type="date" /></div>
      </div>
      <div class="fila">
        <div>${labelInfo("ff-ali", "Alícuota", "IVA de la factura.")}<select id="ff-ali">${ivaOpts}</select></div>
        <div>${labelInfo("ff-neto", "Neto ($)", "Sin IVA. Se completa solo si cargás el total.")}<input id="ff-neto" placeholder="0,00" /></div>
        <div>${labelInfo("ff-percep", "Percepciones ($)", "IVA/IIBB. Opcional.")}<input id="ff-percep" placeholder="0,00" /></div>
        <div>${labelInfo("ff-otros", "Imp. interno / otros ($)", "Impuesto interno u otros cargos no recuperables (ej. bebidas alcohólicas). Opcional.")}<input id="ff-otros" placeholder="0,00" /></div>
        <div>${labelInfo("ff-total", "Total ($)", "Lo que va a la cuenta corriente.")}<input id="ff-total" placeholder="0,00" /></div>
      </div>
      <p id="ff-desg" class="muted" style="margin-top:8px;"></p>
      <div class="fila"><div style="flex:1;">${labelInfo("ff-obs", "Observaciones", "Opcional.")}<input id="ff-obs" /></div></div>
      <div style="margin-top:16px;display:flex;gap:8px;"><button type="submit">Guardar factura</button><button type="button" id="ff-cancelar" class="secundario">Cancelar</button></div>
      <p id="ff-msg" class="msg" hidden></p>
    </form>`;

  let lado = "total";
  const g = (s) => body.querySelector(s);
  const desglose = () => desglosarFactura({
    desde: lado, montoCentavos: pesosACentavos(g(lado === "neto" ? "#ff-neto" : "#ff-total").value),
    alicuota: Number(g("#ff-ali").value) || 0, percepcionesCentavos: pesosACentavos(g("#ff-percep").value),
    otrosImpuestosCentavos: pesosACentavos(g("#ff-otros").value),
  });
  const recomputar = () => {
    const d = desglose();
    if (lado === "neto") g("#ff-total").value = formatearCentavos(d.total, { simbolo: false });
    else g("#ff-neto").value = formatearCentavos(d.neto, { simbolo: false });
    g("#ff-desg").innerHTML = `Neto ${formatearCentavos(d.neto)} · IVA ${formatearCentavos(d.iva)} · Percep. ${formatearCentavos(d.percepciones)} · Otros imp. ${formatearCentavos(d.otrosImpuestos)} · <strong>Total ${formatearCentavos(d.total)}</strong>`;
  };
  g("#ff-neto").addEventListener("input", () => { lado = "neto"; recomputar(); });
  g("#ff-total").addEventListener("input", () => { lado = "total"; recomputar(); });
  g("#ff-ali").addEventListener("change", recomputar);
  g("#ff-percep").addEventListener("input", recomputar);
  g("#ff-otros").addEventListener("input", recomputar);
  g("#ff-cancelar").addEventListener("click", cerrarModal);

  g("#ff").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = g("#ff-msg");
    const d = desglose();
    if (d.total <= 0) { setMsg(msg, "Cargá el importe.", "error"); return; }
    setMsg(msg, "Guardando…");
    try {
      await facturasRepo.crear({
        proveedor_id: prov.id, tipo_comprobante: g("#ff-tipo").value, numero_factura: g("#ff-num").value,
        fecha_emision: g("#ff-emi").value || hoy(), fecha_vencimiento: g("#ff-venc").value || null,
        neto_gravado_centavos: d.neto, iva_discriminado_centavos: d.iva,
        percepciones_centavos: d.percepciones, otros_impuestos_centavos: d.otrosImpuestos,
        monto_total_centavos: d.total, observaciones: g("#ff-obs").value,
      });
      cerrarModal();
      if (onDone) await onDone();
    } catch (err) { setMsg(msg, "No se pudo guardar: " + (err.message || err), "error"); }
  });
}

// ---------- modal: registrar pago ----------
function modalPago(prov, pendientes, onDone) {
  const body = abrirModal(`Registrar pago — ${prov.nombre}`);
  const metodoOpts = Object.entries(LABEL_METODO).map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  const filasPend = pendientes.map((f) => `<label style="display:flex;gap:8px;align-items:center;padding:5px 0;font-size:13px;">
      <input type="checkbox" class="pp-check" value="${f.id}" style="width:auto;" />
      ${escapar(f.tipo_comprobante)} ${escapar(f.numero_factura || "")} — saldo ${formatearCentavos(f.saldo_pendiente_centavos)}
    </label>`).join("");
  body.innerHTML = `
    <form id="fp">
      <div class="muted" style="margin-bottom:8px;">Deuda actual: <strong>${formatearCentavos(saldoDe(prov))}</strong> · ${pendientes.length} factura(s) pendiente(s).</div>
      <div class="fila">
        <div>${labelInfo("fp-monto", "Monto ($)", "Cuánto pagás.")}<input id="fp-monto" placeholder="0,00" /></div>
        <div>${labelInfo("fp-fecha", "Fecha", "Fecha del pago.")}<input id="fp-fecha" type="date" value="${hoy()}" /></div>
      </div>
      <div class="fila">
        <div>${labelInfo("fp-metodo", "Método", "Cómo se paga.")}<select id="fp-metodo">${metodoOpts}</select></div>
        <div>${labelInfo("fp-modo", "Imputación", "FIFO: más viejas primero. Manual: las tildadas.")}<select id="fp-modo"><option value="fifo">FIFO (más antiguas)</option><option value="manual">Manual (tildadas)</option></select></div>
      </div>
      <div>${labelInfo("fp-ref", "Referencia", "Nº transferencia/cheque (opcional).")}<input id="fp-ref" /></div>
      <div id="fp-manual" hidden style="margin-top:8px;border-top:1px solid var(--borde);padding-top:8px;">${filasPend || "<span class='muted'>No hay facturas pendientes.</span>"}</div>
      <div style="margin-top:16px;display:flex;gap:8px;"><button type="submit">Registrar</button><button type="button" id="fp-cancelar" class="secundario">Cancelar</button></div>
      <p id="fp-msg" class="msg" hidden></p>
    </form>`;

  const g = (s) => body.querySelector(s);
  g("#fp-modo").addEventListener("change", () => { g("#fp-manual").hidden = g("#fp-modo").value !== "manual"; });
  g("#fp-cancelar").addEventListener("click", cerrarModal);

  g("#fp").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = g("#fp-msg");
    const monto = pesosACentavos(g("#fp-monto").value);
    if (monto <= 0) { setMsg(msg, "Ingresá un monto mayor a cero.", "error"); return; }
    const modo = g("#fp-modo").value;
    const facturaIds = [...body.querySelectorAll(".pp-check:checked")].map((c) => c.value);
    if (modo === "manual" && !facturaIds.length) { setMsg(msg, "Tildá al menos una factura.", "error"); return; }
    setMsg(msg, "Registrando…");
    try {
      const antesSaldo = saldoDe(prov);
      await pagosRepo.registrar({
        proveedorId: prov.id, montoCentavos: monto, metodoPago: g("#fp-metodo").value,
        referencia: g("#fp-ref").value, fechaPago: g("#fp-fecha").value || hoy(),
        modoImputacion: modo, facturaIds,
      });
      cerrarModal();
      if (monto > antesSaldo && antesSaldo >= 0) {
        toast(`Pago registrado. Excedente ${formatearCentavos(monto - antesSaldo)} como saldo a favor.`, "ok", 5000);
      } else {
        toast("Pago registrado ✔");
      }
      if (onDone) await onDone();
    } catch (err) { setMsg(msg, "No se pudo registrar: " + (err.message || err), "error"); }
  });
}
