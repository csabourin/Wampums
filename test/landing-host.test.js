const request = require('supertest');

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

let app;

beforeAll(() => {
  // Set required env variables
  process.env.JWT_SECRET_KEY = 'testsecret';
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';

  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  __mClient.query.mockReset();
  __mClient.release.mockReset();
  __mPool.connect.mockClear();
  __mPool.query.mockReset();
  __mPool.query.mockResolvedValue({ rows: [] });
});

afterAll((done) => {
  // Close server and socket.io to prevent hanging
  if (app.server) {
    app.server.close(() => {
      if (app.io) {
        app.io.close();
      }
      done();
    });
  } else {
    done();
  }
});

describe('Landing Host Routing - wampums.app', () => {
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
    test('does not redirect / on demo.wampums.app', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'demo.wampums.app')
        .set('Accept-Language', 'fr-CA');

      // Should not redirect, will likely get 404 or serve different content
      expect(res.status).not.toBe(302);
    });

    test('does not redirect / on other subdomains', async () => {
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
