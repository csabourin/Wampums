/** Real IndexedDB, service worker, offline reload and receipt-backed replay in a built PWA. */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ACCOUNTS, storageStateFor, seededRecord, openScreen, axeViolations } from './helpers.mjs';
test.use({ storageState: storageStateFor(ACCOUNTS.admin) });
const MEETING = seededRecord('campMeetingId');

async function controlWorker(page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // This controlled navigation retains the real HTML shell and entry asset references.
  await page.reload();
  await expect(page.locator('#app h1')).toBeVisible();
}
async function headers(page) {
  return { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('jwtToken'))}` };
}
async function createLot(page, name) {
  const response = await page.request.post(`/api/v1/camp-equipment-lots/meetings/${MEETING}`, {
    headers: await headers(page), data: { name, creation_key: randomUUID(),
      items: [{ catalog_item_id: seededRecord('campLotArticleId'), quantity: 0.1 }],
      roles: [{ role: 'prepare', user_id: seededRecord('adminId') }],
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data;
}

test('the combined lot editor is accessible and returns focus when closed', async ({ page }, testInfo) => {
  await openScreen(page, `/camp-lots/${MEETING}`);
  await page.locator('#camp-lots-create').click();
  const dialog = page.locator('#camp-lot-editor');
  await expect(dialog).toBeVisible();
  await dialog.locator('#camp-lot-name').fill('Cuisine du camp');
  await dialog.locator('[name="prepare"]').selectOption(String(seededRecord('adminId')));
  await dialog.locator('input[type="checkbox"]').first().check();
  expect(await axeViolations(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('camp-lots-editor.png'), fullPage: true });
  // No invalid write is required to inspect the dialog. Escape returns to the opener.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#camp-lots-create')).toBeFocused();
});

test('two offline changes survive a full reload and replay exactly once in order', async ({ page, context }, testInfo) => {
  await openScreen(page, `/camp-lots/${MEETING}`);
  const lot = await createLot(page, `Lot hors ligne ${testInfo.project.name} ${randomUUID()}`);
  await controlWorker(page);
  await page.locator('#camp-lots-check').click();
  await expect(page.locator('.camp-lots__device')).toContainText('Ces lots sont disponibles hors ligne');
  const card = page.locator(`#camp-lot-${lot.id}`);
  await expect(card).toBeVisible();
  await context.setOffline(true);
  await card.locator('[data-lot-state="loaded"]').click();
  await expect(card.locator('.camp-lots__state')).toContainText('Chargé — En attente d’envoi');
  await card.locator('[data-lot-state="returned"]').click();
  await expect(card.locator('.camp-lots__state')).toContainText('Retourné — En attente d’envoi');
  await page.screenshot({ path: testInfo.outputPath('camp-lots-pending.png'), fullPage: true });
  await page.reload();
  await expect(card.locator('.camp-lots__state')).toContainText('Retourné — En attente d’envoi');
  await context.setOffline(false);
  await expect(card.locator('.camp-lots__state')).toHaveText('Retourné', { timeout: 30000 });
  const response = await page.request.get(`/api/v1/camp-equipment-lots/meetings/${MEETING}`, { headers: await headers(page) });
  const saved = (await response.json()).data.find((entry) => entry.id === lot.id);
  expect(saved).toMatchObject({ status: 'returned', version: 3 });
  expect(saved.history).toHaveLength(3);
  expect(await axeViolations(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('camp-lots-confirmed.png'), fullPage: true });
});

test('a phone without prepared lots gets an explicit offline refusal from its task link', async ({ page, context }) => {
  await openScreen(page, '/tasks');
  await controlWorker(page);
  await expect(page.locator(`a[href="/my-camp-lots/${MEETING}"]`).first()).toBeVisible();
  await context.setOffline(true);
  await page.locator(`a[href="/my-camp-lots/${MEETING}"]`).first().click();
  await expect(page.locator('#app [role="alert"]')).toContainText('n’ont pas été préparés sur cet appareil');
  await expect(page.locator('[data-lot-state]')).toHaveCount(0);
});
