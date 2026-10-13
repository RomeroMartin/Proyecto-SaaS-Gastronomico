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
const MARGEN_VERTICAL_MM = 3;   // arriba y abajo
const COLA_MM = 12;             // papel extra al final para que el corte no se lleve texto

/** Columnas (caracteres por línea) que entran en el rollo. */
export function columnasPapel(anchoMm) {
  return (PERFIL_PAPEL[Number(anchoMm)] || PERFIL_PAPEL[80]).columnas;
}

/**
 * Medidas del ticket: tamaño de letra y de página.
 * @returns {{anchoMm:number, altoMm:number, padLateralMm:number, fuentePx:number, columnas:number, lineas:number}}
 */
export function medidasTicket(texto, anchoMm = 80) {
  const p = PERFIL_PAPEL[Number(anchoMm)] || PERFIL_PAPEL[80];
  const lineas = Math.max(1, String(texto).split("\n").length);
  const fuentePx = (p.imprimibleMm * MM_A_PX) / (p.columnas * 0.6);
  const altoLineasMm = (lineas * fuentePx * INTERLINEADO) / MM_A_PX;
  return {
    anchoMm: p.anchoMm,
    altoMm: Math.ceil(altoLineasMm + 2 * MARGEN_VERTICAL_MM + COLA_MM),
    padLateralMm: (p.anchoMm - p.imprimibleMm) / 2,
    fuentePx: Math.round(fuentePx * 100) / 100,
    columnas: p.columnas,
    lineas,
  };
}

/** HTML completo del ticket (página de tamaño exacto). */
export function htmlTicket(texto, anchoMm = 80) {
  const m = medidasTicket(texto, anchoMm);
  const esc = String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Comanda</title>
<style>
@page { size: ${m.anchoMm}mm ${m.altoMm}mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; width: ${m.anchoMm}mm; }
pre { margin: 0; box-sizing: border-box; width: ${m.anchoMm}mm; padding: ${MARGEN_VERTICAL_MM}mm ${m.padLateralMm}mm 0;
  font: ${m.fuentePx}px/${INTERLINEADO} "Courier New", Courier, "Liberation Mono", monospace; white-space: pre; overflow: hidden; color: #000; }
</style></head><body><pre>${esc}</pre></body></html>`;
}

/**
 * @param {string} texto   ticket en texto plano (monoespaciado)
 * @param {number} anchoMm 58 u 80
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export function imprimirTicket(texto, anchoMm = 80) {
  return new Promise((resolve) => {
    let marco;
    try {
      marco = document.createElement("iframe");
      marco.setAttribute("aria-hidden", "true");
      marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
      document.body.appendChild(marco);
      const doc = marco.contentWindow.document;
      doc.open();
      doc.write(htmlTicket(texto, anchoMm));
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
