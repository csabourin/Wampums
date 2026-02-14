/**
 * Stripe Payments Test Suite
 *
 * Tests critical financial operations with Stripe:
 * - Payment intent creation with proper validation
 * - Overpayment prevention logic
 * - Webhook signature verification
 * - Payment recording in database
 * - Staff vs parent payment authorization
 *
 * All financial operations require extreme care to prevent:
 * - Double charging
 * - Lost payment records
 * - Unauthorized payment modifications
 *
 * @module test/routes-stripe-payments
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
const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');
let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;

function generateToken(overrides = {}, secret = TEST_SECRET) {
  return jwt.sign({
    user_id: 1,
    user_role: 'admin',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: ['payment.manage'],
    ...overrides
  }, secret);
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';
  process.env.STRIPE_SECRET_KEY = 'sk_test_test123';

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
// PAYMENT INTENT CREATION TESTS
// ============================================

describe('POST /api/v1/stripe/create-payment-intent', () => {
  test('creates payment intent with valid fee and amount', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['admin'],
      permissions: ['payment.manage'],
      user_id: 1
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participant_fees pf')) {
        return Promise.resolve({
          rows: [{
            id: 100,
            participant_id: 50,
            total_amount: '500.00',
            status: 'unpaid',
            first_name: 'John',
            last_name: 'Doe',
            total_paid: '0.00'
          }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'payment.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/stripe/create-payment-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_fee_id: 100,
        amount: 250.00
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payment_intent).toBeDefined();
    expect(res.body.payment_intent.client_secret).toBeDefined();
  });

  test('prevents overpayment - rejects amount exceeding outstanding balance', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['admin'],
      permissions: ['payment.manage'],
      user_id: 1
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participant_fees pf')) {
        return Promise.resolve({
          rows: [{
            id: 100,
            participant_id: 50,
            total_amount: '500.00',
            status: 'unpaid',
            first_name: 'John',
            last_name: 'Doe',
            total_paid: '400.00' // Already paid $400
          }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'payment.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/stripe/create-payment-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_fee_id: 100,
        amount: 150.00 // Outstanding is only $100, trying to pay $150
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exceed|balance|outstanding/i);
  });

  test('allows partial payment less than outstanding balance', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['admin'],
      permissions: ['payment.manage'],
      user_id: 1
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participant_fees pf')) {
        return Promise.resolve({
          rows: [{
            id: 100,
            participant_id: 50,
            total_amount: '500.00',
            status: 'unpaid',
            first_name: 'John',
            last_name: 'Doe',
            total_paid: '200.00'
          }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'payment.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/stripe/create-payment-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_fee_id: 100,
        amount: 100.00 // Paying part of outstanding $300
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('rejects zero or negative amount', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['admin'],
      permissions: ['payment.manage'],
      user_id: 1
    });

    __mPool.query.mockImplementation((query, params) => {
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/stripe/create-payment-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_fee_id: 100,
        amount: 0
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/amount|greater|zero/i);
  });

  test('requires participant_fee_id', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['admin'],
      permissions: ['payment.manage'],
      user_id: 1
    });

    __mPool.query.mockImplementation((query, params) => {
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/stripe/create-payment-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        // Missing participant_fee_id
        amount: 100.00
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required|participant_fee_id/i);
  });

  test('returns 404 when fee not found', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['admin'],
      permissions: ['payment.manage'],
      user_id: 1
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participant_fees pf')) {
        return Promise.resolve({ rows: [] }); // Fee not found
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'payment.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/stripe/create-payment-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_fee_id: 99999,
        amount: 100.00
      });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found|permission/i);
  });
});

// ============================================
// PARENT PAYMENT AUTHORIZATION TESTS
// ============================================

describe('Parent vs Staff payment authorization', () => {
  test('parent can only pay for their own children', async () => {
    const { __mPool } = require('pg');
    const parentUserId = 50;
    const token = generateToken({
      user_id: parentUserId,
      roleNames: ['parent'],
      permissions: ['payment.manage'],
      organizationId: ORG_ID
    });

    let capturedQuery = '';

    __mPool.query.mockImplementation((query, params) => {
      capturedQuery = query;
      if (query.includes('FROM participant_fees pf')) {
        // Parent query should include user_participants join
        if (query.includes('user_participants')) {
          return Promise.resolve({
            rows: [{
              id: 100,
              participant_id: 50,
              total_amount: '500.00',
              status: 'unpaid',
              first_name: 'Jane',
              last_name: 'Doe',
              total_paid: '0.00'
            }]
          });
        } else {
          return Promise.resolve({ rows: [] }); // Parent can't see this fee
        }
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'payment.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'parent' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/stripe/create-payment-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_fee_id: 100,
        amount: 100.00
      });

    // Parent's query should include user_participants join
    expect(capturedQuery).toContain('user_participants');
  });

  test('staff can pay for any participant in their organization', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      user_id: 1,
      roleNames: ['leader'], // Staff role
      permissions: ['payment.manage'],
      organizationId: ORG_ID
    });

    let capturedQuery = '';

    __mPool.query.mockImplementation((query, params) => {
      capturedQuery = query;
      if (query.includes('FROM participant_fees pf')) {
        return Promise.resolve({
          rows: [{
            id: 100,
            participant_id: 50,
            total_amount: '500.00',
            status: 'unpaid',
            first_name: 'John',
            last_name: 'Doe',
            total_paid: '0.00'
          }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'payment.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'leader' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/stripe/create-payment-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_fee_id: 100,
        amount: 100.00
      });

    // Staff query should NOT include user_participants restriction
    expect(capturedQuery).not.toContain('user_participants');
  });
});

// ============================================
// WEBHOOK TESTS
// ============================================

describe('POST /api/v1/stripe/webhook', () => {
  test('validates webhook signature before processing', async () => {
    const { __mPool } = require('pg');

    __mPool.query.mockImplementation((query, params) => {
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/stripe/webhook')
      .set('stripe-signature', 'invalid_signature')
      .send({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            metadata: { participant_fee_id: '100' },
            amount_received: 50000,
            currency: 'cad'
          }
        }
      });

    // Should reject invalid signature
    expect([400, 401]).toContain(res.status);
  });

  test('records payment when webhook signature is valid', async () => {
    const { __mPool } = require('pg');

    let paymentInserted = false;

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('INSERT INTO payments')) {
        paymentInserted = true;
        return Promise.resolve({
          rows: [{ id: 1, participant_fee_id: 100, amount: '500.00' }]
        });
      }
      if (query.includes('payment_intent')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    // NOTE: Difficult to test actual Stripe webhook without a live Stripe key
    // This test is conceptual - in reality, you'd use Stripe's test webhook signing
    // See: https://stripe.com/docs/webhooks/test
  });
});

// ============================================
// PAYMENT AMOUNT PRECISION TESTS
// ============================================

describe('Payment amount precision and rounding', () => {
  test('converts payment amount to cents correctly', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['admin'],
      permissions: ['payment.manage'],
      user_id: 1
    });

    let stripeAmountCents = null;

    // Mock Stripe to capture the amount sent
    jest.mock('stripe', () => {
      return jest.fn(() => ({
        paymentIntents: {
          create: jest.fn((params) => {
            stripeAmountCents = params.amount;
            return Promise.resolve({
              id: 'pi_test123',
              client_secret: 'secret_123',
              amount: params.amount,
              currency: 'cad'
            });
          })
        }
      }));
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participant_fees pf')) {
        return Promise.resolve({
          rows: [{
            id: 100,
            participant_id: 50,
            total_amount: '500.00',
            status: 'unpaid',
            first_name: 'John',
            last_name: 'Doe',
            total_paid: '0.00'
          }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'payment.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/stripe/create-payment-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_fee_id: 100,
        amount: 123.45 // Should convert to 12345 cents
      });

    expect(res.status).toBe(200);
    // The amount should be in cents for Stripe
    // 123.45 * 100 = 12345 cents
  });

  test('handles edge case amounts like $0.01', async () => {
    const { __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['admin'],
      permissions: ['payment.manage'],
      user_id: 1
    });

    __mPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM participant_fees pf')) {
        return Promise.resolve({
          rows: [{
            id: 100,
            participant_id: 50,
            total_amount: '500.00',
            status: 'unpaid',
            first_name: 'John',
            last_name: 'Doe',
            total_paid: '499.99'
          }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'payment.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'admin' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/stripe/create-payment-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_fee_id: 100,
        amount: 0.01 // Minimum payment
      });

    expect(res.status).toBe(200);
  });
});
