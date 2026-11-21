import './style.css';
import { Capacitor } from '@capacitor/core';
import { t, LANGS, setLanguage, detectLang, fmtDate } from './i18n.js';
import { esc, modal, toast, busy, confirmBox, ICON } from './ui.js';
import * as store from './store.js';
import { signaturePad } from './sigpad.js';
import { fileToPdfBytes } from './docs.js';
import { openEditor } from './editor.js';
import { downloadPdf, shareFile } from './share.js';

const app = document.getElementById('app');
const native = Capacitor.isNativePlatform();
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const pname = (p) => p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || t('unnamed');
const LOGO = `<svg viewBox="0 0 64 64" class="logo"><rect width="64" height="64" rx="16" fill="#1a237e"/><path d="M14 44c6-2 8-14 12-20s6 0 2 8-4 12 2 8 6-8 10-6 2 6 6 4" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 51h36" stroke="#7aa2ff" stroke-width="3" stroke-linecap="round"/></svg>`;
const SWATCHES = ['#000000', '#1a237e', '#0d47a1', '#1b5e20', '#b71c1c'];

async function init() {
  await setLanguage((await store.getLang()) || detectLang());
  if ('serviceWorker' in navigator && !native && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => { });
  }
  if (native) {
    // Android back button: close a dialog, else go back a screen, else leave
    import('@capacitor/app').then(({ App }) => App.addListener('backButton', () => {
      const m = document.querySelector('.modal-back, .drawer-back');
      if (m) { m.remove(); return; }
      const b = document.querySelector('#app .back');
      if (b) b.click(); else App.exitApp();
    })).catch(() => { });
  }
  if (!(await store.isOnboarded())) onboarding(); else home();
}

// ---------------- ONBOARDING ----------------
function onboarding(fromMenu) {
  const slides = [
    { ic: ICON.file, t: 's1t', d: 's1d' },
    { ic: ICON.magic, t: 's2t', d: 's2d' },
    { ic: ICON.sign, t: 's3t', d: 's3d' },
    { ic: ICON.share, t: 's4t', d: 's4d' },
    { ic: ICON.lock, t: 'permT', d: 'permD', perm: true }
  ];
  if (fromMenu) slides.pop();
  let i = 0;
  const finish = async () => { await store.setOnboarded(); home(); };
  const draw = () => {
    const s = slides[i], last = i === slides.length - 1;
    app.innerHTML = `
    <div class="onb">
      <div class="onb-top">${!last ? `<button class="link skip">${t('skip')}</button>` : ''}</div>
      <div class="onb-art">${i === 0 ? LOGO : `<div class="onb-ic">${s.ic}</div>`}</div>
      <h1>${t(s.t)}</h1><p>${t(s.d)}</p>
      <div class="dots">${slides.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>
      <button class="btn primary big nx">${s.perm ? t('allow') : last ? t('getStarted') : t('next')}</button>
    </div>`;
    const sk = app.querySelector('.skip'); if (sk) sk.onclick = () => { i = slides.length - 1; draw(); };
    app.querySelector('.nx').onclick = async () => {
      if (s.perm) {
        if (native) {
          try { const { Filesystem } = await import('@capacitor/filesystem'); await Filesystem.requestPermissions(); } catch { }
        }
        return finish();
      }
      if (last) return finish();
      i++; draw();
    };
    let x0 = null; const el = app.querySelector('.onb');
    el.addEventListener('touchstart', e => x0 = e.touches[0].clientX, { passive: true });
    el.addEventListener('touchend', e => {
      if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
      const rtl = document.documentElement.dir === 'rtl';
      if (Math.abs(dx) < 50) return;
      if ((dx < 0) !== rtl) { if (i < slides.length - 1) { i++; draw(); } } else if (i > 0) { i--; draw(); }
    });
  };
  draw();
}

// ---------------- MENU ----------------
function openMenu() {
  const back = document.createElement('div');
  back.className = 'drawer-back';
  back.innerHTML = `<aside class="drawer">
    <div class="drawer-h">${LOGO}<div><b>Paraph</b><span>${t('tagline')}</span></div></div>
    <button class="d-item" data-a="profiles">${ICON.user}<span>${t('profiles')}</span></button>
    <button class="d-item" data-a="settings">${ICON.globe}<span>${t('language')}</span></button>
    <button class="d-item" data-a="backup">${ICON.cloud}<span>${t('backup')}</span></button>
    <hr>
    <button class="d-item" data-a="tutorial">${ICON.book}<span>${t('tutorial')}</span></button>
    <button class="d-item" data-a="pro">${ICON.star}<span>${t('pro')}</span><em class="pro-tag">Pro</em></button>
    <button class="d-item" data-a="about">${ICON.info}<span>${t('about')}</span></button>
  </aside>`;
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('in'));
  const close = () => { back.classList.remove('in'); setTimeout(() => back.remove(), 200); };
  back.onclick = (e) => { if (e.target === back) close(); };
  const acts = { profiles: profilesScreen, settings, backup: backupScreen, tutorial: () => onboarding(true), pro: proScreen, about: aboutScreen };
  back.querySelectorAll('.d-item').forEach(b => b.onclick = () => { close(); acts[b.dataset.a](); });
}

const header = (title) => `<header class="top"><button class="icon-btn back">${ICON.back}</button><h1 class="h">${title}</h1><span></span></header>`;

// ---------------- HOME ----------------
async function home() {
  const [docs, profiles, activeId] = await Promise.all([store.getDocs(), store.getProfiles(), store.getActiveProfileId()]);
  const active = profiles.find(p => p.id === activeId) || profiles[0];
  app.innerHTML = `
  <div class="screen home">
    <header class="top">
      <div class="brand">${LOGO}<div><h1>Paraph</h1><p>${t('tagline')}</p></div></div>
      <button class="icon-btn menu" aria-label="${t('menu')}">${ICON.menu}</button>
    </header>
    <label class="open-card">
      <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*" hidden class="file">
      <div class="open-ic">${ICON.plus}</div>
      <div><b>${t('open')}</b><span>${t('openHint')}</span></div>
    </label>
    <section class="card prof-card">
      <div class="card-h"><h2>${ICON.user}${t('profiles')}</h2><button class="link manage">${t('edit')}</button></div>
      <div class="chips">${profiles.map(p => `<button class="chip${p.id === active.id ? ' on' : ''}" data-id="${p.id}">
        ${p.signature ? `<img src="${p.signature}">` : ''}<span>${esc(pname(p))}</span></button>`).join('')}
        <button class="chip add">${ICON.plus}</button></div>
    </section>
    <section class="card">
      <div class="card-h"><h2>${ICON.file}${t('myDocs')}</h2></div>
      ${docs.length ? `<div class="docs">${docs.map(d => `
        <div class="doc" data-id="${d.id}">
          <div class="doc-ic">PDF</div>
          <div class="doc-m"><b>${esc(d.name)}</b><span>${fmtDate(new Date(d.date))} · ${(d.size / 1024).toFixed(0)} Ko</span></div>
          <button class="icon-btn d-sh" aria-label="${t('share')}">${ICON.share}</button>
          <button class="icon-btn d-dl" aria-label="${t('download')}">${ICON.download}</button>
          <button class="icon-btn d-del" aria-label="${t('delete')}">${ICON.trash}</button>
        </div>`).join('')}</div>` : `<p class="empty">${t('noDocs')}</p>`}
    </section>
    ${isIOS && !standalone && !native ? `<p class="hint-ios">${t('iosInstall')}</p>` : ''}
    <p class="privacy">${t('privacy')}</p>
  </div>`;
  const $ = s => app.querySelector(s);
  $('.menu').onclick = openMenu;
  $('.manage').onclick = profilesScreen;
  $('.chip.add').onclick = () => editProfile(store.emptyProfile(), true);
  app.querySelectorAll('.chip[data-id]').forEach(c => c.onclick = async () => { await store.setActiveProfileId(c.dataset.id); home(); });
  $('.file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) startFile(f); };
  app.querySelectorAll('.doc').forEach(el => {
    const d = docs.find(x => x.id === el.dataset.id);
    el.querySelector('.doc-m').onclick = async () => startBytes(await store.getDocBytes(d.id), d.name, d.id);
    el.querySelector('.d-sh').onclick = async () => { try { await shareFile(await store.getDocBytes(d.id), d.name); } catch (e) { toast(e.message); } };
    el.querySelector('.d-dl').onclick = async () => { const w = await downloadPdf(await store.getDocBytes(d.id), d.name); if (w) toast(t('downloaded') + ' : ' + w); };
    el.querySelector('.d-del').onclick = async () => { if (await confirmBox(t('confirmDelete'), t('delete'), t('cancel'))) { await store.deleteDoc(d.id); home(); } };
  });
}

async function startFile(file) {
  const b = busy(t('loading'));
  try {
    const bytes = await fileToPdfBytes(file, (s) => b.set(t(s)));
    b.close();
    startBytes(bytes, file.name.replace(/\.[^.]+$/, '') + '.pdf');
  } catch (e) {
    b.close(); console.error(e);
    toast(e.message === 'doc' ? t('errDoc') : t('err'));
  }
}

async function startBytes(bytes, name, docId) {
  const profiles = await store.getProfiles();
  const activeId = (await store.getActiveProfileId()) || profiles[0].id;
  const go = (id) => openEditor({ bytes: new Uint8Array(bytes), name, docId, profiles, profileId: id, onExit: home });
  if (profiles.length < 2) return go(activeId);
  const m = modal(`<h2>${t('choose')}</h2><div class="list">${profiles.map(p => `
    <button class="list-item prof${p.id === activeId ? ' on' : ''}" data-id="${p.id}">
      <i class="dot" style="background:${p.color}"></i><b>${esc(pname(p))}</b><span></span>
      ${p.signature ? `<img src="${p.signature}">` : ''}</button>`).join('')}</div>
    <div class="row end"><button class="btn ghost c">${t('cancel')}</button></div>`, 'sheet');
  m.el.querySelector('.c').onclick = m.close;
  m.el.querySelectorAll('.prof').forEach(b => b.onclick = async () => { m.close(); await store.setActiveProfileId(b.dataset.id); go(b.dataset.id); });
}

// ---------------- PROFILES ----------------
async function profilesScreen() {
  const profiles = await store.getProfiles();
  app.innerHTML = `
  <div class="screen">
    ${header(t('profiles'))}
    <div class="list">${profiles.map(p => `
      <div class="list-item prof-row" data-id="${p.id}">
        <button class="prof-open"><i class="dot" style="background:${p.color}"></i><b>${esc(pname(p))}</b>
        ${p.signature ? `<img src="${p.signature}">` : ''}</button>
        <button class="icon-btn p-del" aria-label="${t('delete')}">${ICON.trash}</button>
      </div>`).join('')}</div>
    <button class="btn primary big add">${ICON.plus}<span>${t('newProfile')}</span></button>
  </div>`;
  app.querySelector('.back').onclick = home;
  app.querySelector('.add').onclick = () => editProfile(store.emptyProfile(), true);
  app.querySelectorAll('.prof-row').forEach(r => {
    const p = profiles.find(x => x.id === r.dataset.id);
    r.querySelector('.prof-open').onclick = () => editProfile(p);
    r.querySelector('.p-del').onclick = () => removeProfile(p, profiles.length);
  });
}

async function removeProfile(p, count) {
  if (count < 2) { toast(t('lastProfile')); return; }
  if (await confirmBox(`${t('delete')} « ${pname(p)} » ?`, t('delete'), t('cancel'))) { await store.deleteProfile(p.id); profilesScreen(); }
}

async function editProfile(p, isNew) {
  p = { ...p };
  const count = (await store.getProfiles()).length;
  const F = (k, type = 'text', extra = '') => `<label class="field-l">${t(k)}<input data-k="${k}" type="${type}" value="${esc(p[k])}" ${extra}></label>`;
  const sigBox = (k) => `<div class="sig-box" data-k="${k}"><span>${t(k)}</span>${p[k] ? `<img src="${p[k]}">` : `<em>${ICON.sign}${t('draw')} / ${t('import')}</em>`}</div>`;
  app.innerHTML = `
  <div class="screen">
    ${header(isNew ? t('newProfile') : esc(pname(p)))}
    <div class="form">
      <label class="field-l">${t('profileName')}<input data-k="name" type="text" value="${esc(p.name)}" placeholder="${t('profileName')}"></label>
      <div class="two">${F('lastName', 'text', 'autocomplete="family-name"')}${F('firstName', 'text', 'autocomplete="given-name"')}</div>
      <div class="two">${F('birthDate', 'date')}${F('birthPlace')}</div>
      <fieldset class="addr"><legend>${t('address')}</legend>
        <div class="addr1">${F('streetNumber', 'text', 'autocomplete="off"')}${F('streetName', 'text', 'autocomplete="address-line1"')}</div>
        ${F('addressExtra', 'text', 'autocomplete="address-line2"')}
        <div class="addr2">${F('postalCode', 'text', 'inputmode="numeric" autocomplete="postal-code"')}${F('city', 'text', 'autocomplete="address-level2"')}</div>
        ${F('country', 'text', 'autocomplete="country-name"')}
      </fieldset>
      <div class="two">${F('email', 'email', 'autocomplete="email"')}${F('phone', 'tel', 'autocomplete="tel"')}</div>
      <label class="field-l">${t('color')}<div class="swatches">${SWATCHES.map(c => `<button class="sw${c === p.color ? ' on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}<input type="color" class="cc" value="${p.color}"></div></label>
      <div class="two">${sigBox('signature')}${sigBox('initials')}</div>
    </div>
    <div class="row gap bottom">
      ${!isNew ? `<button class="btn danger del">${ICON.trash}<span>${t('delete')}</span></button>` : ''}
      <button class="btn primary big save">${ICON.save}<span>${t('save')}</span></button>
    </div>
  </div>`;
  const $ = s => app.querySelector(s);
  app.querySelectorAll('input[data-k]').forEach(i => i.oninput = () => p[i.dataset.k] = i.value);
  app.querySelectorAll('.sw').forEach(b => b.onclick = () => { p.color = b.dataset.c; $('.cc').value = p.color; app.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x === b)); });
  $('.cc').oninput = e => { p.color = e.target.value; app.querySelectorAll('.sw').forEach(x => x.classList.remove('on')); };
  app.querySelectorAll('.sig-box').forEach(box => box.onclick = async () => {
    const k = box.dataset.k;
    const url = await signaturePad({ title: t(k), color: p.color, current: p[k] });
    if (url === null) return;
    p[k] = url;
    box.innerHTML = `<span>${t(k)}</span>${url ? `<img src="${url}">` : `<em>${ICON.sign}${t('draw')} / ${t('import')}</em>`}`;
  });
  $('.back').onclick = isNew ? home : profilesScreen;
  $('.save').onclick = async () => {
    await store.saveProfile(p);
    if (isNew) await store.setActiveProfileId(p.id);
    toast('✓'); profilesScreen();
  };
  if (!isNew) $('.del').onclick = () => removeProfile(p, count);
}

// ---------------- LANGUAGE ----------------
async function settings() {
  const saved = await store.getLang();
  app.innerHTML = `
  <div class="screen">
    ${header(t('language'))}
    <div class="list langs">
      <button class="list-item lg${!saved ? ' on' : ''}" data-l=""><b>${t('auto')}</b><span>${LANGS[detectLang()]}</span></button>
      ${Object.entries(LANGS).map(([c, n]) => `<button class="list-item lg${saved === c ? ' on' : ''}" data-l="${c}"><b>${n}</b><span>${c.toUpperCase()}</span></button>`).join('')}
    </div>
  </div>`;
  app.querySelector('.back').onclick = home;
  app.querySelectorAll('.lg').forEach(b => b.onclick = async () => {
    await store.setLang(b.dataset.l || null);
    await setLanguage(b.dataset.l || detectLang());
    settings();
  });
}

// ---------------- BACKUP (Google Drive…) ----------------
function backupScreen() {
  app.innerHTML = `
  <div class="screen">
    ${header(t('backup'))}
    <section class="card">
      <p class="lead">${t('backupHint')}</p>
      <div class="col gap">
        <button class="btn primary big exp">${ICON.cloud}<span>${t('exportBackup')}</span><small>Google Drive, OneDrive, Dropbox, e-mail…</small></button>
        <label class="btn ghost big">${ICON.download}<span>${t('importBackup')}</span><input type="file" accept=".json,application/json" hidden class="imp"></label>
      </div>
    </section>
  </div>`;
  app.querySelector('.back').onclick = home;
  app.querySelector('.exp').onclick = async () => {
    const b = busy(t('loading'));
    try {
      const json = await store.exportBackup();
      b.close();
      const d = new Date().toISOString().slice(0, 10);
      await shareFile(new TextEncoder().encode(json), `paraph-backup-${d}`, 'Paraph backup', 'application/json');
    } catch (e) { b.close(); toast(e.message); }
  };
  app.querySelector('.imp').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const b = busy(t('loading'));
    try { await store.importBackup(await f.text()); b.close(); toast(t('restored')); home(); }
    catch (err) { b.close(); toast(t('err')); }
  };
}

// ---------------- PRO / ABOUT ----------------
function proScreen() {
  const feats = ['s1t', 's2t', 's3t', 's4t', 'backup', 'language'];
  app.innerHTML = `
  <div class="screen">
    ${header(t('pro'))}
    <section class="card pro-card">
      <div class="pro-badge">${ICON.star}<b>Paraph Pro</b></div>
      <ul class="feats">${feats.map(k => `<li>${ICON.check}<span>${t(k)}</span></li>`).join('')}</ul>
      <p class="lead">${t('proD')}</p>
    </section>
  </div>`;
  app.querySelector('.back').onclick = home;
}

function aboutScreen() {
  app.innerHTML = `
  <div class="screen">
    ${header(t('about'))}
    <section class="card about">
      <div class="brand">${LOGO}<div><h1>Paraph</h1><p>${t('version')} ${__APP_VERSION__}</p></div></div>
      <p class="lead">${t('tagline')}.</p>
      <p class="lead">${t('privacy')}</p>
      <p class="muted">© ${new Date().getFullYear()} AyBad · github.com/AyBad/paraph</p>
    </section>
  </div>`;
  app.querySelector('.back').onclick = home;
}

init();
