import { Capacitor } from '@capacitor/core';

const native = () => Capacitor.isNativePlatform();

function toBase64(bytes) {
  let s = ''; const ch = 0x8000;
  for (let i = 0; i < bytes.length; i += ch) s += String.fromCharCode.apply(null, bytes.subarray(i, i + ch));
  return btoa(s);
}

export const safeName = (n) => (n || 'document').replace(/[\\/:*?"<>|]+/g, '_').replace(/\.pdf$/i, '').trim() + '.pdf';

/** Save the file to the device. Returns a short location string or '' */
export async function downloadPdf(bytes, name) {
  name = safeName(name);
  if (native()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const data = toBase64(bytes);
    try {
      await Filesystem.writeFile({ path: 'Paraph/' + name, data, directory: Directory.Documents, recursive: true });
      return 'Documents/Paraph/' + name;
    } catch (e) {
      await shareFile(bytes, name); return '';
    }
  }
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}

/** Open system share sheet (mail, WhatsApp, Messenger…) */
export async function shareFile(bytes, name, title) {
  name = safeName(name);
  if (native()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const w = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: Directory.Cache });
    await Share.share({ title: title || name, files: [w.uri], dialogTitle: title || name });
    return true;
  }
  const file = new File([bytes], name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: title || name }); } catch (e) { if (e.name !== 'AbortError') throw e; }
    return true;
  }
  await downloadPdf(bytes, name);
  return false;
}
