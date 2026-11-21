// Export of a finished document as PDF, Word (.docx) or image (.jpg)
import { pdfjs } from './docs.js';
import { t } from './i18n.js';
import { esc, modal, busy, toast, ICON } from './ui.js';
import { downloadPdf, shareFile } from './share.js';

export const FORMATS = {
  pdf: { ext: '.pdf', mime: 'application/pdf' },
  docx: { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  jpg: { ext: '.jpg', mime: 'image/jpeg' }
};

/** format matching the file the user opened (a Word file goes back as Word, a photo as an image) */
export function defaultFormat(name) {
  const e = (name || '').split('.').pop().toLowerCase();
  return e === 'docx' || e === 'doc' ? 'docx' : /^(jpe?g|png|webp|heic|gif)$/.test(e) ? 'jpg' : 'pdf';
}
export const baseName = (n) => (n || 'document').replace(/\.(pdf|docx?|png|jpe?g|webp|heic|gif)$/i, '');

async function pages(bytes, scale) {
  const pdf = await pdfjs.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const v1 = page.getViewport({ scale: 1 }), v = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(v.width); c.height = Math.round(v.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: v }).promise;
    out.push({ c, w: v1.width, h: v1.height });
  }
  return out;
}
const jpegBytes = async (c, q = 0.9) => new Uint8Array(await (await fetch(c.toDataURL('image/jpeg', q))).arrayBuffer());

/** all the pages one under the other in a single picture */
async function toJpg(bytes) {
  const ps = await pages(bytes, 2);
  const W = Math.max(...ps.map(p => p.c.width)), gap = ps.length > 1 ? 16 : 0;
  let H = ps.reduce((a, p) => a + p.c.height * W / p.c.width, 0) + gap * (ps.length - 1);
  const k = Math.min(1, 16000 / H, 4096 / W);
  const out = document.createElement('canvas'); out.width = Math.round(W * k); out.height = Math.round(H * k);
  const ctx = out.getContext('2d'); ctx.fillStyle = '#d9dbe3'; ctx.fillRect(0, 0, out.width, out.height);
  let y = 0;
  for (const p of ps) { const h = p.c.height * W / p.c.width * k; ctx.drawImage(p.c, 0, y, out.width, h); y += h + gap * k; }
  return jpegBytes(out, 0.88);
}

/**
 * A Word file with one section per page of the document (own size and orientation),
 * each page as a picture inside small margins: opens the same way in Word, Google Docs and phone viewers.
 */
async function toDocx(bytes) {
  const { Document, Packer, Paragraph, ImageRun, AlignmentType } = await import('docx');
  const ps = await pages(bytes, 2);
  const M = 0.3 * 72; // 3/10 inch margin, in points
  const tw = (pt) => Math.round(pt * 20), px = (pt) => Math.round(pt * 96 / 72);
  const sections = [];
  for (const p of ps) {
    // the largest picture that fits inside the margins, page ratio kept
    const k = Math.min((p.w - 2 * M) / p.w, (p.h - 2 * M - 4) / p.h);
    sections.push({
      properties: { page: { size: { width: tw(p.w), height: tw(p.h) }, margin: { top: tw(M), bottom: tw(M), left: tw(M), right: tw(M), header: 0, footer: 0, gutter: 0 } } },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 },
        children: [new ImageRun({ type: 'jpg', data: await jpegBytes(p.c, 0.9), transformation: { width: px(p.w * k), height: px(p.h * k) } })]
      })]
    });
  }
  const doc = new Document({ creator: 'Paraph', title: 'Paraph', sections });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

export async function convert(bytes, fmt) {
  if (fmt === 'docx') return toDocx(bytes);
  if (fmt === 'jpg') return toJpg(bytes);
  return bytes;
}

/** the three formats, explained, as a choice list */
export function formatPicker(cur) {
  return `<div class="fmt-list">${['pdf', 'docx', 'jpg'].map(f => `
    <button class="fmt${f === cur ? ' on' : ''}" data-f="${f}"><span class="fmt-ic fmt-${f}">${FORMATS[f].ext.slice(1).toUpperCase()}</span>
      <span class="fmt-t"><b>${t('fmt_' + f)}</b><small>${t('fmtHint_' + f)}</small></span><span class="fmt-ok">${ICON.check}</span></button>`).join('')}</div>`;
}
export function bindPicker(root, onPick) {
  root.querySelectorAll('.fmt').forEach(b => b.onclick = () => {
    root.querySelectorAll('.fmt').forEach(x => x.classList.toggle('on', x === b));
    onPick(b.dataset.f);
  });
}

/** ask the format, then convert and share / save on the phone */
export async function exportAs(bytes, name, action, fmt, pref) {
  if (!fmt) {
    fmt = await new Promise((res) => {
      let cur = pref || defaultFormat(name);
      const m = modal(`<h2>${t('chooseFormat')}</h2>${formatPicker(cur)}
        <div class="row end gap"><button class="btn ghost c">${t('cancel')}</button><button class="btn primary go">${t('next')}</button></div>`, 'sheet');
      bindPicker(m.el, (f) => cur = f);
      m.el.querySelector('.c').onclick = () => { m.close(); res(null); };
      m.el.querySelector('.go').onclick = () => { m.close(); res(cur); };
    });
    if (!fmt) return;
  }
  const F = FORMATS[fmt], fname = baseName(name) + F.ext;
  let out = bytes;
  if (fmt !== 'pdf') {
    const b = busy(t('converting'));
    try { out = await convert(bytes, fmt); } catch (e) { b.close(); toast(t('err') + ' (' + e.message + ')'); return; }
    b.close();
  }
  try {
    if (action === 'share') await shareFile(out, fname, fname, F.mime);
    else { const w = await downloadPdf(out, fname, F.mime); if (w) toast(t('downloaded') + ' : ' + w); }
  } catch (e) { toast(e.message); }
}
export { esc };
