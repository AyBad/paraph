import { test, expect } from '@playwright/test';
import { startApp } from './helpers.js';

test('animation au premier lancement, puis présentation et accueil', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#splash')).toBeVisible();
  await startApp(page);
  await expect(page.locator('.manage')).toBeVisible();
});

test('pas d’animation si l’application a servi il y a moins de 10 minutes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('paraph:lastActive', String(Date.now() - 5 * 60e3)));
  await page.goto('/');
  await expect(page.locator('#splash')).toHaveCount(0);
});

test('animation de nouveau après plus de 10 minutes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('paraph:lastActive', String(Date.now() - 11 * 60e3)));
  await page.goto('/');
  await expect(page.locator('#splash')).toBeVisible();
});

test('le menu reste ouvert au retour d’un sous-menu', async ({ page }) => {
  await startApp(page);
  await page.locator('.menu').tap();
  await page.locator('.d-item[data-a="settings"]').tap();
  await page.locator('.back').tap();
  await expect(page.locator('.drawer-back .drawer')).toBeVisible();
});
