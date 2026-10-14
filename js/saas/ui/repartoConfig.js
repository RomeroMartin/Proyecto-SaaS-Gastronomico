// ============================================================
// saas/ui/repartoConfig.js — Reparto de ingresos → Configuración (solo ADMIN)
// Cada valor se guarda por set_config_reparto (validado y auditado en la base).
// ============================================================

import * as repo from "../data/repartoRepo.js";
import * as empresasRepo from "../data/empresasRepo.js";
import { moduloActivo } from "../../core/modulos.js";
import { escapar, setMsg, labelInfo } from "./helpers.js";

const $ = (c, s) => c.querySelector(s);
const num = (v) => Number(String(v).replace(",", "."));

export async function montar(container, perfil) {
  container.innerHTML = "<p class='muted'>Cargando…</p>";
  let e;
  try { e = await empresasRepo.obtener(perfil.empresa_id); }
  catch (err) { container.innerHTML = `<p class="error">Error: ${escapar(err.message || String(err))}</p>`; return; }
  const conRRHH = moduloActivo(perfil.empresa && perfil.empresa.modulos, "rrhh");
  const fmt = (n) => String(n ?? "").replace(".", ",");

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:14px;"><h2 style="margin:0;">Reparto · Configuración</h2></div>
    <form id="rc-form">
      <div class="card" style="margin-top:0;">
        <h3 style="margin:0 0 6px;">Costos sobre la venta</h3>
        <div class="fila">
          <div>${labelInfo("rc-cmv", "CMV objetivo (%)", "% de las ventas que se va en mercadería. Se usa mientras no haya datos propios suficientes (7 días con ventas y 100 unidades); después se usa el CMV teórico del mes.")}<input id="rc-cmv" inputmode="decimal" value="${fmt(e.cmv_objetivo_pct)}" /></div>
          <div>${labelInfo("rc-var", "Costos variables (%)", "Otros costos que crecen con la venta: comisiones de tarjeta y QR, Ingresos Brutos, envases, plataformas.")}<input id="rc-var" inputmode="decimal" value="${fmt(e.costos_variables_pct)}" /></div>
          <div>${labelInfo("rc-dias", "Días operativos por mes", "Días que abre el local en un mes típico. Define el equilibrio diario.")}<input id="rc-dias" type="number" min="1" max="31" value="${e.dias_operativos_mes}" /></div>
        </div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 6px;">Qué cuenta como venta</h3>
        ${labelInfo("rc-cats", "Categorías de ingreso de caja que son ventas", "Una por línea. El tablero suma los ingresos del Flujo de caja con estas categorías (también los cargados a mano). Se compara sin distinguir mayúsculas.")}
        <textarea id="rc-cats" rows="4" style="width:100%;">${escapar((e.categorias_venta || []).join("\n"))}</textarea>
      </div>
      ${conRRHH ? `<div class="card">
        <h3 style="margin:0 0 6px;">Sueldos (desde RRHH)</h3>
        <div class="fila">
          <div>${labelInfo("rc-cargas", "Cargas sociales (%)", "% sobre el sueldo (aportes patronales, obra social, ART…). Lo define el dueño o su contador. Se aplica solo a empleados dados de alta y en relación de dependencia.")}<input id="rc-cargas" inputmode="decimal" value="${fmt(e.cargas_sociales_pct)}" /></div>
          <div><label style="display:flex;align-items:center;gap:8px;margin-top:26px;color:var(--tinta);"><input type="checkbox" id="rc-agui" style="width:auto;" ${e.provisionar_aguinaldo ? "checked" : ""} /> Provisionar aguinaldo (1/12 por mes)</label></div>
        </div></div>` : ""}
      <div style="margin-top:14px;"><button type="submit" style="min-height:44px;">Guardar</button></div>
      <p id="rc-msg" class="msg" hidden></p>
    </form>`;

  $(container, "#rc-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = $(container, "#rc-msg");
    const nuevos = {
      cmv_objetivo_pct: num($(container, "#rc-cmv").value), costos_variables_pct: num($(container, "#rc-var").value),
      dias_operativos_mes: num($(container, "#rc-dias").value),
      categorias_venta: $(container, "#rc-cats").value.split("\n").map((x) => x.trim()).filter(Boolean),
    };
    const actuales = { cmv_objetivo_pct: Number(e.cmv_objetivo_pct), costos_variables_pct: Number(e.costos_variables_pct), dias_operativos_mes: e.dias_operativos_mes, categorias_venta: e.categorias_venta };
    if (conRRHH) {
      nuevos.cargas_sociales_pct = num($(container, "#rc-cargas").value); nuevos.provisionar_aguinaldo = $(container, "#rc-agui").checked;
      actuales.cargas_sociales_pct = Number(e.cargas_sociales_pct); actuales.provisionar_aguinaldo = !!e.provisionar_aguinaldo;
    }
    for (const [k, v] of Object.entries(nuevos)) if (typeof v === "number" && !Number.isFinite(v)) { setMsg(msg, "Revisá los números: hay un valor inválido.", "error"); return; }
    if (nuevos.cmv_objetivo_pct + nuevos.costos_variables_pct >= 100) { setMsg(msg, "El CMV más los costos variables no pueden sumar 100 % o más.", "error"); return; }
    setMsg(msg, "Guardando…");
    try {
      let n = 0;
      for (const [k, v] of Object.entries(nuevos)) {
        if (JSON.stringify(v) === JSON.stringify(actuales[k])) continue;
        await repo.setConfig(k, v); n++;
        if (perfil.empresa) perfil.empresa[k] = v;
      }
      setMsg(msg, n ? `Guardado ✔ (${n} cambio${n === 1 ? "" : "s"})` : "No había cambios.", "ok");
    } catch (err) { setMsg(msg, "No se pudo guardar: " + (err.message || err), "error"); }
  });
}
