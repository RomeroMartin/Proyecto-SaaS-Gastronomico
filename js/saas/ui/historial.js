// ============================================================
// saas/ui/historial.js — Historial de precios por insumo
// ============================================================

import * as insumosRepo from "../data/insumosRepo.js";
import * as proveedoresRepo from "../data/proveedoresRepo.js";
import { factorAUnidadBase } from "../../core/unidades.js";
import { formatearCentavos, formatearPorcentaje } from "../../core/dinero.js";
import { escapar } from "./helpers.js";

let INSUMOS = [];
let PROVEEDORES = [];
let SELECCIONADO = null;
const $ = (c, s) => c.querySelector(s);
/** Factor para mostrar el costo (guardado por unidad base) en la unidad de uso. */
const factorUso = (i) => factorAUnidadBase(i.unidad_uso || i.unidad_base);
const unidadUso = (i) => i.unidad_uso || i.unidad_base;
const fmtFecha = (iso) => (iso ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso)) : "—");

export async function montar(container) {
  container.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0;">Historial de precios</h2>
      <div class="toolbar">
        <input id="hp-buscar" type="search" placeholder="Buscar insumo por nombre o código…" style="flex:1;min-width:200px;" />
        <select id="hp-rubro"><option value="">Todos los rubros</option></select>
        <select id="hp-prov"><option value="">Todos los proveedores</option></select>
        <select id="hp-orden">
          <option value="nombre">Orden: nombre A-Z</option>
          <option value="reciente">Orden: precio actualizado recientemente</option>
          <option value="antiguo">Orden: precio más desactualizado</option>
        </select>
        <span class="cuenta" id="hp-cuenta"></span>
      </div>
      <div id="hp-lista" class="tabla-scroll" style="max-height:260px;overflow-y:auto;"></div>
    </div>
    <div id="hp-detalle"></div>`;
  try {
    [INSUMOS, PROVEEDORES] = await Promise.all([insumosRepo.listar(), proveedoresRepo.listar().catch(() => [])]);
  } catch (err) {
    $(container, "#hp-detalle").innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`;
    return;
  }
  SELECCIONADO = null;
  const rubros = [...new Set(INSUMOS.map((i) => i.rubro).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $(container, "#hp-rubro").innerHTML += rubros.map((r) => `<option value="${escapar(r)}">${escapar(r)}</option>`).join("");
  $(container, "#hp-prov").innerHTML += PROVEEDORES.map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("");
  ["#hp-buscar", "#hp-rubro", "#hp-prov", "#hp-orden"].forEach((sel) =>
    $(container, sel).addEventListener("input", () => dibujarLista(container)));
  dibujarLista(container);
}

function dibujarLista(container) {
  const q = ($(container, "#hp-buscar").value || "").toLowerCase().trim();
  const rubro = $(container, "#hp-rubro").value;
  const prov = $(container, "#hp-prov").value;
  const orden = $(container, "#hp-orden").value;

  const lista = INSUMOS.filter((i) => {
    if (q && !((i.nombre || "").toLowerCase().includes(q) || (i.codigo || "").toLowerCase().includes(q))) return false;
    if (rubro && i.rubro !== rubro) return false;
    if (prov && i.proveedor_habitual_id !== prov) return false;
    return true;
  });
  const t = (i) => (i.fecha_ultimo_precio ? new Date(i.fecha_ultimo_precio).getTime() : 0);
  lista.sort((a, b) => orden === "reciente" ? t(b) - t(a) : orden === "antiguo" ? t(a) - t(b)
    : (a.nombre || "").localeCompare(b.nombre || ""));

  $(container, "#hp-cuenta").textContent = `${lista.length} de ${INSUMOS.length}`;
  const cont = $(container, "#hp-lista");
  if (!INSUMOS.length) { cont.innerHTML = "<p class='muted'>No hay insumos cargados.</p>"; return; }
  if (!lista.length) { cont.innerHTML = "<p class='muted'>No hay insumos que coincidan.</p>"; return; }
  cont.innerHTML = `<table><tbody>${lista.map((i) => `
    <tr class="hp-fila" data-id="${i.id}" style="cursor:pointer;${i.id === SELECCIONADO ? "background:var(--hover);" : ""}">
      <td>${escapar(i.nombre)}<div class="muted" style="font-size:11px;">${escapar(i.codigo || "")}${i.rubro ? " · " + escapar(i.rubro) : ""}</div></td>
      <td class="num">${formatearCentavos((i.costo_neto_por_unidad_base_centavos || 0) * factorUso(i))} <span class="muted">/ ${escapar(unidadUso(i))}</span></td>
      <td class="muted">${fmtFecha(i.fecha_ultimo_precio)}</td>
    </tr>`).join("")}</tbody></table>`;
  cont.querySelectorAll(".hp-fila").forEach((tr) => tr.addEventListener("click", () => {
    SELECCIONADO = tr.dataset.id;
    cont.querySelectorAll(".hp-fila").forEach((x) => { x.style.background = x === tr ? "var(--hover)" : ""; });
    seleccionar(container, tr.dataset.id);
  }));
}

async function seleccionar(container, id) {
  const det = $(container, "#hp-detalle");
  if (!id) { det.innerHTML = ""; return; }
  det.innerHTML = "<p class='muted'>Cargando…</p>";
  const insumo = INSUMOS.find((i) => i.id === id);
  let hist = [];
  try { hist = await insumosRepo.historial(id); } catch (err) { det.innerHTML = `<p class="error">${escapar(err.message)}</p>`; return; }

  if (!hist.length) { det.innerHTML = `<div class="card"><p class="muted">Sin historial para ${escapar(insumo.nombre)}.</p></div>`; return; }

  const primero = hist[0].costo_nuevo_centavos;
  const ultimo = hist[hist.length - 1].costo_nuevo_centavos;
  const variacionTotal = primero > 0 ? ((ultimo - primero) / primero) * 100 : 0;

  const filas = [...hist].reverse().map((h) => `<tr>
    <td>${fmtFecha(h.fecha)}</td>
    <td class="num">${formatearCentavos(h.costo_nuevo_centavos * factorUso(insumo))}</td>
    <td class="num" style="color:${h.variacion_porcentual > 0 ? "var(--error)" : h.variacion_porcentual < 0 ? "var(--ok)" : "var(--muted)"};">
      ${h.variacion_porcentual > 0 ? "+" : ""}${escapar(formatearPorcentaje(h.variacion_porcentual))}</td>
    <td class="muted">${escapar(h.origen)}</td>
  </tr>`).join("");

  det.innerHTML = `
    <div class="card">
      <div class="topbar"><h2 style="margin:0;">${escapar(insumo.nombre)}</h2>
        <div class="muted">Variación total:
          <strong style="color:${variacionTotal > 0 ? "var(--error)" : "var(--ok)"};">${variacionTotal > 0 ? "+" : ""}${escapar(formatearPorcentaje(variacionTotal))}</strong>
          <span style="font-size:12px;">(${formatearCentavos(primero * factorUso(insumo))} → ${formatearCentavos(ultimo * factorUso(insumo))} por ${escapar(unidadUso(insumo))})</span>
        </div>
      </div>
      ${grafico(hist)}
      <div class="tabla-scroll" style="margin-top:12px;"><table>
        <thead><tr><th>Fecha</th><th class="num">Costo (${escapar(unidadUso(insumo))})</th><th class="num">Variación</th><th>Origen</th></tr></thead>
        <tbody>${filas}</tbody></table></div>
    </div>`;
}

/** Mini gráfico de líneas (SVG) de la evolución del costo. */
function grafico(hist) {
  if (hist.length < 2) return "";
  const W = 640, H = 120, P = 8;
  const vals = hist.map((h) => Number(h.costo_nuevo_centavos) || 0);
  const min = Math.min(...vals), max = Math.max(...vals);
  const rango = max - min || 1;
  const puntos = vals.map((v, i) => {
    const x = P + (i * (W - 2 * P)) / (vals.length - 1);
    const y = H - P - ((v - min) / rango) * (H - 2 * P);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<div class="tabla-scroll"><svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:${H}px;">
    <polyline fill="none" stroke="var(--tinta)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${puntos.join(" ")}" />
    ${puntos.map((p) => { const [x, y] = p.split(","); return `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--tinta)" />`; }).join("")}
  </svg></div>`;
}
