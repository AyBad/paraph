import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle, PDFName, PDFDict, PDFArray, PDFHexString } from 'pdf-lib';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };

/** Convert any supported input file into PDF bytes. */
export async function fileToPdfBytes(file, onStatus) {
  const name = file.name || '';
  const ext = name.split('.').pop().toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  if (ext === 'pdf' || file.type === 'application/pdf') return buf;
  if (ext === 'doc') throw new Error('doc');
  if (ext === 'docx' || ext === 'odt' && false) {
    onStatus && onStatus('convert');
    return docxToPdf(file);
  }
  if ((file.type || '').startsWith('image/') || /^(jpe?g|png|webp|heic|gif)$/.test(ext)) return imageToPdf(file);
  throw new Error('type');
}

async function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

async function imageToPdf(file) {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);
  const max = 2400;
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const jpg = await (await fetch(c.toDataURL('image/jpeg', 0.9))).arrayBuffer();
  const pdf = await PDFDocument.create();
  const im = await pdf.embedJpg(jpg);
  const w = 595, h = w * c.height / c.width;
  pdf.addPage([w, h]).drawImage(im, { x: 0, y: 0, width: w, height: h });
  return pdf.save();
}

const WINANSI = /[\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;
const LEAD_RE = /(?:[.·_]|…){2,}|…|(?:\. ?){4,}/g;
/** positions (px, relative to the page) of the words, the dotted / underlined places and the empty table cells of a rendered Word page */
function docxLayout(sec) {
  const base = sec.getBoundingClientRect(), words = [], zones = [], boxes = [];
  const rel = (r) => [r.left - base.left, r.top - base.top, r.width, r.height];
  const tw = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const s = n.nodeValue; if (!s || !s.trim()) continue;
    const re = /(?:[.·_]|…){2,}|…|(?:\. ?){4,}|[☐□❑▢◻○◯❍⭘\uF06F\uF0A8\uF06D\uF071\uF072\uF0A1\uF070]|[^\s.·…_☐□❑▢◻○◯❍⭘\uF06F\uF0A8\uF06D\uF071\uF072\uF0A1\uF070]+|\S/g; let m;
    while ((m = re.exec(s))) {
      range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
      const rects = [...range.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5);
      if (/^[☐□❑▢◻○◯❍⭘\uF06F\uF0A8\uF06D\uF071\uF072\uF0A1\uF070]$/.test(m[0])) { for (const r of rects) { const [x, y, w, h] = rel(r); const sz = Math.min(w, h) * 0.8; boxes.push([x + (w - sz) / 2, y + (h - sz) / 2, sz, sz]); } continue; }
      LEAD_RE.lastIndex = 0;
      if (LEAD_RE.test(m[0]) && (m[0].replace(/\s/g, '').replace(/…/g, '...').length >= 4 || /_{3,}/.test(m[0]))) { for (const r of rects) if (r.width > 18) zones.push(rel(r)); continue; }
      for (const r of rects) { const [x, y, w, h] = rel(r); words.push({ t: m[0], x, y, w, h }); }
    }
  }
  // tables: an empty cell with a label on its left (or a header row above) = a place to write;
  // a run of small empty cells = character boxes (date, n° of social security, phone…)
  const txt = (c) => c.textContent.replace(/[\s\u00a0]/g, '');
  for (const tr of sec.querySelectorAll('tr')) {
    const cells = [...tr.children].filter(c => /^T[DH]$/.test(c.tagName));
    const prev = tr.previousElementSibling, prevCells = prev ? [...prev.children].filter(c => /^T[DH]$/.test(c.tagName)) : [];
    const headerRow = prevCells.length > 1 && prevCells.every(c => txt(c)); // a real header row: every cell written
    if (!cells.some(c => txt(c)) && !headerRow) continue; // spacing row of the layout
    const headerOf = (r) => {
      if (!headerRow) return '';
      let best = null, ov = 0;
      for (const c of prevCells) { const q = c.getBoundingClientRect(), o = Math.min(q.right, r.right) - Math.max(q.left, r.left); if (o > ov) { ov = o; best = c; } }
      return best ? best.textContent.trim() : '';
    };
    let run = [], leftLabel = '';
    const flush = () => {
      if (run.length >= 2) {
        const x0 = Math.min(...run.map(r => r.left)), x1 = Math.max(...run.map(r => r.right)), y0 = Math.min(...run.map(r => r.top)), y1 = Math.max(...run.map(r => r.bottom));
        // the centre of every box, so that each letter lands in its box even when the boxes are grouped (JJ MM AAAA)
        zones.push([...rel({ left: x0 + 1, top: y0 + 1, width: x1 - x0 - 2, height: y1 - y0 - 2 }), '', run.length, run.map(r => Math.round(((r.left + r.right) / 2 - x0 - 1) * 0.75 * 10) / 10)]);
      } else if (run.length === 1) {
        const r = run[0];
        if (Math.abs(r.width - r.height) < 6) boxes.push(rel({ left: r.left + 2, top: r.top + 2, width: r.width - 4, height: r.height - 4 }));
        else zones.push([...rel({ left: r.left + 2, top: r.top + 2, width: r.width - 4, height: r.height - 4 }), '', 1]);
      }
      run = [];
    };
    for (const td of cells) {
      if (txt(td) || td.querySelector('img')) { flush(); leftLabel = td.textContent.trim(); continue; }
      const r = td.getBoundingClientRect();
      if (r.height < 12 || r.width < 6) continue;
      const header = headerOf(r);
      if (!leftLabel && !header) { flush(); continue; } // empty cell of the label column
      if (r.width < 34) { run.push(r); continue; }
      flush();
      zones.push([...rel({ left: r.left + 3, top: r.top + 2, width: r.width - 6, height: r.height - 4 }), leftLabel ? '' : header]);
    }
    flush();
  }
  // underlined blanks (u with spaces only)
  for (const u of sec.querySelectorAll('span')) {
    const st = getComputedStyle(u);
    if (!/underline/.test(st.textDecorationLine || st.textDecoration) || u.textContent.trim()) continue;
    const r = u.getBoundingClientRect(); if (r.width > 18) zones.push(rel(r));
  }
  return { words, zones, boxes };
}

/** Wingdings / Symbol boxes (private-use characters) shown as Unicode boxes, readable everywhere */
const SYM = { '\uF06F': '☐', '\uF0A8': '☐', '\uF071': '☐', '\uF072': '☐', '\uF070': '☐', '\uF06E': '■', '\uF0FE': '☑', '\uF0FD': '☒', '\uF078': '☒', '\uF0A7': '▪', '\uF0B7': '•', '\uF0D8': '➢', '\uF0FC': '✓' };
function symbolsToUnicode(sec) {
  const tw = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!/[\uF020-\uF0FF]/.test(n.nodeValue)) continue;
    n.nodeValue = n.nodeValue.replace(/[\uF020-\uF0FF]/g, (c) => SYM[c] || (c === '\uF020' ? ' ' : '☐'));
    const p = n.parentElement; if (p && /wingdings|symbol|webdings/i.test(getComputedStyle(p).fontFamily)) p.style.fontFamily = 'Arial, sans-serif';
  }
}

/** places to write stored by the Word conversion (see docxToPdf) */
export async function storedZones(pdf) {
  try {
    const md = await pdf.getMetadata();
    const v = md?.info?.Custom?.ParaphZones;
    return v ? JSON.parse(typeof v === 'string' ? v : v.name || '') : null;
  } catch { return null; }
}

async function docxToPdf(file) {
  const [{ renderAsync }, html2canvas] = await Promise.all([
    import('docx-preview'), import('html2canvas').then(m => m.default)
  ]);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:900px;background:#fff;direction:ltr';
  document.body.appendChild(host);
  try {
    await renderAsync(file, host, null, {
      inWrapper: false, ignoreWidth: false, ignoreHeight: false, breakPages: true,
      renderHeaders: true, renderFooters: true, renderFootnotes: true, useBase64URL: true
    });
    await new Promise(r => setTimeout(r, 300));
    const sections = host.querySelectorAll('section.docx');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const zonesAll = [];
    for (const s of sections) {
      s.style.margin = '0'; s.style.boxShadow = 'none';
      symbolsToUnicode(s);
      const lay = docxLayout(s);
      const canvas = await html2canvas(s, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const jpg = await (await fetch(canvas.toDataURL('image/jpeg', 0.92))).arrayBuffer();
      const im = await pdf.embedJpg(jpg);
      const w = s.offsetWidth * 0.75, h = s.offsetHeight * 0.75;
      const pg = pdf.addPage([w, h]);
      pg.drawImage(im, { x: 0, y: 0, width: w, height: h });
      // invisible text: the words stay readable for the form analysis (labels, headings) without OCR
      for (const wd of lay.words) {
        const txt = [...wd.t].map(c => WINANSI.test(c) ? c : '?').join('');
        let wpt; try { wpt = font.widthOfTextAtSize(txt, 1); } catch { continue; }
        if (!wpt) continue;
        const size = Math.max(2, Math.min(wd.h * 0.75 * 1.2, (wd.w * 0.75) / wpt));
        try { pg.drawText(txt, { x: wd.x * 0.75, y: h - (wd.y + wd.h * 0.8) * 0.75, size, font, opacity: 0 }); } catch { }
      }
      zonesAll.push({ z: lay.zones.map(z => z.map((v, k) => k < 4 ? Math.round(v * 0.75 * 10) / 10 : v)), b: lay.boxes.map(z => z.map(v => Math.round(v * 0.75 * 10) / 10)) });
    }
    if (!sections.length) throw new Error('empty');
    pdf.getInfoDict().set(PDFName.of('ParaphZones'), PDFHexString.fromText(JSON.stringify(zonesAll)));
    return pdf.save();
  } finally { host.remove(); }
}

/** Tooltips (TU) of form fields, read from the field dictionaries (pdf.js only sees the widget's own) */
export async function fieldTooltips(bytes) {
  const map = {};
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    for (const f of pdf.getForm().getFields()) {
      let d = f.acroField.dict, tu = null, i = 0;
      while (d && !tu && i++ < 8) { tu = d.lookup(PDFName.of('TU')); d = d.lookupMaybe(PDFName.of('Parent'), PDFDict); }
      if (tu) map[f.getName()] = tu.decodeText ? tu.decodeText() : String(tu);
    }
  } catch { }
  return map;
}

/** Read AcroForm widgets with pdf.js; return fields in viewport (scale 1) units */
export async function detectFields(page, vp, tips = {}) {
  const out = [];
  let annots = [];
  try { annots = await page.getAnnotations(); } catch { return out; }
  for (const a of annots) {
    if (a.subtype !== 'Widget' || !a.rect) continue;
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
    const r = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    if (r.w < 4 || r.h < 4) continue;
    if (a.fieldType === 'Tx') out.push({ kind: 'text', name: a.fieldName || '', alt: a.alternativeText || tips[a.fieldName] || '', value: typeof a.fieldValue === 'string' ? a.fieldValue : '', multiline: !!a.multiLine, comb: a.comb ? a.maxLen : 0, maxLen: a.maxLen || 0, ...r });
    else if (a.fieldType === 'Btn' && (a.checkBox || a.radioButton)) {
      const on = a.checkBox ? (a.fieldValue && a.fieldValue !== 'Off' && a.fieldValue === a.exportValue) : (a.fieldValue === a.buttonValue);
      out.push({ kind: 'check', name: a.fieldName || '', alt: a.alternativeText || tips[a.fieldName] || '', value: !!on, radio: !!a.radioButton, bval: String(a.buttonValue || a.exportValue || ''), ...r });
    }
  }
  return out;
}

/** Find small square boxes drawn on flat (non-form) pages: candidate tick boxes. Viewport units. */
export async function detectBoxes(page, vp) {
  let ops;
  try { ops = await page.getOperatorList(); } catch { return []; }
  const O = pdfjs.OPS, out = [];
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const ap = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  const consider = (pts) => {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const w = x1 - x0, h = y1 - y0;
    if (w < 4.5 || h < 4.5 || w > 20 || h > 20 || Math.abs(w - h) > Math.max(1.2, w * 0.15)) return;
    // all points must lie on the bounding box border (axis aligned)
    if (!pts.every(([x, y]) => (Math.abs(x - x0) < .6 || Math.abs(x - x1) < .6) && (Math.abs(y - y0) < .6 || Math.abs(y - y1) < .6))) return;
    const [a, b, c, d] = vp.convertToViewportRectangle([x0, y0, x1, y1]);
    const r = { x: Math.min(a, c), y: Math.min(b, d), w: Math.abs(c - a), h: Math.abs(d - b) };
    if (!out.some(o => Math.abs(o.x - r.x) < 2 && Math.abs(o.y - r.y) < 2)) out.push(r);
  };
  for (let i = 0; i < ops.fnArray.length && out.length < 400; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = mul(ctm, args);
    else if (fn === O.constructPath) {
      const [sub, a] = args; let j = 0, cur = [];
      const flush = () => { if (cur.length >= 4 && cur.length <= 6) consider(cur); cur = []; };
      for (const op of sub) {
        if (op === O.rectangle) { const [x, y, w, h] = a.slice(j, j + 4); j += 4; consider([ap(x, y), ap(x + w, y), ap(x + w, y + h), ap(x, y + h)]); }
        else if (op === O.moveTo) { flush(); cur.push(ap(a[j], a[j + 1])); j += 2; }
        else if (op === O.lineTo) { cur.push(ap(a[j], a[j + 1])); j += 2; }
        else if (op === O.curveTo) { j += 6; cur = []; }
        else if (op === O.curveTo2 || op === O.curveTo3) { j += 4; cur = []; }
        else if (op === O.closePath) flush();
      }
      flush();
    }
  }
  return out;
}

/**
 * Pages without form fields (scans, flat PDFs): find empty areas to write in by looking at the image.
 * - writing lines / boxes: a horizontal line with nothing written just above it
 * - tick boxes: small hollow squares
 * Returns { zones:[{x,y,w,h}], boxes:[{x,y,w,h}] } in viewport units.
 */
export async function detectZones(page) {
  const S = 1.5, v = page.getViewport({ scale: S });
  const c = document.createElement('canvas'); c.width = Math.floor(v.width); c.height = Math.floor(v.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  try { await page.render({ canvasContext: ctx, viewport: v, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise; } catch { return { zones: [], boxes: [] }; }
  const W = c.width, H = c.height, px = ctx.getImageData(0, 0, W, H).data;
  // adaptive darkness threshold (photos are greyish)
  let sum = 0; const lum = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { const l = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000; lum[i] = l; sum += l; }
  const mean = sum / (W * H), thr = Math.min(150, mean - 45);
  const dark = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) dark[i] = lum[i] < thr ? 1 : 0;
  // thin printed lines come out light grey once scaled: a softer threshold to find them
  const lthr = Math.min(215, mean - 22), ldark = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) ldark[i] = lum[i] < lthr ? 1 : 0;
  const darkRatio = (x0, y0, x1, y1) => {
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(W, x1 | 0); y1 = Math.min(H, y1 | 0);
    if (x1 <= x0 || y1 <= y0) return 1; let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += dark[y * W + x];
    return n / ((x1 - x0) * (y1 - y0));
  };
  // 1. horizontal segments (allow 2px gaps)
  const minLen = 20 * S, segs = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!ldark[y * W + x]) { x++; continue; }
      let e = x, gap = 0;
      while (e < W && gap <= 2) { if (ldark[y * W + e]) gap = 0; else gap++; e++; }
      const x1 = e - gap;
      if (x1 - x >= minLen) segs.push({ x0: x, x1, y0: y, y1: y });
      x = e;
    }
  }
  const DBG = [];
  // merge rows belonging to the same line
  const lines = [];
  for (const sg of segs) {
    const l = lines.find(L => sg.y0 - L.y1 <= 1 && sg.y0 >= L.y0 && Math.min(L.x1, sg.x1) - Math.max(L.x0, sg.x0) > 0.8 * Math.min(L.x1 - L.x0, sg.x1 - sg.x0));
    if (l) { l.y1 = sg.y1; l.x0 = Math.min(l.x0, sg.x0); l.x1 = Math.max(l.x1, sg.x1); } else lines.push({ ...sg });
  }
  // a slightly tilted line (photo) is cut into a staircase of short pieces: join them, and
  // drop the whole line if it really slopes (its pieces would give dozens of false zones)
  lines.sort((a, b) => a.x0 - b.x0);
  let sloped = 0;
  for (const L of lines) {
    if (L.gone) continue;
    let cur = L, chain = [L];
    for (;;) {
      const nx = lines.find(M => !M.gone && M !== cur && !chain.includes(M) && M.x0 >= cur.x1 - 3 * S && M.x0 <= cur.x1 + 4 && Math.abs(M.y0 - cur.y0) <= 3 && Math.abs(M.y0 - cur.y0) >= 1);
      if (!nx) break; chain.push(nx); cur = nx;
    }
    if (chain.length < 2) continue;
    const y0 = Math.min(...chain.map(c => c.y0)), y1 = Math.max(...chain.map(c => c.y1));
    for (const c of chain) c.gone = true;
    if (y1 - y0 <= 3 && chain.length < 4) lines.push({ x0: chain[0].x0, x1: cur.x1, y0, y1 });
    else { DBG.push([{ x0: chain[0].x0, x1: cur.x1, y0, y1 }, 'cyan']); if (cur.x1 - chain[0].x0 > 60 * S) sloped++; }
  }
  // dotted lines ". . . . . . ." : rows of small dots at the same height, evenly spaced
  {
    const seenD = new Uint8Array(W * H), dots = [], lim = 3.5 * S;
    for (let i = 0; i < W * H; i++) {
      if (!ldark[i] || seenD[i]) continue;
      const st = [i]; seenD[i] = 1; let n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, big = false;
      while (st.length) {
        const p = st.pop(); n++; const x = p % W, y = (p / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x1 - x0 > lim || y1 - y0 > lim) big = true;
        if (n > 400) { big = true; }
        for (const q of [p - 1, p + 1, p - W, p + W]) if (q >= 0 && q < W * H && ldark[q] && !seenD[q]) { seenD[q] = 1; st.push(q); }
      }
      if (!big) dots.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, x0, x1 });
    }
    dots.sort((a, b) => a.x - b.x);
    const used = new Set();
    for (let i = 0; i < dots.length; i++) {
      if (used.has(i)) continue;
      const ch = [i]; let cur = dots[i];
      for (let j = i + 1; j < dots.length && dots[j].x - cur.x <= 8 * S; j++) {
        if (used.has(j)) continue;
        const d = dots[j];
        if (Math.abs(d.y - cur.y) <= 1.2 * S && d.x - cur.x >= 1.2) { ch.push(j); cur = d; }
      }
      if (ch.length >= 6 && cur.x - dots[i].x >= 22 * S) {
        // regular spacing (a word's i-dots / periods are not)
        const gaps = ch.slice(1).map((k, n) => dots[k].x - dots[ch[n]].x), mg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        if (gaps.every(g => g < mg * 2.2)) {
          for (const k of ch) used.add(k);
          const y = Math.round(ch.reduce((a, k) => a + dots[k].y, 0) / ch.length);
          lines.push({ x0: Math.round(dots[i].x0), x1: Math.round(cur.x1) + 1, y0: y, y1: y + 1, dotted: true });
        }
      }
    }
  }
  const thin = lines.filter(l => !l.gone && l.y1 - l.y0 <= 4 * S).sort((a, b) => a.y0 - b.y0);
  // 2. pair lines into boxes, or use the empty band above a single line
  const zones = [], usedTop = new Set();
  // length of the vertical dark run starting at (x, y) going up (-1) or down (+1), tolerant to 2px
  const vrun = (x, y, dir) => {
    let n = 0, miss = 0;
    for (let yy = y + dir; yy >= 0 && yy < H && miss <= 2; yy += dir) {
      let d = 0; for (let xx = Math.max(0, x - 2); xx <= Math.min(W - 1, x + 2); xx++) d |= dark[yy * W + xx];
      if (d) { n++; miss = 0; } else miss++;
    }
    return n;
  };
  const isFrame = (l) => [l.x0, l.x1 - 1].some(x => vrun(x, l.y1, 1) > 40 * S || vrun(x, l.y0, -1) > 40 * S);
  for (const l of thin) {
    if (l.x1 - l.x0 > W * 0.9) continue; // page / section borders
    // a real line has white just above and below it; the bottom edge of bold text has letter strokes above
    if (!l.dotted && (darkRatio(l.x0, l.y0 - 3 * S, l.x1, l.y0 - 1) > 0.22 || darkRatio(l.x0, l.y1 + 2, l.x1, l.y1 + 3 * S) > 0.22)) { DBG.push([l, 'orange']); continue; }
    // a real line is solid; the top/bottom edge of a word has small gaps between the letters
    let best = 0;
    for (let y = l.y0; y <= l.y1; y++) { let n = 0; for (let x = l.x0; x < l.x1; x++) n += ldark[y * W + x]; best = Math.max(best, n / (l.x1 - l.x0)); }
    if (best < 0.93 && !l.dotted) {
      // dots so close that they touch once scaled: a regular dash pattern is still a dotted line
      let runs = 0, prev = 0, ym = (l.y0 + l.y1) >> 1;
      for (let x = l.x0; x < l.x1; x++) { const dd = ldark[ym * W + x] | ldark[Math.min(H - 1, ym + 1) * W + x]; if (dd && !prev) runs++; prev = dd; }
      if (!(best >= 0.2 && runs >= 6 && (l.x1 - l.x0) / runs <= 7 * S)) { DBG.push([l, 'orange']); continue; }
      l.dotted = true;
    }
    // a box = two lines joined by vertical sides
    const top = thin.find(t => t !== l && !usedTop.has(t) && l.y0 - t.y1 >= 9 * S && l.y0 - t.y1 <= 32 * S &&
      Math.abs(t.x0 - l.x0) < 6 * S && Math.abs(t.x1 - l.x1) < 6 * S &&
      vrun(l.x0 + 1, l.y0, -1) >= (l.y0 - t.y1) * 0.8 && vrun(l.x1 - 2, l.y0, -1) >= (l.y0 - t.y1) * 0.8);
    let z;
    if (top) { usedTop.add(top); z = { x0: l.x0, x1: l.x1, y0: top.y1 + 1, y1: l.y0 }; }
    else {
      if (isFrame(l)) { DBG.push([l, 'blue']); continue; } // edge of a section frame, not a writing line
      // free space above the line, up to the text of the row above (captions are often close)
      // columns of the comb ticks rising from the line are not "text above"
      const cols = [];
      for (let x = l.x0 + 3 * S | 0; x < l.x1 - 3 * S; x++) if (!(dark[(l.y0 - 2) * W + x] || dark[(l.y0 - 3) * W + x] || ldark[(l.y0 - 2) * W + x])) cols.push(x);
      const rowDark = (yy) => { let n = 0; for (const x of cols) n += dark[yy * W + x]; return cols.length ? n / cols.length : 1; };
      let y = l.y0 - 2 * S | 0;
      const yMax = l.y0 - 20 * S;
      while (y > yMax && y > 0 && rowDark(y - 1) < 0.012) y--;
      if (l.y0 - y < 8 * S) { DBG.push([l, 'magenta']); continue; }
      z = { x0: l.x0, x1: l.x1, y0: y + 1, y1: l.y0 - 1 };
    }
    if (darkRatio(z.x0 + 3 * S, z.y0 + 1, z.x1 - 3 * S, z.y1 - 2 * S) > 0.045) { DBG.push([l, 'red']); continue; } // already written / text
    if (l.dotted) z.dotted = true;
    zones.push(z); DBG.push([l, 'lime']);
  }
  const straight = thin.filter(l => l.x1 - l.x0 > 60 * S).length;
  zones.sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0));
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
    const a = zones[i], b = zones[j]; if (a.gone || b.gone) continue;
    const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ix > 0 && iy > 0 && ix * iy > 0.3 * (b.x1 - b.x0) * (b.y1 - b.y0)) b.gone = true;
  }
  for (let i = zones.length - 1; i >= 0; i--) if (zones[i].gone) zones.splice(i, 1);
  zones.sort((a, b) => (a.y1 - b.y1 > 4 * S || b.y1 - a.y1 > 4 * S) ? a.y1 - b.y1 : a.x0 - b.x0);
  // remove zones whose bottom line is in fact the top of a box
  const out = zones.filter(z => !thin.some(t => usedTop.has(t) && Math.abs(t.y0 - (z.y1 + 1)) <= 1 && Math.abs(t.x0 - z.x0) < 3));
  // 3. small hollow squares = tick boxes
  const boxes = [], seen = new Uint8Array(W * H), lo = 5 * S, hi = 20 * S;
  for (let i = 0; i < W * H && boxes.length < 200; i++) {
    if (!dark[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1; let n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, big = false;
    while (st.length) {
      const p = st.pop(); n++; const x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x1 - x0 > hi || y1 - y0 > hi || n > 4000) big = true;
      for (const q of [p - 1, p + 1, p - W, p + W]) if (q >= 0 && q < W * H && dark[q] && !seen[q]) { seen[q] = 1; st.push(q); }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (big || w < lo || h < lo || Math.abs(w - h) > Math.max(2, w * 0.2)) continue;
    const side = (a, b, c2, d) => darkRatio(a, b, c2, d) > 0.75;
    const t = Math.max(1, Math.round(S));
    const hollow = darkRatio(x0 + 2 * t, y0 + 2 * t, x1 - 2 * t, y1 - 2 * t) < 0.15;
    if (side(x0, y0, x1 + 1, y0 + t) && side(x0, y1 + 1 - t, x1 + 1, y1 + 1) && side(x0, y0, x0 + t, y1 + 1) && side(x1 + 1 - t, y0, x1 + 1, y1 + 1) && hollow)
      boxes.push({ x: x0 / S, y: y0 / S, w: w / S, h: h / S });
    else if (hollow && w >= 9 * S && n < w * h * 0.45) {
      // round box or square with rounded corners: the middle of each side touches the frame, thin line, empty inside
      const mx0 = x0 + w * 0.35 | 0, mx1 = x0 + w * 0.65 | 0, my0 = y0 + h * 0.35 | 0, my1 = y0 + h * 0.65 | 0;
      let thick = 0; for (let y = y0; y < y1 && dark[y * W + ((x0 + x1) >> 1)]; y++) thick++;
      const half = (a, b, c2, d) => darkRatio(a, b, c2, d) > 0.45;
      if (half(mx0, y0, mx1, y0 + t) && half(mx0, y1 + 1 - t, mx1, y1 + 1) && half(x0, my0, x0 + t, my1) && half(x1 + 1 - t, my0, x1 + 1, my1) && thick <= Math.max(3, h * 0.14))
        boxes.push({ x: x0 / S, y: y0 / S, w: w / S, h: h / S, round: true });
    }
  }
  return { zones: out.slice(0, 120).map(z => ({ x: z.x0 / S, y: z.y0 / S, w: (z.x1 - z.x0) / S, h: (z.y1 - z.y0) / S, dotted: !!z.dotted })), boxes };
}

const hex = (c) => {
  const n = parseInt((c || '#000').slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** first strong character decides the direction (like dir=auto) */
export function isRtl(l) {
  const m = l.match(/[A-Za-z\u00C0-\u02AF\u0370-\u058F\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0E7F\u3040-\u9FFF\uAC00-\uD7AF]/);
  return !!m && /[\u0590-\u08FF]/.test(m[0]);
}

function textToPng(lines, fontSize, color) {
  const k = 4, lh = 1.2;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `${fontSize * k}px Helvetica, Arial, "Noto Sans", sans-serif`;
  ctx.font = font;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width), 1);
  c.width = Math.ceil(w + 4 * k); c.height = Math.ceil(lines.length * lh * fontSize * k);
  ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  const rtl = document.documentElement.dir === 'rtl';
  lines.forEach((l, i) => {
    const y = (i * lh + 0.9465) * fontSize * k;
    if (isRtl(l)) { ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.fillText(l, c.width - 2 * k, y); }
    else { ctx.direction = 'ltr'; ctx.textAlign = 'left'; ctx.fillText(l, 0, y); }
  });
  return { url: c.toDataURL("image/png"), w: c.width / k, h: c.height / k, rtlText: lines.some(isRtl) };
}

/** Remove text/checkbox/radio widgets (re-drawn by us) while keeping other annotations */
function stripHandledFields(pdf) {
  const ctx = pdf.context;
  const ft = (d) => { let n = d, i = 0; while (n && i++ < 10) { const v = n.get(PDFName.of('FT')); if (v) return { ft: v.toString(), ff: (n.get(PDFName.of('Ff')) || { asNumber: () => 0 }).asNumber?.() || 0 }; n = n.lookupMaybe ? n.lookupMaybe(PDFName.of('Parent'), PDFDict) : null; } return null; };
  const handled = (d) => { const f = ft(d); if (!f) return false; if (f.ft === '/Tx') return true; if (f.ft === '/Btn') return !(f.ff & (1 << 16)); return false; };
  for (const page of pdf.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    const keep = ctx.obj([]);
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i); const d = ctx.lookup(ref);
      const isWidget = d instanceof PDFDict && String(d.get(PDFName.of('Subtype'))) === '/Widget';
      if (isWidget && handled(d)) continue;
      keep.push(ref);
    }
    page.node.set(PDFName.of('Annots'), keep);
  }
  const acro = pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (acro) {
    const fields = acro.lookupMaybe(PDFName.of('Fields'), PDFArray);
    const rest = ctx.obj([]);
    if (fields) for (let i = 0; i < fields.size(); i++) { const r = fields.get(i); const d = ctx.lookup(r); if (!(d instanceof PDFDict && handled(d))) rest.push(r); }
    if (rest.size()) { acro.set(PDFName.of('Fields'), rest); acro.set(PDFName.of('NeedAppearances'), pdf.context.obj(false)); }
    else pdf.catalog.delete(PDFName.of('AcroForm'));
  }
}

async function dataUrlBytes(u) { return new Uint8Array(await (await fetch(u)).arrayBuffer()); }

/** Burn objects into the PDF. pagesInfo[i] = { vp (pdf.js viewport scale 1), rotate } */
export async function exportPdf(bytes, objects, pagesInfo) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  try { stripHandledFields(pdf); } catch (e) { console.warn(e); }
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const imgCache = {};
  const embedPng = async (url) => imgCache[url] || (imgCache[url] = await pdf.embedPng(await dataUrlBytes(url)));

  for (const o of objects) {
    const page = pages[o.page]; const info = pagesInfo[o.page];
    if (!page || !info) continue;
    const vp = info.vp, rot = degrees(info.rotate || 0);
    const P = (x, y) => { const [px, py] = vp.convertToPdfPoint(x, y); return { x: px, y: py }; };
    const color = hex(o.color);
    const lw = (o.lw || 1.6);
    const line = (x1, y1, x2, y2, th) => page.drawLine({ start: P(x1, y1), end: P(x2, y2), thickness: th, color, lineCap: LineCapStyle.Round });

    if (o.type === 'text' && o.comb) {
      const chars = [...(o.text || '')].slice(0, o.comb); const cw = o.w / o.comb;
      for (let i = 0; i < chars.length; i++) {
        let vector = true; try { helv.encodeText(chars[i]); } catch { vector = false; }
        const cx = o.cells && o.cells[i] != null ? o.x + o.cells[i] : o.x + cw * i + cw / 2;
        if (vector) {
          const tw = helv.widthOfTextAtSize(chars[i], o.fontSize);
          const a = P(cx - tw / 2, o.y + 0.9465 * o.fontSize);
          page.drawText(chars[i], { x: a.x, y: a.y, size: o.fontSize, font: helv, color, rotate: rot });
        } else {
          const r = textToPng([chars[i]], o.fontSize, o.color); const im = await embedPng(r.url);
          const a = P(cx - r.w / 2, o.y + r.h);
          page.drawImage(im, { x: a.x, y: a.y, width: r.w, height: r.h, rotate: rot });
        }
      }
      continue;
    }
    if (o.type === 'text') {
      const txt = (o.text || '').replace(/\r/g, '');
      if (!txt.trim()) continue;
      const lines = txt.split('\n');
      let vector = true;
      try { lines.forEach(l => helv.encodeText(l)); } catch { vector = false; }
      if (vector) {
        lines.forEach((l, i) => {
          const a = P(o.x, o.y + (i * 1.2 + 0.9465) * o.fontSize);
          page.drawText(l, { x: a.x, y: a.y, size: o.fontSize, font: helv, color, rotate: rot });
        });
      } else {
        const r = textToPng(lines, o.fontSize, o.color);
        const im = await embedPng(r.url);
        const left = o.field && r.rtlText ? o.x + o.w - r.w : o.x;
        const a = P(left, o.y + r.h);
        page.drawImage(im, { x: a.x, y: a.y, width: r.w, height: r.h, rotate: rot });
      }
    } else if (o.type === 'check' && o.mark === 'cross') {
      if (o.field && !o.on) continue;
      const { x, y, w, h } = o; const th = Math.max(1, w * 0.12);
      line(x + w * .2, y + h * .2, x + w * .8, y + h * .8, th);
      line(x + w * .8, y + h * .2, x + w * .2, y + h * .8, th);
    } else if (o.type === 'check') {
      if (o.field && !o.on) continue;
      const { x, y, w, h } = o; const th = Math.max(1, w * 0.12);
      line(x + w * .18, y + h * .52, x + w * .42, y + h * .78, th);
      line(x + w * .42, y + h * .78, x + w * .84, y + h * .22, th);
    } else if (o.type === 'cross') {
      const { x, y, w, h } = o; const th = Math.max(1, w * 0.12);
      line(x + w * .2, y + h * .2, x + w * .8, y + h * .8, th);
      line(x + w * .8, y + h * .2, x + w * .2, y + h * .8, th);
    } else if (o.type === 'strike') {
      line(o.x, o.y + o.h / 2, o.x + o.w, o.y + o.h / 2, lw);
    } else if (o.type === 'image') {
      const im = await embedPng(o.src);
      const a = P(o.x, o.y + o.h);
      page.drawImage(im, { x: a.x, y: a.y, width: o.w, height: o.h, rotate: rot });
    } else if (o.type === 'ink') {
      for (const s of o.strokes) for (let i = 1; i < s.length; i++)
        line(o.x + s[i - 1][0], o.y + s[i - 1][1], o.x + s[i][0], o.y + s[i][1], o.lw || 2);
    }
  }
  return pdf.save();
}
