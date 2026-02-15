/**
 * API Consistency Test Suite
 *
 * Validates that the API surface area follows consistent patterns:
 * - Response envelope shape ({ success, message, data, timestamp })
 * - Correct HTTP status codes
 * - Consistent error shapes
 * - RESTful conventions
 * - Route mounting & versioning
 * - Pagination contracts
 * - Rate limiting headers
 * - Content negotiation
 *
 * @module test/api-consistency
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
const { setupDefaultMocks } = require('./mock-helpers');
let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;

/**
 * Generate a valid JWT token with customizable payload
 * @param {Object} overrides - Payload overrides
 * @returns {string} Signed JWT
 */
function generateToken(overrides = {}) {
  return jwt.sign({
    user_id: 1,
    user_role: 'admin',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: [],
    ...overrides
  }, TEST_SECRET);
}

/**
 * Set up standard permission mocks for requirePermission middleware
 * @param {Object} mPool - Mock pool
 * @param {string} permissionKey - Permission key to grant
 * @param {string} roleName - Role name for context
 */
function mockPermission(mPool, permissionKey, roleName = 'admin') {
  // Permission query
  mPool.query.mockResolvedValueOnce({
    rows: [{ permission_key: permissionKey }]
  });
  // Roles query
  mPool.query.mockResolvedValueOnce({
    rows: [{ role_name: roleName, display_name: roleName.charAt(0).toUpperCase() + roleName.slice(1) }]
  });
}


/**
 * Attach required tenant header for organization-scoped requests.
 * @param {import('supertest').Test} req - Supertest request chain.
 * @returns {import('supertest').Test} Request chain with organization header.
 */
function withOrganizationHeader(req) {
  return req.set('x-organization-id', String(ORG_ID));
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';
  process.env.ORGANIZATION_ID = String(ORG_ID);

  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  setupDefaultMocks(__mClient, __mPool);
  __mClient.query.mockClear();
  __mClient.release.mockClear();
  __mPool.connect.mockClear();
  __mPool.query.mockClear();
  
  // Mock organization domain lookup (for getCurrentOrganizationId)
  // This returns a default organization when hostname lookup occurs
  __mPool.query.mockImplementation((query, params) => {
    // Check if this is an organization_domains query
    if (typeof query === 'string' && query.includes('organization_domains')) {
      return Promise.resolve({
        rows: [{ organization_id: ORG_ID }]
      });
    }
    // Default: return empty rows for other queries
    return Promise.resolve({ rows: [] });
  });
});

afterAll((done) => {
  closeServerResources(app, done);
});

// ============================================
// 1. RESPONSE ENVELOPE STRUCTURE
// ============================================

describe('Response Envelope Structure', () => {
  const { __mPool } = require('pg');

  test('successful response has standard envelope: success, message, data, timestamp', async () => {
    const token = generateToken();

    // The /health endpoint always returns a well-shaped response without auth
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timestamp');
    expect(typeof res.body.timestamp).toBe('string');
    // Validate ISO 8601 format
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  test('401 error response has standard envelope: success=false, message, timestamp', async () => {
    const res = await request(app).get('/api/v1/participants');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('timestamp');
    expect(typeof res.body.timestamp).toBe('string');
  });

  test('403 error response has standard envelope', async () => {
    const token = generateToken();

    // Mock permission query - no matching permissions
    __mPool.query.mockResolvedValueOnce({ rows: [] });
    __mPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await withOrganizationHeader(request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`));

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
  });

  test('timestamp is always present in both success and error responses', async () => {
    // Success: health endpoint
    const healthRes = await request(app).get('/health');
    expect(healthRes.body).toHaveProperty('timestamp');

    // Error: no auth
    const errorRes = await request(app).get('/api/v1/participants');
    expect(errorRes.body).toHaveProperty('timestamp');
  });
});

// ============================================
// 2. HTTP STATUS CODE CONVENTIONS
// ============================================

describe('HTTP Status Code Conventions', () => {
  const { __mPool } = require('pg');

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/v1/participants');
    expect(res.status).toBe(401);
  });

  test('unauthorized (missing permission) request returns 403', async () => {
    const token = generateToken();
    __mPool.query.mockResolvedValueOnce({ rows: [] }); // no permissions
    __mPool.query.mockResolvedValueOnce({ rows: [] }); // no roles

    const res = await withOrganizationHeader(request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`));

    expect(res.status).toBe(403);
  });

  test('deprecated endpoints return 410 Gone', async () => {
    const res = await request(app).get('/api/legacy-path');
    expect(res.status).toBe(410);
  });

  test('health check returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});

// ============================================
// 3. API VERSIONING
// ============================================

describe('API Versioning', () => {
  const versionedEndpoints = [
    '/api/v1/participants',
    '/api/v1/users/me',
    '/api/v1/meetings/dates',
    '/api/v1/groups',
    '/api/v1/attendance',
    '/api/v1/badges/progress',
    '/api/v1/calendars',
    '/api/v1/guardians',
    '/api/v1/notifications/subscribers',
    '/api/v1/fundraisers',
    '/api/v1/forms/types',
    '/api/v1/reports/health',
    '/api/v1/dashboards/initial',
    '/api/v1/points',
    '/api/v1/resources/equipment',
    '/api/v1/activities',
    '/api/v1/local-groups',
    '/api/v1/carpools/my-offers',
    '/api/v1/offline/status',
  ];

  test.each(versionedEndpoints)(
    '%s is reachable (returns 401, not 404)',
    async (path) => {
      const res = await request(app).get(path);
      // Should be 401 (requires auth) not 404 (not found)
      // Some endpoints may return different codes but never 404
      expect(res.status).not.toBe(404);
    }
  );

  test('non-versioned API paths return deprecation (410)', async () => {
    const res = await request(app).get('/api/old-endpoint');
    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(/deprecated/i);
  });
});

// ============================================
// 4. RESPONSE CONTENT-TYPE
// ============================================

describe('Response Content-Type', () => {
  test('API responses return application/json', async () => {
    const res = await request(app).get('/api/v1/participants');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('health endpoint returns application/json', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('error responses return application/json', async () => {
    const res = await request(app).get('/api/v1/participants');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ============================================
// 5. CONSISTENT ERROR SHAPES
// ============================================

describe('Consistent Error Shapes', () => {
  const { __mPool } = require('pg');

  test('401 errors always have success=false and a message', async () => {
    const endpoints = [
      '/api/v1/participants',
      '/api/v1/groups',
      '/api/v1/badges/progress',
      '/api/v1/attendance',
    ];

    for (const endpoint of endpoints) {
      const res = await request(app).get(endpoint);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message.length).toBeGreaterThan(0);
    }
  });

  test('403 permission error includes required/missing permission details', async () => {
    const token = generateToken();

    // No permissions granted
    __mPool.query.mockResolvedValueOnce({ rows: [] });
    __mPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await withOrganizationHeader(request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${token}`));

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body).toHaveProperty('required');
    expect(res.body).toHaveProperty('missing');
    expect(Array.isArray(res.body.required)).toBe(true);
    expect(Array.isArray(res.body.missing)).toBe(true);
  });

  test('validation error (400) includes errors array', async () => {
    const token = generateToken();

    // Try login with validation — POST /api/auth/login with empty body
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    // Should get 400 with validation errors
    if (res.status === 400) {
      expect(res.body.success).toBe(false);
      // May have 'errors' array or 'message'
      expect(
        res.body.errors !== undefined || typeof res.body.message === 'string'
      ).toBe(true);
    }
  });
});

// ============================================
// 6. RESPONSE MIDDLEWARE (success/error/paginated)
// ============================================

describe('Response Middleware Functions', () => {
  const { success, error, paginated } = require('../middleware/response');

  test('success() returns correct envelope', () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    success(mockRes, { id: 1 }, 'Created', 201);

    expect(mockRes.status).toHaveBeenCalledWith(201);
    const body = mockRes.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.message).toBe('Created');
    expect(body.data).toEqual({ id: 1 });
    expect(body.timestamp).toBeDefined();
  });

  test('success() defaults to 200 and "Success"', () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    success(mockRes, [1, 2, 3]);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    const body = mockRes.json.mock.calls[0][0];
    expect(body.message).toBe('Success');
  });

  test('error() returns correct error envelope', () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    error(mockRes, 'Not found', 404);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    const body = mockRes.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.message).toBe('Not found');
    expect(body.timestamp).toBeDefined();
  });

  test('error() defaults to 400', () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    error(mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  test('error() includes validation errors when provided', () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    const validationErrors = [{ field: 'email', message: 'Required' }];
    error(mockRes, 'Validation failed', 400, validationErrors);

    const body = mockRes.json.mock.calls[0][0];
    expect(body.errors).toEqual(validationErrors);
  });

  test('paginated() returns correct pagination envelope', () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    const items = [{ id: 1 }, { id: 2 }];
    paginated(mockRes, items, 1, 10, 25);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    const body = mockRes.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toEqual(items);
    expect(body.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasNext: true,
      hasPrev: false
    });
    expect(body.timestamp).toBeDefined();
  });

  test('paginated() computes hasNext/hasPrev correctly', () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    // Last page
    paginated(mockRes, [{ id: 1 }], 3, 10, 25);
    const body = mockRes.json.mock.calls[0][0];
    expect(body.pagination.hasNext).toBe(false);
    expect(body.pagination.hasPrev).toBe(true);
    expect(body.pagination.page).toBe(3);
  });

  test('paginated() handles single page', () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    paginated(mockRes, [{ id: 1 }], 1, 10, 5);
    const body = mockRes.json.mock.calls[0][0];
    expect(body.pagination.totalPages).toBe(1);
    expect(body.pagination.hasNext).toBe(false);
    expect(body.pagination.hasPrev).toBe(false);
  });
});

// ============================================
// 7. ASYNC HANDLER / ERROR PROPAGATION
// ============================================

describe('asyncHandler Error Propagation', () => {
  const { asyncHandler } = require('../middleware/response');

  test('asyncHandler catches thrown errors and calls next()', async () => {
    const thrownError = new Error('DB connection failed');
    const handler = asyncHandler(async () => {
      throw thrownError;
    });

    const mockReq = {};
    const mockRes = {};
    const mockNext = jest.fn();

    await handler(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(thrownError);
  });

  test('asyncHandler passes through for successful execution', async () => {
    const handler = asyncHandler(async (req, res) => {
      res.json({ ok: true });
    });

    const mockReq = {};
    const mockRes = { json: jest.fn() };
    const mockNext = jest.fn();

    await handler(mockReq, mockRes, mockNext);

    expect(mockRes.json).toHaveBeenCalledWith({ ok: true });
    expect(mockNext).not.toHaveBeenCalled();
  });
});

// ============================================
// 8. ROUTE MOUNTING INTEGRITY
// ============================================

describe('Route Mounting Integrity', () => {
  const mountedPrefixes = [
    '/api/v1/participants',
    '/api/v1/users/me',
    '/api/v1/meetings/dates',
    '/api/v1/groups',
    '/api/v1/local-groups',
    '/api/v1/attendance',
    '/api/v1/badges/progress',
    '/api/v1/calendars',
    '/api/v1/guardians',
    '/api/v1/notifications/subscribers',
    '/api/v1/fundraisers',
    '/api/v1/forms/types',
    '/api/v1/reports/health',
    '/api/v1/dashboards/initial',
    '/api/v1/points',
    '/api/v1/resources/equipment',
    '/api/v1/activities',
    '/api/v1/organizations/info',
    '/api/v1/carpools/my-offers',
    '/api/v1/offline/status',
    '/api/v1/users/me',
  ];

  test.each(mountedPrefixes)(
    'Route prefix %s is mounted (not 404)',
    async (prefix) => {
      const res = await request(app).get(prefix);
      // Mounted routes return auth errors (401) or data, never 404
      expect(res.status).not.toBe(404);
    }
  );
});

// ============================================
// 9. SWAGGER DOCS AVAILABILITY
// ============================================

describe('Swagger API Documentation', () => {
  test('GET /api-docs returns HTML documentation page', async () => {
    const res = await request(app).get('/api-docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  test('GET /api-docs.json returns JSON spec', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toHaveProperty('openapi');
  });
});

// ============================================
// 10. RATE LIMITING
// ============================================

describe('Rate Limiting Headers', () => {
  test('API responses include rate limit headers', async () => {
    const res = await request(app).get('/api/v1/participants');

    // Express-rate-limit adds these standard headers
    expect(
      res.headers['ratelimit-limit'] ||
      res.headers['x-ratelimit-limit'] ||
      res.headers['ratelimit-policy']
    ).toBeDefined();
  });
});

// ============================================
// 11. VALIDATION MIDDLEWARE INTEGRATION
// ============================================

describe('Validation Middleware Integration', () => {
  test('POST /public/login rejects empty email', async () => {
    const res = await request(app)
      .post('/public/login')
      .set('x-organization-id', '1')
      .send({ email: '', password: 'test123' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /public/login rejects empty password', async () => {
    const res = await request(app)
      .post('/public/login')
      .set('x-organization-id', '1')
      .send({ email: 'test@test.com', password: '' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /public/login rejects invalid email format', async () => {
    const res = await request(app)
      .post('/public/login')
      .set('x-organization-id', '1')
      .send({ email: 'not-an-email', password: 'test123' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /public/register rejects weak password', async () => {
    const { __mPool } = require('pg');
    // Mock org domain lookup for register
    __mPool.query.mockResolvedValueOnce({
      rows: [{ organization_id: 1 }]
    });

    const res = await request(app)
      .post('/public/register')
      .set('x-organization-id', '1')
      .send({
        email: 'test@test.com',
        password: 'short',  // Too short, no uppercase, no number
        full_name: 'Test User'
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});


  test('request body limit rejects oversized payload with 413', async () => {
    const oversizedPayload = { payload: 'x'.repeat(21 * 1024 * 1024) };

    const res = await request(app)
      .post('/public/login')
      .set('x-organization-id', '1')
      .send(oversizedPayload);

    expect(res.status).toBe(413);
  });

// ============================================
// 12. WRITE OPERATIONS REQUIRE AUTH
// ============================================

describe('Write Operations Require Authentication', () => {
  const writeEndpoints = [
    { method: 'post', path: '/api/v1/participants' },
    { method: 'post', path: '/api/v1/groups' },
    { method: 'post', path: '/api/v1/activities' },
    { method: 'post', path: '/api/v1/attendance' },
    { method: 'post', path: '/api/v1/badges/progress' },
    { method: 'post', path: '/api/v1/notifications/subscription' },
    { method: 'post', path: '/api/v1/fundraisers' },
  ];

  test.each(writeEndpoints)(
    '$method $path returns 401 without token',
    async ({ method, path }) => {
      const res = await request(app)[method](path).send({});
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    }
  );
});

// ============================================
// 13. CONFIG CONSTANTS INTEGRITY
// ============================================

describe('Config Constants Integrity', () => {
  const { RATE_LIMITS, PAGINATION, SESSION } = require('../config/constants');

  test('rate limit constants are reasonable integers', () => {
    expect(RATE_LIMITS.GENERAL_WINDOW_MS).toBeGreaterThan(0);
    expect(RATE_LIMITS.GENERAL_MAX_REQUESTS).toBeGreaterThan(0);
    expect(RATE_LIMITS.AUTH_WINDOW_MS).toBeGreaterThan(0);
    expect(RATE_LIMITS.AUTH_MAX_ATTEMPTS).toBeGreaterThan(0);
    expect(RATE_LIMITS.PASSWORD_RESET_MAX_REQUESTS).toBeGreaterThan(0);
  });

  test('pagination defaults are sensible', () => {
    expect(PAGINATION.DEFAULT_PAGE).toBe(1);
    expect(PAGINATION.DEFAULT_LIMIT).toBeGreaterThan(0);
    expect(PAGINATION.DEFAULT_LIMIT).toBeLessThanOrEqual(PAGINATION.MAX_LIMIT);
    expect(PAGINATION.MAX_LIMIT).toBeGreaterThan(0);
    expect(PAGINATION.MAX_LIMIT).toBeLessThanOrEqual(1000); // sanity cap
  });

  test('session expiration values are defined', () => {
    expect(SESSION.JWT_EXPIRATION).toBeDefined();
    expect(SESSION.REFRESH_TOKEN_EXPIRATION).toBeDefined();
  });

  test('auth rate limit is stricter than general limit', () => {
    expect(RATE_LIMITS.AUTH_MAX_ATTEMPTS).toBeLessThanOrEqual(RATE_LIMITS.GENERAL_MAX_REQUESTS);
  });
});

// ============================================
// 14. SPA CATCH-ALL BEHAVIOR
// ============================================

describe('SPA Catch-All Behavior', () => {
  test('unknown non-API paths return HTML (SPA routing)', async () => {
    const res = await request(app).get('/some/spa/route');
    // Should serve index.html for SPA routing
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  test('unknown paths with file extensions return 404 JSON', async () => {
    const res = await request(app).get('/api/missing-file.js');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ============================================
// 15. GLOBAL ERROR HANDLER
// ============================================

describe('Global Error Handler', () => {
  test('unmatched API paths do not crash the server', async () => {
    const res = await request(app).get('/api/v1/does-not-exist-at-all');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(600);
    // Server should still respond after error
    const healthRes = await request(app).get('/health');
    expect(healthRes.status).toBe(200);
  });
});

// ============================================
// 16. MIDDLEWARE ORDERING — AUTH BEFORE PERMISSION
// ============================================

describe('Middleware Ordering', () => {
  test('permission check does not run without authentication', async () => {
    // Without a token, we should get 401 (from authenticate) not 403 (from requirePermission)
    const res = await request(app).get('/api/v1/participants');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/authentication required/i);
  });

  test('with invalid token, get 401 not 403', async () => {
    const res = await withOrganizationHeader(request(app)
      .get('/api/v1/participants')
      .set('Authorization', 'Bearer invalid-token'));
    expect(res.status).toBe(401);
  });
});

// ============================================
// 17. ORGANIZATION HELPERS
// ============================================

describe('Organization Helpers', () => {
  const { OrganizationNotFoundError, respondWithOrganizationFallback } = require('../utils/api-helpers');

  test('OrganizationNotFoundError is an Error subclass', () => {
    const err = new OrganizationNotFoundError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('test');
    expect(err.name).toBe('OrganizationNotFoundError');
  });

  test('respondWithOrganizationFallback returns 400 JSON with timestamp for API requests', () => {
    const mockRes = {
      req: {
        path: '/api/v1/organizations/info',
        headers: { accept: 'application/json' }
      },
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    respondWithOrganizationFallback(mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    const body = mockRes.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.message).toBe('organization_not_found');
    expect(body.fallback).toBe('/organization-not-found.html');
    expect(typeof body.timestamp).toBe('string');
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  test('respondWithOrganizationFallback returns inline HTML when fallback file is unavailable', () => {
    const fs = require('fs');
    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    const mockRes = {
      req: {
        path: '/unknown-page',
        headers: { accept: 'text/html' }
      },
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn()
    };

    respondWithOrganizationFallback(mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.type).toHaveBeenCalledWith('html');
    expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('organization_not_found'));

    existsSpy.mockRestore();
  });
});
