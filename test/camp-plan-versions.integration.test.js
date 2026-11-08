/**
 * Frozen versions of a camp plan and their documents (#1418) on a disposable
 * database: submitting freezes the plan and its PDF, later changes never alter
 * a version, the copy naming allergies goes only to whoever may read them, and
 * each unit sees only its own camps.
 */
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-camp-plan-versions-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

const LEADER = ['meetings.view', 'meetings.manage', 'participants.view'];

describe.skipIf(!DATABASE_URL)('Camp plan versions', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];
  const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Versions Unit') RETURNING id")).rows[0].id;
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
  async function member(unitId, keys, name, scope = 'organization') {
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('ver_' || gen_random_uuid(), 'Team', $2, $1) RETURNING id", [unitId, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('ver-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  async function camp(unitId, start, end, cancelled = false) {
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
      VALUES ($1, $2, 'Fictional camp', $3, 'Hall', '09:00', '09:15', $3, '09:00', $4, '16:00', TRUE) RETURNING id`,
    [unitId, ids.leader, start, end]);
    return one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id, is_cancelled)
      VALUES ($1, $2, 'Camp des étoiles', 'camp', $3, $4) RETURNING id`, [unitId, start, outing, cancelled]);
  }
  const auth = (user, unitId = ids.unit) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const path = (meetingId, rest = '') => `/api/v1/camp-plans/camps/${meetingId}/versions${rest}`;
  const pdf = (meetingId, number, user) => request(app).get(path(meetingId, `/${number}/pdf`)).set(auth(user))
    .buffer(true).parse((res, done) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    ids.leader = await member(ids.unit, LEADER, 'Ada Lovelace');
    ids.nurse = await member(ids.unit, ['meetings.view', 'participants.view', 'volunteers.manage', 'camp_allergies.view'], 'Léa Tremblay');
    ids.viewer = await member(ids.unit, ['meetings.view'], 'Viewer Fiction');
    ids.rosterReader = await member(ids.unit, ['meetings.view', 'participants.view'], 'Roster Fiction');
    ids.outsider = await member(ids.otherUnit, LEADER, 'Foreign Fiction');
    ids.camp = await camp(ids.unit, '2099-07-04', '2099-07-05');
    ids.cancelled = await camp(ids.unit, '2099-08-01', '2099-08-02', true);
    await pool.query("INSERT INTO camp_team_members (organization_id, meeting_id, user_id, team_role) VALUES ($1, $2, $3, 'lead')", [ids.unit, ids.camp, ids.leader]);
    await pool.query("INSERT INTO member_allergy_declarations (user_id, allergies, person_to_notify) VALUES ($1, 'Arachides (fictif)', 'Contact fictif')", [ids.leader]);
    // A youth enrolled for the camp's scout year, whose family will later ask for erasure.
    ids.year = await one("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, 'Fictive', '2098-09-01', '2099-08-31', 'active') RETURNING id", [ids.unit]);
    ids.youth = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ('Zoé', 'Effaçable', '2088-03-01') RETURNING id");
    await pool.query(`INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id, status)
      VALUES ($1, $2, $3, 'active')`, [ids.youth, ids.unit, ids.year]);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/camp-plans', require('../routes/camp-plans')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM erasure_log WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM participants WHERE id = $1', [ids.youth]);
    await pool.query('DELETE FROM scout_years WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('before anything is submitted, the camp has no version and nothing to compare', async () => {
    const response = await request(app).get(path(ids.camp)).set(auth(ids.leader));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ versions: [], changed_since_latest: null });
  });

  test('submitting freezes a version with its tagged, accessible PDF and its digest', async () => {
    const submitted = await request(app).post(path(ids.camp)).set(auth(ids.leader));
    expect(submitted.status).toBe(201);
    expect(submitted.body.data).toMatchObject({ version_number: 1, status: 'submitted', language: 'fr', has_health: true,
      submitted_by_name: 'Ada Lovelace' });
    expect(submitted.body.data.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(submitted.body.data.snapshot_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(submitted.body.data.snapshot_sha256).not.toBe(submitted.body.data.pdf_sha256);

    const file = await pdf(ids.camp, 1, ids.leader);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['cache-control']).toBe('no-store');
    expect(file.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(sha256(file.body)).toBe(submitted.body.data.pdf_sha256);
    expect(file.headers['x-content-sha256']).toBe(submitted.body.data.pdf_sha256);
    const text = file.body.toString('latin1');
    ['/StructTreeRoot', '/MarkInfo', '/Lang (fr-CA)', '/DisplayDocTitle true', '/FontFile2', 'pdfuaid:part', '/TH', '/H1']
      .forEach((marker) => expect([marker, text.includes(marker)]).toEqual([marker, true]));
  });

  test('the copy naming allergies goes only to whoever may read them', async () => {
    const plain = await pdf(ids.camp, 1, ids.leader);
    const health = await pdf(ids.camp, 1, ids.nurse);
    expect(health.status).toBe(200);
    expect(health.headers['content-disposition']).toContain('-health.pdf');
    expect(plain.headers['content-disposition']).not.toContain('-health');
    expect(sha256(health.body)).not.toBe(sha256(plain.body));
    const snapshot = await one('SELECT snapshot::text FROM camp_plan_versions WHERE meeting_id = $1 AND version_number = 1', [ids.camp]);
    expect(snapshot).not.toContain('Arachides');
    // Each reader is shown the fingerprint of the copy they download.
    const nurseList = (await request(app).get(path(ids.camp)).set(auth(ids.nurse))).body.data.versions;
    expect(nurseList[0].pdf_sha256).toBe(sha256(health.body));
    const leaderList = (await request(app).get(path(ids.camp)).set(auth(ids.leader))).body.data.versions;
    expect(leaderList[0].pdf_sha256).toBe(sha256(plain.body));
    expect(nurseList[0].snapshot_sha256).toBe(leaderList[0].snapshot_sha256);
  });

  test('a volunteer is counted by shift in the document, never named', async () => {
    const shift = await one(`INSERT INTO volunteer_shifts (organization_id, activity_id, volunteer_type, title, shift_date, start_time, end_time, slots, created_by)
      SELECT $1, activity_id, 'cook', 'Déjeuner fictif', '2099-07-04', '07:00', '09:00', 2, $2 FROM year_plan_meetings WHERE id = $3 RETURNING id`,
    [ids.unit, ids.leader, ids.camp]);
    await pool.query("INSERT INTO volunteer_signups (organization_id, shift_id, user_id, status) VALUES ($1, $2, $3, 'confirmed')",
      [ids.unit, shift, ids.viewer]);
    const { buildPlanSnapshot } = require('../services/campPlanVersions');
    const { snapshot } = await buildPlanSnapshot(pool, ids.unit, ids.camp);
    expect(snapshot.volunteers).toEqual([{ type: 'cook', count: 1 }]);
    expect(JSON.stringify(snapshot)).not.toContain('Viewer Fiction');
  });

  test('changing the camp never changes a submitted version, and the change is shown', async () => {
    const before = sha256((await pdf(ids.camp, 1, ids.leader)).body);
    await pool.query("UPDATE year_plan_meetings SET theme = 'Camp renommé' WHERE id = $1", [ids.camp]);
    await pool.query(`INSERT INTO year_plan_meeting_days (organization_id, meeting_id, day_offset, title)
      VALUES ($1, $2, 0, 'Arrivée fictive')`, [ids.unit, ids.camp]);
    expect(sha256((await pdf(ids.camp, 1, ids.leader)).body)).toBe(before);
    const listed = (await request(app).get(path(ids.camp)).set(auth(ids.leader))).body.data;
    expect(listed.changed_since_latest).toEqual(expect.arrayContaining(['camp', 'schedule']));
    expect(listed.versions[0].version_number).toBe(1);
  });

  test('a changed allergy is reported since the latest version, only to whoever may read allergies', async () => {
    await pool.query("UPDATE member_allergy_declarations SET allergies = 'Arachides et noix (fictif)' WHERE user_id = $1", [ids.leader]);
    const nurse = (await request(app).get(path(ids.camp)).set(auth(ids.nurse))).body.data;
    expect(nurse.changed_since_latest).toContain('allergies');
    const leader = (await request(app).get(path(ids.camp)).set(auth(ids.leader))).body.data;
    expect(leader.changed_since_latest).not.toContain('allergies');
    const stored = await one('SELECT health_sha256 FROM camp_plan_versions WHERE meeting_id = $1 AND version_number = 1', [ids.camp]);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a new submission is the next version and supersedes the one waiting', async () => {
    const second = await request(app).post(path(ids.camp)).set(auth(ids.leader));
    expect(second.body.data.version_number).toBe(2);
    const listed = (await request(app).get(path(ids.camp)).set(auth(ids.leader))).body.data;
    expect(listed.versions.map((version) => [version.version_number, version.status])).toEqual([[2, 'submitted'], [1, 'superseded']]);
    expect(listed.changed_since_latest).toEqual([]);
  });

  test('reading versions takes participants.view; submitting takes meetings.manage', async () => {
    const read = await request(app).get(path(ids.camp)).set(auth(ids.viewer));
    expect(read.status).toBe(403);
    expect(read.body.missing).toEqual(['participants.view']);
    // Team qualifications are in the document: the camp lists' rule for them applies.
    const qualifications = await request(app).get(path(ids.camp, '/1/pdf')).set(auth(ids.rosterReader));
    expect(qualifications.status).toBe(403);
    expect(qualifications.body.required).toEqual(['meetings.manage', 'volunteers.manage']);
    const submit = await request(app).post(path(ids.camp)).set(auth(ids.nurse));
    expect(submit.status).toBe(403);
    expect(submit.body.missing).toEqual(['meetings.manage']);
  });

  test('a cancelled camp cannot be submitted, and an unknown version is not found', async () => {
    const cancelled = await request(app).post(path(ids.cancelled)).set(auth(ids.leader));
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.message).toBe('camp_plan_camp_cancelled');
    expect((await pdf(ids.camp, 99, ids.leader)).status).toBe(404);
  });

  test('another unit sees neither the camp’s versions nor their documents', async () => {
    expect((await request(app).get(path(ids.camp)).set(auth(ids.outsider, ids.otherUnit))).status).toBe(404);
    expect((await request(app).post(path(ids.camp)).set(auth(ids.outsider, ids.otherUnit))).status).toBe(404);
    const file = await request(app).get(path(ids.camp, '/1/pdf')).set(auth(ids.outsider, ids.otherUnit));
    expect(file.status).toBe(404);
    expect(await one('SELECT COUNT(*)::int FROM camp_plan_versions WHERE organization_id = $1', [ids.otherUnit])).toBe(0);
  });

  test('a family’s erasure removes their child from every submitted version, and says so', async () => {
    const before = await pool.query(
      'SELECT version_number, snapshot_sha256, pdf_sha256 FROM camp_plan_versions WHERE meeting_id = $1 ORDER BY version_number', [ids.camp]);
    expect(await one(`SELECT COUNT(*)::int FROM camp_plan_versions WHERE meeting_id = $1
      AND snapshot->'youth' @> jsonb_build_array(jsonb_build_object('participant_id', $2::int))`, [ids.camp, ids.youth])).toBeGreaterThan(0);

    const { eraseParticipant } = require('../services/erasure');
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      result = await eraseParticipant(client, { organizationId: ids.unit, participant: { id: ids.youth }, performedBy: ids.leader });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    expect(result.rows_deleted.camp_plan_versions_redacted).toBe(before.rows.length);

    const after = await pool.query(
      `SELECT version_number, snapshot::text AS snapshot, snapshot_sha256, pdf_sha256, pdf, pdf_health, redacted_at
         FROM camp_plan_versions WHERE meeting_id = $1 ORDER BY version_number`, [ids.camp]);
    after.rows.forEach((row, index) => {
      expect(row.snapshot).not.toContain('Effaçable');
      expect(row.pdf_health).toBeNull();
      expect(row.redacted_at).not.toBeNull();
      expect(row.snapshot_sha256).not.toBe(before.rows[index].snapshot_sha256);
      expect(sha256(row.pdf)).toBe(row.pdf_sha256);
    });
    const listed = (await request(app).get(path(ids.camp)).set(auth(ids.nurse))).body.data.versions;
    expect(listed.every((version) => version.redacted_at && !version.has_health)).toBe(true);
    ids.youth = null;
  });
});
