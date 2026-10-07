// ============================================================
// saas/ui/rrhhFicha.js — Ficha del empleado con pestañas.
// Datos y Ausencias/Documentos: ADMIN + GERENTE.
// Legajo y Sueldo: SOLO ADMIN (datos sensibles).
// El ocultamiento es cosmético; la seguridad real está en la RLS.
// ============================================================

import * as empleadosRepo from "../data/empleadosRepo.js";
import * as legajoRepo from "../data/legajoRepo.js";
import * as sueldosRepo from "../data/sueldosRepo.js";
import * as ausenciasRepo from "../data/ausenciasRepo.js";
import * as documentosRepo from "../data/documentosRepo.js";
import * as rrhhConfigRepo from "../data/rrhhConfigRepo.js";
import { TIPOS_AUSENCIA } from "../data/ausenciasRepo.js";
import { diasCorridos, sumarMeses, formatearFecha, antiguedadTexto, hoyISO } from "../../core/utilsFecha.js";
import { prepararArchivo, formatearTamano } from "../../core/utilsImagen.js";
import { pesosACentavos, formatearCentavos } from "../../core/dinero.js";
import { escapar, setMsg, labelInfo, kpiHTML, abrirModal, cerrarModal, toast, confirmar } from "./helpers.js";

let CONT = null, PERFIL = null, EMP = null, VOLVER = null, TAB = "datos";

const esAdmin = () => PERFIL && PERFIL.rol === "ADMIN";
const nombreCompleto = (e) => `${e.nombre || ""} ${e.apellido || ""}`.trim();

const TIPO_AUS_LABEL = Object.fromEntries(TIPOS_AUSENCIA.map((t) => [t.valor, t.label]));
const MODALIDADES = ["efectivo", "eventual", "pasantia", "monotributista"];

/** Abre la ficha dentro del contenedor dado. `volver` re-renderiza la lista. */
export async function abrirFicha(container, perfil, empleadoId, volver, tabInicial = "datos") {
  CONT = container; PERFIL = perfil; VOLVER = volver;
  // Legajo/Sueldo son solo-ADMIN: si un GERENTE llega con esa pestaña, cae en Datos.
  TAB = (tabInicial === "legajo" || tabInicial === "sueldo") && perfil.rol !== "ADMIN" ? "datos" : tabInicial;
  CONT.innerHTML = "<p class='muted'>Cargando…</p>";
  try {
    EMP = await empleadosRepo.obtener(empleadoId);
  } catch (err) {
    CONT.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`;
    return;
  }
  if (!EMP) { CONT.innerHTML = "<p class='error'>Empleado no encontrado.</p>"; return; }
  render();
}

function render() {
  const tabs = [
    { id: "datos", label: "Datos" },
    esAdmin() && { id: "legajo", label: "Legajo" },
    esAdmin() && { id: "sueldo", label: "Sueldo" },
    { id: "ausencias", label: "Ausencias" },
    { id: "documentos", label: "Documentos" },
  ].filter(Boolean);

  const inactivo = EMP.estado === "inactivo";
  CONT.innerHTML = `
    <button class="rrhh-volver secundario" id="fc-volver">← Volver a empleados</button>
    <div class="rrhh-ficha-head">
      <div class="rrhh-avatar grande">${escapar((EMP.nombre || "?")[0] || "")}</div>
      <div>
        <div class="rrhh-ficha-nombre">${escapar(nombreCompleto(EMP))}${EMP.apodo ? ` <span class="muted">(${escapar(EMP.apodo)})</span>` : ""}</div>
        <div class="muted" style="font-size:13px;">${escapar(EMP.puesto || "Sin puesto")} · ${escapar(antiguedadTexto(EMP.fecha_ingreso))} · ${EMP.fecha_alta ? "Alta: " + escapar(formatearFecha(EMP.fecha_alta)) : "Sin fecha de alta"}${inactivo ? ' · <span style="color:var(--error);">Inactivo desde ' + escapar(formatearFecha(EMP.fecha_egreso)) + "</span>" : ""}</div>
      </div>
    </div>
    <div class="rrhh-tabs" id="fc-tabs">
      ${tabs.map((t) => `<button class="rrhh-tab ${t.id === TAB ? "activo" : ""}" data-tab="${t.id}">${t.label}</button>`).join("")}
    </div>
    <div id="fc-body"></div>`;

  CONT.querySelector("#fc-volver").addEventListener("click", () => { if (VOLVER) VOLVER(); });
  CONT.querySelectorAll(".rrhh-tab").forEach((b) =>
    b.addEventListener("click", () => { TAB = b.dataset.tab; render(); }));

  const body = CONT.querySelector("#fc-body");
  if (TAB === "datos") tabDatos(body);
  else if (TAB === "legajo") tabLegajo(body);
  else if (TAB === "sueldo") tabSueldo(body);
  else if (TAB === "ausencias") tabAusencias(body);
  else if (TAB === "documentos") tabDocumentos(body);
}

async function recargarEmp() {
  EMP = await empleadosRepo.obtener(EMP.id);
}

// ---------- Datos ----------
function tabDatos(body) {
  const inactivo = EMP.estado === "inactivo";
  body.innerHTML = `
    <div class="card">
      <form id="fd">
        <div class="fila">
          <div>${labelInfo("fd-nombre", "Nombre *")}<input id="fd-nombre" value="${escapar(EMP.nombre || "")}" required /></div>
          <div>${labelInfo("fd-apellido", "Apellido *")}<input id="fd-apellido" value="${escapar(EMP.apellido || "")}" required /></div>
        </div>
        <div class="fila">
          <div>${labelInfo("fd-apodo", "Apodo")}<input id="fd-apodo" value="${escapar(EMP.apodo || "")}" /></div>
          <div>${labelInfo("fd-puesto", "Puesto")}<input id="fd-puesto" value="${escapar(EMP.puesto || "")}" /></div>
        </div>
        <div class="fila">
          <div>${labelInfo("fd-ingreso", "Fecha de ingreso *", "Cuándo empezó a trabajar realmente. Base para antigüedad y vacaciones.")}<input id="fd-ingreso" type="date" value="${escapar(EMP.fecha_ingreso || "")}" required /></div>
          <div>${labelInfo("fd-alta", "Fecha de alta", "Cuándo se lo dio de alta formalmente (registrado). Dejala vacía si todavía no está dado de alta.")}<input id="fd-alta" type="date" value="${escapar(EMP.fecha_alta || "")}" /></div>
        </div>
        <div class="fila">
          <div>${labelInfo("fd-tel", "Teléfono")}<input id="fd-tel" value="${escapar(EMP.telefono || "")}" /></div>
        </div>
        <div>${labelInfo("fd-foto", "URL de foto")}<input id="fd-foto" value="${escapar(EMP.foto_url || "")}" placeholder="https://…" /></div>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
          <button type="submit">Guardar cambios</button>
          ${inactivo
            ? `<button type="button" id="fd-reactivar" class="secundario">Reactivar empleado</button>`
            : `<button type="button" id="fd-baja" class="btn-baja">Dar de baja</button>`}
        </div>
        <p id="fd-msg" class="msg" hidden></p>
      </form>
    </div>`;

  const g = (s) => body.querySelector(s);
  g("#fd").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = g("#fd-msg");
    if (g("#fd-alta").value && g("#fd-alta").value < g("#fd-ingreso").value) { setMsg(msg, "La fecha de alta no puede ser anterior a la de ingreso.", "error"); return; }
    setMsg(msg, "Guardando…");
    try {
      await empleadosRepo.actualizar(EMP.id, {
        nombre: g("#fd-nombre").value.trim(), apellido: g("#fd-apellido").value.trim(),
        apodo: g("#fd-apodo").value, puesto: g("#fd-puesto").value,
        fecha_ingreso: g("#fd-ingreso").value, fecha_alta: g("#fd-alta").value, telefono: g("#fd-tel").value,
        foto_url: g("#fd-foto").value,
      });
      await recargarEmp();
      setMsg(msg, "Guardado ✔", "ok");
      toast("Datos actualizados ✔");
    } catch (err) { setMsg(msg, "No se pudo guardar: " + (err.message || err), "error"); }
  });

  if (inactivo) {
    g("#fd-reactivar").addEventListener("click", async () => {
      try { await empleadosRepo.reactivar(EMP.id); await recargarEmp(); render(); toast("Empleado reactivado ✔"); }
      catch (err) { toast("Error: " + (err.message || err), "error"); }
    });
  } else {
    g("#fd-baja").addEventListener("click", () => modalBaja());
  }
}

function modalBaja() {
  const body = abrirModal("Dar de baja");
  body.innerHTML = `
    <p style="margin:0 0 12px;">El empleado pasa a <strong>inactivo</strong>. No se borra nada: la documentación laboral se conserva.</p>
    <div>${labelInfo("mb-fecha", "Fecha de egreso *", "Último día trabajado.")}<input id="mb-fecha" type="date" value="${hoyISO()}" /></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button type="button" class="secundario" id="mb-cancelar">Cancelar</button>
      <button type="button" class="btn-baja" id="mb-ok">Dar de baja</button>
    </div>
    <p id="mb-msg" class="msg" hidden></p>`;
  body.querySelector("#mb-cancelar").addEventListener("click", cerrarModal);
  body.querySelector("#mb-ok").addEventListener("click", async () => {
    const fecha = body.querySelector("#mb-fecha").value;
    const msg = body.querySelector("#mb-msg");
    if (!fecha) { setMsg(msg, "Indicá la fecha de egreso.", "error"); return; }
    try {
      await empleadosRepo.darDeBaja(EMP.id, fecha);
      cerrarModal(); await recargarEmp(); render(); toast("Empleado dado de baja.");
    } catch (err) { setMsg(msg, "Error: " + (err.message || err), "error"); }
  });
}

// ---------- Legajo (solo ADMIN) ----------
async function tabLegajo(body) {
  body.innerHTML = "<p class='muted'>Cargando legajo…</p>";
  let legajo;
  try { legajo = (await legajoRepo.obtener(EMP.id)) || {}; }
  catch (err) { body.innerHTML = `<p class="error">${escapar(err.message)}</p>`; return; }

  const v = (k) => escapar(legajo[k] || "");
  const modOpts = MODALIDADES.map((m) =>
    `<option value="${m}" ${legajo.modalidad === m ? "selected" : ""}>${m}</option>`).join("");
  body.innerHTML = `
    <div class="card">
      <form id="fl">
        <div class="fila">
          <div>${labelInfo("fl-dni", "DNI")}<input id="fl-dni" value="${v("dni")}" /></div>
          <div>${labelInfo("fl-cuil", "CUIL")}<input id="fl-cuil" value="${v("cuil")}" /></div>
          <div>${labelInfo("fl-nac", "Fecha de nacimiento")}<input id="fl-nac" type="date" value="${v("fecha_nacimiento")}" /></div>
        </div>
        <div class="fila">
          <div>${labelInfo("fl-dom", "Domicilio")}<input id="fl-dom" value="${v("domicilio")}" /></div>
          <div>${labelInfo("fl-loc", "Localidad")}<input id="fl-loc" value="${v("localidad")}" /></div>
        </div>
        <div class="fila">
          <div>${labelInfo("fl-cont", "Contacto de emergencia")}<input id="fl-cont" value="${v("contacto_emergencia")}" /></div>
          <div>${labelInfo("fl-telem", "Tel. de emergencia")}<input id="fl-telem" value="${v("tel_emergencia")}" /></div>
        </div>
        <div class="fila">
          <div>${labelInfo("fl-os", "Obra social")}<input id="fl-os" value="${v("obra_social")}" /></div>
          <div>${labelInfo("fl-mod", "Modalidad", "Cómo está contratado.")}<select id="fl-mod"><option value="">—</option>${modOpts}</select></div>
          <div>${labelInfo("fl-cbu", "CBU")}<input id="fl-cbu" value="${v("cbu")}" /></div>
        </div>
        <div>${labelInfo("fl-obs", "Observaciones")}<input id="fl-obs" value="${v("observaciones")}" /></div>
        <div style="margin-top:16px;"><button type="submit">Guardar legajo</button></div>
        <p id="fl-msg" class="msg" hidden></p>
      </form>
    </div>`;

  const g = (s) => body.querySelector(s);
  g("#fl").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = g("#fl-msg");
    setMsg(msg, "Guardando…");
    try {
      await legajoRepo.guardar(EMP.id, {
        dni: g("#fl-dni").value, cuil: g("#fl-cuil").value, fecha_nacimiento: g("#fl-nac").value,
        domicilio: g("#fl-dom").value, localidad: g("#fl-loc").value,
        contacto_emergencia: g("#fl-cont").value, tel_emergencia: g("#fl-telem").value,
        obra_social: g("#fl-os").value, modalidad: g("#fl-mod").value,
        cbu: g("#fl-cbu").value, observaciones: g("#fl-obs").value,
      });
      setMsg(msg, "Legajo guardado ✔", "ok");
      toast("Legajo guardado ✔");
    } catch (err) { setMsg(msg, "No se pudo guardar: " + (err.message || err), "error"); }
  });
}

// ---------- Sueldo (solo ADMIN) ----------
async function tabSueldo(body) {
  body.innerHTML = "<p class='muted'>Cargando sueldos…</p>";
  let historial;
  try { historial = await sueldosRepo.listar(EMP.id); }
  catch (err) { body.innerHTML = `<p class="error">${escapar(err.message)}</p>`; return; }

  const hoy = hoyISO();
  const vigente = historial.find((s) => s.vigencia_desde <= hoy) || null;

  const filas = historial.length ? historial.map((s) => `<tr>
      <td>${escapar(formatearFecha(s.vigencia_desde))}</td>
      <td class="num">${formatearCentavos(s.monto_centavos)}</td>
      <td>${s.tipo === "por_hora" ? "Por hora" : "Mensual"}</td>
      <td>${escapar(s.motivo || "—")}</td>
    </tr>`).join("") : `<tr><td colspan="4" class="muted">Sin sueldos cargados.</td></tr>`;

  body.innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);">
      ${kpiHTML("Sueldo vigente", vigente ? formatearCentavos(vigente.monto_centavos) : "—",
        vigente ? (vigente.tipo === "por_hora" ? "por hora" : "mensual") + " · desde " + formatearFecha(vigente.vigencia_desde) : "sin registro", vigente ? "ok" : "")}
      ${kpiHTML("Registros", String(historial.length), "en el historial", "")}
    </div>
    <div class="topbar" style="margin:6px 0 8px;">
      <h3 class="muted" style="margin:0;">Historial</h3>
      <button id="fs-nuevo">+ Registrar nuevo sueldo</button>
    </div>
    <div class="card"><div class="tabla-scroll"><table>
      <thead><tr><th>Vigente desde</th><th class="num">Monto</th><th>Tipo</th><th>Motivo</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
      <p class="muted" style="font-size:12px;margin-top:8px;">Los registros históricos no se editan: un aumento se agrega como un registro nuevo.</p>
    </div>`;

  body.querySelector("#fs-nuevo").addEventListener("click", () => modalSueldo());
}

function modalSueldo() {
  const body = abrirModal("Registrar nuevo sueldo");
  body.innerHTML = `
    <form id="fss">
      <div class="fila">
        <div>${labelInfo("fss-monto", "Monto ($) *", "En pesos. Se guarda en centavos.")}<input id="fss-monto" placeholder="0,00" /></div>
        <div>${labelInfo("fss-tipo", "Tipo")}<select id="fss-tipo"><option value="mensual">Mensual</option><option value="por_hora">Por hora</option></select></div>
      </div>
      <div class="fila">
        <div>${labelInfo("fss-desde", "Vigente desde *", "Desde qué fecha rige.")}<input id="fss-desde" type="date" value="${hoyISO()}" /></div>
        <div>${labelInfo("fss-motivo", "Motivo")}<select id="fss-motivo"><option value="">—</option><option value="ingreso">Ingreso</option><option value="paritaria">Paritaria</option><option value="ascenso">Ascenso</option><option value="ajuste">Ajuste</option></select></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;"><button type="submit">Registrar</button><button type="button" id="fss-cancelar" class="secundario">Cancelar</button></div>
      <p id="fss-msg" class="msg" hidden></p>
    </form>`;
  const g = (s) => body.querySelector(s);
  g("#fss-cancelar").addEventListener("click", cerrarModal);
  g("#fss").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = g("#fss-msg");
    const centavos = pesosACentavos(g("#fss-monto").value);
    if (centavos <= 0) { setMsg(msg, "Ingresá un monto mayor a cero.", "error"); return; }
    setMsg(msg, "Guardando…");
    try {
      await sueldosRepo.registrar(EMP.id, {
        monto_centavos: centavos, tipo: g("#fss-tipo").value,
        vigencia_desde: g("#fss-desde").value, motivo: g("#fss-motivo").value,
      });
      cerrarModal(); render(); toast("Sueldo registrado ✔");
    } catch (err) { setMsg(msg, "No se pudo guardar: " + (err.message || err), "error"); }
  });
}

// ---------- Ausencias ----------
async function tabAusencias(body) {
  body.innerHTML = "<p class='muted'>Cargando ausencias…</p>";
  const anio = new Date().getFullYear();
  let lista, saldo;
  try {
    [lista, saldo] = await Promise.all([
      ausenciasRepo.listar(EMP.id, anio),
      ausenciasRepo.saldoVacaciones(EMP.id).catch(() => null),
    ]);
  } catch (err) { body.innerHTML = `<p class="error">${escapar(err.message)}</p>`; return; }

  const filas = lista.length ? lista.map((a) => `<tr>
      <td><span class="rrhh-pill ${escapar(a.tipo)}">${escapar(TIPO_AUS_LABEL[a.tipo] || a.tipo)}</span></td>
      <td>${escapar(formatearFecha(a.desde))} → ${escapar(formatearFecha(a.hasta))}</td>
      <td class="num">${a.dias}</td>
      <td>${escapar(a.observaciones || "")}</td>
      <td style="text-align:right;"><button class="btn-baja fa-del" data-id="${a.id}">Eliminar</button></td>
    </tr>`).join("") : `<tr><td colspan="5" class="muted">Sin ausencias registradas este año.</td></tr>`;

  const saldoTono = saldo ? (saldo.saldo < 0 ? "danger" : "ok") : "";
  body.innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
      ${kpiHTML("Vacaciones que corresponden", saldo ? String(saldo.corresponden) : "—", "días corridos · " + anio, "",
        "Cálculo orientativo según antigüedad (LCT). No es vinculante: podés cargar más días si hay un acuerdo particular.")}
      ${kpiHTML("Tomados", saldo ? String(saldo.tomados) : "—", "este año", "")}
      ${kpiHTML("Saldo", saldo ? String(saldo.saldo) : "—", saldo && saldo.saldo < 0 ? "excedido" : "disponibles", saldoTono)}
    </div>
    <div class="topbar" style="margin:6px 0 8px;">
      <h3 class="muted" style="margin:0;">Ausencias ${anio}</h3>
      <button id="fa-nueva">+ Cargar ausencia</button>
    </div>
    <div class="card"><div class="tabla-scroll"><table>
      <thead><tr><th>Tipo</th><th>Período</th><th class="num">Días</th><th>Observaciones</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div></div>`;

  body.querySelector("#fa-nueva").addEventListener("click", () => modalAusencia());
  body.querySelectorAll(".fa-del").forEach((b) => b.addEventListener("click", async () => {
    if (!(await confirmar({ titulo: "Eliminar ausencia", mensaje: "¿Eliminar este registro de ausencia?", textoOk: "Eliminar", peligro: true }))) return;
    try { await ausenciasRepo.eliminar(b.dataset.id); render(); toast("Ausencia eliminada ✔"); }
    catch (err) { toast("Error: " + (err.message || err), "error"); }
  }));
}

function modalAusencia() {
  const body = abrirModal("Cargar ausencia");
  const tipoOpts = TIPOS_AUSENCIA.map((t) => `<option value="${t.valor}">${t.label}</option>`).join("");
  body.innerHTML = `
    <form id="fan">
      <div>${labelInfo("fan-tipo", "Tipo *")}<select id="fan-tipo">${tipoOpts}</select></div>
      <div class="fila">
        <div>${labelInfo("fan-desde", "Desde *")}<input id="fan-desde" type="date" value="${hoyISO()}" /></div>
        <div>${labelInfo("fan-hasta", "Hasta *")}<input id="fan-hasta" type="date" value="${hoyISO()}" /></div>
        <div>${labelInfo("fan-dias", "Días", "Se calcula solo (días corridos), pero podés ajustarlo.")}<input id="fan-dias" type="number" min="1" value="1" /></div>
      </div>
      <div>${labelInfo("fan-obs", "Observaciones")}<input id="fan-obs" /></div>
      <p id="fan-aviso" class="muted" style="margin-top:8px;" hidden></p>
      <div style="margin-top:16px;display:flex;gap:8px;"><button type="submit">Guardar</button><button type="button" id="fan-cancelar" class="secundario">Cancelar</button></div>
      <p id="fan-msg" class="msg" hidden></p>
    </form>`;
  const g = (s) => body.querySelector(s);
  let diasTocado = false;

  const recalc = () => {
    if (diasTocado) return;
    const d = diasCorridos(g("#fan-desde").value, g("#fan-hasta").value);
    if (d > 0) g("#fan-dias").value = d;
  };
  g("#fan-desde").addEventListener("change", recalc);
  g("#fan-hasta").addEventListener("change", recalc);
  g("#fan-dias").addEventListener("input", () => { diasTocado = true; });
  recalc();

  g("#fan-cancelar").addEventListener("click", cerrarModal);
  g("#fan").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = g("#fan-msg");
    const desde = g("#fan-desde").value, hasta = g("#fan-hasta").value;
    const dias = parseInt(g("#fan-dias").value, 10);
    if (!desde || !hasta) { setMsg(msg, "Indicá el rango de fechas.", "error"); return; }
    if (hasta < desde) { setMsg(msg, "La fecha 'hasta' no puede ser anterior a 'desde'.", "error"); return; }
    if (!(dias > 0)) { setMsg(msg, "Los días deben ser mayores a cero.", "error"); return; }
    setMsg(msg, "Guardando…");
    try {
      await ausenciasRepo.crear(EMP.id, { tipo: g("#fan-tipo").value, desde, hasta, dias, observaciones: g("#fan-obs").value });
      cerrarModal(); render(); toast("Ausencia registrada ✔");
    } catch (err) { setMsg(msg, err.message || String(err), "error"); }
  });
}

// ---------- Documentos ----------
async function tabDocumentos(body) {
  body.innerHTML = "<p class='muted'>Cargando documentos…</p>";
  let docs, tipos;
  try {
    [docs, tipos] = await Promise.all([
      documentosRepo.listarEstado(EMP.id),
      rrhhConfigRepo.listarTipos({ soloActivos: true }),
    ]);
  } catch (err) { body.innerHTML = `<p class="error">${escapar(err.message)}</p>`; return; }

  const ESTADO = {
    vencido: { txt: "Vencido", cls: "rojo" },
    por_vencer: { txt: "Por vencer", cls: "ambar" },
    vigente: { txt: "Vigente", cls: "verde" },
    sin_vencimiento: { txt: "Sin vencimiento", cls: "" },
  };
  const filas = docs.length ? docs.map((d) => {
    const st = ESTADO[d.estado] || { txt: d.estado, cls: "" };
    return `<tr>
      <td>${escapar(d.tipo)}</td>
      <td>${d.fecha_vencimiento ? escapar(formatearFecha(d.fecha_vencimiento)) : "—"}${d.dias_restantes != null && d.estado === "por_vencer" ? ` <span class="muted">(${d.dias_restantes}d)</span>` : ""}</td>
      <td><span class="rrhh-badge ${st.cls}">${st.txt}</span></td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="secundario fdoc-ver" data-id="${d.id}">Ver</button>
        <button class="btn-baja fdoc-del" data-id="${d.id}">Eliminar</button>
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="4" class="muted">Sin documentos cargados.</td></tr>`;

  const sinTipos = !tipos.length;
  body.innerHTML = `
    <div class="topbar" style="margin:0 0 8px;">
      <h3 class="muted" style="margin:0;">Documentación</h3>
      <button id="fdoc-nuevo" ${sinTipos ? "disabled" : ""}>+ Cargar documento</button>
    </div>
    ${sinTipos ? `<p class="muted">No hay tipos de documento configurados. Pedile al dueño que active el módulo en Configuración → RRHH.</p>` : ""}
    <div class="card"><div class="tabla-scroll"><table>
      <thead><tr><th>Tipo</th><th>Vencimiento</th><th>Estado</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div></div>`;

  if (!sinTipos) body.querySelector("#fdoc-nuevo").addEventListener("click", () => modalDocumento(tipos));

  body.querySelectorAll(".fdoc-ver").forEach((b) => b.addEventListener("click", () => verDocumento(b.dataset.id)));
  body.querySelectorAll(".fdoc-del").forEach((b) => b.addEventListener("click", () => borrarDocumento(b.dataset.id)));
}

async function verDocumento(id) {
  try {
    const path = await documentosRepo.obtenerPath(id);
    if (!path) { toast("Este documento no tiene archivo adjunto.", "info"); return; }
    const url = await documentosRepo.urlFirmada(path);
    if (url) window.open(url, "_blank", "noopener");
  } catch (err) { toast("No se pudo abrir el archivo: " + (err.message || err), "error"); }
}

async function borrarDocumento(id) {
  if (!(await confirmar({ titulo: "Eliminar documento", mensaje: "Se elimina el registro y su archivo adjunto. ¿Continuar?", textoOk: "Eliminar", peligro: true }))) return;
  try {
    const path = await documentosRepo.obtenerPath(id);
    await documentosRepo.eliminar(id, path);
    render(); toast("Documento eliminado ✔");
  } catch (err) { toast("Error: " + (err.message || err), "error"); }
}

function modalDocumento(tipos) {
  const body = abrirModal("Cargar documento");
  const tipoOpts = tipos.map((t) => `<option value="${t.id}" data-venc="${t.vigencia_meses == null ? "" : t.vigencia_meses}">${escapar(t.nombre)}</option>`).join("");
  body.innerHTML = `
    <form id="fdc">
      <div>${labelInfo("fdc-tipo", "Tipo de documento *")}<select id="fdc-tipo">${tipoOpts}</select></div>
      <div class="fila">
        <div>${labelInfo("fdc-num", "Número")}<input id="fdc-num" placeholder="Opcional" /></div>
        <div>${labelInfo("fdc-emi", "Fecha de emisión")}<input id="fdc-emi" type="date" /></div>
        <div>${labelInfo("fdc-venc", "Vencimiento", "Se autocompleta según la vigencia del tipo, pero podés editarlo.")}<input id="fdc-venc" type="date" /></div>
      </div>
      <div>${labelInfo("fdc-file", "Archivo", "Imagen o PDF. Las imágenes se comprimen antes de subir. Máx 10 MB.")}<input id="fdc-file" type="file" accept="image/*,application/pdf" style="padding:6px;" /></div>
      <p id="fdc-fileinfo" class="muted" style="font-size:12px;margin-top:4px;" hidden></p>
      <div style="margin-top:16px;display:flex;gap:8px;"><button type="submit">Cargar</button><button type="button" id="fdc-cancelar" class="secundario">Cancelar</button></div>
      <p id="fdc-msg" class="msg" hidden></p>
    </form>`;
  const g = (s) => body.querySelector(s);

  const autoVenc = () => {
    const meses = g("#fdc-tipo").selectedOptions[0]?.dataset.venc;
    const emi = g("#fdc-emi").value;
    if (meses && emi) g("#fdc-venc").value = sumarMeses(emi, +meses);
  };
  g("#fdc-tipo").addEventListener("change", autoVenc);
  g("#fdc-emi").addEventListener("change", autoVenc);

  let preparado = null;
  g("#fdc-file").addEventListener("change", async () => {
    const info = g("#fdc-fileinfo");
    preparado = null;
    const file = g("#fdc-file").files[0];
    if (!file) { info.hidden = true; return; }
    info.hidden = false; info.textContent = "Procesando…";
    try {
      preparado = await prepararArchivo(file);
      info.textContent = `Listo para subir: ${preparado.nombre} (${formatearTamano(preparado.tamano)})`;
    } catch (err) { info.textContent = err.message || String(err); preparado = null; }
  });

  g("#fdc-cancelar").addEventListener("click", cerrarModal);
  g("#fdc").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = g("#fdc-msg");
    if (!g("#fdc-tipo").value) { setMsg(msg, "Elegí el tipo de documento.", "error"); return; }
    setMsg(msg, "Subiendo…");
    try {
      await documentosRepo.crear(PERFIL.empresa_id, EMP.id, {
        tipo_documento_id: g("#fdc-tipo").value, numero: g("#fdc-num").value,
        fecha_emision: g("#fdc-emi").value || null, fecha_vencimiento: g("#fdc-venc").value || null,
      }, preparado);
      cerrarModal(); render(); toast("Documento cargado ✔");
    } catch (err) { setMsg(msg, "No se pudo cargar: " + (err.message || err), "error"); }
  });
}
