/**
 * Calendar subscriptions — integration suite
 *
 * A subscription link stands for its holder, so what is under test is that it
 * never outlives their right to see the unit's activities: leaving the unit,
 * losing activities.view, making a new link or disabling it each close the
 * feed, at the next fetch, with nothing else to do. Only the token's digest is
 * stored, and a link from one unit shows that unit's activities alone.
 *
 * The feed itself runs through the real authorization engine; only the
 * session `authenticate` of the management routes is faked.
 *
 * Skipped unless TEST_DATABASE_URL points at a disposable database holding the
 * project schema and migrations.
 *
 * @module test/calendar-feeds.integration
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'calendar-feeds-integration-secret';

const mockContext = { userId: null, organizationId: null };

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, organizationId: mockContext.organizationId };
      next();
    },
  };
});

describe.skipIf(!DATABASE_URL)('Calendar subscriptions', () => {
  let pool;
  let app;
  const ids = {};

  /**
   * @param {string} sql - Query returning one row and one column
   * @param {Array} params - Query parameters
   * @returns {Promise<*>} The value, or undefined
   */
  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  /**
   * A unit with its program section and an upcoming outing.
   *
   * @param {string} name - Unit name
   * @param {string} outing - The outing's name
   * @returns {Promise<number>} Organization ID
   */
  async function createUnit(name, outing) {
    const client = await pool.connect();
    let organizationId;
    try {
      await client.query('BEGIN');
      organizationId = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, 'general', 'General')`,
        [organizationId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const creator = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('creator-' || gen_random_uuid() || '@example.test', 'x', 'Creator') RETURNING id`
    );
    await pool.query(
      `INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
                               meeting_time_going, departure_time_going, activity_start_date, activity_start_time,
                               activity_end_date, activity_end_time)
       VALUES ($1, $2, $3, '2026-11-14', 'Local', '08:30', '09:00', '2026-11-14', '09:00', '2026-11-14', '16:00')`,
      [organizationId, creator, outing]
    );
    return organizationId;
  }

  /**
   * An active member of a unit holding one role.
   *
   * @param {number} organizationId - Unit
   * @param {number} roleId - Role
   * @returns {Promise<string>} User ID
   */
  async function member(organizationId, roleId) {
    const userId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('member-' || gen_random_uuid() || '@example.test', 'x', 'Member') RETURNING id`
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3, 'active')`,
      [userId, organizationId, JSON.stringify([roleId])]
    );
    return userId;
  }

  /**
   * A role holding exactly the given permissions.
   *
   * @param {string} name - Role name, unique to this suite
   * @param {string[]} permissionKeys - Permissions it grants
   * @returns {Promise<number>} Role ID
   */
  async function role(name, permissionKeys) {
    const roleId = await one(
      `INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, 'linked')
       ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
      [name]
    );
    await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])`,
      [roleId, permissionKeys]
    );
    return roleId;
  }

  /**
   * Sign a member in to the management routes.
   *
   * @param {string} userId - User
   * @param {number} organizationId - Unit
   */
  function signIn(userId, organizationId) {
    mockContext.userId = userId;
    mockContext.organizationId = organizationId;
  }

  /**
   * Make a link as the signed-in member and return the path a calendar app fetches.
   *
   * @returns {Promise<{path: string, token: string, body: Object}>} Feed path, raw token, response body
   */
  async function makeLink() {
    const response = await request(app).post('/api/v1/calendar-feed').expect(201);
    const url = new URL(response.body.data.url);
    const token = url.pathname.split('/').pop().replace(/\.ics$/, '');
    return { path: url.pathname, token, body: response.body };
  }

  beforeAll(async () => {
    process.env.PUBLIC_BASE_URL = 'https://unit.example.org';
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.reader = await role('calendar_feed_reader', ['activities.view']);
    ids.noActivities = await role('calendar_feed_no_activities', ['participants.view']);
    ids.unitA = await createUnit('6A Calendar', 'Sortie canot');
    ids.unitB = await createUnit('6B Calendar', 'Camp d\'hiver');
  });

  afterAll(async () => {
    delete process.env.PUBLIC_BASE_URL;
    if (pool) {
      await pool.query('DELETE FROM calendar_feed_tokens WHERE organization_id = ANY($1::int[])', [[ids.unitA, ids.unitB]]);
      await pool.end();
    }
  });

  beforeEach(async () => {
    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1', require('../routes/calendarFeeds')(pool, console));
    ids.member = await member(ids.unitA, ids.reader);
    signIn(ids.member, ids.unitA);
  });

  test('a member\'s link serves their unit\'s activities to a calendar app, and only theirs', async () => {
    const { path, body } = await makeLink();
    expect(body.data.url).toMatch(/^https:\/\/unit\.example\.org\/api\/v1\/calendar-feeds\/[A-Za-z0-9_-]{43}\.ics$/);
    expect(body.data.webcal_url).toBe(body.data.url.replace('https://', 'webcal://'));

    const feed = await request(app).get(path).expect(200);
    expect(feed.headers['content-type']).toMatch(/^text\/calendar/);
    expect(feed.text).toContain('X-WR-CALNAME:6A Calendar');
    expect(feed.text).toContain('SUMMARY:Sortie canot');
    expect(feed.text).not.toContain('Camp d');
  });

  test('only the digest of the token is stored, and the status shows when the link was last used', async () => {
    const { path, token } = await makeLink();
    const stored = await pool.query('SELECT token_digest FROM calendar_feed_tokens WHERE user_id = $1', [ids.member]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].token_digest).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(stored.rows)).not.toContain(token);

    await request(app).get(path).expect(200);
    // The feed answers before noting its use, so wait for that write rather
    // than for a fixed delay a busy runner can outlast.
    const deadline = Date.now() + 5000;
    let status = await request(app).get('/api/v1/calendar-feed').expect(200);
    while (!status.body.data.last_used_at && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop -- polling is sequential by nature
      await new Promise((resolve) => setTimeout(resolve, 25));
      // eslint-disable-next-line no-await-in-loop -- polling is sequential by nature
      status = await request(app).get('/api/v1/calendar-feed').expect(200);
    }
    expect(status.body.data.active).toBe(true);
    expect(status.body.data.last_used_at).not.toBeNull();
  });

  test('making a new link closes the previous one', async () => {
    const first = await makeLink();
    const second = await makeLink();

    await request(app).get(first.path).expect(404);
    await request(app).get(second.path).expect(200);
  });

  test('leaving the unit closes the feed at the next fetch', async () => {
    const { path } = await makeLink();
    await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE user_id = $1", [ids.member]);

    const refused = await request(app).get(path).expect(403);
    expect(refused.body.required).toEqual(['activities.view']);
  });

  test('losing activities.view closes the feed at the next fetch', async () => {
    const { path } = await makeLink();
    await pool.query(
      'UPDATE user_organizations SET role_ids = $1 WHERE user_id = $2',
      [JSON.stringify([ids.noActivities]), ids.member]
    );

    const refused = await request(app).get(path).expect(403);
    expect(refused.body.missing).toEqual(['activities.view']);
  });

  test('disabling the link closes it, and the status says so', async () => {
    const { path } = await makeLink();
    const disabled = await request(app).delete('/api/v1/calendar-feed').expect(200);
    expect(disabled.body.data.revoked).toBe(true);

    await request(app).get(path).expect(404);
    const status = await request(app).get('/api/v1/calendar-feed').expect(200);
    expect(status.body.data.active).toBe(false);
  });

  test('a token nobody issued answers 404', async () => {
    await request(app).get('/api/v1/calendar-feeds/not-a-real-token.ics').expect(404);
  });

  test('without activities.view no link can be made', async () => {
    signIn(await member(ids.unitA, ids.noActivities), ids.unitA);
    const refused = await request(app).post('/api/v1/calendar-feed').expect(403);
    expect(refused.body.missing).toEqual(['activities.view']);
  });
});
