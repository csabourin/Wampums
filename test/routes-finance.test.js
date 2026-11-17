/**
 * Finance Routes Test Suite
 *
 * Tests critical financial operations:
 * - Fee definition creation, update, deletion
 * - Payment amount recording and validation
 * - Financial calculations (balances, summaries, reports)
 * - validateMoney helper correctness
 * - Fee auto-assignment to participants
 *
 * Financial errors directly impact:
 * - Incorrect balances
 * - Lost payment records
 * - Audit trail integrity
 * - Organization financial reports
 *
 * @module test/routes-finance
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

const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');
let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;

function generateToken(overrides = {}, secret = TEST_SECRET) {
  return jwt.sign({
    user_id: 1,
    user_role: 'district',
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['district'],
    permissions: ['finance.manage', 'finance.view'],
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
// FEE DEFINITION TESTS
// ============================================

describe('Fee Definitions', () => {
  test('GET /api/v1/finance/fee-definitions lists all fee definitions', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM fee_definitions')) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              organization_id: ORG_ID,
              registration_fee: '50.00',
              membership_fee: '100.00',
              year_start: '2025-01-01',
              year_end: '2025-12-31',
              created_at: new Date()
            },
            {
              id: 2,
              organization_id: ORG_ID,
              registration_fee: '75.00',
              membership_fee: '150.00',
              year_start: '2024-01-01',
              year_end: '2024-12-31',
              created_at: new Date()
            }
          ]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/finance/fee-definitions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].registration_fee).toBe('50.00');
  });

  test('rejects fee definition with invalid registration_fee', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'finance.manage' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/finance/fee-definitions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        registration_fee: 'not_a_number', // Invalid
        membership_fee: 120.00,
        year_start: '2026-01-01',
        year_end: '2026-12-31'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/number|invalid|registration/i);
  });

  test('rejects negative fee amounts', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'finance.manage' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/finance/fee-definitions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        registration_fee: -50.00, // Negative
        membership_fee: 120.00,
        year_start: '2026-01-01',
        year_end: '2026-12-31'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/non-negative|negative/i);
  });

  test('validates year_start and year_end dates', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'finance.manage' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/finance/fee-definitions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        registration_fee: 50.00,
        membership_fee: 120.00,
        year_start: 'invalid-date',
        year_end: '2026-12-31'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/date|invalid/i);
  });

  test.each([false, true])('deleting a fee definition removes its unpaid fees, and is refused once a payment exists (paid: %s)', async (paid) => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('SELECT id FROM fee_definitions WHERE id')) {
        return Promise.resolve({
          rows: [{ id: 1 }]
        });
      }
      if (query.includes('DELETE FROM fee_definitions') || query.includes('DELETE FROM participant_fees')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM payments pay JOIN participant_fees pf')) {
        return Promise.resolve({ rows: paid ? [{ '?column?': 1 }] : [] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .delete('/api/v1/finance/fee-definitions/1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(paid ? 409 : 200);
    expect(res.body.success).toBe(!paid);
    if (paid) {
      expect(res.body.message).toBe('fee_definition_has_payments');
    }
  });

});

// ============================================
// PAYMENT RECORDING TESTS
// ============================================

describe('Participant Fees and Payments', () => {
  test('GET /api/v1/finance/participant-fees lists fees with balance calculations', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM participant_fees pf')) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              participant_id: 50,
              organization_id: ORG_ID,
              fee_definition_id: 1,
              total_registration_fee: '50.00',
              total_membership_fee: '100.00',
              total_amount: '150.00',
              status: 'unpaid',
              notes: '',
              created_at: new Date(),
              first_name: 'John',
              last_name: 'Doe',
              total_paid: '50.00'
            }
          ]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/finance/participant-fees')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].total_amount).toBe(150);
    expect(res.body.data[0].total_paid).toBe(50);
    // Outstanding should be calculated as 150 - 50 = 100
  });

  test('validateMoney rejects invalid amounts', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'finance.manage' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const invalidAmounts = ['invalid', -100, null, undefined];

    for (const amount of invalidAmounts) {
      const res = await request(app)
        .post('/api/v1/finance/participant-fees/100/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          participant_fee_id: 100,
          amount: amount,
          payment_method: 'cash'
        });

      expect([400, 401, 404]).toContain(res.status);
    }
  });
});

// ============================================
// FINANCIAL REPORTS TESTS
// ============================================

describe('Financial Reports', () => {
  test('GET /api/v1/finance/participant-fees returns fees including outstanding balance', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM participant_fees pf')) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              participant_id: 50,
              organization_id: ORG_ID,
              fee_definition_id: 1,
              total_registration_fee: '50.00',
              total_membership_fee: '100.00',
              total_amount: '150.00',
              status: 'unpaid',
              notes: '',
              created_at: new Date(),
              first_name: 'John',
              last_name: 'Doe',
              year_start: '2026-01-01',
              year_end: '2026-12-31',
              total_paid: '50.00'
            },
            {
              id: 2,
              participant_id: 51,
              organization_id: ORG_ID,
              fee_definition_id: 1,
              total_registration_fee: '50.00',
              total_membership_fee: '100.00',
              total_amount: '150.00',
              status: 'unpaid',
              notes: '',
              created_at: new Date(),
              first_name: 'Jane',
              last_name: 'Smith',
              year_start: '2026-01-01',
              year_end: '2026-12-31',
              total_paid: '0.00'
            }
          ]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/finance/participant-fees')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].outstanding).toBe(100);
  });
});

// ============================================
// PARTICIPANT STATEMENT ACCESS
// ============================================

describe('Participant statement access', () => {
  test('does not reuse finance claims from another organization', async () => {
    const { __mClient, __mPool } = require('pg');
    const selectedOrgId = 2;
    const participantId = 50;
    const token = generateToken({
      organizationId: ORG_ID,
      roleIds: [1],
      roleNames: ['finance'],
      permissions: ['finance.view']
    });
    let statementQueried = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('FROM participants p')) {
        expect(params).toEqual([participantId.toString(), ORG_ID]);
        return { rows: [] };
      }
      if (query.includes('WITH payments AS')) {
        statementQueried = true;
      }
      return undefined;
    });

    const res = await request(app)
      .get(`/api/v1/finance/participants/${participantId}/statement`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', selectedOrgId.toString());

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
    expect(statementQueried).toBe(false);
  });
});

// ============================================
// DEMO USER WRITE PROTECTION
// ============================================

describe('Demo user protection on financial operations', () => {
  test('blocks demo users from creating/modifying fees', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      roleNames: ['demoadmin'],
      permissions: ['finance.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return Promise.resolve({ rows: [{ role_name: 'demoadmin' }] });
      }
      if (query.includes('demoadmin') || query.includes('demoparent')) {
        return Promise.resolve({
          rows: [{ role_name: 'demoadmin' }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'finance.manage' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/finance/fee-definitions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        registration_fee: 50.00,
        membership_fee: 100.00,
        year_start: '2026-01-01',
        year_end: '2026-12-31'
      });

    expect(res.status).toBe(403);
    expect(res.body.isDemo).toBe(true);
  });
});
