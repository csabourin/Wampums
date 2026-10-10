/**
 * Push notifications — integration suite
 *
 * The recipient list shows each member once, however many browsers they
 * registered. A send reaches only the selected members (or everyone when none
 * are selected), and a browser the push service reports as gone (404/410) is
 * removed so it stops cluttering the list. Re-registering a browser moves its
 * endpoint to whoever is signed in. The browser learns the public key from the
 * server, whichever environment variable name holds it.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema, permission catalog and
 * migrations.
 *
 * @module test/push-notifications.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'push-notifications-integration-secret';

const mockContext = { userId: null, organizationId: null };

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, organizationId: mockContext.organizationId, permissions: [] };
      next();
    },
  };
});

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

const webpush = require('web-push');

describe.skipIf(!DATABASE_URL)('Push notifications', () => {
  let pool;
  let app;
  const ids = {};
  const savedEnv = {};
  const endpoint = (label) => `https://push.example.test/${ids.unit}/${label}`;

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  async function createMember(roleIds, fullName) {
    const userId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('push-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id`,
      [fullName]
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [userId, ids.unit, JSON.stringify(roleIds)]
    );
    return userId;
  }

  async function subscribe(userId, label) {
    await pool.query(
      `INSERT INTO subscribers (endpoint, p256dh, auth, organization_id, user_id)
       VALUES ($1, 'k', 'a', $2, $3)`,
      [endpoint(label), ids.unit, userId]
    );
  }

  const endpointsOf = (userId) => pool.query(
    'SELECT endpoint FROM subscribers WHERE organization_id = $1 AND user_id = $2 ORDER BY endpoint',
    [ids.unit, userId]
  ).then((result) => result.rows.map((row) => row.endpoint));

  async function createUnit(name) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const unitId = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, 'general', 'General')`,
        [unitId]
      );
      await client.query('COMMIT');
      return unitId;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await createUnit('Push unit');
    ids.otherUnit = await createUnit('Other push unit');

    ids.sender = await one(
      `INSERT INTO roles (role_name, display_name, data_scope, is_system_role, organization_id)
       VALUES ($1, $1, 'organization', false, $2) RETURNING id`,
      [`push_sender_${Date.now()}`, ids.unit]
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE permission_key = 'communications.send'`,
      [ids.sender]
    );

    ids.caller = await createMember([ids.sender], 'Sender');
    mockContext.userId = ids.caller;
    mockContext.organizationId = ids.unit;

    for (const name of ['VAPID_PUBLIC', 'VAPID_PRIVATE', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
    // The names documented in .env.example
    process.env.VAPID_PUBLIC = 'public-key';
    process.env.VAPID_PRIVATE = 'private-key';

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/notifications', require('../routes/notifications')(pool, console));
  });

  afterAll(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    if (pool) {
      await pool.query('DELETE FROM subscribers WHERE organization_id = ANY($1::int[])', [[ids.unit, ids.otherUnit]]);
      await pool.end();
    }
  });

  beforeEach(() => {
    mockContext.userId = ids.caller;
    webpush.sendNotification.mockReset();
    webpush.sendNotification.mockResolvedValue({ statusCode: 201 });
  });

  test('the browser gets the public key the server signs with', async () => {
    const response = await request(app).get('/api/v1/notifications/vapid-public-key');

    expect(response.status).toBe(200);
    expect(response.body.data.publicKey).toBe('public-key');
  });

  test('a member with several browsers appears once among recipients', async () => {
    const parent = await createMember([ids.sender], 'Parent with devices');
    await subscribe(parent, 'phone');
    await subscribe(parent, 'laptop');
    await subscribe(parent, 'tablet');

    const response = await request(app).get('/api/v1/notifications/subscribers');

    expect(response.status).toBe(200);
    const rows = response.body.data.filter((row) => row.user_id === parent);
    expect(rows).toHaveLength(1);
    expect(rows[0].device_count).toBe(3);
  });

  test('a send reaches only the selected members and removes browsers that are gone', async () => {
    const chosen = await createMember([ids.sender], 'Chosen');
    const other = await createMember([ids.sender], 'Other');
    await subscribe(chosen, 'chosen-live');
    await subscribe(chosen, 'chosen-gone');
    await subscribe(other, 'other-live');
    webpush.sendNotification.mockImplementation((subscription) => (
      subscription.endpoint.endsWith('gone')
        ? Promise.reject(Object.assign(new Error('Gone'), { statusCode: 410 }))
        : Promise.resolve({ statusCode: 201 })
    ));

    const response = await request(app)
      .post('/api/v1/notifications/send')
      .send({ title: 'Camp', body: 'Départ à 9 h', user_ids: [chosen] });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ sent: 1, failed: 1, removed: 1 });
    const reached = webpush.sendNotification.mock.calls.map(([subscription]) => subscription.endpoint);
    expect(reached.sort()).toEqual([endpoint('chosen-gone'), endpoint('chosen-live')]);
    expect(await endpointsOf(chosen)).toEqual([endpoint('chosen-live')]);
    expect(await endpointsOf(other)).toEqual([endpoint('other-live')]);
  });

  test('a send with no selection reaches every subscriber of the unit', async () => {
    const response = await request(app)
      .post('/api/v1/notifications/send')
      .send({ title: 'Réunion', body: 'Ce soir' });

    expect(response.status).toBe(200);
    const total = Number(await one('SELECT COUNT(*) FROM subscribers WHERE organization_id = $1', [ids.unit]));
    expect(webpush.sendNotification).toHaveBeenCalledTimes(total);
  });

  test('a browser registered again moves to whoever is signed in', async () => {
    const first = await createMember([ids.sender], 'First');
    const second = await createMember([ids.sender], 'Second');
    const shared = endpoint('shared-browser');
    const expiresAtMs = Date.UTC(2030, 0, 1);
    const register = async (userId) => {
      mockContext.userId = userId;
      const response = await request(app)
        .post('/api/v1/notifications/subscription')
        .send({ endpoint: shared, expirationTime: expiresAtMs, keys: { p256dh: 'p', auth: 'a' } });
      expect(response.status).toBe(202);
    };
    // The write completes after the 202 answer.
    const ownerOf = async () => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop -- polling a background write
        const row = (await pool.query('SELECT user_id, expiration_time FROM subscribers WHERE endpoint = $1', [shared])).rows[0];
        if (row) {
          return row;
        }
        // eslint-disable-next-line no-await-in-loop -- polling a background write
        await new Promise((resolve) => { setTimeout(resolve, 20); });
      }
      return null;
    };

    await register(first);
    const firstRow = await ownerOf();
    expect(firstRow.user_id).toBe(first);
    expect(new Date(firstRow.expiration_time).getTime()).not.toBeNaN();

    await register(second);
    let row = await ownerOf();
    for (let attempt = 0; attempt < 50 && row.user_id !== second; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- polling a background write
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      // eslint-disable-next-line no-await-in-loop -- polling a background write
      row = await ownerOf();
    }
    expect(row.user_id).toBe(second);
  });

  test('a member of another unit cannot be targeted', async () => {
    const outsider = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('push-outsider-' || gen_random_uuid() || '@example.test', 'x', 'Outsider') RETURNING id`
    );
    await pool.query(
      `INSERT INTO subscribers (endpoint, p256dh, auth, organization_id, user_id)
       VALUES ($1, 'k', 'a', $2, $3)`,
      [`https://push.example.test/outsider/${outsider}`, ids.otherUnit, outsider]
    );

    const response = await request(app)
      .post('/api/v1/notifications/send')
      .send({ title: 'Camp', body: 'Texte', user_ids: [outsider] });

    expect(response.status).toBe(200);
    expect(response.body.data.sent).toBe(0);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  test('a send whose every browser is gone reports nobody reached, not an error', async () => {
    const leaver = await createMember([ids.sender], 'Leaver');
    await subscribe(leaver, 'leaver-gone');
    webpush.sendNotification.mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 404 }));

    const response = await request(app)
      .post('/api/v1/notifications/send')
      .send({ title: 'Camp', body: 'Texte', user_ids: [leaver] });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ sent: 0, failed: 1, removed: 1 });
    expect(await endpointsOf(leaver)).toEqual([]);
  });

  test('a send that fails for another reason is an error and keeps the browser', async () => {
    const member = await createMember([ids.sender], 'Unlucky');
    await subscribe(member, 'unlucky');
    webpush.sendNotification.mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 403 }));

    const response = await request(app)
      .post('/api/v1/notifications/send')
      .send({ title: 'Camp', body: 'Texte', user_ids: [member] });

    expect(response.status).toBe(500);
    expect(await endpointsOf(member)).toEqual([endpoint('unlucky')]);
  });

  test('selected ids must be user ids', async () => {
    const response = await request(app)
      .post('/api/v1/notifications/send')
      .send({ title: 'Camp', body: 'Texte', user_ids: ['1 OR 1=1'] });

    expect(response.status).toBe(400);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  test.each([['garbage'], [-1], [1e20], ['']])('an unusable expiry (%p) is stored as none', async (expirationTime) => {
    const member = await createMember([ids.sender], 'Expiry');
    mockContext.userId = member;
    const browser = endpoint(`expiry-${member}`);

    const response = await request(app)
      .post('/api/v1/notifications/subscription')
      .send({ endpoint: browser, expirationTime, keys: { p256dh: 'p', auth: 'a' } });
    expect(response.status).toBe(202);

    let row;
    for (let attempt = 0; attempt < 50 && !row; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- polling a background write
      row = (await pool.query('SELECT expiration_time FROM subscribers WHERE endpoint = $1', [browser])).rows[0];
      if (!row) {
        // eslint-disable-next-line no-await-in-loop -- polling a background write
        await new Promise((resolve) => { setTimeout(resolve, 20); });
      }
    }
    expect(row).toBeDefined();
    expect(row.expiration_time).toBeNull();
  });
});
