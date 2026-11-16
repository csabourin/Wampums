/**
 * Letter to parents drawn from the camp (#1321) on a disposable database: the draft says what the
 * camp knows and "to be confirmed" where it does not, each family of the camp receives one copy in
 * its language, a family that declined the camp is left out, a failed address is sent again and an
 * uncertain one never is, the permit's line follows, and each unit reaches only its own camps.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
jest.mock('../utils/index', () => ({ ...jest.requireActual('../utils/index'), sendEmail: jest.fn().mockResolvedValue(true) }));
const { sendEmail } = require('../utils/index');
process.env.JWT_SECRET_KEY ||= 'fictional-camp-letter-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

const SENDER = ['meetings.view', 'meetings.manage', 'communications.send', 'participants.view'];

describe.skipIf(!DATABASE_URL)('Letter to parents drawn from the camp', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = []; const youth = []; const guardians = [];
  const guardianByEmail = new Map();
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];

  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Letter Unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await db.query('COMMIT');
      units.push(id);
      return id;
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }
  async function member(unitId, keys, name, email = null) {
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('let_' || gen_random_uuid(), 'Team', 'organization', $1) RETURNING id", [unitId]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES (COALESCE($2, 'let-' || gen_random_uuid() || '@example.test'), 'x', $1) RETURNING id", [name, email]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  /** A youth enrolled this year, with a guardian at `email` when given. */
  async function child(firstName, email) {
    const id = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Fictif', '2088-03-01') RETURNING id", [firstName]);
    youth.push(id);
    await pool.query("INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id, status) VALUES ($1, $2, $3, 'active')",
      [id, ids.unit, ids.year]);
    if (email) {
      // One guardian per address: siblings share theirs.
      if (!guardianByEmail.has(email)) {
        const guardian = await one("INSERT INTO parents_guardians (nom, prenom, courriel) VALUES ('Fictif', 'Parent', $1) RETURNING id", [email]);
        guardians.push(guardian);
        guardianByEmail.set(email, guardian);
      }
      await pool.query('INSERT INTO participant_guardians (guardian_id, participant_id) VALUES ($1, $2)', [guardianByEmail.get(email), id]);
    }
    return id;
  }
  async function camp(unitId, { returnPlace = null, returnTime = null } = {}) {
    const activity = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, meeting_location_return, meeting_time_return,
      activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
      VALUES ($1, $2, 'Camp fictif', '2099-07-04', 'Église <b>Saint-Fictif</b>', '18:45', '19:00', $3, $4,
              '2099-07-04', '18:45', '2099-07-06', '15:00', TRUE) RETURNING id`,
    [unitId, ids.sender, returnPlace, returnTime]);
    const meeting = await one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id)
      VALUES ($1, '2099-07-04', 'Camp des étoiles', 'camp', $2) RETURNING id`, [unitId, activity]);
    return { activity, meeting };
  }
  const auth = (user, unitId = ids.unit) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const path = (meetingId, rest = '') => `/api/v1/camp-plans/camps/${meetingId}/letter${rest}`;
  const letter = (overrides = {}) => ({
    subject_fr: 'Camp des étoiles', body_fr_html: '<p>Bonjour, voici le camp.</p><script>alert(1)</script>',
    subject_en: 'Star camp', body_en_html: '<p>Hello, here is the camp.</p>', ...overrides,
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    ids.sender = await member(ids.unit, SENDER, 'Ada Lovelace');
    ids.planner = await member(ids.unit, ['meetings.view', 'meetings.manage'], 'Léa Tremblay');
    ids.viewer = await member(ids.unit, ['meetings.view'], 'Viewer Fiction');
    ids.outsider = await member(ids.otherUnit, SENDER, 'Foreign Fiction');
    ids.year = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Fictive', '2098-09-01', '2099-08-31', 'active') RETURNING id", [ids.unit]);
    ({ activity: ids.activity, meeting: ids.camp } = await camp(ids.unit));
    // Two siblings share one English-speaking family; a second family declined the camp; a third has no address.
    ids.englishFamily = `let-en-${Date.now()}@example.test`;
    ids.frenchFamily = `let-fr-${Date.now()}@example.test`;
    ids.declinedFamily = `let-declined-${Date.now()}@example.test`;
    await member(ids.unit, [], 'English Parent', ids.englishFamily);
    await pool.query("UPDATE users SET language_preference = 'en' WHERE email = $1", [ids.englishFamily]);
    await child('Alex', ids.englishFamily);
    await child('Sam', ids.englishFamily);
    await child('Lou', ids.frenchFamily);
    ids.declined = await child('Noa', ids.declinedFamily);
    ids.withoutAddress = await child('Eli', null);
    await pool.query(`INSERT INTO permission_slips (organization_id, participant_id, activity_id, meeting_date, activity_title, status)
      VALUES ($1, $2, $3, '2099-07-04', 'Camp fictif', 'declined')`, [ids.unit, ids.declined, ids.activity]);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/camp-plans', require('../routes/camp-plans')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue(true);
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM permission_slips WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participant_guardians WHERE guardian_id = ANY($1::int[])', [guardians]);
    await pool.query('DELETE FROM parents_guardians WHERE id = ANY($1::int[])', [guardians]);
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [youth]);
    await pool.query('DELETE FROM scout_years WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('the proposed letter says what the camp knows, "to be confirmed" for the rest, and who it reaches', async () => {
    const response = await request(app).get(path(ids.camp)).set(auth(ids.sender));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { draft, missing, audience } = response.body.data;
    expect(draft.saved).toBe(false);
    expect(draft.fr.body_html).toContain('18 h 45');
    // A place typed with markup stays text.
    expect(draft.fr.body_html).toContain('Église &lt;b&gt;Saint-Fictif&lt;/b&gt;');
    expect(draft.fr.body_html).toContain('à préciser');
    expect(draft.en.body_html).toContain('to be confirmed');
    expect(draft.fr.body_html).toContain(`/carpool/${ids.activity}`);
    expect(missing).toEqual(['return_place', 'return_time', 'emergency_phone']);
    // One English family for two siblings, one French family; the declined one is left out.
    expect(audience).toMatchObject({ families: 2, children: 4 });
    expect(audience.without_address.map((youngster) => youngster.first_name)).toEqual(['Eli']);
  });

  test('without the right to read the youth, the youth without an address are counted, not named', async () => {
    const response = await request(app).get(path(ids.camp)).set(auth(ids.viewer));
    expect(response.status).toBe(200);
    expect(response.body.data.audience.without_address).toBe(1);
  });

  test('a saved draft keeps both versions, with their markup rebuilt', async () => {
    const saved = await request(app).put(path(ids.camp)).set(auth(ids.planner)).send(letter());
    expect(saved.status).toBe(200);
    expect(saved.body.data.draft).toMatchObject({ saved: true, fr: { subject: 'Camp des étoiles' }, en: { subject: 'Star camp' } });
    expect(saved.body.data.draft.fr.body_html).not.toContain('<script');
    expect(saved.body.data.draft.fr.body_html).not.toContain('alert');

    const empty = await request(app).put(path(ids.camp)).set(auth(ids.planner)).send(letter({ body_en_html: '<p> </p>' }));
    expect(empty.status).toBe(400);
    expect(empty.body.errors[0].path).toBe('body_en_html');
  });

  test('sending reaches each family once, in its language, and completes the permit line', async () => {
    const sent = await request(app).post(path(ids.camp, '/versions')).set(auth(ids.sender)).send(letter());
    expect(sent.status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const byAddress = Object.fromEntries(sendEmail.mock.calls.map(([to, subject]) => [to, subject]));
    expect(byAddress).toEqual({ [ids.englishFamily]: 'Star camp', [ids.frenchFamily]: 'Camp des étoiles' });
    expect(sendEmail.mock.calls.map(([to]) => to)).not.toContain(ids.declinedFamily);
    expect(sent.body.data.sent[0]).toMatchObject({ version_number: 1, sent: 2, failed: 0, unknown: 0, sent_by_name: 'Ada Lovelace' });

    const permit = await request(app).get(`/api/v1/camp-plans/camps/${ids.camp}/permit`).set(auth(ids.sender));
    expect(permit.body.data.lines.find((line) => line.key === 'parent_letter'))
      .toMatchObject({ state: 'complete', reasons: ['letter_sent'], counts: { version: 1 } });
  });

  test('a refused address is sent again; one whose outcome is uncertain never is', async () => {
    sendEmail.mockImplementation((to) => (to === ids.englishFamily
      ? Promise.resolve(false)
      : Promise.reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))));
    const sent = await request(app).post(path(ids.camp, '/versions')).set(auth(ids.sender)).send(letter());
    expect(sent.body.data.sent[0]).toMatchObject({ version_number: 2, sent: 0, failed: 1, unknown: 1 });

    sendEmail.mockReset().mockResolvedValue(true);
    const retried = await request(app).post(path(ids.camp, '/versions/2/retry')).set(auth(ids.sender));
    expect(retried.status).toBe(200);
    expect(sendEmail.mock.calls.map(([to]) => to)).toEqual([ids.englishFamily]);
    expect(retried.body.data.sent[0]).toMatchObject({ version_number: 2, sent: 1, failed: 0, unknown: 1 });
  });

  test('a family added after a version was sent is reached by that version, and nobody else is written to again', async () => {
    ids.lateFamily = `let-late-${Date.now()}@example.test`;
    await child('Mia', ids.lateFamily);
    const read = await request(app).get(path(ids.camp)).set(auth(ids.sender));
    expect(read.body.data.sent.find((version) => version.version_number === 1)).toMatchObject({ unreached: 1, failed: 0 });
    const retried = await request(app).post(path(ids.camp, '/versions/1/retry')).set(auth(ids.sender));
    expect(retried.status).toBe(200);
    expect(sendEmail.mock.calls.map(([to]) => to)).toEqual([ids.lateFamily]);
    expect(retried.body.data.sent.find((version) => version.version_number === 1)).toMatchObject({ sent: 3, unreached: 0 });
  });

  test('editing takes meetings.manage, sending communications.send as well', async () => {
    const edit = await request(app).put(path(ids.camp)).set(auth(ids.viewer)).send(letter());
    expect(edit.status).toBe(403);
    expect(edit.body.missing).toContain('meetings.manage');
    const send = await request(app).post(path(ids.camp, '/versions')).set(auth(ids.planner)).send(letter());
    expect(send.status).toBe(403);
    expect(send.body.missing).toContain('communications.send');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('another unit\'s camp is not found, and nothing is sent', async () => {
    const read = await request(app).get(path(ids.camp)).set(auth(ids.outsider, ids.otherUnit));
    expect(read.status).toBe(404);
    const send = await request(app).post(path(ids.camp, '/versions')).set(auth(ids.outsider, ids.otherUnit)).send(letter());
    expect(send.status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
