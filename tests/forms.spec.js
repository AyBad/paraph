// Every sample form: opened, filled from the profile, saved and downloaded; the file must be usable.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { startApp, fillMainProfile, openFile, closeAd, sampleFiles, SAMPLES } from './helpers.js';

// least expected per sample: zones found / fields filled automatically (raise them when detection improves)
const MIN = {
  'image-photo-attestation-domicile.jpg': [10, 5],
  'image-photo-couleur-contrat-location.jpg': [8, 3],
  'image-photo-deja-rempli-a-la-main.jpg': [8, 2],
  'image-scan-net-declaration-cession.png': [15, 3],
  'pdf-avec-champs-inscription-scolaire.pdf': [26, 10],
  'pdf-avec-champs-procuration-2-pages.pdf': [26, 8],
  'pdf-sans-champs-attestation-domicile-pointilles.pdf': [15, 9],
  'pdf-sans-champs-contrat-location-2-pages.pdf': [24, 12],
  'pdf-sans-champs-declaration-cession-vehicule.pdf': [28, 8],
  'pdf-sans-champs-note-de-frais-tableau.pdf': [6, 3],
  'word-attestation-employeur-soulignes.docx': [20, 11],
  'word-autorisation-parentale.docx': [18, 6],
  'word-bulletin-adhesion-tableaux.docx': [14, 11]
};

for (const file of sampleFiles()) {
  test(`formulaire : ${file}`, async ({ page }, info) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await startApp(page);
    await fillMainProfile(page);
    await openFile(page, path.join(SAMPLES, file));

    const zones = await page.locator('.obj.field').count();
    let filled = 0;
    const af = page.locator('.af');
    if (await af.count()) {
      await af.tap();
      const go = page.locator('.modal .go');
      if (await go.isVisible().catch(() => false)) await go.tap();
      filled = await page.locator('.obj.field.text').evaluateAll(els => els.filter(e => e.textContent.trim()).length);
    }
    await info.attach('editeur', { body: await page.screenshot(), contentType: 'image/png' });
    info.annotations.push({ type: 'résultat', description: `${zones} zones, ${filled} remplies` });
    const [minZones, minFilled] = MIN[file] || [1, 0];
    expect.soft(zones, 'zones détectées').toBeGreaterThanOrEqual(minZones);
    expect.soft(filled, 'champs remplis automatiquement').toBeGreaterThanOrEqual(minFilled);

    // save (PDF, or image for a photo) and download
    const fmt = file.startsWith('image') ? 'jpg' : 'pdf';
    await page.locator('.finish').tap();
    await page.locator(`.fmt[data-f=${fmt}]`).tap();
    await page.locator('.modal .s').tap();
    await expect(page.locator('.dl').or(page.locator('.fi-close'))).toBeVisible({ timeout: 30_000 });
    await closeAd(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.dl').tap()]);
    const out = info.outputPath(dl.suggestedFilename());
    await dl.saveAs(out);
    const bytes = fs.readFileSync(out);
    expect(bytes.length, 'fichier non vide').toBeGreaterThan(1000);
    if (fmt === 'pdf') expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    else expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff');   // JPEG signature
    expect(errors, 'erreurs JavaScript').toEqual([]);
  });
}
