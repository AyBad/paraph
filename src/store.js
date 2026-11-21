import { get, set, del } from 'idb-keyval';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export { uid };

export const PROFILE_FIELDS = ['lastName', 'firstName', 'birthDate', 'birthPlace', 'address', 'email', 'phone'];

export function emptyProfile() {
  return {
    id: uid(), name: '', lastName: '', firstName: '', birthDate: '', birthPlace: '',
    address: '', email: '', phone: '', color: '#1a237e', signature: '', initials: ''
  };
}

export async function getProfiles() {
  let p = await get('profiles');
  if (!p || !p.length) {
    p = [Object.assign(emptyProfile(), { name: 'Moi' })];
    await set('profiles', p);
  }
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
