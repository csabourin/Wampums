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

const { setupDefaultMocks, authorizationContextRow } = require('./mock-helpers');
const { presentedFingerprint } = require('../services/permissionSlipFingerprint');

/** The text the slip presents, as the database builds it. */
const SLIP_CONTENT = {
  participant_id: 3,
  activity_id: 9,
  meeting_date: '2026-06-01',
  deadline_date: null,
  activity_title: 'Camp',
  activity_description: null,
  activity_description_html: null,
  authorization_text: 'Je permets à mon enfant de participer.',
  consent_payload: {},
};
const FINGERPRINT = presentedFingerprint(SLIP_CONTENT);

/**
 * Answer an answer's transaction: the locked slip, then the update.
 *
 * @param {Object} client - Mocked pg client
 * @param {string|null} status - The slip's status, or null when no slip has the token
 */
function mockAnswer(client, status) {
  client.query.mockImplementation((sql, params) => {
    let rows = [];
    if (String(sql).includes('FOR UPDATE')) {
      rows = status ? [{ id: TEST_ID, organization_id: 1, participant_id: 3, status, slip_content: SLIP_CONTENT }] : [];
    } else if (String(sql).includes('FROM user_participants up')) {
      // The family link, checked on the transaction's own connection
      rows = [{ '?column?': 1 }];
    } else if (String(sql).includes('UPDATE permission_slips')) {
      rows = [{
        id: TEST_ID,
        status: params[2],
        [params[2] === 'signed' ? 'signed_by' : 'declined_by']: params[1],
        answered_content: JSON.parse(params[3]),
        signature_hash: params[4],
        slip_content: SLIP_CONTENT,
      }];
    }
    return Promise.resolve({ rows });
  });
}
let app;

const TEST_SECRET = 'testsecret';
const TEST_TOKEN = '550e8400-e29b-41d4-a716-446655440000';
const TEST_ID = 28;

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  app = require('../api');
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('Permission Slip Security', () => {
  const { __mClient, __mPool } = require('pg');

  beforeEach(() => {
    __mPool.query.mockReset();
    __mClient.query.mockReset();
  });

  describe('Public access via Token', () => {
    test('GET /api/v1/resources/permission-slips/v/:token should allow viewing', async () => {
      __mPool.query.mockResolvedValueOnce({
        rows: [{
          id: TEST_ID,
          access_token: TEST_TOKEN,
          activity_title: 'Camp',
          meeting_date: '2026-06-01',
          participant_name: 'John Doe',
          status: 'pending',
          slip_content: SLIP_CONTENT,
        }]
      });

      const res = await request(app).get(`/api/v1/resources/permission-slips/v/${TEST_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.access_token).toBe(TEST_TOKEN);
      // The page sends this back with the answer, naming the text it showed
      expect(res.body.data.presented_fingerprint).toBe(FINGERPRINT);
      expect(res.body.data).not.toHaveProperty('slip_content');
    });

    test('PATCH /api/v1/resources/permission-slips/s/:token should allow signing', async () => {
      mockAnswer(__mClient, 'pending');

      const res = await request(app)
        .patch(`/api/v1/resources/permission-slips/s/${TEST_TOKEN}`)
        .send({ signed_by: 'Parent', presented_fingerprint: FINGERPRINT });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('signed');
      expect(res.body.data.permission_slip.signature_hash).toBe(FINGERPRINT);
      expect(res.body.data.permission_slip.fingerprint_status).toBe('verified');
    });

    test('PATCH /api/v1/resources/permission-slips/public/:token should allow declining', async () => {
      mockAnswer(__mClient, 'pending');

      const res = await request(app)
        .patch(`/api/v1/resources/permission-slips/public/${TEST_TOKEN}`)
        .send({ status: 'declined', declined_by: 'Parent', presented_fingerprint: FINGERPRINT });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.permission_slip.status).toBe('declined');
      // A refusal proves which text was refused, as a signature does
      expect(res.body.data.permission_slip.signature_hash).toBe(FINGERPRINT);
    });

    test('PATCH /api/v1/resources/permission-slips/public/:token should reject a second response', async () => {
      mockAnswer(__mClient, 'signed');

      const res = await request(app)
        .patch(`/api/v1/resources/permission-slips/public/${TEST_TOKEN}`)
        .send({ status: 'declined', declined_by: 'Parent', presented_fingerprint: FINGERPRINT });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).not.toBe('permission_slip_text_changed');
    });

    test('a parent who opened the link before the slip changed is asked to read it again', async () => {
      mockAnswer(__mClient, 'pending');
      const shownBefore = presentedFingerprint({ ...SLIP_CONTENT, authorization_text: 'Ancien texte' });

      const res = await request(app)
        .patch(`/api/v1/resources/permission-slips/s/${TEST_TOKEN}`)
        .send({ signed_by: 'Parent', presented_fingerprint: shownBefore });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('permission_slip_text_changed');
      expect(__mClient.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE permission_slips'))).toBe(false);
    });

    test('a link that names no slip answers 404', async () => {
      mockAnswer(__mClient, null);

      const res = await request(app)
        .patch(`/api/v1/resources/permission-slips/s/${TEST_TOKEN}`)
        .send({ signed_by: 'Parent', presented_fingerprint: FINGERPRINT });

      expect(res.status).toBe(404);
    });
  });

  describe('Insecure access via ID (Protection Check)', () => {
    test('GET /api/v1/resources/permission-slips/:id/view should REJECT without authentication', async () => {
      const res = await request(app).get(`/api/v1/resources/permission-slips/${TEST_ID}/view`);

      expect(res.status).toBe(401);
    });

    test('PATCH /api/v1/resources/permission-slips/:id/sign should REJECT without authentication', async () => {
      const res = await request(app)
        .patch(`/api/v1/resources/permission-slips/${TEST_ID}/sign`)
        .send({ signed_by: 'Attacker' });

      expect(res.status).toBe(401);
    });

    test('GET /api/v1/resources/permission-slips/:id/view should allow with valid authentication', async () => {
      const token = jwt.sign({ user_id: 1, organizationId: 1 }, TEST_SECRET);

      setupDefaultMocks(__mClient, __mPool);

      // Mock active organization membership
      __mPool.query.mockResolvedValueOnce({
        rows: [{ organization_id: 1 }]
      });
      // Mock authorization context
      __mPool.query.mockResolvedValueOnce(authorizationContextRow({
        permissions: ['activities.view'],
        roles: [{ role_name: 'leader', display_name: 'Leader' }],
      }));
      // Mock the organization-scoped slip result
      __mPool.query.mockResolvedValueOnce({
        rows: [{ id: TEST_ID, activity_title: 'Camp' }]
      });

      const res = await request(app)
        .get(`/api/v1/resources/permission-slips/${TEST_ID}/view`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-organization-id', '1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('PATCH /api/v1/resources/permission-slips/:id/archive should update within the active organization', async () => {
      const token = jwt.sign({ user_id: 1, organizationId: 1 }, TEST_SECRET);

      __mPool.query
        .mockResolvedValueOnce({ rows: [{ organization_id: 1 }] })
        .mockResolvedValueOnce(authorizationContextRow({
          permissions: ['activities.edit'],
          roles: [{ role_name: 'leader', display_name: 'Leader' }],
        }))
        .mockResolvedValueOnce({ rows: [{ id: TEST_ID, status: 'archived' }] });

      const res = await request(app)
        .patch(`/api/v1/resources/permission-slips/${TEST_ID}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.permission_slip.status).toBe('archived');
      const archiveQuery = __mPool.query.mock.calls[2];
      expect(archiveQuery[0]).toContain('organization_id = $2');
      expect(archiveQuery[1]).toEqual([TEST_ID, 1]);
    });
  });

  describe('the date of a signature or refusal', () => {
    const BACKDATED = '2001-01-01T00:00:00.000Z';
    const updateCall = () => __mClient.query.mock.calls.find(([sql]) => /UPDATE permission_slips/.test(sql));

    test('a parent signing from the emailed link cannot backdate the signature', async () => {
      mockAnswer(__mClient, 'pending');

      const res = await request(app)
        .patch(`/api/v1/resources/permission-slips/s/${TEST_TOKEN}`)
        .send({ signed_by: 'Parent', signed_at: BACKDATED, presented_fingerprint: FINGERPRINT });

      expect(res.status).toBe(200);
      const [sql, params] = updateCall();
      expect(sql).toMatch(/signed_at = CURRENT_TIMESTAMP/);
      expect(params).not.toContain(BACKDATED);
    });

    test('a parent declining from the emailed link cannot backdate the refusal', async () => {
      mockAnswer(__mClient, 'pending');

      const res = await request(app)
        .patch(`/api/v1/resources/permission-slips/public/${TEST_TOKEN}`)
        .send({ status: 'declined', declined_by: 'Parent', declined_at: BACKDATED, presented_fingerprint: FINGERPRINT });

      expect(res.status).toBe(200);
      const [sql, params] = updateCall();
      expect(sql).toMatch(/declined_at = CURRENT_TIMESTAMP/);
      expect(params).not.toContain(BACKDATED);
    });

    test('a parent signing from their account cannot backdate the signature', async () => {
      const token = jwt.sign({ user_id: 1, organizationId: 1 }, TEST_SECRET);
      __mPool.query
        .mockResolvedValueOnce({ rows: [{ organization_id: 1 }] })
        .mockResolvedValueOnce(authorizationContextRow({
          permissions: ['permission_slips.sign'],
          roles: [{ role_name: 'parent', display_name: 'Parent' }],
        }));
      mockAnswer(__mClient, 'pending');

      const res = await request(app)
        .patch(`/api/v1/resources/permission-slips/${TEST_ID}/sign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ signed_by: 'Parent', signed_at: BACKDATED, presented_fingerprint: FINGERPRINT });

      expect(res.status).toBe(200);
      const [sql, params] = updateCall();
      expect(sql).toMatch(/signed_at = CURRENT_TIMESTAMP/);
      expect(params).not.toContain(BACKDATED);
      expect(params.slice(0, 3)).toEqual([TEST_ID, 'Parent', 'signed']);
    });
  });
});
