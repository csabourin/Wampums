/**
 * Sign in once per seeded account and keep the session for the accessibility
 * specs (the SPA keeps its token in localStorage, which storageState saves).
 */
import { test as setup } from '@playwright/test';
import { ACCOUNTS, SEED_PASSWORD, settleScreen, storageStateFor } from './helpers.mjs';

for (const account of Object.values(ACCOUNTS)) {
  setup(`sign in as ${account}`, async ({ page }) => {
    await page.goto('/login');
    const form = page.locator('#login-form');
    await form.locator('input[name=email]').fill(account);
    await form.locator('input[name=password]').fill(SEED_PASSWORD);
    await form.locator('button[type=submit]').click();
    // The SPA navigates with history.pushState: wait on the path, not a load event.
    await page.waitForFunction(() => !location.pathname.startsWith('/login'));
    await settleScreen(page);
    await page.context().storageState({ path: storageStateFor(account) });
  });
}
