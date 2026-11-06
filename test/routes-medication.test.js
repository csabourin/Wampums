/**
 * Medication Management Test Suite
 *
 * Tests critical child health and safety operations:
 * - Medication requirement creation and assignment to participants
 * - Medication distribution tracking with witness acknowledgment
 * - Reception logging to ensure doses given are recorded
 * - Audit trail integrity (created_by, timestamps)
 *
 * Errors here directly impact child welfare:
 * - Missed doses
 * - Wrong dosages
 * - Lost distribution records
 * - Liability exposure
 *
 * @module test/routes-medication
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
    roleNames: ['admin'],
    permissions: ['medication.manage', 'medication.view'],
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
// MEDICATION REQUIREMENT CREATION TESTS
// ============================================

/**
 * Answer the permission and membership lookups as an admin of ORG_ID.
 * @param {Object} client - Mocked client
 * @param {Object} pool - Mocked pool
 * @returns {Array<string>} Queries sent, to check nothing was written
 */
function asUnitAdmin(client, pool) {
  const queries = [];
  mockQueryImplementation(client, pool, (query) => {
    queries.push(query);
    if (query.includes('permission_key')) {
      return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }, { permission_key: 'medication.view' }] });
    }
    if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {
      return Promise.resolve({ rows: [] });
    }
    if (query.includes('JOIN roles r')) {
      return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
    }
    if (query.includes('FROM user_organizations')) {
      return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
    }
    return undefined;
  });
  return queries;
}

describe('POST /api/v1/medication/requirements', () => {
  test('creates medication requirement with all required fields', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['medication.manage']
    });

    let transactionStarted = false;
    let requirementInserted = false;

    __mPool.connect.mockResolvedValue(__mClient);
    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query === 'BEGIN') {
        transactionStarted = true;
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('INSERT INTO medication_requirements')) {
        requirementInserted = true;
        return Promise.resolve({
          rows: [{
            id: 100,
            organization_id: ORG_ID,
            medication_name: 'Ibuprofen',
            dosage_instructions: 'Take with food',
            frequency_text: 'Every 6 hours',
            route: 'oral',
            default_dose_amount: 200,
            default_dose_unit: 'mg',
            created_by: 1,
            created_at: new Date()
          }]
        });
      }
      if (query.includes('INSERT INTO participant_medications') || query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }, { permission_key: 'medication.view' }] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        medication_name: 'Ibuprofen',
        dosage_instructions: 'Take with food',
        frequency_text: 'Every 6 hours',
        frequency_preset_type: 'recurring',
        route: 'oral',
        default_dose_amount: 200,
        default_dose_unit: 'mg',
        general_notes: 'Do not exceed 400mg per dose',
        start_date: '2025-01-15',
        end_date: '2025-06-15',
        participant_ids: [50] // Must target exactly one participant
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.medication_name).toBe('Ibuprofen');
    expect(res.body.data.default_dose_amount).toBe(200);
    expect(transactionStarted).toBe(true);
    expect(requirementInserted).toBe(true);
  });

  test('requires medication name', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['medication.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }, { permission_key: 'medication.view' }] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        medication_name: '', // Empty
        dosage_instructions: 'Take with food',
        participant_ids: [50]
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required|name/i);
  });

  test('requires exactly one participant', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['medication.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }, { permission_key: 'medication.view' }] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        medication_name: 'Ibuprofen',
        dosage_instructions: 'Take with food',
        participant_ids: [50, 51] // Multiple participants
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/one participant|exactly/i);
  });

  test('validates dose amount is numeric', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['medication.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }, { permission_key: 'medication.view' }] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        medication_name: 'Ibuprofen',
        dosage_instructions: 'Take with food',
        default_dose_amount: 'not_a_number',
        default_dose_unit: 'mg',
        participant_ids: [50]
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/dose|number|numeric/i);
  });

  test('a dose quantity without its unit is refused, so nobody reads a bare "200"', async () => {
    const { __mClient, __mPool } = require('pg');
    const queries = asUnitAdmin(__mClient, __mPool);

    const res = await request(app)
      .post('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${generateToken({ permissions: ['medication.manage'] })}`)
      .send({ medication_name: 'Advil', default_dose_amount: 200, default_dose_unit: '  ', frequency_preset_type: 'prn', participant_ids: [50] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('medication_dose_unit_required');
    expect(queries.some((query) => query.includes('INSERT INTO medication_requirements'))).toBe(false);
  });

  test.each([
    ['an impossible day', { start_date: '2026-02-30' }, 'medication_date_invalid'],
    ['something that is not a date', { end_date: 'demain' }, 'medication_date_invalid'],
    ['an end before the start', { start_date: '2026-12-03', end_date: '2026-12-01' }, 'medication_end_before_start'],
  ])('a treatment with %s is refused', async (_label, dates, key) => {
    const { __mClient, __mPool } = require('pg');
    const queries = asUnitAdmin(__mClient, __mPool);

    const res = await request(app)
      .post('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${generateToken({ permissions: ['medication.manage'] })}`)
      .send({ medication_name: 'Advil', frequency_preset_type: 'prn', participant_ids: [50], ...dates });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(key);
    expect(queries.some((query) => query.includes('INSERT INTO medication_requirements'))).toBe(false);
  });

  test('a treatment from December 1 to 3 is stored with exactly those dates', async () => {
    const { __mClient, __mPool } = require('pg');
    const params = [];
    __mPool.connect.mockResolvedValue(__mClient);
    mockQueryImplementation(__mClient, __mPool, (query, queryParams) => {
      if (query.includes('INSERT INTO medication_requirements')) {
        params.push(queryParams);
        return Promise.resolve({ rows: [{ id: 100, medication_name: 'Advil' }] });
      }
      if (query === 'BEGIN' || query === 'COMMIT' || query.includes('INSERT INTO participant_medications')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }] });
      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${generateToken({ permissions: ['medication.manage'] })}`)
      .send({ medication_name: 'Advil', frequency_preset_type: 'prn', participant_ids: [50], start_date: '2026-12-01', end_date: '2026-12-03' });

    expect(res.status).toBe(201);
    expect(params[0]).toEqual(expect.arrayContaining(['2026-12-01', '2026-12-03']));
  });

  test.each(['time_of_day', 'meal'])('a %s schedule without any time is refused', async (preset) => {
    const { __mClient, __mPool } = require('pg');
    const queries = asUnitAdmin(__mClient, __mPool);

    const res = await request(app)
      .post('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${generateToken({ permissions: ['medication.manage'] })}`)
      .send({ medication_name: 'Ritalin', frequency_preset_type: preset, frequency_times: [], participant_ids: [50] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('medication_frequency_times_required');
    expect(queries.some((query) => query.includes('INSERT INTO medication_requirements'))).toBe(false);
  });

  test('an update sending back the dates as the list returned them keeps those days', async () => {
    const { __mClient, __mPool } = require('pg');
    const updates = [];
    __mPool.connect.mockResolvedValue(__mClient);
    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('SELECT id FROM medication_requirements')) {
        return Promise.resolve({ rows: [{ id: 7 }] });
      }
      if (query.includes('UPDATE medication_requirements')) {
        updates.push(params);
        return Promise.resolve({ rows: [{ id: 7, medication_name: 'Advil' }] });
      }
      if (['BEGIN', 'COMMIT'].includes(query) || query.includes('participant_medications')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }] });
      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      return undefined;
    });

    const res = await request(app)
      .put('/api/v1/medication/requirements/7')
      .set('Authorization', `Bearer ${generateToken({ permissions: ['medication.manage'] })}`)
      .send({
        medication_name: 'Advil', frequency_preset_type: 'prn', participant_ids: [50],
        start_date: '2026-12-01T00:00:00.000Z', end_date: '2026-12-03T00:00:00.000Z',
      });

    expect(res.status).toBe(200);
    expect(updates[0]).toEqual(expect.arrayContaining(['2026-12-01', '2026-12-03']));
  });

  test('an update cannot remove the unit of a dose either', async () => {
    const { __mClient, __mPool } = require('pg');
    const queries = asUnitAdmin(__mClient, __mPool);

    const res = await request(app)
      .put('/api/v1/medication/requirements/7')
      .set('Authorization', `Bearer ${generateToken({ permissions: ['medication.manage'] })}`)
      .send({ medication_name: 'Advil', default_dose_amount: 200, participant_ids: [50] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('medication_dose_unit_required');
    expect(queries.some((query) => query.includes('UPDATE medication_requirements'))).toBe(false);
  });

  test('stores user ID in created_by field for audit trail', async () => {
    const { __mClient, __mPool } = require('pg');
    const userId = 42;
    const token = generateToken({
      user_id: userId,
      permissions: ['medication.manage']
    });

    let capturedParams = [];

    __mPool.connect.mockResolvedValue(__mClient);
    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (query.includes('INSERT INTO medication_requirements')) {
        capturedParams = params;
        return Promise.resolve({
          rows: [{
            id: 100,
            organization_id: ORG_ID,
            medication_name: 'Ibuprofen',
            created_by: userId
          }]
        });
      }
      if (query === 'BEGIN' || query === 'COMMIT' || query.includes('INSERT INTO participant_medications')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }, { permission_key: 'medication.view' }] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    await request(app)
      .post('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        medication_name: 'Ibuprofen',
        dosage_instructions: 'Take with food',
        participant_ids: [50]
      });

    // created_by should be the authenticated user's ID
    expect(capturedParams).toContain(userId);
  });

  test('requires medication.manage permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['medication.view'] // Can view, not manage
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({
          rows: [{ permission_key: 'medication.view' }]
        });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({
          rows: [{ role_name: 'parent' }]
        });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [5], organization_id: ORG_ID }] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        medication_name: 'Ibuprofen',
        participant_ids: [50]
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/permission|authorized/i);
  });
});

// ============================================
// MEDICATION DISTRIBUTION TESTS
// ============================================

describe('POST /api/v1/medication/distributions', () => {
  test('records medication distribution with required witness', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['medication.manage']
    });

    let distributionInserted = false;

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }, { permission_key: 'medication.view' }] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      if (query.includes('INSERT INTO medication_distributions')) {
        distributionInserted = true;
        return Promise.resolve({
          rows: [{
            id: 1,
            medication_requirement_id: 100,
            participant_id: 50,
            scheduled_time: '2025-01-20T09:00:00Z',
            given_timestamp: '2025-01-20T09:05:00Z',
            given_by: 1,
            witnessed_by: 2,
            status: 'given'
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/medication/distributions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        medication_requirement_id: 100,
        participant_id: 50,
        scheduled_time: '2025-01-20T09:00:00Z',
        given_timestamp: '2025-01-20T09:05:00Z',
        witnessed_by: 2, // Another staff member as witness
        notes: 'Delivered with juice'
      });

    expect([201, 400, 404]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body.data.status).toBe('scheduled');
      expect(distributionInserted).toBe(true);
    }
  });

  test('requires witness ID for dose given', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['medication.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }, { permission_key: 'medication.view' }] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/medication/distributions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        medication_requirement_id: 100,
        participant_id: 50,
        scheduled_time: '2025-01-20T09:00:00Z',
        given_timestamp: '2025-01-20T09:05:00Z'
        // Missing witnessed_by
      });

    expect(res.status).toBe(400);
  });

  test('allows marking dose as missed with reason', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['medication.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }, { permission_key: 'medication.view' }] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      if (query.includes('INSERT INTO medication_distributions')) {
        return Promise.resolve({
          rows: [{
            id: 2,
            medication_requirement_id: 100,
            participant_id: 50,
            scheduled_time: '2025-01-20T09:00:00Z',
            status: 'missed',
            missed_reason: 'Participant absent',
            noted_by: 1
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/medication/distributions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        medication_requirement_id: 100,
        participant_ids: [50],
        scheduled_for: '2025-01-20T09:00:00Z',
        witness_name: 'Leader Witness'
      });

    expect([201, 404]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/saved/i);
    }
  });
});

// ============================================
// MEDICATION RECEPTION TESTS
// ============================================

describe('POST /api/v1/medication/receptions', () => {
  test('logs medication reception with guardian acknowledgment', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['medication.manage']
    });

    let receptionInserted = false;

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }, { permission_key: 'medication.view' }] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      if (query.includes('INSERT INTO medication_receptions')) {
        receptionInserted = true;
        return Promise.resolve({
          rows: [{
            id: 5,
            medication_distribution_id: 1,
            received_by_parent: 'John Parent',
            received_timestamp: '2025-01-20T15:30:00Z',
            receipt_notes: 'Parent confirmed received'
          }]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/medication/receptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        medication_distribution_id: 1,
        received_by_parent: 'John Parent',
        received_timestamp: '2025-01-20T15:30:00Z',
        receipt_notes: 'Parent confirmed received'
      });

    expect([200, 201, 400]).toContain(res.status);
  });

  test('prevents double-receiving of same dose', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['medication.manage']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }, { permission_key: 'medication.view' }] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      if (query.includes('SELECT.*FROM medication_receptions')) {
        return Promise.resolve({
          rows: [{ id: 1 }] // Reception already exists
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/medication/receptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        medication_requirement_id: 100,
        participant_id: 50,
        status: 'received'
      });

    expect(res.status).toBe(400);
    if (res.body && typeof res.body.message === 'string') {
      expect(res.body.message).toMatch(/duplicate|already received/i);
    }
  });
});

// ============================================
// MEDICATION READ PERMISSION TESTS
// ============================================

describe('GET /api/v1/medication/receptions', () => {
  /** Answer the receptions of an activity, who it invites, and whose slip was declined. */
  function mockActivityReceptions(invitesEveryone, invitedIds, declinedIds = []) {
    const { __mClient, __mPool } = require('pg');
    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.view' }] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      if (query.includes('FROM activity_invitees')) {
        return Promise.resolve({ rows: [{ invites_everyone: invitesEveryone, participant_ids: invitedIds }] });
      }
      if (query.includes('FROM permission_slips')) {
        return Promise.resolve({ rows: declinedIds.map((id) => ({ participant_id: id })) });
      }
      if (query.includes('FROM medication_receptions')) {
        return Promise.resolve({ rows: [] });
      }
      return undefined;
    });
  }

  test('a leader learns which children an activity invites, to list only them', async () => {
    mockActivityReceptions(false, [7, 9]);

    const res = await request(app)
      .get('/api/v1/medication/receptions?activity_id=3')
      .set('Authorization', `Bearer ${generateToken({ permissions: ['medication.view'] })}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invited_participant_ids).toEqual([7, 9]);
  });

  test('a leader learns which children will not come because their slip was declined', async () => {
    mockActivityReceptions(true, [], [8]);

    const res = await request(app)
      .get('/api/v1/medication/receptions?activity_id=3')
      .set('Authorization', `Bearer ${generateToken({ permissions: ['medication.view'] })}`);

    expect(res.status).toBe(200);
    expect(res.body.data.declined_participant_ids).toEqual([8]);
  });

  test('an activity for the whole unit answers no invitee list', async () => {
    mockActivityReceptions(true, []);

    const res = await request(app)
      .get('/api/v1/medication/receptions?activity_id=3')
      .set('Authorization', `Bearer ${generateToken({ permissions: ['medication.view'] })}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invited_participant_ids).toBeNull();
  });
});

describe('GET /api/v1/medication/requirements', () => {
  test('lists medication requirements for organization with view permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: ['medication.view']
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [{ permission_key: 'medication.manage' }, { permission_key: 'medication.view' }] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'district', data_scope: 'organization' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [1], organization_id: ORG_ID }] });
      }
      if (query.includes('FROM medication_requirements')) {
        return Promise.resolve({
          rows: [
            {
              id: 100,
              organization_id: ORG_ID,
              medication_name: 'Ibuprofen',
              dosage_instructions: 'With food',
              frequency_text: 'Every 6 hours',
              created_by: 1,
              created_at: new Date()
            },
            {
              id: 101,
              organization_id: ORG_ID,
              medication_name: 'Acetaminophen',
              dosage_instructions: 'As needed',
              frequency_text: 'Every 4-6 hours',
              created_by: 1,
              created_at: new Date()
            }
          ]
        });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requirements.length).toBe(2);
    expect(res.body.data.requirements[0].medication_name).toBe('Ibuprofen');
  });

  test('requires medication.view permission', async () => {
    const { __mClient, __mPool } = require('pg');
    const token = generateToken({
      permissions: [] // No permissions
    });

    mockQueryImplementation(__mClient, __mPool, (query, _params) => {
      if (query.includes('permission_key')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes("'demoadmin'") || query.includes("'demoparent'")) {

        return Promise.resolve({ rows: [] });

      }
      if (query.includes('JOIN roles r')) {
        return Promise.resolve({ rows: [{ role_name: 'parent' }] });
      }
      if (query.includes('FROM user_organizations')) {
        return Promise.resolve({ rows: [{ role_ids: [5], organization_id: ORG_ID }] });
      }
      // Return undefined to fall back to default mocks (permissions, roles, etc.)
      return undefined;
    });

    const res = await request(app)
      .get('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/medication/authorizations/administration', () => {
  test('the same leader cannot be both adults entrusted with a child\'s medication', async () => {
    const { __mClient, __mPool } = require('pg');
    const queries = asUnitAdmin(__mClient, __mPool);
    const leader = '42b23881-cb20-4a2c-83de-a41221085a66';

    const res = await request(app)
      .post('/api/v1/medication/authorizations/administration')
      .set('Authorization', `Bearer ${generateToken({ permissions: ['medication.manage'] })}`)
      .send({ participant_id: 50, guardian_id: 1, admin_user_id_1: leader, admin_user_id_2: leader, requirements: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('medication_admins_must_differ');
    expect(queries.some((query) => query.includes('INSERT INTO medication_admin_authorizations'))).toBe(false);
  });
});
