/** Sensitive self profiles and revocable peer contacts bypass all offline caches. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../src-sw.js'), 'utf8');
const start = source.indexOf('function isPersonalProfileRequest(');
const end = source.indexOf('\n}', start) + 2;
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${source.slice(start, end)}\nthis.matches = isPersonalProfileRequest;`, sandbox);
test.each([
  '/api/v1/member-profile/me', '/api/v1/member-profile/me/health',
  '/api/v1/volunteer-space/camps/7/contacts', '/api/v1/volunteer-space/camps/7/contacts/',
  '/api/v1/camp-rosters/7',
  '/api/v1/camp-plans/camps/7/versions', '/api/v1/camp-plans/camps/7/versions/2/pdf',
])('%s cannot receive an offline cached answer', (pathname) => {
  expect(sandbox.matches({ url: new URL(`https://example.test${pathname}`) })).toBe(true);
});
test.each(['/api/v1/volunteer-space', '/api/v1/volunteer-space/camps/7', '/api/v1/activities', '/api/v1/camp-plans/camps/7'])('%s keeps its ordinary offline policy', (pathname) => {
  expect(sandbox.matches({ url: new URL(`https://example.test${pathname}`) })).toBe(false);
});
test('the sensitive network-only handler is registered before the generic API cache', () => {
  const route = 'registerRoute(isPersonalProfileRequest, new NetworkOnly())';
  expect(source.indexOf(route)).toBeGreaterThan(0);
  expect(source.indexOf(route)).toBeLessThan(source.indexOf('// 4d. API routes'));
});
