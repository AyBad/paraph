import { Capacitor, registerPlugin } from '@capacitor/core';
const SaveAs = registerPlugin('SaveAs');

const native = () => Capacitor.isNativePlatform();

function toBase64(bytes) {
  let s = ''; const ch = 0x8000;
  for (let i = 0; i < bytes.length; i += ch) s += String.fromCharCode.apply(null, bytes.subarray(i, i + ch));
  return btoa(s);
}

const extOf = (mime) => mime === 'application/json' ? '.json' : /wordprocessing/.test(mime) ? '.docx' : mime === 'image/jpeg' ? '.jpg' : '.pdf';
export const safeName = (n, mime = 'application/pdf') => { const e = extOf(mime); return (n || 'document').replace(/[\\/:*?"<>|]+/g, '_').replace(new RegExp(e.replace('.', '\\.') + '$', 'i'), '').trim() + e; };

/** Save the file to the device. Returns a short location string or '' */
export async function downloadPdf(bytes, name, mime = 'application/pdf') {
  name = safeName(name, mime);
  if (native()) {
    const data = toBase64(bytes);
    // let the user choose the folder on the phone (Downloads, Documents, Drive…)
    try {
      const r = await SaveAs.save({ name, mime, data });
      return r && r.saved ? name : '';
    } catch (e) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      try {
        await Filesystem.writeFile({ path: 'Paraph/' + name, data, directory: Directory.Documents, recursive: true });
        return 'Documents/Paraph/' + name;
      } catch { await shareFile(bytes, name, name, mime); return ''; }
    }
  }
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}

/** Open system share sheet (mail, WhatsApp, Messenger…) */
export async function shareFile(bytes, name, title, mime = 'application/pdf') {
  name = safeName(name, mime);
  if (native()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const w = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: Directory.Cache });
    await Share.share({ title: title || name, files: [w.uri], dialogTitle: title || name });
    return true;
  }
  const file = new File([bytes], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: title || name }); } catch (e) { if (e.name !== 'AbortError') throw e; }
    return true;
  }
  await downloadPdf(bytes, name, mime);
  return false;
}
