/** The real built PWA, including its worker and retained shell, against the seeded API. */
import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';
export default defineConfig({
  ...base,
  testMatch: /(?:auth\.setup|camp-lots\.offline)\.mjs$/,
  outputDir: 'test-results-offline',
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: 'playwright-report-offline', open: 'never' }]] : 'list',
  use: { ...base.use, baseURL: process.env.E2E_OFFLINE_BASE_URL || 'http://127.0.0.1:4173' },
  projects: base.projects.map((project) => ({ ...project,
    ...(project.name !== 'setup' ? { testMatch: /camp-lots\.offline\.mjs$/ } : {}),
  })),
});
