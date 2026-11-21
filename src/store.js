import { get, set, del } from 'idb-keyval';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export { uid };

export const PROFILE_FIELDS = ['lastName', 'firstName', 'birthDate', 'birthPlace', 'streetNumber', 'streetName', 'addressExtra', 'postalCode', 'city', 'country', 'email', 'phone'];

export function emptyProfile() {
  return {
    id: uid(), name: '', lastName: '', firstName: '', birthDate: '', birthPlace: '',
    streetNumber: '', streetName: '', addressExtra: '', postalCode: '', city: '', country: '',
    email: '', phone: '', color: '#1a237e', signature: '', initials: ''
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
export async function saveDoc(name, bytes, id) {
  const docs = await getDocs();
  id = id || uid();
  const meta = { id, name, date: Date.now(), size: bytes.length };
  const i = docs.findIndex(d => d.id === id);
  if (i >= 0) docs.splice(i, 1);
  docs.unshift(meta);
  await set('doc:' + id, bytes);
  await set('docs', docs);
  return meta;
}
export async function getDocBytes(id) { return get('doc:' + id); }
export async function deleteDoc(id) {
  await del('doc:' + id);
  await set('docs', (await getDocs()).filter(d => d.id !== id));
}

export async function getLang() { return get('lang'); }
export async function setLang(l) { return l ? set('lang', l) : del('lang'); }

export async function isOnboarded() { return !!(await get('onboarded')); }
export async function setOnboarded() { return set('onboarded', 1); }

function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

export async function exportBackup() {
  const docs = await getDocs();
  const files = {};
  for (const d of docs) { const b = await getDocBytes(d.id); if (b) files[d.id] = b64(b); }
  return JSON.stringify({ app: 'paraph', v: 1, date: new Date().toISOString(), profiles: await getProfiles(), docs, files });
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
    if (!docs.find(x => x.id === d.id)) docs.push(d);
  }
  docs.sort((a, b) => b.date - a.date);
  await set('docs', docs);
}
