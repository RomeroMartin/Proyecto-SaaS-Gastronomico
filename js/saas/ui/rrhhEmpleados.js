// ============================================================
// saas/ui/rrhhEmpleados.js — RRHH: lista de empleados + alta/edición.
// Al abrir una ficha, reemplaza el contenido del propio contenedor
// (no hay router: el shell monta módulos con montar(container, perfil)).
// ============================================================

import * as empleadosRepo from "../data/empleadosRepo.js";
import { antiguedadTexto } from "../../core/utilsFecha.js";
import { formatearCentavos } from "../../core/dinero.js";
import { escapar, setMsg, labelInfo, kpiHTML, abrirModal, cerrarModal, toast } from "./helpers.js";
import { abrirFicha } from "./rrhhFicha.js";

let PERFIL = null;
let CONTENEDOR = null;
let EMPLEADOS = [];

const esAdmin = () => PERFIL && PERFIL.rol === "ADMIN";
const nombreCompleto = (e) => `${e.apellido || ""}, ${e.nombre || ""}`.replace(/^, |, $/g, "");
const iniciales = (e) => ((e.nombre || "?")[0] || "") .toUpperCase();

/** Badge de semáforo por estado de documentación. */
function badge(e) {
  if (e.docs_vencidos > 0) return `<span class="rrhh-badge rojo" title="${e.docs_vencidos} documento(s) vencido(s)">${e.docs_vencidos} vencido${e.docs_vencidos > 1 ? "s" : ""}</span>`;
  if (e.docs_por_vencer > 0) return `<span class="rrhh-badge ambar" title="${e.docs_por_vencer} por vencer">${e.docs_por_vencer} por vencer</span>`;
  return "";
}

function avatar(e) {
  if (e.foto_url && /^https?:\/\//.test(e.foto_url)) {
    return `<span class="rrhh-avatar"><img src="${escapar(e.foto_url)}" alt="" /></span>`;
  }
  return `<span class="rrhh-avatar">${escapar(iniciales(e))}</span>`;
}

export async function montar(container, perfil) {
  PERFIL = perfil;
  CONTENEDOR = container;
  await cargarLista();
}

async function cargarLista(filtro) {
  CONTENEDOR.innerHTML = "<p class='muted'>Cargando…</p>";
  const f = filtro || (CONTENEDOR.dataset.filtro || "activos");
  try {
    EMPLEADOS = await empleadosRepo.listarResumen(f);
  } catch (err) {
    CONTENEDOR.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`;
    return;
  }
  render(f);
}

function render(filtro) {
  const activos = EMPLEADOS.filter((e) => e.estado === "activo").length;
  const conVencidos = EMPLEADOS.filter((e) => e.docs_vencidos > 0).length;
  const conPorVencer = EMPLEADOS.filter((e) => e.docs_por_vencer > 0).length;
  const nominaMensual = EMPLEADOS
    .filter((e) => e.estado === "activo" && e.sueldo_tipo === "mensual")
    .reduce((a, e) => a + (Number(e.sueldo_actual_centavos) || 0), 0);

  const puestos = [...new Set(EMPLEADOS.map((e) => e.puesto).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  CONTENEDOR.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;">
      <h2 style="margin:0;">Empleados</h2>
      <button id="emp-nuevo">+ Nuevo empleado</button>
    </div>

    <div class="kpi-grid">
      ${kpiHTML("Empleados activos", String(activos), "en la nómina", "",
        "Cantidad de empleados con estado activo.")}
      ${kpiHTML("Con docs vencidos", String(conVencidos), "requieren acción", conVencidos ? "danger" : "ok",
        "Empleados con al menos un documento vencido (libreta sanitaria, curso de manipulación, etc.).")}
      ${kpiHTML("Con docs por vencer", String(conPorVencer), "en 30 días", conPorVencer ? "warn" : "ok",
        "Empleados con al menos un documento que vence dentro de los próximos 30 días.")}
      ${esAdmin()
        ? kpiHTML("Nómina mensual", formatearCentavos(nominaMensual), "sueldos vigentes", "",
          "Suma de los sueldos mensuales vigentes de los empleados activos. Solo visible para el dueño.")
        : ""}
    </div>

    <div class="toolbar">
      <input id="emp-buscar" type="search" placeholder="Buscar por nombre o apodo…" />
      <select id="emp-puesto"><option value="">Todos los puestos</option>${puestos.map((p) => `<option value="${escapar(p)}">${escapar(p)}</option>`).join("")}</select>
      <select id="emp-estado">
        <option value="activos" ${filtro === "activos" ? "selected" : ""}>Activos</option>
        <option value="inactivos" ${filtro === "inactivos" ? "selected" : ""}>Inactivos</option>
        <option value="todos" ${filtro === "todos" ? "selected" : ""}>Todos</option>
      </select>
      <span class="cuenta" id="emp-cuenta"></span>
    </div>

    <div class="card"><div id="emp-tabla" class="tabla-scroll"></div></div>`;

  CONTENEDOR.querySelector("#emp-nuevo").addEventListener("click", () => abrirForm(null));
  CONTENEDOR.querySelector("#emp-estado").addEventListener("change", (e) => {
    CONTENEDOR.dataset.filtro = e.target.value;
    cargarLista(e.target.value);
  });
  ["#emp-buscar", "#emp-puesto"].forEach((s) =>
    CONTENEDOR.querySelector(s).addEventListener("input", dibujar));
  dibujar();
}

function dibujar() {
  const q = (CONTENEDOR.querySelector("#emp-buscar").value || "").toLowerCase().trim();
  const puesto = CONTENEDOR.querySelector("#emp-puesto").value;

  const filtrados = EMPLEADOS.filter((e) => {
    if (puesto && e.puesto !== puesto) return false;
    if (q) {
      const txt = `${e.nombre} ${e.apellido} ${e.apodo || ""}`.toLowerCase();
      if (!txt.includes(q)) return false;
    }
    return true;
  });
  CONTENEDOR.querySelector("#emp-cuenta").textContent = `${filtrados.length} de ${EMPLEADOS.length}`;

  const cont = CONTENEDOR.querySelector("#emp-tabla");
  if (!EMPLEADOS.length) {
    cont.innerHTML = `<div class="rrhh-vacio">
      <p class="muted">Todavía no hay empleados cargados.</p>
      <button id="emp-vacio-nuevo">Cargar el primero</button></div>`;
    cont.querySelector("#emp-vacio-nuevo").addEventListener("click", () => abrirForm(null));
    return;
  }
  if (!filtrados.length) { cont.innerHTML = "<p class='muted'>No hay empleados que coincidan.</p>"; return; }

  const filas = filtrados.map((e) => `<tr class="emp-fila" data-id="${e.id}" style="cursor:pointer;">
      <td style="width:44px;">${avatar(e)}</td>
      <td>
        <div style="font-weight:600;">${escapar(nombreCompleto(e))}${e.apodo ? ` <span class="muted">(${escapar(e.apodo)})</span>` : ""}</div>
        <div class="muted" style="font-size:12px;">${escapar(e.puesto || "Sin puesto")} · ${escapar(antiguedadTexto(e.fecha_ingreso))}${e.fecha_alta ? "" : " · sin alta"}</div>
      </td>
      <td>${e.estado === "inactivo" ? '<span class="muted">Inactivo</span>' : badge(e)}</td>
      <td style="text-align:right;white-space:nowrap;"><button class="secundario emp-ver" data-id="${e.id}">Ver ficha</button></td>
    </tr>`).join("");

  cont.innerHTML = `<table>
    <thead><tr><th></th><th>Empleado</th><th>Documentación</th><th></th></tr></thead>
    <tbody>${filas}</tbody></table>`;

  const ir = (id) => abrirFicha(CONTENEDOR, PERFIL, id, () => cargarLista());
  cont.querySelectorAll(".emp-ver").forEach((b) =>
    b.addEventListener("click", (ev) => { ev.stopPropagation(); ir(b.dataset.id); }));
  cont.querySelectorAll(".emp-fila").forEach((tr) =>
    tr.addEventListener("click", () => ir(tr.dataset.id)));
}

// ---------- alta / edición ----------
function abrirForm(emp) {
  const editar = !!emp;
  const body = abrirModal(editar ? "Editar empleado" : "Nuevo empleado");
  body.innerHTML = `
    <form id="ef">
      <div class="fila">
        <div>${labelInfo("ef-nombre", "Nombre *", "Nombre de pila.")}<input id="ef-nombre" value="${escapar(emp?.nombre || "")}" required /></div>
        <div>${labelInfo("ef-apellido", "Apellido *", "Apellido.")}<input id="ef-apellido" value="${escapar(emp?.apellido || "")}" required /></div>
      </div>
      <div class="fila">
        <div>${labelInfo("ef-apodo", "Apodo", "Cómo lo llaman en el local (opcional).")}<input id="ef-apodo" value="${escapar(emp?.apodo || "")}" /></div>
        <div>${labelInfo("ef-puesto", "Puesto", "Cocina, salón, barra, delivery…")}<input id="ef-puesto" value="${escapar(emp?.puesto || "")}" /></div>
      </div>
      <div class="fila">
        <div>${labelInfo("ef-ingreso", "Fecha de ingreso *", "Cuándo empezó a trabajar realmente. Base para antigüedad y vacaciones.")}<input id="ef-ingreso" type="date" value="${escapar(emp?.fecha_ingreso || "")}" required /></div>
        <div>${labelInfo("ef-alta", "Fecha de alta", "Cuándo se lo dio de alta formalmente (registrado). Dejala vacía si todavía no está dado de alta.")}<input id="ef-alta" type="date" value="${escapar(emp?.fecha_alta || "")}" /></div>
      </div>
      <div class="fila">
        <div>${labelInfo("ef-tel", "Teléfono", "Opcional.")}<input id="ef-tel" value="${escapar(emp?.telefono || "")}" /></div>
      </div>
      <div>${labelInfo("ef-foto", "URL de foto", "Opcional. Link a una imagen (si no, se muestran las iniciales).")}<input id="ef-foto" value="${escapar(emp?.foto_url || "")}" placeholder="https://…" /></div>
      <div style="margin-top:16px;display:flex;gap:8px;">
        <button type="submit">${editar ? "Guardar" : "Crear"}</button>
        <button type="button" id="ef-cancelar" class="secundario">Cancelar</button>
      </div>
      <p id="ef-msg" class="msg" hidden></p>
    </form>`;

  const g = (s) => body.querySelector(s);
  g("#ef-cancelar").addEventListener("click", cerrarModal);
  g("#ef").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = g("#ef-msg");
    const datos = {
      nombre: g("#ef-nombre").value.trim(),
      apellido: g("#ef-apellido").value.trim(),
      apodo: g("#ef-apodo").value,
      puesto: g("#ef-puesto").value,
      fecha_ingreso: g("#ef-ingreso").value,
      fecha_alta: g("#ef-alta").value,
      telefono: g("#ef-tel").value,
      foto_url: g("#ef-foto").value,
    };
    if (!datos.nombre || !datos.apellido) { setMsg(msg, "Nombre y apellido son obligatorios.", "error"); return; }
    if (!datos.fecha_ingreso) { setMsg(msg, "Indicá la fecha de ingreso.", "error"); return; }
    if (datos.fecha_alta && datos.fecha_alta < datos.fecha_ingreso) { setMsg(msg, "La fecha de alta no puede ser anterior a la de ingreso.", "error"); return; }
    setMsg(msg, "Guardando…");
    try {
      if (editar) await empleadosRepo.actualizar(emp.id, datos);
      else await empleadosRepo.crear(PERFIL.empresa_id, datos);
      cerrarModal();
      toast(editar ? "Empleado actualizado ✔" : "Empleado creado ✔");
      await cargarLista();
    } catch (err) { setMsg(msg, "No se pudo guardar: " + (err.message || err), "error"); }
  });
}
