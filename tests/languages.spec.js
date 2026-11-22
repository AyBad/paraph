// Each language: every text is translated (no raw key on screen), right-to-left where it should be, no error.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { startApp } from './helpers.js';

const LOCALES = fs.readdirSync('src/locales').map(f => f.replace(/\.js$/, '')).sort();
const RTL = new Set(['ar', 'fa', 'ur']);
// translation keys look like "fmtHint_pdf" or "nameTaken": if one is visible, a text is missing
const KEYS = Object.keys((await import(pathToFileURL(path.resolve('src/locales/en.js')).href)).default).filter(k => /[a-z][A-Z_]/.test(k));

for (const lang of LOCALES) {
  test(`langue : ${lang}`, async ({ browser }) => {
    const ctx = await browser.newContext({ locale: lang, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const screens = [];
    const look = async (name) => {
      const txt = await page.locator('body').innerText();
      const raw = KEYS.filter(k => new RegExp(`(^|\\s)${k}(\\s|$)`).test(txt));
      expect.soft(raw, `${name} : textes non traduits`).toEqual([]);
      screens.push(name);
    };
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('dir', RTL.has(lang) ? 'rtl' : 'ltr');
    await look('présentation');
    await startApp(page);
    await look('accueil');
    await page.locator('.menu').tap();
    await look('menu');
    await page.locator('.d-item[data-a="settings"]').tap();
    await look('paramètres');
    expect(errors).toEqual([]);
    await ctx.close();
  });
}
