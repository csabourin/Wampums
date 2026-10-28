const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
const { signJWTToken } = require('../utils/jwt-config');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'authorization-flow-integration-secret';

jest.mock('../utils/index', () => ({
  ...jest.requireActual('../utils/index'), sendEmail: jest.fn(), getUserEmailLanguage: jest.fn().mockResolvedValue('fr'),
}));
jest.mock('../utils/public-url', () => ({ resolveOrganizationBaseUrl: jest.fn().mockResolvedValue('https://unit.example.test') }));
jest.mock('../services/emailSender', () => ({ resolveOrganizationEmailSender: jest.fn().mockResolvedValue({ email: 'unit@example.test', name: 'Test Unit' }) }));
jest.mock('../services/permissionSlipCopies', () => () => ({ recordFamilyDelivery: jest.fn(), sendLeaderCopies: jest.fn().mockResolvedValue(0) }));

const flow = require('../services/activityAuthorizations');
const { sendEmail } = require('../utils/index');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!DATABASE_URL)('One activity permission workflow', () => {
  let pool;
  let app;
  const ids = {};
  const children = [];
  const users = [];
  const roles = [];
  const guardians = [];
  const activity = {
    activity_name: 'Fictional lantern evening', activity_start_date: '2026-11-20', activity_end_date: '2026-11-20',
    activity_start_time: '18:30', activity_end_time: '20:30', meeting_location_going: 'Fictional Hall',
    meeting_time_going: '18:30', departure_time_going: '18:30', transport_required: false,
    authorization_required: true, authorization_text: 'I agree to this outing.',
  };
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];
  const token = (userId) => signJWTToken({ user_id: userId, organizationId: ids.unit });
  const call = (method, path, userId = ids.staff) => request(app)[method](path).set('Authorization', `Bearer ${token(userId)}`);

  async function member(keys, scope = 'organization', unit = ids.unit) {
    const roleId = await one('INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, $2) RETURNING id', [`auth_${randomUUID()}`, scope]);
    roles.push(roleId);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [roleId, keys]);
    const userId = await one("INSERT INTO users (email, password, full_name) VALUES ($1, 'x', 'Fictional Adult') RETURNING id", [`${randomUUID()}@example.test`]);
    users.push(userId);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')", [userId, unit, JSON.stringify([roleId])]);
    return userId;
  }
  async function child(name, status = 'active', year = ids.year, addresses = []) {
    const id = await one("INSERT INTO participants (first_name, last_name) VALUES ($1, 'Fiction') RETURNING id", [name]);
    children.push(id);
    await pool.query('INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id, status) VALUES ($1, $2, $3, $4)', [id, ids.unit, year, status]);
    await Promise.all(addresses.map(async (address) => {
      const guardian = await one("INSERT INTO parents_guardians (nom, prenom, courriel) VALUES ('Fiction', 'Adult', $1) RETURNING id", [address]);
      guardians.push(guardian);
      await pool.query('INSERT INTO participant_guardians (participant_id, guardian_id) VALUES ($1, $2)', [id, guardian]);
    }));
    return id;
  }
  async function create(extra = {}) {
    const response = await call('post', '/api/v1/activities').send({ ...activity, ...extra });
    expect(response.status).toBe(201);
    return response.body.data.id;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      ids.unit = Object.values((await client.query("INSERT INTO organizations (name) VALUES ('Authorization Fiction Unit') RETURNING id")).rows[0])[0];
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [ids.unit]);
      await client.query('COMMIT');
    } finally {client.release();}
    ids.year = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Current', '2026-09-01', '2027-08-31', 'active') RETURNING id", [ids.unit]);
    ids.oldYear = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Old', '2025-09-01', '2026-08-31', 'closed') RETURNING id", [ids.unit]);
    ids.staff = await member(['activities.view', 'activities.create', 'activities.edit', 'communications.send']);
    ids.editor = await member(['activities.view', 'activities.create', 'activities.edit']);
    ids.parent = await member(['activities.view'], 'linked');
    ids.ada = await child('Ada', 'active', ids.year, [' First@Example.test ', 'second@example.test']);
    ids.bob = await child('Bob', 'active', ids.year);
    ids.former = await child('Former', 'left', ids.year, ['former@example.test']);
    ids.old = await child('Old', 'active', ids.oldYear, ['old@example.test']);
    // Account and contact variants count as one address for Ada.
    await pool.query('UPDATE users SET email = $1 WHERE id = $2', ['first@example.test', ids.parent]);
    await pool.query('INSERT INTO user_participants (user_id, participant_id) VALUES ($1, $2)', [ids.parent, ids.ada]);
    await pool.query(`INSERT INTO form_submissions (participant_id, organization_id, form_type, submission_data) VALUES ($1, $2, 'registration', '{"courriel":"child@example.test"}'::jsonb)`, [ids.ada, ids.unit]);
    app = express(); app.use(express.json()); app.locals.pool = pool;
    app.use('/api/v1/activity-authorizations', require('../routes/activity-authorizations')(pool));
    app.use('/api/v1/activities', require('../routes/activities')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'Unexpected test failure', detail: err.message }));
  });
  beforeEach(async () => {
    sendEmail.mockReset().mockResolvedValue(true);
    await pool.query('DELETE FROM permission_slip_leader_copies WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM permission_slips WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM activities WHERE organization_id = $1', [ids.unit]);
  });
  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM permission_slips WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM activities WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM form_submissions WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM user_participants WHERE user_id = ANY($1::uuid[])', [users]);
    await pool.query('DELETE FROM participant_guardians WHERE participant_id = ANY($1::int[])', [children]);
    await pool.query('DELETE FROM parents_guardians WHERE id = ANY($1::int[])', [guardians]);
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM scout_years WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM user_organizations WHERE organization_id = $1', [ids.unit]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.query('DELETE FROM role_permissions WHERE role_id = ANY($1::int[])', [roles]);
    await pool.query('DELETE FROM roles WHERE id = ANY($1::int[])', [roles]);
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [children]);
    await pool.query('DELETE FROM organizations WHERE id = $1', [ids.unit]);
    await pool.end();
  });

  test('preview uses only current invited families and neither saves nor sends anything', async () => {
    const result = await call('post', '/api/v1/activity-authorizations/preview').send({ invites_everyone: true });
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ participants: 2, addresses: 2, missing: [{ id: ids.bob, first_name: 'Bob' }] });
    expect(await one('SELECT COUNT(*)::int FROM activities WHERE organization_id = $1', [ids.unit])).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('saving an activity and its consent text creates no requests and sends no mail', async () => {
    const id = await create();
    const result = await call('get', `/api/v1/activity-authorizations/${id}`);
    expect(result.body.data).toMatchObject({ requests: 0, to_create: 2, sent: 0, state: 'not_created' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('a lost activity creation response can be retried without a duplicate', async () => {
    const key = randomUUID();
    const data = { ...activity, creation_key: key };
    const results = await Promise.all([call('post', '/api/v1/activities').send(data), call('post', '/api/v1/activities').send(data)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 201]);
    expect(results[0].body.data.id).toBe(results[1].body.data.id);
    expect(await one('SELECT COUNT(*)::int FROM activities WHERE organization_id = $1', [ids.unit])).toBe(1);
    const changed = await call('post', '/api/v1/activities').send({ ...data, activity_name: 'Changed after lost response' });
    expect(changed.status).toBe(409);
  });

  test('one action creates all invited requests and reports missing contact details', async () => {
    const id = await create();
    const response = await call('post', `/api/v1/activity-authorizations/${id}`).send({});
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ requests: 2, sent: 2, failed: 0, missing: [{ id: ids.bob }], state: 'incomplete' });
    expect(sendEmail.mock.calls.map(([email]) => email).sort()).toEqual(['first@example.test', 'second@example.test']);
    const reloaded = await call('get', `/api/v1/activity-authorizations/${id}`);
    expect(reloaded.body.data).toEqual(response.body.data);
  });

  test('a retry targets only the failed adult address even when another adult already received the request', async () => {
    const id = await create({ invites_everyone: false, invited_participant_ids: [ids.ada] });
    sendEmail.mockImplementation((email) => Promise.resolve(email !== 'second@example.test'));
    await flow.prepare(pool, ids.unit, id);
    const partial = await flow.dispatch(pool, ids.unit, id);
    expect(partial).toMatchObject({ sent: 1, failed: 1, requests: 1, state: 'incomplete' });
    sendEmail.mockClear().mockResolvedValue(true);
    const success = await flow.dispatch(pool, ids.unit, id);
    expect(sendEmail.mock.calls.map(([email]) => email)).toEqual(['second@example.test']);
    expect(success).toMatchObject({ sent: 2, failed: 0, state: 'sent' });
  });

  test('simultaneous sends claim each address only once', async () => {
    const id = await create({ invites_everyone: false, invited_participant_ids: [ids.ada] });
    await Promise.all([flow.prepare(pool, ids.unit, id), flow.prepare(pool, ids.unit, id)]);
    await Promise.all([flow.dispatch(pool, ids.unit, id), flow.dispatch(pool, ids.unit, id)]);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(await one('SELECT COUNT(*)::int FROM permission_slips WHERE activity_id = $1', [id])).toBe(1);
  });

  test('an uncertain provider response remains visible after reload and is never retried automatically', async () => {
    const id = await create({ invites_everyone: false, invited_participant_ids: [ids.ada] });
    await flow.prepare(pool, ids.unit, id);
    sendEmail.mockRejectedValue(new Error('response lost'));
    expect(await flow.dispatch(pool, ids.unit, id)).toMatchObject({ unknown: 2, state: 'uncertain' });
    sendEmail.mockClear().mockResolvedValue(true);
    expect(await flow.dispatch(pool, ids.unit, id)).toMatchObject({ unknown: 2, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('answered requests retain their signed text and are never mailed again', async () => {
    const id = await create({ invites_everyone: false, invited_participant_ids: [ids.ada] });
    await flow.prepare(pool, ids.unit, id);
    await pool.query("UPDATE permission_slips SET status = 'signed', signed_by = 'Fictional Guardian', signed_at = NOW() WHERE activity_id = $1", [id]);
    await pool.query("UPDATE activities SET authorization_text = 'Changed text' WHERE id = $1", [id]);
    await flow.prepare(pool, ids.unit, id);
    expect(await one('SELECT authorization_text FROM permission_slips WHERE activity_id = $1', [id])).toBe('I agree to this outing.');
    expect(await flow.dispatch(pool, ids.unit, id)).toMatchObject({ signed: 1, sent: 0, state: 'answered' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('deadline edits and clearing follow pending requests while answered deadlines remain frozen', async () => {
    const id = await create({ authorization_deadline_date: '2026-11-01' });
    await flow.prepare(pool, ids.unit, id);
    await pool.query("UPDATE permission_slips SET status = 'signed', signed_at = NOW() WHERE activity_id = $1 AND participant_id = $2", [id, ids.ada]);
    const edited = await call('put', `/api/v1/activities/${id}`).send({ authorization_deadline_date: '2026-11-21' });
    expect(edited.status).toBe(200);
    const deadlines = await pool.query("SELECT participant_id, deadline_date::date::text AS deadline FROM permission_slips WHERE activity_id = $1", [id]);
    expect(deadlines.rows.find((row) => row.participant_id === ids.ada).deadline).toBe('2026-11-01');
    expect(deadlines.rows.find((row) => row.participant_id === ids.bob).deadline).toBe('2026-11-21');
    const cleared = await call('put', `/api/v1/activities/${id}`).send({ authorization_deadline_date: '' });
    expect(cleared.status).toBe(200);
    expect(await one('SELECT deadline_date FROM permission_slips WHERE activity_id = $1 AND participant_id = $2', [id, ids.bob])).toBeNull();
    expect(await one('SELECT deadline_date::date::text FROM permission_slips WHERE activity_id = $1 AND participant_id = $2', [id, ids.ada])).toBe('2026-11-01');
  });

  test.each(['signed', 'declined'])('a %s response is retained after the activity moves to a different date', async (status) => {
    const id = await create({ invites_everyone: false, invited_participant_ids: [ids.ada] });
    await flow.prepare(pool, ids.unit, id);
    await pool.query('UPDATE permission_slips SET status = $1 WHERE activity_id = $2', [status, id]);
    const moved = await call('put', `/api/v1/activities/${id}`).send({ activity_date: '2026-11-21', activity_start_date: '2026-11-21', activity_end_date: '2026-11-21' });
    expect(moved.status).toBe(200);
    await flow.prepare(pool, ids.unit, id);
    expect(await one('SELECT COUNT(*)::int FROM permission_slips WHERE activity_id = $1', [id])).toBe(1);
    const result = await flow.dispatch(pool, ids.unit, id);
    expect(result).toMatchObject({ requests: 1, participants: 1, state: 'answered' });
    expect(result[status]).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('older duplicate pending records cannot override an existing answer or inflate the current summary', async () => {
    const id = await create({ invites_everyone: false, invited_participant_ids: [ids.ada] });
    await flow.prepare(pool, ids.unit, id);
    await pool.query("UPDATE permission_slips SET status = 'signed' WHERE activity_id = $1", [id]);
    await pool.query("INSERT INTO permission_slips (organization_id, participant_id, activity_id, meeting_date, status) VALUES ($1, $2, $3, '2026-11-21', 'pending')", [ids.unit, ids.ada, id]);
    expect(await flow.dispatch(pool, ids.unit, id)).toMatchObject({ requests: 1, signed: 1, pending: 0, state: 'answered' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('date conflicts roll back every new request instead of attaching a different activity', async () => {
    const first = await create({ invites_everyone: false, invited_participant_ids: [ids.ada] });
    await flow.prepare(pool, ids.unit, first);
    const second = await create();
    await expect(flow.prepare(pool, ids.unit, second)).rejects.toMatchObject({ status: 409 });
    expect(await one('SELECT COUNT(*)::int FROM permission_slips WHERE activity_id = $1', [second])).toBe(0);
  });

  test('leaving the current roster after requests were created prevents mailing the former family', async () => {
    const id = await create({ invites_everyone: false, invited_participant_ids: [ids.ada] });
    await flow.prepare(pool, ids.unit, id);
    await pool.query("UPDATE participant_enrollments SET status = 'left' WHERE participant_id = $1 AND scout_year_id = $2", [ids.ada, ids.year]);
    try {
      expect(await flow.dispatch(pool, ids.unit, id)).toMatchObject({ participants: 0, sent: 0, state: 'no_invitees' });
      expect(sendEmail).not.toHaveBeenCalled();
    } finally {await pool.query("UPDATE participant_enrollments SET status = 'active' WHERE participant_id = $1 AND scout_year_id = $2", [ids.ada, ids.year]);}
  });

  test('view-only families cannot inspect the audience and editors without mailing rights cannot send', async () => {
    const id = await create();
    expect((await call('get', `/api/v1/activity-authorizations/${id}`, ids.parent)).status).toBe(403);
    expect((await call('post', '/api/v1/activity-authorizations/preview', ids.parent).send({})).status).toBe(403);
    expect((await call('post', `/api/v1/activity-authorizations/${id}`, ids.editor).send({})).status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('another unit cannot inspect or send this activity', async () => {
    const id = await create();
    expect((await flow.summary(pool, ids.unit + 1000000, id).catch((err) => err)).status).toBe(404);
    expect((await call('get', '/api/v1/activity-authorizations/not-an-id')).status).toBe(400);
    expect((await call('post', `/api/v1/activity-authorizations/${id}`).send({ deadline_date: 'not-a-date' })).status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
