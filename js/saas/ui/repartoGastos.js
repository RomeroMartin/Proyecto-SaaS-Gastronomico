// ============================================================
// saas/ui/repartoGastos.js — Reparto de ingresos → Gastos fijos (ABM, solo ADMIN)
// ------------------------------------------------------------
// Alta, edición, baja lógica y orden. "Categorías de caja" = egresos del Flujo de
// caja que cuentan como "ya pagado" de ese gasto. Con RRHH activo, las categorías
// sueldos / cargas_sociales se calculan desde RRHH y no se cargan acá.
// ============================================================

import * as repo from "../data/repartoRepo.js";
import * as catalogos from "../data/catalogosRepo.js";
import { moduloActivo } from "../../core/modulos.js";
import { CATEGORIAS_RESERVADAS } from "../../core/reparto.js";
import { pesosACentavos, formatearCentavos } from "../../core/dinero.js";
import { escapar, setMsg, labelInfo, datalist, toast, confirmar, abrirModal, cerrarModal } from "./helpers.js";
import { abrirImportador } from "./importador.js";

const $ = (c, s) => c.querySelector(s);
let PERFIL = null;

export async function montar(container, perfil) {
  PERFIL = perfil;
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  let gastos;
  try { await catalogos.cargar(); gastos = await repo.listarGastos(); }
  catch (err) { container.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`; return; }
  const conRRHH = moduloActivo(perfil.empresa && perfil.empresa.modulos, "rrhh");
  const total = gastos.reduce((a, g) => a + g.monto_mensual_centavos, 0);
  const reservada = (g) => conRRHH && CATEGORIAS_RESERVADAS.includes(String(g.categoria || "").trim().toLowerCase());

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;"><h2 style="margin:0;">Reparto · Gastos fijos</h2>
      <div style="display:flex;gap:8px;"><button id="rg-importar" class="secundario">Importar desde Excel</button>
        <button id="rg-nuevo">+ Nuevo gasto fijo</button></div></div>
    ${conRRHH ? `<p class="muted" style="margin:0 0 10px;font-size:12.5px;">Los <b>sueldos y cargas</b> salen de RRHH (por empleado): no los cargues acá, así no se cuentan dos veces.</p>` : ""}
    <div class="card" style="margin-top:0;">
      ${gastos.length ? `<div class="tabla-scroll"><table>
        <thead><tr><th>Gasto</th><th>Categoría</th><th class="num">Mensual</th><th class="num">Vence</th><th>Egresos de caja que cuentan como pagado</th><th></th></tr></thead>
        <tbody>${gastos.map((g) => `<tr style="${reservada(g) ? "opacity:.55;" : ""}">
          <td>${escapar(g.nombre)}${reservada(g) ? `<div style="font-size:11.5px;color:#b45309;">Se ignora: los sueldos salen de RRHH. Dalo de baja.</div>` : ""}</td>
          <td class="muted">${escapar(g.categoria)}</td><td class="num">${formatearCentavos(g.monto_mensual_centavos)}</td>
          <td class="num">${g.dia_vencimiento || "—"}</td><td class="muted">${escapar((g.categorias_caja || []).join(", ") || "—")}</td>
          <td style="white-space:nowrap;text-align:right;"><button class="secundario" data-ed="${g.id}">Editar</button> <button class="btn-baja" data-baja="${g.id}">Baja</button></td></tr>`).join("")}
        <tr><td><b>Total gastos fijos</b></td><td></td><td class="num"><b>${formatearCentavos(total)}</b></td><td colspan="3"></td></tr></tbody></table></div>`
        : "<p class='muted' style='margin:0;'>Todavía no hay gastos fijos. Cargá el alquiler, los servicios, el retiro del dueño… cada uno es un sobre del tablero.</p>"}
    </div>`;
  $(container, "#rg-nuevo").addEventListener("click", () => editar(container, null, conRRHH));
  $(container, "#rg-importar").addEventListener("click", () => abrirImportador({ tipo: "gastos", perfil, onTerminado: () => montar(container, perfil) }));
  container.querySelectorAll("[data-ed]").forEach((b) => b.addEventListener("click", () => editar(container, gastos.find((g) => g.id === b.dataset.ed), conRRHH)));
  container.querySelectorAll("[data-baja]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await confirmar({ titulo: "Dar de baja", mensaje: "El gasto fijo deja de contarse en el tablero. ¿Seguro?", textoOk: "Dar de baja", peligro: true }))) return;
    try { await repo.darDeBajaGasto(b.dataset.baja); toast("Gasto dado de baja"); montar(container, perfil); } catch (err) { toast("Error: " + (err.message || err), "error"); }
  }));
}

function editar(container, g, conRRHH) {
  const nuevo = !g;
  const cats = catalogos.opciones("cat_gasto_fijo").filter((c) => !(conRRHH && CATEGORIAS_RESERVADAS.includes(c.toLowerCase())));
  const body = abrirModal(nuevo ? "Nuevo gasto fijo" : "Editar gasto fijo");
  body.innerHTML = `
    <div class="fila"><div style="flex:2;">${labelInfo("gf-nombre", "Nombre *", "Ej: Alquiler del local, Luz, Retiro del dueño.")}<input id="gf-nombre" value="${escapar(g ? g.nombre : "")}" /></div>
      <div>${labelInfo("gf-cat", "Categoría *", "Elegí o escribí una nueva: se guarda para la próxima.")}<input id="gf-cat" list="dl-gf" value="${escapar(g ? g.categoria : "")}" /></div></div>
    ${datalist("dl-gf", cats)}
    <div class="fila"><div>${labelInfo("gf-monto", "Monto mensual ($) *", "Lo que cuesta por mes.")}<input id="gf-monto" inputmode="decimal" value="${g ? (g.monto_mensual_centavos / 100).toString().replace(".", ",") : ""}" /></div>
      <div>${labelInfo("gf-dia", "Día de vencimiento", "Opcional (1 a 31). El tablero avisa si al ritmo actual no llega a cubrirlo.")}<input id="gf-dia" type="number" min="1" max="31" value="${g && g.dia_vencimiento ? g.dia_vencimiento : ""}" /></div>
      <div>${labelInfo("gf-orden", "Orden", "Posición en el tablero (menor primero).")}<input id="gf-orden" type="number" value="${g ? g.orden : 0}" /></div></div>
    <div>${labelInfo("gf-caja", "Egresos de caja que cuentan como pagado", "Categorías de egreso del Flujo de caja, separadas por coma. Cuando cargues un egreso con esa categoría, el sobre lo muestra como 'ya pagado'. Ej: Alquiler")}
      <input id="gf-caja" value="${escapar(g ? (g.categorias_caja || []).join(", ") : "")}" placeholder="Alquiler, Expensas" /></div>
    <p id="gf-msg" class="msg" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;"><button class="secundario" id="gf-no">Cancelar</button><button id="gf-si">${nuevo ? "Crear" : "Guardar"}</button></div>`;
  $(body, "#gf-no").addEventListener("click", cerrarModal);
  $(body, "#gf-si").addEventListener("click", async () => {
    const msg = $(body, "#gf-msg");
    const datos = {
      nombre: $(body, "#gf-nombre").value, categoria: $(body, "#gf-cat").value, monto_mensual_centavos: pesosACentavos($(body, "#gf-monto").value),
      dia_vencimiento: $(body, "#gf-dia").value, orden: $(body, "#gf-orden").value,
      categorias_caja: $(body, "#gf-caja").value.split(",").map((x) => x.trim()).filter(Boolean),
    };
    if (conRRHH && CATEGORIAS_RESERVADAS.includes(datos.categoria.trim().toLowerCase())) {
      setMsg(msg, "Los sueldos y cargas salen de RRHH: no se cargan como gasto fijo.", "error"); return;
    }
    setMsg(msg, "Guardando…");
    try {
      if (nuevo) await repo.crearGasto(PERFIL.empresa_id, datos); else await repo.actualizarGasto(g.id, datos);
      if (datos.categoria.trim()) await catalogos.asegurar(PERFIL.empresa_id, "cat_gasto_fijo", datos.categoria.trim());
      cerrarModal(); toast("Guardado ✔"); montar(container, PERFIL);
    } catch (err) { setMsg(msg, err.message || String(err), "error"); }
  });
}
