// ============================================================
// saas/ui/facturas.js — Facturas de compra por proveedor
// ------------------------------------------------------------
// Carga bidireccional neto↔total (core/fiscal.desglosarFactura) + cuadratura.
// El alta va por RPC (facturasRepo.crear). La UI no calcula: usa el core.
// ============================================================

import * as facturasRepo from "../data/facturasRepo.js";
import * as proveedoresRepo from "../data/proveedoresRepo.js";
import * as insumosRepo from "../data/insumosRepo.js";
import * as recetasRepo from "../data/recetasRepo.js";
import { ALICUOTAS_IVA, desglosarFactura } from "../../core/fiscal.js";
import { UNIDADES_POR_MAGNITUD, convertirAUnidadBase, factorAUnidadBase, costoNetoPorUnidadBase } from "../../core/unidades.js";
import { pesosACentavos, formatearCentavos, formatearPorcentaje } from "../../core/dinero.js";
import { escapar, setMsg, labelInfo, iconoInfo, toast, confirmar, abrirModal, cerrarModal } from "./helpers.js";
import { verFactura, editarFactura, validarFechas, FECHA_MIN, FECHA_MAX } from "./facturaModal.js";

let PERFIL = null;
let PROVEEDORES = [];
let INSUMOS = [];
let insMap = {};
let FACTURAS = [];
let provMap = {};
// Valor especial del selector de unidad: "la presentación de compra" del insumo.
const UNIDAD_PRESENTACION = "__presentacion__";
let ladoEditado = "total"; // "neto" | "total"

const hoy = () => new Date().toISOString().slice(0, 10);
const $ = (c, s) => c.querySelector(s);

const fmtFecha = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");

export async function montar(container, perfil) {
  PERFIL = perfil;
  container.innerHTML = `
    <div class="card">
      <div class="topbar">
        <h2 style="margin:0;">Facturas de compra</h2>
        <button id="fac-nueva">+ Nueva factura</button>
      </div>
      <div class="toolbar" style="margin-top:12px;">
        <input id="fac-buscar" type="search" placeholder="Buscar por número…" />
        <select id="fac-fprov"><option value="">Todos los proveedores</option></select>
        <select id="fac-festado">
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option><option value="parcial">Parcial</option>
          <option value="pagada">Pagada</option><option value="anulada">Anulada</option>
        </select>
        <label style="margin:0;display:flex;align-items:center;gap:4px;">Desde <input id="fac-desde" type="date" /></label>
        <label style="margin:0;display:flex;align-items:center;gap:4px;">Hasta <input id="fac-hasta" type="date" /></label>
        <select id="fac-orden">
          <option value="fecha-desc">Más recientes primero</option>
          <option value="fecha-asc">Más antiguas primero</option>
          <option value="monto-desc">Mayor monto</option>
          <option value="monto-asc">Menor monto</option>
          <option value="saldo-desc">Mayor saldo</option>
          <option value="saldo-asc">Menor saldo</option>
        </select>
        <span class="cuenta" id="fac-cuenta"></span>
      </div>
      <div id="fac-lista" class="tabla-scroll"><p class="muted">Cargando…</p></div>
    </div>`;

  try {
    [PROVEEDORES, INSUMOS] = await Promise.all([proveedoresRepo.listar(), insumosRepo.listar()]);
    insMap = Object.fromEntries(INSUMOS.map((i) => [i.id, i]));
    provMap = Object.fromEntries(PROVEEDORES.map((p) => [p.id, p]));
  } catch (err) {
    $(container, "#fac-lista").innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`;
    return;
  }
  $(container, "#fac-fprov").innerHTML += PROVEEDORES.map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("");
  ["#fac-buscar", "#fac-fprov", "#fac-festado", "#fac-desde", "#fac-hasta", "#fac-orden"].forEach((s) =>
    $(container, s).addEventListener("input", () => dibujarLista(container)));
  $(container, "#fac-nueva").addEventListener("click", () => abrirNueva(container));
  await refrescarLista(container);
}

async function refrescarLista(container) {
  const cont = $(container, "#fac-lista");
  try {
    FACTURAS = await facturasRepo.listarTodas();
  } catch (err) {
    cont.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`;
    return;
  }
  dibujarLista(container);
}

function dibujarLista(container) {
  const cont = $(container, "#fac-lista");
  const q = ($(container, "#fac-buscar").value || "").toLowerCase().trim();
  const prov = $(container, "#fac-fprov").value;
  const estado = $(container, "#fac-festado").value;
  const desde = $(container, "#fac-desde").value;
  const hasta = $(container, "#fac-hasta").value;
  const [campo, sentido] = $(container, "#fac-orden").value.split("-");
  const dir = sentido === "asc" ? 1 : -1;

  const lista = FACTURAS.filter((f) => {
    if (q && !(f.numero_factura || "").toLowerCase().includes(q)) return false;
    if (prov && f.proveedor_id !== prov) return false;
    if (estado && f.estado !== estado) return false;
    const fe = String(f.fecha_emision || "").slice(0, 10);
    if (desde && fe < desde) return false;
    if (hasta && fe > hasta) return false;
    return true;
  });
  const clave = { fecha: (f) => String(f.fecha_emision || ""), monto: (f) => Number(f.monto_total_centavos) || 0, saldo: (f) => Number(f.saldo_pendiente_centavos) || 0 }[campo];
  lista.sort((a, b) => {
    const x = clave(a), y = clave(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });

  $(container, "#fac-cuenta").textContent = `${lista.length} de ${FACTURAS.length}`;
  if (!FACTURAS.length) { cont.innerHTML = "<p class='muted'>Todavía no hay facturas. Cargá la primera con “+ Nueva factura”.</p>"; return; }
  if (!lista.length) { cont.innerHTML = "<p class='muted'>No hay facturas que coincidan con los filtros.</p>"; return; }

  const vigentes = lista.filter((f) => f.estado !== "anulada");
  const totM = vigentes.reduce((a, f) => a + (Number(f.monto_total_centavos) || 0), 0);
  const totS = vigentes.reduce((a, f) => a + (Number(f.saldo_pendiente_centavos) || 0), 0);
  const filas = lista.map((f) => {
    const puedeAnular = f.estado !== "anulada" && Number(f.saldo_pendiente_centavos) === Number(f.monto_total_centavos);
    const p = provMap[f.proveedor_id];
    return `
    <tr>
      <td>${fmtFecha(f.fecha_emision)}</td>
      <td>${escapar(p ? p.nombre : "—")}</td>
      <td>${escapar(f.tipo_comprobante)} ${escapar(f.numero_factura || "")}</td>
      <td class="num">${formatearCentavos(f.monto_total_centavos)}</td>
      <td class="num">${formatearCentavos(f.saldo_pendiente_centavos)}</td>
      <td>${estadoPill(f.estado)}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="secundario fac-ver" data-id="${f.id}">Ver</button>
        ${f.estado !== "anulada" ? `<button class="secundario fac-editar" data-id="${f.id}">Editar</button>` : ""}
        ${puedeAnular ? `<button class="btn-baja fac-anular" data-id="${f.id}">Anular</button>` : ""}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<table>
    <thead><tr><th>Emisión</th><th>Proveedor</th><th>Comprobante</th><th class="num">Total</th><th class="num">Saldo</th><th>Estado</th><th></th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr><td colspan="3">Totales (sin anuladas)</td><td class="num">${formatearCentavos(totM)}</td><td class="num">${formatearCentavos(totS)}</td><td colspan="2"></td></tr></tfoot></table>`;
  const porId = Object.fromEntries(FACTURAS.map((x) => [x.id, x]));
  const recargar = () => refrescarLista(container);
  cont.querySelectorAll(".fac-ver").forEach((b) => b.addEventListener("click", () => verFactura(b.dataset.id, { onCambio: recargar })));
  cont.querySelectorAll(".fac-editar").forEach((b) => b.addEventListener("click", () => editarFactura(porId[b.dataset.id], { onCambio: recargar })));
  cont.querySelectorAll(".fac-anular").forEach((b) => b.addEventListener("click", () => anularFactura(container, b.dataset.id)));
}

// ---------- nueva factura (modal) ----------
function abrirNueva(container) {
  if (!PROVEEDORES.length) { toast("Primero cargá un proveedor en el módulo Proveedores.", "error"); return; }
  ladoEditado = "total";
  const body = abrirModal("Nueva factura", { ancho: "lg" });
  body.innerHTML = formNuevaFactura();
  wireForm(body, container);
}

function formNuevaFactura() {
  const ivaOpts = ALICUOTAS_IVA.map((a) => `<option value="${a}" ${a === 21 ? "selected" : ""}>${a}%</option>`).join("");
  return `
    <div>
      <form id="form-factura">
        <div>${labelInfo("fac-prov", "Proveedor *", "A quién corresponde la factura.")}
          <select id="fac-prov" required><option value="">— elegí un proveedor —</option>${PROVEEDORES.map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("")}</select></div>
        <div class="fila">
          <div>${labelInfo("fac-tipo", "Comprobante", "Tipo de factura: A (discrimina IVA), B o C (monotributo, sin IVA discriminado).")}
            <select id="fac-tipo"><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></div>
          <div>${labelInfo("fac-numero", "Número", "Número del comprobante tal como figura en el papel. Ej: A-0002-000841.")}
            <input id="fac-numero" placeholder="A-0002-000841" /></div>
        </div>
        <div class="fila">
          <div>${labelInfo("fac-emision", "Fecha emisión", "Fecha en que se emitió la factura.")}
            <input id="fac-emision" type="date" min="${FECHA_MIN}" max="${FECHA_MAX}" value="${hoy()}" /></div>
          <div>${labelInfo("fac-venc", "Vencimiento", "Fecha límite de pago (opcional). Se usa para alertas de vencimientos.")}
            <input id="fac-venc" type="date" min="${FECHA_MIN}" max="${FECHA_MAX}" /></div>
        </div>

        <h3 class="muted" style="margin:16px 0 4px;">Importes</h3>
        <div class="fila">
          <div>${labelInfo("fac-alicuota", "Alícuota IVA", "IVA de la factura (21% general, 10,5% muchos alimentos).")}
            <select id="fac-alicuota">${ivaOpts}</select></div>
          <div>${labelInfo("fac-neto", "Neto ($)", "Importe sin IVA. Si cargás el total, el neto se calcula solo (y viceversa).")}
            <input id="fac-neto" placeholder="0,00" /></div>
          <div>${labelInfo("fac-percep", "Percepciones ($)", "Percepciones de IVA/IIBB (opcional). Se pagan pero no son costo ni crédito fiscal.")}
            <input id="fac-percep" placeholder="0,00" /></div>
          <div>${labelInfo("fac-otros", "Imp. interno / otros ($)", "Impuesto interno u otros cargos no recuperables (opcional). Ej: impuesto interno a bebidas alcohólicas. Se paga y NO es crédito fiscal.")}
            <input id="fac-otros" placeholder="0,00" /></div>
          <div>${labelInfo("fac-total", "Total ($)", "Importe final a pagar (neto + IVA + percepciones + otros impuestos). Es lo que va a la cuenta corriente.")}
            <input id="fac-total" placeholder="0,00" /></div>
        </div>
        <p id="fac-desglose" class="muted" style="margin-top:8px;"></p>

        <div style="margin-top:8px;">${labelInfo("fac-obs", "Observaciones", "Nota libre (opcional).")}
          <input id="fac-obs" placeholder="Opcional" /></div>

        <h3 class="muted" style="margin:18px 0 4px;">Actualizar costos de insumos de esta compra
          ${iconoInfo("Opcional. Por cada insumo comprado, cargá cuánto y a qué precio: se actualiza su costo (queda en el historial) y se recalculan las recetas.")}</h3>
        <div id="fac-items"></div>
        <button type="button" id="fac-add-item" class="secundario" style="margin-top:8px;"${INSUMOS.length ? "" : " disabled"}>+ Agregar insumo</button>
        ${INSUMOS.length ? "" : `<p class="muted" style="font-size:12px;">Cargá insumos primero para poder actualizarlos desde acá.</p>`}

        <div style="margin-top:16px;display:flex;gap:8px;"><button type="submit">Guardar factura</button><button type="button" id="fac-cancelar" class="secundario">Cancelar</button></div>
        <p id="fac-msg" class="msg" hidden></p>
      </form>
    </div>`;
}

function wireForm(container, lista) {
  const neto = $(container, "#fac-neto");
  const total = $(container, "#fac-total");
  neto.addEventListener("input", () => { ladoEditado = "neto"; recomputar(container); });
  total.addEventListener("input", () => { ladoEditado = "total"; recomputar(container); });
  $(container, "#fac-alicuota").addEventListener("change", () => recomputar(container));
  $(container, "#fac-percep").addEventListener("input", () => recomputar(container));
  $(container, "#fac-otros").addEventListener("input", () => recomputar(container));
  const addBtn = $(container, "#fac-add-item");
  if (addBtn) addBtn.addEventListener("click", () => $(container, "#fac-items").appendChild(filaItem()));
  $(container, "#fac-cancelar").addEventListener("click", cerrarModal);
  $(container, "#form-factura").addEventListener("submit", (e) => guardar(e, container, lista));
}

/** Fila para actualizar el costo de un insumo comprado. */
function filaItem() {
  const row = document.createElement("div");
  row.className = "fila fac-item";
  row.style.marginBottom = "8px";
  row.innerHTML = `
    <div style="flex:2;"><select class="it-insumo"><option value="">— insumo —</option>${INSUMOS.map((i) => `<option value="${i.id}">${escapar(i.nombre)}</option>`).join("")}</select></div>
    <div style="flex:0 0 90px;"><input class="it-cant" type="number" step="0.0001" placeholder="cant." /></div>
    <div style="flex:0 0 90px;"><select class="it-unidad"></select></div>
    <div style="flex:0 0 120px;"><input class="it-precio" placeholder="precio neto $" /></div>
    <div style="flex:1;text-align:right;" class="muted it-calc"></div>
    <div style="flex:0 0 32px;"><button type="button" class="btn-baja it-del">✕</button></div>`;

  const insSel = row.querySelector(".it-insumo");
  const uniSel = row.querySelector(".it-unidad");
  const poblarUni = () => {
    const ins = insMap[insSel.value];
    // Unidades de la magnitud de uso + la presentación de compra (ej: "Botella").
    const pres = ins && Number(ins.presentacion_cantidad_base) > 0
      ? `<option value="${UNIDAD_PRESENTACION}">${escapar(ins.presentacion_desc || "presentación")}</option>` : "";
    uniSel.innerHTML = ins ? pres + (UNIDADES_POR_MAGNITUD[ins.magnitud] || []).map((u) => `<option value="${u}">${u}</option>`).join("") : "";
    calcular();
  };
  const calcular = () => {
    const ins = insMap[insSel.value];
    const el = row.querySelector(".it-calc");
    const nb = costoItem(row);
    if (!ins || nb == null) { el.textContent = ""; return; }
    const actual = ins.costo_neto_por_unidad_base_centavos || 0;
    const vari = actual > 0 ? ((nb - actual) / actual) * 100 : 0;
    el.innerHTML = `→ ${formatearCentavos(nb * factorAUnidadBase(ins.unidad_uso || ins.unidad_base))}/${escapar(ins.unidad_uso || ins.unidad_base)} <span style="color:${vari > 0 ? "var(--error)" : vari < 0 ? "var(--ok)" : "var(--muted)"}">(${vari > 0 ? "+" : ""}${escapar(formatearPorcentaje(vari))})</span>`;
  };
  insSel.addEventListener("change", poblarUni);
  uniSel.addEventListener("change", calcular);
  row.querySelector(".it-cant").addEventListener("input", calcular);
  row.querySelector(".it-precio").addEventListener("input", calcular);
  row.querySelector(".it-del").addEventListener("click", () => row.remove());
  return row;
}

/** Costo por unidad base derivado de una fila (o null si falta dato). */
function costoItem(row) {
  const ins = insMap[row.querySelector(".it-insumo").value];
  const cant = Number(row.querySelector(".it-cant").value);
  const unidad = row.querySelector(".it-unidad").value;
  const precio = pesosACentavos(row.querySelector(".it-precio").value);
  if (!ins || !cant || cant <= 0 || !unidad || precio <= 0) return null;
  const cantBase = unidad === UNIDAD_PRESENTACION
    ? cant * Number(ins.presentacion_cantidad_base)
    : convertirAUnidadBase(cant, unidad);
  return costoNetoPorUnidadBase(precio, cantBase);
}

function desgloseActual(container) {
  const alicuota = Number($(container, "#fac-alicuota").value) || 0;
  const percep = pesosACentavos($(container, "#fac-percep").value);
  const otros = pesosACentavos($(container, "#fac-otros").value);
  const monto = pesosACentavos($(container, ladoEditado === "neto" ? "#fac-neto" : "#fac-total").value);
  return desglosarFactura({ desde: ladoEditado, montoCentavos: monto, alicuota, percepcionesCentavos: percep, otrosImpuestosCentavos: otros });
}

function recomputar(container) {
  const d = desgloseActual(container);
  // Completar el lado que NO editó el usuario (sin disparar input).
  if (ladoEditado === "neto") $(container, "#fac-total").value = formatearCentavos(d.total, { simbolo: false });
  else $(container, "#fac-neto").value = formatearCentavos(d.neto, { simbolo: false });

  $(container, "#fac-desglose").innerHTML =
    `Neto ${formatearCentavos(d.neto)} · IVA ${formatearCentavos(d.iva)} · ` +
    `Percep. ${formatearCentavos(d.percepciones)} · Otros imp. ${formatearCentavos(d.otrosImpuestos)} · ` +
    `<strong>Total ${formatearCentavos(d.total)}</strong>`;
}

async function anularFactura(container, facturaId) {
  if (!(await confirmar({ titulo: "Anular factura", mensaje: "Se revierte la deuda que generó. La factura queda anulada (no se borra ni se edita). Para corregirla, cargá de nuevo con los datos correctos.", textoOk: "Anular", peligro: true }))) return;
  try {
    await facturasRepo.anular(facturaId);
    toast("Factura anulada ✔");
    await refrescarLista(container);
  } catch (err) {
    toast("Error: " + (err.message || err), "error");
  }
}

function estadoPill(estado) {
  const map = { pendiente: "var(--error)", parcial: "#b45309", pagada: "var(--ok)", anulada: "var(--muted)" };
  return `<span style="color:${map[estado] || "var(--muted)"}">${escapar(estado)}</span>`;
}

async function guardar(e, container, lista) {
  e.preventDefault();
  const msg = $(container, "#fac-msg");
  const provId = $(container, "#fac-prov").value;
  if (!provId) { setMsg(msg, "Elegí el proveedor.", "error"); return; }
  const errFechas = validarFechas($(container, "#fac-emision").value, $(container, "#fac-venc").value);
  if (errFechas) { setMsg(msg, errFechas, "error"); return; }
  const d = desgloseActual(container);
  if (d.total <= 0) { setMsg(msg, "Cargá el importe de la factura.", "error"); return; }

  // Recolectar actualizaciones de costo de insumos (filas válidas).
  const items = [...container.querySelectorAll(".fac-item")].map((row) => ({
    insumoId: row.querySelector(".it-insumo").value,
    costo: costoItem(row),
  })).filter((x) => x.insumoId && x.costo != null);

  setMsg(msg, "Guardando…");
  try {
    const facturaId = await facturasRepo.crear({
      proveedor_id: provId,
      tipo_comprobante: $(container, "#fac-tipo").value,
      numero_factura: $(container, "#fac-numero").value,
      fecha_emision: $(container, "#fac-emision").value || hoy(),
      fecha_vencimiento: $(container, "#fac-venc").value || null,
      neto_gravado_centavos: d.neto,
      iva_discriminado_centavos: d.iva,
      percepciones_centavos: d.percepciones,
      otros_impuestos_centavos: d.otrosImpuestos,
      monto_total_centavos: d.total,
      observaciones: $(container, "#fac-obs").value,
    });
    // Actualizar costos de insumos + recalcular recetas.
    let recetasActualizadas = 0;
    if (items.length) {
      for (const it of items) {
        await insumosRepo.actualizarCosto(PERFIL.empresa_id, it.insumoId, it.costo, { origen: "factura", factura_id: facturaId });
      }
      try { recetasActualizadas = await recetasRepo.recalcularTodas(); } catch (_e) {}
      // Refrescar insumos en memoria para próximos cálculos.
      try { INSUMOS = await insumosRepo.listar(); insMap = Object.fromEntries(INSUMOS.map((i) => [i.id, i])); } catch (_e) {}
    }

    toast(items.length
      ? `Factura guardada ✔ · ${items.length} insumo(s) actualizado(s) · ${recetasActualizadas} receta(s) recalculada(s)`
      : "Factura guardada ✔", "ok", 5000);
    cerrarModal();
    await refrescarLista(lista);
  } catch (err) {
    setMsg(msg, "No se pudo guardar: " + (err.message || err), "error");
  }
}
