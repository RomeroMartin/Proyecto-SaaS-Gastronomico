// ============================================================
// export/excel.js — Exportación a .xlsx vía SheetJS (Sección 2.1)
// ------------------------------------------------------------
// SheetJS se carga por CDN en app.html (window.XLSX).
// ============================================================

import { hoyISO } from "../core/utilsFecha.js";

/**
 * Exporta filas (array de objetos planos) a un .xlsx y dispara la descarga.
 * @param {object[]} filas
 * @param {string} nombreArchivo  sin extensión
 * @param {string} [nombreHoja="Datos"]
 */
export function exportarExcel(filas, nombreArchivo, nombreHoja = "Datos") {
  if (!window.XLSX) {
    throw new Error("SheetJS (XLSX) no está cargado. Verificá el <script> en app.html.");
  }
  if (!filas || !filas.length) {
    throw new Error("No hay datos para exportar.");
  }
  const ws = window.XLSX.utils.json_to_sheet(filas);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, nombreHoja.slice(0, 31));
  const fecha = hoyISO();
  window.XLSX.writeFile(wb, `${nombreArchivo}-${fecha}.xlsx`);
}

// ---------- Importación (Fase 5) ----------

/**
 * Descarga un libro de Excel con varias hojas.
 * @param {{nombre:string, filas:any[][]}[]} hojas  cada hoja es una matriz (arreglo de arreglos)
 * @param {string} nombreArchivo  sin extensión
 */
export function descargarLibro(hojas, nombreArchivo) {
  if (!window.XLSX) throw new Error("SheetJS (XLSX) no está cargado. Verificá el <script> en app.html.");
  const wb = window.XLSX.utils.book_new();
  for (const h of hojas) {
    const ws = window.XLSX.utils.aoa_to_sheet(h.filas);
    ws["!cols"] = (h.filas[0] || []).map((_, i) => ({ wch: Math.min(60, Math.max(12, ...h.filas.map((f) => String(f[i] == null ? "" : f[i]).length)) + 2) }));
    window.XLSX.utils.book_append_sheet(wb, ws, h.nombre.slice(0, 31));
  }
  window.XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
}

/**
 * Lee un archivo .xlsx/.xls/.csv y devuelve las filas de la hoja "Datos" (o, si no hay,
 * de la primera hoja) como objetos encabezado → valor. Los valores vacíos quedan en "".
 * @param {ArrayBuffer} buffer
 * @returns {{filas: object[], hoja: string}}
 */
export function leerExcel(buffer) {
  if (!window.XLSX) throw new Error("SheetJS (XLSX) no está cargado. Verificá el <script> en app.html.");
  const wb = window.XLSX.read(buffer, { type: "array", cellDates: false });
  const nombre = wb.SheetNames.find((n) => n.trim().toLowerCase() === "datos") || wb.SheetNames[0];
  if (!nombre) throw new Error("El archivo no tiene hojas.");
  const filas = window.XLSX.utils.sheet_to_json(wb.Sheets[nombre], { defval: "", raw: true });
  return { filas, hoja: nombre };
}
