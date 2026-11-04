/**
 * Camp sites (#1317) on a disposable database: the unit's sites, where each
 * camp is held, and what reads them (camp overview, packing list, duplication).
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'fictional-camp-sites-integration';
const DATABASE_URL = process.env.TEST_DATABASE_URL;

const MANAGE = ['meetings.view', 'meetings.manage', 'camp_sites.manage', 'personal_equipment.manage', 'tasks.view', 'tasks.manage'];
const LAKE = {
  name: 'Fictional Lake Camp', owner_name: 'Fictional Scouting Trust', address: '1 Fictional Road', province: 'QC',
  phone: '555-0100', site_type: 'Scout camp', accommodation: 'tent', heating: 'wood', has_own_insurance: true,
  insurance_note: 'The owner’s liability insurance covers our activities.',
  hospital_name: 'Fictional Memorial Hospital', hospital_address: '2 Hospital Street', hospital_phone: '555-0199',
  hospital_travel_minutes: 47, hospital_distance_km: 46.44, poison_centre_phone: '1-800-463-5060',
  directions_url: 'https://maps.example.test/to-camp', hospital_directions_url: 'https://maps.example.test/to-hospital',
};

describe.skipIf(!DATABASE_URL)('Camp sites', () => {
  let pool; let app;
  const ids = {}; const units = []; const users = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0] || {})[0];

  /** A unit and its section, together: the unit's section is checked at commit. */
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Sites Unit') RETURNING id")).rows[0].id;
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
    const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('site_' || gen_random_uuid(), 'Camp team', 'organization', $1) RETURNING id", [unitId]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, keys]);
    const user = await one("INSERT INTO users (email, password, full_name) VALUES ('site-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(user);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [unitId, user, JSON.stringify([role])]);
    return user;
  }
  async function camp(unitId, start, end, extra = '') {
    const outing = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, 'Fictional camp', $3, 'Hall', '09:00', '09:15', $3, '09:00', $4, '16:00') RETURNING id`, [unitId, ids.manager, start, end]);
    return one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id${extra ? ', is_cancelled' : ''})
      VALUES ($1, $2, 'Fictional camp', 'camp', $3${extra ? ', TRUE' : ''}) RETURNING id`, [unitId, start, outing]);
  }
  const auth = (user = ids.manager, unitId = ids.unit) => ({ Authorization: `Bearer ${jwt.sign({ user_id: user, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const call = (method, path, user, unitId) => request(app)[method](`/api/v1/camp-sites${path}`).set(auth(user, unitId));
  const addSite = async (site = LAKE, user = ids.manager) => {
    const response = await call('post', '/', user).send(site);
    expect(response.status).toBe(201);
    return response.body.data;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(); ids.otherUnit = await unit();
    ids.manager = await member(ids.unit, MANAGE, 'Ada Fiction');
    ids.planner = await member(ids.unit, ['meetings.view', 'meetings.manage'], 'Planner Fiction');
    ids.reader = await member(ids.unit, ['meetings.view'], 'Reader Fiction');
    ids.leaver = await member(ids.unit, ['meetings.view'], 'Former Fiction');
    ids.outsider = await member(ids.otherUnit, MANAGE, 'Foreign Fiction');
    await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE organization_id = $1 AND user_id = $2", [ids.unit, ids.leaver]);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/camp-sites', require('../routes/camp-sites')(pool));
    app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, { error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
    app.use('/api/v1/camp-readiness', require('../routes/camp-readiness')(pool));
    app.use('/api/v1/personal-equipment', require('../routes/personal-equipment')(pool));
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

  test('every unit-wide role that plans meetings may manage sites, the district role included', async () => {
    const missing = await pool.query(`SELECT r.role_name FROM roles r
      WHERE r.data_scope = 'organization' AND r.created_at < (SELECT applied_at FROM schema_migrations WHERE migration_name = '070_camp_sites.sql')
        AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                     WHERE rp.role_id = r.id AND p.permission_key = 'meetings.manage')
        AND NOT EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                         WHERE rp.role_id = r.id AND p.permission_key = 'camp_sites.manage')`);
    expect(missing.rows).toEqual([]);
    expect(await one(`SELECT COUNT(*)::int FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id WHERE r.role_name = 'district' AND p.permission_key = 'camp_sites.manage'`)).toBe(1);
  });

  test('a site is the unit’s own: another unit neither lists, edits nor archives it', async () => {
    const site = await addSite({ ...LAKE, name: 'Fictional Private Site' });
    expect(site).toMatchObject({ version: 1, archived: false, hospital_distance_km: 46.4, gaps: [] });

    const foreign = await call('get', '/', ids.outsider, ids.otherUnit);
    expect(foreign.body.data.some((row) => row.id === site.id)).toBe(false);
    expect((await call('put', `/${site.id}`, ids.outsider, ids.otherUnit).send({ ...LAKE, expected_version: 1 })).status).toBe(404);
    expect((await call('patch', `/${site.id}/archive`, ids.outsider, ids.otherUnit).send({ archived: true })).status).toBe(404);
  });

  test('two active sites cannot share a name, and an editor working on an old version is refused', async () => {
    const site = await addSite({ name: 'Fictional Twin', province: 'ON' });
    const twin = await call('post', '/').send({ name: '  fictional twin ' });
    expect(twin.status).toBe(409);
    expect(twin.body.message).toBe('camp_site_name_conflict');

    expect((await call('put', `/${site.id}`).send({ name: 'Fictional Twin', phone: '555-0101', expected_version: 1 })).status).toBe(200);
    const stale = await call('put', `/${site.id}`).send({ name: 'Fictional Twin', phone: '555-0102', expected_version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.message).toBe('camp_site_version_conflict');
    expect(await one('SELECT phone FROM camp_sites WHERE id = $1', [site.id])).toBe('555-0101');
  });

  test('a malformed site is refused, naming its field', async () => {
    for (const [body, field] of [
      [{ name: '' }, 'name'],
      [{ name: 'Fictional', directions_url: 'javascript:alert(1)' }, 'directions_url'],
      [{ name: 'Fictional', phone: 'call <b>me</b>' }, 'phone'],
      [{ name: 'Fictional', province: 'XX' }, 'province'],
      [{ name: 'Fictional', hospital_travel_minutes: 1.5 }, 'hospital_travel_minutes'],
      [{ name: 'Fictional', has_own_insurance: 'yes' }, 'has_own_insurance'],
    ]) {
      // eslint-disable-next-line no-await-in-loop -- each refusal is checked on its own
      const response = await call('post', '/').send(body);
      expect(response.status).toBe(400);
      expect(response.body.errors[0].path).toBe(field);
    }
  });

  test('only whoever manages sites adds them; a planner still chooses one for a camp', async () => {
    const refused = await call('post', '/', ids.planner).send({ name: 'Fictional Planner Site' });
    expect(refused.status).toBe(403);
    expect(refused.body.missing).toEqual(['camp_sites.manage']);

    const site = await addSite({ ...LAKE, name: 'Fictional Shared Site' });
    const meeting = await camp(ids.unit, '2027-07-10', '2027-07-17');
    const chosen = await call('put', `/camps/${meeting}`, ids.planner).send({ camp_site_id: site.id, expected_version: 0 });
    expect(chosen.status).toBe(200);
    expect(chosen.body.data.site.id).toBe(site.id);
  });

  test('a camp records its site, season, accommodation, lead and contact number; families’ number defaults to the site’s', async () => {
    const site = await addSite({ ...LAKE, name: 'Fictional Lake One' });
    const meeting = await camp(ids.unit, '2027-07-24', '2027-07-31');
    const saved = await call('put', `/camps/${meeting}`).send({
      camp_site_id: site.id, season: 'summer', accommodation: 'tent', on_site_lead_id: ids.manager, contact_phone: null, expected_version: 0,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.details).toMatchObject({ season: 'summer', accommodation: 'tent', on_site_lead_name: 'Ada Fiction', version: 1 });
    expect(saved.body.data.gaps).toEqual([]);

    const read = await call('get', `/camps/${meeting}`, ids.reader);
    expect(read.status).toBe(200);
    expect(read.body.data.site.phone).toBe('555-0100');
    expect(read.body.data.members).toBeUndefined();
    expect((await call('get', `/camps/${meeting}`)).body.data.members.some((row) => row.id === ids.outsider)).toBe(false);

    const stale = await call('put', `/camps/${meeting}`).send({ camp_site_id: null, expected_version: 0 });
    expect(stale.status).toBe(409);
  });

  test('a lead must be an active member, and a site must be the unit’s and still offered', async () => {
    const meeting = await camp(ids.unit, '2027-08-07', '2027-08-09');
    const foreignSite = (await call('post', '/', ids.outsider, ids.otherUnit).send({ name: 'Fictional Foreign Site' })).body.data;
    const archived = await addSite({ name: 'Fictional Old Site' });
    await call('patch', `/${archived.id}/archive`).send({ archived: true });

    for (const [body, field] of [
      [{ on_site_lead_id: ids.leaver }, 'on_site_lead_id'],
      [{ on_site_lead_id: ids.outsider }, 'on_site_lead_id'],
      [{ camp_site_id: foreignSite.id }, 'camp_site_id'],
      [{ camp_site_id: archived.id }, 'camp_site_id'],
    ]) {
      // eslint-disable-next-line no-await-in-loop -- each refusal is checked on its own
      const response = await call('put', `/camps/${meeting}`).send({ ...body, expected_version: 0 });
      expect(response.status).toBe(400);
      expect(response.body.errors[0].path).toBe(field);
    }
    expect(await one('SELECT COUNT(*)::int FROM camp_details WHERE meeting_id = $1', [meeting])).toBe(0);
  });

  test('preparing a camp for offline use carries its site and emergency numbers, to those who may read them', async () => {
    const site = await addSite({ ...LAKE, name: 'Fictional Offline Site' });
    const meeting = await camp(ids.unit, '2027-08-06', '2027-08-08');
    await call('put', `/camps/${meeting}`).send({ camp_site_id: site.id, contact_phone: '555-0177', expected_version: 0 });
    const outing = await one('SELECT activity_id FROM year_plan_meetings WHERE id = $1', [meeting]);
    const reader = await member(ids.unit, ['activities.view', 'meetings.view'], 'Offline Reader Fiction');
    const notReader = await member(ids.unit, ['activities.view'], 'Offline Other Fiction');
    const prepare = (user) => request(app).post('/api/v1/offline/prepare-activity').set(auth(user))
      .send({ activity_id: outing, start_date: '2027-08-06', end_date: '2027-08-08' });

    const allowed = await prepare(reader);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.campSites).toHaveLength(1);
    const [pack] = allowed.body.data.campSites;
    expect(pack.meeting_id).toBe(meeting);
    expect(pack.data.site).toMatchObject({ name: 'Fictional Offline Site', hospital_phone: '555-0199', poison_centre_phone: '1-800-463-5060' });
    expect(pack.data.details.contact_phone).toBe('555-0177');
    // Who a manager may choose as lead is never sent to a device for offline use.
    expect(pack.data.members).toBeUndefined();

    expect((await prepare(notReader)).body.data.campSites).toEqual([]);
  });

  test('archiving a site keeps it on the camps that chose it', async () => {
    const site = await addSite({ name: 'Fictional Retiring Site' });
    const meeting = await camp(ids.unit, '2027-08-14', '2027-08-15');
    await call('put', `/camps/${meeting}`).send({ camp_site_id: site.id, expected_version: 0 });
    await call('patch', `/${site.id}/archive`).send({ archived: true });

    const kept = await call('put', `/camps/${meeting}`).send({ camp_site_id: site.id, season: 'summer', expected_version: 1 });
    expect(kept.status).toBe(200);
    expect(kept.body.data.site).toMatchObject({ id: site.id, archived: true });
    expect((await call('get', '/')).body.data.some((row) => row.id === site.id)).toBe(false);
    expect((await call('get', '/?include_archived=true')).body.data.some((row) => row.id === site.id)).toBe(true);
  });

  test('a cancelled camp’s site can no longer change, and a regular meeting has none', async () => {
    const cancelled = await camp(ids.unit, '2027-09-04', '2027-09-05', 'cancelled');
    expect((await call('put', `/camps/${cancelled}`).send({ season: 'autumn', expected_version: 0 })).status).toBe(409);
    const regular = await one("INSERT INTO year_plan_meetings (organization_id, meeting_date, meeting_kind) VALUES ($1, '2027-09-08', 'regular') RETURNING id", [ids.unit]);
    expect((await call('get', `/camps/${regular}`)).status).toBe(404);
    expect((await call('get', `/camps/${regular}`, ids.outsider, ids.otherUnit)).status).toBe(404);
  });

  test('the camp overview names the site and what its emergency information lacks', async () => {
    const site = await addSite({ name: 'Fictional Incomplete Site', phone: '555-0110' });
    const meeting = await camp(ids.unit, '2027-10-02', '2027-10-03');
    const before = await request(app).get(`/api/v1/camp-readiness/${meeting}`).set(auth());
    expect(before.body.data.sections.site).toEqual({ site: null, gaps: ['site'] });

    await call('put', `/camps/${meeting}`).send({ camp_site_id: site.id, expected_version: 0 });
    const after = await request(app).get(`/api/v1/camp-readiness/${meeting}`).set(auth());
    expect(after.body.data.sections.site.site.name).toBe('Fictional Incomplete Site');
    expect(after.body.data.sections.site.gaps).toEqual(['address', 'hospital_name', 'hospital_phone', 'hospital_travel_minutes', 'poison_centre_phone', 'directions_url']);
  });

  test('the packing editor learns the camp’s season and accommodation', async () => {
    const meeting = await camp(ids.unit, '2028-01-14', '2028-01-16');
    await call('put', `/camps/${meeting}`).send({ season: 'winter', accommodation: 'cabin', expected_version: 0 });
    const editor = await request(app).get(`/api/v1/personal-equipment/${meeting}/manage`).set(auth());
    expect(editor.status).toBe(200);
    expect(editor.body.data.camp).toMatchObject({ camp_season: 'winter', camp_accommodation: 'cabin' });
  });

  test('a camp left “same as the site” packs for the site’s accommodation', async () => {
    const site = await addSite({ name: 'Fictional Cabin Site', accommodation: 'cabin' });
    const meeting = await camp(ids.unit, '2028-03-03', '2028-03-05');
    await call('put', `/camps/${meeting}`).send({ camp_site_id: site.id, season: 'spring', accommodation: null, expected_version: 0 });
    const editor = await request(app).get(`/api/v1/personal-equipment/${meeting}/manage`).set(auth());
    expect(editor.body.data.camp).toMatchObject({ camp_season: 'spring', camp_accommodation: 'cabin' });
  });

  test('reusing an earlier camp brings its site, season and accommodation, but not its lead', async () => {
    const site = await addSite({ ...LAKE, name: 'Fictional Yearly Site' });
    const source = await camp(ids.unit, '2026-07-11', '2026-07-18');
    await call('put', `/camps/${source}`).send({
      camp_site_id: site.id, season: 'summer', accommodation: 'tent', on_site_lead_id: ids.manager, contact_phone: '555-0177', expected_version: 0,
    });
    const target = await camp(ids.unit, '2028-07-08', '2028-07-15');

    const copied = await request(app).post(`/api/v1/yearly-planner/meetings/${target}/duplicate`).set(auth())
      .send({ source_meeting_id: source, parts: ['site'] });
    expect(copied.status).toBe(201);
    expect(copied.body.data).toMatchObject({ copied: { site: 1 }, site_unavailable: false });
    const details = (await pool.query('SELECT camp_site_id, season, accommodation, on_site_lead_id, contact_phone FROM camp_details WHERE meeting_id = $1', [target])).rows[0];
    expect(details).toEqual({ camp_site_id: site.id, season: 'summer', accommodation: 'tent', on_site_lead_id: null, contact_phone: '555-0177' });

    const again = await request(app).post(`/api/v1/yearly-planner/meetings/${target}/duplicate`).set(auth())
      .send({ source_meeting_id: source, parts: ['site'] });
    expect(again.status).toBe(409);
    expect(again.body.errors).toEqual([{ field: 'parts', part: 'site' }]);
  });

  test('an archived site is not chosen again by a reused camp', async () => {
    const site = await addSite({ name: 'Fictional Closed Site' });
    const source = await camp(ids.unit, '2026-02-13', '2026-02-15');
    await call('put', `/camps/${source}`).send({ camp_site_id: site.id, season: 'winter', expected_version: 0 });
    await call('patch', `/${site.id}/archive`).send({ archived: true });
    const target = await camp(ids.unit, '2028-02-11', '2028-02-13');

    const copied = await request(app).post(`/api/v1/yearly-planner/meetings/${target}/duplicate`).set(auth())
      .send({ source_meeting_id: source, parts: ['site'] });
    expect(copied.status).toBe(201);
    expect(copied.body.data).toMatchObject({ copied: { site: 0 }, site_unavailable: true });
    expect(await one('SELECT season FROM camp_details WHERE meeting_id = $1 AND camp_site_id IS NULL', [target])).toBe('winter');
  });
});
