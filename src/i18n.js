import en from './locales/en.js';

// code -> native name
export const LANGS = {
  en: 'English', fr: 'Français', de: 'Deutsch', es: 'Español', it: 'Italiano', pt: 'Português',
  nl: 'Nederlands', pl: 'Polski', ro: 'Română', cs: 'Čeština', sk: 'Slovenčina', sl: 'Slovenščina',
  hr: 'Hrvatski', hu: 'Magyar', bg: 'Български', el: 'Ελληνικά', sv: 'Svenska', da: 'Dansk',
  fi: 'Suomi', et: 'Eesti', lv: 'Latviešu', lt: 'Lietuvių', ga: 'Gaeilge', mt: 'Malti',
  no: 'Norsk', uk: 'Українська', tr: 'Türkçe', ru: 'Русский', ar: 'العربية', fa: 'فارسی',
  ur: 'اردو', hi: 'हिन्दी', bn: 'বাংলা', zh: '中文', ja: '日本語', ko: '한국어', th: 'ไทย',
  vi: 'Tiếng Việt', id: 'Bahasa Indonesia'
};
export const RTL = ['ar', 'fa', 'ur'];

const loaders = import.meta.glob('./locales/*.js');
let dict = en;
export let lang = 'en';

export function detectLang() {
  const list = navigator.languages || [navigator.language || 'en'];
  for (const l of list) {
    let c = (l || '').toLowerCase().split(/[-_]/)[0];
    if (c === 'nb' || c === 'nn') c = 'no';
    if (LANGS[c]) return c;
  }
  return 'en';
}

export async function setLanguage(code) {
  if (!LANGS[code]) code = 'en';
  lang = code;
  if (code === 'en') dict = en;
  else {
    try { dict = Object.assign({}, en, (await loaders[`./locales/${code}.js`]()).default); }
    catch { dict = en; }
  }
  document.documentElement.lang = code;
  document.documentElement.dir = RTL.includes(code) ? 'rtl' : 'ltr';
}

export function t(key, vars) {
  let s = dict[key] ?? en[key] ?? key;
  if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
  return s;
}

export function fmtDate(d) {
  try { return new Intl.DateTimeFormat(lang, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d); }
  catch { return d.toLocaleDateString(); }
}
