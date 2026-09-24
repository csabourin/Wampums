#!/usr/bin/env node
/**
 * Drive the running Wampums SPA in headless Chromium: sign in, visit pages,
 * screenshot them, and report what a phone user would trip over.
 *
 *   node .claude/skills/run-wampums/shot.mjs [options] <path> [<path> ...]
 *
 *   --as <email>        sign in first (password from seed.json); omit to stay logged out
 *   --viewport <v>      phone (390x844, default) or desktop (1280x900)
 *   --out <dir>         where screenshots go (default $WAMPUMS_RUN_CACHE/shots)
 *   --wait <selector>   wait for this element on every page before the screenshot
 *
 * For each path it prints one JSON line: the screenshot file, whether the page
 * scrolls sideways, elements running past the screen edge, tap targets under
 * 44px, and any page errors. Exit code 1 if any page threw.
 */

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const CACHE = process.env.WAMPUMS_RUN_CACHE || path.join(homedir(), '.cache', 'wampums-run');
const BASE = process.env.WAMPUMS_RUN_URL || 'http://127.0.0.1:5173';
const require = createRequire(path.join(CACHE, 'package.json'));
const { chromium } = require('playwright-core');

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
};
const TOUCH_TARGET_MIN = 44;
const SETTLE_MS = 1500;

function parseArgs(argv) {
  const options = { viewport: 'phone', out: path.join(CACHE, 'shots'), paths: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--as') options.as = argv[++i];
    else if (arg === '--viewport') options.viewport = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else if (arg === '--wait') options.wait = argv[++i];
    else options.paths.push(arg);
  }
  if (!VIEWPORTS[options.viewport]) throw new Error(`unknown viewport: ${options.viewport}`);
  if (options.paths.length === 0) throw new Error('give at least one path, e.g. /parent-dashboard');
  return options;
}

/** What a phone user would hit on the page as rendered. Runs in the browser. */
function audit(minTarget) {
  const vw = document.documentElement.clientWidth;
  const describe = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
    el.classList.length ? `.${[...el.classList].join('.')}` : ''}`;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const app = document.getElementById('app') || document.body;
  return {
    scrollsSideways: document.documentElement.scrollWidth > vw,
    overflowing: [...app.querySelectorAll('*')]
      .filter((el) => visible(el) && el.getBoundingClientRect().right > vw + 1)
      .slice(0, 10)
      .map((el) => `${describe(el)} right=${Math.round(el.getBoundingClientRect().right)}`),
    smallTargets: [...app.querySelectorAll('button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea')]
      .filter((el) => visible(el) && el.getBoundingClientRect().height < minTarget)
      .slice(0, 10)
      .map((el) => `${describe(el)} "${(el.textContent || el.name || '').trim().slice(0, 30)}" h=${Math.round(el.getBoundingClientRect().height)}`),
  };
}

async function signIn(page, email) {
  const seed = JSON.parse(readFileSync(path.join(CACHE, 'seed.json'), 'utf8'));
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('#login-form', { timeout: 30000 });
  await page.fill('#login-form input[name=email]', email);
  await page.fill('#login-form input[name=password]', seed.password);
  await page.click('#login-form button[type=submit]');
  // The SPA navigates with history.pushState, which fires no load event, so
  // wait on the path rather than on navigation.
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 30000 });
  await page.waitForTimeout(SETTLE_MS);
}

const options = parseArgs(process.argv.slice(2));
mkdirSync(options.out, { recursive: true });

const browser = await chromium.launch({
  args: ['--no-sandbox'],
  // libasound is unpacked into the cache by setup.sh rather than installed.
  env: { ...process.env, LD_LIBRARY_PATH: path.join(CACHE, 'libs/root/usr/lib/x86_64-linux-gnu') },
});
let failed = false;

try {
  const context = await browser.newContext(VIEWPORTS[options.viewport]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  if (options.as) {
    await signIn(page, options.as);
    console.log(JSON.stringify({ signedInAs: options.as, landedOn: new URL(page.url()).pathname }));
  }

  for (const target of options.paths) {
    errors.length = 0;
    await page.goto(`${BASE}${target}`);
    if (options.wait) await page.waitForSelector(options.wait, { timeout: 30000 });
    await page.waitForTimeout(SETTLE_MS);

    const name = `${options.viewport}${target.split('?')[0].replace(/[^a-z0-9]+/gi, '-')}`.replace(/-$/, '');
    const file = path.join(options.out, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });

    const result = await page.evaluate(audit, TOUCH_TARGET_MIN);
    if (errors.length) failed = true;
    console.log(JSON.stringify({ path: target, at: new URL(page.url()).pathname, screenshot: file, ...result, pageErrors: [...errors] }));
  }
} finally {
  await browser.close();
}

process.exitCode = failed ? 1 : 0;
