/**
 * The camp's site and emergency numbers in the built PWA, with the network gone
 * (#1327): opened once online, the page is kept on the device, and a reload
 * without a connection shows that copy, read-only, saying from when.
 */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, storageStateFor, seededRecord, openScreen, axeViolations } from './helpers.mjs';

test.use({ storageState: storageStateFor(ACCOUNTS.admin) });
const MEETING = seededRecord('campMeetingId');

/** Make the page controlled by the worker, so the shell is kept for an offline reload. */
async function controlWorker(page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload();
  await expect(page.locator('#app h1')).toBeVisible();
}

test('without a network, the camp\'s site shows the copy kept on this device, read-only and accessible', async ({ page, context }, testInfo) => {
  await openScreen(page, `/camp-site/${MEETING}`);
  await controlWorker(page);
  await expect(page.locator('.camp-site__site')).toContainText('Hôpital fictif');
  // Online, the page can be edited.
  await expect(page.locator('#camp-site-camp-form')).toBeVisible();

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator('.camp-site__offline')).toContainText('copie gardée sur cet appareil');
  const site = page.locator('.camp-site__site');
  await expect(site).toContainText('Hôpital fictif');
  await expect(site).toContainText('1-800-463-5060');
  await expect(page.locator('#camp-site-camp-form')).toHaveCount(0);
  await expect(page.locator('#camp-site-edit')).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('camp-site-offline.png'), fullPage: true });
  await context.setOffline(false);
});
