const fs = require('fs');
const vm = require('vm');
function check({ missing = [], shell = true } = {}) {
  const source = fs.readFileSync('src-sw.js', 'utf8');
  const start = source.indexOf('async function verifyOfflineAssets(');
  const end = source.indexOf('// Section 9:', start);
  const context = {
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


test('an unvisited SPA route can reload offline using the retained shell', async () => {
  const source = fs.readFileSync('src-sw.js', 'utf8');
  const start = source.indexOf('async function handleAppNavigation(');
  const end = source.indexOf('const navigationRoute', start);
  const shell = { ok: true, html: 'cached application shell' };
  const context = {
    OFFLINE_SHELL_CACHE: 'offline-shell', OFFLINE_SHELL_URL: '/index.html',
    navigationHandler: { handle: () => Promise.reject(new TypeError('offline')) },
    caches: { open: () => Promise.resolve({ match: () => Promise.resolve(shell) }) },
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.navigate = handleAppNavigation;`, context);
  expect(await context.navigate({ request: { url: 'https://unit.test/manage-points' } })).toBe(shell);
});
