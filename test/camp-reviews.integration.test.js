/**
 * Camp review (#1257) on a disposable database: notes and "+1"s written with
 * the ids a device chose, replayed as the offline outbox replays them, kept
 * within their unit, and packed for a camp prepared offline.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-camp-reviews-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

const WRITE = ['camp_reviews.view', 'camp_reviews.manage', 'activities.view', 'meetings.view'];

describe.skipIf(!DATABASE_URL)('Camp review', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];

  /** A unit and its section, together: the unit's section is checked at commit. */
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Review Unit') RETURNING id")).rows[0].id;
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
  async function member(unitId, keys, name) {
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('review_' || gen_random_uuid(), 'Camp team', 'organization', $1) RETURNING id", [unitId]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('review-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  async function camp(unitId, owner, start, end) {
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time, is_camp)
      VALUES ($1, $2, 'Fictional camp', $3, 'Hall', '09:00', '09:15', $3, '09:00', $4, '16:00', TRUE) RETURNING id`, [unitId, owner, start, end]);
    const meeting = await one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id)
      VALUES ($1, $2, 'Fictional camp', 'camp', $3) RETURNING id`, [unitId, start, outing]);
    return { outing, meeting };
  }
  const auth = (user, unitId) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const call = (method, path, user = ids.leader, unitId = ids.unit) => request(app)[method](`/api/v1/camp-reviews${path}`).set(auth(user, unitId));
  const note = (overrides = {}) => ({ category: 'liked', moment: 'youth_council', text: 'Le grand jeu de nuit', ...overrides });
  const read = async (meetingId = ids.camp.meeting, user = ids.leader, unitId = ids.unit) => {
    const response = await call('get', `/camps/${meetingId}`, user, unitId);
    expect(response.status).toBe(200);
    return response.body.data;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    ids.leader = await member(ids.unit, WRITE, 'Ada Fiction');
    ids.second = await member(ids.unit, WRITE, 'Léa Fiction');
    ids.reader = await member(ids.unit, ['camp_reviews.view'], 'Reader Fiction');
    ids.outsider = await member(ids.otherUnit, WRITE, 'Foreign Fiction');
    ids.camp = await camp(ids.unit, ids.leader, '2026-07-10', '2026-07-12');
    ids.foreignCamp = await camp(ids.otherUnit, ids.outsider, '2026-07-10', '2026-07-12');
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/camp-reviews', require('../routes/camp-reviews')(pool));
    app.use('/api/v1/offline', require('../routes/offline')(pool, { error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    // Preparing a camp for offline use opens the unit's active scout year.
    await pool.query('DELETE FROM scout_years WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('the district role may read and write every camp review', async () => {
    expect(await one(`SELECT COUNT(*)::int FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE r.role_name = 'district' AND p.permission_key IN ('camp_reviews.view', 'camp_reviews.manage')`)).toBe(2);
  });

  test('a note written twice with the same id, as a lost answer is replayed, is noted once', async () => {
    const noteId = randomUUID();
    const first = await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}`).send(note({ text: 'La baignade au lac' }));
    expect(first.status).toBe(201);
    expect(first.body.data.note).toMatchObject({ id: noteId, weight: 1, version: 1, votes: [] });
    const again = await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}`).send(note({ text: 'La baignade au lac' }));
    expect(again.status).toBe(200);
    expect((await read()).notes.filter((entry) => entry.id === noteId)).toHaveLength(1);
  });

  test('each +1 weighs once, however often it is replayed, and undoing one removes only that one', async () => {
    const noteId = randomUUID();
    await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}`).send(note({ category: 'improve', text: 'Moins de vaisselle' }));
    const mine = randomUUID();
    const theirs = randomUUID();
    await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}/votes/${mine}`).send({});
    await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}/votes/${mine}`).send({});
    const both = await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}/votes/${theirs}`, ids.second).send({});
    expect(both.body.data.note.weight).toBe(3);
    expect(both.body.data.note.votes).toEqual([{ id: mine, mine: false }, { id: theirs, mine: true }]);

    const undone = await call('delete', `/camps/${ids.camp.meeting}/notes/${noteId}/votes/${mine}`);
    expect(undone.status).toBe(200);
    expect(undone.body.data.note.weight).toBe(2);
    // Undoing it again, as a replay would, changes nothing more.
    expect((await call('delete', `/camps/${ids.camp.meeting}/notes/${noteId}/votes/${mine}`)).body.data.note.weight).toBe(2);
  });

  test('a +1 on a note that does not exist, or whose id names another note, is refused', async () => {
    const missing = await call('put', `/camps/${ids.camp.meeting}/notes/${randomUUID()}/votes/${randomUUID()}`).send({});
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('camp_review_note_not_found');

    const a = randomUUID(); const b = randomUUID(); const vote = randomUUID();
    await call('put', `/camps/${ids.camp.meeting}/notes/${a}`).send(note({ text: 'Feu A' }));
    await call('put', `/camps/${ids.camp.meeting}/notes/${b}`).send(note({ text: 'Feu B' }));
    await call('put', `/camps/${ids.camp.meeting}/notes/${a}/votes/${vote}`).send({});
    expect((await call('put', `/camps/${ids.camp.meeting}/notes/${b}/votes/${vote}`).send({})).status).toBe(409);
  });

  test('an edit names its version: a stale one is refused, the same edit replayed is not', async () => {
    const noteId = randomUUID();
    await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}`).send(note({ text: 'Le repas du soir' }));
    const edit = note({ category: 'disliked', text: 'Le repas du soir était froid', expected_version: 1 });
    const edited = await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}`).send(edit);
    expect(edited.status).toBe(200);
    expect(edited.body.data.note).toMatchObject({ version: 2, category: 'disliked' });
    expect((await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}`).send(edit)).status).toBe(200);

    const stale = await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}`).send(note({ text: 'Autre chose', expected_version: 1 }));
    expect(stale.status).toBe(409);
    // Creating again an id already used for different words is a conflict, not an overwrite.
    expect((await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}`).send(note({ text: 'Écrasement' }))).status).toBe(409);
  });

  test('a day must be one of the camp’s days', async () => {
    const response = await call('put', `/camps/${ids.camp.meeting}/notes/${randomUUID()}`)
      .send(note({ moment: 'team_daily', day: '2026-07-20' }));
    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([{ path: 'day', location: 'body', msg: 'camp_review_invalid_day' }]);
  });

  test('removing a note removes its +1s, and removing it again succeeds', async () => {
    const noteId = randomUUID();
    await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}`).send(note({ text: 'Le chant du matin' }));
    await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}/votes/${randomUUID()}`).send({});
    expect((await call('delete', `/camps/${ids.camp.meeting}/notes/${noteId}`)).body.data).toEqual({ deleted: true });
    expect((await call('delete', `/camps/${ids.camp.meeting}/notes/${noteId}`)).body.data).toEqual({ deleted: false });
    expect(await one('SELECT COUNT(*)::int FROM camp_review_votes WHERE note_id = $1', [noteId])).toBe(0);
  });

  test('another unit neither reads nor writes a camp’s review, even naming its note ids', async () => {
    const noteId = randomUUID();
    await call('put', `/camps/${ids.camp.meeting}/notes/${noteId}`).send(note({ text: 'Notre secret de camp' }));

    expect((await call('get', `/camps/${ids.camp.meeting}`, ids.outsider, ids.otherUnit)).status).toBe(404);
    expect((await call('put', `/camps/${ids.camp.meeting}/notes/${randomUUID()}`, ids.outsider, ids.otherUnit).send(note())).status).toBe(404);
    expect((await call('put', `/camps/${ids.foreignCamp.meeting}/notes/${noteId}/votes/${randomUUID()}`, ids.outsider, ids.otherUnit).send({})).status).toBe(404);
    // The same id may be used by the other unit: it is another note there.
    expect((await call('put', `/camps/${ids.foreignCamp.meeting}/notes/${noteId}`, ids.outsider, ids.otherUnit).send(note({ text: 'Autre unité' }))).status).toBe(201);
    expect((await read()).notes.find((entry) => entry.id === noteId).text).toBe('Notre secret de camp');
    expect((await read(ids.foreignCamp.meeting, ids.outsider, ids.otherUnit)).notes.map((entry) => entry.text)).toEqual(['Autre unité']);
  });

  test('a reader without camp_reviews.manage reads the review but writes nothing', async () => {
    expect((await read(ids.camp.meeting, ids.reader)).notes.length).toBeGreaterThan(0);
    expect((await call('put', `/camps/${ids.camp.meeting}/notes/${randomUUID()}`, ids.reader).send(note())).status).toBe(403);
  });

  test('preparing the camp for offline use packs its review for those who may read it', async () => {
    const response = await request(app).post('/api/v1/offline/prepare-activity').set(auth(ids.leader, ids.unit))
      .send({ activity_id: ids.camp.outing, start_date: '2026-07-10', end_date: '2026-07-12' });
    expect(response.status).toBe(200);
    const [pack] = response.body.data.campReviews;
    expect(pack.meeting_id).toBe(Number(ids.camp.meeting));
    expect(pack.data.camp).toMatchObject({ id: Number(ids.camp.meeting), date_from: '2026-07-10', date_to: '2026-07-12' });
    expect(pack.data.notes.some((entry) => entry.text === 'La baignade au lac')).toBe(true);
  });
});
