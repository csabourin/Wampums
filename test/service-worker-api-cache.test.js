/**
 * Service worker API cache — behaviour of fetchAndCacheInIndexedDB
 *
 * Every GET under /api/ goes through this handler in production. It caches
 * JSON for offline use; files such as the activities calendar (.ics) must
 * pass through untouched. Parsing the calendar as JSON used to throw, and the
 * handler answered a successful download with an "offline" 503, which the
 * parent dashboard showed as "Impossible de télécharger le calendrier".
 *
 * The two functions are lifted out of src-sw.js and run against stubs, since
 * the worker itself imports Workbox and cannot load in Node.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * Source text of a top-level function declared in src-sw.js.
 * @param {string} source
 * @param {string} name
 * @returns {string}
 */
function extractFunction(source, name) {
  const start = source.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
  if (start === -1) {
    throw new Error(`${name} not found in src-sw.js`);
  }
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end + 2);
}

function loadHandler(fetchImpl) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src-sw.js'), 'utf8');
  const cached = new Map();
  const sandbox = {
    Response,
    fetch: fetchImpl,
    indexedDBBlocked: false,
    buildScopedCacheKey: (request) => request.url,
    getCacheDuration: () => 1,
    setCachedData: (key, data) => { cached.set(key, data); return Promise.resolve(); },
    getCachedData: (key) => Promise.resolve(cached.get(key) || null),
    debugLog: () => {},
    debugWarn: () => {},
    debugError: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${extractFunction(source, 'isJsonResponse')}\n${extractFunction(source, 'fetchAndCacheInIndexedDB')}\n`
      + 'this.handler = fetchAndCacheInIndexedDB;',
    sandbox
  );
  return { handler: sandbox.handler, cached };
}

describe('Service worker API cache', () => {
  test('a calendar download passes through untouched and is not cached', async () => {
    const calendar = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
    const { handler, cached } = loadHandler(() => Promise.resolve(new Response(calendar, {
      status: HTTP_OK,
      headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
    })));

    const response = await handler({ url: 'https://unit.wampums.app/api/v1/activities/calendar.ics' });

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get('Content-Type')).toMatch(/text\/calendar/);
    expect(await response.text()).toBe(calendar);
    expect(cached.size).toBe(0);
  });

  test('JSON responses are still cached for offline use', async () => {
    const { handler, cached } = loadHandler(() => Promise.resolve(new Response(JSON.stringify({ success: true, data: [1] }), {
      status: HTTP_OK,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })));

    const response = await handler({ url: 'https://unit.wampums.app/api/v1/activities' });

    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual({ success: true, data: [1] });
    expect(cached.get('https://unit.wampums.app/api/v1/activities')).toEqual({ success: true, data: [1] });
  });

  test('a real network failure still falls back to the offline answer', async () => {
    const { handler } = loadHandler(() => Promise.reject(new TypeError('Failed to fetch')));

    const response = await handler({ url: 'https://unit.wampums.app/api/v1/activities' });

    expect(response.status).toBe(HTTP_SERVICE_UNAVAILABLE);
  });
});
