// Fingerprint / face unlock.
// Android app: native BiometricPrompt (plugin BioAuth). iPhone / browser: the device's own
// Face ID / Touch ID / fingerprint through WebAuthn (a passkey kept on the device, never sent anywhere).
import { Capacitor, registerPlugin } from '@capacitor/core';
import * as store from './store.js';

const BioAuth = registerPlugin('BioAuth');
const native = Capacitor.isNativePlatform();
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** can this device unlock with a fingerprint or the face? */
export async function bioAvailable() {
  try {
    if (native) return !!(await BioAuth.isAvailable()).available;
    return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}

/** first use: checks that it works (and, on iPhone / browser, creates the device key) */
export async function bioEnroll(title) {
  if (native) { await BioAuth.authenticate({ title }); return true; }
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rnd(32),
      rp: { name: 'Paraph', id: location.hostname },
      user: { id: rnd(16), name: 'Paraph', displayName: 'Paraph' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000
    }
  });
  if (!cred) throw new Error('cancelled');
  await store.setSetting('bioCred', b64(cred.rawId));
  return true;
}

/** unlock: resolves true when the fingerprint / face (or the phone's code) was accepted */
export async function bioVerify(title) {
  try {
    if (native) { await BioAuth.authenticate({ title }); return true; }
    const id = await store.getSetting('bioCred');
    if (!id) return false;
    const r = await navigator.credentials.get({
      publicKey: { challenge: rnd(32), allowCredentials: [{ type: 'public-key', id: unb64(id) }], userVerification: 'required', timeout: 60000 }
    });
    return !!r;
  } catch { return false; }
}

/** 'pin', 'bio' or null (older versions only stored the PIN) */
export async function lockMode() {
  const m = await store.getSetting('lock');
  if (m === 'bio' || m === 'pin') return m;
  return (await store.getSetting('pin')) ? 'pin' : null;
}
