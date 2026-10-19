// ============================================================
// saas/ui/importador.js — "Importar desde Excel" (Fase 5): proveedores, insumos y gastos fijos
// ------------------------------------------------------------
// Flujo: descargar plantilla → completarla → subir → vista previa con validación fila por fila
// → confirmar. Se guarda todo en una sola operación (RPC); si algo falla, no se guarda nada.
// La validación y los cálculos viven en core/importacion.js (sin DOM).
// ============================================================

import * as importacionRepo from "../data/importacionRepo.js";
import * as proveedoresRepo from "../data/proveedoresRepo.js";
import * as insumosRepo from "../data/insumosRepo.js";
import * as repartoRepo from "../data/repartoRepo.js";
import * as catalogos from "../data/catalogosRepo.js";
import { descargarLibro, leerExcel } from "../../export/excel.js";
import { moduloActivo } from "../../core/modulos.js";
import { CATEGORIAS_RESERVADAS } from "../../core/reparto.js";
import {
  TIPOS, MAX_FILAS, MAX_BYTES, normalizarFilas, validarFilas, filasParaImportar,
  matrizPlantilla, matrizEjemplo, matrizInstrucciones,
} from "../../core/importacion.js";
import { escapar, toast, abrirModal, cerrarModal } from "./helpers.js";

const $ = (c, s) => c.querySelector(s);
const MAX_FILAS_VISTA = 300;

/** Roles que pueden importar cada tipo (los mismos que la base exige). */
export const ROLES_IMPORTA = { proveedores: ["ADMIN", "GERENTE"], insumos: ["ADMIN", "GERENTE", "COCINA"], gastos: ["ADMIN"] };
export const puedeImportar = (tipo, perfil) => !!perfil && (ROLES_IMPORTA[tipo] || []).includes(perfil.rol);

/**
 * Abre el importador.
 * @param {{tipo:"proveedores"|"insumos"|"gastos", perfil:object, onTerminado?:()=>void}} o
 */
export function abrirImportador({ tipo, perfil, onTerminado }) {
  const def = TIPOS[tipo];
  const body = abrirModal(`Importar ${def.titulo.toLowerCase()} desde Excel`, { ancho: "lg" });
  let validadas = null;

  body.innerHTML = `
    <ol class="muted" style="margin:0 0 12px;padding-left:18px;font-size:13px;line-height:1.6;">
      <li>Descargá la plantilla y completá la hoja <b>Datos</b> (la hoja <b>Ejemplo</b> muestra cómo).</li>
      <li>Subí el archivo (.xlsx, .xls o .csv): vas a ver una vista previa y los errores, fila por fila.</li>
      <li>Si todo está bien, confirmás y se guarda <b>todo junto</b> (si algo falla, no se guarda nada).</li>
    </ol>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
      <button type="button" class="secundario" id="imp-plantilla">⬇ Descargar plantilla</button>
      <input type="file" id="imp-archivo" accept=".xlsx,.xls,.csv" />
    </div>
    <div style="margin-bottom:10px;font-size:13px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
      <b>Si ya existe (mismo nombre):</b>
      <label style="display:inline-flex;align-items:center;gap:6px;margin:0;"><input type="radio" name="imp-modo" value="saltear" checked style="width:auto;margin:0;" /> Saltearlo</label>
      <label style="display:inline-flex;align-items:center;gap:6px;margin:0;"><input type="radio" name="imp-modo" value="actualizar" style="width:auto;margin:0;" /> Actualizarlo con los datos del archivo</label>
    </div>
    <div id="imp-resultado"></div>
    <p id="imp-msg" class="msg" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button type="button" class="secundario" id="imp-cancelar">Cancelar</button>
      <button type="button" id="imp-confirmar" disabled style="opacity:.45;">Importar</button>
    </div>`;

  const res = $(body, "#imp-resultado"), msg = $(body, "#imp-msg"), btn = $(body, "#imp-confirmar");
  const actualizar = () => $(body, 'input[name="imp-modo"]:checked').value === "actualizar";
  const error = (t) => { msg.hidden = false; msg.className = "msg error"; msg.textContent = t; };
  const limpiarMsg = () => { msg.hidden = true; msg.textContent = ""; };

  $(body, "#imp-cancelar").addEventListener("click", cerrarModal);
  $(body, "#imp-plantilla").addEventListener("click", () => {
    try {
      descargarLibro([
        { nombre: "Datos", filas: matrizPlantilla(tipo) },
        { nombre: "Ejemplo", filas: matrizEjemplo(tipo) },
        { nombre: "Instrucciones", filas: matrizInstrucciones(tipo) },
      ], `plantilla-${tipo}`);
    } catch (err) { error(err.message || String(err)); }
  });

  const pintar = () => {
    if (!validadas) return;
    const r = validadas.resumen, mandar = filasParaImportar(validadas, actualizar()).length;
    const color = { nueva: "#166534", existente: "#92400e", error: "#b91c1c" };
    const etiqueta = (f) => f.estado === "nueva" ? "Nueva" : f.estado === "existente" ? (actualizar() ? "Se actualiza" : "Ya existe: se saltea") : "Error";
    const filas = validadas.filas.slice(0, MAX_FILAS_VISTA);
    res.innerHTML = `
      <p style="margin:0 0 8px;font-size:13.5px;"><b>${r.total}</b> filas leídas · <span style="color:${color.nueva};"><b>${r.nuevas}</b> nuevas</span> ·
        <span style="color:${color.existente};"><b>${r.existentes}</b> ya existen</span> ·
        <span style="color:${color.error};"><b>${r.conError}</b> con error</span>${r.avisos ? ` · ${r.avisos} con aviso` : ""}</p>
      ${r.conError ? `<p class="error" style="margin:0 0 8px;font-size:13px;">Corregí las filas con error en el Excel y volvé a subirlo: no se importa nada hasta que no quede ninguna.</p>` : ""}
      <div class="tabla-scroll" style="max-height:340px;overflow:auto;"><table>
        <thead><tr><th class="num">Fila</th><th>Nombre</th><th>Estado</th><th>Detalle</th></tr></thead>
        <tbody>${filas.map((f) => `<tr>
          <td class="num">${f.n}</td><td>${escapar(f.nombre || "—")}</td>
          <td style="color:${color[f.estado]};white-space:nowrap;">${escapar(etiqueta(f))}</td>
          <td class="${f.errores.length ? "error" : "muted"}" style="font-size:12.5px;">${f.errores.length ? escapar(f.errores.join(" ")) : escapar(f.resumen)}${f.avisos.length ? `<div style="color:#92400e;">${escapar(f.avisos.join(" "))}</div>` : ""}</td></tr>`).join("")}</tbody></table></div>
      ${validadas.filas.length > MAX_FILAS_VISTA ? `<p class="muted" style="font-size:12px;">Se muestran las primeras ${MAX_FILAS_VISTA} filas; se validan y se importan todas.</p>` : ""}`;
    btn.disabled = r.conError > 0 || mandar === 0;
    btn.style.opacity = btn.disabled ? ".45" : "";
    btn.textContent = r.conError ? "Importar" : mandar ? `Importar ${mandar} ${mandar === 1 ? "fila" : "filas"}` : "Nada para importar";
  };
  body.querySelectorAll('input[name="imp-modo"]').forEach((i) => i.addEventListener("change", pintar));

  $(body, "#imp-archivo").addEventListener("change", async (e) => {
    const archivo = e.target.files && e.target.files[0];
    validadas = null; btn.disabled = true; btn.style.opacity = ".45"; btn.textContent = "Importar"; res.innerHTML = ""; limpiarMsg();
    if (!archivo) return;
    if (archivo.size > MAX_BYTES) { error("El archivo pesa más de 5 MB: dividilo en partes."); return; }
    res.innerHTML = "<p class='muted'>Leyendo y validando…</p>";
    try {
      const { filas: crudas } = leerExcel(await archivo.arrayBuffer());
      if (!crudas.length) throw new Error("No encontré filas con datos. ¿Completaste la hoja «Datos»?");
      if (crudas.length > MAX_FILAS) throw new Error(`El archivo tiene ${crudas.length} filas: el máximo por importación es ${MAX_FILAS}.`);
      const { filas, faltantes, desconocidas } = normalizarFilas(tipo, crudas);
      if (faltantes.length) throw new Error(`Faltan columnas obligatorias: ${faltantes.join(", ")}. Usá la plantilla.`);
      validadas = validarFilas(tipo, filas, await contexto(tipo, perfil));
      res.innerHTML = "";
      if (desconocidas.length) { msg.hidden = false; msg.className = "msg"; msg.textContent = `Columnas que no se usan (se ignoran): ${desconocidas.join(", ")}.`; }
      pintar();
    } catch (err) { res.innerHTML = ""; error(err.message || String(err)); }
  });

  btn.addEventListener("click", async () => {
    if (!validadas) return;
    const filas = filasParaImportar(validadas, actualizar());
    btn.disabled = true; limpiarMsg(); msg.hidden = false; msg.className = "msg"; msg.textContent = "Importando…";
    try {
      const r = await importacionRepo.importar(tipo, filas, actualizar());
      await asegurarCatalogos(tipo, perfil, filas);
      cerrarModal();
      toast(`Importación lista ✔ ${resumenTexto(r)}`);
      if (onTerminado) onTerminado();
    } catch (err) {
      btn.disabled = false;
      error("No se guardó nada. " + (err.message || String(err)));
    }
  });
}

function resumenTexto(r) {
  const partes = [];
  if (r.creados) partes.push(`${r.creados} nuevos`);
  if (r.actualizados) partes.push(`${r.actualizados} actualizados`);
  if (r.salteados) partes.push(`${r.salteados} salteados`);
  return partes.join(", ") || "sin cambios";
}

/** Lo que ya existe en la empresa (para detectar repetidos y resolver proveedores). */
async function contexto(tipo, perfil) {
  const clave = (n) => String(n || "").trim().toLowerCase();
  if (tipo === "proveedores") {
    return { existentes: new Set((await proveedoresRepo.listar()).map((p) => clave(p.nombre))) };
  }
  if (tipo === "insumos") {
    const [ins, provs] = await Promise.all([insumosRepo.listar(), proveedoresRepo.listar().catch(() => [])]);
    return { existentes: new Set(ins.map((i) => clave(i.nombre))), proveedores: new Map(provs.map((p) => [clave(p.nombre), p.id])) };
  }
  const gastos = await repartoRepo.listarGastos();
  return {
    existentes: new Set(gastos.map((g) => clave(g.nombre))),
    conRRHH: moduloActivo(perfil.empresa && perfil.empresa.modulos, "rrhh"),
    categoriasReservadas: CATEGORIAS_RESERVADAS,
  };
}

/** Agrega al catálogo de opciones los rubros/categorías nuevos del archivo (best-effort). */
async function asegurarCatalogos(tipo, perfil, filas) {
  try {
    await catalogos.cargar();
    const nuevos = new Set();
    for (const f of filas) {
      if (tipo === "insumos" && f.rubro) nuevos.add(f.rubro);
      if (tipo === "proveedores") (f.rubros || []).forEach((r) => nuevos.add(r));
      if (tipo === "gastos" && f.categoria) nuevos.add(f.categoria);
    }
    const catTipo = tipo === "gastos" ? "cat_gasto_fijo" : "rubro";
    for (const v of nuevos) await catalogos.asegurar(perfil.empresa_id, catTipo, v);
  } catch (_e) { /* no es crítico */ }
}
