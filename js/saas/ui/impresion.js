// ============================================================
// saas/ui/impresion.js — Impresión de tickets (comandas) desde el navegador
// ------------------------------------------------------------
// Imprime en la impresora del sistema usando un iframe oculto con su propio
// documento (hoja angosta de 58/80 mm): no depende de los estilos de la
// página ni de que el HTML principal esté actualizado. Devuelve el motivo
// del error para mostrarlo (no se traga la excepción).
// ============================================================

/**
 * @param {string} texto   ticket en texto plano (monoespaciado)
 * @param {number} anchoMm 58 u 80
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export function imprimirTicket(texto, anchoMm = 80) {
  return new Promise((resolve) => {
    let marco;
    try {
      const ancho = Number(anchoMm) === 58 ? 58 : 80;
      marco = document.createElement("iframe");
      marco.setAttribute("aria-hidden", "true");
      marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
      document.body.appendChild(marco);
      const doc = marco.contentWindow.document;
      doc.open();
      doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Comanda</title>
        <style>@page { size: ${ancho}mm auto; margin: 3mm; }
        html, body { margin: 0; padding: 0; background: #fff; }
        pre { margin: 0; font: 12px/1.25 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }</style>
        </head><body><pre id="t"></pre></body></html>`);
      doc.close();
      doc.getElementById("t").textContent = texto;
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
