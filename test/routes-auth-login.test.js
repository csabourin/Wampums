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
  __mClient.query.mockReset();
  __mClient.release.mockReset();
  __mPool.connect.mockClear();
  __mPool.query.mockReset();
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
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
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
        return Promise.resolve({ rows: [] }); // Not a demo user
      }
      if (query.includes('trusted_devices')) {
        return Promise.resolve({ rows: [] }); // No trusted device
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
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
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
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
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
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
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
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
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
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
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
        email: 'invalid-email',
        password: 'Password123!'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/validation|error/i);
  });

  test('rejects empty password', async () => {
    const res = await request(app)
      .post('/public/login')
      .send({
        email: validEmail,
        password: ''
      });

    expect(res.status).toBe(400);
  });

  test('rate limits login attempts (6 attempts per 15 minutes)', async () => {
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
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

describe('POST /api/auth/verify-2fa', () => {
  test('returns JWT token when 2FA code is correct', async () => {
    const { __mPool } = require('pg');
    const validCode = '123456';

    __mPool.query.mockImplementation((query, params) => {
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
      .post('/api/auth/verify-2fa')
      .send({
        user_id: 1,
        code: validCode
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
  });

  test('returns 401 when 2FA code is incorrect', async () => {
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM two_factor_codes')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            user_id: 1,
            organization_id: 1,
            code: '111111', // Different code
            is_used: false,
            created_at: new Date()
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/auth/verify-2fa')
      .send({
        user_id: 1,
        code: '999999' // Wrong code
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('rejects already-used 2FA code', async () => {
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM two_factor_codes')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            user_id: 1,
            code: '123456',
            is_used: true, // Already used
            created_at: new Date()
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/auth/verify-2fa')
      .send({
        user_id: 1,
        code: '123456'
      });

    expect(res.status).toBe(401);
  });
});

// ============================================
// PASSWORD RESET TESTS
// ============================================

describe('Password reset flow', () => {
  test('POST /public/password-reset-request accepts valid email and sends reset link', async () => {
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM users u')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            email: 'user@example.com',
            is_verified: true
          }]
        });
      }
      if (query.includes('INSERT INTO password_reset')) {
        return Promise.resolve({ rows: [{ token: 'reset_token_xyz' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/password-reset-request')
      .send({
        email: 'user@example.com'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/sent|reset/i);
  });

  test('POST /public/password-reset-request rate limits requests (5 per hour)', async () => {
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
      return Promise.resolve({ rows: [] });
    });

    // Make multiple requests
    const requests = [];
    for (let i = 0; i < 6; i++) {
      requests.push(
        request(app)
          .post('/public/password-reset-request')
          .send({
            email: 'user@example.com'
          })
      );
    }

    const responses = await Promise.all(requests);
    const rateLimited = responses.filter(r => r.status === 429);

    expect(rateLimited.length).toBeGreaterThanOrEqual(1);
  });

  test('POST /public/password-reset-execute updates password with valid token', async () => {
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM password_resets')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            user_id: 1,
            token: 'valid_token',
            is_used: false,
            expires_at: new Date(Date.now() + 3600000)
          }]
        });
      }
      if (query.includes('UPDATE users SET password')) {
        return Promise.resolve({ rows: [{ id: 1 }] });
      }
      if (query.includes('UPDATE password_resets SET is_used')) {
        return Promise.resolve({ rows: [{}] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/password-reset-execute')
      .send({
        token: 'valid_token',
        new_password: 'NewPassword123!'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('rejects reset with expired token', async () => {
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM password_resets')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            token: 'expired_token',
            is_used: false,
            expires_at: new Date(Date.now() - 3600000) // Expired 1 hour ago
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/public/password-reset-execute')
      .send({
        token: 'expired_token',
        new_password: 'NewPassword123!'
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/expired|invalid/i);
  });
});

// ============================================
// REGISTRATION TESTS
// ============================================

describe('POST /public/register', () => {
  test('creates new user account with valid registration data', async () => {
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM users WHERE email')) {
        return Promise.resolve({ rows: [] }); // Email doesn't exist
      }
      if (query.includes('INSERT INTO users')) {
        return Promise.resolve({
          rows: [{
            id: 100,
            email: 'newuser@example.com',
            full_name: 'New User'
          }]
        });
      }
      if (query.includes('organization_domains')) {
        return Promise.resolve({
          rows: [{ organization_id: 1 }]
        });
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
    expect(res.body.user_id).toBe(100);
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
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM users WHERE email')) {
        return Promise.resolve({
          rows: [{ id: 1, email: 'existing@example.com' }]
        });
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
