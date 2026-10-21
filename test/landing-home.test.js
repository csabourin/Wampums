/** @jest-environment jsdom */
/*
 * The public home pages (wampums.app/en/ and /fr/): feature tabs, the demo
 * request dialog, and the two languages kept in step.
 */
const fs = require('fs');
const path = require('path');
const axe = require('axe-core');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const page = (lang) => fs.readFileSync(path.join(__dirname, '..', 'landing', lang, 'index.html'), 'utf8');

/** Render one language's page and run its script, as the browser would. */
function load(lang) {
  const html = page(lang);
  document.documentElement.lang = /<html lang="([^"]+)"/.exec(html)[1];
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)[1];
  jest.isolateModules(() => {
    require('../landing/landing.js');
  });
}

function fillDemoForm() {
  document.getElementById('name').value = 'Ada Lovelace';
  document.getElementById('email').value = 'ada@example.com';
  document.getElementById('message').value = 'We are a unit of 24 youth and 6 leaders.';
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  delete global.fetch;
});

describe('home page feature tabs', () => {
  test('only the leaders panel shows until another role is chosen', () => {
    load('en');
    expect(document.querySelector('[role="tablist"]').hidden).toBe(false);
    expect(document.getElementById('panel-leaders').hidden).toBe(false);
    expect(document.getElementById('panel-parents').hidden).toBe(true);

    document.getElementById('tab-parents').click();

    expect(document.getElementById('panel-parents').hidden).toBe(false);
    expect(document.getElementById('panel-leaders').hidden).toBe(true);
    expect(document.getElementById('tab-parents').getAttribute('aria-selected')).toBe('true');
  });

  test('arrow keys move between roles and wrap around', () => {
    load('fr');
    const admin = document.getElementById('tab-admin');
    admin.click();
    admin.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(document.activeElement.id).toBe('tab-leaders');
    expect(document.getElementById('panel-leaders').hidden).toBe(false);
  });
});

describe('home page demo request', () => {
  test('a request is sent to the versioned public endpoint, not the retired /api/contact-demo', async () => {
    jest.useFakeTimers();
    load('en');
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });

    document.querySelector('[data-open-demo-modal]').click();
    fillDemoForm();
    document.getElementById('demoForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await jest.advanceTimersByTimeAsync(0);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/public\/contact-demo$/);
    expect(JSON.parse(init.body)).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com', honeypot: '' });
    expect(document.getElementById('formSuccess').hidden).toBe(false);
  });

  test('missing fields are flagged next to each field and nothing is sent', () => {
    load('fr');
    document.querySelector('[data-open-demo-modal]').click();
    document.getElementById('demoForm').dispatchEvent(new Event('submit', { cancelable: true }));

    expect(global.fetch).not.toHaveBeenCalled();
    ['name', 'email', 'message'].forEach((id) => {
      expect(document.getElementById(id).getAttribute('aria-invalid')).toBe('true');
    });
    expect(document.activeElement.id).toBe('name');
  });

  test('a refused request explains itself in the page language, not with the server message', async () => {
    window.alert = jest.fn();
    load('fr');
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ success: false, errors: [{ field: 'email', message: 'Invalid email address' }] }),
    });

    document.querySelector('[data-open-demo-modal]').click();
    fillDemoForm();
    document.getElementById('demoForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    const status = document.getElementById('formStatus');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toMatch(/n'a pas pu être envoyée/);
    expect(status.textContent).not.toMatch(/Invalid email/);
    expect(document.getElementById('email').getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('.btn-submit').disabled).toBe(false);
    expect(window.alert).not.toHaveBeenCalled();
  });

  test('Escape closes the dialog and returns focus to the button that opened it', () => {
    load('en');
    const opener = document.querySelector('.final [data-open-demo-modal]');
    opener.click();
    expect(document.getElementById('demoModal').hidden).toBe(false);

    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.getElementById('demoModal').hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  test.each(['en', 'fr'])('the %s page and its open dialog have no accessibility violations', async (lang) => {
    load(lang);
    expect((await axe.run(document.body, AXE_OPTIONS)).violations).toEqual([]);
    document.querySelector('[data-open-demo-modal]').click();
    expect((await axe.run(document.getElementById('demoModal'), AXE_OPTIONS)).violations).toEqual([]);
  });
});

describe('home page languages', () => {
  const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const links = (html, lang) => [...html.matchAll(new RegExp(`href="/${lang}/[^"]*"`, 'g'))].length;

  test('the French and English pages have the same sections, controls and form fields', () => {
    expect(ids(page('fr'))).toEqual(ids(page('en')));
  });

  test('each page links to the pages of its own language', () => {
    expect(links(page('en'), 'en')).toBeGreaterThan(links(page('en'), 'fr'));
    expect(links(page('fr'), 'fr')).toBeGreaterThan(links(page('fr'), 'en'));
  });
});
