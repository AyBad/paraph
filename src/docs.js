import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle, PDFName, PDFDict, PDFArray } from 'pdf-lib';

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
    for (const s of sections) {
      s.style.margin = '0'; s.style.boxShadow = 'none';
      const canvas = await html2canvas(s, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const jpg = await (await fetch(canvas.toDataURL('image/jpeg', 0.92))).arrayBuffer();
      const im = await pdf.embedJpg(jpg);
      const w = s.offsetWidth * 0.75, h = s.offsetHeight * 0.75;
      pdf.addPage([w, h]).drawImage(im, { x: 0, y: 0, width: w, height: h });
    }
    if (!sections.length) throw new Error('empty');
    return pdf.save();
  } finally { host.remove(); }
}

/** Read AcroForm widgets with pdf.js; return fields in viewport (scale 1) units */
export async function detectFields(page, vp) {
  const out = [];
  let annots = [];
  try { annots = await page.getAnnotations(); } catch { return out; }
  for (const a of annots) {
    if (a.subtype !== 'Widget' || !a.rect) continue;
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
    const r = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    if (r.w < 4 || r.h < 4) continue;
    if (a.fieldType === 'Tx') out.push({ kind: 'text', name: a.fieldName || '', alt: a.alternativeText || '', value: typeof a.fieldValue === 'string' ? a.fieldValue : '', multiline: !!a.multiLine, ...r });
    else if (a.fieldType === 'Btn' && (a.checkBox || a.radioButton)) {
      const on = a.checkBox ? (a.fieldValue && a.fieldValue !== 'Off' && a.fieldValue === a.exportValue) : (a.fieldValue === a.buttonValue);
      out.push({ kind: 'check', name: a.fieldName || '', alt: a.alternativeText || '', value: !!on, ...r });
    }
  }
  return out;
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
