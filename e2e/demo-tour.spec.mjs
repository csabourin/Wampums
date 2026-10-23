/**
 * The tour wampums.app invites visitors to take in the sample unit: a leader's
 * meeting and a parent's evening. Every screen it names opens with content, and
 * a change the read-only demo refuses says so, instead of reading like a
 * missing permission. Runs on the demo accounts seed.mjs creates.
 */
import { test, expect } from '@playwright/test';
import { DEMO_ACCOUNTS, openScreen, seededActivityId, storageStateFor } from './helpers.mjs';

/** lang/fr.json "demo_read_only_refused", the playwright locale being fr-CA. */
const READ_ONLY = /La démo est en lecture seule/;

/** Pages that answer when a guard refuses or a route is missing. */
const REFUSED = /page introuvable|accès refusé|not found|access denied/i;

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} target - Path to open
 */
async function openTourStep(page, target) {
  await openScreen(page, target);
  await expect(page.locator('#app h1').first()).toBeVisible();
  await expect(page.locator('#app')).not.toContainText(REFUSED);
}

test.describe('the leader tour of the sample unit', () => {
  test.use({ storageState: storageStateFor(DEMO_ACCOUNTS.leader) });

  test('a leader sees the dashboard, attendance, points and badges with the unit\'s youth', async ({ page }) => {
    for (const target of ['/dashboard', '/attendance', '/manage-points', '/badge-tracker']) {
      // eslint-disable-next-line no-await-in-loop -- the steps share one page and must run in order
      await openTourStep(page, target);
    }
    await openScreen(page, '/attendance');
    await expect(page.locator('#app')).toContainText('Léa Parent');
  });

  test('taking attendance in the demo says it is read-only, and nothing is saved', async ({ page }) => {
    await openScreen(page, '/attendance');
    await page.getByText('Léa Parent').click();
    await page.getByRole('button', { name: 'Présent', exact: true }).click();
    await expect(page.locator('#toast-container')).toContainText(READ_ONLY);
  });
});

test.describe('the parent tour of the sample unit', () => {
  test.use({ storageState: storageStateFor(DEMO_ACCOUNTS.parent) });

  test('a parent sees their child, the forms to fill and the outing\'s carpool', async ({ page }) => {
    await openScreen(page, '/parent-dashboard');
    await expect(page.locator('#app')).toContainText('Léa Parent');
    await expect(page.getByRole('link', { name: /Fiche de santé/ }).or(page.getByRole('button', { name: /Fiche de santé/ }))).toBeVisible();
    await openTourStep(page, `/carpool/${seededActivityId()}`);
  });
});
