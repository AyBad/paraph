import { t } from './i18n.js';
import { modal } from './ui.js';

/** Trim transparent borders of a canvas, return dataURL */
export function trimCanvas(c) {
  const ctx = c.getContext('2d');
  const { width: w, height: h } = c;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return '';
  const p = 6, out = document.createElement('canvas');
  out.width = x1 - x0 + 1 + 2 * p; out.height = y1 - y0 + 1 + 2 * p;
  out.getContext('2d').drawImage(c, x0 - p, y0 - p, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** Recolor all visible pixels of a PNG data URL */
export async function tint(url, color) {
  const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

async function importImage(file, removeBg) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
  URL.revokeObjectURL(url);
  const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = img.naturalWidth * k; c.height = img.naturalHeight * k;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
  if (removeBg) {
    const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum > 200) d[i + 3] = 0; else if (lum > 140) d[i + 3] = Math.round(d[i + 3] * (200 - lum) / 60);
    }
    ctx.putImageData(id, 0, 0);
  }
  return trimCanvas(c);
}

/** Opens the signature pad. Resolves with PNG dataURL or null */
export function signaturePad({ title, color = '#1a237e', current = '' } = {}) {
  return new Promise((resolve) => {
    let ink = color, width = 3, dirty = false, result = current;
    const m = modal(`
      <h2>${title || t('signature')}</h2>
      <div class="sig-wrap"><canvas class="sig-canvas"></canvas><div class="sig-line"></div>
        ${current ? `<img class="sig-current" src="${current}">` : ''}</div>
      <div class="row wrap gap">
        <div class="swatches">${['#000000', '#1a237e', '#0d47a1', '#b71c1c'].map(c => `<button class="sw${c === ink ? ' on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
        <label class="thick">${t('thickness')} <input type="range" min="1" max="8" value="3" class="th"></label>
      </div>
      <div class="row wrap gap">
        <button class="btn ghost clr">${t('clear')}</button>
        <label class="btn ghost">${t('import')}<input type="file" accept="image/*" hidden class="imp"></label>
        <label class="chk"><input type="checkbox" class="rb" checked> ${t('removeBg')}</label>
      </div>
      <div class="row end gap"><button class="btn ghost cancel">${t('cancel')}</button><button class="btn primary ok">${t('save')}</button></div>
    `, 'sheet');
    const cv = m.el.querySelector('.sig-canvas');
    const cur = m.el.querySelector('.sig-current');
    const fit = () => {
      const r = cv.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
      cv.width = r.width * dpr; cv.height = r.height * dpr;
      const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    };
    requestAnimationFrame(fit);
    const ctx = () => cv.getContext('2d');
    let pts = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId); pts = [pos(e)]; dirty = true; if (cur) cur.remove();
      const c = ctx(); c.fillStyle = ink; c.beginPath(); c.arc(pts[0][0], pts[0][1], width / 2, 0, 7); c.fill();
    });
    cv.addEventListener('pointermove', e => {
      if (!pts) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const c = ctx(); c.strokeStyle = ink; c.lineCap = c.lineJoin = 'round';
      for (const ev of events) {
        const p = pos(ev); const l = pts[pts.length - 1];
        const v = Math.hypot(p[0] - l[0], p[1] - l[1]);
        c.lineWidth = Math.max(width * 0.55, width * (1.25 - Math.min(v, 30) / 40));
        c.beginPath(); c.moveTo(l[0], l[1]);
        const mid = [(l[0] + p[0]) / 2, (l[1] + p[1]) / 2];
        c.quadraticCurveTo(l[0], l[1], mid[0], mid[1]); c.lineTo(p[0], p[1]); c.stroke();
        pts.push(p);
      }
    });
    const end = () => { pts = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    m.el.querySelectorAll('.sw').forEach(b => b.onclick = () => {
      ink = b.dataset.c; m.el.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x === b));
    });
    m.el.querySelector('.th').oninput = e => width = +e.target.value;
    m.el.querySelector('.clr').onclick = () => { ctx().clearRect(0, 0, cv.width, cv.height); dirty = false; result = ''; if (cur) cur.remove(); };
    m.el.querySelector('.imp').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const url = await importImage(f, m.el.querySelector('.rb').checked);
      if (!url) return;
      result = url; dirty = false;
      ctx().clearRect(0, 0, cv.width, cv.height);
      const img = new Image(); img.onload = () => {
        const r = cv.getBoundingClientRect(); const k = Math.min(r.width / img.width, r.height / img.height) * 0.9;
        ctx().drawImage(img, (r.width - img.width * k) / 2, (r.height - img.height * k) / 2, img.width * k, img.height * k);
      }; img.src = url; if (cur) cur.remove();
    };
    m.el.querySelector('.cancel').onclick = () => { m.close(); resolve(null); };
    m.el.querySelector('.ok').onclick = () => {
      const out = dirty ? trimCanvas(cv) : result;
      m.close(); resolve(out || '');
    };
  });
}
