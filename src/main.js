import './style.css';
import { Capacitor } from '@capacitor/core';
import { t, LANGS, setLanguage, detectLang, fmtDate, lang } from './i18n.js';
import { esc, modal, toast, busy, confirmBox, ICON } from './ui.js';
import * as store from './store.js';
import { signaturePad } from './sigpad.js';
import { fileToPdfBytes } from './docs.js';
import { openEditor } from './editor.js';
import { downloadPdf, shareFile } from './share.js';

const app = document.getElementById('app');
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const pname = (p) => p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || t('unnamed');
const LOGO = `<svg viewBox="0 0 64 64" class="logo"><rect width="64" height="64" rx="16" fill="#1a237e"/><path d="M14 44c6-2 8-14 12-20s6 0 2 8-4 12 2 8 6-8 10-6 2 6 6 4" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 51h36" stroke="#7aa2ff" stroke-width="3" stroke-linecap="round"/></svg>`;

async function init() {
  await setLanguage((await store.getLang()) || detectLang());
  if ('serviceWorker' in navigator && !Capacitor.isNativePlatform() && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => { });
  }
  home();
}

// ---------------- HOME ----------------
async function home() {
  const [docs, profiles, activeId] = await Promise.all([store.getDocs(), store.getProfiles(), store.getActiveProfileId()]);
  const active = profiles.find(p => p.id === activeId) || profiles[0];
  app.innerHTML = `
  <div class="screen home">
    <header class="top">
      <div class="brand">${LOGO}<div><h1>Paraph</h1><p>${t('tagline')}</p></div></div>
      <button class="icon-btn settings" aria-label="${t('settings')}">${ICON.gear}</button>
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
    ${isIOS && !standalone && !Capacitor.isNativePlatform() ? `<p class="hint-ios">${t('iosInstall')}</p>` : ''}
    <p class="privacy">${t('privacy')}</p>
  </div>`;
  const $ = s => app.querySelector(s);
  $('.settings').onclick = settings;
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
      <span class="dot" style="background:${p.color}"></span><b>${esc(pname(p))}</b>
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
    <header class="top"><button class="icon-btn back">${ICON.back}</button><h1 class="h">${t('profiles')}</h1><span></span></header>
    <div class="list">${profiles.map(p => `
      <button class="list-item prof" data-id="${p.id}"><span class="dot" style="background:${p.color}"></span>
      <b>${esc(pname(p))}</b><span>${esc([p.firstName, p.lastName].filter(Boolean).join(' '))}</span>
      ${p.signature ? `<img src="${p.signature}">` : ''}</button>`).join('')}</div>
    <button class="btn primary big add">${ICON.plus}<span>${t('newProfile')}</span></button>
  </div>`;
  app.querySelector('.back').onclick = home;
  app.querySelector('.add').onclick = () => editProfile(store.emptyProfile(), true);
  app.querySelectorAll('.prof').forEach(b => b.onclick = () => editProfile(profiles.find(p => p.id === b.dataset.id)));
}

function editProfile(p, isNew) {
  p = { ...p };
  const F = (k, type = 'text', extra = '') => `<label class="field-l">${t(k)}<input data-k="${k}" type="${type}" value="${esc(p[k])}" ${extra}></label>`;
  const sigBox = (k) => `<div class="sig-box" data-k="${k}"><span>${t(k)}</span>${p[k] ? `<img src="${p[k]}">` : `<em>${ICON.sign}${t('draw')} / ${t('import')}</em>`}</div>`;
  app.innerHTML = `
  <div class="screen">
    <header class="top"><button class="icon-btn back">${ICON.back}</button><h1 class="h">${isNew ? t('newProfile') : esc(pname(p))}</h1><span></span></header>
    <div class="form">
      <label class="field-l">${t('profileName')}<input data-k="name" type="text" value="${esc(p.name)}" placeholder="${t('profileName')}"></label>
      <div class="two">${F('lastName', 'text', 'autocomplete="family-name"')}${F('firstName', 'text', 'autocomplete="given-name"')}</div>
      <div class="two">${F('birthDate', 'date')}${F('birthPlace')}</div>
      <label class="field-l">${t('address')}<textarea data-k="address" rows="2" autocomplete="street-address">${esc(p.address)}</textarea></label>
      <div class="two">${F('email', 'email', 'autocomplete="email"')}${F('phone', 'tel', 'autocomplete="tel"')}</div>
      <label class="field-l">${t('color')}<div class="swatches">${['#000000', '#1a237e', '#0d47a1', '#1b5e20', '#b71c1c'].map(c => `<button class="sw${c === p.color ? ' on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}<input type="color" class="cc" value="${p.color}"></div></label>
      <div class="two">${sigBox('signature')}${sigBox('initials')}</div>
    </div>
    <div class="row gap bottom">
      ${!isNew ? `<button class="btn danger del">${ICON.trash}</button>` : ''}
      <button class="btn primary big save">${t('save')}</button>
    </div>
  </div>`;
  const $ = s => app.querySelector(s);
  app.querySelectorAll('[data-k]').forEach(i => { if (i.tagName !== 'DIV') i.oninput = () => p[i.dataset.k] = i.value; });
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
  if (!isNew) $('.del').onclick = async () => {
    if (await confirmBox(t('confirmDelete'), t('delete'), t('cancel'))) { await store.deleteProfile(p.id); profilesScreen(); }
  };
}

// ---------------- SETTINGS ----------------
async function settings() {
  const saved = await store.getLang();
  app.innerHTML = `
  <div class="screen">
    <header class="top"><button class="icon-btn back">${ICON.back}</button><h1 class="h">${t('settings')}</h1><span></span></header>
    <section class="card"><div class="card-h"><h2>${ICON.globe}${t('language')}</h2></div>
      <div class="list langs">
        <button class="list-item lg${!saved ? ' on' : ''}" data-l=""><b>${t('auto')}</b><span>${LANGS[detectLang()]}</span></button>
        ${Object.entries(LANGS).map(([c, n]) => `<button class="list-item lg${saved === c ? ' on' : ''}" data-l="${c}"><b>${n}</b><span>${c.toUpperCase()}</span></button>`).join('')}
      </div>
    </section>
    <p class="privacy">Paraph v${__APP_VERSION__} · ${t('privacy')}</p>
  </div>`;
  app.querySelector('.back').onclick = home;
  app.querySelectorAll('.lg').forEach(b => b.onclick = async () => {
    await store.setLang(b.dataset.l || null);
    await setLanguage(b.dataset.l || detectLang());
    settings();
  });
}

init();
