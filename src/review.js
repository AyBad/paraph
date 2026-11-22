// Asking for a Google Play rating, rarely and at a good moment:
// after a document was saved successfully, never before the 3rd save nor in the first 3 days,
// at most once every 4 months and 3 times in all. Google also limits how often the card really shows.
import { Capacitor, registerPlugin } from '@capacitor/core';
import * as store from './store.js';

const PlayReview = registerPlugin('PlayReview');
const DAY = 86400000;

/** to call once at start: remembers the first day the app was used */
export async function noteFirstUse() {
  if (!(await store.getSetting('firstUse'))) await store.setSetting('firstUse', Date.now());
}

/** after each saved document; resolves true when the rating card was asked for */
export async function maybeAskReview() {
  const saves = (await store.getSetting('saves', 0)) + 1;
  await store.setSetting('saves', saves);
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('PlayReview')) return false;
  const first = await store.getSetting('firstUse', Date.now()), last = await store.getSetting('reviewAsked', 0), times = await store.getSetting('reviewTimes', 0);
  if (saves < 3 || Date.now() - first < 3 * DAY || Date.now() - last < 120 * DAY || times >= 3) return false;
  await store.setSetting('reviewAsked', Date.now());
  await store.setSetting('reviewTimes', times + 1);
  try { await PlayReview.request(); return true; } catch { return false; }
}
