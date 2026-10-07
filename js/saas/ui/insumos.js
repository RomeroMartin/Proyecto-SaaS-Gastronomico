// ============================================================
// saas/ui/insumos.js — Insumos: alta, actualización de precio (con historial),
// proveedor habitual y ficha. La UI no calcula: usa core/.
// ============================================================

import * as insumosRepo from "../data/insumosRepo.js";
import * as proveedoresRepo from "../data/proveedoresRepo.js";
import * as recetasRepo from "../data/recetasRepo.js";
import * as catalogos from "../data/catalogosRepo.js";
import { MAGNITUDES, UNIDADES_POR_MAGNITUD, unidadBaseDe, convertirAUnidadBase, convertirDesdeUnidadBase, factorAUnidadBase, costoNetoPorUnidadBase } from "../../core/unidades.js";
import { ALICUOTAS_IVA } from "../../core/fiscal.js";
import { costoRealPorUnidadBase } from "../../core/costeo.js";
import { pesosACentavos, formatearCentavos, formatearPorcentaje } from "../../core/dinero.js";
import { escapar, setMsg, labelInfo, datalist, toast, confirmar, abrirModal, cerrarModal } from "./helpers.js";

let PERFIL = null;
let CONT = null;
let PROVEEDORES = [];
let provMap = {};
const fmtFecha = (iso) => (iso ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso)) : "—");

/** Unidad en la que se muestran los costos y se cargan las recetas. */
const unidadUsoDe = (i) => i.unidad_uso || i.unidad_base;
/** Centavos por unidad base → centavos por unidad de uso (ej: por oz). */
const porUnidadUso = (centavosBase, i) => (Number(centavosBase) || 0) * factorAUnidadBase(unidadUsoDe(i));

export async function montar(container, perfil) {
  PERFIL = perfil;
  CONT = container;
  try { PROVEEDORES = await proveedoresRepo.listar(); } catch (_e) { PROVEEDORES = []; }
  provMap = Object.fromEntries(PROVEEDORES.map((p) => [p.id, p]));

  container.innerHTML = `
    <div class="card">
      <div class="topbar"><h2 style="margin:0;">Insumos</h2>
        <div style="display:flex;gap:8px;">
          <button id="ins-refrescar" class="secundario">Refrescar</button>
          <button id="ins-nuevo">+ Nuevo insumo</button>
        </div></div>
      <div id="ins-lista" class="tabla-scroll"></div>
    </div>`;

  container.querySelector("#ins-refrescar").addEventListener("click", () => refrescar(container));
  container.querySelector("#ins-nuevo").addEventListener("click", abrirNuevo);

  await refrescar(container);
}

// ---------- formulario de insumo (alta y edición) ----------
function formInsumoHTML(textoGuardar) {
  const magOpts = Object.entries(MAGNITUDES).map(([k, v]) => `<option value="${k}">${v.nombre}</option>`).join("");
  const ivaOpts = ALICUOTAS_IVA.map((a) => `<option value="${a}">${a}%</option>`).join("");
  const provOpts = `<option value="">— sin proveedor —</option>` + PROVEEDORES.map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("");
  return `
      <form id="form-insumo">
        <div class="fila">
          <div>${labelInfo("ins-nombre", "Nombre *", "Cómo llamás al insumo. Ej: Queso Mozzarella, Harina 0000.")}<input id="ins-nombre" required placeholder="Ej: Queso Mozzarella" /></div>
          <div>${labelInfo("ins-rubro", "Rubro", "Categoría del insumo. Elegí o escribí una nueva: se guarda.")}<input id="ins-rubro" list="dl-rubro-ins" placeholder="Elegí o escribí…" /></div>
          <div>${labelInfo("ins-prov", "Proveedor habitual", "Quién te lo vende normalmente (opcional).")}<select id="ins-prov">${provOpts}</select></div>
        </div>
        <div class="fila">
          <div>${labelInfo("ins-magnitud", "Magnitud de compra", "Cómo viene lo que comprás: masa (kg), volumen (l) o unidad (botella, caja…).")}<select id="ins-magnitud">${magOpts}</select></div>
          <div>${labelInfo("ins-iva", "Alícuota IVA", "IVA del insumo: 21% general, 10,5% muchos alimentos.")}<select id="ins-iva">${ivaOpts}</select></div>
          <div>${labelInfo("ins-factor", "Factor de corrección", "Rendimiento tras limpieza/desposte. 1 = sin pérdida. 0,78 = queda 78% útil.")}<input id="ins-factor" type="number" step="0.0001" value="1" /></div>
        </div>

        <h3 style="font-size:13px;margin:16px 0 4px;color:var(--muted);">Presentación de compra</h3>
        <div class="fila">
          <div>${labelInfo("ins-pres-desc", "Descripción", "Cómo lo comprás. Ej: Barra 5 kg, Caja 12 u, Bidón 5 L.")}<input id="ins-pres-desc" placeholder="Ej: Barra 5 kg" /></div>
          <div>${labelInfo("ins-pres-cant", "Cantidad", "Cuánto trae la presentación. Ej: 5 (kg).")}<input id="ins-pres-cant" type="number" step="0.0001" placeholder="5" /></div>
          <div>${labelInfo("ins-pres-unidad", "Unidad", "Unidad de la presentación (kg, g, L, ml, unidad…).")}<select id="ins-pres-unidad"></select></div>
          <div>${labelInfo("ins-pres-precio", "Precio neto ($)", "Precio SIN IVA que pagás por esa presentación.")}<input id="ins-pres-precio" placeholder="34.000,00" /></div>
        </div>

        <h3 style="font-size:13px;margin:16px 0 4px;color:var(--muted);">Unidad de uso (la que leen las recetas)</h3>
        <div class="fila">
          <div>${labelInfo("ins-uso-mag", "Magnitud de uso", "Cómo lo usás en las recetas: volumen (ml, oz), masa (g) o unidad.")}<select id="ins-uso-mag">${magOpts}</select></div>
          <div>${labelInfo("ins-uso-unidad", "Unidad de uso", "Unidad con la que cargás el insumo en las recetas y en la que se muestra su costo. Ej: oz, cc, g.")}<select id="ins-uso-unidad"></select></div>
          <div>${labelInfo("ins-uso-cant", "Cantidad de uso que trae la presentación", "Cuántas unidades de uso trae la presentación al precio cargado. Ej: una botella de 1000 cc → 1000 (cc).")}<input id="ins-uso-cant" type="number" step="0.0001" placeholder="1000" /></div>
        </div>

        <p id="ins-preview" class="muted" style="margin-top:10px;"></p>
        <div style="margin-top:12px;display:flex;gap:8px;"><button type="submit">${textoGuardar}</button><button type="button" id="ins-cancelar" class="secundario">Cancelar</button></div>
        <p id="ins-msg" class="msg" hidden></p>
      </form>
      ${datalist("dl-rubro-ins", catalogos.opciones("rubro"))}`;
}

/**
 * Cablea el formulario (selects dependientes, cantidad de uso sugerida y vista
 * previa). Con `ins` precarga los datos de un insumo existente.
 */
function cablearForm(body, ins) {
  const q = (sel) => body.querySelector(sel);
  const magSel = q("#ins-magnitud"), uniSel = q("#ins-pres-unidad");
  const usoMag = q("#ins-uso-mag"), usoUni = q("#ins-uso-unidad"), usoCant = q("#ins-uso-cant");
  let usoMagTocada = false, usoCantTocada = false;
  const opts = (mag) => (UNIDADES_POR_MAGNITUD[mag] || []).map((u) => `<option value="${u}">${u}</option>`).join("");

  // Si la magnitud de uso es la misma que la de compra, la cantidad de uso se
  // deriva de la presentación (sigue siendo editable).
  const sugerirCantUso = () => {
    if (usoCantTocada) return;
    const cant = Number(q("#ins-pres-cant").value);
    if (usoMag.value === magSel.value && cant > 0 && uniSel.value && usoUni.value) {
      usoCant.value = String(Number(convertirDesdeUnidadBase(convertirAUnidadBase(cant, uniSel.value), usoUni.value).toFixed(4)));
    } else if (usoMag.value !== magSel.value) usoCant.value = "";
  };
  const sincronizar = () => { sugerirCantUso(); actualizarPreview(body); };

  magSel.addEventListener("change", () => {
    uniSel.innerHTML = opts(magSel.value);
    if (!usoMagTocada) { usoMag.value = magSel.value; usoUni.innerHTML = opts(usoMag.value); }
    sincronizar();
  });
  usoMag.addEventListener("change", () => { usoMagTocada = true; usoUni.innerHTML = opts(usoMag.value); usoCantTocada = false; sincronizar(); });
  usoCant.addEventListener("input", () => { usoCantTocada = true; actualizarPreview(body); });
  uniSel.innerHTML = opts(magSel.value);
  usoUni.innerHTML = opts(usoMag.value);
  ["#ins-pres-cant", "#ins-pres-unidad", "#ins-uso-unidad"].forEach((sel) => q(sel).addEventListener("input", sincronizar));
  ["#ins-pres-precio", "#ins-iva", "#ins-factor"].forEach((sel) => q(sel).addEventListener("input", () => actualizarPreview(body)));
  sincronizar();

  if (ins) {
    const unidadUso = unidadUsoDe(ins);
    const cantUsoBase = Number(ins.presentacion_cantidad_base) || 0;
    const cantUso = cantUsoBase > 0 ? Number((cantUsoBase / factorAUnidadBase(unidadUso)).toFixed(4)) : "";
    const presMag = ins.presentacion_magnitud || ins.magnitud;
    const mismaMag = presMag === ins.magnitud;
    const precio = Number(ins.presentacion_precio_neto_centavos) ||
      (cantUsoBase > 0 ? Math.round((Number(ins.costo_neto_por_unidad_base_centavos) || 0) * cantUsoBase) : 0);
    q("#ins-nombre").value = ins.nombre || "";
    q("#ins-rubro").value = ins.rubro || "";
    q("#ins-prov").value = ins.proveedor_habitual_id || "";
    q("#ins-iva").value = String(Number(ins.alicuota_iva) || 0);
    q("#ins-factor").value = String(ins.factor_correccion != null ? ins.factor_correccion : 1);
    magSel.value = presMag;
    uniSel.innerHTML = opts(presMag);
    usoMag.value = ins.magnitud;
    usoUni.innerHTML = opts(ins.magnitud);
    usoUni.value = unidadUso;
    q("#ins-pres-desc").value = ins.presentacion_desc || "";
    q("#ins-pres-cant").value = ins.presentacion_cantidad != null ? ins.presentacion_cantidad : (mismaMag ? cantUso : "");
    uniSel.value = ins.presentacion_unidad || (mismaMag ? unidadUso : uniSel.value);
    q("#ins-pres-precio").value = precio > 0 ? formatearCentavos(precio, { simbolo: false }) : "";
    usoCant.value = cantUso;
    usoMagTocada = true;
    usoCantTocada = true;
    actualizarPreview(body);
  }
}

// ---------- nuevo insumo (modal) ----------
function abrirNuevo() {
  const body = abrirModal("Nuevo insumo", { ancho: "lg" });
  body.innerHTML = formInsumoHTML("Guardar insumo");
  cablearForm(body);
  body.querySelector("#form-insumo").addEventListener("submit", (e) => alta(e, body));
  body.querySelector("#ins-cancelar").addEventListener("click", cerrarModal);
  body.querySelector("#ins-nombre").focus();
}

function calcularCosto(container) {
  const q = (sel) => container.querySelector(sel);
  const cant = Number(q("#ins-pres-cant").value);
  const unidadCompra = q("#ins-pres-unidad").value;
  const precioCentavos = pesosACentavos(q("#ins-pres-precio").value);
  const magUso = q("#ins-uso-mag").value;
  const unidadUso = q("#ins-uso-unidad").value;
  const cantUso = Number(q("#ins-uso-cant").value);
  if (!cant || cant <= 0 || !unidadCompra || precioCentavos <= 0 || !cantUso || cantUso <= 0 || !unidadUso) return null;
  const cantidadBase = convertirAUnidadBase(cantUso, unidadUso); // unidades base de USO por presentación
  return {
    magnitud: magUso, unidad_base: unidadBaseDe(magUso), unidadUso, cantidadBase, precioCentavos,
    costoNetoBase: costoNetoPorUnidadBase(precioCentavos, cantidadBase),
    presentacion: { magnitud: q("#ins-magnitud").value, cantidad: cant, unidad: unidadCompra },
  };
}

function actualizarPreview(container) {
  const el = container.querySelector("#ins-preview");
  const c = calcularCosto(container);
  if (!c) { el.textContent = "Completá la presentación y la cantidad de uso para ver el costo por unidad de uso."; return; }
  const iva = Number(container.querySelector("#ins-iva").value) || 0;
  const factor = Number(container.querySelector("#ins-factor").value) || 1;
  const conIva = costoRealPorUnidadBase({ costo_neto_por_unidad_base_centavos: c.costoNetoBase, alicuota_iva: iva, factor_correccion: factor });
  const f = factorAUnidadBase(c.unidadUso);
  el.innerHTML = `Costo neto: <strong>${formatearCentavos(c.costoNetoBase * f)}</strong> por ${escapar(c.unidadUso)} · con IVA y merma: <strong>${formatearCentavos(conIva * f)}</strong> por ${escapar(c.unidadUso)}`;
}

async function refrescar(container) {
  const cont = container.querySelector("#ins-lista");
  cont.innerHTML = "<p class='muted'>Cargando…</p>";
  try {
    const lista = await insumosRepo.listar();
    if (!lista.length) { cont.innerHTML = "<p class='muted'>Todavía no hay insumos. Cargá el primero con “+ Nuevo insumo”.</p>"; return; }
    const filas = lista.map((i) => {
      const conIva = costoRealPorUnidadBase(i);
      return `<tr>
        <td>${escapar(i.nombre)}<div class="muted" style="font-size:11px;">${escapar(i.codigo || "")}${i.rubro ? " · " + escapar(i.rubro) : ""}</div></td>
        <td class="num">${i.presentacion_precio_neto_centavos ? formatearCentavos(i.presentacion_precio_neto_centavos) : "—"}${i.presentacion_desc ? `<div class="muted" style="font-size:11px;">${escapar(i.presentacion_desc)}</div>` : ""}</td>
        <td>${escapar(unidadUsoDe(i))}</td>
        <td class="num">${escapar(formatearPorcentaje(Number(i.alicuota_iva) || 0, 1))}</td>
        <td class="num">${formatearCentavos(porUnidadUso(conIva, i))}</td>
        <td class="muted">${fmtFecha(i.fecha_ultimo_precio)}</td>
        <td style="white-space:nowrap;text-align:right;">
          <button class="secundario ins-ficha" data-id="${i.id}">Ficha</button>
          <button class="btn-baja ins-baja" data-id="${i.id}">Baja</button>
        </td>
      </tr>`;
    }).join("");
    cont.innerHTML = `<table>
      <thead><tr><th>Insumo</th><th class="num">Precio presentación (neto)</th><th>U. uso</th><th class="num">IVA</th><th class="num">Costo c/IVA / u. uso</th><th>Últ. precio</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table>
      <p class="muted" style="margin-top:6px;">Los costos se muestran por unidad de uso (la que leen las recetas).</p>`;
    const byId = Object.fromEntries(lista.map((i) => [i.id, i]));
    cont.querySelectorAll(".ins-ficha").forEach((b) => b.addEventListener("click", () => modalFicha(byId[b.dataset.id])));
    cont.querySelectorAll(".ins-baja").forEach((b) => b.addEventListener("click", () => baja(b.dataset.id, container)));
  } catch (err) {
    cont.innerHTML = `<p class="error">Error al listar: ${escapar(err.message || String(err))}</p>`;
  }
}

async function alta(e, container) {
  e.preventDefault();
  const msg = container.querySelector("#ins-msg");
  const c = calcularCosto(container);
  if (!c) { setMsg(msg, "Completá la presentación de compra (cantidad, unidad y precio) y la cantidad de uso.", "error"); return; }
  const rubro = container.querySelector("#ins-rubro").value.trim();
  setMsg(msg, "Guardando…");
  try {
    await catalogos.asegurar(PERFIL.empresa_id, "rubro", rubro);
    await insumosRepo.crear(PERFIL.empresa_id, {
      nombre: container.querySelector("#ins-nombre").value,
      rubro,
      proveedor_habitual_id: container.querySelector("#ins-prov").value || null,
      magnitud: c.magnitud,
      unidad_base: c.unidad_base,
      costo_neto_por_unidad_base_centavos: c.costoNetoBase,
      alicuota_iva: Number(container.querySelector("#ins-iva").value) || 0,
      factor_correccion: Number(container.querySelector("#ins-factor").value) || 1,
      presentacion_desc: container.querySelector("#ins-pres-desc").value,
      presentacion_cantidad_base: c.cantidadBase,
      presentacion_precio_neto_centavos: c.precioCentavos,
      presentacion_magnitud: c.presentacion.magnitud,
      presentacion_cantidad: c.presentacion.cantidad,
      presentacion_unidad: c.presentacion.unidad,
      unidad_uso: c.unidadUso,
    });
    cerrarModal();
    toast("Insumo creado ✔");
    await refrescar(CONT);
  } catch (err) {
    setMsg(msg, "No se pudo crear: " + (err.message || err), "error");
  }
}

async function baja(id, container) {
  if (!(await confirmar({ titulo: "Dar de baja", mensaje: "¿Dar de baja este insumo?", textoOk: "Dar de baja", peligro: true }))) return;
  try { await insumosRepo.desactivar(id); await refrescar(container); toast("Insumo dado de baja"); }
  catch (err) { toast("Error: " + (err.message || err), "error"); }
}

// ---------- actualizar precio ----------
function modalPrecio(insumo) {
  const body = abrirModal(`Actualizar precio — ${insumo.nombre}`);
  const tienePres = insumo.presentacion_cantidad_base > 0;
  const actual = insumo.costo_neto_por_unidad_base_centavos || 0;
  body.innerHTML = `
    <p class="muted" style="margin-top:0;">Costo neto actual: <strong>${formatearCentavos(porUnidadUso(actual, insumo))}</strong> por ${escapar(unidadUsoDe(insumo))}${insumo.presentacion_precio_neto_centavos ? ` · presentación: <strong>${formatearCentavos(insumo.presentacion_precio_neto_centavos)}</strong>` : ""}.</p>
    <form id="ip-form">
      ${tienePres
        ? `<div>${labelInfo("ip-precio", `Nuevo precio neto de la presentación ($)`, `Precio SIN IVA de: ${escapar(insumo.presentacion_desc || "la presentación")} (${Number(insumo.presentacion_cantidad_base) / factorAUnidadBase(unidadUsoDe(insumo))} ${escapar(unidadUsoDe(insumo))}).`)}
             <input id="ip-precio" placeholder="0,00" /></div>`
        : `<div>${labelInfo("ip-precio", `Nuevo costo neto por ${escapar(unidadUsoDe(insumo))} ($)`, "Costo por unidad de uso, sin IVA.")}
             <input id="ip-precio" placeholder="0,00" /></div>`}
      <p id="ip-preview" class="muted" style="margin-top:8px;"></p>
      <div style="margin-top:14px;display:flex;gap:8px;"><button type="submit">Guardar precio</button>
        <button type="button" id="ip-cancelar" class="secundario">Cancelar</button></div>
      <p id="ip-msg" class="msg" hidden></p>
    </form>`;

  const nuevoBase = () => {
    const p = pesosACentavos(body.querySelector("#ip-precio").value);
    if (p <= 0) return null;
    return tienePres ? costoNetoPorUnidadBase(p, insumo.presentacion_cantidad_base) : p / factorAUnidadBase(unidadUsoDe(insumo));
  };
  const preview = () => {
    const nb = nuevoBase();
    const el = body.querySelector("#ip-preview");
    if (nb == null) { el.textContent = ""; return; }
    const vari = actual > 0 ? ((nb - actual) / actual) * 100 : 0;
    el.innerHTML = `Nuevo costo neto: <strong>${formatearCentavos(porUnidadUso(nb, insumo))}</strong> por ${escapar(unidadUsoDe(insumo))} · ` +
      `variación <strong style="color:${vari > 0 ? "var(--error)" : vari < 0 ? "var(--ok)" : "var(--muted)"}">${vari > 0 ? "+" : ""}${escapar(formatearPorcentaje(vari))}</strong>`;
  };
  body.querySelector("#ip-precio").addEventListener("input", preview);
  body.querySelector("#ip-cancelar").addEventListener("click", cerrarModal);
  body.querySelector("#ip-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nb = nuevoBase();
    if (nb == null) { setMsg(body.querySelector("#ip-msg"), "Ingresá un precio válido.", "error"); return; }
    setMsg(body.querySelector("#ip-msg"), "Guardando…");
    try {
      await insumosRepo.actualizarCosto(PERFIL.empresa_id, insumo.id, nb, {
        origen: "manual",
        presentacion_precio_neto_centavos: tienePres ? pesosACentavos(body.querySelector("#ip-precio").value) : null,
      });
      let n = 0; try { n = await recetasRepo.recalcularTodas(); } catch (_e) {}
      cerrarModal();
      toast(`Precio actualizado ✔ · ${n} receta(s) recalculada(s)`);
      await refrescar(CONT);
    } catch (err) { setMsg(body.querySelector("#ip-msg"), "No se pudo guardar: " + (err.message || err), "error"); }
  });
}

// ---------- ficha ----------
async function modalFicha(insumo) {
  const body = abrirModal(`Ficha — ${insumo.nombre}`, { ancho: "lg" });
  body.innerHTML = "<p class='muted'>Cargando…</p>";
  let hist = [];
  try { hist = await insumosRepo.historial(insumo.id); } catch (_e) {}
  const conIva = costoRealPorUnidadBase(insumo);
  const prov = insumo.proveedor_habitual_id ? provMap[insumo.proveedor_habitual_id] : null;

  const dato = (t, v) => `<div><div class="muted" style="font-size:12px;">${t}</div><div>${v}</div></div>`;
  const histFilas = [...hist].reverse().slice(0, 8).map((h) => `<tr>
    <td>${fmtFecha(h.fecha)}</td>
    <td class="num">${formatearCentavos(h.costo_nuevo_centavos)}</td>
    <td class="num" style="color:${h.variacion_porcentual > 0 ? "var(--error)" : h.variacion_porcentual < 0 ? "var(--ok)" : "var(--muted)"};">${h.variacion_porcentual > 0 ? "+" : ""}${escapar(formatearPorcentaje(h.variacion_porcentual))}</td>
  </tr>`).join("");

  body.innerHTML = `
    <div class="fila" style="gap:20px;">
      ${dato("Código", escapar(insumo.codigo || "—"))}
      ${dato("Rubro", escapar(insumo.rubro || "—"))}
      ${dato("Unidad de uso", escapar(unidadUsoDe(insumo)))}
      ${dato("Alícuota IVA", escapar(formatearPorcentaje(Number(insumo.alicuota_iva) || 0, 1)))}
      ${dato("Factor corrección", escapar(String(insumo.factor_correccion)))}
    </div>
    <div class="fila" style="gap:20px;margin-top:10px;">
      ${dato("Costo neto", `<strong>${formatearCentavos(porUnidadUso(insumo.costo_neto_por_unidad_base_centavos, insumo))}</strong> / ${escapar(unidadUsoDe(insumo))}`)}
      ${dato("Costo c/IVA", `<strong>${formatearCentavos(porUnidadUso(conIva, insumo))}</strong> / ${escapar(unidadUsoDe(insumo))}`)}
      ${dato("Presentación", escapar(insumo.presentacion_desc || "—") + (insumo.presentacion_precio_neto_centavos ? ` · <strong>${formatearCentavos(insumo.presentacion_precio_neto_centavos)}</strong> neto` : "") + (insumo.presentacion_cantidad_base ? `<div class="muted" style="font-size:12px;">Trae ${Number(insumo.presentacion_cantidad_base) / factorAUnidadBase(unidadUsoDe(insumo))} ${escapar(unidadUsoDe(insumo))}</div>` : ""))}
      ${dato("Proveedor habitual", escapar(prov ? prov.nombre : "—"))}
      ${dato("Últ. actualización", fmtFecha(insumo.fecha_ultimo_precio))}
    </div>
    <div style="margin:16px 0 8px;display:flex;gap:8px;">
      <button id="fi-precio">Actualizar precio</button>
      <button id="fi-editar" class="secundario">Editar datos</button>
    </div>
    <h3 class="muted" style="margin:12px 0 4px;">Historial de precios</h3>
    ${hist.length ? `<div class="tabla-scroll"><table><thead><tr><th>Fecha</th><th class="num">Costo</th><th class="num">Var.</th></tr></thead><tbody>${histFilas}</tbody></table></div>` : "<p class='muted'>Sin historial.</p>"}`;

  body.querySelector("#fi-precio").addEventListener("click", () => modalPrecio(insumo));
  body.querySelector("#fi-editar").addEventListener("click", () => modalEditar(insumo));
}

// ---------- editar insumo (todos los campos) ----------
function modalEditar(insumo) {
  const body = abrirModal(`Editar — ${insumo.nombre}`, { ancho: "lg" });
  body.innerHTML = formInsumoHTML("Guardar cambios");
  cablearForm(body, insumo);
  body.querySelector("#ins-cancelar").addEventListener("click", cerrarModal);
  body.querySelector("#form-insumo").addEventListener("submit", (e) => guardarEdicion(e, body, insumo));
}

async function guardarEdicion(e, body, insumo) {
  e.preventDefault();
  const msg = body.querySelector("#ins-msg");
  const nombre = body.querySelector("#ins-nombre").value.trim();
  if (!nombre) { setMsg(msg, "El nombre es obligatorio.", "error"); return; }
  const c = calcularCosto(body);
  if (!c) { setMsg(msg, "Completá la presentación de compra (cantidad, unidad y precio) y la cantidad de uso.", "error"); return; }

  // Cambiar la unidad base (magnitud de uso) altera el significado de las
  // cantidades ya cargadas en recetas: avisar antes de seguir.
  if (c.unidad_base !== insumo.unidad_base) {
    let usadoEn = [];
    try { usadoEn = (await recetasRepo.listar()).filter((r) => (r.ingredientes || []).some((g) => g.tipo === "insumo" && g.ref_id === insumo.id)); } catch (_e) {}
    if (usadoEn.length) {
      const ok = await confirmar({
        titulo: "Cambiar magnitud de uso",
        mensaje: `Este insumo se usa en ${usadoEn.length} receta(s) (${usadoEn.slice(0, 3).map((r) => r.nombre).join(", ")}${usadoEn.length > 3 ? "…" : ""}). Sus cantidades están en ${insumo.unidad_base}; al pasar a ${c.unidad_base} tenés que revisarlas. ¿Continuar?`,
        textoOk: "Continuar", peligro: true,
      });
      if (!ok) return;
    }
  }

  const rubro = body.querySelector("#ins-rubro").value.trim();
  setMsg(msg, "Guardando…");
  try {
    await catalogos.asegurar(PERFIL.empresa_id, "rubro", rubro);
    await insumosRepo.actualizarMeta(insumo.id, {
      nombre, rubro,
      proveedor_habitual_id: body.querySelector("#ins-prov").value || null,
      alicuota_iva: Number(body.querySelector("#ins-iva").value) || 0,
      factor_correccion: Number(body.querySelector("#ins-factor").value) || 1,
      magnitud: c.magnitud,
      unidad_base: c.unidad_base,
      unidad_uso: c.unidadUso,
      presentacion_desc: body.querySelector("#ins-pres-desc").value.trim() || null,
      presentacion_cantidad_base: c.cantidadBase,
      presentacion_precio_neto_centavos: c.precioCentavos,
      presentacion_magnitud: c.presentacion.magnitud,
      presentacion_cantidad: c.presentacion.cantidad,
      presentacion_unidad: c.presentacion.unidad,
    });
    // Si cambió el costo (precio o cantidad), queda registrado en el historial.
    if (c.costoNetoBase !== Number(insumo.costo_neto_por_unidad_base_centavos)) {
      await insumosRepo.actualizarCosto(PERFIL.empresa_id, insumo.id, c.costoNetoBase, {
        origen: "manual", presentacion_precio_neto_centavos: c.precioCentavos,
      });
    }
    let n = 0; try { n = await recetasRepo.recalcularTodas(); } catch (_e) {}
    cerrarModal();
    toast(n ? `Insumo actualizado ✔ · ${n} receta(s) recalculada(s)` : "Insumo actualizado ✔");
    await refrescar(CONT);
  } catch (err) { setMsg(msg, "No se pudo guardar: " + (err.message || err), "error"); }
}
