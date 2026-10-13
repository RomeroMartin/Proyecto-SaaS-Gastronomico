// ============================================================
// saas/ui/impresion.js — Impresión de tickets (comandas) desde el navegador
// ------------------------------------------------------------
// Imprime en la impresora del sistema usando un iframe oculto con su propio
// documento. El papel de una térmica es un rollo angosto (58/80 mm) y de largo
// variable; CSS no permite "alto automático", así que se calcula el ALTO REAL
// del ticket (líneas × interlineado) y se declara una página de ese tamaño
// exacto: sin margen blanco, sin tira larga y sin A4.
// La letra se calcula para que entren exactamente `columnas` caracteres en el
// ancho imprimible del papel (monoespaciada, 0,6 em por carácter).
// ============================================================

const MM_A_PX = 96 / 25.4;
const PERFIL_PAPEL = {
  // anchoMm: ancho del rollo · imprimibleMm: zona que realmente imprime la térmica · columnas por línea
  58: { anchoMm: 58, imprimibleMm: 48, columnas: 32 },
  80: { anchoMm: 80, imprimibleMm: 72, columnas: 42 },
};
const INTERLINEADO = 1.25;
const ALTO_MIN_SOBRE_ANCHO_MM = 12;  // la página SIEMPRE es más alta que ancha: si no, Chrome la manda horizontal y el driver la gira 90°
const MARGEN_VERTICAL_MM = 3;   // arriba y abajo
const COLA_POR_DEFECTO_MM = 20; // papel en blanco al final: la cuchilla corta unos mm DESPUÉS del último renglón
const COLA_MAX_MM = 80;

// Cada driver de térmica trata el papel distinto, así que el modo se elige POR EQUIPO (la impresora es de la PC):
//   ajustado → la página tiene el ancho del rollo y el alto del ticket (recomendado)
//   driver   → no se declara tamaño: se usa el papel que tenga configurado el driver (el ticket ocupa el ancho imprimible)
export const MODOS_PAPEL = { ajustado: "Ajustado al ticket (recomendado)", driver: "Usar el papel del driver" };
const LS_MODO = "saas_impresion_modo_papel";
export function getModoPapel() {
  try { const v = localStorage.getItem(LS_MODO); return MODOS_PAPEL[v] ? v : "ajustado"; } catch (_e) { return "ajustado"; }
}
export function setModoPapel(modo) {
  try { localStorage.setItem(LS_MODO, MODOS_PAPEL[modo] ? modo : "ajustado"); } catch (_e) { /* sin almacenamiento */ }
}

const LS_COLA = "saas_impresion_cola_mm";
/** Espacio en blanco al final del ticket, en mm (por equipo): para las impresoras con corte automático. */
export function getColaMm() {
  try { const v = Number(localStorage.getItem(LS_COLA)); return Number.isFinite(v) && localStorage.getItem(LS_COLA) !== null ? limitarCola(v) : COLA_POR_DEFECTO_MM; }
  catch (_e) { return COLA_POR_DEFECTO_MM; }
}
export function setColaMm(mm) {
  try { localStorage.setItem(LS_COLA, String(limitarCola(mm))); } catch (_e) { /* sin almacenamiento */ }
}
function limitarCola(mm) { return Math.min(COLA_MAX_MM, Math.max(0, Math.round(Number(mm) || 0))); }

/** Columnas (caracteres por línea) que entran en el rollo. */
export function columnasPapel(anchoMm) {
  return (PERFIL_PAPEL[Number(anchoMm)] || PERFIL_PAPEL[80]).columnas;
}

/**
 * Medidas del ticket: tamaño de letra y de página.
 * @returns {{anchoMm:number, altoMm:number, padLateralMm:number, fuentePx:number, columnas:number, lineas:number}}
 */
export function medidasTicket(texto, anchoMm = 80, colaMm = COLA_POR_DEFECTO_MM) {
  const p = PERFIL_PAPEL[Number(anchoMm)] || PERFIL_PAPEL[80];
  const lineas = Math.max(1, String(texto).split("\n").length);
  const fuentePx = (p.imprimibleMm * MM_A_PX) / (p.columnas * 0.6);
  const altoLineasMm = (lineas * fuentePx * INTERLINEADO) / MM_A_PX;
  return {
    anchoMm: p.anchoMm,
    altoMm: Math.max(Math.ceil(altoLineasMm + 2 * MARGEN_VERTICAL_MM + limitarCola(colaMm)), p.anchoMm + ALTO_MIN_SOBRE_ANCHO_MM),
    padLateralMm: (p.anchoMm - p.imprimibleMm) / 2,
    colaMm: limitarCola(colaMm),
    fuentePx: Math.round(fuentePx * 100) / 100,
    columnas: p.columnas,
    lineas,
  };
}

/** HTML completo del ticket (página de tamaño exacto). */
export function htmlTicket(texto, anchoMm = 80, modo = "ajustado", colaMm = COLA_POR_DEFECTO_MM) {
  const m = medidasTicket(texto, anchoMm, colaMm);
  const pagina = modo === "driver" ? "@page { margin: 0; }" : `@page { size: ${m.anchoMm}mm ${m.altoMm}mm; margin: 0; }`;
  const esc = String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Comanda</title>
<style>
${pagina}
html, body { margin: 0; padding: 0; background: #fff; width: ${m.anchoMm}mm; }
pre { margin: 0; box-sizing: border-box; width: ${m.anchoMm}mm; padding: ${MARGEN_VERTICAL_MM}mm ${m.padLateralMm}mm ${m.colaMm}mm;
  font: ${m.fuentePx}px/${INTERLINEADO} "Courier New", Courier, "Liberation Mono", monospace; white-space: pre; overflow: hidden; color: #000; }
</style></head><body><pre>${esc}</pre></body></html>`;
}

/**
 * @param {string} texto   ticket en texto plano (monoespaciado)
 * @param {number} anchoMm 58 u 80
 * @param {string} modo    ajustado | driver (por defecto, el elegido en este equipo)
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export function imprimirTicket(texto, anchoMm = 80, modo = getModoPapel(), colaMm = getColaMm()) {
  return new Promise((resolve) => {
    let marco;
    try {
      marco = document.createElement("iframe");
      marco.setAttribute("aria-hidden", "true");
      marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
      document.body.appendChild(marco);
      const doc = marco.contentWindow.document;
      doc.open();
      doc.write(htmlTicket(texto, anchoMm, modo, colaMm));
      doc.close();
      const limpiar = () => setTimeout(() => { try { marco.remove(); } catch (_e) { /* ya no está */ } }, 1500);
      setTimeout(() => {
        try {
          marco.contentWindow.focus();
          marco.contentWindow.print();   // bloquea hasta que se cierra el diálogo (o sale directo con --kiosk-printing)
          limpiar();
          resolve({ ok: true });
        } catch (err) {
          limpiar();
          resolve({ ok: false, error: (err && err.message) || String(err) });
        }
      }, 150);
    } catch (err) {
      try { if (marco) marco.remove(); } catch (_e) { /* nada */ }
      resolve({ ok: false, error: (err && err.message) || String(err) });
    }
  });
}
