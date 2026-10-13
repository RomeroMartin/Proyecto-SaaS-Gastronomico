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
