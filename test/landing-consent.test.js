/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const axe = require('axe-core');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'landing', 'consent.js'), 'utf8');
const STORAGE_KEY = 'wampums.landing.consent';
const CONSENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const DENIED = {
  analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
};
const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

function load(lang = 'en-CA') {
  document.documentElement.lang = lang;
  document.body.innerHTML = '<a class="skip-link" href="#main">Wampums</a><header class="site-header"><a href="/">Wampums</a></header><main id="main"><h1>Wampums</h1></main><footer><div class="footer-base"></div></footer>';
  const browser = { dataLayer: [], location: window.location, localStorage: window.localStorage, addEventListener: jest.fn() };
  vm.runInNewContext(SOURCE, { window: browser, document, Date, Intl });
  document.dispatchEvent(new Event('DOMContentLoaded'));
  return browser;
}

const calls = (browser) => browser.dataLayer.map((args) => Array.from(args));
const banner = () => document.getElementById('cookie-consent');
const choose = (choice) => document.querySelector(`[data-consent-choice="${choice}"]`).click();
const save = (analytics, savedAt = Date.now(), version = 1) => localStorage.setItem(STORAGE_KEY, JSON.stringify({ analytics, savedAt, version }));

beforeEach(() => {
  localStorage.clear();
  document.cookie.split(';').forEach((cookie) => {
    document.cookie = `${cookie.split('=')[0].trim()}=; Max-Age=0; Path=/`;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('all Google consent types are denied before a visitor chooses', () => {
  const browser = load();
  expect(calls(browser)).toEqual([['consent', 'default', DENIED]]);
  expect(banner().hidden).toBe(false);
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

test('accepting enables analytics cookies while advertising remains denied', () => {
  const browser = load();
  choose('granted');
  expect(calls(browser).at(-1)).toEqual(['consent', 'update', { ...DENIED, analytics_storage: 'granted' }]);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toMatchObject({ version: 1, analytics: 'granted' });
  expect(banner().hidden).toBe(true);
  expect(document.activeElement).toBe(document.querySelector('.site-header a'));
});

test('rejecting saves the refusal and keeps all consent types denied', () => {
  const browser = load();
  choose('denied');
  expect(calls(browser).at(-1)).toEqual(['consent', 'update', DENIED]);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).analytics).toBe('denied');
  expect(banner().hidden).toBe(true);
});

test.each(['granted', 'denied'])('a saved %s choice is restored before analytics configuration', (choice) => {
  save(choice);
  const browser = load();
  expect(calls(browser)).toEqual([
    ['consent', 'default', DENIED],
    ['consent', 'update', { ...DENIED, analytics_storage: choice }],
  ]);
  expect(banner().hidden).toBe(true);
});

test('the same preference is reused after changing page and language', () => {
  load();
  choose('granted');
  const nextPage = load('fr-CA');
  expect(calls(nextPage).at(-1)[2].analytics_storage).toBe('granted');
  expect(banner().hidden).toBe(true);
  expect(document.querySelector('.cookie-settings').textContent).toBe('Paramètres des témoins');
});

test.each([
  ['expired', { analytics: 'granted', version: 1, savedAt: Date.now() - CONSENT_MAX_AGE_MS }],
  ['future', { analytics: 'granted', version: 1, savedAt: Date.now() + CONSENT_MAX_AGE_MS }],
  ['unknown version', { analytics: 'granted', version: 0, savedAt: Date.now() }],
  ['unknown choice', { analytics: 'yes', version: 1, savedAt: Date.now() }],
  ['missing timestamp', { analytics: 'granted', version: 1 }],
])('an %s preference never grants consent', (_name, saved) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  expect(calls(load())).toEqual([['consent', 'default', DENIED]]);
  expect(banner().hidden).toBe(false);
});

test('a malformed preference never grants consent', () => {
  localStorage.setItem(STORAGE_KEY, 'invalid JSON');
  expect(calls(load())).toEqual([['consent', 'default', DENIED]]);
  expect(banner().hidden).toBe(false);
});

test('unavailable storage does not prevent choosing or withdrawing consent', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const browser = load();
  choose('granted');
  expect(calls(browser).at(-1)[2].analytics_storage).toBe('granted');
  expect(document.querySelector('[role="status"]').textContent).toContain('could not save');
  document.querySelector('.cookie-settings').click();
  choose('denied');
  expect(calls(browser).at(-1)).toEqual(['consent', 'update', DENIED]);
});

test('blocked cookie access does not prevent showing or rejecting the banner', () => {
  jest.spyOn(document, 'cookie', 'get').mockImplementation(() => { throw new Error('blocked'); });
  const browser = load();
  expect(banner().hidden).toBe(false);
  choose('denied');
  expect(calls(browser).at(-1)).toEqual(['consent', 'update', DENIED]);
});

test('cookie settings lets a visitor withdraw consent and returns keyboard focus', () => {
  save('granted');
  const browser = load();
  const settings = document.querySelector('.cookie-settings');
  settings.click();
  expect(banner().hidden).toBe(false);
  expect(settings.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement.id).toBe('cookie-consent-title');
  choose('denied');
  expect(calls(browser).at(-1)).toEqual(['consent', 'update', DENIED]);
  expect(settings.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(settings);
});

test('withdrawing consent removes Analytics cookies while preserving other cookies', () => {
  save('granted');
  load();
  document.cookie = '_ga=client; Path=/';
  document.cookie = '_ga_T3TDD2WS36=session; Path=/';
  document.cookie = 'necessary=keep; Path=/';
  document.querySelector('.cookie-settings').click();
  choose('denied');
  expect(document.cookie).not.toContain('_ga');
  expect(document.cookie).toContain('necessary=keep');
});

test('a preference changed or cleared in another tab updates consent immediately', () => {
  const browser = load();
  const onStorage = browser.addEventListener.mock.calls.find(([event]) => event === 'storage')[1];
  save('granted');
  onStorage({ key: STORAGE_KEY });
  expect(calls(browser).at(-1)[2].analytics_storage).toBe('granted');
  expect(banner().hidden).toBe(true);
  localStorage.removeItem(STORAGE_KEY);
  onStorage({ key: null });
  expect(calls(browser).at(-1)).toEqual(['consent', 'update', DENIED]);
  expect(banner().hidden).toBe(false);
});

test.each([
  ['en-CA', 'Your cookie choices', 'Allow analytics cookies', 'Reject analytics cookies'],
  ['fr-CA', 'Vos choix de témoins', 'Accepter les témoins statistiques', 'Refuser les témoins statistiques'],
])('the %s consent controls are localized and have no accessibility violations', async (lang, title, accept, reject) => {
  load(lang);
  expect(banner().querySelector('h2').textContent).toBe(title);
  expect(document.querySelector('[data-consent-choice="granted"]').textContent).toBe(accept);
  expect(document.querySelector('[data-consent-choice="denied"]').textContent).toBe(reject);
  expect((await axe.run(document.body, AXE_OPTIONS)).violations).toEqual([]);
});
