/** Consent choices on the marketing host, served by the local run-wampums API. */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const LANDING_ORIGIN = 'https://wampums.app';
const LOCAL_API = process.env.LANDING_API_URL || 'http://127.0.0.1:5000';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const DENIED = {
  analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
};

test.beforeEach(async ({ context, page }) => {
  // Serve production-host routes locally, so no visit or analytics reaches production.
  await context.route(`${LANDING_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await context.request.get(`${LOCAL_API}${url.pathname}${url.search}`, {
      headers: { host: 'wampums.app' },
    });
    await route.fulfill({ response });
  });
  await context.route('https://www.googletagmanager.com/**', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.googleTagLoaded = true;',
  }));
  await context.route(/https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|[^/]*google-analytics\.com)\//, (route) => route.abort());
  await page.goto(`${LANDING_ORIGIN}/en/`);
});

test('consent defaults precede Analytics and choices survive navigation and can be withdrawn', async ({ page, context }) => {
  await expect(page.locator('#cookie-consent')).toBeVisible();
  const queue = await page.evaluate(() => window.dataLayer.map((args) => Array.from(args)));
  expect(queue[0]).toEqual(['consent', 'default', DENIED]);
  expect(queue.findIndex(([command]) => command === 'config')).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.googleTagLoaded)).toBe(true);

  await page.getByRole('button', { name: 'Allow analytics cookies', exact: true }).click();
  await expect(page.locator('#cookie-consent')).toBeHidden();
  await page.goto(`${LANDING_ORIGIN}/fr/modules/finance/`);
  await expect(page.locator('#cookie-consent')).toBeHidden();
  expect(await page.evaluate(() => window.dataLayer[1][2].analytics_storage)).toBe('granted');

  await context.addCookies([
    { name: '_ga', value: 'test-client', domain: '.wampums.app', path: '/', secure: true },
    { name: '_ga_T3TDD2WS36', value: 'test-session', domain: 'wampums.app', path: '/', secure: true },
    { name: 'necessary', value: 'keep', domain: 'wampums.app', path: '/', secure: true },
  ]);
  const settings = page.getByRole('button', { name: 'Paramètres des témoins', exact: true });
  await settings.click();
  await expect(page.locator('#cookie-consent-title')).toBeFocused();
  await page.getByRole('button', { name: 'Refuser les témoins statistiques', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(settings).toBeFocused();
  expect(await page.evaluate(() => Array.from(window.dataLayer.at(-1)))).toEqual(['consent', 'update', DENIED]);
  const cookies = await context.cookies(LANDING_ORIGIN);
  expect(cookies.some((cookie) => cookie.name.startsWith('_ga'))).toBe(false);
  expect(cookies.some((cookie) => cookie.name === 'necessary')).toBe(true);
  await page.reload();
  await expect(page.locator('#cookie-consent')).toBeHidden();
  expect(await page.evaluate(() => window.dataLayer[1][2])).toEqual(DENIED);
});

for (const lang of ['en', 'fr']) {
  test(`the ${lang} banner is accessible, fits the viewport and has visible keyboard focus`, async ({ page }, testInfo) => {
    await page.goto(`${LANDING_ORIGIN}/${lang}/`);
    const banner = page.locator('#cookie-consent');
    await expect(banner).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('cookie-banner.png') });
    const results = await new AxeBuilder({ page }).include('#cookie-consent').withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const buttons = await banner.getByRole('button').all();
    const buttonBounds = await Promise.all(buttons.map((button) => button.boundingBox()));
    buttonBounds.forEach((bounds) => {
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.width).toBeGreaterThanOrEqual(44);
    });
    await banner.locator('a').focus();
    await page.keyboard.press('Tab');
    const accept = banner.locator('[data-consent-choice="granted"]');
    await expect(accept).toBeFocused();
    expect(await accept.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Tab');
    await expect(banner.locator('[data-consent-choice="denied"]')).toBeFocused();
  });
}

test('the consent banner is in place at the first paint, so the page does not jump when it appears', async ({ page }) => {
  await page.addInitScript(() => {
    window.layoutShift = 0;
    new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (!entry.hadRecentInput) {
          window.layoutShift += entry.value;
        }
      });
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(`${LANDING_ORIGIN}/en/features/forms/`, { waitUntil: 'networkidle' });
  await expect(page.locator('#cookie-consent')).toBeVisible();
  // Core Web Vitals call a cumulative layout shift under 0.1 good.
  expect(await page.evaluate(() => window.layoutShift)).toBeLessThan(0.1);
});
