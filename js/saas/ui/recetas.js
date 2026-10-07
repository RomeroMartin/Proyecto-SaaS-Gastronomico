// ============================================================
// saas/ui/recetas.js — Pantalla de Recetas y costos (ficha técnica)
// ------------------------------------------------------------
// Recetas (platos) y preparaciones (sub-recetas). Calcula costo, food cost %
// y margen en vivo usando core/costeo.js. La UI no calcula: usa el core.
// ============================================================

import * as recetasRepo from "../data/recetasRepo.js";
import * as insumosRepo from "../data/insumosRepo.js";
import * as catalogos from "../data/catalogosRepo.js";
import { UNIDADES_POR_MAGNITUD, factorAUnidadBase } from "../../core/unidades.js";
import { costoReceta, validarGrafoReceta, rentabilidad, precioSugerido } from "../../core/costeo.js";
import { pesosACentavos, formatearCentavos, formatearPorcentaje } from "../../core/dinero.js";
import { escapar, setMsg, labelInfo, datalist, toast, confirmar, abrirModal, cerrarModal } from "./helpers.js";

let PERFIL = null;
let INSUMOS = [];
let RECETAS = [];
let insumoPorId = {};
let recetaPorId = {};

// Estado del editor (id null = alta nueva).
let ed = nuevoEditor();
function nuevoEditor() {
  return { id: null, ingredientes: [] };
}

let TAB = "plato"; // "plato" | "preparacion"

export async function montar(container, perfil) {
  PERFIL = perfil;
  container.innerHTML = `
    <div class="card">
      <div class="topbar">
        <h2>Recetas y costos</h2>
        <button id="rec-refrescar" class="secundario">Refrescar</button>
      </div>
      <div class="tabs" id="rec-tabs" style="margin-top:10px;">
        <button class="tab ${TAB === "plato" ? "activo" : ""}" data-tab="plato">Platos</button>
        <button class="tab ${TAB === "preparacion" ? "activo" : ""}" data-tab="preparacion">Preparaciones</button>
      </div>
      <div id="rec-listas"></div>
    </div>`;

  container.querySelector("#rec-refrescar").addEventListener("click", () => cargar(container));
  container.querySelectorAll("#rec-tabs .tab").forEach((b) => b.addEventListener("click", () => {
    TAB = b.dataset.tab;
    container.querySelectorAll("#rec-tabs .tab").forEach((x) => x.classList.toggle("activo", x === b));
    renderListas(container);
  }));
  await cargar(container);
}

async function cargar(container) {
  const listasEl = container.querySelector("#rec-listas");
  listasEl.innerHTML = "<p class='muted'>Cargando…</p>";
  try {
    [INSUMOS, RECETAS] = await Promise.all([insumosRepo.listar(), recetasRepo.listar()]);
    insumoPorId = Object.fromEntries(INSUMOS.map((i) => [i.id, i]));
    recetaPorId = Object.fromEntries(RECETAS.map((r) => [r.id, r]));
    renderListas(container);
  } catch (err) {
    listasEl.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`;
  }
}

// ---------- costeo ----------
function ctxCosteo() {
  return {
    getInsumo: (id) => insumoPorId[id] || null,
    getReceta: (id) => (id === "__edit__" ? recetaEditada() : recetaPorId[id]) || null,
  };
}
function costoDe(receta) {
  try { return costoReceta(receta, ctxCosteo()); } catch (_e) { return null; }
}

// ---------- listados ----------
function renderListas(container) {
  const el = container.querySelector("#rec-listas");
  const esPlato = TAB === "plato";
  const delTipo = RECETAS.filter((r) => r.tipo === TAB);
  const sectores = [...new Set(delTipo.map((r) => r.sector_venta).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  el.innerHTML = `
    <div class="toolbar" style="margin-top:12px;">
      <input id="rec-buscar" type="search" placeholder="Buscar por nombre…" style="flex:1;min-width:180px;" />
      ${esPlato ? `<select id="rec-fsector"><option value="">Todos los sectores</option>${sectores.map((x) => `<option value="${escapar(x)}">${escapar(x)}</option>`).join("")}</select>` : ""}
      <select id="rec-orden">
        <option value="nombre">Nombre A-Z</option>
        <option value="costo-desc">Mayor costo</option>
        <option value="costo-asc">Menor costo</option>
        ${esPlato ? `<option value="fc-desc">Mayor food cost</option><option value="fc-asc">Menor food cost</option>
        <option value="margen-desc">Mayor margen</option><option value="precio-desc">Mayor precio de carta</option>` : ""}
      </select>
      <span class="cuenta" id="rec-cuenta"></span>
      <button id="rec-nueva">${esPlato ? "+ Nuevo plato" : "+ Nueva preparación"}</button>
    </div>
    <div id="rec-tabla"></div>`;

  ["#rec-buscar", "#rec-fsector", "#rec-orden"].forEach((sel) => {
    const e = el.querySelector(sel);
    if (e) e.addEventListener("input", () => dibujarTabla(container));
  });
  el.querySelector("#rec-nueva").addEventListener("click", () => nueva(container, TAB));
  dibujarTabla(container);
}

function dibujarTabla(container) {
  const el = container.querySelector("#rec-listas");
  const esPlato = TAB === "plato";
  const q = (el.querySelector("#rec-buscar").value || "").toLowerCase().trim();
  const sector = esPlato ? el.querySelector("#rec-fsector").value : "";
  const orden = el.querySelector("#rec-orden").value;

  const todos = RECETAS.filter((r) => r.tipo === TAB);
  const items = todos.map((r) => {
    const costo = costoDe(r);
    return { r, costo, rent: esPlato && costo != null ? rentabilidad(r, costo) : null };
  }).filter(({ r }) => {
    if (q && !(r.nombre || "").toLowerCase().includes(q)) return false;
    if (sector && r.sector_venta !== sector) return false;
    return true;
  });

  const num = (v) => (v == null ? -Infinity : v);
  const claves = {
    "costo": (x) => num(x.costo),
    "fc": (x) => (x.rent && x.r.precio_venta_publico_centavos > 0 ? x.rent.foodCostPct : -Infinity),
    "margen": (x) => (x.rent ? x.rent.margenBrutoCentavos : -Infinity),
    "precio": (x) => Number(x.r.precio_venta_publico_centavos) || 0,
  };
  if (orden === "nombre") items.sort((a, b) => (a.r.nombre || "").localeCompare(b.r.nombre || ""));
  else {
    const [campo, sentido] = orden.split("-");
    const dir = sentido === "asc" ? 1 : -1;
    items.sort((a, b) => (claves[campo](a) - claves[campo](b)) * dir);
  }

  el.querySelector("#rec-cuenta").textContent = `${items.length} de ${todos.length}`;
  const cont = el.querySelector("#rec-tabla");
  const etiqueta = esPlato ? "platos" : "preparaciones";
  if (!todos.length) { cont.innerHTML = `<p class='muted'>Todavía no hay ${etiqueta}. Cargá ${esPlato ? "el primero" : "la primera"} con el botón de arriba.</p>`; return; }
  if (!items.length) { cont.innerHTML = `<p class='muted'>No hay ${etiqueta} que coincidan con los filtros.</p>`; return; }

  cont.innerHTML = esPlato ? tablaPlatos(items) : tablaPreparaciones(items);
  cont.querySelectorAll(".btn-editar").forEach((b) =>
    b.addEventListener("click", () => editar(container, b.dataset.id)));
  cont.querySelectorAll(".btn-baja").forEach((b) =>
    b.addEventListener("click", () => baja(container, b.dataset.id)));
}

function tablaPlatos(items) {
  const filas = items.map(({ r, costo, rent }) => `<tr>
      <td>${escapar(r.nombre)}${r.sector_venta ? `<div class="muted" style="font-size:11px;">${escapar(r.sector_venta)}</div>` : ""}</td>
      <td class="num">${costo == null ? "—" : formatearCentavos(costo)}</td>
      <td class="num">${formatearCentavos(r.precio_venta_publico_centavos || 0)}</td>
      <td class="num">${rent ? escapar(formatearPorcentaje(rent.foodCostPct)) : "—"}</td>
      <td class="num">${rent ? formatearCentavos(rent.margenBrutoCentavos) : "—"}</td>
      <td style="white-space:nowrap;text-align:right;">
        <button class="secundario btn-editar" data-id="${r.id}">Editar</button>
        <button class="btn-baja" data-id="${r.id}">Baja</button>
      </td></tr>`).join("");
  return `<div class="tabla-scroll"><table>
      <thead><tr><th>Nombre</th><th class="num">Costo</th><th class="num">Precio carta</th>
        <th class="num">Food cost</th><th class="num">Margen</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div>`;
}

function tablaPreparaciones(items) {
  const filas = items.map(({ r, costo }) => {
    const rend = Number(r.rendimiento_cantidad) || 1;
    const costoUnit = costo == null ? null : costo / rend;
    return `<tr>
      <td>${escapar(r.nombre)}</td>
      <td class="num">${r.rendimiento_cantidad} ${escapar(r.rendimiento_unidad)}</td>
      <td class="num">${costo == null ? "—" : formatearCentavos(costo)}</td>
      <td class="num">${costoUnit == null ? "—" : formatearCentavos(costoUnit)}</td>
      <td style="white-space:nowrap;text-align:right;">
        <button class="secundario btn-editar" data-id="${r.id}">Editar</button>
        <button class="btn-baja" data-id="${r.id}">Baja</button>
      </td></tr>`;
  }).join("");
  return `<div class="tabla-scroll"><table>
      <thead><tr><th>Nombre</th><th class="num">Rinde</th><th class="num">Costo total</th>
        <th class="num">Costo x unidad</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div>`;
}

// ---------- editor ----------
function nueva(container, tipo) {
  ed = nuevoEditor();
  abrirEditor(container, { tipo });
}

function editar(container, id) {
  const r = recetaPorId[id];
  if (!r) return;
  ed = {
    id: r.id,
    ingredientes: (r.ingredientes || []).map((ing) => ({ ...ing })),
  };
  abrirEditor(container, r);
}

function abrirEditor(container, receta) {
  const esNuevo = !ed.id;
  const etiqueta = receta.tipo === "plato" ? "plato" : "preparación";
  const titulo = esNuevo ? (receta.tipo === "plato" ? "Nuevo plato" : "Nueva preparación") : `Editar ${etiqueta}: ${receta.nombre || ""}`;
  const body = abrirModal(titulo, { ancho: "lg" });
  body.id = "rec-editor";
  renderEditor(body, container, receta);
}

function recetaEditada() {
  // Objeto receta "en vivo" leído del formulario, para costear mientras se edita.
  const cont = document.querySelector("#rec-editor");
  if (!cont) return null;
  return {
    id: "__edit__",
    nombre: val(cont, "#rec-nombre"),
    tipo: val(cont, "#rec-tipo"),
    rendimiento_cantidad: Number(val(cont, "#rec-rend-cant")) || 1,
    rendimiento_unidad: val(cont, "#rec-rend-uni"),
    ingredientes: leerIngredientes(cont),
  };
}

function val(cont, sel) { const e = cont.querySelector(sel); return e ? e.value : ""; }

function renderEditor(cont, container, receta) {
  const r = receta || {};
  const esNuevo = !ed.id;
  const tipo = r.tipo || "plato";

  cont.innerHTML = `
    <div>
      <input type="hidden" id="rec-tipo" value="${tipo}" />
      <div class="fila">
        <div style="flex:1;">${labelInfo("rec-nombre", "Nombre *", "Nombre del plato o de la preparación. Ej: Pizza Margherita, Salsa de tomate.")}
          <input id="rec-nombre" value="${escapar(r.nombre || "")}" placeholder="Ej: Pizza Margherita" /></div>
      </div>
      <div class="fila">
        <div>${labelInfo("rec-rend-cant", "Rinde (cantidad)", "Cuánto produce la receta. Un plato normalmente rinde 1. Una salsa puede rendir 2000 (ml).")}
          <input id="rec-rend-cant" type="number" step="0.0001" value="${r.rendimiento_cantidad || 1}" /></div>
        <div>${labelInfo("rec-rend-uni", "Unidad", "Unidad de lo que rinde. Elegí o escribí una nueva: se guarda para la próxima.")}
          <input id="rec-rend-uni" list="dl-unidad-rend" value="${escapar(r.rendimiento_unidad || "un")}" placeholder="Elegí o escribí…" /></div>
      </div>

      <div id="rec-solo-plato" class="fila">
        <div>${labelInfo("rec-precio", "Precio de carta ($, con IVA)", "Precio al público, IVA incluido. Se compara con el costo para el food cost %.")}
          <input id="rec-precio" value="${r.precio_venta_publico_centavos ? (r.precio_venta_publico_centavos / 100).toString().replace('.', ',') : ''}" placeholder="12.500,00" /></div>
        <div>${labelInfo("rec-alicuota", "Alícuota venta (%)", "IVA de venta del plato (normalmente 21%). Se usa para el neto informativo.")}
          <input id="rec-alicuota" type="number" step="0.5" value="${r.alicuota_venta != null ? r.alicuota_venta : 21}" /></div>
        <div>${labelInfo("rec-sector", "Sector", "Dónde se prepara/despacha (Cocina, Parrilla, Barra…). Elegí o escribí uno nuevo.")}
          <input id="rec-sector" list="dl-sector" value="${escapar(r.sector_venta || "")}" placeholder="Elegí o escribí…" /></div>
      </div>
      ${datalist("dl-unidad-rend", catalogos.opciones("unidad_rendimiento"))}
      ${datalist("dl-sector", catalogos.opciones("sector"))}

      <h3 class="muted" style="margin:18px 0 6px;">Ingredientes</h3>
      <div id="rec-ings"></div>
      <button id="rec-add-ing" class="secundario" type="button" style="margin-top:8px;">+ Agregar ingrediente</button>

      <div id="rec-resultado" class="card" style="background:#fafafa;margin-top:16px;"></div>

      <div style="margin-top:16px;display:flex;gap:8px;">
        <button id="rec-guardar" type="button">${esNuevo ? (tipo === "plato" ? "Crear plato" : "Crear preparación") : "Guardar cambios"}</button>
        <button id="rec-cancelar" class="secundario" type="button">Cancelar</button>
      </div>
      <p id="rec-msg" class="msg" hidden></p>
    </div>`;

  // Ingredientes iniciales
  const ings = cont.querySelector("#rec-ings");
  const inic = ed.ingredientes.length ? ed.ingredientes : [{ tipo: "insumo", ref_id: "", cantidad: "" }];
  inic.forEach((ing) => ings.appendChild(filaIngrediente(ing)));

  cont.querySelector("#rec-add-ing").addEventListener("click", () => {
    ings.appendChild(filaIngrediente({ tipo: "insumo", ref_id: "", cantidad: "" }));
    recalcular();
  });
  cont.querySelector("#rec-guardar").addEventListener("click", () => guardar(container));
  cont.querySelector("#rec-cancelar").addEventListener("click", () => { ed = nuevoEditor(); cerrarModal(); });
  ["#rec-precio", "#rec-alicuota", "#rec-rend-cant"].forEach((s) =>
    cont.querySelector(s).addEventListener("input", recalcular));

  toggleSoloPlato(cont);
  recalcular();
}

function toggleSoloPlato(cont) {
  const esPlato = cont.querySelector("#rec-tipo").value === "plato";
  cont.querySelector("#rec-solo-plato").style.display = esPlato ? "" : "none";
}

function opcionesRef(tipo) {
  if (tipo === "receta") {
    return RECETAS.filter((r) => r.tipo === "preparacion" && r.id !== ed.id)
      .map((r) => ({ id: r.id, label: `${r.nombre} (${r.rendimiento_unidad})` }));
  }
  return INSUMOS.map((i) => ({ id: i.id, label: `${i.nombre} (${i.unidad_uso || i.unidad_base})` }));
}

function filaIngrediente(ing) {
  const row = document.createElement("div");
  row.className = "fila ing-row";
  row.style.marginBottom = "8px";
  row.innerHTML = `
    <div style="flex:0 0 130px;">
      <select class="ing-tipo">
        <option value="insumo" ${ing.tipo === "insumo" ? "selected" : ""}>Insumo</option>
        <option value="receta" ${ing.tipo === "receta" ? "selected" : ""}>Preparación</option>
      </select>
    </div>
    <div style="flex:2;"><select class="ing-ref"></select></div>
    <div style="flex:0 0 120px;"><input class="ing-cant" type="number" step="0.0001" placeholder="cantidad" value="${ing.cantidad != null ? ing.cantidad : ""}" /></div>
    <div style="flex:0 0 80px;"><select class="ing-uni" hidden></select><span class="muted ing-unidad"></span></div>
    <div style="flex:0 0 100px;text-align:right;" class="num ing-costo muted"></div>
    <div style="flex:0 0 32px;"><button type="button" class="btn-baja ing-del">✕</button></div>`;

  const tipoSel = row.querySelector(".ing-tipo");
  const refSel = row.querySelector(".ing-ref");
  const poblarRef = (selId) => {
    refSel.innerHTML = `<option value="">— elegir —</option>` +
      opcionesRef(tipoSel.value).map((o) => `<option value="${o.id}" ${o.id === selId ? "selected" : ""}>${escapar(o.label)}</option>`).join("");
  };
  poblarRef(ing.ref_id);

  // Unidad del ingrediente: para insumos, cualquiera de su magnitud (ml, cc, oz…),
  // con la unidad de uso del insumo por defecto. Para preparaciones, la de rendimiento.
  const uniSel = row.querySelector(".ing-uni");
  const uniTxt = row.querySelector(".ing-unidad");
  const poblarUni = (elegida) => {
    const ins = tipoSel.value === "insumo" ? insumoPorId[refSel.value] : null;
    const sub = tipoSel.value === "receta" ? recetaPorId[refSel.value] : null;
    uniSel.hidden = !ins;
    uniTxt.textContent = sub ? sub.rendimiento_unidad : "";
    if (!ins) { uniSel.innerHTML = ""; return; }
    uniSel.innerHTML = (UNIDADES_POR_MAGNITUD[ins.magnitud] || [ins.unidad_base])
      .map((u) => `<option value="${u}">${u}</option>`).join("");
    uniSel.value = elegida || ins.unidad_uso || ins.unidad_base;
  };
  poblarUni();
  // Receta guardada: la cantidad viene en unidad base → mostrarla en la unidad de uso.
  const insIni = ing.tipo === "insumo" ? insumoPorId[ing.ref_id] : null;
  if (insIni && ing.cantidad !== "" && ing.cantidad != null) {
    row.querySelector(".ing-cant").value = String(Number((Number(ing.cantidad) / factorAUnidadBase(uniSel.value)).toFixed(4)));
  }

  tipoSel.addEventListener("change", () => { poblarRef(""); poblarUni(); recalcular(); });
  refSel.addEventListener("change", () => { poblarUni(); recalcular(); });
  uniSel.addEventListener("change", recalcular);
  row.querySelector(".ing-cant").addEventListener("input", recalcular);
  row.querySelector(".ing-del").addEventListener("click", () => { row.remove(); recalcular(); });

  return row;
}

/** Cantidad de la fila en unidad base (la que se guarda y se costea). */
function cantidadBaseFila(row) {
  const cant = Number(row.querySelector(".ing-cant").value) || 0;
  const uni = row.querySelector(".ing-uni");
  const factor = row.querySelector(".ing-tipo").value === "insumo" && uni.value ? factorAUnidadBase(uni.value) : 1;
  return Number((cant * factor).toFixed(6));
}

function leerIngredientes(cont) {
  return [...cont.querySelectorAll(".ing-row")].map((row) => ({
    tipo: row.querySelector(".ing-tipo").value,
    ref_id: row.querySelector(".ing-ref").value,
    cantidad: cantidadBaseFila(row),
  })).filter((ing) => ing.ref_id && ing.cantidad > 0);
}

function recalcular() {
  const cont = document.querySelector("#rec-editor");
  if (!cont) return;

  // Costo por fila + unidad
  cont.querySelectorAll(".ing-row").forEach((row) => {
    const tipo = row.querySelector(".ing-tipo").value;
    const refId = row.querySelector(".ing-ref").value;
    const cant = cantidadBaseFila(row);
    const costoEl = row.querySelector(".ing-costo");
    if (!refId) { costoEl.textContent = ""; return; }
    const sub = { id: "__row__", nombre: "fila", rendimiento_cantidad: 1,
      ingredientes: [{ tipo, ref_id: refId, cantidad: cant }] };
    const c = costoDe(sub);
    costoEl.textContent = c == null ? "—" : formatearCentavos(c);
  });

  // Costo total de la receta
  const receta = recetaEditada();
  const resEl = cont.querySelector("#rec-resultado");
  const costo = costoDe(receta);
  if (costo == null) {
    resEl.innerHTML = `<span class="error">No se puede calcular (revisá referencias circulares o ingredientes faltantes).</span>`;
    return;
  }

  if (receta.tipo === "preparacion") {
    const rend = Number(receta.rendimiento_cantidad) || 1;
    resEl.innerHTML =
      `<strong>Costo total:</strong> ${formatearCentavos(costo)} · ` +
      `<strong>Costo por ${escapar(receta.rendimiento_unidad || "unidad")}:</strong> ${formatearCentavos(costo / rend)}`;
    return;
  }

  // Plato: rentabilidad
  const precioCentavos = pesosACentavos(val(cont, "#rec-precio"));
  const alicuota = Number(val(cont, "#rec-alicuota")) || 0;
  const plato = { precio_venta_publico_centavos: precioCentavos, alicuota_venta: alicuota };
  const rent = rentabilidad(plato, costo);
  const sug30 = precioSugerido(costo, 30, alicuota);
  const objetivo = Number(val(cont, "#rec-objetivo")) || 30;
  const sug = precioSugerido(costo, objetivo, alicuota);

  resEl.innerHTML = `
    <div class="fila" style="gap:24px;">
      <div><div class="muted" style="font-size:12px;">Costo receta</div><strong>${formatearCentavos(costo)}</strong></div>
      <div><div class="muted" style="font-size:12px;">Precio carta</div><strong>${formatearCentavos(precioCentavos)}</strong></div>
      <div><div class="muted" style="font-size:12px;">Food cost</div>
        <strong style="color:${rent.foodCostPct > 35 ? 'var(--error)' : 'var(--ok)'}">${precioCentavos > 0 ? escapar(formatearPorcentaje(rent.foodCostPct)) : "—"}</strong></div>
      <div><div class="muted" style="font-size:12px;">Margen</div><strong>${formatearCentavos(rent.margenBrutoCentavos)}</strong></div>
    </div>
    <hr style="border:0;border-top:1px solid var(--borde);margin:12px 0;">
    <div class="fila" style="align-items:flex-end;">
      <div style="flex:0 0 200px;">
        <label for="rec-objetivo" style="margin-top:0;">¿Precio para food cost de…?</label>
        <input id="rec-objetivo" type="number" step="1" value="${objetivo}" />
      </div>
      <div class="muted">Precio de carta sugerido: <strong>${formatearCentavos(sug.precioPublicoCentavos)}</strong>
        (para ${objetivo}%). A 30%: ${formatearCentavos(sug30.precioPublicoCentavos)}.</div>
    </div>`;
  const obj = cont.querySelector("#rec-objetivo");
  if (obj) obj.addEventListener("input", recalcular);
}

// ---------- acciones ----------
async function guardar(container) {
  const cont = document.querySelector("#rec-editor");
  const msg = cont.querySelector("#rec-msg");
  const receta = recetaEditada();
  if (!receta.nombre.trim()) { setMsg(msg, "El nombre es obligatorio.", "error"); return; }

  const ingredientes = leerIngredientes(cont);
  if (!ingredientes.length) { setMsg(msg, "Agregá al menos un ingrediente.", "error"); return; }

  // Validar ciclos/profundidad antes de guardar.
  const chequeo = validarGrafoReceta(
    { ingredientes }, (id) => recetaPorId[id], ed.id || undefined);
  if (!chequeo.ok) { setMsg(msg, "No se puede guardar: " + chequeo.motivo, "error"); return; }

  const costo = costoDe({ ...receta, id: ed.id || "__edit__" });
  const datos = {
    nombre: receta.nombre,
    tipo: receta.tipo,
    rendimiento_cantidad: receta.rendimiento_cantidad,
    rendimiento_unidad: receta.rendimiento_unidad,
    precio_venta_publico_centavos: pesosACentavos(val(cont, "#rec-precio")),
    alicuota_venta: Number(val(cont, "#rec-alicuota")) || 0,
    sector_venta: val(cont, "#rec-sector"),
  };

  setMsg(msg, "Guardando…");
  try {
    await catalogos.asegurar(PERFIL.empresa_id, "unidad_rendimiento", datos.rendimiento_unidad);
    if (receta.tipo === "plato") await catalogos.asegurar(PERFIL.empresa_id, "sector", datos.sector_venta);
    if (ed.id) {
      await recetasRepo.actualizar(PERFIL.empresa_id, ed.id, datos, ingredientes, costo || 0);
    } else {
      await recetasRepo.crear(PERFIL.empresa_id, datos, ingredientes, costo || 0);
    }
    ed = nuevoEditor();
    cerrarModal();
    toast(receta.tipo === "plato" ? "Plato guardado ✔" : "Preparación guardada ✔");
    await cargar(container);
  } catch (err) {
    setMsg(msg, "No se pudo guardar: " + (err.message || err), "error");
  }
}

async function baja(container, id) {
  if (!(await confirmar({ titulo: "Dar de baja", mensaje: "¿Dar de baja esta receta?", textoOk: "Dar de baja", peligro: true }))) return;
  try {
    await recetasRepo.desactivar(id);
    if (ed.id === id) ed = nuevoEditor();
    await cargar(container);
    toast("Receta dada de baja");
  } catch (err) {
    toast("Error: " + (err.message || err), "error");
  }
}
