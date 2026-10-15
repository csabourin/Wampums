/**
 * Accessibility checks in a real browser (WCAG 2.2 AA), at phone and desktop
 * size, for a parent, a leader and an admin. jsdom cannot see colour
 * contrast, layout, focus visibility or what covers what; these tests can.
 *
 * They drive a running app with a seeded unit. Locally:
 *
 *   .claude/skills/run-wampums/db.sh
 *   node .claude/skills/run-wampums/seed.mjs
 *   .claude/skills/run-wampums/start.sh
 *   npm run test:a11y
 *
 * CI does the same (job "accessibility" in .github/workflows/ci-integrity.yml).
 */
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

const PHONE = {
  ...devices['Desktop Chrome'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const DESKTOP = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } };

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.mjs$/,
  // One seeded unit is shared; screens are read, never written.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    locale: 'fr-CA',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.mjs$/, use: DESKTOP },
    { name: 'phone', use: PHONE, dependencies: ['setup'] },
    { name: 'desktop', use: DESKTOP, dependencies: ['setup'] },
  ],
});
