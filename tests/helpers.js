// Shared steps of the Paraph tests.
import { expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export const SAMPLES = path.resolve('samples/formulaires');

/** First launch: wait for (or skip) the opening animation, then go through the introduction. */
export async function startApp(page, { lang } = {}) {
  await page.goto('/');
  await page.locator('.skip').waitFor({ timeout: 15_000 });
  await page.locator('#splash').waitFor({ state: 'detached', timeout: 15_000 });
  await page.locator('.skip').tap();
  await page.locator('.nx').tap();
  await page.locator('.later').tap();
  await expect(page.locator('.file')).toBeAttached();
}

/** Fill the default profile with a complete identity. */
export async function fillMainProfile(page) {
  await page.locator('.manage').tap();
  await page.locator('.prof-open').first().tap();
  const data = {
    name: 'Ayman', lastName: 'BADRI', firstName: 'Ayman', streetNumber: '10', streetName: 'rue Hélène Boucher',
    postalCode: '78960', city: 'Voisins-le-Bretonneux', email: 'ayman@example.com', phone: '0612345678', birthPlace: 'Sfax'
  };
  for (const [k, v] of Object.entries(data)) await page.fill(`input[data-k="${k}"]`, v);
  await page.fill('input[data-k="birthDate"]', '1989-03-28');
  await page.locator('.save').tap();
  await page.locator('.back').tap();
}

/** Open a file from the home screen; picks the first profile when asked. Waits for the field detection to end. */
export async function openFile(page, file) {
  await page.setInputFiles('.file', file);
  const chooser = page.locator('.list-item.prof').first();
  const editor = page.locator('.editor');
  await expect(chooser.or(editor)).toBeVisible({ timeout: 30_000 });
  if (await chooser.isVisible()) await chooser.tap();
  await expect(editor).toBeVisible();
  // the banner shows "… %" or "Veuillez patienter" while the photo is read
  await expect(async () => {
    const t = (await page.locator('.ed-banner').textContent()) || '';
    expect(t.length).toBeGreaterThan(0);
    expect(t).not.toMatch(/%|patienter/i);
  }).toPass({ timeout: 110_000, intervals: [500] });
}

/** Close the test interstitial ad if one is shown (its close button is enabled after 5 s). */
export async function closeAd(page) {
  const ad = page.locator('.fi-close');
  try { await ad.waitFor({ timeout: 3000 }); } catch { return; }
  await expect(ad).toBeEnabled({ timeout: 9000 });
  await ad.tap();
}

export const sampleFiles = () => fs.readdirSync(SAMPLES).filter(f => !f.endsWith('.md')).sort();
