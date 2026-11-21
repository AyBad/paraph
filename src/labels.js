import { Capacitor, registerPlugin } from '@capacitor/core';
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

// "Nom : ............" / "Ville : ________": the run of dots or underscores is the place to write
const LEADER = /(?:[.·_]|…){2,}|…|(?:\. ?){4,}/g;
const leaderOk = (m) => m.replace(/\s/g, '').replace(/…/g, '...').length >= 4 || /_{3,}/.test(m);
const cw = (c) => /[.,:;·' ]/.test(c) ? 0.28 : c === '_' ? 0.556 : c === '…' ? 1 : /[A-ZÀ-ÖØ-Þ]/.test(c) ? 0.68 : /[il|!]/.test(c) ? 0.24 : 0.53;
export function splitLeaders(items) {
  const text = [], leaders = [];
  for (const it of items) {
    const s = it.str;
    LEADER.lastIndex = 0;
    if (![...s.matchAll(LEADER)].some(m => leaderOk(m[0]))) { text.push(it); continue; }
    const ch = [...s], acc = [0];
    for (const c of ch) acc.push(acc[acc.length - 1] + cw(c));
    // regex indices are UTF-16: map them to characters
    const idx = []; { let u = 0; ch.forEach((c, i) => { idx[u] = i; u += c.length; }); idx[s.length] = ch.length; }
    const k = it.w / (acc[ch.length] || 1), xAt = (u) => it.x + acc[idx[u] ?? ch.length] * k;
    let last = 0, m; LEADER.lastIndex = 0;
    while ((m = LEADER.exec(s))) {
      if (!leaderOk(m[0])) continue;
      const pre = s.slice(last, m.index);
      if (pre.trim()) text.push({ ...it, str: pre.trim(), x: xAt(last), w: xAt(m.index) - xAt(last) });
      leaders.push({ ...it, str: m[0], x: xAt(m.index), w: xAt(m.index + m[0].length) - xAt(m.index), leader: true });
      last = m.index + m[0].length;
    }
    const post = s.slice(last);
    if (post.trim()) text.push({ ...it, str: post.trim(), x: xAt(last), w: it.x + it.w - xAt(last) });
  }
  return { text, leaders };
}

let workerP = null;
const simd = () => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch { return false; } };
let progressCb = null, lastOcrError = '';
export const ocrError = () => lastOcrError;
const TextOcr = registerPlugin('TextOcr');
export function warmOcr() { if (!nativeOcr()) ocrWorker().catch(() => { }); }
export function resetOcr() { const w = workerP; workerP = null; if (w) w.then(x => x.terminate()).catch(() => { }); }
async function ocrWorker() {
  if (!workerP) workerP = (async () => {
    const { createWorker } = await import('tesseract.js');
    const base = new URL('ocr/', location.href).href;
    return createWorker('fra', 1, {
      workerPath: base + 'worker.min.js',
      corePath: simd() ? base + 'tesseract-core-simd-lstm.wasm.js' : 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6/tesseract-core-lstm.wasm.js',
      langPath: base, gzip: true, workerBlobURL: false, cacheMethod: 'none',
      errorHandler: (e) => { console.warn('ocr worker', e); lastOcrError = String(e && e.message || e); },
      logger: (m) => {
        if (!progressCb) return;
        const st = { 'loading tesseract core': [0, .08], 'initializing tesseract': [.08, .04], 'loading language traineddata': [.12, .1], 'initializing api': [.22, .05], 'recognizing text': [.27, .73] }[m.status];
        if (st) progressCb(st[0] + st[1] * (m.progress || 0));
      }
    });
  })();
  return workerP;
}

// Android app: Google ML Kit text recognition on the phone itself (fast, offline, no web worker)
const nativeOcr = () => { try { return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('TextOcr'); } catch { return false; } };
async function nativeRecognize(c, S, onProgress) {
  if (onProgress) onProgress(0.3);
  const data = c.toDataURL('image/jpeg', 0.92).split(',')[1];
  const r = await TextOcr.recognize({ data });
  if (onProgress) onProgress(1);
  const out = [], ink = [];
  for (const w of r.words || []) {
    const str = (w.t || '').trim(); if (!str) continue;
    const it = { str, x: w.x / S, y: w.y / S, w: w.w / S, h: w.h / S, conf: 90, ocr: true };
    if ((str.match(/[\p{L}\p{N}]/gu) || []).length >= 2 && !/^[|_lLIiJj1!\/\\\[\]{}()'".,:;~-]+$/.test(str)) ink.push(it);
    out.push(it);
  }
  out.ink = ink; out.quality = out.length ? 90 : 0;
  return out;
}

/** OCR of a scanned page: words as [{str,x,y,w,h}] in viewport units */
export async function ocrTextItems(page, masks = [], onProgress) {
  progressCb = onProgress || null;
  const base1 = page.getViewport({ scale: 1 });
  const S = Math.min(2, 1700 / Math.max(base1.width, base1.height) * 1.4), v = page.getViewport({ scale: S });
  const c = document.createElement('canvas'); c.width = Math.floor(v.width); c.height = Math.floor(v.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: v }).promise;
  if (nativeOcr()) {
    ctx.fillStyle = '#fff';
    for (const m of masks) ctx.fillRect(m.x * S, m.y * S, m.w * S, m.h * S);
    return nativeRecognize(c, S, onProgress);
  }
  // erase the writing lines found in the picture: glued to the words, they make them unreadable
  ctx.fillStyle = '#fff';
  for (const m of masks) ctx.fillRect(m.x * S, m.y * S, m.w * S, m.h * S);
  // grey scale + contrast: faster and more reliable on photos
  const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) { let l = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; l = l > 170 ? 255 : l < 90 ? 0 : (l - 90) * 255 / 80; d[i] = d[i + 1] = d[i + 2] = l; }
  ctx.putImageData(id, 0, 0);
  const w = await ocrWorker();
  const { data } = await w.recognize(c, {}, { blocks: true, text: false });
  const out = [], ink = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || []) {
    const str = (wd.text || '').trim(); if (!str) continue;
    const { x0, y0, x1, y1 } = wd.bbox;
    const it = { str, x: x0 / S, y: y0 / S, w: (x1 - x0) / S, h: (y1 - y0) / S, conf: wd.confidence, ocr: true };
    // anything that looks like letters or digits (handwriting included) = the place is not empty
    if (wd.confidence >= 15 && (str.match(/[\p{L}\p{N}]/gu) || []).length >= 2 && !/^[|_lLIiJj1!\/\\\[\]{}()'".,:;~-]+$/.test(str)) ink.push(it);
    if (wd.confidence >= 35 || /^[.…_·]{4,}$/.test(str)) out.push(it);
  }
  out.ink = ink;
  const real = out.filter(i => i.conf >= 35);
  out.quality = real.length ? real.reduce((a, b) => a + b.conf, 0) / real.length : 0;
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
    const fy = o.fy ?? o.y, fh = o.fh ?? o.h, fw = o.fw ?? o.w;
    // writing line: the label sits on the line, not in the middle of the free space above it
    const cy = o.zone ? fy + fh - Math.min(5, fh / 2) : fy + fh / 2;
    const row = rowOf(o).filter(f => f !== o);
    const sameRow = items.filter(it => Math.abs(it.y + it.h / 2 - cy) < (o.zone ? 5 : Math.max(4, fh * 0.75)));
    if (o.fixedLabel) { o.label = o.fixedLabel; o.labelGap = 0; continue; }
    if (o.zone && !o.pending) {
      const fy0 = o.fy ?? o.y, fh0 = o.fh ?? o.h;
      const leftOf = items.filter(it => Math.abs(it.y + it.h / 2 - (fy0 + fh0 - Math.min(5, fh0 / 2))) < 5 && it.x + it.w <= o.x + 12 && it.x + it.w > o.x - 230);
      if (!leftOf.length) {
        // nothing on the left: "Nom :" written just above, starting about where the line starts
        const above = items.filter(it => it.y + it.h <= fy0 + fh0 * 0.5 && it.y + it.h > fy0 - 20);
        if (above.length) {
          const yb = Math.max(...above.map(i => i.y + i.h));
          let row = above.filter(i => i.y + i.h > yb - 4).sort((a, b) => a.x - b.x);
          // that line has its own places to write ("Né(e) le : …/…/… à"): only the words after the last one name this line
          const onRow = fields.filter(f => f !== o && f.zone && Math.abs(((f.fy ?? f.y) + (f.fh ?? f.h)) - yb) < 8);
          if (onRow.length) { const end = Math.max(...onRow.map(f => f.x + (f.fw ?? f.w))); row = row.filter(i => i.x >= end - 2); }
          else if (!row.length || row[0].x < o.x - 15 || row[0].x > o.x + 60) row = [];
          const txt = row.map(i => i.str).join(' ');
          if (txt && (/:\s*$/.test(txt) || txt.split(/\s+/).length <= 4)) { o.label = txt; o.labelGap = 0; o.labelAbove = true; continue; }
        }
      }
    }
    if (o.type === 'check') {
      // the closest text on either side ("F [ ] M [ ]" or "[ ] Oui")
      let best = null, side = '';
      for (const it of sameRow) {
        const gl = o.x - (it.x + it.w), gr = it.x - (o.x + fw);
        if (gl >= -1.5 && gl < 14 && (!best || gl < best.g)) { best = { it, g: gl }; side = 'L'; }
        if (gr >= -1.5 && gr < 14 && (!best || gr < best.g)) { best = { it, g: gr }; side = 'R'; }
      }
      if (!best) { o.label = ''; continue; }
      if (side === 'L') o.label = best.it.str.trim().split(/\s+/).pop();
      else {
        const next = Math.min(...row.filter(f => f.x > o.x + 2).map(f => f.x), o.x + 160);
        const after = sameRow.filter(it => it.x >= best.it.x && it.x < next).sort((a, b) => a.x - b.x);
        o.label = after.map(i => i.str).join(' ');
      }
      continue;
    }
    const prev = Math.max(...row.filter(f => f.x + (f.fw ?? f.w) <= o.x + 2).map(f => f.x + (f.fw ?? f.w)), o.x - 230);
    const labs = sameRow.filter(it => it.x < o.x - 2 && it.x + it.w <= o.x + 12 && it.x + it.w > prev - 2).sort((a, b) => a.x - b.x);
    o.label = labs.map(i => i.str).join(' ');
    o.labelGap = labs.length ? o.x - (labs[labs.length - 1].x + labs[labs.length - 1].w) : 999;
    o.labelConf = labs.length ? Math.max(...labs.map(i => i.conf ?? 100)) : 0;
    // small caption printed under the box (cerfa style); normal-size text below is the next line's label, not a caption
    o.caption = items.filter(it => it.h <= (o.zone ? 8.5 : 7.5) && it.h < fh * 0.8 && it.y >= fy + fh - 2 && it.y <= fy + fh + 9 && it.x + it.w / 2 > o.x - 2 && it.x + it.w / 2 < o.x + fw + 2).map(i => i.str).join(' ');
  }
}

/** contextual rules for short labels ("/", "à", "le", "h") from the field before on the same row */
export function refineByRow(fields) {
  // "Né(e) le : …/…/… à" + the dotted line under it = place of birth
  for (const o of fields) if (o.labelAbove && !o.match && /^(a|à)\s*:?$/i.test((o.label || '').trim())) {
    const yb = (o.fy ?? o.y);
    if (fields.some(f => f.match === 'birthDate' && f.page === o.page && yb - ((f.fy ?? f.y) + (f.fh ?? f.h)) < 30 && yb - ((f.fy ?? f.y) + (f.fh ?? f.h)) > -4)) o.match = 'birthPlace';
  }
  const byRow = new Map();
  for (const o of fields.filter(f => f.type === 'text')) {
    const k = o.page + ':' + Math.round(((o.fy ?? o.y) + (o.fh ?? o.h) / 2) / 6);
    (byRow.get(k) || byRow.set(k, []).get(k)).push(o);
  }
  for (const row of byRow.values()) {
    row.sort((a, b) => a.x - b.x);
    // "Adresse : [n°] [type] [nom de la voie]": the first box is only the number
    for (let i = 0; i < row.length - 1; i++) if (row[i].match === 'fullAddress' && row.slice(i + 1).some(o => /^street/.test(o.match || ''))) row[i].match = 'streetNumber';
    // "[code postal] [commune]": the box after the postal code is the town even if its caption was not read
    for (let i = 0; i < row.length - 1; i++) if (row[i].match === 'postalCode' && !row[i + 1].match) row[i + 1].match = 'city';
    // "[n°] [ext] [type] [nom]": a long box ending the row after a street type is the street name
    for (let i = 0; i < row.length - 1; i++) if (row[i].match === 'streetType' && !row[i + 1].match) row[i + 1].match = 'streetName';
    for (let i = 1; i < row.length; i++) {
      const o = row[i], p = row[i - 1];
      if (o.match) continue;
      const l = norm(o.label).replace(/\s*:$/, '');
      if ((!l || /^[\/\-.]+$/.test(l)) && (p.match === 'birthDate' || p.match === 'today')) o.match = p.match;
      else if (l === 'a' && p.match === 'birthDate') o.match = 'birthPlace';
      else if (l === 'a' && p.match === 'today') o.match = 'hour';
      else if (l === 'h' && p.match === 'hour') o.match = 'minute';
      else if (l === 'le' || l === 'le :') o.match = 'today';
    }
  }
}

export const sameText = norm;

/** areas for the administration only ("Cadre réservé à l'administration"…): never auto-filled */
const ADMIN = /reserve a l.?administration|cadre reserve|reserve a l.?autorite|reserve au service|ne rien (ecrire|inscrire)|partie reservee|for official use|office use only|nur fur den dienstgebrauch/;
export function markAdmin(fields, lines) {
  for (const l of lines) {
    if (!ADMIN.test(norm(l.text))) continue;
    for (const o of fields) if ((o.fy ?? o.y) > l.y - 2 && o.x + (o.fw ?? o.w) > l.x0 - 20 && o.x < l.x0 + 420) o.admin = true;
  }
}

/** canonical person role from a section title, so that the same person on another page is the same group */
const ROLES = [
  ['self', /vos informations|votre identite|vos coordonnees|je soussigne|le demandeur|la demandeuse|demandeur|declarant 1|declarant principal|assure|souscripteur|your details|applicant/],
  ['proxy', /procuration|mandataire/],
  ['seller', /vendeur|ancien proprietaire|cedant|seller/],
  ['buyer', /acheteur|nouveau proprietaire|acquereur|buyer/],
  ['guest', /heberg(er|e)\b|personne hebergee|guest/],
  ['child', /enfant|mineur|child/],
  ['spouse', /conjoint|epoux|epouse|declarant 2|partenaire|spouse|partner/],
  ['parent', /pere|mere|parent|representant legal|tuteur|guardian/],
  ['employer', /employeur|employer/], ['employee', /salarie|employee/],
  ['tenant', /locataire|tenant/], ['landlord', /bailleur|landlord/]
];
export function roleOf(title) { const n = norm(title); for (const [r, re] of ROLES) if (re.test(n)) return r; return null; }
