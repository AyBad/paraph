import { test, expect } from '@playwright/test';
import { startApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await startApp(page);
  await page.locator('.manage').tap();
});

const nameError = (page) => page.locator('#name-err');

test('un nom de profil déjà utilisé est refusé (majuscules et espaces ignorés)', async ({ page }) => {
  await page.locator('.add').tap();
  await page.fill('input[data-k="name"]', '  MOI ');          // the default profile is called "Moi"
  await page.locator('.save').tap();
  await expect(nameError(page)).toBeVisible();
  await expect(nameError(page)).toContainText('existe déjà');
  await expect(page.locator('input[data-k="name"]')).toHaveClass(/err/);
  // the message goes away as soon as the name is changed
  await page.fill('input[data-k="name"]', 'Sarah');
  await expect(nameError(page)).toBeHidden();
  await page.locator('.save').tap();
  await expect(page.locator('input[data-k="name"]')).toHaveCount(0);
});

test('un nom de profil vide est refusé', async ({ page }) => {
  await page.locator('.add').tap();
  await page.fill('input[data-k="name"]', '   ');
  await page.locator('.save').tap();
  await expect(nameError(page)).toBeVisible();
});

test('5 profils gratuits, le 6e propose la version Pro', async ({ page }) => {
  for (const n of ['P2', 'P3', 'P4', 'P5']) {
    await page.locator('.add').tap();
    await page.fill('input[data-k="name"]', n);
    await page.locator('.save').tap();
    await expect(page.locator('input[data-k="name"]')).toHaveCount(0);
  }
  await page.locator('.add').tap();
  await expect(page.locator('.modal')).toContainText('5 profils');
  await expect(page.locator('input[data-k="name"]')).toHaveCount(0);
  // more than 2 profiles: the home screen shows a drop-down
  await page.locator('.modal .c').tap();
  await page.locator('.back').tap();
  await expect(page.locator('.pdd')).toBeVisible();
});
