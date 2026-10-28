import { test, expect } from '@playwright/test';
import { ACCOUNTS, storageStateFor, openScreen, seededRecord } from './helpers.mjs';
test.use({ storageState: storageStateFor(ACCOUNTS.admin) });
test('the camp preparation overview leads to the collective material list', async ({ page }, testInfo) => {
  const id = seededRecord('campMeetingId');
  await openScreen(page, `/camp-readiness/${id}`);
  await expect(page.locator('h1')).toHaveText('Prêt pour le camp');
  await expect(page.locator('#camp-readiness-refresh')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('camp-readiness.png'), fullPage: true });
  await page.locator(`a[href="/camp-material/${id}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/camp-material/${id}$`));
});
