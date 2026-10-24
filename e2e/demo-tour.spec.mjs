/**
 * The tour wampums.app invites visitors to take in the sample unit: a leader's
 * meeting and a parent's evening. Every screen it names opens with content, and
 * a change the demo does not allow (anything written in words) says so, instead of reading like a
 * missing permission. Runs on the demo accounts seed.mjs creates.
 */
import { test, expect } from '@playwright/test';
import { DEMO_ACCOUNTS, openScreen, seededActivityId, storageStateFor } from './helpers.mjs';

/** lang/fr.json "demo_read_only_explained", the playwright locale being fr-CA. */
const READ_ONLY = /Pas dans la démo/;

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
});

test.describe('the parent tour of the sample unit', () => {
  test.use({ storageState: storageStateFor(DEMO_ACCOUNTS.parent) });

  test('a parent sees their child, the forms to fill and the outing\'s carpool', async ({ page }) => {
    await openScreen(page, '/parent-dashboard');
    await expect(page.locator('#app')).toContainText('Léa Parent');
    await expect(page.getByRole('link', { name: /Fiche de santé/ }).or(page.getByRole('button', { name: /Fiche de santé/ }))).toBeVisible();
    await openTourStep(page, `/carpool/${seededActivityId()}`);
  });

  test('signing a permission slip in the demo explains it is not available there, and the slip stays pending', async ({ page }) => {
    await openScreen(page, '/parent-dashboard');
    // The family's tasks come first: the outing's slip is signed from there.
    const tasks = page.getByRole('region', { name: 'À faire pour votre famille' });
    await tasks.getByRole('button', { name: 'Signer', exact: true }).click();
    // DialogUtils' prompt is an alertdialog, titled after the activity.
    const dialog = page.getByRole('alertdialog', { name: /^Signer : / });
    await dialog.getByRole('textbox').fill('Demo Parent');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('#toast-container')).toContainText(READ_ONLY);
    await expect(page.locator('#app')).toContainText('En attente de signature');
  });
});
