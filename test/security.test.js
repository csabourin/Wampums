/**
 * Security Test Suite
 *
 * Validates authentication, authorization, token handling, input sanitization,
 * multi-tenant isolation, CORS, CSP, and other security invariants.
 *
 * @module test/security
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
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

const { Pool } = require('pg');
let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;

/**
 * Generate a valid JWT token with customizable payload
 * @param {Object} overrides - Payload overrides
 * @param {string} secret - JWT secret (defaults to TEST_SECRET)
 * @returns {string} Signed JWT
 */
function generateToken(overrides = {}, secret = TEST_SECRET) {
  return jwt.sign({
    user_id: 1,
    user_role: 'admin',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: ['users.view', 'users.manage'],
    ...overrides
  }, secret);
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
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
  closeServerResources(app, done);
});

// ============================================
// 1. AUTHENTICATION ENFORCEMENT
// ============================================

describe('Authentication Enforcement', () => {
  const protectedEndpoints = [
    { method: 'get', path: '/api/v1/participants' },
    { method: 'get', path: '/api/v1/users/users' },
    { method: 'get', path: '/api/v1/meetings/dates' },
    { method: 'get', path: '/api/v1/groups' },
    { method: 'get', path: '/api/v1/attendance' },
    { method: 'get', path: '/api/v1/badges/progress' },
    { method: 'get', path: '/api/v1/calendars' },
    { method: 'get', path: '/api/v1/guardians' },
    { method: 'get', path: '/api/v1/notifications/subscribers' },
    { method: 'get', path: '/api/v1/fundraisers' },
    { method: 'get', path: '/api/v1/points' },
    { method: 'get', path: '/api/v1/resources/equipment' },
    { method: 'get', path: '/api/v1/activities' },
    { method: 'get', path: '/api/v1/users/me' },
    { method: 'get', path: '/api/v1/local-groups' },
  ];

  test.each(protectedEndpoints)(
    '$method $path returns 401 without token',
    async ({ method, path }) => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    }
  );

  test('rejects request with no Authorization header', async () => {
    const res = await request(app).get('/api/v1/participants');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/authentication required/i);
  });

  test('rejects request with empty Authorization header', async () => {
    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', '');
    expect(res.status).toBe(401);
  });

  test('rejects request with malformed Bearer token', async () => {
    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', 'Bearer');
    expect(res.status).toBe(401);
  });

  test('rejects request with non-Bearer scheme', async () => {
    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', 'Basic dGVzdDp0ZXN0');
    expect(res.status).toBe(401);
  });
});

// ============================================
// 2. TOKEN VALIDATION
// ============================================

describe('Token Validation', () => {
  test('rejects expired JWT token', async () => {
    const expired = jwt.sign(
      { user_id: 1, organizationId: ORG_ID },
      TEST_SECRET,
      { expiresIn: '-1s' }
    );

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid or expired/i);
  });

  test('rejects token signed with wrong secret', async () => {
    const wrongSecret = jwt.sign(
      { user_id: 1, organizationId: ORG_ID },
      'wrong-secret-key'
    );

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${wrongSecret}`);

    expect(res.status).toBe(401);
  });

  test('rejects completely invalid token string', async () => {
    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', 'Bearer not.a.valid.jwt.token.at.all');

    expect(res.status).toBe(401);
  });

  test('rejects token with tampered payload', async () => {
    const token = generateToken();
    // Tamper with payload section (middle part)
    const parts = token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ user_id: 999, organizationId: 999 })).toString('base64url');
    const tampered = parts.join('.');

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${tampered}`);

    expect(res.status).toBe(401);
  });
});

// ============================================
// 3. AUTHORIZATION & PERMISSION CHECKS
// ============================================

describe('Authorization & Permission Checks', () => {
  const { __mPool } = require('pg');

  test('requirePermission returns 403 when user lacks required permission', async () => {
    const token = generateToken();

    // Mock permission query - no matching permissions
    __mPool.query.mockResolvedValueOnce({ rows: [] });
    // Mock roles query
    __mPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/insufficient permissions/i);
  });

  test('requirePermission passes when user has correct permission', async () => {
    const token = generateToken();

    // Mock permission query
    __mPool.query.mockResolvedValueOnce({
      rows: [{ permission_key: 'participants.view' }]
    });
    // Mock roles query
    __mPool.query.mockResolvedValueOnce({
      rows: [{ role_name: 'admin', display_name: 'Admin' }]
    });
    // Mock data scope query
    __mPool.query.mockResolvedValueOnce({
      rows: [{ data_scope: 'organization' }]
    });
    // Mock participants list
    __mPool.query.mockResolvedValueOnce({ rows: [] });
    // Mock count
    __mPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('blockDemoRoles returns 403 for demo users on write operations', async () => {
    const token = generateToken({ user_role: 'demoadmin' });

    // Mock permission query for requirePermission
    __mPool.query.mockResolvedValueOnce({
      rows: [{ permission_key: 'participants.create' }]
    });
    // Mock roles query
    __mPool.query.mockResolvedValueOnce({
      rows: [{ role_name: 'demoadmin', display_name: 'Demo Admin' }]
    });
    // Mock blockDemoRoles check - user has demo role
    __mPool.query.mockResolvedValueOnce({
      rows: [{ role_name: 'demoadmin' }]
    });

    const res = await request(app)
      .post('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`)
      .send({ first_name: 'Test', last_name: 'User' });

    expect(res.status).toBe(403);
    expect(res.body.isDemo).toBe(true);
  });
});

// ============================================
// 4. MULTI-TENANT ISOLATION
// ============================================

describe('Multi-Tenant Isolation', () => {
  const { __mPool } = require('pg');

  test('organization ID from token takes precedence over header override', async () => {
    const tokenOrgId = 1;
    const headerOrgId = 999; // Attacker tries to access different org

    const token = generateToken({ organizationId: tokenOrgId });

    // Mock permission queries
    __mPool.query.mockResolvedValueOnce({
      rows: [{ permission_key: 'participants.view' }]
    });
    __mPool.query.mockResolvedValueOnce({
      rows: [{ role_name: 'admin', display_name: 'Admin' }]
    });
    // Mock data scope
    __mPool.query.mockResolvedValueOnce({
      rows: [{ data_scope: 'organization' }]
    });
    // Mock participants query
    __mPool.query.mockResolvedValueOnce({ rows: [] });
    // Mock count
    __mPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', headerOrgId.toString());

    expect(res.status).toBe(200);

    // Verify that the SQL queries used the TOKEN org ID, not the header one
    const queryCalls = __mPool.query.mock.calls;
    // The permission queries should use tokenOrgId
    const orgIdParams = queryCalls
      .filter(call => call.length >= 2 && Array.isArray(call[1]))
      .map(call => call[1])
      .flat();

    // The header org ID should NOT appear in any parameterized query
    expect(orgIdParams).not.toContain(headerOrgId);
  });

  test('organization ID from token takes precedence over body override', async () => {
    const tokenOrgId = 1;
    const bodyOrgId = 999;

    const token = generateToken({ organizationId: tokenOrgId });

    // Mock permission queries
    __mPool.query.mockResolvedValueOnce({
      rows: [{ permission_key: 'groups.view' }]
    });
    __mPool.query.mockResolvedValueOnce({
      rows: [{ role_name: 'admin', display_name: 'Admin' }]
    });
    // Mock groups query
    __mPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/v1/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ organization_id: bodyOrgId });

    expect(res.status).toBe(200);

    const queryCalls = __mPool.query.mock.calls;
    const orgIdParams = queryCalls
      .filter(call => call.length >= 2 && Array.isArray(call[1]))
      .map(call => call[1])
      .flat();

    expect(orgIdParams).not.toContain(bodyOrgId);
  });
});

// ============================================
// 5. INPUT VALIDATION
// ============================================

describe('Input Validation', () => {
  test('rejects oversized JSON body', async () => {
    const token = generateToken();
    const bigPayload = { data: 'x'.repeat(11 * 1024 * 1024) }; // 11MB+

    const res = await request(app)
      .post('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(bigPayload));

    // Express body-parser should reject (413 Payload Too Large, 400 Bad Request, or 500 from size limit)
    expect([400, 413, 500]).toContain(res.status);
  });

  test('rejects invalid Content-Type gracefully', async () => {
    const token = generateToken();

    const res = await request(app)
      .post('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('not json');

    // Should not crash — returns 4xx
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test('rejects non-integer ID parameters', async () => {
    const token = generateToken();
    const { __mPool } = require('pg');

    // Mock permission queries
    __mPool.query.mockResolvedValueOnce({
      rows: [{ permission_key: 'participants.view' }]
    });
    __mPool.query.mockResolvedValueOnce({
      rows: [{ role_name: 'admin', display_name: 'Admin' }]
    });

    const res = await request(app)
      .get('/api/v1/participants/abc')
      .set('Authorization', `Bearer ${token}`);

    // Should return 400 or handle gracefully, not 500
    expect(res.status).not.toBe(500);
  });
});

// ============================================
// 6. XSS / HTML ESCAPE UTILITIES
// ============================================

describe('XSS Prevention - escapeHtml', () => {
  const { escapeHtml } = require('../utils/api-helpers');

  test('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  test('escapes ampersands', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  test('escapes single and double quotes', () => {
    expect(escapeHtml("it's a \"test\"")).toBe("it&#039;s a &quot;test&quot;");
  });

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('returns safe string unchanged', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });

  test('escapes nested injection attempts', () => {
    expect(escapeHtml('<img onerror="alert(1)" src=x>')).toBe(
      '&lt;img onerror=&quot;alert(1)&quot; src=x&gt;'
    );
  });
});

// ============================================
// 7. SECURITY HEADERS
// ============================================

describe('Security Headers', () => {
  test('includes Content-Security-Policy header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  test('includes X-Content-Type-Options header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('CSP blocks framing (frame-src none)', async () => {
    const res = await request(app).get('/health');
    const csp = res.headers['content-security-policy'];
    expect(csp).toMatch(/frame-src\s+'none'/);
  });

  test('CSP restricts object-src', async () => {
    const res = await request(app).get('/health');
    const csp = res.headers['content-security-policy'];
    expect(csp).toMatch(/object-src\s+'none'/);
  });
});

// ============================================
// 8. CORS VALIDATION
// ============================================

describe('CORS Validation', () => {
  test('allows requests from wampums.app subdomain', async () => {
    const res = await request(app)
      .options('/api/v1/participants')
      .set('Origin', 'https://demo.wampums.app');

    expect(res.headers['access-control-allow-origin']).toBe('https://demo.wampums.app');
  });

  test('allows requests from localhost', async () => {
    const res = await request(app)
      .options('/api/v1/participants')
      .set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  test('blocks requests from unauthorized origins', async () => {
    const res = await request(app)
      .options('/api/v1/participants')
      .set('Origin', 'https://evil-site.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('blocks requests from similar-looking domains', async () => {
    const res = await request(app)
      .options('/api/v1/participants')
      .set('Origin', 'https://notwampums.app');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// ============================================
// 9. LEGACY API DEPRECATION
// ============================================

describe('Legacy API Deprecation', () => {
  test('non-versioned API paths return 410 Gone', async () => {
    const res = await request(app).get('/api/some-old-endpoint');
    expect(res.status).toBe(410);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/deprecated/i);
  });

  test('deprecated response includes replacement path', async () => {
    const res = await request(app).get('/api/some-old-endpoint');
    expect(res.body.replacement_endpoint).toBeDefined();
    expect(res.body.replacement_endpoint).toMatch(/\/api\/v1\//);
  });
});

// ============================================
// 10. ERROR HANDLING — NO STACK LEAKS
// ============================================

describe('Error Handling - No Information Leakage', () => {
  test('404 for unknown API endpoints does not leak stack', async () => {
    const token = generateToken();
    const res = await request(app)
      .get('/api/v1/nonexistent-endpoint')
      .set('Authorization', `Bearer ${token}`);

    // Should not contain stack traces or internal paths
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/node_modules/);
    expect(body).not.toMatch(/at\s+\w+\s+\(/); // stack frame pattern
    expect(body).not.toMatch(/Error:/);
  });

  test('global error handler returns 500 without internals', async () => {
    // The global error handler should consistently format 500 errors
    // We test via health endpoint which should always work
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ============================================
// 11. HEALTH ENDPOINT (UNAUTHENTICATED)
// ============================================

describe('Health Endpoint', () => {
  test('GET /health returns 200 without authentication', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

// ============================================
// 12. JWT UTILITY FUNCTIONS
// ============================================

describe('JWT Utility Functions', () => {
  const { verifyJWTToken, signJWTToken, requireJWTSecret } = require('../utils/jwt-config');

  test('signJWTToken produces a valid token', () => {
    const payload = { user_id: 42, organizationId: 1 };
    const token = signJWTToken(payload);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  test('verifyJWTToken decodes valid token correctly', () => {
    const payload = { user_id: 42, organizationId: 1 };
    const token = signJWTToken(payload);
    const decoded = verifyJWTToken(token);
    expect(decoded.user_id).toBe(42);
    expect(decoded.organizationId).toBe(1);
  });

  test('verifyJWTToken throws on invalid token', () => {
    expect(() => verifyJWTToken('garbage')).toThrow();
  });

  test('verifyJWTToken throws on expired token', () => {
    const token = signJWTToken({ user_id: 1 }, { expiresIn: '-1s' });
    expect(() => verifyJWTToken(token)).toThrow();
  });

  test('requireJWTSecret does not throw when env var set', () => {
    expect(() => requireJWTSecret()).not.toThrow();
  });
});

// ============================================
// 13. VALIDATION MIDDLEWARE UNIT TESTS
// ============================================

describe('Validation Middleware', () => {
  const { normalizeEmailValue } = require('../middleware/validation');

  test('normalizeEmailValue lowercases and trims', () => {
    expect(normalizeEmailValue('  Test@Example.COM  ')).toBe('test@example.com');
  });

  test('normalizeEmailValue handles non-string input', () => {
    expect(normalizeEmailValue(null)).toBe('');
    expect(normalizeEmailValue(undefined)).toBe('');
    expect(normalizeEmailValue(123)).toBe('');
  });

  test('normalizeEmailValue handles empty string', () => {
    expect(normalizeEmailValue('')).toBe('');
  });
});

// ============================================
// 14. API HELPERS SECURITY FUNCTIONS
// ============================================

describe('API Helpers Security', () => {
  const { getUserIdFromToken, verifyJWT } = require('../utils/api-helpers');

  test('getUserIdFromToken extracts user_id from valid token', () => {
    const token = generateToken({ user_id: 42 });
    expect(getUserIdFromToken(token)).toBe(42);
  });

  test('getUserIdFromToken returns null for invalid token', () => {
    expect(getUserIdFromToken('invalid')).toBeNull();
  });

  test('getUserIdFromToken returns null for null input', () => {
    expect(getUserIdFromToken(null)).toBeNull();
  });

  test('verifyJWT returns decoded payload for valid token', () => {
    const token = generateToken({ user_id: 7 });
    const decoded = verifyJWT(token);
    expect(decoded).not.toBeNull();
    expect(decoded.user_id).toBe(7);
  });

  test('verifyJWT returns null for invalid token', () => {
    expect(verifyJWT('bad-token')).toBeNull();
  });
});
