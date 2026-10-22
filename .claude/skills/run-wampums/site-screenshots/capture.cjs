/*
 * Photograph the app screens shown on wampums.app, each in French and English,
 * on a 390x844 phone at 2x. Run by take.sh; by hand, with the servers started:
 * node capture.cjs <out-dir> <seed.json> [name ...]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.env.HOME, '.cache/wampums-run/node_modules/playwright-core'));

const BASE = 'http://127.0.0.1:5173';
const [out, seedFile, ...only] = process.argv.slice(2);
const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
// seed.mjs records the disposable accounts' password; it is never a real one.
const PASSWORD = seed.password;

const SHOTS = [
  { name: 'dashboard', as: 'admin@run.test', route: '/dashboard' },
  { name: 'attendance', as: 'admin@run.test', route: '/attendance' },
  { name: 'points', as: 'admin@run.test', route: '/manage-points' },
  { name: 'badges', as: 'admin@run.test', route: '/progression' },
  {
    name: 'announcement', as: 'admin@run.test', route: '/mailing-list',
    prepare: async (page, lang) => {
      const text = {"fr": ["Sortie canot samedi : ce qu'il faut apporter", "Bonjour à toutes les familles! Samedi, départ du local à 8 h 30. Prévoyez un lunch, des vêtements de rechange et une bouteille d'eau. Les gilets de sauvetage sont fournis."], "en": ["Canoe outing on Saturday: what to bring", "Hello families! On Saturday we leave the scout hall at 8:30. Please pack a lunch, a change of clothes and a water bottle. Life jackets are provided."]}[lang];
      await page.fill('#announcement-subject', text[0]);
      await page.click('[contenteditable="true"]');
      await page.keyboard.type(text[1]);
      await page.evaluate(() => document.activeElement.blur());
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    },
  },
  { name: 'budget', as: 'admin@run.test', route: '/budgets' },
  { name: 'fees', as: 'admin@run.test', route: '/finance' },
  { name: 'forms', as: 'parent@run.test', route: `/dynamic-form/fiche_sante/${seed.participantId}` },
  {
    name: 'inventory', as: 'admin@run.test', route: '/inventory',
    prepare: async (page) => {
      await page.click('#table-view-btn');
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const heading = document.querySelectorAll('#app h2')[1];
        window.scrollTo({ top: heading.getBoundingClientRect().top + window.scrollY - 12, behavior: 'instant' });
      });
    },
  },
  { name: 'carpool', as: 'admin@run.test', route: `/carpool/${seed.activityId}` },
  { name: 'fundraiser', as: 'admin@run.test', route: '/fundraisers' },
  { name: 'medications', as: 'admin@run.test', route: '/medication-dispensing' },
  { name: 'offline', as: 'admin@run.test', route: '/attendance', offline: true },
  { name: 'parent', as: 'parent@run.test', route: '/parent-dashboard' },
];

const LIB = path.join(process.env.HOME, '.cache/wampums-run/libs/root/usr/lib/x86_64-linux-gnu');

async function signIn(page, email) {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('#login-form', { timeout: 30000 });
  await page.fill('#login-email', email);
  await page.fill('#login-password', PASSWORD);
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'], env: { ...process.env, LD_LIBRARY_PATH: LIB } });
  for (const lang of ['fr', 'en']) {
    for (const shot of SHOTS.filter((s) => !only.length || only.includes(s.name))) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
        locale: lang === 'fr' ? 'fr-CA' : 'en-CA',
      });
      await context.addInitScript((l) => {
        if (!sessionStorage.getItem('capture-lang-set')) {
          localStorage.setItem('lang', l);
          sessionStorage.setItem('capture-lang-set', '1');
        }
        // The headless browser has no emoji font: borrow Noto Color Emoji.
        document.addEventListener('DOMContentLoaded', () => {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=block';
          document.head.appendChild(link);
          const style = document.createElement('style');
          style.textContent = 'button, input, select, textarea { font-family: inherit; } .form-btn__icon { font-family: "Noto Color Emoji", sans-serif; }';
          document.head.appendChild(style);
          document.body.style.fontFamily = `${getComputedStyle(document.body).fontFamily}, "Noto Color Emoji"`;
        });
      }, lang);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await signIn(page, shot.as);
      await page.goto(`${BASE}${shot.route}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      if (shot.offline) {
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));
        await page.waitForTimeout(1500);
      }
      if (shot.prepare) {
        await shot.prepare(page, lang);
      }
      await page.evaluate(async () => { try { await document.fonts.load('16px "Noto Color Emoji"', '🧭📦💰✅📊🎁👥🕓📅⚠️✨🌐'); } catch { /* offline */ } await document.fonts.ready; });
      await page.waitForTimeout(800);
      const file = path.join(out, `${shot.name}-${lang}.png`);
      await page.screenshot({ path: file });
      console.log(JSON.stringify({ name: shot.name, lang, at: new URL(page.url()).pathname, htmlLang: await page.evaluate(() => document.documentElement.lang), errors }));
      await context.close();
    }
  }
  await browser.close();
})();
