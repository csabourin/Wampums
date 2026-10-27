/** Sending results stay visible at the controls and never discard an unsent message. */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, storageStateFor, openScreen, axeViolations } from './helpers.mjs';

test.use({ storageState: storageStateFor(ACCOUNTS.admin) });

const outcomes = [
  { label: 'success', status: 'sent', email: { total: 2, sent: 2, failed: 0 }, text: 'Courriel envoyé avec succès', cleared: true },
  { label: 'partial', status: 'partial', email: { total: 2, sent: 1, failed: 1 }, text: 'Échecs : 1', cleared: false },
  { label: 'failure', status: 'failed', email: { total: 2, sent: 0, failed: 2 }, text: 'Destinataires en échec : 2', cleared: false },
  { label: 'no recipients', status: 'failed', email: { total: 0, sent: 0, failed: 0 }, text: 'Aucun destinataire de courriel trouvé', cleared: false },
  { label: 'lost response', abort: true, text: 'L’envoi n’a pas pu être confirmé', cleared: false },
];

for (const outcome of outcomes) {
  test(`a ${outcome.label} email result is visible and keeps the message when needed`, async ({ page }) => {
    let sends = 0;
    // Exercise the real SPA and API client without sending mail or writing
    // shared test data. Only the POST's transport result is replaced.
    await page.route(/\/api\/v1\/announcements(?:\?.*)?$/, (route) => {
      if (route.request().method() !== 'POST') {return route.continue();}
      sends += 1;
      if (outcome.abort) {return route.abort('failed');}
      return route.fulfill({
        json: { success: true, data: { id: 1, status: outcome.status, delivery: { email: outcome.email } } },
      });
    });
    await openScreen(page, '/mailing-list');
    await page.locator('#announcement-subject').fill('Camp de novembre');
    await page.locator('#announcement-message').fill('Apportez vos bottes.');
    if (outcome.cleared) {
      await page.locator('input[name="announcement-audience"][value="alumni"]').check();
      await expect(page.locator('#announcement-member-filters')).toBeHidden();
    }
    await page.locator('#send-announcement').click();

    const result = page.locator('#announcement-feedback');
    await expect(result).toContainText(outcome.text);
    await expect(result).toBeFocused();
    await expect(result).toBeInViewport();
    const bounds = await result.boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
    await expect(result.locator('a')).toHaveAttribute('href', '/communication-history');
    await expect(page.locator('#announcement-message')).toHaveText(outcome.cleared ? '' : 'Apportez vos bottes.');
    await expect(page.locator('#send-announcement')).toBeEnabled();
    if (outcome.cleared) {
      await expect(page.locator('input[name="announcement-audience"][value="members"]')).toBeChecked();
      await expect(page.locator('#announcement-member-filters')).toBeVisible();
    }
    expect(sends).toBe(1);
    expect(await axeViolations(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
