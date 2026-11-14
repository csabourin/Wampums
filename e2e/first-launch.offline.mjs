/**
 * Everyday use without signal, in the built PWA. A leader signs in, uses the
 * app as usual (no reload, no preparation step), closes it and later opens it
 * with no network: the app starts, and the screens prepared automatically
 * (tasks, next meeting) show the copy kept on the device.
 *
 * Before, the worker kept a page only after it had served one itself, so a
 * first visit, or the first launch after any deploy, left nothing to start
 * from: the phone showed the browser's own offline page.
 */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, storageStateFor, openScreen, axeViolations } from './helpers.mjs';

test.use({ storageState: storageStateFor(ACCOUNTS.admin) });

/** Whether the everyday preparation has stored this endpoint for offline reads. */
function hasCachedRead(page, fragment) {
  return page.evaluate((needle) => new Promise((resolve) => {
    const open = indexedDB.open('WampumsAppDB');
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('offlineData')) { db.close(); resolve(false); return; }
      const keys = db.transaction('offlineData').objectStore('offlineData').getAllKeys();
      keys.onsuccess = () => { db.close(); resolve(keys.result.some((key) => String(key).includes(needle))); };
      keys.onerror = () => { db.close(); resolve(false); };
    };
  }), fragment);
}

test('opened once online without any reload, the app starts offline and shows the prepared tasks', async ({ page, context }, testInfo) => {
  // First visit: the page is not controlled by a worker yet, and is never reloaded.
  await openScreen(page, '/dashboard');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // The everyday screens are prepared without visiting them.
  await expect.poll(() => hasCachedRead(page, 'tasks/mine'), { timeout: 15000 }).toBe(true);
  await expect.poll(() => hasCachedRead(page, 'meetings/next'), { timeout: 15000 }).toBe(true);

  await context.setOffline(true);

  // A cold launch of the home screen icon, then a screen never opened before.
  await page.goto('/');
  await expect(page.locator('#app h1')).toBeVisible();
  await page.goto('/tasks');
  await expect(page.locator('#app h1')).toBeVisible();
  await expect(page.locator('#tasks-retry')).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('tasks-offline-first-launch.png'), fullPage: true });

  await context.setOffline(false);
});
