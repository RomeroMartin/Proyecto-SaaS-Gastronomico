// ============================================================
// saas/ui/insumos.js — Insumos: alta, actualización de precio (con historial),
// proveedor habitual y ficha. La UI no calcula: usa core/.
// ============================================================

import * as insumosRepo from "../data/insumosRepo.js";
import * as proveedoresRepo from "../data/proveedoresRepo.js";
import * as recetasRepo from "../data/recetasRepo.js";
import * as catalogos from "../data/catalogosRepo.js";
import { MAGNITUDES, UNIDADES_POR_MAGNITUD, unidadBaseDe, convertirAUnidadBase, costoNetoPorUnidadBase } from "../../core/unidades.js";
import { ALICUOTAS_IVA } from "../../core/fiscal.js";
import { costoRealPorUnidadBase } from "../../core/costeo.js";
import { pesosACentavos, formatearCentavos, formatearPorcentaje } from "../../core/dinero.js";
import { escapar, setMsg, labelInfo, datalist, toast, confirmar, abrirModal, cerrarModal } from "./helpers.js";

let PERFIL = null;
let CONT = null;
let PROVEEDORES = [];
let provMap = {};
const fmtFecha = (iso) => (iso ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso)) : "—");

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

// ---------- nuevo insumo (modal) ----------
function abrirNuevo() {
  const magOpts = Object.entries(MAGNITUDES).map(([k, v]) => `<option value="${k}">${v.nombre}</option>`).join("");
  const ivaOpts = ALICUOTAS_IVA.map((a) => `<option value="${a}">${a}%</option>`).join("");
  const provOpts = `<option value="">— sin proveedor —</option>` + PROVEEDORES.map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("");
  const body = abrirModal("Nuevo insumo", { ancho: "lg" });
  body.innerHTML = `
      <form id="form-insumo">
        <div class="fila">
          <div>${labelInfo("ins-nombre", "Nombre *", "Cómo llamás al insumo. Ej: Queso Mozzarella, Harina 0000.")}<input id="ins-nombre" required placeholder="Ej: Queso Mozzarella" /></div>
          <div>${labelInfo("ins-rubro", "Rubro", "Categoría del insumo. Elegí o escribí una nueva: se guarda.")}<input id="ins-rubro" list="dl-rubro-ins" placeholder="Elegí o escribí…" /></div>
          <div>${labelInfo("ins-prov", "Proveedor habitual", "Quién te lo vende normalmente (opcional).")}<select id="ins-prov">${provOpts}</select></div>
        </div>
        <div class="fila">
          <div>${labelInfo("ins-magnitud", "Magnitud", "Cómo se mide: masa (g), volumen (ml) o unidad. Define la unidad base del costo.")}<select id="ins-magnitud">${magOpts}</select></div>
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

        <p id="ins-preview" class="muted" style="margin-top:10px;"></p>
        <div style="margin-top:12px;display:flex;gap:8px;"><button type="submit">Guardar insumo</button><button type="button" id="ins-cancelar" class="secundario">Cancelar</button></div>
        <p id="ins-msg" class="msg" hidden></p>
      </form>
      ${datalist("dl-rubro-ins", catalogos.opciones("rubro"))}`;

  const magSel = body.querySelector("#ins-magnitud");
  const uniSel = body.querySelector("#ins-pres-unidad");
  const poblarUnidades = () => {
    uniSel.innerHTML = (UNIDADES_POR_MAGNITUD[magSel.value] || []).map((u) => `<option value="${u}">${u}</option>`).join("");
    actualizarPreview(body);
  };
  magSel.addEventListener("change", poblarUnidades);
  poblarUnidades();
  ["#ins-pres-cant", "#ins-pres-unidad", "#ins-pres-precio", "#ins-iva", "#ins-factor"]
    .forEach((sel) => body.querySelector(sel).addEventListener("input", () => actualizarPreview(body)));
  body.querySelector("#form-insumo").addEventListener("submit", (e) => alta(e, body));
  body.querySelector("#ins-cancelar").addEventListener("click", cerrarModal);
  body.querySelector("#ins-nombre").focus();
}

function calcularCosto(container) {
  const mag = container.querySelector("#ins-magnitud").value;
  const cant = Number(container.querySelector("#ins-pres-cant").value);
  const unidad = container.querySelector("#ins-pres-unidad").value;
  const precioCentavos = pesosACentavos(container.querySelector("#ins-pres-precio").value);
  if (!cant || cant <= 0 || !unidad || precioCentavos <= 0) return null;
  const cantidadBase = convertirAUnidadBase(cant, unidad);
  return { unidad_base: unidadBaseDe(mag), cantidadBase, precioCentavos, costoNetoBase: costoNetoPorUnidadBase(precioCentavos, cantidadBase) };
}

function actualizarPreview(container) {
  const el = container.querySelector("#ins-preview");
  const c = calcularCosto(container);
  if (!c) { el.textContent = "Completá la presentación para ver el costo por unidad base."; return; }
  const iva = Number(container.querySelector("#ins-iva").value) || 0;
  const factor = Number(container.querySelector("#ins-factor").value) || 1;
  const conIva = costoRealPorUnidadBase({ costo_neto_por_unidad_base_centavos: c.costoNetoBase, alicuota_iva: iva, factor_correccion: factor });
  el.innerHTML = `Costo neto: <strong>${formatearCentavos(c.costoNetoBase)}</strong> por ${c.unidad_base} · con IVA y merma: <strong>${formatearCentavos(conIva)}</strong> por ${c.unidad_base}`;
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
        <td>${escapar(i.unidad_base)}</td>
        <td class="num">${formatearCentavos(i.costo_neto_por_unidad_base_centavos || 0)}</td>
        <td class="num">${escapar(formatearPorcentaje(Number(i.alicuota_iva) || 0, 1))}</td>
        <td class="num">${formatearCentavos(conIva)}</td>
        <td class="muted">${fmtFecha(i.fecha_ultimo_precio)}</td>
        <td style="white-space:nowrap;text-align:right;">
          <button class="secundario ins-precio" data-id="${i.id}">Precio</button>
          <button class="secundario ins-ficha" data-id="${i.id}">Ficha</button>
          <button class="btn-baja ins-baja" data-id="${i.id}">Baja</button>
        </td>
      </tr>`;
    }).join("");
    cont.innerHTML = `<table>
      <thead><tr><th>Insumo</th><th>U. base</th><th class="num">Costo neto</th><th class="num">IVA</th><th class="num">Costo c/IVA</th><th>Últ. precio</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table>
      <p class="muted" style="margin-top:6px;">Costos por unidad base (g / ml / un).</p>`;
    const byId = Object.fromEntries(lista.map((i) => [i.id, i]));
    cont.querySelectorAll(".ins-precio").forEach((b) => b.addEventListener("click", () => modalPrecio(byId[b.dataset.id])));
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
  if (!c) { setMsg(msg, "Completá la presentación de compra (cantidad, unidad y precio).", "error"); return; }
  const rubro = container.querySelector("#ins-rubro").value.trim();
  setMsg(msg, "Guardando…");
  try {
    await catalogos.asegurar(PERFIL.empresa_id, "rubro", rubro);
    await insumosRepo.crear(PERFIL.empresa_id, {
      nombre: container.querySelector("#ins-nombre").value,
      rubro,
      proveedor_habitual_id: container.querySelector("#ins-prov").value || null,
      magnitud: container.querySelector("#ins-magnitud").value,
      unidad_base: c.unidad_base,
      costo_neto_por_unidad_base_centavos: c.costoNetoBase,
      alicuota_iva: Number(container.querySelector("#ins-iva").value) || 0,
      factor_correccion: Number(container.querySelector("#ins-factor").value) || 1,
      presentacion_desc: container.querySelector("#ins-pres-desc").value,
      presentacion_cantidad_base: c.cantidadBase,
      presentacion_precio_neto_centavos: c.precioCentavos,
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
    <p class="muted" style="margin-top:0;">Costo neto actual: <strong>${formatearCentavos(actual)}</strong> por ${escapar(insumo.unidad_base)}.</p>
    <form id="ip-form">
      ${tienePres
        ? `<div>${labelInfo("ip-precio", `Nuevo precio neto de la presentación ($)`, `Precio SIN IVA de: ${escapar(insumo.presentacion_desc || "la presentación")} (${insumo.presentacion_cantidad_base} ${escapar(insumo.unidad_base)}).`)}
             <input id="ip-precio" placeholder="0,00" /></div>`
        : `<div>${labelInfo("ip-precio", `Nuevo costo neto por ${escapar(insumo.unidad_base)} ($)`, "Costo por unidad base, sin IVA.")}
             <input id="ip-precio" placeholder="0,00" /></div>`}
      <p id="ip-preview" class="muted" style="margin-top:8px;"></p>
      <div style="margin-top:14px;display:flex;gap:8px;"><button type="submit">Guardar precio</button>
        <button type="button" id="ip-cancelar" class="secundario">Cancelar</button></div>
      <p id="ip-msg" class="msg" hidden></p>
    </form>`;

  const nuevoBase = () => {
    const p = pesosACentavos(body.querySelector("#ip-precio").value);
    if (p <= 0) return null;
    return tienePres ? costoNetoPorUnidadBase(p, insumo.presentacion_cantidad_base) : p;
  };
  const preview = () => {
    const nb = nuevoBase();
    const el = body.querySelector("#ip-preview");
    if (nb == null) { el.textContent = ""; return; }
    const vari = actual > 0 ? ((nb - actual) / actual) * 100 : 0;
    el.innerHTML = `Nuevo costo neto: <strong>${formatearCentavos(nb)}</strong> por ${escapar(insumo.unidad_base)} · ` +
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
      await insumosRepo.actualizarCosto(PERFIL.empresa_id, insumo.id, nb, { origen: "manual" });
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
      ${dato("Unidad base", escapar(insumo.unidad_base))}
      ${dato("Alícuota IVA", escapar(formatearPorcentaje(Number(insumo.alicuota_iva) || 0, 1)))}
      ${dato("Factor corrección", escapar(String(insumo.factor_correccion)))}
    </div>
    <div class="fila" style="gap:20px;margin-top:10px;">
      ${dato("Costo neto", `<strong>${formatearCentavos(insumo.costo_neto_por_unidad_base_centavos || 0)}</strong> / ${escapar(insumo.unidad_base)}`)}
      ${dato("Costo c/IVA", `<strong>${formatearCentavos(conIva)}</strong> / ${escapar(insumo.unidad_base)}`)}
      ${dato("Presentación", escapar(insumo.presentacion_desc || "—"))}
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

// ---------- editar datos ----------
function modalEditar(insumo) {
  const body = abrirModal(`Editar — ${insumo.nombre}`);
  const ivaOpts = ALICUOTAS_IVA.map((a) => `<option value="${a}" ${Number(insumo.alicuota_iva) === a ? "selected" : ""}>${a}%</option>`).join("");
  const provOpts = `<option value="">— sin proveedor —</option>` + PROVEEDORES.map((p) => `<option value="${p.id}" ${insumo.proveedor_habitual_id === p.id ? "selected" : ""}>${escapar(p.nombre)}</option>`).join("");
  body.innerHTML = `
    <form id="ie-form">
      <div>${labelInfo("ie-nombre", "Nombre *", "")}<input id="ie-nombre" value="${escapar(insumo.nombre)}" required /></div>
      <div class="fila">
        <div>${labelInfo("ie-rubro", "Rubro", "")}<input id="ie-rubro" list="dl-rubro-ed" value="${escapar(insumo.rubro || "")}" /></div>
        <div>${labelInfo("ie-iva", "Alícuota IVA", "")}<select id="ie-iva">${ivaOpts}</select></div>
        <div>${labelInfo("ie-factor", "Factor corrección", "1 = sin pérdida.")}<input id="ie-factor" type="number" step="0.0001" value="${insumo.factor_correccion}" /></div>
      </div>
      <div>${labelInfo("ie-prov", "Proveedor habitual", "")}<select id="ie-prov">${provOpts}</select></div>
      <div style="margin-top:14px;display:flex;gap:8px;"><button type="submit">Guardar</button>
        <button type="button" id="ie-cancelar" class="secundario">Cancelar</button></div>
      <p id="ie-msg" class="msg" hidden></p>
    </form>
    ${datalist("dl-rubro-ed", catalogos.opciones("rubro"))}`;

  body.querySelector("#ie-cancelar").addEventListener("click", cerrarModal);
  body.querySelector("#ie-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = body.querySelector("#ie-msg");
    const nombre = body.querySelector("#ie-nombre").value.trim();
    if (!nombre) { setMsg(msg, "El nombre es obligatorio.", "error"); return; }
    const rubro = body.querySelector("#ie-rubro").value.trim();
    setMsg(msg, "Guardando…");
    try {
      await catalogos.asegurar(PERFIL.empresa_id, "rubro", rubro);
      await insumosRepo.actualizarMeta(insumo.id, {
        nombre, rubro,
        alicuota_iva: Number(body.querySelector("#ie-iva").value) || 0,
        factor_correccion: Number(body.querySelector("#ie-factor").value) || 1,
        proveedor_habitual_id: body.querySelector("#ie-prov").value || null,
      });
      let n = 0; try { n = await recetasRepo.recalcularTodas(); } catch (_e) {}
      cerrarModal();
      toast(n ? `Insumo actualizado ✔ · ${n} receta(s) recalculada(s)` : "Insumo actualizado ✔");
      await refrescar(CONT);
    } catch (err) { setMsg(msg, "No se pudo guardar: " + (err.message || err), "error"); }
  });
}
