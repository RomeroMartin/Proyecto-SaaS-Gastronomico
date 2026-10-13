// ============================================================
// saas/ui/ventasMostrador.js — Ventas → Mostrador (pantalla de uso diario)
// ------------------------------------------------------------
// Abrir caja · cargar pedidos desde la carta · cobrar · comanda a cocina
// (WhatsApp y/o impresora, según la configuración de la empresa) · anular ·
// salidas de efectivo · cerrar caja. Diseño táctil (modo caja).
// La UI no calcula plata importante: precio y costo los fija la base; acá se
// muestra el total en vivo con core/ventas.js.
// ============================================================

import * as ventasRepo from "../data/ventasRepo.js";
import * as catalogos from "../data/catalogosRepo.js";
import { totalPedido, diferenciaCaja, textoComanda, textoTicket, urlWhatsApp, planDespacho,
  NOMBRE_MEDIO } from "../../core/ventas.js";
import { pesosACentavos, formatearCentavos } from "../../core/dinero.js";
import { escapar, setMsg, toast, abrirModal, cerrarModal } from "./helpers.js";

const $ = (c, s) => c.querySelector(s);
const $$ = (c, s) => Array.from(c.querySelectorAll(s));
const money = (c) => formatearCentavos(c);

let PERFIL = null, CFG = null, CARTA = [], TURNO = null, PEDIDOS = [], CONT = null;
let carrito = [];          // [{ receta_id, nombre, precio, cantidad, adicionales: Map<id,{nombre,precio,cantidad}> }]
let sel = -1;              // línea seleccionada (recibe los adicionales)
let form = nuevoForm();
let clientUuid = null;     // se mantiene hasta que el pedido se confirma (idempotencia ante reintentos)
let enviando = false;
let handlersRed = null;

function nuevoForm() {
  return { medio: null, modalidad: "retiro", cliente: "", telefono: "", direccion: "", nota: "", descuento: "", envio: "" };
}

// ---------- Entrada ----------
export async function montar(container, perfil) {
  PERFIL = perfil; CONT = container;
  quitarRed();
  document.body.classList.add("modo-caja");
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  try {
    [CFG, CARTA] = await Promise.all([ventasRepo.configCobro(), ventasRepo.cartaMostrador()]);
    await catalogos.cargar();
    TURNO = await ventasRepo.turnoAbierto();
    PEDIDOS = TURNO ? await ventasRepo.pedidosDelTurno(TURNO.id) : [];
  } catch (err) {
    container.innerHTML = `<div class="card"><p class="error">No se pudo cargar el mostrador: ${escapar(err.message || String(err))}</p>
      <p class="muted">¿Está activo el módulo Ventas y corriste supabase/f2_aplicar_todo.sql?</p></div>`;
    return;
  }
  if (!form.medio || !(CFG.medios_pago_habilitados || []).includes(form.medio)) form.medio = (CFG.medios_pago_habilitados || ["efectivo"])[0];
  if (!clientUuid) clientUuid = ventasRepo.nuevoClientUuid();
  render();
  conectarRed();
}

// Sin conexión: franja roja y se deshabilita Confirmar (cola offline: fuera de alcance, Fase 6).
function conectarRed() {
  handlersRed = () => {
    const banda = $(CONT, "#m-offline");
    if (!banda) return;
    banda.hidden = navigator.onLine;
    const b = $(CONT, "#m-confirmar");
    if (b) b.disabled = !navigator.onLine || enviando || !carrito.length;
  };
  window.addEventListener("online", handlersRed);
  window.addEventListener("offline", handlersRed);
  handlersRed();
}
function quitarRed() {
  if (!handlersRed) return;
  window.removeEventListener("online", handlersRed);
  window.removeEventListener("offline", handlersRed);
  handlersRed = null;
}

// ---------- Armado ----------
const productos = () => CARTA.filter((c) => !c.es_adicional);
const adicionales = () => CARTA.filter((c) => c.es_adicional);

function lineasParaTotal() {
  return carrito.map((l) => ({
    precio_centavos: l.precio, cantidad: l.cantidad,
    adicionales: [...l.adicionales.values()].map((a) => ({ precio_centavos: a.precio, cantidad: a.cantidad })),
  }));
}
function totales() {
  const usaDeliv = CFG.usa_delivery && form.modalidad === "delivery";
  try {
    return totalPedido(lineasParaTotal(), {
      descuento: pesosACentavos(form.descuento || "0"), envio: usaDeliv ? pesosACentavos(form.envio || "0") : 0,
    });
  } catch (e) { return { error: e.message, subtotal: 0, descuento: 0, envio: 0, total: 0 }; }
}

function agregarProducto(id) {
  const p = CARTA.find((x) => x.id === id);
  if (!p) return;
  const i = carrito.findIndex((l) => l.receta_id === id && !l.adicionales.size);
  if (i >= 0) { carrito[i].cantidad += 1; sel = i; }
  else { carrito.push({ receta_id: id, nombre: p.nombre, precio: Number(p.precio_centavos), cantidad: 1, adicionales: new Map() }); sel = carrito.length - 1; }
  pintarPedido();
}
function cambiarCantidad(i, delta) {
  const l = carrito[i];
  if (!l) return;
  l.cantidad += delta;
  if (l.cantidad <= 0) { carrito.splice(i, 1); sel = carrito.length ? Math.min(sel, carrito.length - 1) : -1; }
  pintarPedido();
}
function agregarAdicional(id) {
  if (sel < 0 || !carrito[sel]) { toast("Elegí primero el producto al que se lo agregás.", "info"); return; }
  const a = CARTA.find((x) => x.id === id);
  const mapa = carrito[sel].adicionales;
  const cur = mapa.get(id);
  if (cur) cur.cantidad += 1; else mapa.set(id, { nombre: a.nombre, precio: Number(a.precio_centavos), cantidad: 1 });
  pintarPedido();
}
function quitarAdicional(i, id) {
  const m = carrito[i] && carrito[i].adicionales;
  if (!m || !m.has(id)) return;
  const a = m.get(id); a.cantidad -= 1;
  if (a.cantidad <= 0) m.delete(id);
  pintarPedido();
}
function vaciar() { carrito = []; sel = -1; form = { ...nuevoForm(), medio: form.medio }; clientUuid = ventasRepo.nuevoClientUuid(); }

// ---------- Render ----------
function render() {
  if (!TURNO) return renderSinTurno();
  const desde = new Intl.DateTimeFormat("es-AR", { timeZone: CFG.zona_horaria, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(TURNO.abierto_en));
  CONT.innerHTML = `
    <div id="m-offline" class="m-offline" hidden>Sin conexión — anotá el pedido en papel y cargalo cuando vuelva internet.</div>
    <div class="m-estado card" style="margin-top:0;">
      <div><b>Caja abierta</b> <span class="muted">· día operativo ${escapar(TURNO.fecha_operativa)} · desde ${desde} · fondo ${money(TURNO.fondo_inicial_centavos)}</span></div>
      <div class="acciones">
        <button id="m-egreso" class="secundario">Salida de efectivo</button>
        <button id="m-cerrar" class="secundario">Cerrar caja</button>
      </div>
    </div>
    <div class="mostrador">
      <div>
        <div id="m-carta">${cartaHTML()}</div>
        <div class="card"><h2 style="margin:0 0 4px;">Pedidos del turno</h2><div id="m-pedidos"></div></div>
      </div>
      <div class="m-ticket"><div class="card" style="margin-top:0;" id="m-pedido"></div></div>
    </div>`;
  $(CONT, "#m-carta").addEventListener("click", (e) => {
    const b = e.target.closest("[data-prod]"); if (b) agregarProducto(b.dataset.prod);
  });
  $(CONT, "#m-egreso").addEventListener("click", abrirEgreso);
  $(CONT, "#m-cerrar").addEventListener("click", abrirCierre);
  pintarPedido();
  pintarPedidos();
  if (handlersRed) handlersRed();
}

function cartaHTML() {
  const prods = productos();
  if (!prods.length) return `<div class="card"><p class="muted">No hay productos a la venta. En <b>Rentabilidad de carta → Platos</b> editá un plato y tildá
    "Se vende en el mostrador".</p></div>`;
  const grupos = {};
  for (const p of prods) (grupos[p.categoria_venta || "Productos"] ||= []).push(p);
  return Object.entries(grupos).map(([cat, items]) =>
    `<div class="m-cat">${escapar(cat)}</div><div class="m-botones">${items.map((p) =>
      `<button class="m-prod" data-prod="${p.id}" id="prod-${p.id}"><b>${escapar(p.nombre)}</b><span class="precio">${money(p.precio_centavos)}</span></button>`).join("")}</div>`).join("");
}

function renderSinTurno() {
  CONT.innerHTML = `
    <div class="card" style="max-width:520px;margin:30px auto;text-align:center;">
      <h2 style="font-size:20px;">Caja cerrada</h2>
      <p class="muted">Abrí la caja para empezar a tomar pedidos. Indicá el efectivo con el que arrancás (fondo de cambio).</p>
      <div style="max-width:240px;margin:12px auto;"><label for="m-fondo" style="text-align:left;">Fondo inicial ($)</label>
        <input id="m-fondo" inputmode="decimal" placeholder="0" style="min-height:48px;font-size:18px;" /></div>
      <button id="m-abrir" class="m-confirmar" style="max-width:320px;">Abrir caja</button>
      <p id="m-msg" class="msg" hidden></p>
    </div>`;
  $(CONT, "#m-abrir").addEventListener("click", async () => {
    const msg = $(CONT, "#m-msg");
    setMsg(msg, "Abriendo…");
    try {
      TURNO = await ventasRepo.abrirTurno(pesosACentavos($(CONT, "#m-fondo").value || "0"));
      TURNO = await ventasRepo.turnoAbierto();
      PEDIDOS = [];
      render(); conectarRed();
    } catch (err) { setMsg(msg, "No se pudo abrir la caja: " + (err.message || err), "error"); }
  });
}

function pintarPedido() {
  const t = totales();
  const usaDeliv = CFG.usa_delivery;
  const medios = CFG.medios_pago_habilitados || ["efectivo"];
  const lineas = carrito.map((l, i) => `
    <div class="m-linea${i === sel ? " sel" : ""}" data-i="${i}">
      <div data-sel="${i}" style="cursor:pointer;"><b>${escapar(l.nombre)}</b><div class="muted" style="font-size:13px;">${money(l.precio)} c/u</div></div>
      <span class="m-step"><button data-menos="${i}" aria-label="Quitar uno">−</button><span>${l.cantidad}</span><button data-mas="${i}" aria-label="Agregar uno">+</button></span>
      <b>${money(l.precio * l.cantidad + [...l.adicionales.values()].reduce((a, x) => a + x.precio * x.cantidad, 0))}</b>
      ${[...l.adicionales.entries()].map(([id, a]) => `<div class="ad"><span>+ ${a.cantidad}× ${escapar(a.nombre)}</span>
        <button class="btn-baja" data-adq="${i}|${id}" style="min-height:32px;">Quitar</button></div>`).join("")}
    </div>`).join("");
  const ads = adicionales();
  $(CONT, "#m-pedido").innerHTML = `
    <h2 style="margin:0 0 6px;">Pedido nuevo</h2>
    ${lineas || "<p class='muted'>Tocá un producto para empezar.</p>"}
    ${ads.length && carrito.length ? `<div class="muted" style="font-size:12.5px;margin-top:8px;">Adicionales para <b>${sel >= 0 && carrito[sel] ? escapar(carrito[sel].nombre) : "…"}</b>:</div>
      <div class="m-adic">${ads.map((a) => `<button data-adic="${a.id}">+ ${escapar(a.nombre)} · ${money(a.precio_centavos)}</button>`).join("")}</div>` : ""}
    ${usaDeliv ? `<div class="fila" style="margin-top:6px;"><div><label for="f-mod">Modalidad</label><select id="f-mod">
      ${[["retiro", "Retiro"], ["local", "En el local"], ["delivery", "Delivery"]].map(([v, l]) => `<option value="${v}" ${form.modalidad === v ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>` : ""}
    <div class="fila"><div><label for="f-cli">Cliente</label><input id="f-cli" value="${escapar(form.cliente)}" placeholder="Nombre (opcional)" /></div>
      ${usaDeliv && form.modalidad === "delivery" ? `<div><label for="f-tel">Teléfono</label><input id="f-tel" inputmode="tel" value="${escapar(form.telefono)}" /></div>` : ""}</div>
    ${usaDeliv && form.modalidad === "delivery" ? `<div class="fila"><div style="flex:2;"><label for="f-dir">Dirección</label><input id="f-dir" value="${escapar(form.direccion)}" /></div>
      <div><label for="f-env">Envío ($)</label><input id="f-env" inputmode="decimal" value="${escapar(form.envio)}" /></div></div>` : ""}
    <div class="fila"><div style="flex:2;"><label for="f-nota">Aclaraciones</label><input id="f-nota" value="${escapar(form.nota)}" placeholder="Sin cebolla, bien cocida…" /></div>
      <div><label for="f-desc">Descuento ($)</label><input id="f-desc" inputmode="decimal" value="${escapar(form.descuento)}" placeholder="0" /></div></div>
    <div class="m-total" id="m-total">${money(t.total)}</div>
    ${t.error ? `<p class="error" style="margin:0 0 6px;">${escapar(t.error)}</p>` : ""}
    <div class="m-medios">${medios.map((m) => `<button data-medio="${m}" aria-pressed="${form.medio === m}">${escapar(NOMBRE_MEDIO[m] || m)}</button>`).join("")}</div>
    ${form.medio === "transferencia" ? aliasHTML() : ""}
    <button id="m-confirmar" class="m-confirmar" ${carrito.length && !t.error && navigator.onLine && !enviando ? "" : "disabled"}>${enviando ? "Confirmando…" : "Confirmar pedido"}</button>
    <p id="m-envio-msg" class="msg" hidden></p>
    ${carrito.length ? `<button id="m-vaciar" class="secundario" style="width:100%;margin-top:8px;min-height:44px;">Vaciar</button>` : ""}`;

  const box = $(CONT, "#m-pedido");
  box.onclick = (e) => {
    const t2 = e.target;
    const b = (a) => t2.closest(`[${a}]`);
    if (b("data-mas")) return cambiarCantidad(+b("data-mas").dataset.mas, 1);
    if (b("data-menos")) return cambiarCantidad(+b("data-menos").dataset.menos, -1);
    if (b("data-sel")) { sel = +b("data-sel").dataset.sel; return pintarPedido(); }
    if (b("data-adic")) return agregarAdicional(b("data-adic").dataset.adic);
    if (b("data-adq")) { const [i, id] = b("data-adq").dataset.adq.split("|"); return quitarAdicional(+i, id); }
    if (b("data-medio")) { form.medio = b("data-medio").dataset.medio; return pintarPedido(); }
    if (t2.closest("#m-vaciar")) { vaciar(); return pintarPedido(); }
    if (t2.closest("#m-confirmar")) return confirmarPedido();
    if (t2.closest("#m-copiar")) return copiarAlias();
  };
  box.onchange = (e) => {
    if (e.target.id === "f-mod") {
      form.modalidad = e.target.value;
      if (form.modalidad === "delivery" && !form.envio && CFG.costo_envio_default_centavos) form.envio = (CFG.costo_envio_default_centavos / 100).toString().replace(".", ",");
      pintarPedido();
    }
  };
  box.oninput = (e) => {
    const m = { "f-cli": "cliente", "f-tel": "telefono", "f-dir": "direccion", "f-nota": "nota", "f-desc": "descuento", "f-env": "envio" }[e.target.id];
    if (!m) return;
    form[m] = e.target.value;
    if (m === "descuento" || m === "envio") {
      const t3 = totales();
      $(CONT, "#m-total").textContent = money(t3.total);
      const c = $(CONT, "#m-confirmar"); if (c) c.disabled = !carrito.length || !!t3.error || !navigator.onLine || enviando;
    }
  };
  // Marca el botón del producto con su cantidad en el pedido.
  $$(CONT, ".m-prod .cant").forEach((x) => x.remove());
  const cuenta = {};
  carrito.forEach((l) => { cuenta[l.receta_id] = (cuenta[l.receta_id] || 0) + l.cantidad; });
  Object.entries(cuenta).forEach(([id, n]) => { const el = CONT.querySelector(`#prod-${CSS.escape(id)}`); if (el) el.insertAdjacentHTML("beforeend", `<span class="cant">${n}</span>`); });
}

function aliasHTML() {
  if (!CFG.alias_transferencia) return `<div class="m-alias">Falta configurar el alias de cobro (Ventas → Configuración).</div>`;
  return `<div class="m-alias"><div class="muted" style="font-size:12.5px;">Alias para la transferencia</div>
    <b id="m-alias">${escapar(CFG.alias_transferencia)}</b>
    <button id="m-copiar" class="secundario" style="margin-left:10px;min-height:40px;">Copiar</button></div>`;
}
async function copiarAlias() {
  try { await navigator.clipboard.writeText(CFG.alias_transferencia); toast("Alias copiado ✔"); }
  catch (_e) { toast("No se pudo copiar: seleccionalo y copialo a mano.", "info"); }
}

// ---------- Confirmar ----------
async function confirmarPedido() {
  if (enviando || !carrito.length) return;
  const msg = $(CONT, "#m-envio-msg");
  const t = totales();
  if (t.error) return;
  if (form.medio === "transferencia" && !CFG.alias_transferencia) { setMsg(msg, "Falta configurar el alias de cobro.", "error"); return; }
  enviando = true; pintarPedido();
  const usaDeliv = CFG.usa_delivery && form.modalidad === "delivery";
  const datos = {
    cliente_nombre: form.cliente, cliente_telefono: usaDeliv ? form.telefono : "", modalidad: CFG.usa_delivery ? form.modalidad : "retiro",
    direccion: usaDeliv ? form.direccion : "", descuento_centavos: t.descuento, envio_centavos: t.envio, nota: form.nota,
  };
  const items = carrito.map((l) => ({
    receta_id: l.receta_id, cantidad: l.cantidad,
    adicionales: [...l.adicionales.entries()].map(([id, a]) => ({ receta_id: id, cantidad: a.cantidad })),
  }));
  try {
    const r = await ventasRepo.crearPedido(TURNO.id, datos, items, [{ medio: form.medio, monto_centavos: t.total }], clientUuid);
    vaciar();
    enviando = false;
    PEDIDOS = await ventasRepo.pedidosDelTurno(TURNO.id);
    pintarPedido(); pintarPedidos();
    mostrarConfirmado(PEDIDOS.find((p) => p.id === r.id), !!r.repetido);
  } catch (err) {
    enviando = false; pintarPedido();
    const m2 = $(CONT, "#m-envio-msg");
    // clientUuid se conserva: si fue un corte de red, reintentar no duplica el pedido.
    if (m2) setMsg(m2, "No se pudo registrar el pedido: " + (err.message || err) + ". No se cobró nada: podés reintentar.", "error");
  }
}

// ---------- Comanda ----------
function opcionesComanda() {
  return { negocio: CFG.negocio, plantilla: CFG.plantilla_comanda, zona: CFG.zona_horaria, anchoMm: CFG.ancho_ticket_mm };
}
const plan = () => planDespacho(CFG.modo_comanda, { whatsappConfigurado: !!CFG.whatsapp_cocina });

/** Imprime el ticket en la impresora del sistema (hoja angosta). Devuelve true si se pudo lanzar. */
function imprimir(pedido) {
  try {
    const zona = document.getElementById("zona-impresion");
    zona.innerHTML = `<style>@page { size: ${CFG.ancho_ticket_mm === 58 ? 58 : 80}mm auto; margin: 3mm; }</style><pre></pre>`;
    zona.querySelector("pre").textContent = textoTicket(pedido, opcionesComanda());
    document.body.classList.add("imprimiendo-ticket");
    const fin = () => { document.body.classList.remove("imprimiendo-ticket"); window.removeEventListener("afterprint", fin); };
    window.addEventListener("afterprint", fin);
    window.print();
    setTimeout(fin, 1500);
    return true;
  } catch (_e) {
    document.body.classList.remove("imprimiendo-ticket");
    return false;
  }
}

function mostrarConfirmado(p, repetido) {
  if (!p) return;
  const pl = plan();
  const body = abrirModal(repetido ? "Pedido ya registrado" : "Pedido confirmado");
  const wa = () => urlWhatsApp(CFG.whatsapp_cocina, textoComanda(p, opcionesComanda()));
  body.innerHTML = `
    <div class="m-ok">
      <div class="num-grande">#${String(p.numero).padStart(3, "0")}</div>
      <p style="font-size:20px;margin:4px 0;"><b>${money(p.total_centavos)}</b> · ${escapar(p.pagos.map((x) => NOMBRE_MEDIO[x.medio] || x.medio).join(" + "))}</p>
      <p id="mc-estado" class="muted" style="margin:8px 0 14px;"></p>
      <div style="display:grid;gap:8px;">
        ${pl.principal === "impresora" ? `<button id="mc-imprimir" style="min-height:52px;">Imprimir comanda</button>` : ""}
        ${(pl.principal === "whatsapp" || pl.respaldo === "whatsapp") ? `<a id="mc-wa" href="${wa()}" target="_blank" rel="noopener"
           class="m-wa" style="display:block;padding:14px;border-radius:8px;text-decoration:none;font-weight:650;${pl.principal === "whatsapp" ? "background:#18181b;color:#fff;" : "background:#fff;color:#18181b;border:1px solid #e7e7e9;"}">
           ${pl.principal === "whatsapp" ? "Enviar a cocina por WhatsApp" : "No salió: enviar por WhatsApp"}</a>` : ""}
        ${pl.avisos.map((a) => `<p class="muted" style="margin:0;">${escapar(a)}</p>`).join("")}
        <button id="mc-nuevo" class="secundario" style="min-height:52px;">Nuevo pedido</button>
      </div>
    </div>`;
  const estado = $(body, "#mc-estado");
  const marcar = async (via) => { try { await ventasRepo.registrarComanda(p.id, via); p.comanda_via = via; pintarPedidos(); } catch (_e) { /* no bloquea la operación */ } };
  if (pl.principal === "impresora") {
    const ok = imprimir(p);
    if (ok) { estado.textContent = "Comanda enviada a la impresora."; marcar("impresora"); }
    else estado.textContent = "No se pudo imprimir." + (pl.respaldo ? " Usá el botón de WhatsApp." : "");
    $(body, "#mc-imprimir").addEventListener("click", () => { if (imprimir(p)) { estado.textContent = "Comanda enviada a la impresora."; marcar("impresora"); } });
  }
  const aWa = $(body, "#mc-wa");
  if (aWa) aWa.addEventListener("click", () => marcar("whatsapp"));
  $(body, "#mc-nuevo").addEventListener("click", cerrarModal);
}

// ---------- Pedidos del turno ----------
function pintarPedidos() {
  const el = $(CONT, "#m-pedidos");
  if (!el) return;
  if (!PEDIDOS.length) { el.innerHTML = "<p class='muted'>Todavía no hay pedidos en este turno.</p>"; return; }
  el.innerHTML = PEDIDOS.slice().reverse().map((p) => {
    const anulado = p.estado === "anulado";
    return `<div class="m-pedido" data-anulado="${anulado ? 1 : 0}">
      <span class="m-num">#${String(p.numero).padStart(3, "0")}</span>
      <span><b>${escapar(p.cliente_nombre || p.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(", "))}</b>
        <div class="muted" style="font-size:12.5px;">${p.items.map((i) => `${i.cantidad}× ${escapar(i.nombre)}`).join(", ")} · ${escapar(p.pagos.map((x) => NOMBRE_MEDIO[x.medio] || x.medio).join(" + "))}
        ${p.estado === "entregado" ? " · entregado" : ""}${anulado ? " · anulado" : ""}${p.comanda_via ? "" : anulado ? "" : " · comanda sin enviar"}</div></span>
      <b>${money(p.total_centavos)}</b>
      ${anulado ? "" : `<div class="btns">
        ${p.estado === "confirmado" ? `<button class="secundario" data-ent="${p.id}">Entregado</button>` : ""}
        <button class="secundario" data-com="${p.id}">Comanda</button>
        <button class="btn-baja" data-anu="${p.id}">Anular</button></div>`}
    </div>`;
  }).join("");
  el.onclick = (e) => {
    const g = (a) => e.target.closest(`[${a}]`);
    if (g("data-ent")) return entregar(g("data-ent").dataset.ent);
    if (g("data-anu")) return anular(g("data-anu").dataset.anu);
    if (g("data-com")) { const p = PEDIDOS.find((x) => x.id === g("data-com").dataset.com); if (p) mostrarConfirmado(p, true); }
  };
}

async function entregar(id) {
  try { await ventasRepo.marcarEntregado(id); PEDIDOS = await ventasRepo.pedidosDelTurno(TURNO.id); pintarPedidos(); }
  catch (err) { toast("No se pudo marcar: " + (err.message || err), "error"); }
}

function anular(id) {
  const p = PEDIDOS.find((x) => x.id === id);
  if (!p) return;
  const body = abrirModal(`Anular pedido #${String(p.numero).padStart(3, "0")}`);
  body.innerHTML = `<p style="margin:0 0 8px;">Total ${money(p.total_centavos)}. Queda en el listado pero sale de los totales. Indicá el motivo.</p>
    <input id="an-motivo" placeholder="Ej: error de carga, el cliente se arrepintió" style="min-height:48px;" />
    <p id="an-msg" class="msg" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button class="secundario" id="an-no">Volver</button>
      <button id="an-si" style="background:var(--error);">Anular pedido</button></div>`;
  $(body, "#an-no").addEventListener("click", cerrarModal);
  $(body, "#an-si").addEventListener("click", async () => {
    const msg = $(body, "#an-msg");
    setMsg(msg, "Anulando…");
    try {
      await ventasRepo.anularPedido(id, $(body, "#an-motivo").value);
      PEDIDOS = await ventasRepo.pedidosDelTurno(TURNO.id); pintarPedidos(); cerrarModal(); toast("Pedido anulado");
    } catch (err) { setMsg(msg, err.message || String(err), "error"); }
  });
}

// ---------- Salida de efectivo ----------
function abrirEgreso() {
  const body = abrirModal("Salida de efectivo");
  body.innerHTML = `<p class="muted" style="margin:0 0 8px;">Plata que sale de la caja durante el turno (hielo, delivery, retiro…). Se descuenta del efectivo esperado.</p>
    <label for="eg-monto">Monto ($)</label><input id="eg-monto" inputmode="decimal" style="min-height:48px;" />
    <label for="eg-cat">Motivo</label><input id="eg-cat" list="dl-eg" placeholder="Hielo, retiro, delivery…" style="min-height:48px;" />
    <datalist id="dl-eg">${catalogos.opciones("cat_egreso").map((o) => `<option value="${escapar(o)}"></option>`).join("")}</datalist>
    <label for="eg-nota">Nota</label><input id="eg-nota" />
    <p id="eg-msg" class="msg" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button class="secundario" id="eg-no">Cancelar</button><button id="eg-si">Registrar</button></div>`;
  $(body, "#eg-no").addEventListener("click", cerrarModal);
  $(body, "#eg-si").addEventListener("click", async () => {
    const msg = $(body, "#eg-msg");
    const monto = pesosACentavos($(body, "#eg-monto").value);
    if (monto <= 0) { setMsg(msg, "Ingresá un monto mayor a cero.", "error"); return; }
    setMsg(msg, "Registrando…");
    try {
      await ventasRepo.registrarEgreso(TURNO.id, monto, $(body, "#eg-cat").value, $(body, "#eg-nota").value);
      cerrarModal(); toast("Salida registrada ✔");
    } catch (err) { setMsg(msg, err.message || String(err), "error"); }
  });
}

// ---------- Cierre de caja ----------
async function abrirCierre() {
  const body = abrirModal("Cerrar caja");
  body.innerHTML = "<p class='muted'>Calculando…</p>";
  let r;
  try { r = await ventasRepo.resumenTurno(TURNO.id); }
  catch (err) { body.innerHTML = `<p class="error">${escapar(err.message || String(err))}</p>`; return; }
  const medios = Object.entries(r.por_medio || {});
  body.innerHTML = `
    ${resumenHTML(r)}
    <label for="ci-contado">Efectivo contado ($)</label>
    <input id="ci-contado" inputmode="decimal" placeholder="0" style="min-height:52px;font-size:20px;" />
    <p id="ci-dif" style="font-size:18px;font-weight:650;margin:8px 0;">&nbsp;</p>
    <label for="ci-nota">Nota (opcional)</label><input id="ci-nota" />
    <p class="muted" style="font-size:12.5px;">Al cerrar, las ventas se vuelcan al Flujo de caja y no se pueden cargar más pedidos en este turno.</p>
    <p id="ci-msg" class="msg" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button class="secundario" id="ci-no">Volver</button><button id="ci-si" style="min-height:48px;">Cerrar caja</button></div>`;
  const dif = () => {
    const v = $(body, "#ci-contado").value;
    const el = $(body, "#ci-dif");
    if (v.trim() === "") { el.innerHTML = "&nbsp;"; return; }
    const d = diferenciaCaja(pesosACentavos(v), r.efectivo_esperado_centavos);
    el.textContent = d === 0 ? "Caja justa ✔" : d > 0 ? `Sobran ${money(d)}` : `Faltan ${money(-d)}`;
    el.style.color = d === 0 ? "var(--ok)" : "var(--error)";
  };
  $(body, "#ci-contado").addEventListener("input", dif);
  $(body, "#ci-no").addEventListener("click", cerrarModal);
  $(body, "#ci-si").addEventListener("click", async () => {
    const msg = $(body, "#ci-msg");
    const v = $(body, "#ci-contado").value;
    if (v.trim() === "") { setMsg(msg, "Contá el efectivo e ingresalo (0 si no hay).", "error"); return; }
    setMsg(msg, "Cerrando…");
    try {
      const fin = await ventasRepo.cerrarTurno(TURNO.id, pesosACentavos(v), $(body, "#ci-nota").value);
      TURNO = null; PEDIDOS = []; carrito = []; sel = -1;
      body.innerHTML = `<h3 style="margin:0 0 8px;">Caja cerrada ✔</h3>${resumenHTML(fin)}
        <p style="font-size:18px;font-weight:650;color:${fin.diferencia_centavos === 0 ? "var(--ok)" : "var(--error)"};">
        ${fin.diferencia_centavos === 0 ? "Caja justa" : fin.diferencia_centavos > 0 ? "Sobraron " + money(fin.diferencia_centavos) : "Faltaron " + money(-fin.diferencia_centavos)}</p>
        <div style="text-align:right;"><button id="ci-fin">Listo</button></div>`;
      $(body, "#ci-fin").addEventListener("click", () => { cerrarModal(); render(); });
      render();
    } catch (err) { setMsg(msg, err.message || String(err), "error"); }
  });
}

/** Resumen del turno (valores que calcula la base). */
export function resumenHTML(r) {
  const medios = Object.entries(r.por_medio || {});
  const fila = (a, b, fuerte) => `<tr><td>${a}</td><td class="num"${fuerte ? ' style="font-weight:700;"' : ""}>${b}</td></tr>`;
  return `<div class="tabla-scroll"><table><tbody>
    ${fila("Pedidos", r.pedidos)}
    ${fila("Ventas", money(r.ventas_centavos), true)}
    ${medios.map(([m, v]) => fila("&nbsp;&nbsp;" + escapar(NOMBRE_MEDIO[m] || m), money(v))).join("")}
    ${fila("Ticket promedio", money(r.ticket_promedio_centavos))}
    ${r.anulados ? fila("Anulados", `${r.anulados} · ${money(r.anulados_centavos)}`) : ""}
    ${fila("Fondo inicial", money(r.fondo_inicial_centavos))}
    ${fila("Salidas de efectivo", "− " + money(r.egresos_efectivo_centavos))}
    ${fila("Efectivo esperado", money(r.efectivo_esperado_centavos), true)}
    ${r.efectivo_contado_centavos != null ? fila("Efectivo contado", money(r.efectivo_contado_centavos)) : ""}
  </tbody></table></div>`;
}
