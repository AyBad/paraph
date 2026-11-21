import { Capacitor } from '@capacitor/core';
import { pdfjs, detectFields, detectBoxes, detectZones, exportPdf, fieldTooltips } from './docs.js';
import { t, fmtDate } from './i18n.js';
import { esc, modal, toast, busy, confirmBox, ICON } from './ui.js';
import { signaturePad, tint } from './sigpad.js';
import { saveProfile, saveDoc, uid, getMemory, remember } from './store.js';
import { pdfTextItems, ocrTextItems, textLines, attachLabels, refineByRow, markAdmin, roleOf, resetOcr } from './labels.js';
import { downloadPdf, shareFile } from './share.js';

const SWATCHES = ['#000000', '#1a237e', '#0d47a1', '#1b5e20', '#b71c1c'];
const STREET_TYPES = /^(rue|avenue|av\.?|boulevard|bd|allee|allée|chemin|impasse|place|route|quai|cours|square|passage|voie|sentier|rond-point|residence|résidence|lotissement|hameau|lieu-dit|faubourg|esplanade|parvis|promenade|street|st\.?|road|rd\.?|lane|drive|way)\s+/i;
const INSERT_KEYS = ['fullName', 'lastName', 'firstName', 'birthDate', 'birthPlace', 'fullAddress', 'streetNumber', 'streetName', 'addressExtra', 'postalCode', 'city', 'country', 'email', 'phone', 'today'];

const norm = (s) => (s || '').replace(/([a-zà-ÿ])([A-ZÀ-Þ])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-.]+/g, ' ');

/** Guess which profile value a form field expects, from its name and tooltip */
function matchField(f) {
  const short = (f.name || '').split('.').pop().replace(/\[\d+\]/g, '');
  const n = norm(short + ' ' + f.alt);
  const has = (re) => re.test(n);
  if (has(/signature|siret|siren|immatric|identification|kilom|agrement|marque|modele|iban|bic\b|motif|denomination|genre|formule|certificat|vehicule|variante|autorite|administration|electeur|election|consulaire|departement|premier tour|second tour|\btour\b|jusqu/)) return null;
  if (has(/nom de naissance|nom de jeune fille|birth ?name|maiden name|geburtsname/)) return 'lastName';
  const birth = has(/naiss|birth|dob\b|geburt|nacim|nasc|born|\bne ?\(?e?\)? le\b|\bnee? le\b/);
  if (birth && has(/lieu|place|\bort\b|lugar|luogo|city|ville|town|commune/)) return 'birthPlace';
  if (birth) return 'birthDate';
  if (has(/code postal|postal|\bzip\b|\bcp\b|\bplz\b|postcode/)) return 'postalCode';
  if (has(/type (de )?(la )?voie|street type/)) return 'streetType';
  if (has(/extension|bis ter|\bbis\b/)) return null;
  if (has(/n ?[°o]? ?de (la )?voie|numero (de )?(la )?(voie|rue)|house n|street n(o|um)|hausnummer|\bn° voie|num voie|numero voie/)) return 'streetNumber';
  if (has(/nom (de )?(la )?voie|libelle (de la )?voie|street|\brue\b|\bvoie\b|strasse|calle|\bvia\b/)) return 'streetName';
  if (has(/complement/)) return 'addressExtra';
  if (has(/fait a\b|signed at|lieu (de )?(la )?(signature|declaration)/)) return 'signCity';
  if (has(/commune|ville|\bcity\b|localite|\btown\b|\bort\b|ciudad|citta|municipal/)) return 'city';
  if (has(/\bpays\b|country|\bpais\b/)) return 'country';
  if (has(/adress|address|domicile|anschrift|direcc|indirizzo|demeurant/)) return 'fullAddress';
  if (has(/nom.*prenom|full ?name|nom complet|soussigne|undersigned|identite|identity/)) return 'fullName';
  if (has(/pre ?nom|first|given|vorname|nombre|prenome|forename/)) return 'firstName';
  if (has(/mail|courriel/)) return 'email';
  if (has(/phone|\btel\b|telephone|mobile|portable|telef|gsm/)) return 'phone';
  if (has(/horaire/)) return /2$/.test(n.trim()) ? 'minute' : 'hour';
  if (has(/heure|\bhour/)) return 'hour';
  if (has(/minute/)) return 'minute';
  if (has(/(^|[^a-z])(nom|name|surname|last|family|apellido|cognome|nachname|naam)([^a-z]|$)/)) return 'lastName';
  if (has(/(^|[^a-z])date([^a-z]|$)|fait le|signed on|datum|fecha|declaration/)) return 'today';
  return null;
}

/** day / month / year box, from the field name suffix (…Jour, …Mois, …Année, …J/M/A) */
function datePart(f) {
  const short = norm((f.name || '').split('.').pop().replace(/\[\d+\]/g, ''));
  if (/(jour|day|tag|dia|\bj|\bd)$/.test(short)) return 'd';
  if (/(mois|month|monat|mes|\bm)$/.test(short)) return 'm';
  if (/(annee|year|jahr|ano|\ba|\by)$/.test(short)) return 'y';
  return null;
}
const BUYER = /acheteur|acquereur|buyer|purchaser|nouveau proprietaire|new owner|kaufer|comprador/;
const SELLER = /vendeur|cedant|seller|ancien proprietaire|former owner|verkaufer|vendedor/;

let measureCtx;
function textWidth(txt, fs) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = '100px Helvetica, Arial, sans-serif';
  return measureCtx.measureText(txt).width / 100 * fs;
}

export async function openEditor({ bytes, name, docId, profiles, profileId, onExit, initialObjs, viewOnly, chooseProfile, onSaved }) {
  let profile = profiles.find(p => p.id === profileId) || profiles[0];
  let color = profile.color || '#1a237e';
  let objs = [], sel = null, tool = null, pending = null, zoom = 1, editing = null, dirty = false, pinching = false, viewing = !!viewOnly;
  const undoStack = [];
  const pagesInfo = [];
  const memory = await getMemory();
  function pn(p) { return p.name || [p.firstName, p.lastName].join(' ').trim() || t('unnamed'); }

  const root = document.getElementById('app');
  root.innerHTML = `
  <div class="editor${viewing ? ' viewing' : ''}">
    <header class="ed-top">
      <button class="icon-btn back" aria-label="back">${ICON.back}</button>
      <div class="ed-title">${esc(name)}</div>
      <button class="prof-btn" aria-label="${t('profile')}"><span>${esc(pn(profile))}</span><svg viewBox="0 0 24 24" class="ic chev"><path d="M7 10l5 5 5-5"/></svg></button>
      <label class="color-dot" title="${t('color')}"><input type="color" class="col" value="${color}"><span style="background:${color}"></span></label>
      <button class="btn primary small finish" aria-label="${t('save')}">${ICON.save}<span>${t('save')}</span></button>
      <button class="icon-btn v-sh" aria-label="${t('share')}">${ICON.share}</button>
      <button class="icon-btn v-dl" aria-label="${t('download')}">${ICON.download}</button>
    </header>
    <div class="ed-banner hidden"></div>
    <div class="ed-scroll"><div class="pages" dir="ltr"></div></div>
    <div class="ed-selbar hidden"></div>
    <div class="view-bar"><button class="btn primary big start-edit">${ICON.edit}<span>${t('startEdit')}</span></button></div>
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
  const tips = await fieldTooltips(bytes);
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const el = document.createElement('div'); el.className = 'page';
    el.innerHTML = `<canvas></canvas><div class="layer"></div><div class="pno">${i}/${pdf.numPages}</div>`;
    pagesEl.appendChild(el);
    const pf = await detectFields(page, vp, tips);
    for (const f of pf) fields.push({ ...f, page: i - 1 });
    let boxes = [], zones = [];
    if (!pf.length) {
      boxes = await detectBoxes(page, vp);
      if (!initialObjs && i <= 30) {
        try { const z = await detectZones(page); zones = z.zones; for (const bx of z.boxes) if (!boxes.some(o => Math.abs(o.x - bx.x) < 3 && Math.abs(o.y - bx.y) < 3)) boxes.push(bx); } catch (e) { console.warn(e); }
      }
      // a run of adjacent squares is a comb (character boxes), not a tick box
      boxes = boxes.filter(bx => !boxes.some(o => o !== bx && Math.abs(o.y - bx.y) < 2 && (Math.abs(o.x - (bx.x + bx.w)) < 2.5 || Math.abs(bx.x - (o.x + o.w)) < 2.5)));
    }
    pagesInfo.push({ page, vp, rotate: page.rotate || 0, el, canvas: el.querySelector('canvas'), layer: el.querySelector('.layer'), s: 1, boxes });
    for (const z of zones) fields.push({ kind: 'zone', page: i - 1, ...z });
  }
  b.close();

  // fields -> objects (or restore the objects of a document saved earlier)
  if (initialObjs && initialObjs.length) objs = JSON.parse(JSON.stringify(initialObjs));
  else for (const f of fields) {
    if (f.kind === 'zone') {
      const fs = Math.max(6, Math.min(12, f.h * 0.65));
      objs.push({ id: uid(), page: f.page, type: 'text', field: 'zone', zone: true, x: f.x, w: f.w, h: f.h, fw: f.w, fh: f.h, fy: f.y, y: f.y + Math.max(0, f.h - fs * 1.25), fontSize: fs, baseFs: fs, text: '', color });
    } else if (f.kind === 'text') {
      const fs = Math.max(5, Math.min(11, f.multiline ? 10 : f.h * 0.68));
      objs.push({
        id: uid(), page: f.page, type: 'text', field: f.name || true, x: f.x, w: f.w, h: f.h, fw: f.w, fh: f.h, fy: f.y,
        y: f.y + (f.multiline ? 1 : Math.max(0, (f.h - fs * 1.2) / 2)), fontSize: fs, baseFs: fs, multiline: f.multiline,
        comb: f.comb || 0, maxLen: f.maxLen || 0, text: f.value || '', color, match: matchField(f), part: datePart(f),
        role: BUYER.test(norm(f.name + ' ' + f.alt)) ? 'buyer' : SELLER.test(norm(f.name + ' ' + f.alt)) ? 'seller' : null
      });
    } else {
      const s = Math.min(f.w, f.h);
      const nn = norm((f.name || '').split('.').pop() + ' ' + f.alt);
      objs.push({
        id: uid(), page: f.page, type: 'check', field: f.name || true, on: f.value, mark: 'check', x: f.x + (f.w - s) / 2, y: f.y + (f.h - s) / 2, w: s, h: s, color,
        radio: f.radio, group: f.name, bval: f.bval, fy: f.y,
        match: /sexe|\bsex\b|gender|femme|homme|masculin|feminin/.test(nn) ? 'sex' : /personne physique|physique|natural person/.test(nn) ? 'physical' : null,
        role: BUYER.test(nn) ? 'buyer' : SELLER.test(nn) ? 'seller' : null
      });
    }
  }
  // ---------- understanding the form: labels, values, sections ----------
  const pageText = []; // per page: { items, lines }
  let sections = [];
  const rowY = (o) => (o.fy ?? o.y) + (o.fh ?? o.h) / 2;
  const SEX_M = /^(m|mr|m\.|monsieur|homme|masculin|male|herr|sr|h)\b/, SEX_F = /^(f|mme|madame|mlle|mademoiselle|femme|feminin|female|frau|sra)\b/;

  function analyze() {
    const fieldsAll = objs.filter(o => o.field);
    for (const o of fieldsAll) if (o.admin) o.match = null;
    // 1. what each field expects, from its printed label when the name says nothing
    for (const o of fieldsAll) {
      if (o.admin) continue;
      if (o.type === 'text' && !o.match && (o.label || o.caption)) o.match = matchField({ name: '', alt: o.label || '' }) || matchField({ name: '', alt: o.caption || '' });
      if (o.type === 'check' && o.label) {
        const l = norm(o.label);
        if (SEX_M.test(l)) { o.match = 'sex'; o.val = 'M'; }
        else if (SEX_F.test(l)) { o.match = 'sex'; o.val = 'F'; }
        else if (/personne physique|natural person/.test(l)) { o.match = 'physical'; o.val = 'P'; }
      }
    }
    refineByRow(fieldsAll.filter(o => !o.admin));
    const textFields = fieldsAll.filter(o => o.type === 'text');
    // 2. dates typed in several boxes on one row (dd | mm | yyyy)
    for (const key of ['birthDate', 'today']) {
      const used = new Set();
      for (const o of textFields.filter(x => x.match === key)) {
        if (used.has(o) || o.part) continue;
        const row = textFields.filter(x => x.match === key && !x.part && x.page === o.page && Math.abs(rowY(x) - rowY(o)) < 5).sort((a, c) => a.x - c.x);
        row.forEach(x => used.add(x));
        if (row.length === 3) ['d', 'm', 'y'].forEach((p, i) => row[i].part = p);
        else if (row.length === 2) { row[0].part = row[0].maxLen === 4 ? 'dm' : 'd'; row[1].part = row[1].maxLen === 4 && row[0].maxLen !== 4 ? 'y' : 'my'; }
      }
    }
    // 3. radio / tick boxes named by the form (cerfa): which value each box stands for
    const checks = fieldsAll.filter(o => o.type === 'check' && o.match && o.val === undefined);
    for (const g of new Set(checks.map(o => o.page + '|' + o.group))) {
      const grp = checks.filter(o => o.page + '|' + o.group === g);
      if (grp[0].match === 'sex') {
        const byX = [...grp].sort((a, c) => a.x - c.x);
        grp.forEach(o => { const v = norm(o.bval); o.val = /^(m|h|homme|male|masc)/.test(v) ? 'M' : /^(f|femme|female|fem)/.test(v) ? 'F' : (byX.indexOf(o) === 0 ? 'M' : 'F'); });
      } else { const byY = [...grp].sort((a, c) => a.y - c.y); grp.forEach(o => o.val = byY.indexOf(o) === 0 ? 'P' : ''); }
    }
    // 4. seller / buyer from the field names (cerfa), unmarked fields take the section they sit in
    for (let pi = 0; pi < pagesInfo.length; pi++) {
      const onPage = fieldsAll.filter(o => o.page === pi);
      const buyers = onPage.filter(o => o.role === 'buyer' && o.match);
      if (!buyers.length) continue;
      const top = Math.min(...buyers.map(o => o.fy ?? o.y)) - 30;
      for (const o of onPage) if (!o.role) o.role = (o.fy ?? o.y) >= top ? 'buyer' : 'seller';
    }
    const hasStreetType = new Set(textFields.filter(o => o.match === 'streetType').map(o => o.page));
    for (const o of textFields) if (o.match === 'streetName' && hasStreetType.has(o.page)) o.part = 'nameOnly';
    computeSections();
  }

  /** one section per person: a new one starts when a value repeats, the role changes or a heading separates fields */
  function computeSections() {
    const SKIP = new Set(['today', 'hour', 'minute', 'signCity']);
    const IDENT = new Set(['lastName', 'firstName', 'fullName', 'sex', 'physical']);
    const list = objs.filter(o => o.field && o.match).sort((a, b) => a.page - b.page || Math.round(rowY(a) / 6) - Math.round(rowY(b) / 6) || a.x - b.x);
    sections = []; let cur = null;
    const headingBetween = (pg, y0, y1) => (pageText[pg]?.lines || []).some(l => l.cy > y0 + 2 && l.cy < y1 - 2 && l.text.length >= 12 &&
      !objs.some(o => o.field && o.page === pg && Math.abs(rowY(o) - l.cy) < 6));
    for (const o of list) {
      if (SKIP.has(o.match)) continue;
      const key = o.match + (o.part || '') + (o.match === 'sex' ? o.val : '');
      const top = o.fy ?? o.y;
      const brk = !cur || cur.keys.has(key) || (o.role && cur.role && o.role !== cur.role) ||
        (IDENT.has(o.match) && cur.n >= 3 && (o.page !== cur.page || headingBetween(o.page, cur.last, top)));
      if (brk) { cur = { id: sections.length, keys: new Set(), role: o.role || null, page: o.page, top, n: 0, last: top }; sections.push(cur); }
      cur.keys.add(key); cur.n++; cur.last = Math.max(cur.last, top + (o.fh ?? o.h)); cur.page = o.page;
      if (!cur.role && o.role) cur.role = o.role;
      o.section = cur.id;
    }
    // date / "done at" fields go to the section of the same role, else to the main (first) person of the page
    for (const o of list) {
      if (!SKIP.has(o.match)) continue;
      const cand = sections.filter(s => (o.role ? s.role === o.role : true) && list.some(x => x.section === s.id && x.page === o.page));
      o.section = (cand[0] || sections[0] || {}).id;
    }
    // titles and groups (the same person on a duplicate page = same group)
    sections.forEach((sct, i) => {
      const first = list.find(o => o.section === sct.id && !SKIP.has(o.match));
      let title = '';
      if (sct.role) title = t(sct.role === 'seller' ? 'roleA' : 'roleB');
      else if (first) {
        const lines = (pageText[first.page]?.lines || []).filter(l => l.cy < (first.fy ?? first.y) - 1 && l.cy > (first.fy ?? first.y) - 90 && l.text.length > 3 &&
          !objs.some(o => o.field && o.type === 'text' && o.page === first.page && Math.abs(rowY(o) - l.cy) < 6));
        const l = lines.sort((a, b) => b.cy - a.cy)[0];
        if (l) title = l.text.replace(/[:\s]+$/, '');
      }
      if (!title) title = `${t('profile')} ${i + 1}`;
      if (title.length > 48) title = title.slice(0, 46) + '…';
      sct.title = title; sct.group = sct.role || roleOf(title) || norm(title);
    });
  }

  async function readLabels() {
    for (let pi = 0; pi < pagesInfo.length; pi++) {
      const items = await pdfTextItems(pagesInfo[pi].page, pagesInfo[pi].vp);
      pageText[pi] = { items, lines: textLines(items), ocr: false };
      if (items.length) { attachLabels(objs.filter(o => o.field && o.page === pi), items); markAdmin(objs.filter(o => o.field && o.page === pi), pageText[pi].lines); }
    }
  }
  let ocrState = '', ocrPct = 0, ocrCancel = null;
  async function runOcr() {
    const todo = pagesInfo.map((p, i) => i).filter(i => !pageText[i]?.items.length && objs.some(o => o.zone && o.page === i)).slice(0, 3);
    if (!todo.length) return;
    ocrState = 'run'; ocrPct = 0; showFieldsBanner();
    let cancelled = false;
    ocrCancel = () => { cancelled = true; };
    try {
      for (const pi of todo) {
        if (cancelled) break;
        const masks = objs.filter(o => o.zone && o.page === pi).map(o => ({ x: o.x, y: o.fy, w: o.fw, h: o.fh }));
        const items = await Promise.race([
          ocrTextItems(pagesInfo[pi].page, masks, (p) => { ocrPct = Math.round(((todo.indexOf(pi) + p) / todo.length) * 100); updateOcrBanner(); }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 45000)),
          new Promise((_, rej) => { const iv = setInterval(() => { if (cancelled) { clearInterval(iv); rej(new Error('cancel')); } }, 300); })
        ]);
        pageText[pi] = { items, lines: textLines(items), ocr: true };
        attachLabels(objs.filter(o => o.field && o.page === pi), items);
        markAdmin(objs.filter(o => o.field && o.page === pi), pageText[pi].lines);
      }
      analyze();
    } catch (e) { console.warn('ocr', e); resetOcr(); if (e.message === 'timeout') toast(t('ocrFail')); }
    ocrState = ''; ocrCancel = null; showFieldsBanner();
  }
  function updateOcrBanner() { const s2 = banner.querySelector('.ocr-pct'); if (s2) s2.textContent = ocrPct ? ` ${ocrPct} %` : ''; }
  if (!initialObjs) { await readLabels(); analyze(); }
  else computeSectionsSafe();
  function computeSectionsSafe() { try { computeSections(); } catch { } }

  // ---------- helpers ----------
  const snap = () => { undoStack.push(JSON.stringify(objs)); if (undoStack.length > 40) undoStack.shift(); dirty = true; };
  const pad = (n) => String(n).padStart(2, '0');
  function dateParts(key) {
    if (key === 'today') return new Date();
    if (key === 'birthDate' && profile.birthDate) return new Date(profile.birthDate + 'T12:00:00');
    return null;
  }
  function streetOnly() {
    let s = (profile.streetName || '').trim();
    const num = (profile.streetNumber || '').trim();
    if (num && s.toLowerCase().startsWith(num.toLowerCase() + ' ')) s = s.slice(num.length).trim();
    return s;
  }
  function splitStreet() {
    const sname = streetOnly();
    const m = sname.match(STREET_TYPES);
    return m ? { type: m[1], name: sname.slice(m[0].length) } : { type: '', name: sname };
  }
  function profValFor(P, key, o) { const keep = profile; profile = P; try { return profVal(key, o); } finally { profile = keep; } }
  function profVal(key, o) {
    const part = o && o.part;
    if (key === 'signCity') return profile.city || '';
    if (key === 'today' || key === 'birthDate') {
      const d = dateParts(key); if (!d) return '';
      const dd = pad(d.getDate()), mm = pad(d.getMonth() + 1), yy = String(d.getFullYear());
      if (part === 'd') return dd; if (part === 'm') return mm; if (part === 'y') return yy;
      if (part === 'dm') return dd + mm; if (part === 'my') return mm + yy;
      if (o && o.comb === 8) return dd + mm + yy;
      if (o && o.comb === 10) return `${dd}/${mm}/${yy}`;
      return fmtDate(d);
    }
    if (key === 'hour') return pad(new Date().getHours());
    if (key === 'minute') return pad(new Date().getMinutes());
    if (key === 'fullName') return [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    if (key === 'streetType') return splitStreet().type;
    if (key === 'streetName' && part === 'nameOnly') return splitStreet().name;
    if (key === 'streetName') return streetOnly();
    if (key === 'fullAddress') {
      const l1 = [profile.streetNumber, profile.streetName].filter(Boolean).join(' ');
      const l2 = [profile.postalCode, profile.city].filter(Boolean).join(' ');
      return [l1, profile.addressExtra, l2, profile.country].filter(Boolean).join(', ');
    }
    return profile[key] || '';
  }

  /** shrink font so the value fits in its form field */
  function fit(o) {
    if (!o.field || o.type !== 'text') return;
    const base = o.baseFs || o.fontSize;
    if (o.comb) {
      o.fontSize = Math.max(5, Math.min(base, (o.fw / o.comb) * 1.05, o.fh * 0.72));
    } else if (!o.multiline) {
      const w1 = textWidth(o.text || '', 1);
      o.fontSize = w1 > 0 ? Math.max(4, Math.min(base, (o.fw - 3) / w1)) : base;
    }
    o.y = o.fy + (o.multiline ? 1 : Math.max(0, (o.fh - o.fontSize * 1.2) / 2));
  }

  let autoWarned = 0;
  function showFieldsBanner() {
    if (viewing) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden', 'warn');
    if (autoWarned) {
      banner.classList.add('warn');
      banner.innerHTML = `<span>⚠️ <b>${t('filled', { n: autoWarned })}</b> · ${t('autoWarn')}</span><button class="icon-btn x">${ICON.cross}</button>`;
      banner.querySelector('.x').onclick = () => { autoWarned = 0; showFieldsBanner(); };
      return;
    }
    const real = objs.filter(o => o.field && !o.zone).length, zn = objs.filter(o => o.zone).length;
    if (!real && !zn) { banner.classList.add('hidden'); return; }
    const txt = ocrState === 'run' ? `<span class="spin-s"></span>${t('ocrRunning')}<span class="ocr-pct"></span>` : real ? t('fieldsFound', { n: real }) : t('zonesFound', { n: zn });
    banner.innerHTML = `<span>${txt}</span>${ocrState === 'run' ? `<button class="icon-btn x">${ICON.cross}</button>` : `<button class="btn small primary af">${ICON.magic}<span>${t('autofill')}</span></button>`}`;
    const af = banner.querySelector('.af'); if (af) af.onclick = autofill;
    const x = banner.querySelector('.x'); if (x && ocrState === 'run') x.onclick = () => { if (ocrCancel) ocrCancel(); };
    updateOcrBanner();
  }
  showFieldsBanner();

  /** one profile per person section ("seller" / "buyer", "host" / "guest"…) */
  function autofill() {
    commitEdit();
    const groups = []; for (const sct of sections) if (!groups.find(g => g.group === sct.group)) groups.push(sct);
    if (groups.length <= 1) return doAutofill({ [groups[0]?.group]: profile });
    const selfIdx = Math.max(0, groups.findIndex(g => g.group === 'self'));
    const choice = {}; groups.forEach((g, i) => choice[g.group] = i === selfIdx ? profile.id : '');
    const label = (id) => id ? esc(pn(profiles.find(p => p.id === id))) : t('skipSection');
    const m = modal(`<h2>${t('autofillTitle')}</h2><div class="sec-list">${groups.map(g => `
      <div class="sec" data-g="${esc(g.group)}"><b>${esc(g.title)}</b>
        <button class="dd" data-g="${esc(g.group)}"><span>${label(choice[g.group])}</span><svg viewBox="0 0 24 24" class="ic"><path d="M7 10l5 5 5-5"/></svg></button></div>`).join('')}</div>
      <p class="muted small">⚠️ ${t('autoWarn')}</p>
      <div class="row end gap"><button class="btn ghost c">${t('cancel')}</button><button class="btn primary go">${ICON.magic}<span>${t('fill')}</span></button></div>`, 'sheet');
    m.el.querySelectorAll('.dd').forEach(btn => btn.onclick = (e) => {
      e.stopPropagation();
      m.el.querySelectorAll('.dd-menu').forEach(x => x.remove());
      const menu = document.createElement('div'); menu.className = 'dd-menu';
      menu.innerHTML = [...profiles.map(p => [p.id, esc(pn(p))]), ['', t('skipSection')]]
        .map(([id, l]) => `<button data-p="${id}" class="${choice[btn.dataset.g] === id ? 'on' : ''}">${l}</button>`).join('');
      btn.after(menu); menu.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      menu.querySelectorAll('button').forEach(o => o.onclick = (ev) => {
        ev.stopPropagation(); choice[btn.dataset.g] = o.dataset.p; btn.querySelector('span').innerHTML = label(o.dataset.p); menu.remove();
      });
    });
    m.el.addEventListener('click', () => m.el.querySelectorAll('.dd-menu').forEach(x => x.remove()));
    m.el.querySelector('.c').onclick = m.close;
    m.el.querySelector('.go').onclick = () => {
      m.close();
      const map = {}; for (const g in choice) map[g] = profiles.find(p => p.id === choice[g]) || null;
      doAutofill(map);
    };
  }
  function doAutofill(map) {
    snap(); let n = 0;
    const single = Object.keys(map).length === 1 ? Object.values(map)[0] : null;
    for (const o of objs) {
      if (!o.field || !o.match) continue;
      const sct = sections[o.section];
      const P = sct ? map[sct.group] : (single || profile);
      if (!P) continue;
      if (o.type === 'text' && !o.text) {
        const v = profValFor(P, o.match, o);
        if (v) { o.text = o.maxLen ? v.slice(0, o.maxLen) : v; o.bind = o.match; o.bindSec = true; o.color = color; fit(o); n++; }
      }
      if (o.type === 'check' && o.val !== undefined) {
        const want = o.match === 'sex' ? (P.sex && o.val === P.sex) : o.val === 'P';
        if (want && !o.on) { setRadio(o, true); o.color = color; n++; }
      }
    }
    autoWarned = n; showFieldsBanner(); renderObjs();
    if (!n) toast(t('filled', { n }));
  }

  // ---------- page rendering ----------
  let renderToken = 0, lastWidth = 0;
  function sizePages() {
    const avail = Math.min(scrollEl.clientWidth - 24, 1000);
    lastWidth = scrollEl.clientWidth;
    for (const p of pagesInfo) {
      const w = Math.max(200, avail * zoom);
      p.s = w / p.vp.width;
      p.el.style.width = w + 'px'; p.el.style.height = p.vp.height * p.s + 'px';
    }
  }
  async function layoutPages() {
    commitEdit();
    const token = ++renderToken;
    sizePages();
    renderObjs();
    for (const p of pagesInfo) {
      if (token !== renderToken) return;
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      let scale = p.s * dpr;
      if (p.vp.width * scale > 4096) scale = 4096 / p.vp.width;
      if (p.vp.width * scale * p.vp.height * scale > 16e6) scale = Math.sqrt(16e6 / (p.vp.width * p.vp.height));
      const vp = p.page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      try { await p.page.render({ canvasContext: c.getContext('2d'), viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS }).promise; } catch { }
      if (token !== renderToken) return;
      p.canvas.replaceWith(c); p.canvas = c;
    }
  }

  // ---------- objects rendering ----------
  const markPath = (m) => m === 'cross' ? 'M20 20L80 80M80 20L20 80' : 'M18 52L42 78L84 22';
  function objHtml(o, s) {
    if (o.type === 'text') return `<div class="tx" dir="auto" style="font-size:${o.fontSize * s}px;color:${o.color}">${esc(o.text)}</div>`;
    if (o.type === 'check' || o.type === 'cross') {
      const m = o.type === 'cross' ? 'cross' : o.mark;
      return (o.field && !o.on) ? '' : `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${markPath(m)}" stroke="${o.color}" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (o.type === 'strike') return `<div class="stk" style="height:${Math.max(1, (o.lw || 1.6) * s)}px;background:${o.color}"></div>`;
    if (o.type === 'image') return `<img src="${o.src}" draggable="false">`;
    if (o.type === 'ink') return `<svg viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none">${o.strokes.map(st => `<polyline points="${st.map(p => p.join(',')).join(' ')}" stroke="${o.color}" stroke-width="${o.lw || 2}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
    return '';
  }

  function renderObjs() {
    for (const p of pagesInfo) p.layer.innerHTML = '';
    for (const o of objs) {
      const p = pagesInfo[o.page]; if (!p) continue;
      const s = p.s;
      const el = document.createElement('div');
      el.className = `obj ${o.type}${o.field ? ' field' : ''}${o.zone ? ' zone' : ''}${sel === o ? ' sel' : ''}`;
      el.dataset.id = o.id;
      if (o.type === 'text' && o.field) {
        Object.assign(el.style, { left: o.x * s + 'px', top: o.fy * s + 'px', width: o.fw * s + 'px', height: o.fh * s + 'px' });
        if (o.comb) {
          const cw = o.fw / o.comb;
          el.innerHTML = `<div class="comb" style="font-size:${o.fontSize * s}px;color:${o.color};padding-top:${(o.y - o.fy) * s}px">${[...(o.text || '')].slice(0, o.comb).map(c => `<span style="width:${cw * s}px">${esc(c)}</span>`).join('')}</div>`;
        } else el.innerHTML = `<div class="tx" dir="auto" style="font-size:${o.fontSize * s}px;color:${o.color};padding-top:${(o.y - o.fy) * s}px">${esc(o.text)}</div>`;
      } else {
        Object.assign(el.style, { left: o.x * s + 'px', top: o.y * s + 'px' });
        if (o.type !== 'text') Object.assign(el.style, { width: o.w * s + 'px', height: o.h * s + 'px' });
        el.innerHTML = objHtml(o, s);
      }
      if (sel === o && !o.field) el.insertAdjacentHTML('beforeend', '<div class="handle"></div>');
      p.layer.appendChild(el);
      if (o.type === 'text' && !o.field) { o.w = el.offsetWidth / s; o.h = el.offsetHeight / s; }
    }
    renderSelbar();
  }

  function scaleObj(o, k) {
    if (o.type === 'text') { o.fontSize = Math.max(4, Math.min(96, o.fontSize * k)); if (o.field) { o.baseFs = o.fontSize; o.y = o.fy + Math.max(0, (o.fh - o.fontSize * 1.2) / 2); } return; }
    if (o.field) return;
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    if (o.type === 'strike') { o.w = Math.max(8, o.w * k); }
    else {
      if (o.type === 'ink') { o.strokes = o.strokes.map(s => s.map(([a, c]) => [a * k, c * k])); o.lw = (o.lw || 2) * k; }
      o.w *= k; o.h *= k;
    }
    o.x = cx - o.w / 2; if (o.type !== 'strike') o.y = cy - o.h / 2;
  }

  function renderSelbar() {
    if (editing) {
      // suggestions from the current profile while typing
      const o = editing.o;
      const keys = [o.match, ...INSERT_KEYS].filter((k, i, a) => k && a.indexOf(k) === i);
      const mem = (memory[memKey(o)] || []).map(v => ({ k: 'mem', v }));
      const chips = [...mem, ...keys.map(k => ({ k, v: profVal(k, k === o.match ? o : null) }))].filter((c, i, a) => c.v && a.findIndex(x => x.v === c.v) === i);
      selbar.classList.remove('hidden');
      selbar.innerHTML = chips.map(c => `<button class="chip-s" data-k="${c.k}" title="${esc(t(c.k))}">${esc(c.v)}</button>`).join('') +
        `<span class="sep"></span><button class="icon-btn ok-b">${ICON.done}</button>`;
      selbar.querySelectorAll('button').forEach(bt => bt.addEventListener('pointerdown', e => e.preventDefault()));
      selbar.querySelectorAll('.chip-s').forEach(bt => bt.onclick = () => {
        const k = bt.dataset.k;
        if (k === 'mem') { editing.ta.value = bt.textContent; delete o.bind; commitEdit(); return; }
        editing.ta.value = profVal(k, k === o.match ? o : null); o.bind = k; commitEdit(true);
      });
      selbar.querySelector('.ok-b').onclick = () => commitEdit();
      return;
    }
    if (!sel) { selbar.classList.add('hidden'); return; }
    selbar.classList.remove('hidden');
    const canScale = !(sel.field && sel.type === 'check');
    selbar.innerHTML = `
      ${SWATCHES.map(c => `<button class="sw${c === sel.color ? ' on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}
      <span class="sep"></span>
      ${canScale ? `<button class="icon-btn sm">${ICON.minus}</button><button class="icon-btn sp">${ICON.plus}</button>` : ''}
      ${sel.type === 'text' ? `<button class="icon-btn ed">${ICON.edit}</button>` : ''}
      ${sel.type === 'strike' || sel.type === 'ink' ? `<button class="icon-btn lp" title="${t('thickness')}">${ICON.thick}</button>` : ''}
      ${!sel.field ? `<button class="icon-btn dup">${ICON.copy}</button>` : ''}
      <button class="icon-btn del">${ICON.trash}</button>
      <button class="icon-btn ok-b">${ICON.done}</button>`;
    selbar.querySelectorAll('.sw').forEach(b => b.onclick = () => setObjColor(sel, b.dataset.c));
    const on = (c, f) => { const e = selbar.querySelector(c); if (e) e.onclick = f; };
    on('.sm', () => { snap(); scaleObj(sel, 1 / 1.15); renderObjs(); });
    on('.sp', () => { snap(); scaleObj(sel, 1.15); renderObjs(); });
    on('.lp', () => { snap(); const d = sel.type === 'ink' ? 2 : 1.6; sel.lw = ((sel.lw || d) >= 5 ? 0.8 : (sel.lw || d) + 0.8); renderObjs(); });
    on('.ed', () => startEdit(sel));
    on('.dup', () => { snap(); const c = JSON.parse(JSON.stringify(sel)); c.id = uid(); c.x += 10; c.y += 10; objs.push(c); sel = c; renderObjs(); });
    on('.del', () => {
      snap();
      if (sel.field) { if (sel.type === 'text') { sel.text = ''; delete sel.bind; fit(sel); } else sel.on = false; }
      else objs = objs.filter(o => o !== sel);
      sel = null; renderObjs();
    });
    on('.ok-b', () => { sel = null; renderObjs(); });
  }

  function setRadio(o, on) {
    if (on && o.radio) objs.forEach(x => { if (x !== o && x.radio && x.group === o.group && x.page === o.page) x.on = false; });
    o.on = on;
  }
  async function setObjColor(o, c) {
    snap(); o.color = c; color = c; syncColorInput();
    if (o.type === 'image') { o.src = await tint(o.orig || o.src, c); o.tinted = true; }
    renderObjs();
  }
  function syncColorInput() { $('.col').value = color; $('.color-dot span').style.background = color; }

  // ---------- text editing (real textarea: reliable keyboard on phones) ----------
  function startEdit(o) {
    commitEdit();
    const p = pagesInfo[o.page], s = p.s;
    const objEl = p.layer.querySelector(`[data-id="${o.id}"]`);
    if (objEl) objEl.style.visibility = 'hidden';
    const ta = document.createElement('textarea');
    ta.className = 'ed-input'; ta.value = o.text || ''; ta.dir = 'auto'; ta.rows = 1;
    ta.setAttribute('autocomplete', 'off'); ta.setAttribute('spellcheck', 'false');
    if (o.maxLen) ta.maxLength = o.maxLen;
    const top = (o.field ? o.fy : o.y) * s;
    Object.assign(ta.style, {
      left: o.x * s + 'px', top: top + 'px', fontSize: Math.max(o.fontSize * s, 14) + 'px', color: o.color,
      width: (o.field ? Math.max(o.fw * s, 80) : Math.max((o.w || 0) * s + 30, 140)) + 'px'
    });
    p.layer.appendChild(ta);
    const autosize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    autosize();
    editing = { o, ta, before: JSON.stringify(objs) };
    ta.addEventListener('input', autosize);
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (o.field && !o.multiline)) { e.preventDefault(); commitEdit(); } });
    ta.addEventListener('blur', () => setTimeout(() => { if (editing && editing.ta === ta && document.activeElement !== ta) commitEdit(); }, 150));
    root.querySelector('.editor').classList.add('typing');
    ta.focus({ preventScroll: true });
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch { }
    setTimeout(() => ta.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350);
    sel = o;
    renderSelbar();
  }
  function memKey(o) { return o.field && !o.zone ? norm(String(o.field).split('.').pop().replace(/\[\d+\]/g, '')) : ''; }
  function commitEdit(fromChip) {
    if (!editing) return;
    const { o, ta, before } = editing;
    editing = null;
    root.querySelector('.editor').classList.remove('typing');
    o.text = ta.value.replace(/\r/g, '');
    // remember values typed in fields that the profile cannot fill (plate, car brand…)
    if (o.field && !o.zone && !o.match && o.text.trim()) { const k = memKey(o); memory[k] = [o.text, ...(memory[k] || []).filter(v => v !== o.text)].slice(0, 5); remember(k, o.text); }
    if (!fromChip && o.bind && o.text !== profVal(o.bind, o)) delete o.bind;
    if (o.field) fit(o);
    ta.remove();
    if (JSON.stringify(objs) !== before) { undoStack.push(before); dirty = true; }
    if (!o.field && !o.text.trim()) { objs = objs.filter(x => x !== o); sel = null; }
    if (o.field) sel = null;
    renderObjs();
  }

  // ---------- placing ----------
  function setHint(msg) {
    if (!msg) return showFieldsBanner();
    banner.classList.remove('hidden', 'warn'); banner.innerHTML = `<span>${esc(msg)}</span><button class="icon-btn x">${ICON.cross}</button>`;
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

  function boxAt(pi, x, y, tol = 3) {
    return pagesInfo[pi].boxes.find(bx => x >= bx.x - tol && x <= bx.x + bx.w + tol && y >= bx.y - tol && y <= bx.y + bx.h + tol);
  }
  /** tick or cross inside a detected square: toggles it */
  function markBox(pi, bx, mark) {
    snap();
    const ex = objs.find(o => o.box && o.page === pi && Math.abs(o.box.x - bx.x) < .5 && Math.abs(o.box.y - bx.y) < .5);
    if (ex) { objs = objs.filter(o => o !== ex); if (ex.type === mark) { sel = null; renderObjs(); return; } }
    const inset = bx.w * 0.08;
    objs.push({ id: uid(), page: pi, type: mark, x: bx.x + inset, y: bx.y + inset, w: bx.w - 2 * inset, h: bx.h - 2 * inset, color, box: { x: bx.x, y: bx.y } });
    sel = null; renderObjs();
  }

  async function place(pi, x, y) {
    const base = { id: uid(), page: pi, color };
    let o;
    if (tool === 'text' || tool === 'date' || tool === 'insert') {
      const text = tool === 'text' ? '' : tool === 'date' ? profVal('today') : profVal(pending);
      o = { ...base, type: 'text', x, y: y - 7, fontSize: 11, text, bind: tool === 'insert' ? pending : undefined };
    } else if (tool === 'check' || tool === 'cross') {
      const bx = boxAt(pi, x, y);
      if (bx) { markBox(pi, bx, tool); return; }
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
    if (!(tool === 'check' || tool === 'cross')) setTool(null);
    renderObjs();
    if (o.type === 'text' && !o.text) startEdit(o);
  }

  /** which page is under a screen point */
  function pageAtPoint(cx, cy) {
    for (let i = 0; i < pagesInfo.length; i++) {
      const r = pagesInfo[i].el.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return i;
    }
    return -1;
  }

  // ---------- pointer interactions ----------
  pagesEl.addEventListener('pointerdown', (e) => {
    if (pinching || viewing) return;
    if (e.target.classList.contains('ed-input')) return; // typing / moving the caret
    const pEl = e.target.closest('.page'); if (!pEl) return;
    const pi = pagesInfo.findIndex(p => p.el === pEl); const p = pagesInfo[pi];
    const rect = p.layer.getBoundingClientRect();
    const toVp = (ev) => [(ev.clientX - rect.left) / p.s, (ev.clientY - rect.top) / p.s];
    const wasEditing = !!editing;

    if (tool === 'pen') {
      e.preventDefault(); commitEdit();
      pEl.setPointerCapture(e.pointerId);
      const pts = [toVp(e)];
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('class', 'live-ink');
      svg.setAttribute('viewBox', `0 0 ${p.vp.width} ${p.vp.height}`);
      const pl = document.createElementNS(svgNS, 'polyline');
      pl.setAttribute('stroke', color); pl.setAttribute('stroke-width', '2'); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke-linecap', 'round'); pl.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(pl); p.layer.appendChild(svg);
      const mv = (ev) => { if (pinching) return; (ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]).forEach(c => pts.push(toVp(c))); pl.setAttribute('points', pts.map(q => q.join(',')).join(' ')); };
      const up = () => {
        pEl.removeEventListener('pointermove', mv); pEl.removeEventListener('pointerup', up); pEl.removeEventListener('pointercancel', up);
        svg.remove();
        if (pinching) return;
        if (pts.length < 2) pts.push([pts[0][0] + 0.5, pts[0][1] + 0.5]);
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
        const x0 = Math.min(...xs) - 2, y0 = Math.min(...ys) - 2;
        const w = Math.max(...xs) - x0 + 2, h = Math.max(...ys) - y0 + 2;
        snap();
        objs.push({ id: uid(), page: pi, type: 'ink', x: x0, y: y0, w, h, color, lw: 2, strokes: [pts.map(q => [+(q[0] - x0).toFixed(2), +(q[1] - y0).toFixed(2)])] });
        renderObjs();
      };
      pEl.addEventListener('pointermove', mv); pEl.addEventListener('pointerup', up); pEl.addEventListener('pointercancel', up);
      return;
    }

    const oEl = e.target.closest('.obj');
    if (oEl) {
      const o = objs.find(x => x.id === oEl.dataset.id); if (!o) return;
      e.preventDefault();
      if (o.field && o.type === 'check') {
        commitEdit(); snap();
        const mark = tool === 'cross' ? 'cross' : 'check';
        if (o.on && o.mark === mark) o.on = false; else { setRadio(o, true); o.mark = mark; o.color = color; }
        sel = null; renderObjs(); return;
      }
      if (o.field && o.type === 'text') { startEdit(o); return; }
      commitEdit();
      const wasSel = sel === o;
      const isHandle = e.target.classList.contains('handle');
      sel = o; if (!wasSel || wasEditing) renderObjs();
      const el = p.layer.querySelector(`[data-id="${o.id}"]`);
      const start = [e.clientX, e.clientY], o0 = { x: o.x, y: o.y, w: o.w, h: o.h, fontSize: o.fontSize };
      const before = JSON.stringify(objs);
      let moved = false;
      el.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        if (pinching) return;
        const dx = (ev.clientX - start[0]) / p.s, dy = (ev.clientY - start[1]) / p.s;
        if (!moved && Math.hypot(dx, dy) * p.s < 4) return;
        moved = true;
        if (isHandle) {
          if (o.type === 'text') { o.fontSize = Math.max(4, Math.min(96, o0.fontSize * (o0.w + dx) / o0.w)); el.querySelector('.tx').style.fontSize = o.fontSize * p.s + 'px'; }
          else if (o.type === 'strike') { o.w = Math.max(8, o0.w + dx); el.style.width = o.w * p.s + 'px'; }
          else {
            const k = Math.max(0.1, (o0.w + dx) / o0.w);
            o.w = o0.w * k; o.h = o0.h * k;
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
          if (isHandle && o.type === 'ink') { const kx = o.w / o0.w; o.strokes = o.strokes.map(s => s.map(([a, c]) => [a * kx, c * kx])); o.lw = (o.lw || 2) * kx; }
          if (!isHandle) {
            // dropped on another page: move it there
            const r = el.getBoundingClientRect();
            const np = pageAtPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (np >= 0 && np !== o.page) {
              const q = pagesInfo[np], qr = q.layer.getBoundingClientRect();
              o.page = np; o.x = (r.left - qr.left) / q.s; o.y = (r.top - qr.top) / q.s;
              if (o.type !== 'text') { o.w = r.width / q.s; o.h = r.height / q.s; }
              delete o.box;
            }
          }
          undoStack.push(before); dirty = true; renderObjs();
        } else if (wasSel && o.type === 'text') startEdit(o);
        else renderSelbar();
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      return;
    }

    if (wasEditing) { e.preventDefault(); commitEdit(); return; }
    const [x, y] = toVp(e);
    if (tool) { e.preventDefault(); place(pi, x, y); return; }
    const bx = boxAt(pi, x, y, 1);
    if (bx) { e.preventDefault(); markBox(pi, bx, 'check'); return; }
    if (sel) { sel = null; renderObjs(); }
  });

  // ---------- pinch to zoom ----------
  let pz = null;
  const dist = (t1, t2) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  scrollEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    pinching = true; commitEdit();
    const [a, c] = e.touches; const r = scrollEl.getBoundingClientRect();
    const mx = (a.clientX + c.clientX) / 2 - r.left, my = (a.clientY + c.clientY) / 2 - r.top;
    pz = { d0: dist(a, c), z0: zoom, k: 1, mx, my, cx: scrollEl.scrollLeft + mx, cy: scrollEl.scrollTop + my };
    pagesEl.style.transformOrigin = `${pz.cx}px ${pz.cy}px`;
  }, { passive: true });
  scrollEl.addEventListener('touchmove', (e) => {
    if (!pz || e.touches.length !== 2) return;
    e.preventDefault();
    const k = Math.max(0.5 / pz.z0, Math.min(4 / pz.z0, dist(e.touches[0], e.touches[1]) / pz.d0));
    pz.k = k; pagesEl.style.transform = `scale(${k})`;
  }, { passive: false });
  const endPinch = () => {
    if (!pz) { pinching = false; return; }
    const { k, z0, cx, cy, mx, my } = pz; pz = null;
    pagesEl.style.transform = ''; pagesEl.style.transformOrigin = '';
    const oldW = pagesEl.scrollWidth, oldH = pagesEl.scrollHeight;
    zoom = z0 * k;
    layoutPages();
    const fx = pagesEl.scrollWidth / oldW, fy = pagesEl.scrollHeight / oldH;
    scrollEl.scrollLeft = cx * fx - mx; scrollEl.scrollTop = cy * fy - my;
    setTimeout(() => { pinching = false; }, 50);
  };
  scrollEl.addEventListener('touchend', (e) => { if (e.touches.length < 2) endPinch(); });
  scrollEl.addEventListener('touchcancel', endPinch);
  const noGesture = (e) => e.preventDefault();
  document.addEventListener('gesturestart', noGesture);

  // ---------- toolbar ----------
  root.querySelectorAll('.tool[data-tool]').forEach(btn => btn.onclick = async () => {
    commitEdit();
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
      const m = modal(`<h2>${t('insert')} · ${esc(profile.name || '')}</h2><div class="list">${INSERT_KEYS.map(key => {
        const v = profVal(key);
        return `<button class="list-item" data-k="${key}" ${v ? '' : 'disabled'}><b>${t(key)}</b><span>${esc(v) || '—'}</span></button>`;
      }).join('')}</div><div class="row end"><button class="btn ghost c">${t('close')}</button></div>`, 'sheet');
      m.el.querySelector('.c').onclick = m.close;
      m.el.querySelectorAll('.list-item').forEach(li => li.onclick = () => {
        m.close();
        const key = li.dataset.k;
        if (sel && sel.type === 'text' && sel.field) { snap(); sel.text = profVal(key, sel); sel.bind = key; fit(sel); renderObjs(); return; }
        setTool('insert', key);
      });
      return;
    }
    setTool(k);
  });
  $('.undo').onclick = () => { commitEdit(); const s = undoStack.pop(); if (s) { objs = JSON.parse(s); sel = null; renderObjs(); } };
  const zoomBy = (f) => { const c = scrollEl.scrollTop / Math.max(1, pagesEl.scrollHeight); zoom = Math.max(0.5, Math.min(4, zoom * f)); layoutPages(); scrollEl.scrollTop = c * pagesEl.scrollHeight; };
  $('.zin').onclick = () => zoomBy(1.25);
  $('.zout').onclick = () => zoomBy(1 / 1.25);

  $('.col').oninput = (e) => {
    color = e.target.value; syncColorInput();
    if (sel) setObjColor(sel, color);
  };

  $('.prof-btn').onclick = async () => {
    commitEdit();
    if (!chooseProfile) return;
    const id = await chooseProfile(profile.id);
    if (id && id !== profile.id) switchProfile(id);
  };
  async function switchProfile(id) {
    profile = profiles.find(p => p.id === id) || profile;
    $('.prof-btn span').textContent = pn(profile);
    color = profile.color || color; syncColorInput();
    let changed = false;
    for (const o of objs) {
      if (!o.bind || o.bindSec) continue;
      if (o.type === 'text') { o.text = profVal(o.bind, o); fit(o); changed = true; }
      if (o.type === 'image' && profile[o.bind]) {
        const { h } = await imageSize(profile[o.bind], o.w);
        o.orig = profile[o.bind]; o.src = o.tinted ? await tint(o.orig, o.color) : o.orig; o.h = h; changed = true;
      }
    }
    if (changed) renderObjs();
    toast(`${t('profile')} : ${profile.name || t('unnamed')}`);
  };

  // keep the suggestion bar above the on-screen keyboard
  const edEl = root.querySelector('.editor');
  const setKb = (h) => { edEl.style.paddingBottom = h > 0 ? h + 'px' : ''; if (editing) setTimeout(() => editing && editing.ta.scrollIntoView({ block: 'center' }), 50); };
  const kbListeners = [];
  const h0 = window.innerHeight;
  if (Capacitor.isNativePlatform()) {
    import('@capacitor/keyboard').then(async ({ Keyboard }) => {
      kbListeners.push(await Keyboard.addListener('keyboardDidShow', (info) => setKb(window.innerHeight < h0 - 80 ? 0 : info.keyboardHeight)));
      kbListeners.push(await Keyboard.addListener('keyboardWillHide', () => setKb(0)));
    }).catch(() => { });
  } else if (window.visualViewport) {
    const vvf = () => { const gap = window.innerHeight - visualViewport.height - visualViewport.offsetTop; setKb(gap > 80 ? gap : 0); };
    visualViewport.addEventListener('resize', vvf); kbListeners.push({ remove: () => visualViewport.removeEventListener('resize', vvf) });
  }
  const cleanup = () => { window.removeEventListener('resize', onResize); document.removeEventListener('gesturestart', noGesture); kbListeners.forEach(l => { try { l.remove(); } catch { } }); };
  $('.back').onclick = async () => {
    commitEdit();
    if (dirty && !(await confirmBox(t('discard'), t('home'), t('cancel')))) return;
    cleanup(); onExit();
  };

  // ---------- save ----------
  $('.finish').onclick = async () => {
    commitEdit();
    sel = null; renderObjs();
    const base = name.replace(/\.(pdf|docx|png|jpe?g|webp|heic)$/i, '');
    const m = modal(`<h2>${t('save')}</h2>
      <label class="field-l">${t('fileName')}<div class="name-row"><input class="fname" value="${esc(base)}"><span>.pdf</span></div></label>
      <div class="row end gap"><button class="btn ghost c">${t('cancel')}</button><button class="btn primary s">${ICON.save}<span>${t('save')}</span></button></div>`, 'sheet');
    m.el.querySelector('.c').onclick = m.close;
    m.el.querySelector('.fname').select();
    m.el.querySelector('.s').onclick = async () => {
      const fname = (m.el.querySelector('.fname').value.trim() || base) + '.pdf';
      m.close();
      const bz = busy(t('exporting'));
      let out;
      try {
        out = await exportPdf(bytes, objs, pagesInfo.map(p => ({ vp: p.vp, rotate: p.rotate })));
        const meta = await saveDoc(fname, out, docId, { src: bytes, objs: JSON.parse(JSON.stringify(objs)) });
        docId = meta.id;
      } catch (err) { console.error(err); bz.close(); toast(t('err') + ' (' + err.message + ')'); return; }
      bz.close(); dirty = false;
      if (onSaved) await onSaved();
      const r = modal(`<div class="done-ic">${ICON.done}</div><h2>${t('saved')}</h2><p class="muted">${esc(fname)}</p>
        <div class="col gap">
          <button class="btn primary big sh">${ICON.share}<span>${t('share')}</span><small>${t('shareHint')}</small></button>
          <button class="btn ghost big dl">${ICON.download}<span>${t('saveToPhone')}</span></button>
          <button class="btn ghost hm">${t('home')}</button>
        </div>`, 'sheet center');
      r.el.querySelector('.sh').onclick = async () => { try { await shareFile(out, fname); } catch (e) { toast(e.message); } };
      r.el.querySelector('.dl').onclick = async () => { const where = await downloadPdf(out, fname); if (where) toast(t('downloaded') + ' : ' + where); };
      r.el.querySelector('.hm').onclick = () => { r.close(); cleanup(); onExit(); };
    };
  };

  // ---------- view mode ----------
  async function startEditing() {
    if (chooseProfile && profiles.length > 1) {
      const id = await chooseProfile(profile.id);
      if (!id) return;
      if (id !== profile.id) await switchProfile(id);
    }
    viewing = false; root.querySelector('.editor').classList.remove('viewing'); showFieldsBanner();
  }
  $('.start-edit').onclick = startEditing;
  const currentPdf = async () => (initialObjs && initialObjs.length) || objs.some(o => !o.field || o.text || o.on) ? exportPdf(bytes, objs, pagesInfo.map(p => ({ vp: p.vp, rotate: p.rotate }))) : bytes;
  $('.v-sh').onclick = async () => { try { await shareFile(await currentPdf(), name); } catch (e) { toast(e.message); } };
  $('.v-dl').onclick = async () => { const w = await downloadPdf(await currentPdf(), name); if (w) toast(t('downloaded') + ' : ' + w); };

  let rt; const onResize = () => {
    clearTimeout(rt);
    // the keyboard opening changes only the height: keep the text being typed
    rt = setTimeout(() => { if (scrollEl.clientWidth !== lastWidth) layoutPages(); }, 200);
  };
  window.addEventListener('resize', onResize);
  layoutPages();
  if (!initialObjs) setTimeout(runOcr, 300);
}
