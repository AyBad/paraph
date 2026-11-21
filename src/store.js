import { get, set, del } from 'idb-keyval';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export { uid };

export const PROFILE_FIELDS = ['lastName', 'firstName', 'birthDate', 'birthPlace', 'streetNumber', 'streetName', 'addressExtra', 'postalCode', 'city', 'country', 'email', 'phone'];

export function emptyProfile() {
  return {
    id: uid(), name: '', lastName: '', firstName: '', birthDate: '', birthPlace: '',
    streetNumber: '', streetName: '', addressExtra: '', postalCode: '', city: '', country: '',
    email: '', phone: '', sex: '', color: '#1a237e', signature: '', initials: ''
  };
}

export async function getProfiles() {
  let p = await get('profiles');
  if (!p || !p.length) {
    p = [Object.assign(emptyProfile(), { name: 'Moi' })];
    await set('profiles', p);
  }
  return p.map(migrate);
}

/** old profiles had a single free-text address */
function migrate(p) {
  if (p.address && !p.streetName && !p.postalCode && !p.city) {
    const m = p.address.match(/^\s*(\d+\s*(?:bis|ter|[a-z])?)[\s,]+(.*?)(?:[,\s]+(\d{4,5})\s+(.+))?\s*$/i);
    if (m) Object.assign(p, { streetNumber: m[1], streetName: m[2] || '', postalCode: m[3] || '', city: m[4] || '' });
    else p.streetName = p.address;
  }
  delete p.address;
  for (const k of PROFILE_FIELDS) if (p[k] == null) p[k] = '';
  if (p.sex == null) p.sex = '';
  return p;
}
export async function saveProfile(profile) {
  const list = await getProfiles();
  const i = list.findIndex(x => x.id === profile.id);
  if (i >= 0) list[i] = profile; else list.push(profile);
  await set('profiles', list);
  return list;
}
export async function deleteProfile(id) {
  let list = (await getProfiles()).filter(x => x.id !== id);
  await set('profiles', list);
  if ((await get('activeProfile')) === id) await del('activeProfile');
  return getProfiles();
}
export async function getActiveProfileId() { return get('activeProfile'); }
export async function setActiveProfileId(id) { return set('activeProfile', id); }

export async function getDocs() { return (await get('docs')) || []; }
export async function saveDoc(name, bytes, id, extra = {}) {
  const docs = await getDocs();
  id = id || uid();
  const meta = { id, name, date: Date.now(), size: bytes.length };
  if (extra.fmt) meta.fmt = extra.fmt;
  const i = docs.findIndex(d => d.id === id);
  if (i >= 0 && docs[i].folder) meta.folder = docs[i].folder;
  if (i >= 0) docs.splice(i, 1);
  docs.unshift(meta);
  await set('doc:' + id, bytes);
  // keep the original + editable objects so the document can be edited again later
  if (extra.src) await set('src:' + id, extra.src);
  if (extra.objs) await set('objs:' + id, extra.objs);
  await set('docs', docs);
  return meta;
}
export async function getDocBytes(id) { return get('doc:' + id); }
export async function getDocSource(id) { return { src: await get('src:' + id), objs: await get('objs:' + id) }; }
export async function deleteDoc(id) {
  await del('doc:' + id); await del('src:' + id); await del('objs:' + id);
  await set('docs', (await getDocs()).filter(d => d.id !== id));
}

/* ---- Pro (test mode: no real payment yet) ---- */
export async function getPro() { return (await get('pro')) || null; }
export async function setPro(v) { return v ? set('pro', v) : del('pro'); }

export async function getLang() { return get('lang'); }
export async function setLang(l) { return l ? set('lang', l) : del('lang'); }

export async function isOnboarded() { return !!(await get('onboarded')); }
export async function setOnboarded() { return set('onboarded', 1); }

function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

export async function exportBackup() {
  const docs = await getDocs();
  const files = {};
  const sources = {};
  for (const d of docs) {
    const b = await getDocBytes(d.id); if (b) files[d.id] = b64(b);
    const { src, objs } = await getDocSource(d.id);
    if (src) sources[d.id] = { src: b64(src), objs: objs || null };
  }
  return JSON.stringify({ app: 'paraph', v: 2, date: new Date().toISOString(), profiles: await getProfiles(), docs, files, sources });
}
export async function importBackup(text) {
  const data = JSON.parse(text);
  if (data.app !== 'paraph') throw new Error('format');
  const profiles = await getProfiles();
  for (const p of data.profiles || []) { const i = profiles.findIndex(x => x.id === p.id); if (i >= 0) profiles[i] = migrate(p); else profiles.push(migrate(p)); }
  await set('profiles', profiles);
  const docs = await getDocs();
  for (const d of data.docs || []) {
    if (!data.files[d.id]) continue;
    await set('doc:' + d.id, unb64(data.files[d.id]));
    const so = (data.sources || {})[d.id];
    if (so) { await set('src:' + d.id, unb64(so.src)); if (so.objs) await set('objs:' + d.id, so.objs); }
    if (!docs.find(x => x.id === d.id)) docs.push(d);
  }
  docs.sort((a, b) => b.date - a.date);
  await set('docs', docs);
}

/* ---- values typed in form fields, suggested again next time ---- */
export async function getMemory() { return (await get('memory')) || {}; }
export async function remember(key, value) {
  if (!key || !value) return;
  const m = await getMemory();
  m[key] = [value, ...(m[key] || []).filter(v => v !== value)].slice(0, 5);
  await set('memory', m);
}

/* ---- settings: theme, PIN lock ---- */
export async function getSetting(k, d) { const v = await get('set:' + k); return v === undefined ? d : v; }
export async function setSetting(k, v) { return v == null ? del('set:' + k) : set('set:' + k, v); }
export async function sha256(txt) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('paraph:' + txt));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function renameDoc(id, name) {
  const docs = await getDocs(); const d = docs.find(x => x.id === id); if (d) { d.name = name; await set('docs', docs); }
}
export async function moveDoc(id, folder) {
  const docs = await getDocs(); const d = docs.find(x => x.id === id); if (d) { d.folder = folder || ''; await set('docs', docs); }
}
