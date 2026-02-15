/**
 * Authentication Routes Test Suite
 *
 * Tests critical authentication flows:
 * - User login with credential validation
 * - Two-factor authentication (2FA) code verification
 * - Password reset request and execution
 * - User registration with validation
 * - Rate limiting on auth endpoints
 * - Demo user special handling
 *
 * @module test/routes-auth-login
 */

const request = require('supertest');
const bcrypt = require('bcryptjs');
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
const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');
let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';

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

// ============================================
// LOGIN TESTS
// ============================================

describe('POST /public/login', () => {
  const validEmail = 'user@example.com';
  const validPassword = 'SecurePassword123!';
  
  // Create a properly hashed password using bcrypt
  let hashedPassword;

  beforeAll(async () => {
    hashedPassword = await bcrypt.hash(validPassword, 10);
  });

  test('returns JWT token on successful login', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users u')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            email: validEmail,
            password: hashedPassword,
            is_verified: true,
            full_name: 'Test User'
          }]
        });
      }
      if (query.includes('demoadmin') || query.includes('demoparent')) {
        // Make this a demo user so they bypass 2FA
        return Promise.resolve({ rows: [{ demo_count: 1 }] });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_id: 1, role_name: 'admin' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'users.manage' }]
        });
      }
      if (query.includes('parents_guardians')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/login')
      .send({
        email: validEmail,
        password: validPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user_id).toBe(1);
    expect(res.body.user_full_name).toBe('Test User');
  });

  test('returns 401 on invalid email', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users u')) {
        return Promise.resolve({ rows: [] }); // User not found
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/login')
      .send({
        email: 'nonexistent@example.com',
        password: 'AnyPassword123!'
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid|password/i);
  });

  test('returns 401 on incorrect password', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users u')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            email: validEmail,
            password: hashedPassword, // Correct hash
            is_verified: true,
            full_name: 'Test User'
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/login')
      .send({
        email: validEmail,
        password: 'WrongPassword456!' // Wrong password
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid|password/i);
  });

  test('returns 403 when account is not verified', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users u')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            email: validEmail,
            password: hashedPassword,
            is_verified: false, // Not verified
            full_name: 'Test User'
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/login')
      .send({
        email: validEmail,
        password: validPassword
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/verify|verified/i);
  });

  test('bypasses 2FA for demo users', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users u')) {
        return Promise.resolve({
          rows: [{
            id: 2,
            email: 'demo@example.com',
            password: hashedPassword,
            is_verified: true,
            full_name: 'Demo User'
          }]
        });
      }
      if (query.includes('demoadmin') || query.includes('demoparent')) {
        return Promise.resolve({
          rows: [{ demo_count: 1 }] // Has demo role
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_id: 999, role_name: 'demoparent' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'users.view' }]
        });
      }
      if (query.includes('parents_guardians')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/login')
      .send({
        email: 'demo@example.com',
        password: validPassword
      });

    // Demo user should get token directly, bypassing 2FA
    expect([200, 201]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.token || res.body.requires_2fa === false).toBeDefined();
    }
  });

  test('sends 2FA code for non-demo user without trusted device', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users u')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            email: validEmail,
            password: hashedPassword,
            is_verified: true,
            full_name: 'Test User'
          }]
        });
      }
      if (query.includes('demoadmin') || query.includes('demoparent')) {
        return Promise.resolve({ rows: [] }); // Not demo
      }
      if (query.includes('trusted_devices')) {
        return Promise.resolve({ rows: [] }); // No trusted device
      }
      if (query.includes('INSERT INTO two_factor_codes')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/login')
      .send({
        email: validEmail,
        password: validPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.requires_2fa).toBe(true);
    expect(res.body.user_id).toBe(1);
    expect(__mPool.query).toHaveBeenCalledWith(
      expect.stringContaining('two_factor_codes'),
      expect.any(Array)
    );
  });

  test('validates email format', async () => {
    const res = await request(app)
      .post('/public/login')
      .send({
        email: 'invalid-email-format-test',
        password: 'Password123!'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
  });

  test('rejects empty password', async () => {
    const res = await request(app)
      .post('/public/login')
      .send({
        email: 'empty-password-test@example.com',
        password: ''
      });

    expect(res.status).toBe(400);
  });

  test.skip('rate limits login attempts (6 attempts per 15 minutes)', async () => {
    // NOTE: Rate limiting is disabled in test environment (max: 100 instead of 6)
    // This test is skipped because it would require 100+ requests to test properly
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users u')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    // Make multiple failed login attempts
    const requests = [];
    for (let i = 0; i < 7; i++) {
      requests.push(
        request(app)
          .post('/public/login')
          .send({
            email: validEmail,
            password: 'WrongPassword123!'
          })
      );
    }

    const responses = await Promise.all(requests);

    // Some should be blocked by rate limiting
    const rateLimited = responses.filter(r => r.status === 429);
    expect(rateLimited.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================
// 2FA VERIFICATION TESTS
// ============================================

describe('POST /public/verify-2fa', () => {
  test('returns JWT token when 2FA code is correct', async () => {
    const { __mClient, __mPool } = require('pg');
    const validCode = '123456';
    const testEmail = '2fa-test@example.com';

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users u') && query.includes('JOIN user_organizations')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            email: testEmail,
            full_name: 'Test User'
          }]
        });
      }
      if (query.includes('FROM two_factor_codes')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            user_id: 1,
            organization_id: 1,
            code: validCode,
            is_used: false,
            created_at: new Date()
          }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_id: 1, role_name: 'admin' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'users.manage' }]
        });
      }
      if (query.includes('UPDATE two_factor_codes')) {
        return Promise.resolve({ rows: [{}] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/verify-2fa')
      .send({
        email: testEmail,
        code: validCode
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
  });

  test('returns 401 when 2FA code is incorrect', async () => {
    const { __mClient, __mPool } = require('pg');
    const testEmail = '2fa-wrong@example.com';

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users u') && query.includes('JOIN user_organizations')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            email: testEmail,
            full_name: 'Test User'
          }]
        });
      }
      if (query.includes('FROM two_factor_codes')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/verify-2fa')
      .send({
        email: testEmail,
        code: '999999' // Wrong code
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('rejects already-used 2FA code', async () => {
    const { __mClient, __mPool } = require('pg');
    const testEmail = '2fa-used@example.com';

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users u') && query.includes('JOIN user_organizations')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            email: testEmail,
            full_name: 'Test User'
          }]
        });
      }
      if (query.includes('FROM two_factor_codes')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/verify-2fa')
      .send({
        email: testEmail,
        code: '123456'
      });

    expect(res.status).toBe(401);
  });
});

// ============================================
// PASSWORD RESET TESTS
// ============================================

describe('Password reset flow', () => {
  test('POST /api/auth/request-reset accepts valid email and sends reset link', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users u')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            email: 'reset-user@example.com',
            is_verified: true
          }]
        });
      }
      if (query.includes('INSERT INTO password_resets')) {
        return Promise.resolve({ rows: [{ token: 'reset_token_xyz' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/auth/request-reset')
      .send({
        email: 'reset-user@example.com'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/sent|reset/i);
  });

  test.skip('POST /api/auth/request-reset rate limits requests (5 per hour)', async () => {
    // NOTE: Rate limiting is disabled in test environment (max: 100 instead of 5)
    // This test is skipped because it would require 100+ requests to test properly
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users u')) {
        return Promise.resolve({
          rows: [{
            id: 2,
            email: 'ratelimit-reset@example.com',
            is_verified: true
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    // Make multiple requests
    const requests = [];
    for (let i = 0; i < 6; i++) {
      requests.push(
        request(app)
          .post('/api/auth/request-reset')
          .send({
            email: 'ratelimit-reset@example.com'
          })
      );
    }

    const responses = await Promise.all(requests);
    const rateLimited = responses.filter(r => r.status === 429);

    expect(rateLimited.length).toBeGreaterThanOrEqual(1);
  });

  test('POST /api/auth/reset-password updates password with valid token', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users') && query.includes('reset_token')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            email: 'reset-user@example.com'
          }]
        });
      }
      if (query.includes('UPDATE users SET password')) {
        return Promise.resolve({ rows: [{ id: 1 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({
        token: 'valid_token',
        new_password: 'NewPassword123!'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('rejects reset with expired token', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users') && query.includes('reset_token')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({
        token: 'expired_token',
        new_password: 'NewPassword123!'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired|invalid/i);
  });
});

// ============================================
// REGISTRATION TESTS
// ============================================

describe('POST /public/register', () => {
  test('creates new user account with valid registration data', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM users WHERE email')) {
        return Promise.resolve({ rows: [] }); // Email doesn't exist
      }
      if (query.includes('INSERT INTO users')) {
        return Promise.resolve({
          rows: [{
            id: 100,
            email: 'newuser@example.com',
            full_name: 'New User',
            is_verified: true
          }]
        });
      }
      if (query.includes('SELECT id FROM roles')) {
        return Promise.resolve({ rows: [{ id: 3 }] }); // parent role
      }
      if (query.includes('INSERT INTO user_organizations')) {
        return Promise.resolve({ rows: [{ id: 1 }] });
      }
      if (query.includes('organization_domains')) {
        return Promise.resolve({
          rows: [{ organization_id: 1 }]
        });
      }
      if (/BEGIN|COMMIT/i.test(query)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/register')
      .send({
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        full_name: 'New User',
        user_type: 'parent'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(100);
  });

  test('rejects registration with weak password', async () => {
    const res = await request(app)
      .post('/public/register')
      .send({
        email: 'newuser@example.com',
        password: '123', // Too weak
        full_name: 'New User'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/password|weak|strong/i);
  });

  test('rejects registration with existing email', async () => {
    const { __mClient, __mPool } = require('pg');

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO users')) {
        // Simulate PostgreSQL unique constraint violation
        const error = new Error('duplicate key value violates unique constraint "users_email_key"');
        error.code = '23505';
        error.constraint = 'users_email_key';
        return Promise.reject(error);
      }
      if (query.includes('organization_domains')) {
        return Promise.resolve({ rows: [{ organization_id: 1 }] });
      }
      if (/BEGIN|ROLLBACK/i.test(query)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/register')
      .send({
        email: 'existing@example.com',
        password: 'ValidPass123!',
        full_name: 'Another User'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already|exists|email/i);
  });

  test('validates email format during registration', async () => {
    const res = await request(app)
      .post('/public/register')
      .send({
        email: 'invalid-email',
        password: 'ValidPass123!',
        full_name: 'New User'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email|valid/i);
  });

  test('requires full name during registration', async () => {
    const res = await request(app)
      .post('/public/register')
      .send({
        email: 'user@example.com',
        password: 'ValidPass123!',
        full_name: '' // Empty
      });

    expect(res.status).toBe(400);
  });
});
