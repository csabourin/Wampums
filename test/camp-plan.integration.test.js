/**
 * Written sections of the camp plan (#1318) on a disposable database: a camp's
 * own sections, the unit's templates, the games kept for bad weather, and what
 * reads them (camp overview, reusing an earlier camp).
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-camp-plan-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

const MANAGE = ['meetings.view', 'meetings.manage', 'camp_plan_templates.manage'];

describe.skipIf(!DATABASE_URL)('Camp plan written sections', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];

  /** A unit and its section, together: the unit's section is checked at commit. */
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Plan Unit') RETURNING id")).rows[0].id;
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
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('plan_' || gen_random_uuid(), 'Camp team', 'organization', $1) RETURNING id", [unitId]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('plan-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  async function camp(unitId, start, end, cancelled = false) {
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, 'Fictional camp', $3, 'Hall', '09:00', '09:15', $3, '09:00', $4, '16:00') RETURNING id`, [unitId, ids.manager, start, end]);
    return one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id, is_cancelled)
      VALUES ($1, $2, 'Fictional camp', 'camp', $3, $4) RETURNING id`, [unitId, start, outing, cancelled]);
  }
  const game = (unitId, name, active = true) => one(`INSERT INTO activity_library (organization_id, name, description, material, created_by, is_active)
    VALUES ($1, $2, 'Fictional rules, step by step.', 'Ball', $3, $4) RETURNING id`, [unitId, name, ids.manager, active]);
  const auth = (user = ids.manager, unitId = ids.unit) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const call = (method, path, user, unitId) => request(app)[method](`/api/v1/camp-plans${path}`).set(auth(user, unitId));
  const sectionOf = (plan, key) => plan.sections.find((section) => section.key === key);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    ids.manager = await member(ids.unit, MANAGE, 'Ada Fiction');
    ids.planner = await member(ids.unit, ['meetings.view', 'meetings.manage'], 'Planner Fiction');
    ids.reader = await member(ids.unit, ['meetings.view'], 'Reader Fiction');
    ids.outsider = await member(ids.otherUnit, MANAGE, 'Foreign Fiction');
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/camp-plans', require('../routes/camp-plans')(pool));
    app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, { error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
    app.use('/api/v1/camp-readiness', require('../routes/camp-readiness')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });

  test('every unit-wide role that plans meetings may write the templates, the district role included', async () => {
    const missing = await pool.query(`SELECT r.role_name FROM roles r
      WHERE r.data_scope = 'organization' AND r.created_at < (SELECT applied_at FROM schema_migrations WHERE migration_name = '071_camp_plan_sections.sql')
        AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                     WHERE rp.role_id = r.id AND p.permission_key = 'meetings.manage')
        AND NOT EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                         WHERE rp.role_id = r.id AND p.permission_key = 'camp_plan_templates.manage')`);
    expect(missing.rows).toEqual([]);
    expect(await one(`SELECT COUNT(*)::int FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id WHERE r.role_name = 'district' AND p.permission_key = 'camp_plan_templates.manage'`)).toBe(1);
  });

  test('a new camp’s plan lists every section and the bad-weather games as still to write', async () => {
    const meeting = await camp(ids.unit, '2027-07-04', '2027-07-11');
    const response = await call('get', `/camps/${meeting}`, ids.reader);
    expect(response.status).toBe(200);
    const plan = response.body.data;
    expect(plan.sections.map((section) => section.key)).toEqual([
      'vcpref_wanted', 'vcpref_chosen', 'vcpref_prepared', 'vcpref_realized', 'vcpref_evaluated', 'vcpref_celebrated',
      'theme', 'motivation', 'rules_of_life', 'camp_rules', 'code_of_ethics', 'emergency_procedures',
    ]);
    expect(plan.sections.every((section) => section.source === 'empty')).toBe(true);
    expect(plan.gaps.to_write).toHaveLength(13);
    expect(plan.gaps.to_write).toContain('rain_games');
    // The unit's point rules, read rather than copied: the defaults when it set none.
    expect(plan.motivation).toEqual({ attendance_present: 1, honor_award: 5, badge_earn: 5, badge_level_up: 10 });

    const overview = await request(app).get(`/api/v1/camp-readiness/${meeting}`).set(auth(ids.reader));
    expect(overview.body.data.sections.plan).toMatchObject({ rain_games: 0, to_review: [] });
    expect(overview.body.data.sections.plan.to_write).toHaveLength(13);
  });

  test('a section’s text is rebuilt on the server, with its plain version, and a stale editor is refused', async () => {
    const meeting = await camp(ids.unit, '2027-08-01', '2027-08-03');
    const saved = await call('put', `/camps/${meeting}/sections/theme`, ids.planner).send({
      body_html: '<p onclick="steal()">The <b>lost</b> forest<script>alert(1)</script></p><img src=x onerror=alert(1)>',
      expected_version: 0,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.section).toMatchObject({ source: 'camp', version: 1, body_html: '<p>The <strong>lost</strong> forest</p>', body_text: 'The lost forest' });
    expect(saved.body.data.gaps.to_write).not.toContain('theme');

    const stale = await call('put', `/camps/${meeting}/sections/theme`, ids.manager).send({ body_html: '<p>Other</p>', expected_version: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.message).toBe('camp_plan_version_conflict');
    expect(await one('SELECT body_text FROM camp_plan_sections WHERE meeting_id = $1 AND section_key = $2', [meeting, 'theme'])).toBe('The lost forest');

    // Writing nothing removes the text: the section is to write again.
    const cleared = await call('put', `/camps/${meeting}/sections/theme`, ids.planner).send({ body_html: '<p> </p>', expected_version: 1 });
    expect(cleared.body.data.section.source).toBe('empty');
    expect(cleared.body.data.gaps.to_write).toContain('theme');
  });

  test('a stable section follows the unit’s template until the camp writes its own, which a template change leaves alone', async () => {
    const following = await camp(ids.unit, '2027-09-03', '2027-09-05');
    const own = await camp(ids.unit, '2027-09-10', '2027-09-12');
    const template = await call('put', '/templates/rules_of_life').send({ body_html: '<p>Respect everyone.</p>', expected_version: 0 });
    expect(template.status).toBe(200);
    expect(template.body.data).toMatchObject({ key: 'rules_of_life', version: 1, body_text: 'Respect everyone.' });

    const modified = await call('put', `/camps/${own}/sections/rules_of_life`, ids.planner).send({ body_html: '<p>Respect everyone, and the lake.</p>', expected_version: 0 });
    expect(modified.body.data.section).toMatchObject({ source: 'camp', modified_for_camp: true });

    expect((await call('put', '/templates/rules_of_life').send({ body_html: '<p>Respect everyone, always.</p>', expected_version: 1 })).status).toBe(200);
    const followed = sectionOf((await call('get', `/camps/${following}`)).body.data, 'rules_of_life');
    expect(followed).toMatchObject({ source: 'template', modified_for_camp: false, body_text: 'Respect everyone, always.', template_version: 2 });
    const kept = sectionOf((await call('get', `/camps/${own}`)).body.data, 'rules_of_life');
    expect(kept).toMatchObject({ source: 'camp', modified_for_camp: true, body_text: 'Respect everyone, and the lake.' });

    // Going back to the template removes the camp's own text.
    const reverted = await call('put', `/camps/${own}/sections/rules_of_life`, ids.planner).send({ body_html: '', expected_version: 1 });
    expect(reverted.body.data.section).toMatchObject({ source: 'template', modified_for_camp: false, body_text: 'Respect everyone, always.' });
  });

  test('clearing and rewriting a section never lets an editor working on the old text overwrite the new one', async () => {
    const meeting = await camp(ids.unit, '2027-08-08', '2027-08-10');
    // A and B both load the section once it reads "First" (version 1).
    await call('put', `/camps/${meeting}/sections/motivation`, ids.planner).send({ body_html: '<p>First</p>', expected_version: 0 });
    const cleared = await call('put', `/camps/${meeting}/sections/motivation`).send({ body_html: '', expected_version: 1 });
    expect(cleared.body.data.section).toMatchObject({ source: 'empty', version: 2 });
    const rewritten = await call('put', `/camps/${meeting}/sections/motivation`).send({ body_html: '<p>Replacement</p>', expected_version: 2 });
    expect(rewritten.body.data.section.version).toBe(3);

    const stale = await call('put', `/camps/${meeting}/sections/motivation`, ids.planner).send({ body_html: '<p>Old edit</p>', expected_version: 1 });
    expect(stale.status).toBe(409);
    expect(await one('SELECT body_text FROM camp_plan_sections WHERE meeting_id = $1 AND section_key = $2', [meeting, 'motivation'])).toBe('Replacement');

    // The same holds for a unit template.
    await call('put', '/templates/camp_rules').send({ body_html: '<p>First rules</p>', expected_version: 0 });
    await call('put', '/templates/camp_rules').send({ body_html: '', expected_version: 1 });
    expect((await call('put', '/templates/camp_rules').send({ body_html: '<p>Old edit</p>', expected_version: 0 })).status).toBe(409);
    const emptied = (await call('get', '/templates')).body.data.find((template) => template.key === 'camp_rules');
    expect(emptied).toMatchObject({ body_html: null, version: 2 });
    expect((await call('put', '/templates/camp_rules').send({ body_html: '<p>New rules</p>', expected_version: 2 })).status).toBe(200);
  });

  test('someone allowed to write the templates can read them without meetings.view', async () => {
    const editor = await member(ids.unit, ['camp_plan_templates.manage'], 'Template Fiction');
    const response = await call('get', '/templates', editor);
    expect(response.status).toBe(200);
    expect(response.body.data.map((template) => template.key)).toEqual(['rules_of_life', 'camp_rules', 'code_of_ethics', 'emergency_procedures']);
    // A camp's plan is still read with meetings.view only.
    const meeting = await camp(ids.unit, '2027-08-15', '2027-08-17');
    expect((await call('get', `/camps/${meeting}`, editor)).status).toBe(403);
  });

  test('two editors writing a template for the first time do not both succeed', async () => {
    const first = call('put', '/templates/code_of_ethics').send({ body_html: '<p>First</p>', expected_version: 0 });
    const second = call('put', '/templates/code_of_ethics').send({ body_html: '<p>Second</p>', expected_version: 0 });
    const statuses = (await Promise.all([first, second])).map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(await one('SELECT version FROM camp_plan_templates WHERE organization_id = $1 AND section_key = $2', [ids.unit, 'code_of_ethics'])).toBe(1);
  });

  test('writing the templates takes camp_plan_templates.manage; a camp’s sections, meetings.manage', async () => {
    const meeting = await camp(ids.unit, '2027-10-01', '2027-10-03');
    const refused = await call('put', '/templates/camp_rules', ids.planner).send({ body_html: '<p>x</p>', expected_version: 0 });
    expect(refused.status).toBe(403);
    expect(refused.body.missing).toEqual(['camp_plan_templates.manage']);
    const unwritten = await call('put', `/camps/${meeting}/sections/theme`, ids.reader).send({ body_html: '<p>x</p>', expected_version: 0 });
    expect(unwritten.status).toBe(403);
    expect(unwritten.body.missing).toEqual(['meetings.manage']);
  });

  test('another unit neither reads nor writes a camp’s plan, nor chooses its games', async () => {
    const meeting = await camp(ids.unit, '2027-10-08', '2027-10-10');
    const foreignGame = await game(ids.otherUnit, 'Foreign game');
    expect((await call('get', `/camps/${meeting}`, ids.outsider, ids.otherUnit)).status).toBe(404);
    expect((await call('put', `/camps/${meeting}/sections/theme`, ids.outsider, ids.otherUnit).send({ body_html: '<p>x</p>', expected_version: 0 })).status).toBe(404);
    // Nor may the unit choose another unit's activity.
    const borrowed = await call('put', `/camps/${meeting}/rain-games`).send({ activity_library_ids: [foreignGame] });
    expect(borrowed.status).toBe(400);
    expect(borrowed.body.message).toBe('camp_plan_rain_game_unavailable');
    // Templates are the unit's own.
    await call('put', '/templates/emergency_procedures').send({ body_html: '<p>Whistle three times.</p>', expected_version: 0 });
    const theirs = (await call('get', '/templates', ids.outsider, ids.otherUnit)).body.data;
    expect(theirs.find((template) => template.key === 'emergency_procedures').body_html).toBeNull();
  });

  test('bad-weather games keep their order; a hidden activity stays on a camp but cannot be added', async () => {
    const meeting = await camp(ids.unit, '2027-11-05', '2027-11-07');
    const [relay, quiz, hidden] = [await game(ids.unit, 'Fictional relay'), await game(ids.unit, 'Fictional quiz'), await game(ids.unit, 'Fictional hidden', false)];
    const saved = await call('put', `/camps/${meeting}/rain-games`, ids.planner).send({ activity_library_ids: [quiz, relay] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.rain_games.map((row) => row.name)).toEqual(['Fictional quiz', 'Fictional relay']);
    expect(saved.body.data.gaps.to_write).not.toContain('rain_games');

    const refused = await call('put', `/camps/${meeting}/rain-games`).send({ activity_library_ids: [quiz, hidden] });
    expect(refused.status).toBe(400);
    await pool.query('UPDATE activity_library SET is_active = FALSE WHERE id = $1', [relay]);
    const kept = await call('put', `/camps/${meeting}/rain-games`).send({ activity_library_ids: [relay, quiz] });
    expect(kept.status).toBe(200);
    expect(kept.body.data.rain_games.map((row) => [row.name, row.is_active])).toEqual([['Fictional relay', false], ['Fictional quiz', true]]);

    for (const body of [{ activity_library_ids: [quiz, quiz] }, { activity_library_ids: ['1'] }, { activity_library_ids: 'x' }]) {
      // eslint-disable-next-line no-await-in-loop -- each refusal is checked on its own
      expect((await call('put', `/camps/${meeting}/rain-games`).send(body)).status).toBe(400);
    }
  });

  test('the unit’s camp plans list coming camps soonest first, then past ones, never another unit’s or a cancelled one', async () => {
    const listUnit = await unit();
    const lister = await member(listUnit, ['meetings.view'], 'Lister Fiction');
    const later = await camp(listUnit, '2099-08-01', '2099-08-03');
    const sooner = await camp(listUnit, '2099-07-01', '2099-07-03');
    const past = await camp(listUnit, '2001-07-01', '2001-07-03');
    await camp(listUnit, '2099-09-01', '2099-09-03', true);
    await camp(ids.otherUnit, '2099-07-05', '2099-07-06');
    await pool.query(`INSERT INTO camp_plan_sections (organization_id, meeting_id, section_key, body_html, body_text)
      VALUES ($1, $2, 'theme', '<p>Pirates</p>', 'Pirates')`, [listUnit, sooner]);

    const response = await call('get', '/camps', lister, listUnit);
    expect(response.status).toBe(200);
    expect(response.body.data.coming.map((row) => row.id)).toEqual([sooner, later]);
    expect(response.body.data.past.map((row) => row.id)).toEqual([past]);
    expect(response.body.data.coming[0]).toMatchObject({ to_write: 12, to_review: 0 });
    expect(response.body.data.coming[1].to_write).toBe(13);
  });

  test('a cancelled camp’s plan can be read but not changed', async () => {
    const meeting = await camp(ids.unit, '2027-12-03', '2027-12-05', true);
    expect((await call('get', `/camps/${meeting}`)).status).toBe(200);
    const refused = await call('put', `/camps/${meeting}/sections/theme`).send({ body_html: '<p>x</p>', expected_version: 0 });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('camp_plan_camp_cancelled');
  });

  test('reusing a camp copies its own sections as drafts and its games still offered, never its stable sections', async () => {
    const source = await camp(ids.unit, '2026-06-05', '2026-06-07');
    const target = await camp(ids.unit, '2028-06-02', '2028-06-04');
    const [kept, withdrawn] = [await game(ids.unit, 'Fictional kept game'), await game(ids.unit, 'Fictional withdrawn game')];
    await call('put', `/camps/${source}/sections/theme`).send({ body_html: '<p>The pirates</p>', expected_version: 0 });
    await call('put', `/camps/${source}/sections/vcpref_wanted`).send({ body_html: '<p>Voted in May</p>', expected_version: 0 });
    await call('put', `/camps/${source}/sections/camp_rules`).send({ body_html: '<p>Old camp rules</p>', expected_version: 0 });
    await call('put', `/camps/${source}/sections/motivation`).send({ body_html: '<p>Dropped</p>', expected_version: 0 });
    await call('put', `/camps/${source}/sections/motivation`).send({ body_html: '', expected_version: 1 });
    await call('put', `/camps/${target}/sections/theme`).send({ body_html: '<p>Started</p>', expected_version: 0 });
    await call('put', `/camps/${target}/sections/theme`).send({ body_html: '', expected_version: 1 });
    await call('put', `/camps/${source}/rain-games`).send({ activity_library_ids: [withdrawn, kept] });
    await pool.query('UPDATE activity_library SET is_active = FALSE WHERE id = $1', [withdrawn]);

    const offered = await request(app).get(`/api/v1/yearly-planner/meetings/${target}/duplication`).set(auth());
    expect(offered.body.data.sources.find((row) => row.id === source).counts.plan).toBe(4);

    const copied = await request(app).post(`/api/v1/yearly-planner/meetings/${target}/duplicate`).set(auth())
      .send({ source_meeting_id: source, parts: ['plan'] });
    expect(copied.status).toBe(201);
    expect(copied.body.data.copied).toEqual({ plan_sections: 2, rain_games: 1 });

    const plan = (await call('get', `/camps/${target}`)).body.data;
    expect(sectionOf(plan, 'theme')).toMatchObject({ source: 'camp', needs_review: true, body_text: 'The pirates', version: 3 });
    expect(sectionOf(plan, 'motivation').source).toBe('empty');
    expect(sectionOf(plan, 'camp_rules').source).not.toBe('camp');
    expect(plan.rain_games.map((row) => row.name)).toEqual(['Fictional kept game']);
    expect(plan.gaps.to_review).toEqual(['vcpref_wanted', 'theme']);

    // Saving a copied section clears "to reread".
    const reread = await call('put', `/camps/${target}/sections/theme`).send({ body_html: '<p>The pirates, again</p>', expected_version: 3 });
    expect(reread.body.data.section.needs_review).toBe(false);

    const again = await request(app).post(`/api/v1/yearly-planner/meetings/${target}/duplicate`).set(auth())
      .send({ source_meeting_id: source, parts: ['plan'] });
    expect(again.status).toBe(409);
    expect(again.body.errors).toEqual([{ field: 'parts', part: 'plan' }]);
  });
});
