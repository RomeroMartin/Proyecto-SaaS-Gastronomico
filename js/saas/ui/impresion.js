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
// El ticket se IMPRIME COMO IMAGEN (se dibuja en un canvas a la resolución de la térmica, ~203 dpi):
// si se manda como texto, el driver lo reemplaza por la letra interna de la impresora (otra tipografía,
// otro tamaño, "×" y "·" salen como "#" y "π", se pierden las líneas en blanco y se corta el final).
// Como imagen, sale EXACTAMENTE como se ve en la vista previa. Si el canvas no está disponible, se usa el texto.
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

// Formato: "imagen" (sale igual que la vista previa) o "texto" (la letra interna de la impresora, como antes).
// Por equipo: si en alguna impresora la imagen no sale, se vuelve a "texto" desde Configuración de ventas.
export const MODOS_FORMATO = { imagen: "Imagen (igual que la vista previa)", texto: "Texto (letra interna de la impresora)" };
const LS_FORMATO = "saas_impresion_formato";
export function getFormato() {
  try { const v = localStorage.getItem(LS_FORMATO); return MODOS_FORMATO[v] ? v : "imagen"; } catch (_e) { return "imagen"; }
}
export function setFormato(f) {
  try { localStorage.setItem(LS_FORMATO, MODOS_FORMATO[f] ? f : "imagen"); } catch (_e) { /* sin almacenamiento */ }
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
 * Texto apto para el modo "texto": el driver usa la letra interna de la impresora (solo ASCII seguro) y
 * descarta las líneas vacías, así que se quitan tildes/símbolos raros ("×" → "x", "·" → "-") y cada tramo en
 * blanco se reemplaza por una línea de guiones (si no, todo sale pegado).
 */
export function textoParaDriver(texto, columnas = 32) {
  const limpio = String(texto)
    .replace(/[×✕]/g, "x").replace(/[·•]/g, "-").replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e\n]/g, "");
  const regla = "-".repeat(columnas);
  const salida = [];
  let enBlanco = false;
  for (const ln of limpio.split("\n")) {
    if (ln.trim() === "") { if (!enBlanco && salida.length) salida.push(regla); enBlanco = true; continue; }
    enBlanco = false; salida.push(ln.replace(/\s+$/, ""));
  }
  if (salida.length && salida[salida.length - 1] === regla) salida.pop();
  return salida.join("\n");
}

const PUNTOS_POR_MM = 8; // 203 dpi ≈ 8 puntos por mm (térmicas estándar)

/**
 * Dibuja el ticket en un canvas a la resolución de la térmica (blanco y negro puro, letra en negrita).
 * @returns {{src:string, altoMm:number}|null}  null si el navegador no puede dibujar (se imprime como texto)
 */
export function renderizarTicket(texto, anchoMm = 80) {
  try {
    const p = PERFIL_PAPEL[Number(anchoMm)] || PERFIL_PAPEL[80];
    const ancho = Math.round(p.imprimibleMm * PUNTOS_POR_MM);
    const celda = ancho / p.columnas;                 // ancho de cada carácter, en puntos
    const fuente = celda / 0.6;
    const alto1 = Math.round(fuente * INTERLINEADO);
    const lineas = String(texto).split("\n");
    const canvas = document.createElement("canvas");
    canvas.width = ancho; canvas.height = Math.max(1, lineas.length) * alto1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000"; ctx.textBaseline = "alphabetic";
    ctx.font = `bold ${fuente}px "Courier New", Courier, "Liberation Mono", "DejaVu Sans Mono", monospace`;
    lineas.forEach((ln, i) => {
      const y = i * alto1 + fuente * 0.82 + (alto1 - fuente) / 2;
      Array.from(ln).forEach((ch, c) => {             // carácter por carácter: la grilla queda exacta
        if (ch === " ") return;
        const w = ctx.measureText(ch).width;
        ctx.fillText(ch, c * celda + Math.max(0, (celda - w) / 2), y);
      });
    });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
    for (let k = 0; k < d.length; k += 4) { const v = d[k] < 150 ? 0 : 255; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    return { src: canvas.toDataURL("image/png"), altoMm: canvas.height / PUNTOS_POR_MM };
  } catch (_e) { return null; }
}

/** HTML de la página con el ticket ya dibujado como imagen (src = data URL). */
export function htmlTicketImagen(src, altoImagenMm, anchoMm = 80, modo = "ajustado", colaMm = COLA_POR_DEFECTO_MM) {
  const p = PERFIL_PAPEL[Number(anchoMm)] || PERFIL_PAPEL[80];
  const cola = limitarCola(colaMm);
  const altoPagina = Math.max(Math.ceil(altoImagenMm + 2 * MARGEN_VERTICAL_MM + cola), p.anchoMm + ALTO_MIN_SOBRE_ANCHO_MM);
  const pagina = modo === "driver" ? "@page { margin: 0; }" : `@page { size: ${p.anchoMm}mm ${altoPagina}mm; margin: 0; }`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Comanda</title>
<style>
${pagina}
html, body { margin: 0; padding: 0; background: #fff; width: ${p.anchoMm}mm; }
img { display: block; width: ${p.imprimibleMm}mm; height: ${altoImagenMm}mm; margin: ${MARGEN_VERTICAL_MM}mm ${(p.anchoMm - p.imprimibleMm) / 2}mm ${cola}mm; image-rendering: pixelated; }
</style></head><body><img alt="" src="${src}"></body></html>`;
}

/**
 * @param {string} texto   ticket en texto plano (monoespaciado)
 * @param {number} anchoMm 58 u 80
 * @param {string} modo    ajustado | driver (por defecto, el elegido en este equipo)
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export function imprimirTicket(texto, anchoMm = 80, modo = getModoPapel(), colaMm = getColaMm(), formato = getFormato()) {
  return new Promise((resolve) => {
    let marco;
    try {
      marco = document.createElement("iframe");
      marco.setAttribute("aria-hidden", "true");
      // Fuera de pantalla pero con tamaño real (no 0x0 ni "hidden"): Chrome puede omitir las imágenes de un marco invisible.
      marco.style.cssText = "position:fixed;left:-10000px;top:0;width:300px;height:600px;border:0;";
      document.body.appendChild(marco);
      const doc = marco.contentWindow.document;
      doc.open();
      const dib = formato === "texto" ? null : renderizarTicket(texto, anchoMm);
      doc.write(dib ? htmlTicketImagen(dib.src, dib.altoMm, anchoMm, modo, colaMm)
        : htmlTicket(formato === "texto" ? textoParaDriver(texto, columnasPapel(anchoMm)) : texto, anchoMm, modo, colaMm));
      doc.close();
      const limpiar = () => setTimeout(() => { try { marco.remove(); } catch (_e) { /* ya no está */ } }, 1500);
      const imagen = marco.contentWindow.document.querySelector("img");
      // la imagen tiene que estar cargada Y decodificada antes de imprimir (si no, puede salir en blanco)
      const listo = !imagen ? Promise.resolve()
        : (imagen.complete ? Promise.resolve() : new Promise((ok) => { imagen.onload = imagen.onerror = ok; })).then(() => (imagen.decode ? imagen.decode().catch(() => {}) : null));
      Promise.race([listo, new Promise((ok) => setTimeout(ok, 1500))]).then(() => setTimeout(() => {
        try {
          marco.contentWindow.focus();
          marco.contentWindow.print();   // bloquea hasta que se cierra el diálogo (o sale directo con --kiosk-printing)
          limpiar();
          resolve({ ok: true });
        } catch (err) {
          limpiar();
          resolve({ ok: false, error: (err && err.message) || String(err) });
        }
      }, 150));
    } catch (err) {
      try { if (marco) marco.remove(); } catch (_e) { /* nada */ }
      resolve({ ok: false, error: (err && err.message) || String(err) });
    }
  });
}
