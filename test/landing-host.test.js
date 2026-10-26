const request = require('supertest');
const { closeServerResources } = require('./test-helpers');

// Mock pg module before requiring app
jest.mock('pg', () => {
  const mClient = {
    query: jest.fn(),
    release: jest.fn()
  };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(),
    on: jest.fn()
  };
  return {
    Pool: jest.fn(() => mPool),
    __esModule: true,
    __mClient: mClient,
    __mPool: mPool
  };
});

const { setupDefaultMocks } = require('./mock-helpers');
let app;

beforeAll(() => {
  // Set required env variables
  process.env.JWT_SECRET_KEY = 'testsecret';
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';
  process.env.DEV_WEB_ORIGIN = 'http://127.0.0.1:5173';

  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  setupDefaultMocks(__mClient, __mPool);
  __mClient.query.mockClear();
  __mClient.release.mockClear();
  __mPool.connect.mockClear();
  __mPool.query.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('Landing Host Routing - wampums.app', () => {
  test.each(['wampums.app', 'www.wampums.app'])('%s permits the analytics script and collection requests', async (host) => {
    const res = await request(app).get('/en/').set('Host', host);
    expect(res.status).toBe(200);
    const directives = Object.fromEntries(res.headers['content-security-policy'].split(';').map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }));
    expect(directives['script-src']).toContain('https://*.googletagmanager.com');
    expect(directives['connect-src']).toEqual(expect.arrayContaining([
      'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com',
    ]));
    expect(directives['img-src']).toEqual(expect.arrayContaining([
      'https://*.google-analytics.com', 'https://*.googletagmanager.com',
    ]));
  });

  test('the app host does not load or permit landing analytics', async () => {
    const res = await request(app).get('/').set('Host', 'demo.wampums.app');
    expect(res.headers['content-security-policy']).not.toMatch(/google-analytics\.com|analytics\.google\.com|googletagmanager\.com/);
    expect(res.text).not.toContain('G-T3TDD2WS36');
  });

  describe('Root path redirects', () => {
    test('redirects / to /en/ when Accept-Language is en-US', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'en-US,en;q=0.9');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/en/');
    });

    test('redirects / to /fr/ when Accept-Language is fr-CA', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'fr-CA,fr;q=0.9');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/fr/');
    });

    test('redirects / to /en/ when English has higher priority than French', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'en-CA,en;q=0.9,fr;q=0.1');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/en/');
    });

    test('redirects / to /fr/ when French has higher priority than English', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'fr-CA,fr;q=0.9,en;q=0.1');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/fr/');
    });

    test('redirects / to /en/ when no Accept-Language header is present', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'wampums.app');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/en/');
    });

    test('redirects /index.html to /en/ with English Accept-Language', async () => {
      const res = await request(app)
        .get('/index.html')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'en-US');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/en/');
    });

    test('redirects /index.html to /fr/ with French Accept-Language', async () => {
      const res = await request(app)
        .get('/index.html')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'fr-FR');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/fr/');
    });
  });

  describe('Query parameter lang override', () => {
    test('redirects / to /fr/ when ?lang=fr is specified, ignoring Accept-Language', async () => {
      const res = await request(app)
        .get('/?lang=fr')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'en-US,en;q=0.9');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/fr/');
    });

    test('redirects / to /en/ when ?lang=en is specified, ignoring Accept-Language', async () => {
      const res = await request(app)
        .get('/?lang=en')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'fr-CA,fr;q=0.9');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/en/');
    });

    test('handles case-insensitive lang parameter', async () => {
      const res = await request(app)
        .get('/?lang=FR')
        .set('Host', 'wampums.app');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/fr/');
    });
  });

  describe('Retired pages', () => {
    test.each([
      ['/en/compare/wampums-vs-scouts-digital/', '/en/compare/wampums-vs-scoutstracker/'],
      ['/fr/comparer/wampums-vs-scouts-digital/', '/fr/comparer/wampums-vs-scoutstracker/'],
      ['/fr/comparatif/wampums-vs-scouts-digital/', '/fr/comparer/wampums-vs-scoutstracker/'],
      ['/en/blog/bilingual-scout-challenges/', '/en/blog/bilingual-scout-group-challenges-canada/'],
    ])('%s moves permanently to %s', async (from, to) => {
      const res = await request(app).get(from).set('Host', 'wampums.app');

      expect(res.status).toBe(301);
      expect(res.header.location).toBe(to);
    });
  });

  describe('Sitemaps', () => {
    test.each(['/en/sitemap.xml', '/fr/sitemap.xml'])('the retired %s sends crawlers to the complete sitemap', async (from) => {
      const res = await request(app).get(from).set('Host', 'wampums.app');

      expect(res.status).toBe(301);
      expect(res.header.location).toBe('/sitemap.xml');
    });

    test('the sitemap lists every page of the site in English, with its French alternate', async () => {
      const res = await request(app).get('/sitemap.xml').set('Host', 'wampums.app');
      const { LANDING_STATIC_PAGES } = require('../config/landing-pages');

      expect(res.status).toBe(200);
      LANDING_STATIC_PAGES.forEach(({ en, fr }) => {
        expect(res.text).toContain(`<loc>https://wampums.app${en}</loc>`);
        expect(res.text).toContain(`href="https://wampums.app${fr}"`);
      });
    });
  });

  describe('Canonical trailing slash redirects', () => {
    test('redirects /en to /en/ with 301 permanent redirect', async () => {
      const res = await request(app)
        .get('/en')
        .set('Host', 'wampums.app');

      expect(res.status).toBe(301);
      expect(res.header.location).toBe('/en/');
    });

    test('redirects /fr to /fr/ with 301 permanent redirect', async () => {
      const res = await request(app)
        .get('/fr')
        .set('Host', 'wampums.app');

      expect(res.status).toBe(301);
      expect(res.header.location).toBe('/fr/');
    });

    test('a page without its trailing slash gets one, on the same page', async () => {
      const res = await request(app)
        .get('/fr/blogue/premier-article')
        .set('Host', 'wampums.app');

      expect(res.status).toBe(301);
      expect(res.header.location).toBe('/fr/blogue/premier-article/');
    });

    test('a doubled slash cannot turn the trailing-slash redirect into another site', async () => {
      const res = await request(app)
        .get('/en//evil.example')
        .set('Host', 'wampums.app');

      expect(res.status).toBe(301);
      expect(res.header.location).toBe('/en//evil.example/');
      expect(res.header.location.startsWith('/en/')).toBe(true);
    });
  });

  describe('Legacy /landing* redirects', () => {
    test('redirects /landing to /en/ with 302 temporary redirect when Accept-Language is English', async () => {
      const res = await request(app)
        .get('/landing')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'en-US');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/en/');
    });

    test('redirects /landing/ to /fr/ with 302 temporary redirect when Accept-Language is French', async () => {
      const res = await request(app)
        .get('/landing/')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'fr-CA');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/fr/');
    });

    test('redirects /landing/index.html to /en/ with 302 temporary redirect', async () => {
      const res = await request(app)
        .get('/landing/index.html')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'en-US');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/en/');
    });

    test('redirects /landing with ?lang=fr query parameter', async () => {
      const res = await request(app)
        .get('/landing?lang=fr')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'en-US');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/fr/');
    });
  });

  describe('www.wampums.app subdomain', () => {
    test('redirects www.wampums.app/ to /en/ with English Accept-Language', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'www.wampums.app')
        .set('Accept-Language', 'en-US');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/en/');
    });

    test('redirects www.wampums.app/ to /fr/ with French Accept-Language', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'www.wampums.app')
        .set('Accept-Language', 'fr-CA');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/fr/');
    });

    test('applies canonical trailing slash redirects on www subdomain', async () => {
      const res = await request(app)
        .get('/en')
        .set('Host', 'www.wampums.app');

      expect(res.status).toBe(301);
      expect(res.header.location).toBe('/en/');
    });
  });

  describe('Non-landing hosts', () => {
    test('an unused hostname redirects before serving a static app file', async () => {
      require('pg').__mPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/index.html?token=fictional').set('Host', 'unused.wampums.app');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://wampums.app/');
      expect(res.headers['cache-control']).toBe('no-store');
    });

    test('does not redirect / on demo.wampums.app', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'demo.wampums.app')
        .set('Accept-Language', 'fr-CA');

      // Should not redirect, will likely get 404 or serve different content
      expect(res.status).not.toBe(302);
    });

    test('an assigned unit subdomain does not redirect to the landing page', async () => {
      require('pg').__mPool.query.mockResolvedValueOnce({ rows: [{ organization_id: 1 }] });
      const res = await request(app)
        .get('/')
        .set('Host', 'app.wampums.app')
        .set('Accept-Language', 'fr-CA');

      // Should not redirect to /fr/
      expect(res.status).not.toBe(302);
    });
  });

  describe('Edge cases', () => {
    test('handles Accept-Language with only fr substring in non-primary position', async () => {
      // Africa is not a french language code but contains "fr"
      const res = await request(app)
        .get('/')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'en-ZA,en;q=0.9,zu;q=0.8');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/en/');
    });

    test('handles malformed Accept-Language header gracefully', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'invalid-header;;;');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/en/');
    });

    test('handles empty lang query parameter', async () => {
      const res = await request(app)
        .get('/?lang=')
        .set('Host', 'wampums.app')
        .set('Accept-Language', 'fr-CA');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/fr/');
    });

    test('handles lang parameter with whitespace', async () => {
      const res = await request(app)
        .get('/?lang= fr ')
        .set('Host', 'wampums.app');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/fr/');
    });
  });
});

describe('Local development web routing', () => {
  test('redirects HTML navigation from the API port to Vite', async () => {
    const res = await request(app)
      .get('/register?source=api-port')
      .set('Host', '127.0.0.1:5000')
      .set('Accept', 'text/html');

    expect(res.status).toBe(307);
    expect(res.header.location).toBe('http://127.0.0.1:5173/register?source=api-port');
  });
});
