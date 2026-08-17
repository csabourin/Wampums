/**
 * @jest-environment jsdom
 */

/**
 * Reactivation landing page — URL construction.
 *
 * These exist because of a bug that every other layer was blind to. The token
 * was valid, the endpoint was correct, the server was right — and the link
 * still failed, because the page asked for it at a URL carrying two `?`.
 * `getApiUrl` is exported by both `config.js` and `ajax-functions.js`, and the
 * latter is an alias for `buildApiUrl`, which appends `?organization_id=…`
 * of its own. Concatenating `?token=…` onto that produced
 *
 *   /api/v1/public/reactivation/link?organization_id=1?token=eyJ…
 *
 * which a server parses as a single parameter named `organization_id` whose
 * value happens to contain the token. `req.query.token` was undefined, so a
 * perfectly good link reported itself expired.
 *
 * Nothing about that is visible from the service tests, which never build a
 * URL, or from the route tests, which are handed one already correct. So the
 * assertion here is deliberately about the shape of the request itself.
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

jest.mock('../../spa/ajax-functions.js', () => ({
  // Deliberately does NOT export getApiUrl. Importing it from here is the
  // mistake this suite exists to catch, and the import would resolve to
  // undefined and fail loudly rather than quietly building a broken URL.
  getCurrentOrganizationId: () => 1
}));

/*
 * config.js cannot be loaded under Jest — it reads import.meta. The stub stands
 * in for it, and returns a base that already carries a query string: that is
 * precisely the shape buildApiUrl produces, and the shape that broke this page
 * in production. A URL built correctly must append to that query string rather
 * than open a second one.
 */
const API_ORIGIN = 'https://unit.example.org';
jest.mock('../../spa/config.js', () => ({
  getApiUrl: (endpoint) => `https://unit.example.org${endpoint}?organization_id=1`,
  CONFIG: { API_BASE_URL: 'https://unit.example.org' }
}));

import { ReactivationLink } from '../../spa/modules/reactivation/ReactivationLink.js';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJwdXJwb3NlIjoibWVtYmVyc2hpcF9yZWFjdGl2YXRpb24ifQ.sig-with_chars';

/** The URL string handed to fetch, however fetch was called. */
function requestedUrl(mock) {
  const [input] = mock.mock.calls[0];
  return input instanceof URL ? input.toString() : String(input);
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState({}, '', `/reactivate-account?token=${encodeURIComponent(TOKEN)}`);
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: async () => ({ success: true, data: { state: 'ready_reactivate', organization_name: 'A Unit' } })
  }));
});

describe('reading the link', () => {
  test('asks for exactly one query string', async () => {
    await new ReactivationLink({ lang: 'fr' }).init();

    const url = requestedUrl(global.fetch);
    expect(url.split('?')).toHaveLength(2);
  });

  test('sends the token as a parameter the server can actually read', async () => {
    await new ReactivationLink({ lang: 'fr' }).init();

    const url = new URL(requestedUrl(global.fetch));
    expect(url.origin).toBe(API_ORIGIN);
    expect(url.pathname).toBe('/api/v1/public/reactivation/link');
    expect(url.searchParams.get('token')).toBe(TOKEN);
  });

  test('a query string already on the base is kept, not replaced', async () => {
    await new ReactivationLink({ lang: 'fr' }).init();

    const url = new URL(requestedUrl(global.fetch));
    expect(url.searchParams.get('organization_id')).toBe('1');
  });

  test('a token is never smuggled inside another parameter', async () => {
    await new ReactivationLink({ lang: 'fr' }).init();

    const url = new URL(requestedUrl(global.fetch));
    for (const [key, value] of url.searchParams.entries()) {
      if (key !== 'token') {
        expect(value).not.toContain('token=');
      }
    }
  });

  test('the described state reaches the page', async () => {
    await new ReactivationLink({ lang: 'fr' }).init();

    expect(document.getElementById('reactivation-confirm-btn')).not.toBeNull();
    expect(document.body.textContent).toContain('A Unit');
  });

  test('with no token at all the page asks for one instead of fetching', async () => {
    window.history.replaceState({}, '', '/reactivate-account');

    await new ReactivationLink({ lang: 'fr' }).init();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.getElementById('reactivation-request-form')).not.toBeNull();
  });
});
