// Reads the text out of a PDF, entirely in the browser.
//
// Pages that carry real text are read directly. Pages that are only a picture
// (a scan or a photo) are drawn to a canvas and read with OCR (ocr.js), which
// also reads handwriting. The libraries are fetched from a CDN the first time
// they are needed; the PDF itself never leaves the device.

import { createReader } from './ocr.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';

export const MAX_PAGES = 60;

/** code: 'library' | 'ocr' | 'hand' | 'locked' | 'broken' */
export class PdfError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code;
    this.cause = cause;
  }
}

let pdfjsLoading = null;
function loadPdfjs() {
  pdfjsLoading ??= import(PDFJS + 'pdf.min.mjs').then(lib => {
    lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
    return lib;
  });
  pdfjsLoading.catch(() => { pdfjsLoading = null; }); // let the next import try again
  return pdfjsLoading;
}

/** Rebuild lines of text from the positioned fragments pdf.js gives back. */
function toLines(items) {
  const bits = items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: it.height || Math.abs(it.transform[3]) || 10 }));
  bits.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  for (const b of bits) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - b.y) <= Math.max(2, Math.min(row.h, b.h) * 0.45)) row.bits.push(b);
    else rows.push({ y: b.y, h: b.h, bits: [b] });
  }

  const lines = [];
  let prev = null;
  for (const row of rows) {
    row.bits.sort((a, b) => a.x - b.x);
    let line = '';
    let end = null;
    for (const b of row.bits) {
      if (end !== null && b.x - end > b.h * 0.18 && !line.endsWith(' ') && !b.s.startsWith(' ')) line += ' ';
      line += b.s;
      end = b.x + b.w;
    }
    // a taller gap than normal line spacing is kept as a blank line
    if (prev && prev.y - row.y > Math.max(prev.h, row.h) * 1.9) lines.push('');
    lines.push(line);
    prev = row;
  }
  return lines;
}

async function ocrPage(page, reader) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2400 / Math.max(base.width, base.height)); // about 200 dpi for an A4 page
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const res = await reader.read(canvas);
  canvas.width = canvas.height = 0;
  return res;
}

/**
 * Read a PDF file. mode says how scanned pages are read: 'auto', 'print' or 'hand'.
 * onProgress({ page, pages, ocr, stage, done, total }) is called as each page starts,
 * and while a scanned page is read (stage, done and total come from ocr.js).
 * Resolves to { text, pages, total, ocrPages, handPages }, or null if isCancelled() turned true.
 */
export async function readPdf(file, { mode = 'auto', onProgress = () => {}, isCancelled = () => false } = {}) {
  let pdfjs;
  try { pdfjs = await loadPdfjs(); } catch (err) { throw new PdfError('library', err); }

  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (err) {
    throw new PdfError(err?.name === 'PasswordException' ? 'locked' : 'broken', err);
  }

  const total = doc.numPages;
  const pages = Math.min(total, MAX_PAGES);
  const out = [];
  const ocrPages = [];
  const handPages = [];
  let n = 0;
  const reader = createReader({ mode, onStatus: st => onProgress({ page: n, pages, ocr: true, ...st }) });

  try {
    for (n = 1; n <= pages; n++) {
      if (isCancelled()) return null;
      onProgress({ page: n, pages, ocr: false });
      const page = await doc.getPage(n);
      let lines = toLines((await page.getTextContent()).items);

      if (lines.join('').replace(/\s/g, '').length < 25) {
        // next to no text on the page: treat it as a scan
        onProgress({ page: n, pages, ocr: true });
        let read;
        try { read = await ocrPage(page, reader); } catch (err) { throw new PdfError(err?.code === 'hand' ? 'hand' : 'ocr', err); }
        if (isCancelled()) return null;
        if (read.lines.join('').trim()) {
          lines = read.lines;
          ocrPages.push(n);
          if (read.hand) handPages.push(n);
        }
      }
      out.push(lines.join('\n'));
      page.cleanup();
    }
  } finally {
    reader.close();
    doc.destroy();
  }
  return { text: out.join('\n\n').trim(), pages, total, ocrPages, handPages };
}
