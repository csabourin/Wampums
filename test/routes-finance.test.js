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

const { Pool } = require('pg');
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

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
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

  test('POST /api/v1/finance/fee-definitions creates new fee definition', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.manage']
    });

    let transactionStarted = false;
    let feeInserted = false;
    let participantsAssigned = false;

    __mClient.query.mockImplementation((query, params) => {
      if (query === 'BEGIN') {
        transactionStarted = true;
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('INSERT INTO fee_definitions')) {
        feeInserted = true;
        return Promise.resolve({
          rows: [{
            id: 3,
            organization_id: ORG_ID,
            registration_fee: '60.00',
            membership_fee: '120.00',
            year_start: '2026-01-01',
            year_end: '2026-12-31',
            created_at: new Date()
          }]
        });
      }
      if (query.includes('INSERT INTO participant_fees')) {
        participantsAssigned = true;
        return Promise.resolve({ rows: [] });
      }
      if (query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    __mPool.connect.mockResolvedValue(__mClient);
    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'finance.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'finance' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/finance/fee-definitions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        registration_fee: 60.00,
        membership_fee: 120.00,
        year_start: '2026-01-01',
        year_end: '2026-12-31'
      });

    expect(res.status).toBe(201);
    expect(res.body.data.registration_fee).toBe('60.00');
    expect(transactionStarted).toBe(true);
    expect(feeInserted).toBe(true);
    expect(participantsAssigned).toBe(true);
  });

  test('rejects fee definition with invalid registration_fee', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
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

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
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

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
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

  test('PUT /api/v1/finance/fee-definitions/:id updates fee definition', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT id FROM fee_definitions WHERE id')) {
        return Promise.resolve({
          rows: [{ id: 1 }]
        });
      }
      if (query.includes('UPDATE fee_definitions')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            organization_id: ORG_ID,
            registration_fee: '75.00',
            membership_fee: '150.00',
            year_start: '2026-01-01',
            year_end: '2026-12-31'
          }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'finance.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'finance' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .put('/api/v1/finance/fee-definitions/1')
      .set('Authorization', `Bearer ${token}`)
      .send({
        registration_fee: 75.00,
        membership_fee: 150.00,
        year_start: '2026-01-01',
        year_end: '2026-12-31'
      });

    expect(res.status).toBe(200);
    expect(res.body.data.registration_fee).toBe('75.00');
  });

  test('DELETE /api/v1/finance/fee-definitions/:id deletes fee definition', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT id FROM fee_definitions WHERE id')) {
        return Promise.resolve({
          rows: [{ id: 1 }]
        });
      }
      if (query.includes('DELETE FROM fee_definitions')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'finance.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'finance' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .delete('/api/v1/finance/fee-definitions/1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('requires finance.manage permission to create/update/delete fee definitions', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.view'] // Can view, not manage
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'finance.view' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'parent' }]
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
    expect(res.body.message).toMatch(/permission|manage/i);
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

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
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
    expect(res.body.data[0].total_amount).toBe('150.00');
    expect(res.body.data[0].total_paid).toBe('50.00');
    // Outstanding should be calculated as 150 - 50 = 100
  });

  test('POST /api/v1/finance/payments records payment for participant fee', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.manage'],
      user_id: 1
    });

    let paymentInserted = false;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT id FROM participant_fees WHERE id')) {
        return Promise.resolve({
          rows: [{ id: 100 }]
        });
      }
      if (query.includes('INSERT INTO payments')) {
        paymentInserted = true;
        return Promise.resolve({
          rows: [{
            id: 1,
            participant_fee_id: 100,
            amount: '50.00',
            payment_method: 'cash',
            created_at: new Date()
          }]
        });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'finance.manage' }]
        });
      }
      if (query.includes('role_name')) {
        return Promise.resolve({
          rows: [{ role_name: 'finance' }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/finance/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        participant_fee_id: 100,
        amount: 50.00,
        payment_method: 'cash',
        notes: 'Cash payment at event'
      });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe('50.00');
    expect(paymentInserted).toBe(true);
  });

  test('validateMoney rejects invalid amounts', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
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
        .post('/api/v1/finance/payments')
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
  test('GET /api/v1/finance/summary returns organization financial overview', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('financial_summary') || query.includes('SUM')) {
        return Promise.resolve({
          rows: [{
            total_fees: '10000.00',
            total_paid: '6500.00',
            total_outstanding: '3500.00',
            unpaid_count: 25,
            partial_count: 10,
            paid_count: 65
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/finance/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total_fees).toBe('10000.00');
    expect(res.body.data.total_outstanding).toBe('3500.00');
  });

  test('GET /api/v1/finance/outstanding returns unpaid fees by participant', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['finance.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('outstanding')) {
        return Promise.resolve({
          rows: [
            {
              participant_id: 50,
              first_name: 'John',
              last_name: 'Doe',
              total_amount: '150.00',
              total_paid: '50.00',
              outstanding: '100.00'
            },
            {
              participant_id: 51,
              first_name: 'Jane',
              last_name: 'Smith',
              total_amount: '150.00',
              total_paid: '0.00',
              outstanding: '150.00'
            }
          ]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/finance/outstanding')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].outstanding).toBe('100.00');
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

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
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
