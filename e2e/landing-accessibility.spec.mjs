/**
 * The public site (wampums.app) in a real browser, at phone and desktop size:
 * every page meets WCAG 2.2 AA with contrast included, nothing scrolls the page
 * sideways at 390px, and the demo dialog, role tabs and comparison tables work
 * from the keyboard. Pages are served by the local run-wampums API under the
 * production host, as in landing-consent.spec.mjs, so nothing reaches production.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { WCAG_TAGS } from './helpers.mjs';

const LANDING_ORIGIN = 'https://wampums.app';
const LOCAL_API = process.env.LANDING_API_URL || 'http://127.0.0.1:5000';
/** landing/consent.js STORAGE_VERSION: a stored choice of another version is ignored. */
const CONSENT_VERSION = 1;
const LANDING_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'landing');

/** Every static page of the site, as paths like /fr/modules/finance/. */
function landingPages() {
  const found = [];
  const walk = (dir) => {
    readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'index.html') {
        found.push(`/${path.relative(LANDING_DIR, path.dirname(full)).split(path.sep).join('/')}/`);
      }
    });
  };
  ['en', 'fr'].forEach((lang) => walk(path.join(LANDING_DIR, lang)));
  return found.sort();
}

test.beforeEach(async ({ context }) => {
  await context.route(`${LANDING_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await context.request.get(`${LOCAL_API}${url.pathname}${url.search}`, {
      headers: { host: 'wampums.app' },
    });
    await route.fulfill({ response });
  });
  await context.route(/https:\/\/(?:www\.googletagmanager\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|[^/]*google-analytics\.com)\//, (route) => route.abort());
  // The cookie banner is checked in landing-consent.spec.mjs; keep it out of the way here.
  await context.addInitScript((version) => {
    try {
      localStorage.setItem('wampums.landing.consent', JSON.stringify({ version, analytics: 'denied', savedAt: Date.now() }));
    } catch {
      // Storage may be unavailable; the banner then shows and is checked with the page.
    }
  }, CONSENT_VERSION);
});

for (const pagePath of landingPages()) {
  test(`${pagePath} meets WCAG 2.2 AA and fits a phone`, async ({ page }) => {
    await page.goto(`${LANDING_ORIGIN}${pagePath}`);
    await expect(page.locator('h1').first()).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);

    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(sideways).toBe(false);
  });
}

test('the demo dialog keeps focus inside, closes with Escape and gives focus back', async ({ page }) => {
  await page.goto(`${LANDING_ORIGIN}/fr/`);
  const opener = page.locator('[data-open-demo-modal]').first();
  await opener.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Demander une démo' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#name')).toBeFocused();

  // Tab all the way around: focus never leaves the dialog.
  for (let step = 0; step < 20; step += 1) {
    // eslint-disable-next-line no-await-in-loop -- each key press depends on the previous focus
    await page.keyboard.press('Tab');
    // eslint-disable-next-line no-await-in-loop -- checked after each press
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('the role tabs move with the arrow keys and show their panel', async ({ page }) => {
  await page.goto(`${LANDING_ORIGIN}/en/`);
  const leaders = page.getByRole('tab', { name: /leaders/i });
  await leaders.focus();
  await page.keyboard.press('ArrowRight');

  const parents = page.getByRole('tab', { name: /parents/i });
  await expect(parents).toBeFocused();
  await expect(parents).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: /parents/i })).toBeVisible();
});

test('a comparison table scrolls inside its own labelled region, which the keyboard can reach', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${LANDING_ORIGIN}/fr/comparer/wampums-vs-tableurs/`);
  const region = page.getByRole('region', { name: /Tableau comparatif/ });
  await expect(region).toHaveAttribute('tabindex', '0');
  await expect(region.locator('table caption')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
