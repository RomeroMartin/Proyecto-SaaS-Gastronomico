// ============================================================
// saas/ui/config.js — Configuración: Empresa, Usuarios y Catálogos
// ============================================================

import * as empresasRepo from "../data/empresasRepo.js";
import * as usuariosRepo from "../data/usuariosRepo.js";
import * as catalogos from "../data/catalogosRepo.js";
import * as auditoriaRepo from "../data/auditoriaRepo.js";
import { setZonaHoraria, getZonaHoraria } from "../../core/utilsFecha.js";
import { escapar, setMsg, labelInfo, datalist, toast, abrirModal, cerrarModal } from "./helpers.js";

const ROLES = ["ADMIN", "GERENTE", "COCINA", "AUDITOR", "CAJERO"];
const ROL_AYUDA = {
  ADMIN: "Todo, incluida la configuración y los usuarios.",
  GERENTE: "Opera compras, pagos, caja, costos y RRHH (sin sueldos ni legajo).",
  COCINA: "Insumos y recetas; ve proveedores. No ve la contabilidad.",
  AUDITOR: "Solo lectura de compras, caja, costos y recetas.",
  CAJERO: "Solo el mostrador de ventas (disponible con el módulo Ventas).",
};
const ZONAS = [
  "America/Argentina/Buenos_Aires", "America/Argentina/Cordoba", "America/Argentina/Mendoza",
  "America/Montevideo", "America/Santiago", "America/Asuncion", "America/Sao_Paulo",
  "America/Bogota", "America/Lima", "America/Mexico_City", "Europe/Madrid", "UTC",
];
const CONDICIONES = [
  ["monotributo", "Monotributo"], ["responsable_inscripto", "Responsable inscripto"], ["exento", "Exento"],
];
const $ = (c, s) => c.querySelector(s);
const esAdmin = (perfil) => perfil && perfil.rol === "ADMIN";

// ---------- Empresa ----------
export async function empresa(container, perfil) {
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  let emp;
  try { emp = await empresasRepo.obtener(perfil.empresa_id); }
  catch (err) { container.innerHTML = `<p class="error">${escapar(err.message)}</p>`; return; }
  const admin = esAdmin(perfil);

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;"><h2 style="margin:0;">Empresa</h2></div>
    <div class="card">
      <form id="emp-form">
        <div>${labelInfo("emp-nombre", "Nombre", "Nombre de tu empresa/negocio.")}
          <input id="emp-nombre" value="${escapar(emp.nombre || "")}" ${admin ? "" : "disabled"} /></div>
        <div>${labelInfo("emp-cuit", "CUIT / RUT", "Identificación fiscal (opcional).")}
          <input id="emp-cuit" value="${escapar(emp.cuit_rut || "")}" ${admin ? "" : "disabled"} /></div>
        <div class="fila">
          <div>${labelInfo("emp-zona", "Zona horaria", "Define qué día es «hoy» para pagos, vencimientos, caja y reportes. Se cambia con cuidado: afecta las fechas nuevas.")}
            <select id="emp-zona" ${admin ? "" : "disabled"}>${(ZONAS.includes(emp.zona_horaria) ? ZONAS : [emp.zona_horaria, ...ZONAS]).map((z) => `<option value="${escapar(z)}" ${z === emp.zona_horaria ? "selected" : ""}>${escapar(z)}</option>`).join("")}</select></div>
          <div>${labelInfo("emp-fiscal", "Condición fiscal", "La de tu empresa frente a AFIP/ARCA. Por ahora es informativa; más adelante gobernará el costeo del IVA.")}
            <select id="emp-fiscal" ${admin ? "" : "disabled"}>${CONDICIONES.map(([v, l]) => `<option value="${v}" ${v === emp.condicion_fiscal ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        </div>
        <div style="margin-top:10px;">
          <label style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="emp-iva" style="width:auto;" ${emp.costea_con_iva ? "checked" : ""} ${admin ? "" : "disabled"} />
            Costear con IVA incluido (precio final)
          </label>
          <p class="muted" style="font-size:12px;margin:4px 0 0;">Si está tildado, el costeo usa el precio final con IVA. (Actualmente el cálculo siempre usa "con IVA".)</p>
        </div>
        ${admin ? `<div style="margin-top:16px;"><button type="submit">Guardar</button></div>` : `<p class="muted" style="margin-top:12px;">Solo un ADMIN puede editar estos datos.</p>`}
        <p id="emp-msg" class="msg" hidden></p>
      </form>
    </div>`;

  if (admin) $(container, "#emp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $(container, "#emp-msg");
    setMsg(msg, "Guardando…");
    try {
      await empresasRepo.actualizar(perfil.empresa_id, {
        nombre: $(container, "#emp-nombre").value.trim(),
        cuit_rut: $(container, "#emp-cuit").value.trim(),
        costea_con_iva: $(container, "#emp-iva").checked,
      });
      // Parámetros sensibles: solo por RPC (auditado).
      const zona = $(container, "#emp-zona").value, fiscal = $(container, "#emp-fiscal").value;
      if (zona !== emp.zona_horaria) { await empresasRepo.setConfig("zona_horaria", zona); emp.zona_horaria = zona; setZonaHoraria(zona); if (perfil.empresa) perfil.empresa.zona_horaria = zona; }
      if (fiscal !== emp.condicion_fiscal) { await empresasRepo.setConfig("condicion_fiscal", fiscal); emp.condicion_fiscal = fiscal; if (perfil.empresa) perfil.empresa.condicion_fiscal = fiscal; }
      setMsg(msg, "Guardado ✔ (recargá para ver el nombre en el menú)", "ok");
    } catch (err) { setMsg(msg, "No se pudo guardar: " + (err.message || err), "error"); }
  });
}

// ---------- Usuarios ----------
export async function usuarios(container, perfil) {
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  const admin = esAdmin(perfil);
  let lista;
  try { lista = await usuariosRepo.listar(); }
  catch (err) { container.innerHTML = `<p class="error">${escapar(err.message)}</p>`; return; }

  const filas = lista.map((u) => {
    const rolCtrl = admin && u.id !== perfil.id
      ? `<select data-id="${u.id}" class="u-rol">${ROLES.map((r) => `<option value="${r}" ${u.rol === r ? "selected" : ""}>${r}</option>`).join("")}</select>`
      : escapar(u.rol);
    const activoCtrl = admin && u.id !== perfil.id
      ? `<button class="secundario u-activo" data-id="${u.id}" data-activo="${u.activo}">${u.activo ? "Activo" : "Inactivo"}</button>`
      : (u.activo ? "Activo" : "Inactivo");
    return `<tr>
      <td>${escapar(u.nombre)}${u.id === perfil.id ? ' <span class="muted">(vos)</span>' : ""}<div class="muted" style="font-size:11.5px;">${escapar(u.email)}</div></td>
      <td>${rolCtrl}</td>
      <td>${activoCtrl}</td>
    </tr>`;
  }).join("");

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;"><h2 style="margin:0;">Usuarios y roles</h2>
      ${admin ? '<button id="u-agregar">+ Agregar usuario</button>' : ""}</div>
    <div class="card">
      <div class="tabla-scroll"><table>
        <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th></tr></thead>
        <tbody>${filas}</tbody></table></div>
      <p class="muted" style="font-size:12.5px;margin-top:10px;">
        Para <strong>sumar</strong> un usuario: 1) creale la cuenta en Supabase → Authentication → Users y
        2) vinculala acá con <strong>+ Agregar usuario</strong>. ${admin ? "Desde esta lista podés cambiarle el rol y activarlo o desactivarlo (un usuario desactivado ya no ve datos). Siempre debe quedar al menos un ADMIN activo." : "Solo un ADMIN puede ver y cambiar a los demás usuarios."}
      </p>
      ${admin ? `<details style="margin-top:8px;"><summary class="muted" style="cursor:pointer;font-size:12.5px;">¿Qué puede hacer cada rol?</summary>
        <ul class="muted" style="font-size:12.5px;margin:6px 0 0;padding-left:18px;">${ROLES.map((r) => `<li><strong>${r}</strong>: ${escapar(ROL_AYUDA[r])}</li>`).join("")}</ul></details>` : ""}
      <p id="u-msg" class="msg" hidden></p>
    </div>`;

  if (!admin) return;
  const btnAgregar = container.querySelector("#u-agregar");
  if (btnAgregar) btnAgregar.addEventListener("click", () => abrirAgregarUsuario(container, perfil));
  container.querySelectorAll(".u-rol").forEach((sel) => sel.addEventListener("change", async () => {
    try { await usuariosRepo.actualizar(sel.dataset.id, { rol: sel.value }); setMsg($(container, "#u-msg"), "Rol actualizado ✔", "ok"); }
    catch (err) { setMsg($(container, "#u-msg"), err.message || "Error", "error"); }
  }));
  container.querySelectorAll(".u-activo").forEach((b) => b.addEventListener("click", async () => {
    const nuevo = b.dataset.activo !== "true";
    try { await usuariosRepo.actualizar(b.dataset.id, { activo: nuevo }); await usuarios(container, perfil); }
    catch (err) { setMsg($(container, "#u-msg"), err.message || "Error", "error"); }
  }));
}

// Modal "Agregar usuario": vincula una cuenta ya creada en Supabase Auth.
function abrirAgregarUsuario(container, perfil) {
  const body = abrirModal("Agregar usuario");
  body.innerHTML = `
    <p class="muted" style="margin-top:0;">La cuenta tiene que existir en Supabase → Authentication → Users. Acá se la vincula a tu empresa con un rol.</p>
    <form id="ua-form">
      <div>${labelInfo("ua-email", "Email de la cuenta *", "El mismo email con el que se creó la cuenta en Authentication.")}<input id="ua-email" type="email" required /></div>
      <div>${labelInfo("ua-nombre", "Nombre", "Cómo se muestra en la app (opcional).")}<input id="ua-nombre" /></div>
      <div>${labelInfo("ua-rol", "Rol *", "Qué puede hacer en la app.")}
        <select id="ua-rol">${ROLES.filter((r) => r !== "ADMIN").concat("ADMIN").map((r) => `<option value="${r}" ${r === "GERENTE" ? "selected" : ""}>${r} — ${escapar(ROL_AYUDA[r])}</option>`).join("")}</select></div>
      <div style="margin-top:14px;display:flex;gap:8px;"><button type="submit">Agregar</button>
        <button type="button" id="ua-cancelar" class="secundario">Cancelar</button></div>
      <p id="ua-msg" class="msg" hidden></p>
    </form>`;
  body.querySelector("#ua-cancelar").addEventListener("click", cerrarModal);
  body.querySelector("#ua-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = body.querySelector("#ua-msg");
    setMsg(msg, "Agregando…");
    try {
      await usuariosRepo.vincular(body.querySelector("#ua-email").value, body.querySelector("#ua-rol").value, body.querySelector("#ua-nombre").value);
      cerrarModal();
      toast("Usuario agregado ✔");
      await usuarios(container, perfil);
    } catch (err) { setMsg(msg, err.message || String(err), "error"); }
  });
}

// ---------- Auditoría (solo ADMIN, solo lectura) ----------
const ETIQUETA_EVENTO = {
  cambio_usuario: "Cambio de usuario",
  vincular_usuario: "Usuario agregado",
  config_empresa: "Configuración de la empresa",
};
function detalleEvento(ev) {
  const a = ev.antes || {}, d = ev.despues || {};
  if (ev.accion === "cambio_usuario") {
    const partes = [];
    if (a.rol !== d.rol) partes.push(`rol ${a.rol} → ${d.rol}`);
    if (a.activo !== d.activo) partes.push(d.activo ? "reactivado" : "desactivado");
    return `${d.email || ""}: ${partes.join(", ")}`;
  }
  if (ev.accion === "vincular_usuario") return `${d.email || ""} como ${d.rol || ""}`;
  if (ev.accion === "config_empresa") {
    return Object.keys(d).map((k) => `${k}: ${a[k] == null ? "—" : a[k]} → ${d[k]}`).join(", ");
  }
  return JSON.stringify(d);
}

export async function auditoria(container, perfil) {
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  let eventos = [], usuariosLista = [];
  try { [eventos, usuariosLista] = await Promise.all([auditoriaRepo.listar(200), usuariosRepo.listar()]); }
  catch (err) { container.innerHTML = `<p class="error">${escapar(err.message || String(err))}</p>`; return; }
  const nombre = Object.fromEntries(usuariosLista.map((u) => [u.id, u.nombre]));
  const fmt = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: getZonaHoraria() });
  const filas = eventos.map((ev) => `<tr>
      <td style="white-space:nowrap;">${escapar(fmt.format(new Date(ev.creado_en)))}</td>
      <td>${escapar(nombre[ev.usuario_id] || "—")}</td>
      <td>${escapar(ETIQUETA_EVENTO[ev.accion] || ev.accion)}</td>
      <td>${escapar(detalleEvento(ev))}</td></tr>`).join("");
  container.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;"><h2 style="margin:0;">Auditoría</h2>
      <button id="au-ref" class="secundario">Refrescar</button></div>
    <div class="card">
      <p class="muted" style="margin-top:0;">Rastro de los cambios sensibles: usuarios (altas, roles, bajas) y configuración de la empresa. Se muestran los últimos 200 eventos.</p>
      ${eventos.length ? `<div class="tabla-scroll"><table>
        <thead><tr><th>Fecha</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead><tbody>${filas}</tbody></table></div>`
        : "<p class='muted'>Todavía no hay eventos registrados.</p>"}
    </div>`;
  container.querySelector("#au-ref").addEventListener("click", () => auditoria(container, perfil));
}

// ---------- Catálogos ----------
export async function catalogosCfg(container, perfil) {
  const admin = esAdmin(perfil);
  const bloques = Object.entries(catalogos.TIPOS_CATALOGO).map(([tipo, titulo]) => {
    const defaults = (catalogos.DEFAULTS[tipo] || []);
    const agregadas = catalogos.agregadas(tipo);
    const chipsDef = defaults.map((v) => `<span class="chip">${escapar(v)}</span>`).join("");
    const chipsAgr = agregadas.map((v) => `<span class="chip">${escapar(v)}${admin ? `<button data-tipo="${tipo}" data-valor="${escapar(v)}" class="cat-del">✕</button>` : ""}</span>`).join("");
    return `<div class="card">
      <h3 style="margin:0 0 6px;">${escapar(titulo)}</h3>
      <div class="muted" style="font-size:12px;">Por defecto</div>
      <div class="chips">${chipsDef || "<span class='muted'>—</span>"}</div>
      <div class="muted" style="font-size:12px;margin-top:10px;">Agregadas por vos</div>
      <div class="chips">${chipsAgr || "<span class='muted'>Ninguna todavía.</span>"}</div>
      ${admin ? `<div class="fila" style="margin-top:8px;">
        <input class="cat-add" list="dl-add-${tipo}" data-tipo="${tipo}" placeholder="Agregar opción…" style="flex:2;" />
        <button type="button" class="secundario cat-add-btn" data-tipo="${tipo}" style="flex:0 0 auto;">Agregar</button>
      </div>${datalist(`dl-add-${tipo}`, catalogos.opciones(tipo))}` : ""}
    </div>`;
  }).join("");

  container.innerHTML = `<div class="topbar" style="margin-bottom:14px;"><h2 style="margin:0;">Catálogos</h2></div>${bloques}`;

  if (!admin) return;
  container.querySelectorAll(".cat-del").forEach((b) => b.addEventListener("click", async () => {
    try { await catalogos.eliminar(perfil.empresa_id, b.dataset.tipo, b.dataset.valor); await catalogosCfg(container, perfil); }
    catch (err) { toast(err.message || "Error", "error"); }
  }));
  const agregar = async (tipo, input) => {
    const v = input.value.trim();
    if (!v) return;
    try { await catalogos.asegurar(perfil.empresa_id, tipo, v); await catalogosCfg(container, perfil); }
    catch (err) { toast(err.message || "Error", "error"); }
  };
  container.querySelectorAll(".cat-add-btn").forEach((b) => b.addEventListener("click", () => {
    agregar(b.dataset.tipo, container.querySelector(`.cat-add[data-tipo="${b.dataset.tipo}"]`));
  }));
  container.querySelectorAll(".cat-add").forEach((inp) => inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); agregar(inp.dataset.tipo, inp); }
  }));
}
