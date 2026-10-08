/**
 * Reissuing a permission slip never rewrites a guardian's answer.
 *
 * Creating slips for participants who already hold one on the same date goes
 * through an upsert. A signed or declined slip is the record of what was
 * consented to, so the upsert leaves it alone and the response says which
 * participants were kept.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mClient = { query: jest.fn(), release: jest.fn() };
  const mPool = { connect: jest.fn(() => Promise.resolve(mClient)), query: jest.fn(), on: jest.fn() };
  return { Pool: jest.fn(() => mPool), __esModule: true, __mClient: mClient, __mPool: mPool };
});

const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');

const TEST_SECRET = 'testsecret';
const ORG_ID = 3;
const ACTIVITY_ID = 100;
const SIGNED_PARTICIPANT = 7;
const NEW_PARTICIPANT = 8;
let app;

function generateToken() {
  return jwt.sign({
    user_id: 1,
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: ['activities.edit']
  }, TEST_SECRET);
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  setupDefaultMocks(__mClient, __mPool);
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('POST /api/v1/resources/permission-slips — reissue', () => {
  test('keeps answered slips and clears signatures on reissued ones', async () => {
    const { __mClient, __mPool } = require('pg');
    let upsertSql = null;

    mockQueryImplementation(__mClient, __mPool, (query, params) => {
      if (typeof query !== 'string') {
        return undefined;
      }
      if (query.includes('FROM participant_organizations')) {
        return { rows: [{ '?column?': 1 }] };
      }
      if (query.includes('FROM activities WHERE id = $1')) {
        return { rows: [{ name: 'Camp', description: null, authorization_text: 'I agree.', activity_date: '2026-12-04' }] };
      }
      if (query.includes('INSERT INTO permission_slips')) {
        upsertSql = query;
        // The upsert's WHERE skips a signed slip, so no row comes back
        return params[1] === SIGNED_PARTICIPANT
          ? { rows: [] }
          : { rows: [{ id: 50, participant_id: params[1], authorization_text: params[8], status: 'pending' }] };
      }
      return undefined;
    });

    const res = await request(app)
      .post('/api/v1/resources/permission-slips')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ activity_id: ACTIVITY_ID, participant_ids: [SIGNED_PARTICIPANT, NEW_PARTICIPANT] });

    expect(res.status).toBe(201);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.permission_slips[0].participant_id).toBe(NEW_PARTICIPANT);
    expect(res.body.data.answered_participant_ids).toEqual([SIGNED_PARTICIPANT]);
    expect(upsertSql).toContain("WHERE permission_slips.status NOT IN ('signed', 'declined')");
    expect(upsertSql).toContain('signed_at = NULL');
    expect(upsertSql).toContain('declined_by = NULL');
  });
});
