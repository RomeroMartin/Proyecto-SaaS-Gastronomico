// ============================================================
// saas/ui/repartoTablero.js — Reparto de ingresos → Tablero ("apartados")
// ------------------------------------------------------------
// INFORMATIVO: no mueve plata ni genera movimientos de caja; todo se calcula al
// vuelo desde ventas de caja, gastos fijos, deuda y agenda. Solo ADMIN.
// Las cuentas las hace core/reparto.js (con tests); acá solo se muestra.
// ============================================================

import * as repo from "../data/repartoRepo.js";
import * as cajaRepo from "../data/movimientosCajaRepo.js";
import * as reportes from "../data/reportesVentasRepo.js";
import * as proveedoresRepo from "../data/proveedoresRepo.js";
import * as agendaRepo from "../data/pagosProgramadosRepo.js";
import { moduloActivo } from "../../core/modulos.js";
import { totalesPeriodo, mixDeVentas } from "../../core/costeo.js";
import {
  elegirCmvPct, armarFijos, puntoEquilibrio, repartirIngreso, estadoSobres, ritmoDelMes, proyeccionFinDeMes,
  ventasDeCaja, ventasPorFecha, diasConPosibleDuplicado, diasEnElMes, CMV_MIN_DIAS, CMV_MIN_UNIDADES,
} from "../../core/reparto.js";
import { formatearCentavos, formatearPorcentaje } from "../../core/dinero.js";
import { hoyISO, addDias, fechaOperativa, formatearFecha } from "../../core/utilsFecha.js";
import { escapar, kpiHTML } from "./helpers.js";

const $ = (c, s) => c.querySelector(s);
const money = (c) => formatearCentavos(c);
const ESTADO = {
  pagado: ["Pagado", "#15803d", "#f0fdf4"], cubierto: ["Cubierto", "#15803d", "#f0fdf4"],
  en_ritmo: ["En ritmo", "#1d4ed8", "#eff6ff"], atrasado: ["Atrasado", "#b91c1c", "#fef2f2"],
};
const barra = (pct, color = "var(--tinta)") => `<div style="background:#e4e4e7;border-radius:4px;height:10px;margin:6px 0;"><div style="background:${color};border-radius:4px;height:10px;width:${Math.max(0, Math.min(100, pct))}%;"></div></div>`;

export async function montar(container, perfil) {
  container.innerHTML = "<p class='muted'>Calculando el tablero…</p>";
  const mods = perfil.empresa && perfil.empresa.modulos;
  const conVentas = moduloActivo(mods, "ventas"), conRRHH = moduloActivo(mods, "rrhh");
  const emp = perfil.empresa || {};
  // Día de trabajo: con Ventas, el día operativo (respeta la hora de corte).
  const hoy = conVentas && emp.hora_corte_dia ? fechaOperativa(new Date(), undefined, emp.hora_corte_dia) : hoyISO();
  const mesIni = hoy.slice(0, 8) + "01";
  const histDesde = addDias(hoy, -62);

  let movs, gastos, sueldos = null, prov = [], agenda = [], dias = [], platos = [];
  try {
    [movs, gastos, prov, agenda] = await Promise.all([
      cajaRepo.listarRango(histDesde, hoy), repo.listarGastos(),
      proveedoresRepo.listar().catch(() => []), agendaRepo.listar().catch(() => []),
    ]);
    if (conRRHH) sueldos = await repo.gastoEmpleados(hoy);
    if (conVentas) [dias, platos] = await Promise.all([reportes.porDia(mesIni, hoy), reportes.porPlato(mesIni, hoy)]);
  } catch (err) {
    container.innerHTML = `<div class="card"><p class="error">No se pudo armar el tablero: ${escapar(err.message || String(err))}</p>
      <p class="muted">¿Corriste supabase/f4_reparto.sql y está activo el módulo Reparto?</p></div>`;
    return;
  }

  const catsVenta = emp.categorias_venta || ["Ventas", "Ventas tarjeta", "Ventas QR"];
  const movsMes = movs.filter((m) => m.fecha >= mesIni);
  const ventasMes = ventasDeCaja(movsMes, catsVenta).reduce((a, m) => a + (Number(m.monto_centavos) || 0), 0);
  const porFecha = ventasPorFecha(movs, catsVenta);
  const diasTranscurridos = Number(hoy.slice(8, 10));

  // CMV: el teórico del mes (Fase 3) si hay datos suficientes; si no, el objetivo.
  const tot = totalesPeriodo(dias);
  const unidades = mixDeVentas(platos).reduce((a, x) => a + x.unidades, 0);
  const cmv = elegirCmvPct({ cmvTeoricoPct: tot.cmvPct, diasConVentas: dias.filter((d) => d.pedidos > 0).length, unidades, objetivoPct: Number(emp.cmv_objetivo_pct ?? 35) });
  const varPct = Number(emp.costos_variables_pct ?? 0);

  const armado = armarFijos({ gastos, usaRRHH: conRRHH, sueldosRRHH: sueldos });
  let pe, mc;
  try { ({ pe, mc } = puntoEquilibrio({ fijosCentavos: armado.totalCentavos, cmvPct: cmv.pct, varPct, diasOperativosMes: Number(emp.dias_operativos_mes ?? 30) })); }
  catch (err) { container.innerHTML = `<div class="card"><p class="error">${escapar(err.message)}</p><p class="muted">Revisá el CMV objetivo y los costos variables en Reparto → Configuración.</p></div>`; return; }
  const diasOp = Number(emp.dias_operativos_mes ?? 30);
  const ped = Math.round(pe / Math.max(1, diasOp));

  const sobres = estadoSobres({ ventasMes, fijos: armado.fijos, cmvPct: cmv.pct, varPct, pe, hoy, movimientos: movsMes });
  const ritmo = ritmoDelMes({ ventasMes, pe, ped, diasTranscurridos, diasOperativosMes: diasOp });
  const proy = proyeccionFinDeMes({ ventasPorDia: porFecha, hoy, acumuladoMes: ventasMes });
  const ganancia = Math.round(mc * Math.max(0, ventasMes - pe));

  // Reparto del último día con ventas del mes.
  const delMes = porFecha.filter((v) => v.fecha >= mesIni);
  const ultimo = delMes[delMes.length - 1];
  const antes = ultimo ? delMes.filter((v) => v.fecha < ultimo.fecha).reduce((a, v) => a + v.centavos, 0) : 0;
  const repHoy = ultimo ? repartirIngreso({ monto: ultimo.centavos, acumuladoAntes: antes, fijos: armado.fijos, cmvPct: cmv.pct, varPct, pe }) : null;
  const repDiez = repartirIngreso({ monto: 1000000, acumuladoAntes: 0, fijos: armado.fijos, cmvPct: cmv.pct, varPct, pe });

  const deuda = prov.reduce((a, p) => a + (Number(p.saldo_total_deuda_centavos) || 0), 0);
  const en7 = agenda.filter((p) => p.estado === "pendiente" && p.fecha_programada >= hoy && p.fecha_programada <= addDias(hoy, 7));
  const agEfec = en7.filter((p) => p.metodo_pago === "efectivo").reduce((a, p) => a + p.monto_centavos, 0);
  const agCta = en7.filter((p) => p.metodo_pago !== "efectivo").reduce((a, p) => a + p.monto_centavos, 0);
  const duplicados = conVentas ? diasConPosibleDuplicado(movsMes, catsVenta) : [];

  const tarjeta = (s) => {
    const [txt, col, bg] = ESTADO[s.estado] || ESTADO.en_ritmo;
    const extra = s.tipo === "proveedores" ? `<div class="muted" style="font-size:12.5px;margin-top:4px;">Deuda actual con proveedores: <b>${money(deuda)}</b><br>Agendado a 7 días: <b>${money(agEfec)}</b> en efectivo · <b>${money(agCta)}</b> en cuenta</div>`
      : s.id === "__sueldos" && sueldos ? `<div class="muted" style="font-size:12.5px;margin-top:4px;">Sueldos ${money(sueldos.sueldos_centavos)} + cargas ${money(sueldos.cargas_centavos)} + aguinaldo ${money(sueldos.aguinaldo_centavos + sueldos.cargas_aguinaldo_centavos)} · ${sueldos.empleados_incluidos} empleado(s)
        · <a href="#" data-ir="rrhh_empleados">RRHH → Empleados</a>${sueldos.sin_horas ? `<br><span style="color:#b45309;">⚠ ${sueldos.sin_horas} empleado(s) por hora sin horas estimadas: no se suman.</span>` : ""}${sueldos.sin_alta ? `<br><span style="color:#b45309;">⚠ ${sueldos.sin_alta} empleado(s) sin alta: no incluyen cargas.</span>` : ""}</div>` : "";
    return `<div class="card" style="margin-top:0;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:start;"><b>${escapar(s.nombre)}</b>
        <span style="font-size:12px;font-weight:650;padding:2px 9px;border-radius:999px;color:${col};background:${bg};white-space:nowrap;">${txt}</span></div>
      ${barra(s.pctCubierto, col)}
      <div style="display:flex;justify-content:space-between;font-size:13.5px;"><span>${money(s.apartado)} apartados</span><span class="muted">objetivo ${money(s.objetivo)}</span></div>
      <div class="muted" style="font-size:12.5px;">${formatearPorcentaje(s.pctCubierto, 0)} cubierto${s.diaVencimiento ? ` · vence el ${s.diaVencimiento}` : ""}${s.yaPagado ? ` · ya pagado ${money(s.yaPagado)}` : ""}</div>
      ${extra}</div>`;
  };

  container.innerHTML = `
    <div class="topbar" style="margin-bottom:6px;"><h2 style="margin:0;">Reparto de ingresos · Tablero</h2>
      <button id="rt-ref" class="secundario">Refrescar</button></div>
    <p class="muted" style="margin:0 0 12px;font-size:12.5px;">Informativo: no mueve plata. Mes de ${escapar(formatearFecha(mesIni))} a ${escapar(formatearFecha(hoy))}. El CMV usado es <b>${formatearPorcentaje(cmv.pct)}</b>
      (${cmv.fuente === "teorico" ? "el teórico del mes, calculado con tus ventas" : `el objetivo de la empresa: faltan datos propios (se necesitan ${CMV_MIN_DIAS} días con ventas y ${CMV_MIN_UNIDADES} unidades)`}).</p>

    ${duplicados.length ? `<div class="card" style="border-color:#fed7aa;background:#fff7ed;margin-top:0;"><b>Posible duplicado:</b> hay ventas cargadas a mano el mismo día que un cierre de caja (${duplicados.map(formatearFecha).join(", ")}). Revisá el Flujo de caja para no contarlas dos veces.</div>` : ""}
    ${armado.ignorados.length ? `<div class="card" style="border-color:#fed7aa;background:#fff7ed;margin-top:0;">Con RRHH activo, los sueldos salen de RRHH: se ignoran ${armado.ignorados.length} gasto(s) fijo(s) de categoría sueldos/cargas (${armado.ignorados.map((g) => escapar(g.nombre)).join(", ")}). Dalos de baja en <b>Gastos fijos</b>.</div>` : ""}

    <div class="kpi-grid" style="margin-top:0;">
      ${kpiHTML("Ventas del mes", money(ventasMes), `categorías: ${catsVenta.join(", ")}`, "", "Ingresos de caja de las categorías de venta. Funciona también con ingresos cargados a mano.")}
      ${kpiHTML("Punto de equilibrio", money(pe), `${money(ped)} por día`, "", "Lo que hay que vender en el mes para cubrir los gastos fijos, después del CMV y los costos variables.")}
      ${kpiHTML("Ganancia estimada", money(ganancia), ventasMes >= pe ? "sobre el equilibrio" : "todavía no se cubre el equilibrio", ventasMes >= pe ? "ok" : "", "Lo que queda del margen de contribución una vez superado el equilibrio.")}
      ${kpiHTML("Proyección a fin de mes", money(proy.centavos), proy.tipo === "ponderada" ? "por día de la semana" : "estimación simple", proy.centavos >= pe ? "ok" : "danger", proy.tipo === "ponderada" ? "Usa tu histórico de ventas por día de la semana." : "Sin histórico suficiente se proyecta en forma lineal: puede engañar a principio de mes.")}
    </div>
    <div class="card" style="margin-top:0;">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;"><b>Equilibrio cubierto: ${formatearPorcentaje(Math.min(100, ritmo.pctPE), 0)}</b>
        <span style="color:${ritmo.diferencia >= 0 ? "var(--ok)" : "var(--error)"};font-weight:600;">Vas ${money(Math.abs(ritmo.diferencia))} ${ritmo.diferencia >= 0 ? "por encima" : "por debajo"} del ritmo de equilibrio</span></div>
      ${barra(ritmo.pctPE, ventasMes >= pe ? "var(--ok)" : "var(--tinta)")}
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px;">De cada ${money(1000000)} que entran</h3>
      <div class="tabla-scroll"><table><tbody>${repDiez.partes.filter((p) => p.centavos > 0 || p.tipo !== "ganancia").map((p) => `<tr><td>${escapar(p.nombre)}</td><td class="num">${money(p.centavos)}</td></tr>`).join("")}
        <tr><td class="muted">${ventasMes >= pe ? "Con el equilibrio cubierto, lo que no va a proveedores ni a costos variables es ganancia." : "Mientras no se cubra el equilibrio, el margen se reparte entre los gastos fijos."}</td><td></td></tr></tbody></table></div>
    </div>

    ${repHoy ? `<div class="card"><h3 style="margin:0 0 6px;">Reparto del último día con ventas (${escapar(formatearFecha(ultimo.fecha))}): ${money(ultimo.centavos)}</h3>
      <div class="tabla-scroll"><table><tbody>${repHoy.partes.filter((p) => p.centavos > 0).map((p) => `<tr><td>${escapar(p.nombre)}</td><td class="num">${money(p.centavos)}</td></tr>`).join("")}
        <tr><td><b>Total</b></td><td class="num"><b>${money(repHoy.total)}</b></td></tr></tbody></table></div>
      <p class="muted" style="font-size:12.5px;margin:6px 0 0;">Cuánto separar de ese día para cada sobre. La suma da exactamente el total.</p></div>` : ""}

    <h3 style="margin:18px 0 8px;">Sobres</h3>
    ${armado.fijos.length ? "" : `<div class="card" style="margin-top:0;"><p class="muted" style="margin:0;">Todavía no cargaste gastos fijos. Cargalos en <b>Reparto → Gastos fijos</b> para calcular el punto de equilibrio.</p></div>`}
    <div class="dos-col" style="align-items:stretch;">${sobres.map(tarjeta).join("")}</div>`;

  $(container, "#rt-ref").addEventListener("click", () => montar(container, perfil));
  container.querySelectorAll("[data-ir]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const b = document.querySelector(`[data-clave="${a.dataset.ir}"]`); if (b) b.click();
  }));
}
