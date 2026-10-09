// ============================================================
// saas/ui/facturaModal.js — Ver y editar una factura (modales compartidos)
// ------------------------------------------------------------
// Se usa desde Facturas, la ficha del proveedor y el Resumen.
// El alta sigue en facturas.js. La edición va por la RPC editar_factura:
//   • sin pagos imputados → se puede cambiar todo;
//   • con pagos imputados → solo comprobante, número, fechas y observaciones.
// La UI no calcula: usa core/fiscal.
// ============================================================

import * as facturasRepo from "../data/facturasRepo.js";
import * as proveedoresRepo from "../data/proveedoresRepo.js";
import { ALICUOTAS_IVA, desglosarFactura } from "../../core/fiscal.js";
import { pesosACentavos, formatearCentavos } from "../../core/dinero.js";
import { formatearFecha } from "../../core/utilsFecha.js";
import { escapar, setMsg, labelInfo, toast, confirmar, abrirModal, cerrarModal } from "./helpers.js";

export const FECHA_MIN = "2000-01-01";
export const FECHA_MAX = "2100-12-31";

const METODOS = { transferencia: "Transferencia", efectivo: "Efectivo", cheque: "Cheque", echeq: "e-Cheq", otro: "Otro" };
const $ = (c, s) => c.querySelector(s);
const estadoColor = { pendiente: "var(--error)", parcial: "#b45309", pagada: "var(--ok)", anulada: "var(--muted)" };

/** Valida un par de fechas del formulario. Devuelve un mensaje de error o "". */
export function validarFechas(emision, vencimiento) {
  if (!emision) return "Indicá la fecha de emisión.";
  if (emision < FECHA_MIN || emision > FECHA_MAX) return "La fecha de emisión tiene un año inválido: revisá que esté entre 2000 y 2100.";
  if (vencimiento && (vencimiento < FECHA_MIN || vencimiento > FECHA_MAX)) return "La fecha de vencimiento tiene un año inválido: revisá que esté entre 2000 y 2100.";
  if (vencimiento && vencimiento < emision) return "El vencimiento no puede ser anterior a la emisión.";
  return "";
}

/** Una factura tiene pagos si su saldo ya no es igual al total. */
const tienePagos = (f) => Number(f.saldo_pendiente_centavos) !== Number(f.monto_total_centavos);

/**
 * Abre el detalle completo de una factura.
 * @param {string} facturaId
 * @param {{onCambio?:()=>any, volver?:()=>any}} [opts]
 *   onCambio: se llama tras editar/anular. volver: acción del botón "Volver"
 *   (si no hay, el botón cierra el modal).
 */
export async function verFactura(facturaId, opts = {}) {
  const body = abrirModal("Factura", { ancho: "lg" });
  body.innerHTML = "<p class='muted'>Cargando…</p>";
  let f, prov = null, imps = [];
  try {
    f = await facturasRepo.obtener(facturaId);
    if (!f) { body.innerHTML = "<p class='error'>Factura no encontrada.</p>"; return; }
    [prov, imps] = await Promise.all([
      proveedoresRepo.obtener(f.proveedor_id).catch(() => null),
      facturasRepo.imputaciones(facturaId).catch(() => []),
    ]);
  } catch (err) { body.innerHTML = `<p class="error">${escapar(err.message || String(err))}</p>`; return; }

  const dato = (t, v) => `<div style="flex:1;min-width:150px;"><div class="muted" style="font-size:12px;">${t}</div><div>${v}</div></div>`;
  const anulada = f.estado === "anulada";
  const filasImp = imps.map((i) => `<tr>
      <td>${escapar(formatearFecha(i.pagos && i.pagos.fecha_pago))}</td>
      <td>${escapar((i.pagos && METODOS[i.pagos.metodo_pago]) || (i.pagos && i.pagos.metodo_pago) || "—")}${i.pagos && i.pagos.estado === "anulado" ? ' <span class="muted">(anulado)</span>' : ""}</td>
      <td>${escapar((i.pagos && i.pagos.referencia) || "")}</td>
      <td class="num">${formatearCentavos(i.monto_imputado_centavos)}</td></tr>`).join("");

  body.innerHTML = `
    <div class="topbar" style="margin-bottom:12px;">
      <div>
        <div style="font-size:17px;font-weight:700;">${escapar(f.tipo_comprobante)} ${escapar(f.numero_factura || "(sin número)")}</div>
        <div class="muted" style="font-size:13px;">${escapar(prov ? prov.nombre : "—")}${prov && prov.razon_social ? " · " + escapar(prov.razon_social) : ""}</div>
      </div>
      <div style="font-weight:600;color:${estadoColor[f.estado] || "var(--muted)"};">${escapar(f.estado)}</div>
    </div>

    <div class="fila" style="gap:20px;">
      ${dato("Fecha de emisión", escapar(formatearFecha(f.fecha_emision)))}
      ${dato("Vencimiento", f.fecha_vencimiento ? escapar(formatearFecha(f.fecha_vencimiento)) : "—")}
      ${dato("Saldo pendiente", `<strong>${formatearCentavos(f.saldo_pendiente_centavos)}</strong>`)}
    </div>

    <h3 class="muted" style="margin:16px 0 4px;">Importes</h3>
    <div class="tabla-scroll"><table>
      <tbody>
        <tr><td>Neto gravado</td><td class="num">${formatearCentavos(f.neto_gravado_centavos)}</td></tr>
        <tr><td>IVA</td><td class="num">${formatearCentavos(f.iva_discriminado_centavos)}</td></tr>
        <tr><td>Percepciones</td><td class="num">${formatearCentavos(f.percepciones_centavos)}</td></tr>
        <tr><td>Imp. interno / otros</td><td class="num">${formatearCentavos(f.otros_impuestos_centavos)}</td></tr>
      </tbody>
      <tfoot><tr><td><strong>Total</strong></td><td class="num"><strong>${formatearCentavos(f.monto_total_centavos)}</strong></td></tr></tfoot>
    </table></div>

    ${f.observaciones ? `<h3 class="muted" style="margin:16px 0 4px;">Observaciones</h3><p style="margin:0;white-space:pre-wrap;">${escapar(f.observaciones)}</p>` : ""}

    <h3 class="muted" style="margin:16px 0 4px;">Pagos imputados</h3>
    ${imps.length ? `<div class="tabla-scroll"><table>
      <thead><tr><th>Fecha</th><th>Método</th><th>Ref.</th><th class="num">Imputado</th></tr></thead><tbody>${filasImp}</tbody></table></div>`
      : "<p class='muted' style='margin:0;'>Todavía no tiene pagos imputados.</p>"}

    <p class="muted" style="margin:14px 0 0;font-size:12px;">Cargada el ${escapar(formatearFecha(f.creado_en))}${f.modificado_en && String(f.modificado_en).slice(0, 16) !== String(f.creado_en).slice(0, 16) ? " · última modificación el " + escapar(formatearFecha(f.modificado_en)) : ""}</p>

    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
      ${anulada ? "" : `<button id="vf-editar">Editar</button>`}
      ${!anulada && !tienePagos(f) ? `<button id="vf-anular" class="btn-baja">Anular</button>` : ""}
      <button id="vf-volver" class="secundario">${opts.volver ? "Volver" : "Cerrar"}</button>
    </div>`;

  const volver = () => (opts.volver ? opts.volver() : cerrarModal());
  $(body, "#vf-volver").addEventListener("click", volver);
  const ed = $(body, "#vf-editar");
  if (ed) ed.addEventListener("click", () => editarFactura(f, { onCambio: opts.onCambio, volver: () => verFactura(facturaId, opts) }));
  const an = $(body, "#vf-anular");
  if (an) an.addEventListener("click", async () => {
    if (!(await confirmar({ titulo: "Anular factura", mensaje: "Se revierte la deuda que generó. La factura queda anulada (no se borra). Para corregirla, usá Editar.", textoOk: "Anular", peligro: true }))) { verFactura(facturaId, opts); return; }
    try { await facturasRepo.anular(facturaId); toast("Factura anulada ✔"); cerrarModal(); if (opts.onCambio) await opts.onCambio(); }
    catch (err) { toast("Error: " + (err.message || err), "error"); }
  });
}

/** Alícuota de IVA más cercana a la que implican neto e IVA guardados. */
function alicuotaImplicita(f) {
  const neto = Number(f.neto_gravado_centavos) || 0;
  if (neto <= 0) return 21;
  const pct = (Number(f.iva_discriminado_centavos) / neto) * 100;
  return ALICUOTAS_IVA.reduce((m, a) => (Math.abs(a - pct) < Math.abs(m - pct) ? a : m), ALICUOTAS_IVA[0]);
}

/**
 * Abre el formulario de edición de una factura.
 * @param {object} f  fila de facturas
 * @param {{onCambio?:()=>any, volver?:()=>any}} [opts]
 */
export async function editarFactura(f, opts = {}) {
  let proveedores = [];
  try { proveedores = await proveedoresRepo.listar(); } catch (_e) {}
  const bloqueado = tienePagos(f); // con pagos: importes y proveedor fijos
  const body = abrirModal(`Editar factura ${f.tipo_comprobante} ${f.numero_factura || ""}`.trim(), { ancho: "lg" });
  const ali = alicuotaImplicita(f);
  const dis = bloqueado ? " disabled" : "";
  const monto = (c) => formatearCentavos(c || 0, { simbolo: false });

  body.innerHTML = `
    ${bloqueado ? `<p class="muted" style="margin-top:0;">Esta factura ya tiene pagos imputados: podés corregir comprobante, número, fechas y observaciones. Para cambiar importes o proveedor, anulá primero esos pagos.</p>` : ""}
    <form id="ef-form">
      <div>${labelInfo("ef-prov", "Proveedor *", "A quién corresponde la factura.")}
        <select id="ef-prov"${dis}>${proveedores.map((p) => `<option value="${p.id}" ${p.id === f.proveedor_id ? "selected" : ""}>${escapar(p.nombre)}</option>`).join("")}</select></div>
      <div class="fila">
        <div>${labelInfo("ef-tipo", "Comprobante", "Tipo de factura.")}
          <select id="ef-tipo">${["A", "B", "C"].map((t) => `<option ${t === f.tipo_comprobante ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div>${labelInfo("ef-numero", "Número", "Como figura en el papel.")}<input id="ef-numero" value="${escapar(f.numero_factura || "")}" /></div>
      </div>
      <div class="fila">
        <div>${labelInfo("ef-emision", "Fecha emisión", "Fecha en que se emitió la factura.")}<input id="ef-emision" type="date" min="${FECHA_MIN}" max="${FECHA_MAX}" value="${escapar(String(f.fecha_emision || "").slice(0, 10))}" /></div>
        <div>${labelInfo("ef-venc", "Vencimiento", "Fecha límite de pago (opcional).")}<input id="ef-venc" type="date" min="${FECHA_MIN}" max="${FECHA_MAX}" value="${escapar(String(f.fecha_vencimiento || "").slice(0, 10))}" /></div>
      </div>

      <h3 class="muted" style="margin:16px 0 4px;">Importes</h3>
      <div class="fila">
        <div>${labelInfo("ef-ali", "Alícuota IVA", "IVA de la factura.")}
          <select id="ef-ali"${dis}>${ALICUOTAS_IVA.map((a) => `<option value="${a}" ${a === ali ? "selected" : ""}>${a}%</option>`).join("")}</select></div>
        <div>${labelInfo("ef-neto", "Neto ($)", "Sin IVA. Si cargás el total, se calcula solo.")}<input id="ef-neto" value="${monto(f.neto_gravado_centavos)}"${dis} /></div>
        <div>${labelInfo("ef-percep", "Percepciones ($)", "IVA/IIBB. Opcional.")}<input id="ef-percep" value="${monto(f.percepciones_centavos)}"${dis} /></div>
        <div>${labelInfo("ef-otros", "Imp. interno / otros ($)", "Cargos no recuperables. Opcional.")}<input id="ef-otros" value="${monto(f.otros_impuestos_centavos)}"${dis} /></div>
        <div>${labelInfo("ef-total", "Total ($)", "Lo que va a la cuenta corriente.")}<input id="ef-total" value="${monto(f.monto_total_centavos)}"${dis} /></div>
      </div>
      <p id="ef-desglose" class="muted" style="margin-top:8px;"></p>

      <div>${labelInfo("ef-obs", "Observaciones", "Nota libre (opcional).")}<input id="ef-obs" value="${escapar(f.observaciones || "")}" /></div>
      <div style="margin-top:16px;display:flex;gap:8px;"><button type="submit">Guardar cambios</button><button type="button" id="ef-cancelar" class="secundario">Cancelar</button></div>
      <p id="ef-msg" class="msg" hidden></p>
    </form>`;

  // Desglose: solo se recalcula si el usuario toca los importes; si no, se
  // conservan exactos los valores guardados (sin redondeos nuevos).
  let lado = "total", tocado = false;
  const original = { neto: f.neto_gravado_centavos, iva: f.iva_discriminado_centavos, percepciones: f.percepciones_centavos, otrosImpuestos: f.otros_impuestos_centavos, total: f.monto_total_centavos };
  const desglose = () => {
    if (!tocado) return original;
    return desglosarFactura({
      desde: lado, montoCentavos: pesosACentavos($(body, lado === "neto" ? "#ef-neto" : "#ef-total").value),
      alicuota: Number($(body, "#ef-ali").value) || 0,
      percepcionesCentavos: pesosACentavos($(body, "#ef-percep").value),
      otrosImpuestosCentavos: pesosACentavos($(body, "#ef-otros").value),
    });
  };
  const pintar = () => {
    const d = desglose();
    if (tocado) {
      if (lado === "neto") $(body, "#ef-total").value = formatearCentavos(d.total, { simbolo: false });
      else $(body, "#ef-neto").value = formatearCentavos(d.neto, { simbolo: false });
    }
    $(body, "#ef-desglose").innerHTML = `Neto ${formatearCentavos(d.neto)} · IVA ${formatearCentavos(d.iva)} · Percep. ${formatearCentavos(d.percepciones)} · Otros imp. ${formatearCentavos(d.otrosImpuestos)} · <strong>Total ${formatearCentavos(d.total)}</strong>`;
  };
  if (!bloqueado) {
    $(body, "#ef-neto").addEventListener("input", () => { lado = "neto"; tocado = true; pintar(); });
    $(body, "#ef-total").addEventListener("input", () => { lado = "total"; tocado = true; pintar(); });
    $(body, "#ef-ali").addEventListener("change", () => { tocado = true; pintar(); });
    $(body, "#ef-percep").addEventListener("input", () => { tocado = true; pintar(); });
    $(body, "#ef-otros").addEventListener("input", () => { tocado = true; pintar(); });
  }
  pintar();

  $(body, "#ef-cancelar").addEventListener("click", () => (opts.volver ? opts.volver() : cerrarModal()));
  $(body, "#ef-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $(body, "#ef-msg");
    const emision = $(body, "#ef-emision").value, venc = $(body, "#ef-venc").value;
    const errFechas = validarFechas(emision, venc);
    if (errFechas) { setMsg(msg, errFechas, "error"); return; }
    const d = desglose();
    if (d.total <= 0) { setMsg(msg, "Cargá el importe de la factura.", "error"); return; }
    setMsg(msg, "Guardando…");
    try {
      await facturasRepo.editar(f.id, {
        proveedor_id: $(body, "#ef-prov").value,
        tipo_comprobante: $(body, "#ef-tipo").value,
        numero_factura: $(body, "#ef-numero").value,
        fecha_emision: emision, fecha_vencimiento: venc || null,
        neto_gravado_centavos: d.neto, iva_discriminado_centavos: d.iva,
        percepciones_centavos: d.percepciones, otros_impuestos_centavos: d.otrosImpuestos,
        monto_total_centavos: d.total,
        observaciones: $(body, "#ef-obs").value,
      });
      cerrarModal();
      toast("Factura actualizada ✔");
      if (opts.onCambio) await opts.onCambio();
    } catch (err) { setMsg(msg, "No se pudo guardar: " + (err.message || err), "error"); }
  });
}
