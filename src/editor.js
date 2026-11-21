import { pdfjs, detectFields, exportPdf } from './docs.js';
import { t, fmtDate } from './i18n.js';
import { esc, modal, toast, busy, confirmBox, ICON } from './ui.js';
import { signaturePad, tint } from './sigpad.js';
import { saveProfile, saveDoc, uid } from './store.js';
import { downloadPdf, shareFile } from './share.js';

const SWATCHES = ['#000000', '#1a237e', '#0d47a1', '#1b5e20', '#b71c1c'];

function matchField(f) {
  const n = (f.name + ' ' + f.alt).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const has = (re) => re.test(n);
  const birth = has(/naiss|birth|dob|geburt|nacim|nasc|born/);
  if (birth && has(/lieu|place|ort\b|lugar|luogo|city|ville|town/)) return 'birthPlace';
  if (birth) return 'birthDate';
  if (has(/nom.*prenom|full.?name|nom.?complet|nom et prenom|name.*first/)) return 'fullName';
  if (has(/pre.?nom|first|given|vorname|nombre|prenome|forename/)) return 'firstName';
  if (has(/mail|courriel/)) return 'email';
  if (has(/phone|tel|mobile|portable|telef|gsm/)) return 'phone';
  if (has(/adress|address|street|strasse|direcc|indirizzo|domicile|\brue\b/)) return 'address';
  if (has(/(^|[^a-z])(nom|name|surname|last|family|apellido|cognome|nachname|naam)([^a-z]|$)/)) return 'lastName';
  if (has(/(^|[^a-z])date([^a-z]|$)|fait le|signed on|datum|fecha/)) return 'today';
  return null;
}

export async function openEditor({ bytes, name, docId, profiles, profileId, onExit }) {
  let profile = profiles.find(p => p.id === profileId) || profiles[0];
  let color = profile.color || '#1a237e';
  let objs = [], sel = null, tool = null, pending = null, zoom = 1, editing = null, dirty = false;
  const undoStack = [];
  const pagesInfo = [];

  const root = document.getElementById('app');
  root.innerHTML = `
  <div class="editor">
    <header class="ed-top">
      <button class="icon-btn back" aria-label="back">${ICON.back}</button>
      <div class="ed-title">${esc(name)}</div>
      <select class="prof-sel" aria-label="${t('profile')}">${profiles.map(p => `<option value="${p.id}" ${p.id === profile.id ? 'selected' : ''}>${esc(p.name || [p.firstName, p.lastName].join(' ').trim() || t('unnamed'))}</option>`).join('')}</select>
      <label class="color-dot" title="${t('color')}"><input type="color" class="col" value="${color}"><span style="background:${color}"></span></label>
      <button class="btn primary small finish">${ICON.done}<span>${t('finish')}</span></button>
    </header>
    <div class="ed-banner hidden"></div>
    <div class="ed-scroll"><div class="pages" dir="ltr"></div></div>
    <div class="ed-selbar hidden"></div>
    <nav class="ed-tools">
      ${[['text', 'text'], ['check', 'check'], ['cross', 'cross'], ['strike', 'strike'], ['sign', 'signature'], ['initials', 'initials'], ['date', 'date'], ['id', 'insert'], ['pen', 'pen']]
      .map(([ic, k]) => `<button class="tool" data-tool="${k}">${ICON[ic]}<span>${t(k)}</span></button>`).join('')}
      <button class="tool undo">${ICON.undo}<span>${t('undo')}</span></button>
      <button class="tool zin">${ICON.zoomIn}<span>+</span></button>
      <button class="tool zout">${ICON.zoomOut}<span>−</span></button>
    </nav>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const pagesEl = $('.pages'), scrollEl = $('.ed-scroll'), banner = $('.ed-banner'), selbar = $('.ed-selbar');

  // ---------- load pdf ----------
  const b = busy(t('loading'));
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  } catch (e) { b.close(); toast(t('err')); onExit(); return; }
  const fields = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const el = document.createElement('div'); el.className = 'page';
    el.innerHTML = `<canvas></canvas><div class="layer"></div><div class="pno">${i}/${pdf.numPages}</div>`;
    pagesEl.appendChild(el);
    pagesInfo.push({ page, vp, rotate: page.rotate || 0, el, canvas: el.querySelector('canvas'), layer: el.querySelector('.layer'), s: 1 });
    for (const f of await detectFields(page, vp)) fields.push({ ...f, page: i - 1 });
  }
  b.close();

  // fields -> objects
  for (const f of fields) {
    if (f.kind === 'text') {
      const fs = Math.max(6, Math.min(11, f.multiline ? 10 : f.h * 0.68));
      objs.push({ id: uid(), page: f.page, type: 'text', field: f.name || true, x: f.x, y: f.y + Math.max(0, (f.multiline ? 1 : (f.h - fs * 1.2) / 2)), w: f.w, h: f.h, fw: f.w, fh: f.h, fy: f.y, fontSize: fs, text: f.value || '', color, match: matchField(f) });
    } else {
      const s = Math.min(f.w, f.h);
      objs.push({ id: uid(), page: f.page, type: 'check', field: f.name || true, on: f.value, x: f.x + (f.w - s) / 2, y: f.y + (f.h - s) / 2, w: s, h: s, color });
    }
  }
  if (fields.length) {
    banner.classList.remove('hidden');
    banner.innerHTML = `<span>${t('fieldsFound', { n: fields.length })}</span><button class="btn small primary af">${ICON.magic}<span>${t('autofill')}</span></button>`;
    banner.querySelector('.af').onclick = autofill;
  }

  // ---------- helpers ----------
  const snap = () => { undoStack.push(JSON.stringify(objs)); if (undoStack.length > 40) undoStack.shift(); dirty = true; };
  const profVal = (key) => {
    if (key === 'today') return fmtDate(new Date());
    if (key === 'fullName') return [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    if (key === 'birthDate') return profile.birthDate ? fmtDate(new Date(profile.birthDate + 'T12:00:00')) : '';
    return profile[key] || '';
  };

  function autofill() {
    if (editing) editing.blur();
    snap(); let n = 0;
    for (const o of objs) {
      if (o.type === 'text' && o.field && o.match && !o.text) {
        const v = profVal(o.match);
        if (v) { o.text = v; o.bind = o.match; o.color = color; n++; }
      }
    }
    toast(t('filled', { n })); renderObjs();
  }

  // ---------- page rendering ----------
  let renderToken = 0;
  async function layoutPages() {
    const token = ++renderToken;
    const avail = Math.min(scrollEl.clientWidth - 24, 1000);
    for (const p of pagesInfo) {
      const w = Math.max(200, avail * zoom);
      p.s = w / p.vp.width;
      const h = p.vp.height * p.s;
      p.el.style.width = w + 'px'; p.el.style.height = h + 'px';
    }
    renderObjs();
    for (const p of pagesInfo) {
      if (token !== renderToken) return;
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      let scale = p.s * dpr;
      const maxPx = 4096;
      if (p.vp.width * scale > maxPx) scale = maxPx / p.vp.width;
      if (p.vp.width * scale * p.vp.height * scale > 16e6) scale = Math.sqrt(16e6 / (p.vp.width * p.vp.height));
      const vp = p.page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      try {
        await p.page.render({ canvasContext: c.getContext('2d'), viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS }).promise;
      } catch { }
      if (token !== renderToken) return;
      p.canvas.replaceWith(c); p.canvas = c;
    }
  }

  // ---------- objects rendering ----------
  function objHtml(o, s) {
    if (o.type === 'text') {
      return `<div class="tx" dir="auto" style="font-size:${o.fontSize * s}px;color:${o.color}">${esc(o.text)}</div>`;
    }
    if (o.type === 'check' || o.type === 'cross') {
      const d = o.type === 'check' ? 'M18 52L42 78L84 22' : 'M20 20L80 80M80 20L20 80';
      return (o.field && !o.on) ? '' : `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${d}" stroke="${o.color}" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (o.type === 'strike') return `<div class="stk" style="height:${Math.max(1, (o.lw || 1.6) * s)}px;background:${o.color}"></div>`;
    if (o.type === 'image') return `<img src="${o.src}" draggable="false">`;
    if (o.type === 'ink') {
      return `<svg viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none">${o.strokes.map(st => `<polyline points="${st.map(p => p.join(',')).join(' ')}" stroke="${o.color}" stroke-width="${o.lw || 2}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
    }
    return '';
  }

  function renderObjs() {
    for (const p of pagesInfo) p.layer.innerHTML = '';
    for (const o of objs) {
      const p = pagesInfo[o.page]; if (!p) continue;
      const s = p.s;
      const el = document.createElement('div');
      el.className = `obj ${o.type}${o.field ? ' field' : ''}${sel === o ? ' sel' : ''}`;
      el.dataset.id = o.id;
      if (o.type === 'text' && o.field) {
        Object.assign(el.style, { left: o.x * s + 'px', top: o.fy * s + 'px', width: o.fw * s + 'px', height: o.fh * s + 'px' });
        el.innerHTML = `<div class="tx" dir="auto" style="font-size:${o.fontSize * s}px;color:${o.color};padding-top:${(o.y - o.fy) * s}px">${esc(o.text)}</div>`;
      } else {
        Object.assign(el.style, { left: o.x * s + 'px', top: o.y * s + 'px' });
        if (o.type !== 'text') Object.assign(el.style, { width: o.w * s + 'px', height: o.h * s + 'px' });
        el.innerHTML = objHtml(o, s);
      }
      if (sel === o && !(o.field && o.type === 'check')) el.insertAdjacentHTML('beforeend', '<div class="handle"></div>');
      p.layer.appendChild(el);
      if (o.type === 'text' && !o.field) { o.w = el.offsetWidth / s; o.h = el.offsetHeight / s; }
    }
    renderSelbar();
  }

  function renderSelbar() {
    if (!sel) { selbar.classList.add('hidden'); return; }
    selbar.classList.remove('hidden');
    const isText = sel.type === 'text';
    selbar.innerHTML = `
      ${SWATCHES.map(c => `<button class="sw${c === sel.color ? ' on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}
      <span class="sep"></span>
      ${isText ? `<button class="icon-btn fm">${ICON.minus}</button><span class="fsz">${Math.round(sel.fontSize)}</span><button class="icon-btn fp">${ICON.plus}</button><button class="icon-btn ed">${ICON.edit}</button>` : ''}
      ${sel.type === 'strike' || sel.type === 'ink' ? `<button class="icon-btn lm">${ICON.minus}</button><button class="icon-btn lp">${ICON.plus}</button>` : ''}
      ${!sel.field ? `<button class="icon-btn dup">${ICON.copy}</button><button class="icon-btn del">${ICON.trash}</button>` : `<button class="icon-btn clr">${ICON.trash}</button>`}`;
    selbar.querySelectorAll('.sw').forEach(b => b.onclick = () => setObjColor(sel, b.dataset.c));
    const on = (c, f) => { const e = selbar.querySelector(c); if (e) e.onclick = f; };
    on('.fm', () => { snap(); sel.fontSize = Math.max(4, sel.fontSize - 1); renderObjs(); });
    on('.fp', () => { snap(); sel.fontSize = Math.min(72, sel.fontSize + 1); renderObjs(); });
    on('.lm', () => { snap(); sel.lw = Math.max(0.5, (sel.lw || (sel.type === 'ink' ? 2 : 1.6)) - 0.5); renderObjs(); });
    on('.lp', () => { snap(); sel.lw = Math.min(10, (sel.lw || (sel.type === 'ink' ? 2 : 1.6)) + 0.5); renderObjs(); });
    on('.ed', () => startEdit(sel));
    on('.dup', () => { snap(); const c = JSON.parse(JSON.stringify(sel)); c.id = uid(); c.x += 10; c.y += 10; objs.push(c); sel = c; renderObjs(); });
    on('.del', () => { snap(); objs = objs.filter(o => o !== sel); sel = null; renderObjs(); });
    on('.clr', () => { snap(); sel.text = ''; delete sel.bind; renderObjs(); });
  }

  async function setObjColor(o, c) {
    snap(); o.color = c; color = c; syncColorInput();
    if (o.type === 'image') { o.src = await tint(o.orig || o.src, c); o.tinted = true; }
    renderObjs();
  }
  function syncColorInput() { $('.col').value = color; $('.color-dot span').style.background = color; }

  // ---------- text editing ----------
  function startEdit(o) {
    const p = pagesInfo[o.page];
    const el = p.layer.querySelector(`[data-id="${o.id}"] .tx`);
    if (!el) return;
    editing = el;
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r);
    const before = JSON.stringify(objs);
    el.oninput = () => { o.text = el.innerText.replace(/\n$/, ''); delete o.bind; };
    el.onblur = () => {
      el.removeAttribute('contenteditable'); editing = null;
      if (JSON.stringify(objs) !== before) { undoStack.push(before); dirty = true; }
      if (!o.field && !o.text.trim()) { objs = objs.filter(x => x !== o); if (sel === o) sel = null; }
      renderObjs();
    };
  }

  // ---------- placing ----------
  function setHint(msg) {
    if (!msg) { banner.classList.add('hidden'); if (fields.length) { banner.classList.remove('hidden'); banner.innerHTML = `<span>${t('fieldsFound', { n: fields.length })}</span><button class="btn small primary af">${ICON.magic}<span>${t('autofill')}</span></button>`; banner.querySelector('.af').onclick = autofill; } return; }
    banner.classList.remove('hidden'); banner.innerHTML = `<span>${esc(msg)}</span><button class="icon-btn x">${ICON.cross}</button>`;
    banner.querySelector('.x').onclick = () => setTool(null);
  }
  function setTool(tl, pend) {
    tool = tl; pending = pend || null;
    root.querySelectorAll('.tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tl));
    pagesEl.classList.toggle('pen-mode', tl === 'pen');
    setHint(tl ? (tl === 'pen' ? t('pen') : t('tap')) : null);
  }

  async function imageSize(src, targetW) {
    const im = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    return { w: targetW, h: targetW * im.naturalHeight / im.naturalWidth };
  }

  async function place(pi, x, y) {
    const base = { id: uid(), page: pi, color };
    let o;
    if (tool === 'text' || tool === 'date' || tool === 'insert') {
      const text = tool === 'text' ? '' : tool === 'date' ? profVal('today') : profVal(pending);
      o = { ...base, type: 'text', x, y: y - 7, fontSize: 11, text, bind: tool === 'insert' ? pending : undefined };
    } else if (tool === 'check' || tool === 'cross') {
      o = { ...base, type: tool, x: x - 7, y: y - 7, w: 14, h: 14 };
    } else if (tool === 'strike') {
      o = { ...base, type: 'strike', x: x - 40, y: y - 5, w: 80, h: 10 };
    } else if (tool === 'signature' || tool === 'initials') {
      const src = profile[tool];
      const { w, h } = await imageSize(src, tool === 'signature' ? 130 : 45);
      o = { ...base, type: 'image', x: x - w / 2, y: y - h / 2, w, h, src, orig: src, bind: tool };
    }
    if (!o) return;
    snap(); objs.push(o); sel = o;
    const keep = tool === 'check' || tool === 'cross';
    if (!keep) setTool(null);
    renderObjs();
    if (o.type === 'text' && !o.text) startEdit(o);
  }

  // ---------- pointer interactions ----------
  pagesEl.addEventListener('pointerdown', (e) => {
    const pEl = e.target.closest('.page'); if (!pEl) return;
    const pi = pagesInfo.findIndex(p => p.el === pEl); const p = pagesInfo[pi];
    const rect = p.layer.getBoundingClientRect();
    const toVp = (ev) => [(ev.clientX - rect.left) / p.s, (ev.clientY - rect.top) / p.s];

    if (tool === 'pen') {
      e.preventDefault();
      pEl.setPointerCapture(e.pointerId);
      const pts = [toVp(e)];
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('class', 'live-ink');
      svg.setAttribute('viewBox', `0 0 ${p.vp.width} ${p.vp.height}`);
      const pl = document.createElementNS(svgNS, 'polyline');
      pl.setAttribute('stroke', color); pl.setAttribute('stroke-width', '2'); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke-linecap', 'round'); pl.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(pl); p.layer.appendChild(svg);
      const mv = (ev) => { (ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]).forEach(c => pts.push(toVp(c))); pl.setAttribute('points', pts.map(q => q.join(',')).join(' ')); };
      const up = () => {
        pEl.removeEventListener('pointermove', mv); pEl.removeEventListener('pointerup', up); pEl.removeEventListener('pointercancel', up);
        svg.remove();
        if (pts.length < 2) pts.push([pts[0][0] + 0.5, pts[0][1] + 0.5]);
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
        const pad = 2, x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
        const w = Math.max(...xs) - x0 + pad, h = Math.max(...ys) - y0 + pad;
        snap();
        objs.push({ id: uid(), page: pi, type: 'ink', x: x0, y: y0, w, h, color, lw: 2, strokes: [pts.map(q => [+(q[0] - x0).toFixed(2), +(q[1] - y0).toFixed(2)])] });
        renderObjs();
      };
      pEl.addEventListener('pointermove', mv); pEl.addEventListener('pointerup', up); pEl.addEventListener('pointercancel', up);
      return;
    }

    const oEl = e.target.closest('.obj');
    if (oEl) {
      if (editing && oEl.contains(editing)) return; // caret moves inside text
      const o = objs.find(x => x.id === oEl.dataset.id); if (!o) return;
      if (o.field && o.type === 'check') { snap(); o.on = !o.on; o.color = color; sel = null; renderObjs(); return; }
      if (o.field && o.type === 'text') { if (editing) editing.blur(); sel = o; renderObjs(); startEdit(o); return; }
      e.preventDefault();
      const wasSel = sel === o;
      const isHandle = e.target.classList.contains('handle');
      if (editing) editing.blur();
      sel = o; if (!wasSel) renderObjs();
      const el = p.layer.querySelector(`[data-id="${o.id}"]`);
      const start = toVp(e), o0 = { x: o.x, y: o.y, w: o.w, h: o.h, fontSize: o.fontSize };
      const before = JSON.stringify(objs);
      let moved = false;
      el.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const [cx, cy] = toVp(ev); const dx = cx - start[0], dy = cy - start[1];
        if (!moved && Math.hypot(dx, dy) * p.s < 4) return;
        moved = true;
        if (isHandle) {
          if (o.type === 'text') { o.fontSize = Math.max(4, Math.min(96, o0.fontSize * (o0.w + dx) / o0.w)); el.querySelector('.tx').style.fontSize = o.fontSize * p.s + 'px'; }
          else if (o.type === 'strike') { o.w = Math.max(8, o0.w + dx); el.style.width = o.w * p.s + 'px'; }
          else {
            const k = Math.max(0.1, (o0.w + dx) / o0.w);
            o.w = o0.w * k; o.h = (o.type === 'image' || o.type === 'ink' || o.type === 'check' || o.type === 'cross') ? o0.h * k : Math.max(4, o0.h + dy);
            el.style.width = o.w * p.s + 'px'; el.style.height = o.h * p.s + 'px';
          }
        } else {
          o.x = o0.x + dx; o.y = o0.y + dy;
          el.style.left = o.x * p.s + 'px'; el.style.top = o.y * p.s + 'px';
        }
      };
      const up = () => {
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        if (moved) {
          if (isHandle && o.type === 'ink') { const kx = o.w / o0.w, ky = o.h / o0.h; o.strokes = o.strokes.map(s => s.map(([a, c]) => [a * kx, c * ky])); o.lw = (o.lw || 2) * kx; }
          undoStack.push(before); dirty = true; renderObjs();
        } else if (wasSel && o.type === 'text') startEdit(o);
        else renderSelbar();
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      return;
    }

    if (editing) { editing.blur(); return; }
    if (tool) { e.preventDefault(); const [x, y] = toVp(e); place(pi, x, y); return; }
    if (sel) { sel = null; renderObjs(); }
  });

  // ---------- toolbar ----------
  root.querySelectorAll('.tool[data-tool]').forEach(btn => btn.onclick = async () => {
    const k = btn.dataset.tool;
    if (tool === k) { setTool(null); return; }
    if (k === 'signature' || k === 'initials') {
      if (!profile[k]) {
        const url = await signaturePad({ title: t(k), color: profile.color });
        if (!url) return;
        profile[k] = url; await saveProfile(profile);
      }
    }
    if (k === 'insert') {
      const keys = ['fullName', 'lastName', 'firstName', 'birthDate', 'birthPlace', 'address', 'email', 'phone', 'today'];
      const m = modal(`<h2>${t('insert')} · ${esc(profile.name || '')}</h2><div class="list">${keys.map(key => {
        const v = profVal(key);
        return `<button class="list-item" data-k="${key}" ${v ? '' : 'disabled'}><b>${t(key)}</b><span>${esc(v) || '—'}</span></button>`;
      }).join('')}</div><div class="row end"><button class="btn ghost c">${t('close')}</button></div>`, 'sheet');
      m.el.querySelector('.c').onclick = m.close;
      m.el.querySelectorAll('.list-item').forEach(li => li.onclick = () => {
        m.close();
        const key = li.dataset.k;
        if (sel && sel.type === 'text' && sel.field) { snap(); sel.text = profVal(key); sel.bind = key; renderObjs(); return; }
        setTool('insert', key);
      });
      return;
    }
    if (sel && sel.field && sel.type === 'text' && k === 'date') { snap(); sel.text = profVal('today'); renderObjs(); return; }
    setTool(k);
  });
  $('.undo').onclick = () => { if (editing) editing.blur(); const s = undoStack.pop(); if (s) { objs = JSON.parse(s); sel = null; renderObjs(); } };
  $('.zin').onclick = () => { zoom = Math.min(3, zoom * 1.25); layoutPages(); };
  $('.zout').onclick = () => { zoom = Math.max(0.5, zoom / 1.25); layoutPages(); };

  $('.col').oninput = (e) => {
    color = e.target.value; syncColorInput();
    if (sel) setObjColor(sel, color);
  };

  $('.prof-sel').onchange = async (e) => {
    profile = profiles.find(p => p.id === e.target.value) || profile;
    color = profile.color || color; syncColorInput();
    // re-bind values inserted from the previous profile
    let changed = false;
    for (const o of objs) {
      if (!o.bind) continue;
      if (o.type === 'text') { o.text = profVal(o.bind); changed = true; }
      if (o.type === 'image' && profile[o.bind]) {
        const { h } = await imageSize(profile[o.bind], o.w);
        o.orig = profile[o.bind]; o.src = o.tinted ? await tint(o.orig, o.color) : o.orig; o.h = h; changed = true;
      }
    }
    if (changed) renderObjs();
    toast(`${t('profile')} : ${profile.name || t('unnamed')}`);
  };

  $('.back').onclick = async () => {
    if (editing) editing.blur();
    if (dirty && !(await confirmBox(t('discard'), t('home'), t('cancel')))) return;
    window.removeEventListener('resize', onResize); onExit();
  };

  // ---------- finish / save ----------
  $('.finish').onclick = async () => {
    if (editing) editing.blur();
    sel = null; renderObjs();
    const base = name.replace(/\.(pdf|docx|png|jpe?g|webp|heic)$/i, '');
    const m = modal(`<h2>${t('save')}</h2>
      <label class="field-l">${t('fileName')}<div class="name-row"><input class="fname" value="${esc(base)}"><span>.pdf</span></div></label>
      <div class="row end gap"><button class="btn ghost c">${t('cancel')}</button><button class="btn primary s">${t('save')}</button></div>`, 'sheet');
    m.el.querySelector('.c').onclick = m.close;
    m.el.querySelector('.fname').select();
    m.el.querySelector('.s').onclick = async () => {
      const fname = (m.el.querySelector('.fname').value.trim() || base) + '.pdf';
      m.close();
      const bz = busy(t('exporting'));
      let out;
      try {
        out = await exportPdf(bytes, objs, pagesInfo.map(p => ({ vp: p.vp, rotate: p.rotate })));
        await saveDoc(fname, out, docId);
      } catch (err) { console.error(err); bz.close(); toast(t('err') + ' (' + err.message + ')'); return; }
      bz.close(); dirty = false;
      const r = modal(`<div class="done-ic">${ICON.done}</div><h2>${t('saved')}</h2><p class="muted">${esc(fname)}</p>
        <div class="col gap">
          <button class="btn primary big sh">${ICON.share}<span>${t('share')}</span><small>${t('shareHint')}</small></button>
          <button class="btn ghost big dl">${ICON.download}<span>${t('download')}</span></button>
          <button class="btn ghost hm">${t('home')}</button>
        </div>`, 'sheet center');
      r.el.querySelector('.sh').onclick = async () => { try { await shareFile(out, fname); } catch (e) { toast(e.message); } };
      r.el.querySelector('.dl').onclick = async () => { const where = await downloadPdf(out, fname); if (where) toast(t('downloaded') + ' : ' + where); };
      r.el.querySelector('.hm').onclick = () => { r.close(); window.removeEventListener('resize', onResize); onExit(); };
    };
  };

  let rt; const onResize = () => { clearTimeout(rt); rt = setTimeout(layoutPages, 200); };
  window.addEventListener('resize', onResize);
  layoutPages();
}
