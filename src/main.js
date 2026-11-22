import './style.css';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { t, LANGS, setLanguage, detectLang, fmtDate } from './i18n.js';
import { esc, modal, toast, busy, confirmBox, ICON } from './ui.js';
import * as store from './store.js';
import { signaturePad } from './sigpad.js';
import { fileToPdfBytes } from './docs.js';
import { openEditor } from './editor.js';
import { downloadPdf, shareFile } from './share.js';
import { exportAs } from './convert.js';
import { bioAvailable, bioEnroll, bioVerify, lockMode } from './bio.js';
import { noteFirstUse, maybeAskReview } from './review.js';
import { showBanner, hideBanner, showInterstitial, removeBannerForPro, prepareInterstitial } from './ads.js';
import { scanDocument } from './scan.js';
const IncomingFile = registerPlugin('IncomingFile');

const app = document.getElementById('app');
const native = Capacitor.isNativePlatform();
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const pname = (p) => p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || t('unnamed');
const LOGO = `<svg viewBox="0 0 64 64" class="logo"><rect width="64" height="64" rx="16" fill="#1a237e"/><path d="M14 44c6-2 8-14 12-20s6 0 2 8-4 12 2 8 6-8 10-6 2 6 6 4" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 51h36" stroke="#7aa2ff" stroke-width="3" stroke-linecap="round"/></svg>`;
const fmtTime = (d) => { try { return new Intl.DateTimeFormat(document.documentElement.lang, { hour: '2-digit', minute: '2-digit' }).format(d); } catch { return d.toTimeString().slice(0, 5); } };
const FREE_PROFILES = 2;
const PLANS = [
  { id: 'monthly', price: 1.99, per: 'perMonth' },
  { id: 'yearly', price: 11.99, per: 'perYear', badge: '-50%' },
  { id: 'lifetime', price: 18.99, per: 'oneTime' }
];
const money = (v) => { try { return new Intl.NumberFormat(document.documentElement.lang, { style: 'currency', currency: 'EUR' }).format(v); } catch { return v + ' €'; } };
const SWATCHES = ['#000000', '#1a237e', '#0d47a1', '#1b5e20', '#b71c1c'];

// opening screen (index.html): shown at least until its animation has played, then fades into the app
// about 5 s in all: the text stays readable for ~1.5 s; a tap skips it
const SPLASH_MIN = 5000;
function endSplash() {
  const sp = document.getElementById('splash');
  if (!sp) return Promise.resolve();
  if (document.documentElement.classList.contains('sp-skip')) { sp.remove(); return Promise.resolve(); }
  return new Promise(r => {
    let done = false;
    const out = () => { if (done) return; done = true; sp.classList.add('out'); setTimeout(() => { sp.remove(); r(); }, 700); };
    setTimeout(out, Math.max(0, SPLASH_MIN - performance.now()));
    sp.addEventListener('click', () => { if (performance.now() > 1200) out(); });
  });
}

// ---------------- ON-SCREEN KEYBOARD ----------------
// The app is not resized by Android (that broke the layout on recent phones and after the screen locked):
// room is made under the content for the keyboard and the field being typed in is brought into view.
// remember when the app was last in use (see the opening animation in index.html)
const markActive = () => { try { localStorage.setItem('paraph:lastActive', String(Date.now())); } catch { } };
markActive(); setInterval(() => { if (!document.hidden) markActive(); }, 20000);
document.addEventListener('visibilitychange', markActive);

let kbH0 = window.innerHeight, kbOpen = false;
window.addEventListener('resize', () => { if (!kbOpen) kbH0 = window.innerHeight; });
function setKbSpace(h) {
  // if the system did resize the page (older phones), no extra space is needed
  const k = h && window.innerHeight < kbH0 - 80 ? 0 : h;
  document.documentElement.style.setProperty('--kb', k + 'px');
  // the editor makes its own room (suggestion bar above the keyboard)
  document.body.classList.toggle('kb-open', k > 0 && !document.querySelector('.editor'));
  const a = document.activeElement;
  if (k && a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !a.closest('.editor')) setTimeout(() => a.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
}
function watchKeyboard() {
  if (!native) return;
  import('@capacitor/keyboard').then(({ Keyboard }) => {
    Keyboard.addListener('keyboardWillShow', (i) => { kbOpen = true; setKbSpace(i.keyboardHeight); });
    Keyboard.addListener('keyboardDidShow', (i) => { kbOpen = true; setKbSpace(i.keyboardHeight); });
    Keyboard.addListener('keyboardWillHide', () => { kbOpen = false; setKbSpace(0); });
    Keyboard.addListener('keyboardDidHide', () => { kbOpen = false; setKbSpace(0); });
  }).catch(() => { });
}

async function init() {
  watchKeyboard();
  await setLanguage((await store.getLang()) || detectLang());
  const tag = document.getElementById('sp-tag'); if (tag) tag.textContent = t('tagline');
  if (!(await store.getSetting('themeV2'))) {
    if ((await store.getSetting('theme')) === 'auto') await store.setSetting('theme', 'light');
    await store.setSetting('themeV2', 1);
  }
  applyTheme(await store.getSetting('theme', 'light'));
  noteFirstUse();
  // the lock is put in place under the opening screen, so nothing shows in between
  if (await lockMode()) lockScreen();
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
    // lock again when coming back after a while; pick up files sent with "Open with / Share"
    let away = 0;
    import('@capacitor/app').then(({ App }) => {
      App.addListener('pause', () => { away = Date.now(); markActive(); });
      App.addListener('resume', async () => {
        // back from the lock screen: the keyboard is gone, the page gets its full height again
        kbOpen = false; setKbSpace(0);
        if (away && Date.now() - away > 60000 && await lockMode() && !document.querySelector('.lock')) await lockScreen();
        checkIncoming();
      });
    }).catch(() => { });
    try { IncomingFile.addListener('incoming', () => checkIncoming()); } catch { }
  }
  if (!(await store.isOnboarded())) onboarding(); else home();
  await endSplash();
  checkIncoming();
}

async function checkIncoming() {
  if (!native) return;
  try {
    const r = await IncomingFile.consume();
    if (!r || !r.data) return;
    const bin = atob(r.data); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    startFile(new File([u], r.name || 'document.pdf', { type: r.mime || 'application/pdf' }));
  } catch (e) { console.warn('incoming', e); }
}

// ---------------- THEME / LOCK ----------------
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
let themeMode = 'light';
function applyTheme(mode) {
  themeMode = mode || 'light';
  const dark = themeMode === 'dark' || (themeMode === 'auto' && darkMq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#12131a' : '#1a237e';
}
darkMq.addEventListener?.('change', () => applyTheme(themeMode));

function pinPad({ title, onCode, cancellable }) {
  const el = document.createElement('div');
  el.className = 'lock';
  el.innerHTML = `<div class="lock-box">${LOGO}<h2>${esc(title)}</h2><div class="pin-dots">${'<i></i>'.repeat(4)}</div><p class="pin-err"></p>
    <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => `<button class="key" data-k="${k}" ${k === '' ? 'disabled' : ''}>${k}</button>`).join('')}</div>
    ${cancellable ? `<button class="link pin-cancel">${t('cancel')}</button>` : ''}</div>`;
  document.body.appendChild(el);
  let code = '';
  const dots = () => el.querySelectorAll('.pin-dots i').forEach((d, i) => d.classList.toggle('on', i < code.length));
  const api = {
    error(msg) { code = ''; dots(); el.querySelector('.pin-err').textContent = msg; el.querySelector('.pin-dots').classList.add('shake'); setTimeout(() => el.querySelector('.pin-dots').classList.remove('shake'), 400); },
    setTitle(tt) { el.querySelector('h2').textContent = tt; code = ''; dots(); el.querySelector('.pin-err').textContent = ''; },
    close() { el.remove(); }
  };
  el.querySelectorAll('.key').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === '⌫') code = code.slice(0, -1); else if (code.length < 4) code += k;
    dots();
    if (code.length === 4) { const c = code; setTimeout(() => onCode(c, api), 120); }
  });
  const cc = el.querySelector('.pin-cancel'); if (cc) cc.onclick = () => { api.close(); onCode(null, api); };
  return api;
}
async function lockScreen() {
  if ((await lockMode()) === 'bio') return bioLock();
  return pinLock();
}
function pinLock() {
  return new Promise(res => pinPad({
    title: t('pinEnter'),
    onCode: async (c, api) => { if ((await store.sha256(c)) === (await store.getSetting('pin'))) { api.close(); res(); } else api.error(t('pinWrong')); }
  }));
}
/** locked with the fingerprint / face: the system prompt opens at once; the backup PIN when there is one */
async function bioLock() {
  const hasPin = !!(await store.getSetting('pin'));
  return new Promise(res => {
    const el = document.createElement('div');
    el.className = 'lock';
    el.innerHTML = `<div class="lock-box">${LOGO}<h2>${t('locked')}</h2>
      <button class="bio-btn">${ICON.finger}</button><p class="pin-err"></p>
      <button class="btn primary big unl">${t('unlock')}</button>
      ${hasPin ? `<button class="link use-pin">${t('usePin')}</button>` : ''}</div>`;
    document.body.appendChild(el);
    let busyNow = false;
    const go = async () => {
      if (busyNow) return; busyNow = true;
      const ok = await bioVerify(t('bioReason'));
      busyNow = false;
      if (ok) { el.remove(); res(); } else el.querySelector('.pin-err').textContent = t('bioFailed');
    };
    el.querySelector('.unl').onclick = go; el.querySelector('.bio-btn').onclick = go;
    const up = el.querySelector('.use-pin');
    if (up) up.onclick = async () => { el.remove(); await pinLock(); res(); };
    // the fingerprint / face prompt opens once the opening screen is gone
    const start = () => document.getElementById('splash') ? setTimeout(start, 150) : go();
    setTimeout(start, 300);
  });
}
/** choose how the app is locked: null (no lock), 'pin' or 'bio'. Resolves true when the choice is in place */
async function setLock(mode) {
  if (!mode) { await store.setSetting('lock', null); await store.setSetting('pin', null); await store.setSetting('bioCred', null); return true; }
  if (mode === 'pin') {
    if (!(await setPinFlow())) return false;
    await store.setSetting('lock', 'pin'); return true;
  }
  if (!(await bioAvailable())) { toast(t('bioUnavailable')); return false; }
  try { await bioEnroll(t('bioReason')); } catch (e) { toast(t('bioFailed')); return false; }
  // iPhone / browser: a backup PIN in case the device key is lost (Android offers the phone's own code instead)
  if (!native && !(await store.getSetting('pin'))) { toast(t('bioBackupPin')); if (!(await setPinFlow())) return false; }
  await store.setSetting('lock', 'bio'); return true;
}
function setPinFlow() {
  return new Promise(res => {
    let first = null;
    pinPad({
      title: t('pinSet'), cancellable: true,
      onCode: async (c, api) => {
        if (c === null) return res(false);
        if (!first) { first = c; api.setTitle(t('pinConfirm')); return; }
        if (c !== first) { first = null; api.setTitle(t('pinSet')); api.error(t('pinWrong')); return; }
        await store.setSetting('pin', await store.sha256(c)); api.close(); res(true);
      }
    });
  });
}

// ---------------- ONBOARDING ----------------
function onboarding(fromMenu) {
  const slides = [
    { ic: ICON.file, t: 's1t', d: 's1d' },
    { ic: ICON.magic, t: 's2t', d: 's2d' },
    { ic: ICON.sign, t: 's3t', d: 's3d' },
    { ic: ICON.share, t: 's4t', d: 's4d' },
    { ic: ICON.lock, t: 'permT', d: 'permD', perm: true },
    { ic: ICON.shield, t: 'pinOffer', d: 'lockOfferD', pin: true }
  ];
  if (fromMenu) slides.splice(-2);
  let i = 0, bioOk = false;
  bioAvailable().then(v => { bioOk = v; if (slides[i] && slides[i].pin) draw(); });
  const finish = async () => { await store.setOnboarded(); home(); };
  const draw = () => {
    const s = slides[i], last = i === slides.length - 1;
    app.innerHTML = `
    <div class="onb">
      <div class="onb-top">${!last ? `<button class="link skip">${t('skip')}</button>` : ''}</div>
      <div class="onb-art">${i === 0 ? LOGO : `<div class="onb-ic">${s.ic}</div>`}</div>
      <h1>${t(s.t)}</h1><p>${t(s.d)}</p>
      <div class="dots">${slides.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>
      ${s.pin && bioOk ? `<button class="btn primary big bio-nx">${ICON.finger}<span>${t('lockBio')}</span></button>` : ''}
      <button class="btn ${s.pin && bioOk ? 'ghost' : 'primary'} big nx">${s.perm ? t('allow') : s.pin ? t('lockPinBtn') : last ? t('getStarted') : t('next')}</button>
      ${s.pin ? `<button class="link later">${t('later')}</button>` : ''}
    </div>`;
    const lt = app.querySelector('.later'); if (lt) lt.onclick = finish;
    const bn = app.querySelector('.bio-nx'); if (bn) bn.onclick = async () => { if (await setLock('bio')) finish(); };
    const sk = app.querySelector('.skip'); if (sk) sk.onclick = () => { const k = slides.findIndex(x => x.perm); i = k >= 0 ? k : slides.length - 1; draw(); };
    app.querySelector('.nx').onclick = async () => {
      if (s.perm) {
        if (native) {
          try { const { Filesystem } = await import('@capacitor/filesystem'); await Filesystem.requestPermissions(); } catch { }
        }
        i++; return draw();
      }
      if (s.pin) { if (await setLock('pin')) finish(); return; }
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
    <button class="d-item" data-a="settings">${ICON.gear}<span>${t('settings')}</span></button>
    <button class="d-item" data-a="backup">${ICON.cloud}<span>${t('backup')}</span></button>
    <hr>
    <button class="d-item" data-a="tutorial">${ICON.book}<span>${t('tutorial')}</span></button>
    <button class="d-item" data-a="pro">${ICON.star}<span>${t('pro')}</span><em class="pro-tag">Pro</em></button>
    ${!isIOS ? `<button class="d-item" data-a="rate">${ICON.star}<span>${t('rateApp')}</span></button>` : ''}
    <button class="d-item" data-a="about">${ICON.info}<span>${t('about')}</span></button>
  </aside>`;
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('in'));
  const close = () => { back.classList.remove('in'); setTimeout(() => back.remove(), 200); };
  back.onclick = (e) => { if (e.target === back) close(); };
  const acts = { profiles: profilesScreen, settings: settingsScreen, backup: backupScreen, tutorial: tutorialScreen, pro: proScreen, about: aboutScreen, rate: rateApp };
  // coming back from a screen opened here shows the menu again
  back.querySelectorAll('.d-item').forEach(b => b.onclick = () => { close(); hideBanner(); backToMenu = true; acts[b.dataset.a](); });
}

let backToMenu = false;
const header = (title) => `<header class="top"><button class="icon-btn back">${ICON.back}</button><h1 class="h">${title}</h1><span></span></header>`;

/** after a save: now and then the Google Play rating card, otherwise the full-screen ad */
async function afterSave() {
  if (await maybeAskReview()) return;
  await showInterstitial();
}

/** "Rate the app": the Paraph page of Google Play (the Play Store app on Android) */
const PLAY_ID = 'com.aybad.paraph';
function rateApp() {
  backToMenu = false;
  home();
  const web = `https://play.google.com/store/apps/details?id=${PLAY_ID}`;
  if (native) { location.href = `market://details?id=${PLAY_ID}`; setTimeout(() => { if (document.visibilityState === 'visible') window.open(web, '_blank'); }, 1200); }
  else window.open(web, '_blank');
}

// ---------------- HOME ----------------
let docQuery = '', docFolder = '';

function docActions(d, folders) {
  const m = modal(`<h2 class="ellipsis">${esc(d.name)}</h2><div class="list">
    <button class="list-item a-open">${ICON.file}<b>${t('openDoc')}</b></button>
    <button class="list-item a-ren">${ICON.edit}<b>${t('rename')}</b></button>
    <button class="list-item a-mv">${ICON.folder}<b>${t('moveTo')}</b><span>${esc(d.folder || t('noFolder'))}</span></button>
    <button class="list-item a-sh">${ICON.share}<b>${t('share')}</b></button>
    <button class="list-item a-dl">${ICON.download}<b>${t('saveToPhone')}</b></button>
    <button class="list-item a-del danger-t">${ICON.trash}<b>${t('delete')}</b></button>
  </div><div class="row end"><button class="btn ghost c">${t('close')}</button></div>`, 'sheet');
  const on = (c, f) => m.el.querySelector(c).onclick = () => { m.close(); f(); };
  m.el.querySelector('.c').onclick = m.close;
  on('.a-open', () => openSaved(d));
  on('.a-ren', () => askText(t('rename'), d.name.replace(/\.pdf$/i, ''), async (v) => { await store.renameDoc(d.id, v + '.pdf'); home(); }));
  on('.a-mv', () => {
    const mm = modal(`<h2>${t('moveTo')}</h2><div class="list">
      <button class="list-item" data-f="">${ICON.file}<b>${t('noFolder')}</b></button>
      ${folders.map(f => `<button class="list-item" data-f="${esc(f)}">${ICON.folder}<b>${esc(f)}</b></button>`).join('')}
      <button class="list-item nf">${ICON.plus}<b>${t('newFolder')}</b></button></div>
      <div class="row end"><button class="btn ghost c">${t('cancel')}</button></div>`, 'sheet');
    mm.el.querySelector('.c').onclick = mm.close;
    mm.el.querySelectorAll('[data-f]').forEach(b => b.onclick = async () => { mm.close(); await store.moveDoc(d.id, b.dataset.f); home(); });
    mm.el.querySelector('.nf').onclick = () => { mm.close(); askText(t('folderName'), '', async (v) => { await store.moveDoc(d.id, v); docFolder = v; home(); }); };
  });
  on('.a-sh', async () => exportAs(await store.getDocBytes(d.id), d.name, 'share', null, d.fmt));
  on('.a-dl', async () => exportAs(await store.getDocBytes(d.id), d.name, 'save', null, d.fmt));
  on('.a-del', async () => { if (await confirmBox(t('confirmDelete'), t('delete'), t('cancel'))) { await store.deleteDoc(d.id); home(); } });
}

function askText(title, value, cb) {
  const m = modal(`<h2>${esc(title)}</h2><div class="name-row"><input class="tv" value="${esc(value)}"></div>
    <div class="row end gap"><button class="btn ghost c">${t('cancel')}</button><button class="btn primary ok">${t('save')}</button></div>`, 'sheet');
  const i = m.el.querySelector('.tv'); setTimeout(() => i.focus(), 50);
  m.el.querySelector('.c').onclick = m.close;
  m.el.querySelector('.ok').onclick = () => { const v = i.value.trim(); if (!v) return; m.close(); cb(v); };
}
async function home() {
  hideBanner();
  const [docs, profiles, activeId] = await Promise.all([store.getDocs(), store.getProfiles(), store.getActiveProfileId()]);
  const active = profiles.find(p => p.id === activeId) || profiles[0];
  const folders = [...new Set(docs.map(d => d.folder).filter(Boolean))].sort();
  if (docFolder && !folders.includes(docFolder)) docFolder = '';
  app.innerHTML = `
  <div class="screen home">
    <header class="top">
      <div class="brand">${LOGO}<div><h1>Paraph</h1><p>${t('tagline')}</p></div></div>
      <button class="icon-btn menu" aria-label="${t('menu')}">${ICON.menu}</button>
    </header>
    <div class="open-row">
      <label class="open-card">
        <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*" hidden class="file">
        <div class="open-ic">${ICON.plus}</div>
        <div><b>${t('open')}</b><span>${t('openHint')}</span></div>
      </label>
      <button class="scan-card">${ICON.camera}<span>${t('scan')}</span></button>
    </div>
    <section class="card prof-card">
      <div class="card-h"><h2>${ICON.user}${t('profiles')}</h2><button class="link manage">${t('edit')}</button></div>
      ${profiles.length > 2 ? `<div class="row gap pdd-row"><div class="dd-wrap grow"><button class="dd pdd">${active.signature ? `<img class="dd-sig" src="${active.signature}">` : ICON.user}<span>${esc(pname(active))}</span><span class="dd-n">${profiles.length}</span><svg viewBox="0 0 24 24" class="ic"><path d="M7 10l5 5 5-5"/></svg></button></div>
        <button class="chip add">${ICON.plus}</button></div>` : `<div class="chips">${profiles.map(p => `<button class="chip${p.id === active.id ? ' on' : ''}" data-id="${p.id}">
        ${p.signature ? `<img src="${p.signature}">` : ''}<span>${esc(pname(p))}</span></button>`).join('')}
        <button class="chip add">${ICON.plus}</button></div>`}
    </section>
    <section class="card">
      <div class="card-h"><h2>${ICON.file}${t('myDocs')}</h2></div>
      ${docs.length ? `
        <div class="search">${ICON.search}<input class="q" type="search" placeholder="${t('search')}" value="${esc(docQuery)}"></div>
        ${folders.length ? `<div class="dd-wrap folders"><button class="dd fdd">${ICON.folder}<span>${docFolder ? esc(docFolder) : t('allDocs')}</span><span class="dd-n">${docs.filter(d => !docFolder || d.folder === docFolder).length}</span><svg viewBox="0 0 24 24" class="ic"><path d="M7 10l5 5 5-5"/></svg></button></div>` : ''}
        <div class="docs"></div>` : `<p class="empty">${t('noDocs')}</p>`}
    </section>
    ${isIOS && !standalone && !native ? `<p class="hint-ios">${t('iosInstall')}</p>` : ''}
    <p class="privacy">${t('privacy')}</p>
  </div>`;
  const $ = s => app.querySelector(s);
  $('.menu').onclick = openMenu;
  $('.manage').onclick = profilesScreen;
  $('.chip.add').onclick = newProfile;
  app.querySelectorAll('.chip[data-id]').forEach(c => c.onclick = async () => { await store.setActiveProfileId(c.dataset.id); home(); });
  // more than two profiles: a drop-down list
  const pdd = $('.pdd');
  if (pdd) pdd.onclick = (e) => {
    e.stopPropagation();
    const old = app.querySelector('.pdd + .dd-menu'); if (old) { old.remove(); return; }
    const menu = document.createElement('div'); menu.className = 'dd-menu';
    menu.innerHTML = profiles.map(p => `<button data-id="${p.id}" class="${p.id === active.id ? 'on' : ''}">${p.signature ? `<img class="dd-sig" src="${p.signature}">` : ICON.user}<span>${esc(pname(p))}</span></button>`).join('');
    pdd.after(menu);
    menu.querySelectorAll('button').forEach(b => b.onclick = async () => { await store.setActiveProfileId(b.dataset.id); home(); });
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }));
  };
  $('.file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) startFile(f); };
  $('.scan-card').onclick = async () => { hideBanner(); const r = await scanDocument(); if (r) openNew(r.bytes, r.name); else home(); };
  const list = $('.docs');
  const renderDocs = () => {
    if (!list) return;
    const q = docQuery.trim().toLowerCase();
    const shown = docs.filter(d => (!docFolder || d.folder === docFolder) && (!q || d.name.toLowerCase().includes(q)));
    list.innerHTML = shown.length ? shown.map(d => `
      <div class="doc" data-id="${d.id}">
        <div class="doc-ic">PDF</div>
        <div class="doc-m"><b>${esc(d.name)}</b><span>${fmtDate(new Date(d.date))} ${fmtTime(new Date(d.date))} · ${(d.size / 1024).toFixed(0)} Ko${d.folder && !docFolder ? ` · ${esc(d.folder)}` : ''}</span></div>
        <button class="icon-btn d-sh" aria-label="${t('share')}">${ICON.share}</button>
        <button class="icon-btn d-more" aria-label="${t('menu')}">${ICON.dots}</button>
      </div>`).join('') : `<p class="empty">—</p>`;
    list.querySelectorAll('.doc').forEach(el => {
      const d = docs.find(x => x.id === el.dataset.id);
      el.querySelector('.doc-m').onclick = () => openSaved(d);
      el.querySelector('.d-sh').onclick = async () => exportAs(await store.getDocBytes(d.id), d.name, 'share', null, d.fmt);
      el.querySelector('.d-more').onclick = () => docActions(d, folders);
    });
  };
  renderDocs();
  const q = $('.q'); if (q) q.oninput = () => { docQuery = q.value; renderDocs(); };
  if (backToMenu) { backToMenu = false; openMenu(); }
  // folders: a drop-down list
  const fdd = $('.fdd');
  if (fdd) fdd.onclick = (e) => {
    e.stopPropagation();
    const old = app.querySelector('.dd-menu'); if (old) { old.remove(); return; }
    const menu = document.createElement('div'); menu.className = 'dd-menu';
    menu.innerHTML = [['', t('allDocs'), docs.length], ...folders.map(f => [f, f, docs.filter(d => d.folder === f).length])]
      .map(([v, l, n]) => `<button data-f="${esc(v)}" class="${docFolder === v ? 'on' : ''}">${v ? ICON.folder : ICON.file}<span>${esc(l)}</span><small>${n}</small></button>`).join('');
    fdd.after(menu);
    menu.querySelectorAll('button').forEach(b => b.onclick = () => { docFolder = b.dataset.f; home(); });
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }));
  };
  showBanner(app.querySelector('.screen'));
}

async function newProfile() {
  const n = (await store.getProfiles()).length;
  if (n >= FREE_PROFILES && !(await store.getPro())) {
    const m = modal(`<div class="done-ic pro">${ICON.star}</div><h2>${t('pro')}</h2><p class="lead">${t('freeLimit')}</p>
      <div class="row end gap"><button class="btn ghost c">${t('cancel')}</button><button class="btn primary g">${t('seePro')}</button></div>`, 'sheet center');
    m.el.querySelector('.c').onclick = m.close;
    m.el.querySelector('.g').onclick = () => { m.close(); proScreen(); };
    return;
  }
  hideBanner();
  editProfile(store.emptyProfile(), true);
}

function chooseProfile(profiles, activeId) {
  return new Promise(res => {
    // nothing pre-selected: the user picks a person, or no profile at all
    const m = modal(`<h2>${t('choose')}</h2><div class="list">${profiles.map(p => `
      <button class="list-item prof" data-id="${p.id}">
        <i class="dot" style="background:${p.color}"></i><b>${esc(pname(p))}</b><span></span>
        ${p.signature ? `<img src="${p.signature}">` : ''}</button>`).join('')}
      <button class="list-item prof none" data-id="__none__"><i class="dot hollow"></i><b>${t('noProfile')}</b><span class="muted">${t('noProfileHint')}</span></button></div>
      <div class="row end"><button class="btn ghost c">${t('cancel')}</button></div>`, 'sheet');
    m.el.querySelector('.c').onclick = () => { m.close(); res(null); };
    m.el.querySelectorAll('.prof').forEach(b => b.onclick = async () => { m.close(); if (b.dataset.id !== '__none__') await store.setActiveProfileId(b.dataset.id); res(b.dataset.id); });
  });
}

async function startFile(file) {
  const b = busy(t('loading'));
  try {
    const bytes = await fileToPdfBytes(file, (s) => b.set(t(s)));
    b.close();
    openNew(bytes, file.name);
  } catch (e) {
    b.close(); console.error(e);
    toast(e.message === 'doc' ? t('errDoc') : t('err'));
  }
}

/** a newly imported file opens directly in edit mode */
async function openNew(bytes, name) {
  prepareInterstitial();
  hideBanner();
  const profiles = await store.getProfiles();
  let id = (await store.getActiveProfileId()) || profiles[0].id;
  if (profiles.length > 1) { id = await chooseProfile(profiles, id); if (!id) return home(); }
  openEditor({ bytes: new Uint8Array(bytes), name, profiles, profileId: id, onExit: home, chooseProfile: (cur) => chooseProfile(profiles, cur), onSaved: afterSave });
}

/** a saved document opens for viewing, with a button to edit it */
async function openSaved(d) {
  hideBanner();
  const { src, objs } = await store.getDocSource(d.id);
  const bytes = src || await store.getDocBytes(d.id);
  const profiles = await store.getProfiles();
  const id = (await store.getActiveProfileId()) || profiles[0].id;
  openEditor({
    bytes: new Uint8Array(bytes), name: d.name, docId: d.id, profiles, profileId: id, onExit: home, initialObjs: src ? objs : null,
    viewOnly: true, chooseProfile: (cur) => chooseProfile(profiles, cur), onSaved: afterSave
  });
}

// ---------------- PROFILES ----------------
async function profilesScreen() {
  hideBanner();
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
  app.querySelector('.add').onclick = newProfile;
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
  hideBanner();
  p = { ...p };
  const count = (await store.getProfiles()).length;
  const F = (k, type = 'text', extra = '') => `<label class="field-l">${t(k)}<input data-k="${k}" type="${type}" value="${esc(p[k])}" ${extra}></label>`;
  const sigBox = (k) => `<div class="sig-box" data-k="${k}"><span>${t(k)}</span>${p[k] ? `<img src="${p[k]}">` : `<em>${ICON.sign}${t('draw')} / ${t('import')}</em>`}</div>`;
  app.innerHTML = `
  <div class="screen">
    ${header(isNew ? t('newProfile') : esc(pname(p)))}
    <div class="form">
      <label class="field-l">${t('profileName')}<input data-k="name" type="text" value="${esc(p.name)}" placeholder="${t('profileName')}"></label>
      <div class="field-err" id="name-err" role="alert" hidden></div>
      <div class="two">${F('lastName', 'text', 'autocomplete="family-name"')}${F('firstName', 'text', 'autocomplete="given-name"')}</div>
      <div class="two">${F('birthDate', 'date')}${F('birthPlace')}</div>
      <label class="field-l">${t('sex')}<div class="seg sex">${[['', '—'], ['M', t('male')], ['F', t('female')]].map(([v, l]) => `<button class="seg-b${(p.sex || '') === v ? ' on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></label>
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
  app.querySelectorAll('.sex .seg-b').forEach(b => b.onclick = (e) => { e.preventDefault(); p.sex = b.dataset.v; app.querySelectorAll('.sex .seg-b').forEach(x => x.classList.toggle('on', x === b)); });
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
    // two profiles cannot have the same name
    const nm = (p.name || '').trim(); p.name = nm;
    const inp = app.querySelector('input[data-k="name"]');
    const err = app.querySelector('#name-err');
    const showErr = (msg) => {
      if (inp) { inp.classList.add('err'); inp.focus(); inp.select(); inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      if (err) { err.textContent = msg; err.hidden = false; } else toast(msg);
      if (inp && !inp._errClear) { inp._errClear = true; inp.addEventListener('input', () => { inp.classList.remove('err'); if (err) err.hidden = true; }); }
    };
    if (!nm) { showErr(t('nameRequired')); return; }
    const others = (await store.getProfiles()).filter(o => o.id !== p.id);
    if (others.some(o => (o.name || '').trim().toLocaleLowerCase() === nm.toLocaleLowerCase())) {
      showErr(t('nameTaken')); return;
    }
    await store.saveProfile(p);
    if (isNew) await store.setActiveProfileId(p.id);
    toast('✓'); profilesScreen();
  };
  if (!isNew) $('.del').onclick = () => removeProfile(p, count);
}

// ---------------- SETTINGS ----------------
async function settingsScreen() {
  hideBanner();
  const [lang, theme, mode, bioOk] = [await store.getLang(), await store.getSetting('theme', 'light'), await lockMode(), await bioAvailable()];
  app.innerHTML = `
  <div class="screen">
    ${header(t('settings'))}
    <section class="card"><button class="row-btn lang">${ICON.globe}<b>${t('language')}</b><span>${lang ? LANGS[lang] : t('auto')}</span></button></section>
    <section class="card"><div class="card-h"><h2>${ICON.moon}${t('theme')}</h2></div>
      <div class="seg theme">${[['auto', t('themeAuto')], ['light', t('themeLight')], ['dark', t('themeDark')]].map(([v, l]) => `<button class="seg-b${theme === v ? ' on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></section>
    <section class="card"><div class="card-h"><h2>${ICON.shield}${t('security')}</h2></div>
      <p class="muted small">${t('lockMethod')}</p>
      <div class="seg lockm">${[['', t('lockNone')], ['pin', t('lockPin')], ['bio', t('lockBio')]].map(([v, l]) => `<button class="seg-b${(mode || '') === v ? ' on' : ''}" data-v="${v}" ${v === 'bio' && !bioOk ? 'disabled' : ''}>${v === 'bio' ? ICON.finger : ''}<span>${l}</span></button>`).join('')}</div>
      ${!bioOk ? `<p class="muted small">${t('bioUnavailable')}</p>` : ''}</section>
  </div>`;
  app.querySelector('.back').onclick = home;
  app.querySelector('.lang').onclick = settings;
  app.querySelectorAll('.theme .seg-b').forEach(b => b.onclick = async () => { await store.setSetting('theme', b.dataset.v); applyTheme(b.dataset.v); settingsScreen(); });
  app.querySelectorAll('.lockm .seg-b').forEach(b => b.onclick = async () => {
    const v = b.dataset.v || null;
    if (v === (mode || null)) return;
    if (mode && (await lockMode())) await lockScreen(); // prove it is you before changing the lock
    if (await setLock(v)) toast('✓');
    settingsScreen();
  });
}

// ---------------- LANGUAGE ----------------
async function settings() {
  hideBanner();
  const saved = await store.getLang();
  app.innerHTML = `
  <div class="screen">
    ${header(t('language'))}
    <div class="list langs">
      <button class="list-item lg${!saved ? ' on' : ''}" data-l=""><b>${t('auto')}</b><span>${LANGS[detectLang()]}</span></button>
      ${Object.entries(LANGS).map(([c, n]) => `<button class="list-item lg${saved === c ? ' on' : ''}" data-l="${c}"><b>${n}</b><span>${c.toUpperCase()}</span></button>`).join('')}
    </div>
  </div>`;
  app.querySelector('.back').onclick = settingsScreen;
  app.querySelectorAll('.lg').forEach(b => b.onclick = async () => {
    await store.setLang(b.dataset.l || null);
    await setLanguage(b.dataset.l || detectLang());
    settings();
  });
}

// ---------------- BACKUP (Google Drive…) ----------------
function backupScreen() {
  hideBanner();
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
async function proScreen() {
  hideBanner();
  const pro = await store.getPro();
  app.innerHTML = `
  <div class="screen">
    ${header(t('pro'))}
    <section class="pro-hero">
      <div class="pro-badge">${ICON.star}<b>Paraph Pro</b></div>
      <ul class="feats">
        <li>${ICON.check}<span>${t('perkNoAds')}</span></li>
        <li>${ICON.check}<span>${t('perkProfiles')}</span></li>
        <li>${ICON.check}<span>${t('perkSupport')}</span></li>
      </ul>
    </section>
    ${pro ? `<section class="card pro-on">${ICON.done}<div><b>${t('proActive')}</b><span>${t(pro.plan)} · ${fmtDate(new Date(pro.date))}</span></div></section>` : ''}
    <div class="plans">${PLANS.map(pl => `
      <button class="plan${pl.id === 'yearly' ? ' best' : ''}${pro && pro.plan === pl.id ? ' on' : ''}" data-p="${pl.id}">
        ${pl.badge ? `<em>${pl.badge}</em>` : ''}<b>${t(pl.id)}</b><span class="price">${money(pl.price)}</span><small>${t(pl.per)}</small>
      </button>`).join('')}</div>
    <button class="btn primary big buy">${ICON.star}<span>${t('buy')}</span></button>
    <p class="test-note">${t('testMode')}</p>
    <div class="row gap center">
      <button class="link restore">${t('restorePurchase')}</button>
      ${pro ? `<button class="link cancel-pro">${t('cancelPro')}</button>` : ''}
    </div>
  </div>`;
  app.querySelector('.back').onclick = home;
  let chosen = 'yearly';
  const mark = () => app.querySelectorAll('.plan').forEach(b => b.classList.toggle('sel', b.dataset.p === chosen));
  mark();
  app.querySelectorAll('.plan').forEach(b => b.onclick = () => { chosen = b.dataset.p; mark(); });
  app.querySelector('.buy').onclick = async () => {
    const pl = PLANS.find(p => p.id === chosen);
    const ok = await confirmBox(`${t(pl.id)} · ${money(pl.price)}\n${t('testMode')}`, t('buy'), t('cancel'));
    if (!ok) return;
    const b = busy(t('loading')); await new Promise(r => setTimeout(r, 900)); b.close();
    await store.setPro({ plan: pl.id, date: Date.now(), test: true });
    await removeBannerForPro();
    toast(t('proActive')); proScreen();
  };
  app.querySelector('.restore').onclick = async () => toast((await store.getPro()) ? t('proActive') : t('noPurchase'));
  const cp = app.querySelector('.cancel-pro');
  if (cp) cp.onclick = async () => { await store.setPro(null); proScreen(); };
}

function tutorialScreen() {
  hideBanner();
  const tools = [['text', 'text'], ['check', 'check'], ['cross', 'cross'], ['strike', 'strike'], ['sign', 'signature'], ['initials', 'initials'], ['date', 'date'], ['id', 'insert'], ['pen', 'pen'], ['undo', 'undo']];
  const step = (n, ic, title, text) => `<section class="tuto-step"><div class="tuto-n">${n}</div><div><h3>${ic}${title}</h3><p>${text}</p></div></section>`;
  app.innerHTML = `
  <div class="screen tuto">
    ${header(t('tutorial'))}
    ${step(1, ICON.user, t('profiles'), t('s2d'))}
    ${step(2, ICON.file, t('s1t'), t('s1d') + (native ? ' ' + t('tutoOpenWith') : ''))}
    ${step(3, ICON.camera, t('scan'), t('tutoScan'))}
    ${step(4, ICON.edit, t('startEdit'), t('tutoEdit'))}
    ${step(5, ICON.magic, t('autofill'), t('tutoAuto') + '<br><b>⚠️ ' + t('autoWarn') + '</b>')}
    <section class="tuto-step"><div class="tuto-n">6</div><div><h3>${ICON.pen}${t('tutoTools')}</h3>
      <div class="tool-grid">${tools.map(([ic, k]) => `<div>${ICON[ic]}<span>${t(k)}</span></div>`).join('')}</div>
      <p>${t('tutoMove')}</p></div></section>
    ${step(7, ICON.sign, t('s3t'), t('s3d'))}
    ${step(8, ICON.save, t('s4t'), t('s4d'))}
    ${step(9, ICON.folder, t('myDocs'), t('tutoDocs'))}
    ${step(10, ICON.gear, t('settings'), t('tutoSettings'))}
    ${step(11, ICON.cloud, t('backup'), t('backupHint'))}
  </div>`;
  app.querySelector('.back').onclick = home;
}

function aboutScreen() {
  hideBanner();
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
