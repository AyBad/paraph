import { Capacitor } from '@capacitor/core';
import { t } from './i18n.js';
import { getPro } from './store.js';

// Google's official TEST ad units: they never generate revenue and are safe to click.
// Replace with your own AdMob IDs before publishing.
const TEST = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712'
};

const native = Capacitor.isNativePlatform();
let admob = null, ready = false, bannerShown = false;

async function adsAllowed() { return !(await getPro()); }

export async function initAds() {
  if (!native || ready) return;
  try {
    admob = (await import('@capacitor-community/admob')).AdMob;
    await admob.initialize({ initializeForTesting: true });
    ready = true;
  } catch (e) { console.warn('ads', e); }
}

/** banner at the bottom of the home screen */
export async function showBanner(container) {
  if (!(await adsAllowed())) { hideBanner(); return; }
  if (native) {
    await initAds(); if (!ready) return;
    try {
      if (!bannerShown) await admob.showBanner({ adId: TEST.banner, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: true });
      else await admob.resumeBanner();
      bannerShown = true;
      container && container.classList.add('with-ad');
    } catch (e) { console.warn('banner', e); }
  } else if (container) {
    // web / iPhone: simulated test banner
    const el = document.createElement('div');
    el.className = 'fake-ad';
    el.innerHTML = `<span class="ad-tag">${t('ad')}</span><b>Paraph</b> · Test ad banner`;
    container.appendChild(el);
    container.classList.add('with-ad');
  }
}

export async function hideBanner() {
  if (native && ready && bannerShown) { try { await admob.hideBanner(); } catch { } }
  document.querySelectorAll('.fake-ad').forEach(e => e.remove());
}

export async function removeBannerForPro() {
  if (native && ready && bannerShown) { try { await admob.removeBanner(); } catch { } bannerShown = false; }
  document.querySelectorAll('.fake-ad').forEach(e => e.remove());
}

/** full-screen ad, shown after a document is saved */
export async function showInterstitial() {
  if (!(await adsAllowed())) return;
  if (native) {
    await initAds(); if (!ready) return;
    try { await admob.prepareInterstitial({ adId: TEST.interstitial, isTesting: true }); await admob.showInterstitial(); } catch (e) { console.warn('interstitial', e); }
    return;
  }
  await new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'fake-inter';
    back.innerHTML = `<div class="fi-box"><span class="ad-tag">${t('ad')}</span>
      <div class="fi-art">Paraph Pro</div><p>Test interstitial ad</p><button class="btn ghost fi-close" disabled>5</button></div>`;
    document.body.appendChild(back);
    const btn = back.querySelector('.fi-close');
    let n = 5;
    const iv = setInterval(() => { n--; if (n > 0) btn.textContent = n; else { clearInterval(iv); btn.disabled = false; btn.textContent = '✕'; } }, 1000);
    btn.onclick = () => { back.remove(); resolve(); };
  });
}
