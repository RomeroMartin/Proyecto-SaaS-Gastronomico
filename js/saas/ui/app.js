// ============================================================
// saas/ui/app.js — Shell de la app SaaS (auth + menú lateral)
// ------------------------------------------------------------
// Sidebar con módulos desplegables (estilo Supabase/Firebase).
// Cada pantalla es un módulo con montar(container, perfil).
// Para agregar una pantalla: sumá una entrada a MENU con su montar.
// ============================================================

import { login, logout, sesionActual, miPerfil } from "../auth.js";
import { mostrar, setMsg, escapar } from "./helpers.js";
import { setZonaHoraria } from "../../core/utilsFecha.js";
import * as catalogos from "../data/catalogosRepo.js";
import * as resumenes from "./resumenes.js";
import * as proveedores from "./proveedores.js";
import * as facturas from "./facturas.js";
import * as pagos from "./pagos.js";
import * as agenda from "./agenda.js";
import * as caja from "./caja.js";
import * as insumos from "./insumos.js";
import * as historial from "./historial.js";
import * as recetas from "./recetas.js";
import * as carta from "./carta.js";
import * as rentabilidad from "./rentabilidad.js";
import * as config from "./config.js";
import * as rrhhEmpleados from "./rrhhEmpleados.js";
import * as rrhhVencimientos from "./rrhhVencimientos.js";
import * as rrhhConfig from "./rrhhConfig.js";

const $ = (sel) => document.querySelector(sel);

let perfil = null;

// Íconos de línea (SVG, stroke = currentColor). Delicados, un solo tono.
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ` +
  `stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICONOS = {
  admin: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  costos: svg('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),
  carta: svg('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
  rrhh: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  config: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  chevron: svg('<polyline points="9 18 15 12 9 6"/>'),
};

// Registro del menú: módulos → submódulos. El primer submódulo suele ser el Resumen.
const MENU = [
  {
    id: "admin", titulo: "Administrativo", icono: ICONOS.admin,
    items: [
      { clave: "admin_resumen", titulo: "Resumen", montar: resumenes.admin },
      { clave: "proveedores", titulo: "Proveedores", montar: proveedores.montar },
      { clave: "facturas", titulo: "Facturas", montar: facturas.montar },
      { clave: "pagos", titulo: "Pagos", montar: pagos.montar },
      { clave: "agenda", titulo: "Agenda de pagos", montar: agenda.montar },
      { clave: "caja", titulo: "Flujo de caja", montar: caja.montar },
    ],
  },
  {
    id: "costos", titulo: "Costos", icono: ICONOS.costos,
    items: [
      { clave: "costos_resumen", titulo: "Resumen", montar: resumenes.costos },
      { clave: "insumos", titulo: "Insumos", montar: insumos.montar },
      { clave: "historial", titulo: "Historial de precios", montar: historial.montar },
    ],
  },
  {
    id: "carta", titulo: "Rentabilidad de carta", icono: ICONOS.carta,
    items: [
      { clave: "carta_resumen", titulo: "Resumen", montar: resumenes.carta },
      { clave: "recetas", titulo: "Platos y preparaciones", montar: recetas.montar },
      { clave: "carta", titulo: "Carta", montar: carta.montar },
      { clave: "rentabilidad", titulo: "Rentabilidad de carta", montar: rentabilidad.montar },
    ],
  },
  {
    id: "rrhh", titulo: "Recursos Humanos", icono: ICONOS.rrhh, roles: ["ADMIN", "GERENTE"],
    items: [
      { clave: "rrhh_empleados", titulo: "Empleados", montar: rrhhEmpleados.montar },
      { clave: "rrhh_vencimientos", titulo: "Vencimientos", montar: rrhhVencimientos.montar },
      { clave: "rrhh_config", titulo: "Configuración", montar: rrhhConfig.montar, roles: ["ADMIN"] },
    ],
  },
  {
    id: "config", titulo: "Configuración", icono: ICONOS.config,
    items: [
      { clave: "cfg_empresa", titulo: "Empresa", montar: config.empresa },
      { clave: "cfg_usuarios", titulo: "Usuarios y roles", montar: config.usuarios },
      { clave: "cfg_catalogos", titulo: "Catálogos", montar: config.catalogosCfg },
      { clave: "cfg_auditoria", titulo: "Auditoría", montar: config.auditoria, roles: ["ADMIN"] },
    ],
  },
];

// ¿El rol actual puede ver este grupo/ítem? (roles ausente = todos los roles)
function permitido(entrada) {
  return !entrada.roles || (perfil && entrada.roles.includes(perfil.rol));
}
// Grupos visibles para el rol actual, con sus ítems ya filtrados.
function menuVisible() {
  return MENU
    .filter(permitido)
    .map((g) => ({ ...g, items: g.items.filter(permitido) }))
    .filter((g) => g.items.length);
}

const ITEMS = Object.fromEntries(MENU.flatMap((g) => g.items.map((it) => [it.clave, it])));
const CLAVE_INICIAL = "admin_resumen";
const LS_ULTIMA = "saas_ultima_pantalla";

// ---------- login ----------
async function manejarLogin(e) {
  e.preventDefault();
  const msg = $("#login-msg");
  setMsg(msg, "Ingresando…");
  try {
    await login($("#login-email").value, $("#login-pass").value);
    setMsg(msg, "");
    await entrarApp();
  } catch (err) {
    setMsg(msg, "No se pudo iniciar sesión: " + (err.message || err), "error");
  }
}

async function manejarLogout() {
  await logout();
  perfil = null;
  mostrar($("#app"), false);
  mostrar($("#login"), true);
}

// ---------- app ----------
async function entrarApp() {
  perfil = await miPerfil();
  if (!perfil) {
    setMsg($("#login-msg"),
      "Tu usuario no tiene empresa asignada. Pedile al administrador que te vincule (si sos el primer usuario, corré supabase/bootstrap.sql).", "error");
    return;
  }
  if (perfil.activo === false) {
    // Usuario desactivado: la base ya no le muestra datos; además se cierra la sesión.
    await logout();
    perfil = null;
    mostrar($("#app"), false);
    mostrar($("#login"), true);
    setMsg($("#login-msg"), "Tu usuario está desactivado. Contactá al administrador.", "error");
    return;
  }
  // La fecha de negocio ("hoy") se calcula en la zona horaria de la empresa.
  setZonaHoraria(perfil.empresa && perfil.empresa.zona_horaria);
  mostrar($("#login"), false);
  mostrar($("#app"), true);

  $("#marca-empresa").textContent = perfil.empresa ? perfil.empresa.nombre : "(sin empresa)";
  $("#marca-empresa-top").textContent = perfil.empresa ? perfil.empresa.nombre : "";
  $("#user-nombre").textContent = perfil.nombre;
  $("#user-rol").textContent = perfil.rol;
  $("#avatar").textContent = (perfil.nombre || "?").trim().charAt(0).toUpperCase() || "·";

  await catalogos.cargar(); // opciones de los combos (best-effort)
  construirMenu();

  let inicial = CLAVE_INICIAL;
  try { const g = localStorage.getItem(LS_ULTIMA); if (g && ITEMS[g] && puedeVerClave(g)) inicial = g; } catch (_e) {}
  await irA(inicial);
}

function grupoDe(clave) {
  return MENU.find((g) => g.items.some((it) => it.clave === clave));
}

// ¿El rol actual puede navegar a esta clave? (grupo e ítem permitidos)
function puedeVerClave(clave) {
  const g = grupoDe(clave);
  const it = g && g.items.find((i) => i.clave === clave);
  return !!(g && it && permitido(g) && permitido(it));
}

function construirMenu() {
  const nav = $("#menu");
  nav.innerHTML = "";
  for (const grupo of menuVisible()) {
    const sec = document.createElement("div");
    sec.className = "menu-grupo";
    sec.dataset.grupo = grupo.id;

    const header = document.createElement("button");
    header.className = "menu-grupo-head";
    header.innerHTML =
      `<span class="menu-ico">${grupo.icono}</span>
       <span class="menu-titulo">${grupo.titulo}</span>
       <span class="menu-chevron">${ICONOS.chevron}</span>`;
    // Clic en el módulo: si está abierto lo cierra; si está cerrado lo abre
    // y muestra su Resumen (primer submódulo).
    header.addEventListener("click", () => {
      if (sec.classList.contains("abierto")) sec.classList.remove("abierto");
      else irA(grupo.items[0].clave);
    });
    sec.appendChild(header);

    const ul = document.createElement("div");
    ul.className = "menu-items";
    for (const it of grupo.items) {
      const b = document.createElement("button");
      b.className = "menu-item";
      b.dataset.clave = it.clave;
      b.textContent = it.titulo;
      b.addEventListener("click", () => irA(it.clave));
      ul.appendChild(b);
    }
    sec.appendChild(ul);
    nav.appendChild(sec);
  }
}

async function irA(clave) {
  const item = ITEMS[clave];
  if (!item) return;
  // El rol no llega a esta pantalla: caé en la inicial (la RLS igual protege).
  if (!puedeVerClave(clave)) { await irA(CLAVE_INICIAL); return; }
  try { localStorage.setItem(LS_ULTIMA, clave); } catch (_e) {}

  // Abrir el grupo del item activo y marcar el item.
  const grupo = grupoDe(clave);
  document.querySelectorAll(".menu-grupo").forEach((s) =>
    s.classList.toggle("abierto", grupo && s.dataset.grupo === grupo.id));
  document.querySelectorAll(".menu-item").forEach((b) =>
    b.classList.toggle("activo", b.dataset.clave === clave));

  cerrarSidebarMobile();

  const cont = $("#screen");
  cont.innerHTML = "<p class='muted'>Cargando…</p>";
  try {
    await item.montar(cont, perfil);
  } catch (err) {
    cont.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`;
  }
}

// ---------- sidebar mobile ----------
function abrirSidebarMobile() { $("#app").classList.add("sidebar-abierta"); }
function cerrarSidebarMobile() { $("#app").classList.remove("sidebar-abierta"); }

// ---------- arranque ----------
async function init() {
  $("#form-login").addEventListener("submit", manejarLogin);
  document.querySelectorAll(".btn-logout").forEach((b) => b.addEventListener("click", manejarLogout));
  $("#btn-menu").addEventListener("click", abrirSidebarMobile);
  $("#overlay").addEventListener("click", cerrarSidebarMobile);

  // Tooltips de ayuda "i": click/tap abre y cierra (hover ya funciona por CSS).
  document.addEventListener("click", (e) => {
    const hint = e.target.closest(".hint");
    document.querySelectorAll(".hint.abierto").forEach((h) => { if (h !== hint) h.classList.remove("abierto"); });
    if (hint) { e.preventDefault(); hint.classList.toggle("abierto"); }
  });

  const sesion = await sesionActual();
  if (sesion) await entrarApp();
  else mostrar($("#login"), true);
}

init();
