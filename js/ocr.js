// Reading text out of photos and scanned pages, entirely in the browser.
//
//   1. Open the photo. iPhone HEIC photos are decoded with libheif (heic-to),
//      since only Safari can open them natively.
//   2. Clean it up: grey scale, even out shadows and uneven light by dividing by
//      the paper's own brightness, then stretch the contrast.
//   3. Printed text is read with Tesseract. Handwriting defeats Tesseract, so
//      when its confidence is low (or the person says the page is handwritten)
//      the page is cut into lines and each line is read by TrOCR, a model
//      trained on thousands of people's handwriting, neat and messy alike.
//
// The libraries and the model are fetched from CDNs the first time they are
// needed and cached by the browser. The photo itself never leaves the device.

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';
const HEIC = 'https://cdn.jsdelivr.net/npm/heic-to@1.6.6/dist/heic-to.js';
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
const HAND_MODEL = 'Xenova/trocr-small-handwritten';

/** Below this Tesseract confidence (0 to 100), a page in 'auto' mode is read as handwriting. */
const PRINT_CONFIDENCE = 62;
const MAX_SIDE = 2400; // pixels on the long side; enough for small print, small enough to stay quick

/** code: 'heic' | 'image' | 'ocr' | 'hand' */
export class OcrError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code;
    this.cause = cause;
  }
}

export const isImage = file => /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name);
const looksHeic = file => /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

const once = load => {
  let p = null;
  return () => {
    p ??= load();
    p.catch(() => { p = null; }); // let the next try load it again
    return p;
  };
};
const loadHeic = once(() => import(HEIC));
const loadTesseract = once(() => import(TESSERACT));
const loadTransformers = once(() => import(TRANSFORMERS));

// ---------- opening photos ----------

/** Draw a bitmap onto a canvas no bigger than MAX_SIDE. */
function toCanvas(bitmap) {
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

async function decodeHeic(file) {
  let lib;
  try { lib = await loadHeic(); } catch (err) { throw new OcrError('heic', err); }
  try { return await lib.heicTo({ blob: file, type: 'bitmap' }); } catch (err) { throw new OcrError('image', err); }
}

/** Open a JPG, PNG, WebP or HEIC photo as a canvas, turned the right way up. */
export async function openPhoto(file) {
  if (looksHeic(file)) return toCanvas(await decodeHeic(file));
  try {
    return toCanvas(await createImageBitmap(file, { imageOrientation: 'from-image' }));
  } catch (err) {
    // some phones save HEIC photos with a .jpg name; try that before giving up
    const lib = await loadHeic().catch(() => null);
    if (lib && await lib.isHeic(file).catch(() => false)) return toCanvas(await decodeHeic(file));
    throw new OcrError('image', err);
  }
}

// ---------- cleaning up ----------

/**
 * Even out the light and boost the contrast. Returns { canvas, gray, w, h },
 * where gray is the cleaned page, 0 (ink) to 255 (paper).
 */
export function cleanUp(src) {
  const w = src.width, h = src.height;
  const px = src.getContext('2d').getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];

  // the paper's brightness: the brightest pixel in each block (ink is always darker
  // than the paper around it), then smoothed, so shadows and gradients cancel out
  const B = Math.max(8, Math.round(Math.min(w, h) / 36));
  const gw = Math.ceil(w / B), gh = Math.ceil(h / B);
  let bg = new Float32Array(gw * gh);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      let m = 0;
      for (let y = by * B; y < Math.min(h, by * B + B); y += 2) {
        for (let x = bx * B; x < Math.min(w, bx * B + B); x += 2) m = Math.max(m, gray[y * w + x]);
      }
      bg[by * gw + bx] = m;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(bg.length);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) { sum += bg[yy * gw + xx]; n++; }
          }
        }
        out[y * gw + x] = sum / n;
      }
    }
    bg = out;
  }

  const clean = new Uint8ClampedArray(w * h);
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1.001, Math.max(0, y / B - 0.5));
    const y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1.001, Math.max(0, x / B - 0.5));
      const x0 = Math.floor(fx), tx = fx - x0;
      const a = bg[y0 * gw + x0], b = bg[y0 * gw + x0 + 1] ?? a;
      const c = bg[(y0 + 1) * gw + x0] ?? a, d = bg[(y0 + 1) * gw + x0 + 1] ?? c;
      const paper = Math.max(40, (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
      const v = Math.min(255, (gray[y * w + x] / paper) * 255);
      clean[y * w + x] = v;
      hist[v | 0]++;
    }
  }

  // stretch: the darkest 1% of pixels become black
  let lo = 0;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < 0.01 * w * h; lo++);
  lo = Math.min(lo, 150);
  const span = Math.max(40, 235 - lo);
  const out = new ImageData(w, h);
  for (let i = 0, j = 0; i < clean.length; i++, j += 4) {
    const v = Math.max(0, Math.min(255, ((clean[i] - lo) / span) * 255));
    clean[i] = v;
    out.data[j] = out.data[j + 1] = out.data[j + 2] = v;
    out.data[j + 3] = 255;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').putImageData(out, 0, 0);
  return { canvas, gray: clean, w, h };
}

// ---------- finding the lines of handwriting ----------

/** Otsu's threshold: the grey level that best splits ink from paper. */
function otsu(gray) {
  const hist = new Float64Array(256);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, at = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; at = t; }
  }
  return Math.min(at, 200);
}

/**
 * Ink mask with ruled notebook lines and margin lines taken out.
 * Returns { ink, rules }, where rules marks the pixels that were taken out.
 */
function inkMask(gray, w, h, threshold) {
  const ink = new Uint8Array(w * h);
  const rules = new Uint8Array(w * h);
  // a rule is inked a little lighter than writing, so look for it with a looser threshold
  const ruleTone = Math.min(235, threshold + 30);
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i] < threshold ? 1 : 0;
  // an unbroken straight run far longer than any pen stroke is a printed rule, not writing
  const longX = Math.max(60, Math.round(w * 0.1));
  for (let y = 0; y < h; y++) {
    for (let x = 0, start = -1; x <= w; x++) {
      const on = x < w && gray[y * w + x] < ruleTone;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= longX) {
          for (let k = start; k < x; k++) {
            rules[y * w + k] = 1;
            // the rule's soft edges, a row either side
            for (let dy = -1; dy <= 1; dy++) if (y + dy >= 0 && y + dy < h) ink[(y + dy) * w + k] = 0;
          }
        }
        start = -1;
      }
    }
  }
  const longY = Math.max(60, Math.round(h * 0.1));
  for (let x = 0; x < w; x++) {
    for (let y = 0, start = -1; y <= h; y++) {
      const on = y < h && gray[y * w + x] < ruleTone;
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        if (y - start >= longY) for (let k = start; k < y; k++) { ink[k * w + x] = 0; rules[k * w + x] = 1; }
        start = -1;
      }
    }
  }
  return { ink, rules };
}

/** Paint the removed rules white (and a pixel either side, for their soft edges), so the model never sees them. */
function eraseRules(canvas, rules, w, h) {
  let any = false;
  for (let i = 0; i < rules.length && !any; i++) any = rules[i] === 1;
  if (!any) return canvas;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!rules[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        const j = (yy * w + x) * 4;
        img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** How far the writing is tilted, in radians: the angle that gives the sharpest gaps between lines. */
function skewAngle(ink, w, h) {
  const step = Math.max(1, Math.round(w / 500));
  const pts = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (ink[y * w + x]) pts.push(x, y);
  if (pts.length < 200) return 0;
  let best = 0, bestScore = -1;
  for (let deg = -7; deg <= 7; deg += 0.5) {
    const a = deg * Math.PI / 180, sin = Math.sin(a), cos = Math.cos(a);
    const rows = new Float64Array(Math.ceil((h + w) / step) + 4);
    const off = Math.ceil(w / step) + 2;
    for (let i = 0; i < pts.length; i += 2) rows[Math.round((pts[i + 1] * cos - pts[i] * sin) / step) + off]++;
    let score = 0;
    for (let i = 1; i < rows.length; i++) score += (rows[i] - rows[i - 1]) ** 2;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

/** Turn a canvas by -angle about its centre, on white. */
function rotate(canvas, angle) {
  if (Math.abs(angle) < 0.003) return canvas;
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(-angle);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

const median = list => { const s = [...list].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] || 0; };

/**
 * Cut a page of handwriting into lines, each as a list of pieces to read left to right.
 * Returns [{ y, pieces: [canvas] }].
 */
export function findLines(page) {
  // straighten the page first, so lines run level
  let { gray, w, h } = page;
  const threshold = otsu(gray);
  const angle = skewAngle(inkMask(gray, w, h, threshold).ink, w, h);
  let canvas = page.canvas;
  if (Math.abs(angle) >= 0.003) {
    canvas = rotate(canvas, angle);
    const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = px[j];
  }
  const { ink, rules } = inkMask(gray, w, h, threshold);
  canvas = eraseRules(canvas, rules, w, h);

  // ink per row, lightly smoothed
  const raw = new Float64Array(h);
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) n += ink[y * w + x]; raw[y] = n; }
  const rows = raw.map((_, y) => (raw[y - 1] ?? raw[y]) * 0.25 + raw[y] * 0.5 + (raw[y + 1] ?? raw[y]) * 0.25);
  const peak = [...rows].sort((a, b) => b - a)[Math.floor(h * 0.02)] || 0;
  const cut = Math.max(2, peak * 0.07);

  // runs of inked rows
  let bands = [];
  for (let y = 0, start = -1; y <= h; y++) {
    const on = y < h && rows[y] > cut;
    if (on && start < 0) start = y;
    if (!on && start >= 0) { bands.push({ top: start, bottom: y }); start = -1; }
  }
  if (!bands.length) return [];
  let H = median(bands.map(b => b.bottom - b.top));

  // join pieces of one line split by a thin gap (dots, accents), and drop specks
  const joined = [];
  for (const b of bands) {
    const prev = joined[joined.length - 1];
    if (prev && b.top - prev.bottom < H * 0.3) prev.bottom = b.bottom;
    else joined.push({ ...b });
  }
  H = median(joined.map(b => b.bottom - b.top)) || H;
  bands = [];
  for (const b of joined) {
    const tall = b.bottom - b.top;
    if (tall >= H * 0.4) { bands.push(b); continue; }
    // a short run is a dot or a stray mark: give it to a neighbour if one is close
    const prev = bands[bands.length - 1];
    if (prev && b.top - prev.bottom < H * 0.6) prev.bottom = b.bottom;
  }
  // two lines that touch come out as one tall band: split it at its thinnest row
  const split = [];
  for (const b of bands) {
    const stack = [b];
    while (stack.length) {
      const c = stack.pop();
      if (c.bottom - c.top < H * 1.75) { split.push(c); continue; }
      let at = -1, low = Infinity;
      for (let y = c.top + Math.round(H * 0.6); y < c.bottom - Math.round(H * 0.6); y++) if (rows[y] < low) { low = rows[y]; at = y; }
      if (at < 0) { split.push(c); continue; }
      stack.push({ top: at, bottom: c.bottom }, { top: c.top, bottom: at });
    }
  }
  split.sort((a, b) => a.top - b.top);

  const lines = [];
  for (const b of split) {
    const pad = Math.round((b.bottom - b.top) * 0.28);
    const y0 = Math.max(0, b.top - pad), y1 = Math.min(h, b.bottom + pad);
    // ink per column inside the line
    const cols = new Uint32Array(w);
    let total = 0;
    for (let y = b.top; y < b.bottom; y++) for (let x = 0; x < w; x++) if (ink[y * w + x]) { cols[x]++; total++; }
    const lineH = y1 - y0;
    if (total < lineH * lineH * 0.05) continue; // too little ink to be writing
    // trim stray marks at the ends: keep the middle 99.4% of the ink
    let x0 = 0, x1 = w - 1;
    for (let acc = 0; x0 < w && (acc += cols[x0]) < total * 0.003; x0++);
    for (let acc = 0; x1 > 0 && (acc += cols[x1]) < total * 0.003; x1--);
    // break the line at wide gaps (separate columns, or options spread across a line),
    // and keep each piece short enough for the model to read well
    const pieces = [];
    const gapMin = Math.max(6, (b.bottom - b.top) * 2.2);
    let start = x0, blank = 0;
    for (let x = x0; x <= x1 + 1; x++) {
      if (x <= x1 && cols[x]) {
        if (blank >= gapMin && x - blank > start) { pieces.push([start, x - blank]); start = x; }
        blank = 0;
      } else blank++;
    }
    pieces.push([start, x1 + 1]);
    const crops = [];
    for (const [a, z] of pieces) {
      // how tall the ink in this piece is: a flat stroke is an underline or a scrap of rule
      let inkTop = b.bottom, inkBottom = b.top, inked = 0;
      for (let y = b.top; y < b.bottom; y++) {
        for (let x = a; x < z; x++) {
          if (ink[y * w + x]) { inkTop = Math.min(inkTop, y); inkBottom = Math.max(inkBottom, y); inked++; }
        }
      }
      const bandH = b.bottom - b.top;
      // too flat, or too little ink to be even one letter: a scrap, not writing
      if (inkBottom - inkTop < bandH * 0.3 || inked < bandH * bandH * 0.06) continue;
      for (const [p, q] of splitLong(cols, a, z, lineH)) {
        const padX = Math.round(lineH * 0.3);
        const crop = document.createElement('canvas');
        crop.width = q - p + padX * 2;
        crop.height = lineH;
        const ctx = crop.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, crop.width, crop.height);
        ctx.drawImage(canvas, p, y0, q - p, lineH, padX, 0, q - p, lineH);
        crops.push(crop);
      }
    }
    if (crops.length) lines.push({ y: y0, pieces: crops });
  }
  return lines;
}

/** Split [a, z) into pieces no wider than about 12 line-heights, at the widest gap near the middle. */
function splitLong(cols, a, z, lineH) {
  if (z - a <= lineH * 12) return [[a, z]];
  let best = -1, bestRun = 0;
  for (let x = a + Math.round((z - a) * 0.3), run = 0; x < a + Math.round((z - a) * 0.7); x++) {
    run = cols[x] ? 0 : run + 1;
    if (run > bestRun) { bestRun = run; best = x - Math.floor(run / 2); }
  }
  if (best < 0) best = Math.round((a + z) / 2);
  return [...splitLong(cols, a, best, lineH), ...splitLong(cols, best, z, lineH)];
}

// ---------- reading ----------

// handwritten digits the model often reads as letters
const DIGITISH = { z: '2', Z: '2', l: '1', I: '1', i: '1', '|': '1', S: '5', s: '5', O: '0', o: '0', b: '6', G: '6', g: '9', q: '9', B: '8' };

/**
 * A question paper runs in order: 1, A, B, C, 2, A, B... When the handwriting
 * model misreads a label ("U 5" for "C. 5", "z. Which" for "2. Which"), the
 * label that should come next is put back. Only single-character labels at the
 * start of a line are touched, so ordinary sentences are left alone.
 */
export function fixSequence(lines) {
  let nextQ = 1;
  let nextOpt = null; // the option letter expected next, or null outside a question
  return lines.map(line => {
    const num = line.match(/^(\d{1,3})\. (.*)$/);
    // a number is a new question, unless it is out of order in the middle of the
    // options and too short to be a question: then it is a misread option letter ("6. Venus")
    const misread = num && nextOpt && nextOpt <= 'F' && Number(num[1]) !== nextQ && num[2].length < 30 && !num[2].endsWith('?');
    if (num && !misread) {
      nextQ = Number(num[1]) + 1;
      nextOpt = 'A';
      return line;
    }
    const m = line.match(/^(\S)(\s*[.,:;)]\s*|\s+)(\S.*)$/);
    if (!m || /^answer|^ans\b/i.test(line)) return line;
    const [, label, sep, rest] = m;
    // "a planet" or "I think": a word, not a label
    if (!/[.,:;)]/.test(sep) && /^[a-z]/.test(rest)) return line;
    const digit = /\d/.test(label) ? label : DIGITISH[label];
    if (digit !== undefined && nextQ <= 9 && digit === String(nextQ) && (rest.length >= 12 || rest.endsWith('?'))) {
      nextOpt = 'A';
      return `${nextQ++}. ${rest}`;
    }
    if (!nextOpt || nextOpt > 'F') return line;
    const want = nextOpt;
    nextOpt = String.fromCharCode(nextOpt.charCodeAt(0) + 1);
    return `${want}. ${rest}`;
  });
}

/**
 * The handwriting model writes what it sees, so labels come out loose: "A3",
 * "B Jupiter", "1 What is". Put back the dot the question-paper reader expects,
 * and drop the full stop the model likes to add to the end of a line.
 */
export function tidyHand(line) {
  let t = line.replace(/\s+/g, ' ').trim();
  t = t.replace(/^([A-F])\s*[.,:;)]?\s*(?=[^a-z\s.,:;)])/, '$1. ');
  t = t.replace(/^([a-f])\s*[.,:;)]\s*/, (_, l) => l.toUpperCase() + '. ');
  t = t.replace(/^(\d{1,3})\s*[.,:;)]?\s+(?=[A-Za-z])/, '$1. ');
  if (t.length < 40) t = t.replace(/(?<![.?!])\.$/, '');
  return t;
}

/**
 * A reader for one import. mode is 'auto' (decide per page), 'print' or 'hand'.
 * onStatus({ stage, done, total }) reports progress: stage is 'print', 'download' or 'hand'.
 * Call close() when finished, to free the OCR engines.
 */
export function createReader({ mode = 'auto', onStatus = () => {} } = {}) {
  let worker = null;
  let hand = null;

  async function tesseract() {
    if (!worker) {
      try {
        const lib = await loadTesseract();
        const createWorker = lib.createWorker || lib.default?.createWorker;
        worker = await createWorker('eng');
      } catch (err) { throw new OcrError('ocr', err); }
    }
    return worker;
  }

  async function handModel() {
    if (!hand) {
      hand = (async () => {
        const lib = await loadTransformers();
        lib.env.allowLocalModels = false; // the model comes from the Hugging Face hub, never from this site
        const files = new Map();
        const pipe = await lib.pipeline('image-to-text', HAND_MODEL, {
          dtype: 'q8',
          progress_callback: e => {
            if (e.status !== 'progress' || !e.total) return;
            files.set(e.file, [e.loaded, e.total]);
            let loaded = 0, total = 0;
            for (const [l, t] of files.values()) { loaded += l; total += t; }
            onStatus({ stage: 'download', done: loaded, total });
          },
        });
        return { pipe, RawImage: lib.RawImage };
      })();
      hand.catch(() => { hand = null; });
    }
    try { return await hand; } catch (err) { throw new OcrError('hand', err); }
  }

  async function readHand(page) {
    const { pipe, RawImage } = await handModel();
    const lines = findLines(page);
    const pieces = lines.reduce((n, l) => n + l.pieces.length, 0);
    const out = [];
    let done = 0;
    for (const line of lines) {
      const words = [];
      for (const crop of line.pieces) {
        onStatus({ stage: 'hand', done, total: pieces });
        const [res] = await pipe(RawImage.fromCanvas(crop), { max_new_tokens: 96 });
        const text = tidyHand(res?.generated_text || '');
        if (text) words.push(text);
        done++;
      }
      if (words.length) out.push(words.join('  '));
    }
    return fixSequence(out);
  }

  return {
    /** Read a page drawn on a canvas. Resolves to { lines, hand }, hand true if read as handwriting. */
    async read(canvas) {
      const page = cleanUp(canvas);
      if (mode !== 'hand') {
        onStatus({ stage: 'print', done: 0, total: 1 });
        const { data } = await (await tesseract()).recognize(page.canvas);
        const lines = data.text.split('\n').map(l => l.trim());
        const words = (data.words || []).filter(wd => wd.text.trim().length > 1).length;
        if (mode === 'print' || (data.confidence >= PRINT_CONFIDENCE && words >= 3)) return { lines, hand: false, confidence: data.confidence };
      }
      return { lines: await readHand(page), hand: true };
    },
    close() {
      worker?.terminate();
      worker = null;
    },
  };
}

/**
 * Read photos of question papers or notes.
 * onProgress({ photo, photos, stage, done, total }) reports progress.
 * Resolves to { text, photos, handPhotos }, or null if isCancelled() turned true.
 */
export async function readPhotos(files, { mode = 'auto', onProgress = () => {}, isCancelled = () => false } = {}) {
  let photo = 0;
  const reader = createReader({ mode, onStatus: s => onProgress({ ...s, photo, photos: files.length }) });
  const out = [];
  const handPhotos = [];
  try {
    for (const file of files) {
      photo++;
      if (isCancelled()) return null;
      onProgress({ photo, photos: files.length, stage: 'open', done: 0, total: 1 });
      const canvas = await openPhoto(file);
      if (isCancelled()) return null;
      const res = await reader.read(canvas);
      if (res.hand) handPhotos.push(photo);
      out.push(res.lines.join('\n'));
    }
  } finally {
    reader.close();
  }
  return { text: out.join('\n\n').trim(), photos: files.length, handPhotos };
}
