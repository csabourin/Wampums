const fs = require('fs');
const vm = require('vm');
function check({ missing = [], shell = true } = {}) {
  const source = fs.readFileSync('src-sw.js', 'utf8');
  const start = source.indexOf('async function verifyOfflineAssets(');
  const end = source.indexOf('// Section 9:', start);
  const shellResponse = shell ? { ok: true, headers: { get: () => 'text/html' }, text: () => Promise.resolve('<script src="/old-entry.js"></script>') } : undefined;
  const context = {
    offlineShellResponse: () => Promise.resolve(shellResponse),
    URL, OFFLINE_SHELL_CACHE: 'offline-shell', OFFLINE_SHELL_URL: '/index.html', self: { location: { origin: 'https://unit.test' } },
    offlineManifest: [{ url: '/assets/attendance.js' }, { url: '/assets/points.css' }],
    getCacheKeyForURL: (url) => url,
    caches: {
      match: (url) => Promise.resolve(missing.some((suffix) => String(url).endsWith(suffix)) ? undefined : { ok: true }),
      open: () => Promise.resolve({ match: () => Promise.resolve(shell ? { ok: true, headers: { get: () => 'text/html' }, text: () => Promise.resolve('<script src="/old-entry.js"></script>') } : undefined) }),
    },
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.verify = verifyOfflineAssets;`, context);
  return context.verify(['/lang/fr.json?v=1', '/old-entry.js']);
}
test('readiness requires static screens, translations, this tab entry script and an HTML shell', async () => {
  expect(await check()).toBe(true);
  const results = await Promise.all(['/assets/attendance.js', '/assets/points.css', '/lang/fr.json?v=1', '/old-entry.js'].map((asset) => check({ missing: [asset] })));
  expect(results).toEqual([false, false, false, false]);
  expect(await check({ shell: false })).toBe(false);
});


/**
 * Load the navigation handler from the worker source with the given network
 * behaviour and installed shells.
 */
function loadNavigation({ network, precached = null, retained = null }) {
  const source = fs.readFileSync('src-sw.js', 'utf8');
  const start = source.indexOf('const NAVIGATION_NETWORK_TIMEOUT_MS');
  const end = source.indexOf('const navigationRoute', start);
  const context = {
    setTimeout, clearTimeout,
    OFFLINE_SHELL_CACHE: 'offline-shell', OFFLINE_SHELL_URL: '/index.html',
    navigationHandler: { handle: network },
    matchPrecache: () => Promise.resolve(precached),
    caches: { open: () => Promise.resolve({ match: () => Promise.resolve(retained) }) },
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.navigate = handleAppNavigation;\nthis.timeoutMs = NAVIGATION_NETWORK_TIMEOUT_MS;`, context);
  return context;
}

test('an unvisited SPA route can reload offline using the retained shell', async () => {
  const shell = { ok: true, html: 'cached application shell' };
  const sw = loadNavigation({ network: () => Promise.reject(new TypeError('offline')), retained: shell });
  expect(await sw.navigate({ request: { url: 'https://unit.test/manage-points' } })).toBe(shell);
});

test('the app starts offline from the shell installed with its scripts, even if no page was ever loaded through the worker', async () => {
  const installed = { ok: true, html: 'shell installed with this build' };
  const sw = loadNavigation({ network: () => Promise.reject(new TypeError('offline')), precached: installed });
  expect(await sw.navigate({ request: { url: 'https://unit.test/' } })).toBe(installed);
});

test('the installed shell is preferred over an older retained page, whose scripts may not be installed', async () => {
  const installed = { ok: true, html: 'this build' };
  const retained = { ok: true, html: 'another build' };
  const sw = loadNavigation({ network: () => Promise.reject(new TypeError('offline')), precached: installed, retained });
  expect(await sw.navigate({ request: { url: 'https://unit.test/tasks' } })).toBe(installed);
});

test('online, the app opens with the page the network serves', async () => {
  const fresh = { ok: true, html: 'network page' };
  const sw = loadNavigation({ network: () => Promise.resolve(fresh), precached: { ok: true } });
  expect(await sw.navigate({ request: { url: 'https://unit.test/' } })).toBe(fresh);
});

test('a network that never answers starts the app from the installed shell after the timeout', async () => {
  jest.useFakeTimers();
  try {
    const installed = { ok: true, html: 'this build' };
    const sw = loadNavigation({ network: () => new Promise(() => {}), precached: installed });
    const pending = sw.navigate({ request: { url: 'https://unit.test/' } });
    await jest.advanceTimersByTimeAsync(sw.timeoutMs);
    expect(await pending).toBe(installed);
  } finally {
    jest.useRealTimers();
  }
});

test('without any shell, an offline navigation still fails rather than showing a blank page', async () => {
  const sw = loadNavigation({ network: () => Promise.reject(new TypeError('offline')) });
  await expect(sw.navigate({ request: { url: 'https://unit.test/' } })).rejects.toThrow('offline');
});
