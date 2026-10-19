/**
 * @jest-environment jsdom
 */

/**
 * The page behind the two links in an alumni email.
 *
 * Held here: opening the opt-in link never consents by itself (mail scanners
 * open links first); the unsubscribe acts at once; the token goes to the API
 * and nowhere else; a unit name is shown as text; and a link the page could
 * not check is not called invalid.
 *
 * @module test/spa/AlumniLink
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

jest.mock('../../spa/config.js', () => ({
  getApiUrl: (endpoint) => `https://unit.example.org${endpoint}`,
  CONFIG: { API_BASE_URL: 'https://unit.example.org' },
}));

const { AlumniLink, CONSENT_ACTION, UNSUBSCRIBE_ACTION } = require('../../spa/modules/alumni/AlumniLink.js');

const TOKEN = 'signed-token-123';
const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

/** @returns {Promise<void>} Let pending promises settle */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * @param {Object} data - The API's `data`
 * @param {number} [status] - HTTP status
 * @returns {Promise<Object>} A fetch response
 */
function answer(data, status = 200) {
  return Promise.resolve({ status, ok: status < 400, json: () => Promise.resolve({ success: true, data }) });
}

/** @returns {HTMLElement} The page root */
function app() {
  return document.getElementById('app');
}

/**
 * @param {string} action - CONSENT_ACTION or UNSUBSCRIBE_ACTION
 * @param {string} [search] - Query string the link carried
 * @returns {Promise<AlumniLink>} The page, drawn
 */
async function open(action, search = `?token=${TOKEN}`) {
  window.history.replaceState({}, '', `/alumni-consent${search}`);
  const page = new AlumniLink({}, action);
  await page.init();
  await flush();
  return page;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  global.fetch = jest.fn();
});

describe('the opt-in link', () => {
  test('opening it only asks: nothing is consented until the person clicks', async () => {
    fetch.mockReturnValueOnce(answer({ state: 'ready', organization_name: '6e Meute' }));

    await open(CONSENT_ACTION);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(`https://unit.example.org/api/v1/public/alumni/invitation?token=${TOKEN}`);
    expect(fetch.mock.calls[0][1]).toBeUndefined();
    expect(app().querySelector('h1').textContent).toBe('6e Meute');
    expect(app().querySelector('#alumni-consent-btn')).not.toBeNull();
  });

  test('clicking consents once, with the token in the body, and says so', async () => {
    fetch
      .mockReturnValueOnce(answer({ state: 'ready', organization_name: '6e Meute' }))
      .mockReturnValueOnce(answer({ state: 'consented' }));
    await open(CONSENT_ACTION);

    const button = app().querySelector('#alumni-consent-btn');
    button.click();
    button.click();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, options] = fetch.mock.calls[1];
    expect(url).toBe('https://unit.example.org/api/v1/public/alumni/consent');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ token: TOKEN });
    expect(app().querySelector('[role="status"]').textContent).toBe('alumni_consent_done');
  });

  test('a link without a token is invalid, and nothing is asked of the server', async () => {
    await open(CONSENT_ACTION, '');

    expect(fetch).not.toHaveBeenCalled();
    expect(app().querySelector('[role="status"]').textContent).toBe('alumni_consent_invalid');
  });

  test('while the link is checked, the page says it is loading', async () => {
    let release;
    fetch.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    window.history.replaceState({}, '', `/alumni-consent?token=${TOKEN}`);

    const pending = new AlumniLink({}, CONSENT_ACTION).init();

    expect(app().querySelector('[aria-busy="true"] [role="status"]').textContent).toBe('loading');
    release(await answer({ state: 'ready' }));
    await pending;
  });

  test('a unit that cannot be reached is not reported as an invalid link, and can be retried', async () => {
    fetch
      .mockReturnValueOnce(Promise.reject(new TypeError('Failed to fetch')))
      .mockReturnValueOnce(answer({ state: 'ready' }));
    await open(CONSENT_ACTION);

    const alert = app().querySelector('[role="alert"]');
    expect(alert.textContent).toBe('alumni_link_unreachable');
    expect(app().textContent).not.toContain('alumni_consent_invalid');

    app().querySelector('#alumni-link-retry').click();
    await flush();
    expect(app().querySelector('#alumni-consent-btn')).not.toBeNull();
  });

  test.each([429, 503])('an answer of %i is "could not reach", not "invalid"', async (status) => {
    fetch.mockReturnValueOnce(Promise.resolve({ status, ok: false, json: () => Promise.resolve({ success: false }) }));

    await open(CONSENT_ACTION);

    expect(app().querySelector('[role="alert"]').textContent).toBe('alumni_link_unreachable');
  });

  test('a unit name holding markup is shown as text', async () => {
    fetch.mockReturnValueOnce(answer({ state: 'ready', organization_name: '<img src=x onerror=alert(1)>' }));

    await open(CONSENT_ACTION);

    expect(app().querySelector('img')).toBeNull();
    expect(app().querySelector('h1').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  test('the invitation meets WCAG A/AA', async () => {
    fetch.mockReturnValueOnce(answer({ state: 'ready', organization_name: '6e Meute' }));
    await open(CONSENT_ACTION);

    const results = await axe.run(app(), AXE_OPTIONS);

    expect(results.violations).toEqual([]);
  });
});

describe('the unsubscribe link', () => {
  test('unsubscribes on opening: nobody should have to ask twice', async () => {
    fetch.mockReturnValueOnce(answer({ state: 'unsubscribed', organization_name: '6e Meute' }));

    await open(UNSUBSCRIBE_ACTION);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://unit.example.org/api/v1/public/alumni/unsubscribe');
    expect(JSON.parse(options.body)).toEqual({ token: TOKEN });
    expect(app().querySelector('[role="status"]').textContent).toBe('alumni_unsubscribe_done');
  });

  test('the outcome meets WCAG A/AA, including the retry state', async () => {
    fetch.mockReturnValueOnce(Promise.reject(new TypeError('Failed to fetch')));
    await open(UNSUBSCRIBE_ACTION);

    const results = await axe.run(app(), AXE_OPTIONS);

    expect(results.violations).toEqual([]);
    expect(app().querySelector('h1').textContent).toBe('alumni_unsubscribe_page_title');
  });
});
