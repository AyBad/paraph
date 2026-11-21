/* Reading the text printed on a page (pdf.js text layer, or OCR for scans) to know what each field is for. */

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

/** text of a vector PDF page: [{str,x,y,w,h}] in viewport units (y = top) */
export async function pdfTextItems(page, vp) {
  let tc; try { tc = await page.getTextContent(); } catch { return []; }
  const out = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [, , c, d, e, f] = it.transform;
    const h = Math.hypot(c, d) || it.height || 10;
    const [x, yb] = vp.convertToViewportPoint(e, f);
    out.push({ str: it.str, x, y: yb - h * 0.85, w: it.width, h });
  }
  return out;
}

let workerP = null;
const simd = () => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch { return false; } };
async function ocrWorker() {
  if (!workerP) workerP = (async () => {
    const { createWorker } = await import('tesseract.js');
    const base = new URL('ocr/', location.href).href;
    return createWorker('fra', 1, {
      workerPath: base + 'worker.min.js',
      corePath: simd() ? base + 'tesseract-core-simd-lstm.wasm.js' : 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6/tesseract-core-lstm.wasm.js',
      langPath: base, gzip: true, workerBlobURL: false, cacheMethod: 'none'
    });
  })();
  return workerP;
}

/** OCR of a scanned page: words as [{str,x,y,w,h}] in viewport units */
export async function ocrTextItems(page, masks = []) {
  const S = 2, v = page.getViewport({ scale: S });
  const c = document.createElement('canvas'); c.width = Math.floor(v.width); c.height = Math.floor(v.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: v }).promise;
  // hide the empty boxes / lines: their borders confuse the text recognition next to them
  ctx.fillStyle = '#fff';
  for (const m of masks) ctx.fillRect((m.x - 3) * S, (m.y - 3) * S, (m.w + 6) * S, (m.h + 6) * S);
  const w = await ocrWorker();
  const { data } = await w.recognize(c, {}, { blocks: true, text: false });
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || []) {
    if (!wd.text || !wd.text.trim() || wd.confidence < 35) continue;
    const { x0, y0, x1, y1 } = wd.bbox;
    out.push({ str: wd.text, x: x0 / S, y: y0 / S, w: (x1 - x0) / S, h: (y1 - y0) / S });
  }
  return out;
}

/** group items into text lines */
export function textLines(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const cy = it.y + it.h / 2;
    const l = lines.find(L => Math.abs(L.cy - cy) < Math.max(3, Math.min(L.h, it.h) * 0.55));
    if (l) { l.items.push(it); l.x0 = Math.min(l.x0, it.x); l.x1 = Math.max(l.x1, it.x + it.w); }
    else lines.push({ cy, h: it.h, y: it.y, x0: it.x, x1: it.x + it.w, items: [it] });
  }
  for (const l of lines) { l.items.sort((a, b) => a.x - b.x); l.text = l.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim(); }
  return lines;
}

/**
 * Label of a field = printed text just left of it on the same row (after the previous field),
 * plus the caption printed just under it (cerfa style). For tick boxes: text just right of it.
 */
export function attachLabels(fields, items) {
  const rowOf = (o) => fields.filter(f => f.page === o.page && Math.abs((f.fy ?? f.y) + (f.fh ?? f.h) / 2 - ((o.fy ?? o.y) + (o.fh ?? o.h) / 2)) < Math.max(5, (o.fh ?? o.h) * 0.6));
  for (const o of fields) {
    const fy = o.fy ?? o.y, fh = o.fh ?? o.h, fw = o.fw ?? o.w, cy = fy + fh / 2;
    const row = rowOf(o).filter(f => f !== o);
    const sameRow = items.filter(it => Math.abs(it.y + it.h / 2 - cy) < Math.max(4, fh * 0.75));
    if (o.type === 'check') {
      const next = Math.min(...row.filter(f => f.x > o.x + 2).map(f => f.x), o.x + 140);
      o.label = sameRow.filter(it => it.x >= o.x + fw - 2 && it.x < next).sort((a, b) => a.x - b.x).map(i => i.str).join(' ');
      continue;
    }
    const prev = Math.max(...row.filter(f => f.x + (f.fw ?? f.w) <= o.x + 2).map(f => f.x + (f.fw ?? f.w)), o.x - 230);
    o.label = sameRow.filter(it => it.x + it.w <= o.x + 4 && it.x + it.w > prev - 2).sort((a, b) => a.x - b.x).map(i => i.str).join(' ');
    // small caption printed under the box (cerfa style); normal-size text below is the next line's label, not a caption
    o.caption = items.filter(it => it.h <= 7.5 && it.h < fh * 0.8 && it.y >= fy + fh - 2 && it.y <= fy + fh + 9 && it.x < o.x + fw && it.x + it.w > o.x).map(i => i.str).join(' ');
  }
}

/** contextual rules for short labels ("/", "à", "le", "h") from the field before on the same row */
export function refineByRow(fields) {
  const byRow = new Map();
  for (const o of fields.filter(f => f.type === 'text')) {
    const k = o.page + ':' + Math.round(((o.fy ?? o.y) + (o.fh ?? o.h) / 2) / 6);
    (byRow.get(k) || byRow.set(k, []).get(k)).push(o);
  }
  for (const row of byRow.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const o = row[i], p = row[i - 1];
      if (o.match) continue;
      const l = norm(o.label);
      if ((!l || /^[\/\-.]+$/.test(l)) && (p.match === 'birthDate' || p.match === 'today')) o.match = p.match;
      else if (l === 'a' && p.match === 'birthDate') o.match = 'birthPlace';
      else if (l === 'a' && p.match === 'today') o.match = 'hour';
      else if (l === 'h' && p.match === 'hour') o.match = 'minute';
      else if (l === 'le' || l === 'le :') o.match = 'today';
    }
  }
}

export const sameText = norm;
