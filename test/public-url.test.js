const {
  DEFAULT_PUBLIC_BASE_URL,
  normalizeOrigin,
  resolveOrganizationBaseUrl
} = require('../utils/public-url');

const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  if (originalPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

test('prefers a configured trusted origin and strips paths', async () => {
  process.env.PUBLIC_BASE_URL = 'https://portal.wampums.app/untrusted-path';
  const pool = { query: jest.fn() };

  await expect(resolveOrganizationBaseUrl(pool, 9)).resolves.toBe('https://portal.wampums.app');
  expect(pool.query).not.toHaveBeenCalled();
});

test('uses an exact organization domain and excludes wildcard records in SQL', async () => {
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_URL;
  const pool = { query: jest.fn().mockResolvedValue({ rows: [{ domain: 'unit.example.org' }] }) };

  await expect(resolveOrganizationBaseUrl(pool, 9)).resolves.toBe('https://unit.example.org');
  expect(pool.query.mock.calls[0][0]).toContain("domain NOT LIKE '%*%'");
});

test('rejects wildcard, credentialed and non-http origins', () => {
  expect(normalizeOrigin('*.example.org')).toBeNull();
  expect(normalizeOrigin('https://user:secret@example.org')).toBeNull();
  expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
  expect(DEFAULT_PUBLIC_BASE_URL).toBe('https://wampums.app');
});
