// ============================================================
// saas/ui/ventasHistorial.js — Ventas → Historial de turnos
// ------------------------------------------------------------
// Turnos cerrados con su resumen y detalle de pedidos. Solo lectura
// (ADMIN, GERENTE, AUDITOR); el ADMIN puede reabrir un turno con motivo
// para corregirlo (los ingresos del cierre quedan de baja y se vuelven a
// generar al cerrar de nuevo).
// ============================================================

import * as ventasRepo from "../data/ventasRepo.js";
import { formatearCentavos } from "../../core/dinero.js";
import { NOMBRE_MEDIO } from "../../core/ventas.js";
import { escapar, setMsg, toast, abrirModal, cerrarModal } from "./helpers.js";
import { resumenHTML } from "./ventasMostrador.js";

const money = (c) => formatearCentavos(c);
const $ = (c, s) => c.querySelector(s);
const fmtDia = (iso) => new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso + "T00:00:00"));
const hora = (iso, zona) => (iso ? new Intl.DateTimeFormat("es-AR", { timeZone: zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "—");

export async function montar(container, perfil) {
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  let turnos;
  try { turnos = await ventasRepo.turnosCerrados(); }
  catch (err) { container.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`; return; }
  const zona = (perfil.empresa && perfil.empresa.zona_horaria) || "America/Argentina/Buenos_Aires";
  const admin = perfil.rol === "ADMIN";

  const filas = turnos.map((t) => {
    const dif = t.efectivo_contado_centavos == null ? null : Number(t.efectivo_contado_centavos) - Number(t.efectivo_esperado_centavos);
    return `<tr>
      <td style="text-transform:capitalize;">${escapar(fmtDia(t.fecha_operativa))}</td>
      <td>${hora(t.abierto_en, zona)} → ${hora(t.cerrado_en, zona)}</td>
      <td class="num">${money(t.efectivo_esperado_centavos || 0)}</td>
      <td class="num">${t.efectivo_contado_centavos == null ? "—" : money(t.efectivo_contado_centavos)}</td>
      <td class="num" style="color:${dif === 0 ? "var(--ok)" : "var(--error)"};font-weight:600;">${dif == null ? "—" : dif === 0 ? "justa" : (dif > 0 ? "+" : "−") + money(Math.abs(dif))}</td>
      <td style="text-align:right;"><button class="secundario" data-ver="${t.id}">Ver</button></td></tr>`;
  }).join("");

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;"><h2 style="margin:0;">Ventas · Historial de turnos</h2>
      <button id="h-ref" class="secundario">Refrescar</button></div>
    <div class="card">${turnos.length ? `<div class="tabla-scroll"><table>
      <thead><tr><th>Día operativo</th><th>Horario</th><th class="num">Efectivo esperado</th><th class="num">Contado</th><th class="num">Diferencia</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div>` : "<p class='muted'>Todavía no hay turnos cerrados.</p>"}</div>`;
  $(container, "#h-ref").addEventListener("click", () => montar(container, perfil));
  container.querySelectorAll("[data-ver]").forEach((b) => b.addEventListener("click", () => ver(container, perfil, turnos.find((t) => t.id === b.dataset.ver), zona, admin)));
}

async function ver(container, perfil, t, zona, admin) {
  const body = abrirModal(`Turno del ${fmtDia(t.fecha_operativa)}`, { ancho: "lg" });
  body.innerHTML = "<p class='muted'>Cargando…</p>";
  let r, pedidos;
  try { [r, pedidos] = await Promise.all([ventasRepo.resumenTurno(t.id), ventasRepo.pedidosDelTurno(t.id)]); }
  catch (err) { body.innerHTML = `<p class="error">${escapar(err.message || String(err))}</p>`; return; }
  const dif = r.diferencia_centavos;
  body.innerHTML = `
    ${resumenHTML(r)}
    <p style="font-weight:650;color:${dif === 0 ? "var(--ok)" : "var(--error)"};">${dif === 0 ? "Caja justa" : dif > 0 ? "Sobraron " + money(dif) : "Faltaron " + money(-dif)}${t.nota_cierre ? ` <span class="muted" style="font-weight:400;">· ${escapar(t.nota_cierre)}</span>` : ""}</p>
    <h3 style="margin:14px 0 6px;">Pedidos</h3>
    <div class="tabla-scroll"><table><thead><tr><th>#</th><th>Hora</th><th>Detalle</th><th>Pago</th><th class="num">Total</th></tr></thead><tbody>
      ${pedidos.map((p) => `<tr style="${p.estado === "anulado" ? "opacity:.5;text-decoration:line-through;" : ""}">
        <td>${String(p.numero).padStart(3, "0")}</td><td>${hora(p.creado_en, zona)}</td>
        <td>${escapar(p.items.map((i) => `${i.cantidad}× ${i.nombre}${i.adicionales.length ? " (+" + i.adicionales.map((a) => a.nombre).join(", ") + ")" : ""}`).join(", "))}
          ${p.estado === "anulado" ? `<div class="muted" style="font-size:11px;">Anulado: ${escapar(p.motivo_anulacion || "")}</div>` : ""}</td>
        <td>${escapar(p.pagos.map((x) => NOMBRE_MEDIO[x.medio] || x.medio).join(" + "))}</td>
        <td class="num">${money(p.total_centavos)}</td></tr>`).join("")}
    </tbody></table></div>
    ${admin ? `<div style="margin-top:14px;text-align:right;"><button id="h-reabrir" class="secundario">Reabrir turno…</button></div>` : ""}`;
  const rb = $(body, "#h-reabrir");
  if (rb) rb.addEventListener("click", () => reabrir(container, perfil, t));
}

function reabrir(container, perfil, t) {
  const body = abrirModal("Reabrir turno");
  body.innerHTML = `<p style="margin:0 0 8px;">El turno vuelve a estar abierto y los ingresos que volcó al Flujo de caja se dan de baja (al cerrarlo de nuevo se generan otra vez). Queda registrado en la auditoría.</p>
    <input id="ra-motivo" placeholder="Motivo (obligatorio)" style="min-height:48px;" />
    <p id="ra-msg" class="msg" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button class="secundario" id="ra-no">Volver</button><button id="ra-si">Reabrir turno</button></div>`;
  $(body, "#ra-no").addEventListener("click", cerrarModal);
  $(body, "#ra-si").addEventListener("click", async () => {
    const msg = $(body, "#ra-msg");
    setMsg(msg, "Reabriendo…");
    try { await ventasRepo.reabrirTurno(t.id, $(body, "#ra-motivo").value); cerrarModal(); toast("Turno reabierto: está en Ventas → Mostrador"); montar(container, perfil); }
    catch (err) { setMsg(msg, err.message || String(err), "error"); }
  });
}
