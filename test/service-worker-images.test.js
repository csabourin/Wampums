/**
 * Run the real image route matcher. The worker's fetch obeys its own
 * connect-src, so a cross-origin image it intercepted would be blocked even
 * though the page's img-src allows it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMatcher() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src-sw.js'), 'utf8');
  const start = source.indexOf('function isCacheableImageRequest');
  const end = source.indexOf('// 4e.', start);
  const context = { self: { location: { origin: 'https://meute6a.app' } } };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.matcher = isCacheableImageRequest;`, context);
  return (href, destination = 'image') => context.matcher({ request: { destination }, url: new URL(href) });
}

test('the app\'s own images are cached', () => {
  expect(loadMatcher()('https://meute6a.app/images/icon-192x192.png')).toBe(true);
});

test.each([
  'https://files.wampums.app/wampums/equipment/7/photo.webp?X-Amz-Signature=abc',
  'https://bucket.storage.railway.app/equipment/7/photo.webp?X-Amz-Signature=abc',
  'https://www.gravatar.com/avatar/abc',
])('a cross-origin photo is left to the browser: %s', (href) => {
  expect(loadMatcher()(href)).toBe(false);
});

test('a same-origin request that is not an image is not routed as one', () => {
  expect(loadMatcher()('https://meute6a.app/api/v1/equipment', '')).toBe(false);
});
