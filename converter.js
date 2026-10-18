// Conversión PDF → Markdown 100 % en el navegador (sin servidor, sin IA).
// Usa pdf.js para leer texto con su posición y tamaño de letra, y
// reconstruye títulos, párrafos, listas y tablas sencillas a partir de eso.

const BULLET_RE = /^\s*([•◦▪▫●○■□‣⁃∙·\-–—*])\s+/;
const NUMBERED_RE = /^\s*((\d{1,3}|[a-zA-Z]|[ivxlcIVXLC]{1,5})[.)])\s+/;

const round = (n, d = 1) => Math.round(n * d) / d;

/** Agrupa los fragmentos de texto de una página en líneas. */
function buildLines(items, pageHeight = 842) {
  const frags = items
    .filter((it) => it.str !== undefined)
    .map((it) => {
      const [a, b, c, d, x, y] = it.transform;
      const size = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 10;
      return { str: it.str, x, y, w: it.width, size, eol: it.hasEOL };
    })
    .filter((f) => f.str.trim() !== "" || f.str === " ");

  // Ordena de arriba a abajo, luego de izquierda a derecha.
  frags.sort((p, q) => (Math.abs(p.y - q.y) > Math.min(p.size, q.size) * 0.4 ? q.y - p.y : p.x - q.x));

  const lines = [];
  for (const f of frags) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - f.y) <= Math.max(2, Math.min(last.size, f.size) * 0.45)) {
      last.frags.push(f);
      last.size = Math.max(last.size, f.size);
    } else {
      lines.push({ y: f.y, size: f.size, frags: [f] });
    }
  }

  for (const line of lines) {
    line.frags.sort((p, q) => p.x - q.x);
    // Une los fragmentos y detecta "celdas" separadas por huecos grandes.
    const cells = [];
    let cur = null;
    let text = "";
    let prevEnd = null;
    let pendingSpace = false;
    for (const f of line.frags) {
      // pdf.js inserta espacios "sintéticos" que cubren todo el hueco entre
      // columnas; no deben contar como texto para medir la separación.
      if (!f.str.trim()) {
        pendingSpace = prevEnd !== null;
        continue;
      }
      const gap = prevEnd === null ? 0 : f.x - prevEnd;
      if (cur && gap > line.size * 1.8) {
        cells.push(cur);
        cur = null;
      }
      const needsSpace =
        prevEnd !== null && (pendingSpace || gap > line.size * 0.12) && !/\s$/.test(text) && !/^\s/.test(f.str);
      pendingSpace = false;
      if (needsSpace) text += " ";
      text += f.str;
      if (!cur) cur = { x: f.x, text: "" };
      cur.text += (cur.text && needsSpace ? " " : "") + f.str;
      prevEnd = f.x + (f.w || 0);
    }
    if (cur) cells.push(cur);
    line.text = text.replace(/\s+/g, " ").trim();
    line.cells = cells.map((c) => ({ x: c.x, text: c.text.replace(/\s+/g, " ").trim() })).filter((c) => c.text);
    line.x = line.frags[0].x;
    // Franja superior/inferior de la página, donde viven encabezados y pies.
    line.edge = line.y > pageHeight * 0.92 || line.y < pageHeight * 0.08;
  }
  return lines.filter((l) => l.text);
}

/** Tamaño de letra más frecuente (ponderado por caracteres) = texto normal. */
function bodySize(pages) {
  const counts = new Map();
  for (const lines of pages)
    for (const l of lines) {
      const k = round(l.size, 2);
      counts.set(k, (counts.get(k) || 0) + l.text.length);
    }
  let best = 10;
  let max = -1;
  for (const [k, v] of counts) if (v > max) [best, max] = [k, v];
  return best;
}

/** Quita encabezados/pies de página repetidos y números de página. */
function stripRepeated(pages) {
  const norm = (t) => t.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const isPageNumber = (k) => /^[-–—\s]*((p[áa]g(ina)?|page|p)\.?\s*)?#(\s*(de|of|\/)\s*#)?[-–—\s]*$/.test(k);
  const freq = new Map();
  for (const lines of pages) {
    const edge = new Set(lines.filter((l) => l.edge).map((l) => norm(l.text)));
    for (const k of edge) freq.set(k, (freq.get(k) || 0) + 1);
  }
  const limit = Math.max(2, Math.ceil(pages.length * 0.5));
  return pages.map((lines) =>
    lines.filter((l) => {
      if (!l.edge) return true;
      const k = norm(l.text);
      if (isPageNumber(k)) return false;
      return pages.length < 3 || (freq.get(k) || 0) < limit;
    })
  );
}

function escapeCell(t) {
  return t.replace(/\|/g, "\\|");
}

function tableToMd(rows) {
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(cols - r.length).fill("")];
  const out = [];
  out.push("| " + pad(rows[0]).map(escapeCell).join(" | ") + " |");
  out.push("|" + " --- |".repeat(cols));
  for (const r of rows.slice(1)) out.push("| " + pad(r).map(escapeCell).join(" | ") + " |");
  return out.join("\n");
}

function looksLikeRow(line) {
  if (line.cells.length >= 3) return true;
  return line.cells.length === 2 && line.cells.every((c) => c.text.length <= 40);
}

/** Convierte las líneas de todas las páginas a Markdown. */
function linesToMarkdown(pages, opts) {
  const body = bodySize(pages);
  const headingSizes = [
    ...new Set(pages.flat().filter((l) => l.size >= body * 1.15 && l.text.length <= 150).map((l) => round(l.size, 2))),
  ].sort((a, b) => b - a);
  const headingLevel = (size) => {
    const i = headingSizes.indexOf(round(size, 2));
    return i < 0 ? 0 : Math.min(i + 1, 4);
  };

  const blocks = [];
  let para = null;
  const flush = () => {
    if (para) blocks.push(para.list ? "\u0000LI" + para.text : para.text);
    para = null;
  };

  pages.forEach((lines, pi) => {
    if (opts.pageBreaks && pi > 0) {
      flush();
      blocks.push(`<!-- Página ${pi + 1} -->`);
    }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const prev = lines[i - 1];

      // Tablas: 2 o más líneas seguidas con varias columnas alineadas.
      if (opts.tables && looksLikeRow(l)) {
        const rows = [l];
        let j = i + 1;
        while (j < lines.length && looksLikeRow(lines[j]) && Math.abs(lines[j].cells.length - l.cells.length) <= 1) {
          rows.push(lines[j]);
          j++;
        }
        if (rows.length >= 2) {
          flush();
          blocks.push(tableToMd(rows.map((r) => r.cells.map((c) => c.text))));
          i = j - 1;
          continue;
        }
      }

      const level = headingLevel(l.size);
      if (level) {
        flush();
        const last = blocks[blocks.length - 1];
        // Títulos partidos en dos líneas con el mismo tamaño.
        if (last && last.startsWith("#".repeat(level) + " ") && prev && round(prev.size, 2) === round(l.size, 2) && prev.y - l.y < l.size * 1.8) {
          blocks[blocks.length - 1] = last + " " + l.text;
        } else {
          blocks.push("#".repeat(level) + " " + l.text);
        }
        continue;
      }

      const bullet = l.text.match(BULLET_RE);
      const numbered = l.text.match(NUMBERED_RE);
      if (bullet || (numbered && l.text.length > numbered[0].length)) {
        flush();
        const content = bullet ? "- " + l.text.slice(bullet[0].length) : numbered[1].replace(")", ".") + " " + l.text.slice(numbered[0].length);
        para = { text: content, line: l, list: true };
        continue;
      }

      const gap = prev ? prev.y - l.y : Infinity;
      const continues =
        para &&
        prev &&
        gap > 0 &&
        gap < Math.max(prev.size, l.size) * 1.75 &&
        Math.abs(prev.size - l.size) < 0.5 &&
        (!para.list || l.x > para.line.x + 2);

      if (continues) {
        para.text = /[A-Za-zÀ-ÿ]-$/.test(para.text) ? para.text.slice(0, -1) + l.text : para.text + " " + l.text;
        para.line = para.list ? para.line : l;
      } else {
        flush();
        para = { text: l.text, line: l, list: false };
      }
    }
  });
  flush();

  // Los elementos de lista consecutivos van en líneas seguidas (lista compacta).
  let md = "";
  blocks.forEach((b, i) => {
    const isItem = b.startsWith("\u0000LI");
    const prev = blocks[i - 1] || "";
    const sameList = prev.startsWith("\u0000LI") && prev.startsWith("\u0000LI- ") === b.startsWith("\u0000LI- ");
    if (i > 0) md += isItem && sameList ? "\n" : "\n\n";
    md += isItem ? b.slice(3) : b;
  });
  return md.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

let ocrWorkerPromise = null;
async function ocrCanvas(canvas, langs) {
  if (!window.Tesseract) throw new Error("No se pudo cargar el motor OCR (Tesseract.js).");
  if (!ocrWorkerPromise) ocrWorkerPromise = window.Tesseract.createWorker(langs);
  const worker = await ocrWorkerPromise;
  const { data } = await worker.recognize(canvas);
  return data.text;
}

export async function terminateOcr() {
  if (ocrWorkerPromise) {
    const w = await ocrWorkerPromise;
    await w.terminate();
    ocrWorkerPromise = null;
  }
}

function ocrTextToMd(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/-\n(?=[a-zà-ÿ])/g, "").replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * @param {ArrayBuffer} data   contenido del PDF
 * @param {object} opts        { tables, pageBreaks, stripHeaders, ocr, ocrLangs, onProgress }
 */
export async function pdfToMarkdown(pdfjsLib, data, opts = {}) {
  const o = { tables: true, pageBreaks: false, stripHeaders: true, ocr: true, ocrLangs: "spa+eng", onProgress: () => {}, ...opts };
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  const ocrPages = new Map();
  let ocrCount = 0;

  for (let n = 1; n <= pdf.numPages; n++) {
    o.onProgress(n, pdf.numPages, "texto");
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const [, , , pageTop] = page.view;
    const lines = buildLines(content.items, pageTop);
    const chars = lines.reduce((s, l) => s + l.text.length, 0);

    if (chars < 25 && o.ocr) {
      o.onProgress(n, pdf.numPages, "OCR");
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const text = await ocrCanvas(canvas, o.ocrLangs);
      ocrPages.set(pages.length, ocrTextToMd(text));
      ocrCount++;
      pages.push([]);
    } else {
      pages.push(lines);
    }
    page.cleanup();
  }

  const cleaned = o.stripHeaders ? stripRepeated(pages) : pages;

  // Las páginas con OCR se insertan como texto plano en su posición.
  let md;
  if (ocrPages.size === 0) {
    md = linesToMarkdown(cleaned, o);
  } else {
    const parts = [];
    let run = [];
    const emit = () => {
      if (run.length) parts.push(linesToMarkdown(run, { ...o, pageBreaks: false }).trim());
      run = [];
    };
    cleaned.forEach((lines, i) => {
      if (ocrPages.has(i)) {
        emit();
        if (o.pageBreaks) parts.push(`<!-- Página ${i + 1} (OCR) -->`);
        parts.push(ocrPages.get(i));
      } else {
        if (o.pageBreaks && i > 0) {
          emit();
          parts.push(`<!-- Página ${i + 1} -->`);
        }
        run.push(lines);
      }
    });
    emit();
    md = parts.filter(Boolean).join("\n\n") + "\n";
  }

  await pdf.destroy();
  return { markdown: md, pages: pages.length, ocrPages: ocrCount };
}

// Exportado para pruebas.
export const _internals = { buildLines, linesToMarkdown, stripRepeated };
