import { PDFDocument } from 'pdf-lib';
import { t } from './i18n.js';
import { ICON, busy, toast } from './ui.js';

/* ---------- geometry ---------- */
function solve(A, b) { // Gaussian elimination
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let m = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
    for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
  return x;
}
/** homography mapping dst points -> src points */
function homography(dst, src) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b); h.push(1); return h;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function warp(img, quad) {
  const [tl, tr, br, bl] = quad;
  let W = Math.round(Math.max(dist(tl, tr), dist(bl, br))), H = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  const k = Math.min(1, 2200 / Math.max(W, H)); W = Math.round(W * k); H = Math.round(H * k);
  const sc = document.createElement('canvas'); sc.width = img.width; sc.height = img.height;
  const sctx = sc.getContext('2d'); sctx.drawImage(img, 0, 0);
  const sd = sctx.getImageData(0, 0, sc.width, sc.height).data, SW = sc.width, SH = sc.height;
  const h = homography([[0, 0], [W, 0], [W, H], [0, H]], quad);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d'); const od = octx.createImageData(W, H); const o = od.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = h[6] * x + h[7] * y + 1;
    let u = (h[0] * x + h[1] * y + h[2]) / d, v = (h[3] * x + h[4] * y + h[5]) / d;
    u = Math.min(SW - 2, Math.max(0, u)); v = Math.min(SH - 2, Math.max(0, v));
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = (y0 * SW + x0) * 4, j = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      const a = sd[i + c] * (1 - fx) + sd[i + 4 + c] * fx, bb = sd[i + SW * 4 + c] * (1 - fx) + sd[i + SW * 4 + 4 + c] * fx;
      o[j + c] = a * (1 - fy) + bb * fy;
    }
    o[j + 3] = 255;
  }
  octx.putImageData(od, 0, 0);
  return out;
}

function enhance(canvas) {
  const ctx = canvas.getContext('2d'); const id = ctx.getImageData(0, 0, canvas.width, canvas.height), d = id.data;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 16) hist[(d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) | 0]++;
  const tot = hist.reduce((a, b) => a + b, 0); let acc = 0, lo = 0, hi = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc < tot * 0.02) lo = i; if (acc < tot * 0.6) hi = i; }
  hi = Math.max(hi, lo + 40);
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
    let v = (l - lo) * 255 / (hi - lo); v = v > 235 ? 255 : v < 0 ? 0 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

/** find the sheet of paper: largest bright region, its 4 extreme corners */
function detectQuad(img) {
  const S = 220, k = S / Math.max(img.width, img.height);
  const w = Math.max(8, Math.round(img.width * k)), h = Math.max(8, Math.round(img.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h); const hist = new Array(256).fill(0);
  for (let i = 0; i < w * h; i++) { g[i] = d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114; hist[g[i]]++; }
  // Otsu threshold
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue; const wF = w * h - wB; if (!wF) break;
    sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = i; }
  }
  const seen = new Uint8Array(w * h); let bestComp = null;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || g[s] <= thr) continue;
    const comp = []; const st = [s]; seen[s] = 1;
    while (st.length) {
      const p = st.pop(); comp.push(p); const x = p % w, y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
        if (q >= 0 && !seen[q] && g[q] > thr) { seen[q] = 1; st.push(q); }
    }
    if (!bestComp || comp.length > bestComp.length) bestComp = comp;
  }
  const inset = () => { const m = 0.06; return [[img.width * m, img.height * m], [img.width * (1 - m), img.height * m], [img.width * (1 - m), img.height * (1 - m)], [img.width * m, img.height * (1 - m)]]; };
  if (!bestComp || bestComp.length < w * h * 0.15 || bestComp.length > w * h * 0.97) return inset();
  let tl, tr, br, bl, a = Infinity, b2 = -Infinity, c2 = -Infinity, d2 = Infinity;
  for (const p of bestComp) {
    const x = p % w, y = (p / w) | 0;
    if (x + y < a) { a = x + y; tl = [x, y]; } if (x + y > b2) { b2 = x + y; br = [x, y]; }
    if (x - y > c2) { c2 = x - y; tr = [x, y]; } if (x - y < d2) { d2 = x - y; bl = [x, y]; }
  }
  return [tl, tr, br, bl].map(([x, y]) => [x / k, y / k]);
}

function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const i = new Image();
    i.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, 2400 / Math.max(i.naturalWidth, i.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(i.naturalWidth * k); c.height = Math.round(i.naturalHeight * k);
      c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); res(c);
    };
    i.onerror = rej; i.src = url;
  });
}

/** Camera scan: crop with 4 corners, enhance, several pages, then PDF. Resolves {bytes, name} or null */
export function scanDocument() {
  return new Promise((resolve) => {
    const pages = [];
    const root = document.createElement('div'); root.className = 'scan';
    root.innerHTML = `
      <header class="scan-top"><button class="icon-btn s-close">${ICON.cross}</button><b>${t('scan')}</b><span class="s-count"></span></header>
      <div class="scan-stage"><canvas class="s-cv"></canvas><div class="s-empty"><div class="onb-ic">${ICON.camera}</div><p>${t('scanHint')}</p></div></div>
      <div class="scan-bar">
        <label class="btn ghost s-shoot">${ICON.camera}<span>${t('takePhoto')}</span><input type="file" accept="image/*" capture="environment" hidden></label>
        <button class="btn ghost s-rot hidden">${ICON.rotate}</button>
        <button class="btn ghost s-filter hidden">${ICON.magic}<span>${t('enhance')}</span></button>
        <button class="btn ghost s-add hidden">${ICON.plus}<span>${t('addPage')}</span></button>
        <button class="btn primary s-done hidden">${ICON.done}<span>${t('finish')}</span></button>
      </div>`;
    document.body.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const cv = $('.s-cv'), ctx = cv.getContext('2d');
    let img = null, quad = null, enhanced = true, view = { k: 1, ox: 0, oy: 0 };

    const draw = () => {
      if (!img) return;
      const st = $('.scan-stage'), W = st.clientWidth, H = st.clientHeight, dpr = window.devicePixelRatio || 1;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      const k = Math.min((W - 40) / img.width, (H - 40) / img.height);
      view = { k, ox: (W - img.width * k) / 2, oy: (H - img.height * k) / 2 };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, view.ox, view.oy, img.width * k, img.height * k);
      const P = quad.map(([x, y]) => [view.ox + x * k, view.oy + y * k]);
      ctx.fillStyle = 'rgba(57,73,171,.18)'; ctx.strokeStyle = '#7aa2ff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); P.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath(); ctx.fill(); ctx.stroke();
      P.forEach(p => { ctx.beginPath(); ctx.arc(p[0], p[1], 13, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#3949ab'; ctx.stroke(); });
    };
    const ui = () => {
      ['.s-rot', '.s-filter', '.s-add', '.s-done'].forEach(c => $(c).classList.toggle('hidden', !img && !(c === '.s-done' && pages.length)));
      $('.s-empty').classList.toggle('hidden', !!img);
      $('.s-filter').classList.toggle('on', enhanced);
      $('.s-count').textContent = pages.length ? `${pages.length} ${t('pages')}` : '';
      $('.s-shoot span').textContent = img ? t('retake') : t('takePhoto');
    };
    let drag = -1;
    cv.addEventListener('pointerdown', e => {
      if (!img) return; const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      drag = quad.findIndex(([qx, qy]) => Math.hypot(view.ox + qx * view.k - x, view.oy + qy * view.k - y) < 34);
      if (drag >= 0) cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (drag < 0) return; const r = cv.getBoundingClientRect();
      quad[drag] = [Math.min(img.width, Math.max(0, (e.clientX - r.left - view.ox) / view.k)), Math.min(img.height, Math.max(0, (e.clientY - r.top - view.oy) / view.k))];
      draw();
    });
    cv.addEventListener('pointerup', () => drag = -1);
    $('.s-shoot input').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const b = busy(t('loading'));
      try { img = await loadImage(f); quad = detectQuad(img); } catch { toast(t('err')); }
      b.close(); ui(); draw();
    };
    $('.s-rot').onclick = () => {
      const c = document.createElement('canvas'); c.width = img.height; c.height = img.width;
      const x = c.getContext('2d'); x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(img, 0, 0);
      quad = quad.map(([qx, qy]) => [img.height - qy, qx]); quad = [quad[3], quad[0], quad[1], quad[2]];
      img = c; draw();
    };
    $('.s-filter').onclick = () => { enhanced = !enhanced; ui(); };
    const commitPage = () => {
      if (!img) return;
      let out = warp(img, quad); if (enhanced) out = enhance(out);
      pages.push(out.toDataURL('image/jpeg', 0.85)); img = null; quad = null;
      ctx.clearRect(0, 0, cv.width, cv.height);
    };
    $('.s-add').onclick = () => { const b = busy(t('loading')); setTimeout(() => { commitPage(); b.close(); ui(); }, 30); };
    $('.s-done').onclick = () => {
      const b = busy(t('exporting'));
      setTimeout(async () => {
        commitPage();
        const pdf = await PDFDocument.create();
        for (const u of pages) {
          const im = await pdf.embedJpg(await (await fetch(u)).arrayBuffer());
          const w = 595, h = w * im.height / im.width;
          pdf.addPage([w, h]).drawImage(im, { x: 0, y: 0, width: w, height: h });
        }
        const bytes = await pdf.save(); b.close(); root.remove();
        const d = new Date();
        resolve({ bytes, name: `scan-${d.toISOString().slice(0, 10)}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.pdf` });
      }, 30);
    };
    $('.s-close').onclick = () => { root.remove(); resolve(null); };
    window.addEventListener('resize', draw);
    ui();
    // open the camera right away
    setTimeout(() => $('.s-shoot input').click(), 50);
  });
}
