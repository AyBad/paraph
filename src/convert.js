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

/** a Word file with one page per page of the document, each page as a picture */
async function toDocx(bytes) {
  const JSZip = (await import('jszip')).default;
  const ps = await pages(bytes, 2);
  const zip = new JSZip();
  const EMU = 12700, tw = (pt) => Math.round(pt * 20);
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  let rels = '', body = '';
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i], id = `rIdImg${i + 1}`;
    zip.file(`word/media/page${i + 1}.jpeg`, await jpegBytes(p.c, 0.9));
    rels += `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page${i + 1}.jpeg"/>`;
    // a little smaller than the page, so that the picture never spills onto a new page
    const cx = Math.round(p.w * 0.98 * EMU), cy = Math.round(p.h * 0.98 * EMU);
    body += `<w:p><w:pPr>${i ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${i + 1}" name="Page ${i + 1}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${i + 1}" name="page${i + 1}.jpeg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }
  const p0 = ps[0] || { w: 595, h: 842 };
  body += `<w:sectPr><w:pgSz w:w="${tw(p0.w)}" w:h="${tw(p0.h)}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
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
