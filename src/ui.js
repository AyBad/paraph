export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function modal(html, cls = '') {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${cls}">${html}</div>`;
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('in'));
  return { el: back.querySelector('.modal'), back, close() { back.remove(); } };
}

let toastTimer;
export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('in');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('in'), 2600);
}

export function busy(msg) {
  const el = document.createElement('div');
  el.className = 'busy';
  el.innerHTML = `<div class="spinner"></div><div class="busy-msg">${esc(msg || '')}</div>`;
  document.body.appendChild(el);
  return { set(m) { el.querySelector('.busy-msg').textContent = m; }, close() { el.remove(); } };
}

export function confirmBox(msg, okLabel, cancelLabel) {
  return new Promise(res => {
    const m = modal(`<p class="confirm-msg">${esc(msg)}</p><div class="row end gap"><button class="btn ghost no">${esc(cancelLabel)}</button><button class="btn danger yes">${esc(okLabel)}</button></div>`);
    m.el.querySelector('.no').onclick = () => { m.close(); res(false); };
    m.el.querySelector('.yes').onclick = () => { m.close(); res(true); };
  });
}

const P = (d, extra = '') => `<svg viewBox="0 0 24 24" class="ic" ${extra}><path d="${d}"/></svg>`;
export const ICON = {
  back: P('M15 5l-7 7 7 7'),
  gear: P('M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 13a7.6 7.6 0 000-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 00-1.7-1L15 3.5h-4l-.4 2.5a7.5 7.5 0 00-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 000 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 001.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 001.7-1l2.4 1 2-3.4z'),
  file: P('M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6'),
  user: P('M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0'),
  text: P('M5 6V4h14v2M12 4v16M9 20h6'),
  check: P('M5 12.5l4.5 4.5L19 7'),
  cross: P('M6 6l12 12M18 6L6 18'),
  strike: P('M4 12h16M8 7c0-2 2-3 4-3s4 1 4 3M8 17c0 2 2 3 4 3s4-1 4-3'),
  sign: P('M3 17c3-1 4-6 6-9s3 0 1 4-2 6 1 4 3-4 5-3 1 3 3 2M3 21h18'),
  initials: P('M5 18V6l5 8V6M14 6v12M14 6h3a3 3 0 010 6h-3'),
  date: P('M4 6h16v14H4zM4 10h16M8 3v4M16 3v4'),
  id: P('M3 5h18v14H3zM7 10a2 2 0 104 0 2 2 0 00-4 0zM6 16c0-2 2-3 3-3s3 1 3 3M14 9h4M14 13h4'),
  pen: P('M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3'),
  undo: P('M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3'),
  trash: P('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'),
  copy: P('M8 8h12v12H8zM4 16V4h12'),
  plus: P('M12 5v14M5 12h14'),
  minus: P('M5 12h14'),
  share: P('M12 3v12M7 8l5-5 5 5M5 13v7h14v-7'),
  download: P('M12 3v12M7 10l5 5 5-5M5 20h14'),
  magic: P('M4 20L16 8M14 4v3M18 8h3M17 4l2-1M6 6l1 2M20 13l-1 2'),
  zoomIn: P('M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5M8 11h6M11 8v6'),
  zoomOut: P('M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5M8 11h6'),
  edit: P('M4 20h4L19 9l-4-4L4 16zM13 7l4 4'),
  palette: P('M12 3a9 9 0 000 18c1.5 0 2-1 2-2 0-1.5-1-2 0-3s3 0 5-1 2-3 2-4c0-4.5-4-8-9-8zM7.5 11a1 1 0 100-.1M10 7a1 1 0 100-.1M15 7a1 1 0 100-.1'),
  globe: P('M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18'),
  done: P('M5 12.5l4.5 4.5L19 7'),
  save: P('M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6'),
  menu: P('M4 7h16M4 12h16M4 17h16'),
  thick: P('M4 7h16M4 12h16M4 17.5h16', 'style="stroke-width:1"'),
  cloud: P('M7 18a4 4 0 01-.5-8 6 6 0 0111.5 1.5A3.5 3.5 0 0117.5 18zM12 11v5M9.5 13.5L12 11l2.5 2.5'),
  info: P('M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5v.5'),
  book: P('M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5M8 7h7'),
  star: P('M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z'),
  camera: P('M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z'),
  rotate: P('M20 11a8 8 0 10-2.3 5.7M20 4v7h-7'),
  folder: P('M3 6h6l2 2h10v11H3z'),
  dots: P('M12 6v.01M12 12v.01M12 18v.01', 'style="stroke-width:3"'),
  search: P('M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5'),
  moon: P('M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z'),
  shield: P('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'),
  scan: P('M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16'),
  lock: P('M6 11h12v10H6zM8 11V8a4 4 0 018 0v3')
};
