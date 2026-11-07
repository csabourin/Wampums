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
    expect(both.body.data.note.votes).toEqual([
      expect.objectContaining({ id: mine, mine: false, by: 'Ada Fiction' }),
      expect.objectContaining({ id: theirs, mine: true, by: 'Léa Fiction' }),
    ]);

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

  describe('sorting after the camp', () => {
    let campIds;
    const on = (path) => `/camps/${campIds.meeting}${path}`;
    const add = async (text, category = 'liked') => {
      const id = randomUUID();
      const response = await call('put', on(`/notes/${id}`)).send(note({ category, text }));
      expect(response.status).toBe(201);
      return response.body.data.note;
    };

    beforeAll(async () => {
      campIds = await camp(ids.unit, ids.leader, '2026-08-01', '2026-08-03');
    });

    test('a note is kept or fixed with an action, made against its version', async () => {
      const kept = await add('Le grand jeu de nuit');
      const sorted = await call('patch', on(`/notes/${kept.id}`)).send({ outcome: 'keep', action_text: ' Le refaire le samedi ', expected_version: kept.version });
      expect(sorted.status).toBe(200);
      expect(sorted.body.data.note).toMatchObject({ outcome: 'keep', action_text: 'Le refaire le samedi', version: kept.version + 1 });
      const stale = await call('patch', on(`/notes/${kept.id}`)).send({ outcome: 'fix', expected_version: kept.version });
      expect(stale.status).toBe(409);
      expect((await call('patch', on(`/notes/${kept.id}`)).send({ outcome: 'later', expected_version: 2 })).status).toBe(400);
    });

    test('two notes that say the same thing merge: the one kept carries both weights, and the merge can be undone', async () => {
      const first = await add('La baignade');
      const second = await add('Baignade au lac');
      await call('put', on(`/notes/${second.id}/votes/${randomUUID()}`)).send({});
      await call('put', on(`/notes/${first.id}/votes/${randomUUID()}`)).send({});

      const merged = await call('put', on(`/notes/${second.id}/merge`)).send({ into: first.id, expected_version: second.version });
      expect(merged.status).toBe(200);
      expect(merged.body.data.note).toMatchObject({ id: first.id, weight: 4 });
      expect(merged.body.data.note.merged).toEqual([expect.objectContaining({ id: second.id, weight: 2 })]);
      const review = await read(campIds.meeting);
      expect(review.notes.some((entry) => entry.id === second.id)).toBe(false);
      // A +1 given later to the merged note, as a waiting device would, still counts in the note it joined.
      const late = await call('put', on(`/notes/${second.id}/votes/${randomUUID()}`)).send({});
      expect(late.body.data.note).toMatchObject({ id: first.id, weight: 5 });

      const undone = await call('delete', on(`/notes/${second.id}/merge`));
      expect(undone.body.data.note).toMatchObject({ id: second.id, weight: 3, merged: [] });
      expect((await read(campIds.meeting)).notes.find((entry) => entry.id === first.id).weight).toBe(2);
      // A device still retaining the old merge receives both confirmed notes on its next vote,
      // including the detached child's current version and votes, without another GET.
      const afterUnmerge = await call('put', on(`/notes/${first.id}/votes/${randomUUID()}`)).send({});
      expect(afterUnmerge.status).toBe(200);
      expect(afterUnmerge.body.data.notes).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: first.id, weight: 3, merged: [] }),
        expect.objectContaining({ id: second.id, weight: 3, version: second.version + 2, merged: [] }),
      ]));
    });

    test('a merge stays one level deep and within one kind of note', async () => {
      const a = await add('Le feu de camp');
      const b = await add('Le feu');
      const c = await add('Les feux');
      const other = await add('Le feu trop petit', 'improve');
      expect((await call('put', on(`/notes/${b.id}/merge`)).send({ into: a.id })).status).toBe(200);
      expect((await call('put', on(`/notes/${c.id}/merge`)).send({ into: b.id })).body.message).toBe('camp_review_merge_nested');
      expect((await call('put', on(`/notes/${a.id}/merge`)).send({ into: c.id })).body.message).toBe('camp_review_merge_nested');
      expect((await call('put', on(`/notes/${other.id}/merge`)).send({ into: a.id })).body.message).toBe('camp_review_merge_category');
      expect((await call('put', on(`/notes/${a.id}/merge`)).send({ into: a.id })).status).toBe(400);
      expect((await call('patch', on(`/notes/${b.id}`)).send({ outcome: 'keep', expected_version: 2 })).body.message).toBe('camp_review_note_merged');
      // A note others joined, like a merged note, keeps the category they share: totals stay right.
      const recategorised = await call('put', on(`/notes/${a.id}`)).send(note({ category: 'improve', text: 'Le feu de camp', expected_version: a.version }));
      expect(recategorised.status).toBe(409);
      expect(recategorised.body.message).toBe('camp_review_merge_category');
      const merged = await call('put', on(`/notes/${b.id}`)).send(note({ category: 'improve', text: 'Le feu', expected_version: 2 }));
      expect(merged.body.message).toBe('camp_review_merge_category');
      // Removing the note kept lets the merged one stand on its own again.
      expect((await call('delete', on(`/notes/${a.id}`))).body.data).toEqual({ deleted: true });
      const detached = (await read(campIds.meeting)).notes.find((entry) => entry.id === b.id);
      // Created (1), merged (2), detached (3): the version a device computes after the removal.
      expect(detached.version).toBe(3);
      expect((await call('patch', on(`/notes/${b.id}`)).send({ outcome: 'keep', expected_version: 3 })).status).toBe(200);
    });

    test('a closed review refuses every change until it is reopened, a waiting replay included', async () => {
      const open = await read(campIds.meeting);
      expect(open.review).toMatchObject({ status: 'open' });
      const closed = await call('put', on('/status')).send({ status: 'closed', expected_version: open.review.version });
      expect(closed.status).toBe(200);
      expect(closed.body.data.review).toMatchObject({ status: 'closed', closed_by: 'Ada Fiction' });

      const refused = await call('put', on(`/notes/${randomUUID()}`)).send(note({ text: 'Trop tard' }));
      expect(refused.status).toBe(409);
      expect(refused.body.message).toBe('camp_review_closed');
      const any = open.notes[0];
      expect((await call('put', on(`/notes/${any.id}/votes/${randomUUID()}`)).send({})).status).toBe(409);
      expect((await call('patch', on(`/notes/${any.id}`)).send({ outcome: 'fix', expected_version: any.version })).status).toBe(409);

      expect((await call('put', on('/status')).send({ status: 'open', expected_version: open.review.version })).status).toBe(409);
      const reopened = await call('put', on('/status')).send({ status: 'open', expected_version: closed.body.data.review.version });
      expect(reopened.body.data.review).toMatchObject({ status: 'open', closed_at: null });
      expect((await call('put', on(`/notes/${randomUUID()}`)).send(note({ text: 'Après réouverture' }))).status).toBe(201);
    });

    test('another unit can neither sort, merge nor close this camp’s review', async () => {
      const mine = await add('Notre bon coup');
      expect((await call('patch', on(`/notes/${mine.id}`), ids.outsider, ids.otherUnit).send({ outcome: 'keep', expected_version: 1 })).status).toBe(404);
      expect((await call('put', on('/status'), ids.outsider, ids.otherUnit).send({ status: 'closed', expected_version: 0 })).status).toBe(404);
    });
  });

  describe('year after year', () => {
    let lake; let hill; let past; let older; let other; let coming; let elsewhere;
    const site = (unitId, name) => one('INSERT INTO camp_sites (organization_id, name) VALUES ($1, $2) RETURNING id', [unitId, name]);
    const held = (meetingId, unitId, siteId, season) => pool.query(
      'INSERT INTO camp_details (organization_id, meeting_id, camp_site_id, season) VALUES ($1, $2, $3, $4)', [unitId, meetingId, siteId, season]);
    /** A camp with a closed review: one note kept (weight 2) and one fixed. */
    async function reviewed(start, end, siteId, season, words) {
      const { meeting } = await camp(ids.unit, ids.leader, start, end);
      await held(meeting, ids.unit, siteId, season);
      const keep = randomUUID(); const fix = randomUUID();
      await call('put', `/camps/${meeting}/notes/${keep}`).send(note({ text: `${words} : le grand jeu` }));
      await call('put', `/camps/${meeting}/notes/${keep}/votes/${randomUUID()}`).send({});
      await call('put', `/camps/${meeting}/notes/${fix}`).send(note({ category: 'improve', text: `${words} : la vaisselle` }));
      await call('patch', `/camps/${meeting}/notes/${keep}`).send({ outcome: 'keep', action_text: 'Le refaire', expected_version: 1 });
      await call('patch', `/camps/${meeting}/notes/${fix}`).send({ outcome: 'fix', action_text: 'Deux bacs', expected_version: 1 });
      expect((await call('put', `/camps/${meeting}/status`).send({ status: 'closed', expected_version: 1 })).status).toBe(200);
      return meeting;
    }

    beforeAll(async () => {
      lake = await site(ids.unit, 'Fictional Lake'); hill = await site(ids.unit, 'Fictional Hill');
      older = await reviewed('2024-10-04', '2024-10-06', lake, 'autumn', 'Automne 2024');
      past = await reviewed('2025-10-03', '2025-10-05', lake, 'autumn', 'Automne 2025');
      other = await reviewed('2025-02-07', '2025-02-09', hill, 'winter', 'Hiver 2025');
      ({ meeting: coming } = await camp(ids.unit, ids.leader, '2026-10-02', '2026-10-04'));
      await held(coming, ids.unit, lake, 'autumn');
      ({ meeting: elsewhere } = await camp(ids.unit, ids.leader, '2026-10-09', '2026-10-11'));
      const newSite = await site(ids.unit, 'Fictional New Site');
      await held(elsewhere, ids.unit, newSite, 'autumn');
    });

    test('the history lists the unit’s closed reviews, newest first, with what each kept and fixed', async () => {
      const response = await call('get', '/');
      expect(response.status).toBe(200);
      const camps = response.body.data.reviews.map((review) => review.camp.id);
      expect(camps.indexOf(Number(past))).toBeLessThan(camps.indexOf(Number(other)));
      expect(camps.indexOf(Number(other))).toBeLessThan(camps.indexOf(Number(older)));
      const last = response.body.data.reviews.find((review) => review.camp.id === Number(past));
      expect(last).toMatchObject({ site: { name: 'Fictional Lake' }, counts: { keep: 1, fix: 1 } });
      expect(last.keep[0]).toMatchObject({ text: 'Automne 2025 : le grand jeu', action_text: 'Le refaire', weight: 2 });
      expect(last.fix[0]).toMatchObject({ text: 'Automne 2025 : la vaisselle', action_text: 'Deux bacs' });
      expect(response.body.data.sites.map((entry) => entry.name)).toEqual(expect.arrayContaining(['Fictional Hill', 'Fictional Lake']));
    });

    test('the history filters by site and season, and refuses a malformed filter', async () => {
      const bySite = await call('get', `/?site_id=${hill}`);
      expect(bySite.body.data.reviews.map((review) => review.camp.id)).toEqual([Number(other)]);
      const bySeason = await call('get', '/?season=autumn');
      expect(bySeason.body.data.reviews.map((review) => review.camp.id)).toEqual([Number(past), Number(older)]);
      expect((await call('get', '/?season=monsoon')).status).toBe(400);
      expect((await call('get', '/?site_id=12abc')).status).toBe(400);
      // One camp's closed review, however far back: what reusing an earlier camp shows.
      const one = await call('get', `/?meeting_id=${older}`);
      expect(one.body.data.reviews.map((review) => review.camp.id)).toEqual([Number(older)]);
      expect((await call('get', '/?meeting_id=0')).status).toBe(400);
    });

    test('an open review, and another unit’s, stay out of the history', async () => {
      const open = await read();
      expect(open.review.status).toBe('open');
      expect((await call('get', '/')).body.data.reviews.some((review) => review.camp.id === Number(ids.camp.meeting))).toBe(false);
      const foreign = await call('get', '/', ids.outsider, ids.otherUnit);
      expect(foreign.body.data.reviews).toEqual([]);
    });

    test('“last time” draws on earlier camps at the same site first, latest first', async () => {
      const response = await call('get', `/camps/${coming}/previous`);
      expect(response.status).toBe(200);
      expect(response.body.data.basis).toBe('site');
      expect(response.body.data.reviews.map((review) => review.camp.id)).toEqual([Number(past), Number(older)]);
    });

    test('without an earlier camp at its site, “last time” falls back on camps of the same season', async () => {
      const response = await call('get', `/camps/${elsewhere}/previous`);
      expect(response.body.data.basis).toBe('season');
      expect(response.body.data.reviews.map((review) => review.camp.id)).toEqual([Number(past), Number(older)]);
      // A camp never reviews itself, nor a later one.
      const first = await call('get', `/camps/${older}/previous`);
      expect(first.body.data).toEqual({ basis: null, reviews: [] });
    });

    test('“last time” passes over newer reviews that kept and fixed nothing, to reach an older one that did', async () => {
      const quiet = await site(ids.unit, 'Fictional Quiet Site');
      const lessons = await reviewed('2023-07-07', '2023-07-09', quiet, 'summer', 'Été 2023');
      // Two later camps at the same site, their reviews closed without sorting anything.
      const closedUnsorted = async (start) => {
        const { meeting } = await camp(ids.unit, ids.leader, start, start);
        await held(meeting, ids.unit, quiet, 'summer');
        await call('put', `/camps/${meeting}/notes/${randomUUID()}`).send(note({ text: 'Pas encore trié' }));
        expect((await call('put', `/camps/${meeting}/status`).send({ status: 'closed', expected_version: 1 })).status).toBe(200);
      };
      await closedUnsorted('2024-07-05');
      await closedUnsorted('2025-07-04');
      const { meeting: next } = await camp(ids.unit, ids.leader, '2026-07-03', '2026-07-05');
      await held(next, ids.unit, quiet, 'summer');
      const response = await call('get', `/camps/${next}/previous`);
      expect(response.body.data.basis).toBe('site');
      expect(response.body.data.reviews.map((review) => review.camp.id)).toEqual([Number(lessons)]);
    });

    test('“last time” for another unit’s camp is not found', async () => {
      expect((await call('get', `/camps/${coming}/previous`, ids.outsider, ids.otherUnit)).status).toBe(404);
    });
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
