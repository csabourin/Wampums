/**
 * Shared pieces of the accessibility specs: the seeded accounts, waiting for a
 * screen to finish drawing, and the axe run.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Accounts created by .claude/skills/run-wampums/seed.mjs. */
export const ACCOUNTS = {
  admin: 'admin@run.test',
  leader: 'leader@run.test',
  parent: 'parent@run.test',
};
export const SEED_PASSWORD = process.env.E2E_PASSWORD || 'Wampums2026!';

/** Closes every document title (spa/utils/PageFocusUtils.js). */
export const APP_NAME = 'Wampums';

/** How long a screen may stay marked busy after its requests finish. */
const BUSY_GRACE_MS = 5000;

/** WCAG 2.0, 2.1 and 2.2, levels A and AA, contrast included. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * The outing seed.mjs creates, with a slip pending the parent's signature.
 *
 * @returns {number} Its activity id
 */
export function seededActivityId() {
  return readSeed().activityId;
}

/**
 * The child seed.mjs creates, whose parent is parent@run.test.
 *
 * @returns {number} Its participant id
 */
export function seededParticipantId() {
  return readSeed().participantId;
}

/**
 * The day seed.mjs planned a timed meeting on (tomorrow, at seeding time).
 *
 * @returns {string} YYYY-MM-DD
 */
export function seededProgrammeDate() {
  return readSeed().programmeDate;
}

/** @returns {Object} What seed.mjs recorded in seed.json */
function readSeed() {
  const cache = process.env.WAMPUMS_RUN_CACHE || path.join(homedir(), '.cache', 'wampums-run');
  return JSON.parse(readFileSync(path.join(cache, 'seed.json'), 'utf8'));
}

/**
 * @param {string} account - Seeded email
 * @returns {string} Where that account's signed-in session is kept
 */
export function storageStateFor(account) {
  return path.join(HERE, '.auth', `${account.split('@')[0]}.json`);
}

/**
 * Wait until the screen in #app has drawn its content: something rendered, no
 * request in flight, and nothing marked busy (or a short grace period gone).
 *
 * @param {import('@playwright/test').Page} page
 */
export async function settleScreen(page) {
  await page.waitForFunction(() => document.getElementById('app')?.children.length > 0);
  await page.waitForLoadState('networkidle');
  // A screen that never clears aria-busy is reported by the spec, not here.
  await page
    .waitForFunction(() => !document.querySelector('#app [aria-busy="true"]'), null, { timeout: BUSY_GRACE_MS })
    .catch(() => {});
}

/**
 * Open a screen and wait until it has drawn its content.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} target - Path to open
 */
export async function openScreen(page, target) {
  await page.goto(target);
  await settleScreen(page);
}

/**
 * Run axe on the whole page (#app and the chrome around it).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<{id: string, impact: string, help: string, targets: string[]}>>}
 *   One entry per rule violated
 */
export async function axeViolations(page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));
}
