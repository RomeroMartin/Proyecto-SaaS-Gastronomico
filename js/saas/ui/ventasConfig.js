// ============================================================
// saas/ui/ventasConfig.js — Ventas → Configuración (solo ADMIN)
// ------------------------------------------------------------
// Cada valor se guarda por set_config_ventas (validado y auditado en la base).
// El alias de cobro es un dato sensible (redirige los pagos): cada cambio queda
// en Configuración → Auditoría y cada pedido guarda el alias vigente al cobrar.
// ============================================================

import * as ventasRepo from "../data/ventasRepo.js";
import { MEDIOS_PAGO, NOMBRE_MEDIO, PLANTILLA_COMANDA, textoComanda, textoTicket } from "../../core/ventas.js";
import { imprimirTicket, MODOS_PAPEL, getModoPapel, setModoPapel } from "./impresion.js";
import { pesosACentavos } from "../../core/dinero.js";
import { escapar, setMsg, labelInfo } from "./helpers.js";

const $ = (c, s) => c.querySelector(s);
const MODOS = [
  ["whatsapp", "Solo WhatsApp"],
  ["impresora", "Solo impresora"],
  ["impresora_whatsapp", "Impresora, con WhatsApp de respaldo"],
];

export async function montar(container, perfil) {
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  let c;
  try { c = await ventasRepo.configCobro(); }
  catch (err) { container.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`; return; }
  const medios = c.medios_pago_habilitados || [];

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;"><h2 style="margin:0;">Ventas · Configuración</h2></div>
    <form id="vc-form">
      <div class="card">
        <h3 style="margin:0 0 6px;">Cobro</h3>
        <div class="fila">
          <div>${labelInfo("vc-alias", "Alias para transferencias", "Se muestra en el mostrador cuando se cobra por transferencia. Cada cambio queda auditado.")}
            <input id="vc-alias" value="${escapar(c.alias_transferencia || "")}" placeholder="mi.alias.mp" /></div>
        </div>
        <label>Medios de pago habilitados</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">${MEDIOS_PAGO.map((m) => `
          <label style="display:flex;align-items:center;gap:6px;margin:0;color:var(--tinta);"><input type="checkbox" class="vc-medio" value="${m}" style="width:auto;" ${medios.includes(m) ? "checked" : ""} /> ${escapar(NOMBRE_MEDIO[m])}</label>`).join("")}</div>
      </div>

      <div class="card">
        <h3 style="margin:0 0 6px;">Comanda a cocina</h3>
        <div class="fila">
          <div>${labelInfo("vc-modo", "¿Cómo sale la comanda?", "WhatsApp no necesita equipos. Con impresora se imprime en la térmica del local; si falla, el mostrador ofrece mandarla por WhatsApp.")}
            <select id="vc-modo">${MODOS.map(([v, l]) => `<option value="${v}" ${c.modo_comanda === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div>${labelInfo("vc-wa", "WhatsApp de cocina", "Con código de país, solo números. Ej: 5492211234567.")}
            <input id="vc-wa" inputmode="tel" value="${escapar(c.whatsapp_cocina || "")}" placeholder="5492211234567" /></div>
          <div>${labelInfo("vc-ancho", "Papel de la impresora", "Ancho del rollo de la térmica.")}
            <select id="vc-ancho"><option value="58" ${c.ancho_ticket_mm === 58 ? "selected" : ""}>58 mm</option><option value="80" ${c.ancho_ticket_mm === 80 ? "selected" : ""}>80 mm</option></select></div>
        </div>
        <p class="muted" style="font-size:12.5px;">Instalá la térmica como impresora del equipo. En el diálogo de imprimir elegí esa impresora, <b>Márgenes: Ninguno</b> y <b>Escala: 100 %</b>
          (en las preferencias del driver, papel de rollo de 58 u 80 mm). Para que imprima sin mostrar el diálogo, abrí Chrome con <code>--kiosk-printing</code>.</p>
        <div class="fila"><div>${labelInfo("vc-papel", "Papel de la impresora (solo este equipo)", "Cada impresora se comporta distinto. Probá con 'Ajustado'. Si sale girado, en una tira larga o cortado, probá 'Usar el papel del driver' (el driver tiene que tener el rollo de 58/80 mm). Se guarda en este equipo.")}
          <select id="vc-papel">${Object.entries(MODOS_PAPEL).map(([v, l]) => `<option value="${v}" ${getModoPapel() === v ? "selected" : ""}>${escapar(l)}</option>`).join("")}</select></div></div>
        <button type="button" id="vc-prueba" class="secundario" style="margin-top:8px;">Imprimir ticket de prueba</button>
        <span id="vc-prueba-msg" class="muted" style="font-size:12.5px;margin-left:8px;"></span>
        <div>${labelInfo("vc-plantilla", "Texto de la comanda (opcional)", "Dejalo vacío para usar el formato estándar. Marcas: {negocio} {numero} {fecha} {hora} {cliente} {telefono} {modalidad} {direccion} {items} {nota} {total} {pago}. Si una línea queda vacía se omite.")}
          <textarea id="vc-plantilla" rows="8" style="width:100%;font-family:ui-monospace,Consolas,monospace;font-size:13px;" placeholder="${escapar(PLANTILLA_COMANDA)}">${escapar(c.plantilla_comanda || "")}</textarea></div>
        <button type="button" id="vc-previa" class="secundario" style="margin-top:8px;">Ver ejemplo</button>
        <pre id="vc-ejemplo" class="card" style="white-space:pre-wrap;font-size:13px;" hidden></pre>
      </div>

      <div class="card">
        <h3 style="margin:0 0 6px;">Delivery y día de negocio</h3>
        <label style="display:flex;align-items:center;gap:8px;color:var(--tinta);"><input type="checkbox" id="vc-deliv" style="width:auto;" ${c.usa_delivery ? "checked" : ""} /> El local hace delivery (muestra modalidad, dirección y envío)</label>
        <div class="fila">
          <div>${labelInfo("vc-envio", "Costo de envío por defecto ($)", "Se sugiere al elegir Delivery.")}<input id="vc-envio" inputmode="decimal" value="${(c.costo_envio_default_centavos / 100).toString().replace(".", ",")}" /></div>
          <div>${labelInfo("vc-corte", "Hora de corte del día", "Lo que se vende antes de esta hora cuenta para el día anterior (un local que cierra pasada la medianoche). Ej: 06:00.")}<input id="vc-corte" type="time" value="${escapar(c.hora_corte_dia || "06:00")}" /></div>
        </div>
      </div>
      <div style="margin-top:14px;"><button type="submit" style="min-height:44px;">Guardar</button></div>
      <p id="vc-msg" class="msg" hidden></p>
    </form>`;

  $(container, "#vc-previa").addEventListener("click", () => {
    const ej = {
      numero: 12, creado_en: new Date().toISOString(), cliente_nombre: "Cliente de ejemplo", cliente_telefono: "", modalidad: "retiro", direccion: "",
      nota: "sin cebolla", total_centavos: 2350000,
      items: [{ nombre: "Producto A", cantidad: 2, precio_unit_centavos: 1000000, adicionales: [{ nombre: "Adicional", cantidad: 1, precio_unit_centavos: 150000 }] },
        { nombre: "Producto B", cantidad: 1, precio_unit_centavos: 200000 }],
      pagos: [{ medio: "efectivo", monto_centavos: 2350000 }],
    };
    const pre = $(container, "#vc-ejemplo");
    pre.textContent = textoComanda(ej, { negocio: c.negocio, plantilla: $(container, "#vc-plantilla").value, zona: c.zona_horaria });
    pre.hidden = false;
  });

  $(container, "#vc-papel").addEventListener("change", (e) => setModoPapel(e.target.value));
  $(container, "#vc-prueba").addEventListener("click", async () => {
    const msg = $(container, "#vc-prueba-msg");
    const ancho = Number($(container, "#vc-ancho").value) || 80;
    const ej = {
      numero: 1, creado_en: new Date().toISOString(), cliente_nombre: "Ticket de prueba", cliente_telefono: "", modalidad: "retiro", direccion: "",
      nota: "Si ves esto completo y sin cortes, está bien configurada.", total_centavos: 2350000,
      items: [{ nombre: "Producto con un nombre bastante largo", cantidad: 2, precio_unit_centavos: 1000000, adicionales: [{ nombre: "Adicional", cantidad: 1, precio_unit_centavos: 150000 }] },
        { nombre: "Producto B", cantidad: 1, precio_unit_centavos: 200000 }],
      pagos: [{ medio: "efectivo", monto_centavos: 2350000 }],
    };
    msg.textContent = "Enviando a la impresora…";
    const r = await imprimirTicket(textoTicket(ej, { negocio: c.negocio, plantilla: $(container, "#vc-plantilla").value, zona: c.zona_horaria, anchoMm: ancho }), ancho, $(container, "#vc-papel").value);
    msg.textContent = r.ok ? "Enviado. Revisá que salga completo y del largo justo." : "No se pudo imprimir: " + r.error;
  });

  $(container, "#vc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $(container, "#vc-msg");
    const nuevos = {
      alias_transferencia: $(container, "#vc-alias").value.trim(),
      whatsapp_cocina: $(container, "#vc-wa").value.trim(),
      medios_pago_habilitados: [...container.querySelectorAll(".vc-medio:checked")].map((x) => x.value),
      modo_comanda: $(container, "#vc-modo").value,
      ancho_ticket_mm: Number($(container, "#vc-ancho").value),
      plantilla_comanda: $(container, "#vc-plantilla").value.trim(),
      usa_delivery: $(container, "#vc-deliv").checked,
      costo_envio_default_centavos: pesosACentavos($(container, "#vc-envio").value || "0"),
      hora_corte_dia: $(container, "#vc-corte").value,
    };
    const actuales = {
      alias_transferencia: c.alias_transferencia || "", whatsapp_cocina: c.whatsapp_cocina || "", medios_pago_habilitados: medios,
      modo_comanda: c.modo_comanda, ancho_ticket_mm: c.ancho_ticket_mm, plantilla_comanda: c.plantilla_comanda || "",
      usa_delivery: !!c.usa_delivery, costo_envio_default_centavos: c.costo_envio_default_centavos, hora_corte_dia: c.hora_corte_dia,
    };
    setMsg(msg, "Guardando…");
    try {
      let n = 0;
      for (const [k, v] of Object.entries(nuevos)) {
        if (JSON.stringify(v) === JSON.stringify(actuales[k])) continue;
        await ventasRepo.setConfigVentas(k, v);
        n++;
      }
      setMsg(msg, n ? `Guardado ✔ (${n} cambio${n === 1 ? "" : "s"})` : "No había cambios.", "ok");
      if (n) montar(container, perfil);
    } catch (err) { setMsg(msg, "No se pudo guardar: " + (err.message || err), "error"); }
  });
}
