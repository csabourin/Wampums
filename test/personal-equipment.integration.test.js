/** Common lists and translations on migrated PostgreSQL; no packing-state storage. */
const { Pool } = require('pg');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET_KEY = 'packing-integration-secret';
jest.mock('../services/aiText', () => ({ generateText: jest.fn() }));
const { generateText } = require('../services/aiText');
const { saveList, readFamilyList, familyTasks, translateList } = require('../services/personalEquipment');
const { grantParticipantAccess } = require('../services/participantAccess');
const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Personal packing lists', () => {
  let pool; let organizationId; let otherUnit; let yearId; let manager; let parent; let otherParent; let child; let meetingId; let app;
  const users = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0])[0];
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional packing unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id,section_key,display_name) VALUES ($1,'general','General')", [id]);
      await db.query('COMMIT'); return id;
    } finally {db.release();}
  }
  async function member(scope, permissions) {
    const role = await one("INSERT INTO roles (role_name,display_name,data_scope,organization_id) VALUES ('packing_' || gen_random_uuid(),'Packing role',$1,$2) RETURNING id", [scope, organizationId]);
    await pool.query('INSERT INTO role_permissions (role_id,permission_id) SELECT $1,id FROM permissions WHERE permission_key = ANY($2::text[])', [role, permissions]);
    const id = await one("INSERT INTO users (email,password,full_name) VALUES ('packing-' || gen_random_uuid() || '@example.test','x','Ada Example') RETURNING id"); users.push(id);
    await pool.query("INSERT INTO user_organizations (organization_id,user_id,role_ids,status) VALUES ($1,$2,$3,'active')", [organizationId, id, JSON.stringify([role])]); return id;
  }
  const context = (userId = parent, unitId = organizationId) => ({ organizationId: unitId, yearId, userId });
  const auth = (userId = parent, unitId = organizationId) => ({ Authorization: `Bearer ${jwt.sign({ user_id: userId, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const input = (overrides = {}) => ({ season: 'winter', stay_type: 'cabin', nights: 2, expected_version: 0,
    notes_fr: 'Identifier les effets.', notes_en: '', published: true, reviewed: true,
    items: [{ key: 'bag', label_fr: 'Sac de couchage', label_en: '', quantity: 1 }, { key: 'socks', label_fr: 'Bas', label_en: '', quantity: 3 }], ...overrides });
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL }); organizationId = await unit(); otherUnit = await unit();
    yearId = await one("INSERT INTO scout_years (organization_id,label,start_date,end_date,status) VALUES ($1,'Fictional year',CURRENT_DATE-10,CURRENT_DATE+365,'active') RETURNING id", [organizationId]);
    manager = await member('organization', ['personal_equipment.manage', 'personal_equipment.view']);
    parent = await member('linked', ['personal_equipment.view']); otherParent = await member('linked', ['personal_equipment.view']);
    child = await one("INSERT INTO participants (first_name,last_name,date_naissance) VALUES ('Léa','Example','2016-05-01') RETURNING id");
    await pool.query('INSERT INTO participant_enrollments (participant_id,organization_id,scout_year_id) VALUES ($1,$2,$3)', [child, organizationId, yearId]);
    await grantParticipantAccess(pool, { participantId: child, userId: parent, sourceType: 'direct' });
    meetingId = await one("INSERT INTO year_plan_meetings (organization_id,meeting_date,meeting_kind,theme) VALUES ($1,CURRENT_DATE+3,'camp','Fictional winter camp') RETURNING id", [organizationId]);
    app = express(); app.locals.pool = pool; app.use(express.json()); app.use('/api/v1/personal-equipment', require('../routes/personal-equipment')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    await pool.query('DELETE FROM personal_equipment_lists WHERE organization_id=$1', [organizationId]);
    await pool.query('UPDATE year_plan_meetings SET is_cancelled=FALSE WHERE id=$1', [meetingId]);
    await saveList(pool, organizationId, manager, meetingId, input());
  });
  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id=ANY($1::int[])', [[organizationId, otherUnit]]);
    await pool.query('DELETE FROM scout_years WHERE organization_id=ANY($1::int[])', [[organizationId, otherUnit]]);
    await pool.query('DELETE FROM organizations WHERE id=ANY($1::int[])', [[organizationId, otherUnit]]);
    await pool.query('DELETE FROM participants WHERE id=$1', [child]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]); await pool.end();
  });
  test('a parent reads only their eligible children and no packing state is returned', async () => {
    const res = await request(app).get(`/api/v1/personal-equipment/${meetingId}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.children).toEqual([{ id: child, first_name: 'Léa', last_name: 'Example' }]);
    expect(JSON.stringify(res.body.data)).not.toMatch(/checked_keys|checked|may_check/);
    expect((await familyTasks(pool, context()))[0]).toMatchObject({ participant_id: child, item_keys: ['bag', 'socks'] });
  });
  test('another family or unit cannot read a camp list by guessing its id', async () => {
    await expect(readFamilyList(pool, context(otherParent), meetingId)).rejects.toMatchObject({ status: 404 });
    await expect(readFamilyList(pool, context(parent, otherUnit), meetingId)).rejects.toMatchObject({ status: 404 });
  });
  test('unpublished and cancelled lists are never shown to parents', async () => {
    await saveList(pool, organizationId, manager, meetingId, input({ expected_version: 1, published: false }));
    await expect(readFamilyList(pool, context(), meetingId)).rejects.toMatchObject({ status: 404 });
    expect(await familyTasks(pool, context())).toEqual([]);
    await saveList(pool, organizationId, manager, meetingId, input({ expected_version: 2 }));
    await pool.query('UPDATE year_plan_meetings SET is_cancelled=TRUE WHERE id=$1', [meetingId]);
    await expect(readFamilyList(pool, context(), meetingId)).rejects.toMatchObject({ status: 404 });
  });
  test('editing preserves stable keys and rejects stale concurrent edits', async () => {
    const next = await saveList(pool, organizationId, manager, meetingId, input({ expected_version: 1, items: [{ key: 'bag', label_fr: 'Sac chaud', label_en: '', quantity: 1 }] }));
    expect(next.version).toBe(2); expect(next.items[0].key).toBe('bag');
    await expect(saveList(pool, organizationId, manager, meetingId, input({ expected_version: 1 }))).rejects.toMatchObject({ status: 409 });
  });
  test('parallel requests reuse a common translation, send no child data and cannot invent item keys', async () => {
    generateText.mockResolvedValue({ data: { notes: 'Etiquetar.', items: [{ key: 'bag', label: 'Saco de dormir' }, { key: 'socks', label: 'Calcetines' }] } });
    const results = await Promise.all([translateList(pool, context(), meetingId, 'es'), translateList(pool, context(), meetingId, 'es')]);
    expect(results[0]).toEqual(results[1]); expect(generateText).toHaveBeenCalledTimes(1);
    const payload = generateText.mock.calls[0][1]; expect(payload).toEqual({ targetLocale: 'es', notes: 'Identifier les effets.', items: [{ key: 'bag', label: 'Sac de couchage' }, { key: 'socks', label: 'Bas' }] });
    expect(JSON.stringify(payload)).not.toContain('Léa');
    generateText.mockResolvedValueOnce({ data: { notes: '', items: [{ key: 'new', label: 'Invented' }] } });
    await expect(translateList(pool, context(), meetingId, 'de')).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });
  test('a new version cannot reuse a stale common translation', async () => {
    generateText.mockResolvedValue({ data: { notes: '', items: [{ key: 'bag', label: 'Saco' }, { key: 'socks', label: 'Calcetines' }] } });
    await translateList(pool, context(), meetingId, 'es');
    await saveList(pool, organizationId, manager, meetingId, input({ expected_version: 1 }));
    await translateList(pool, context(), meetingId, 'es'); expect(generateText).toHaveBeenCalledTimes(2);
  });
  test('families cannot publish common lists and no packing-state table or endpoint exists', async () => {
    expect((await request(app).put(`/api/v1/personal-equipment/${meetingId}`).set(auth()).send(input())).status).toBe(403);
    expect((await request(app).patch(`/api/v1/personal-equipment/${meetingId}/children/${child}/items/bag`).set(auth()).send({ checked: true })).status).toBe(404);
    expect(await one("SELECT to_regclass('public.personal_equipment_checks')")).toBeNull();
  });
  test('custom family roles replacing the built-in parent receive read access during the upgrade', async () => {
    const parentRole = await one("SELECT id FROM roles WHERE organization_id IS NULL AND role_name='parent'");
    const replacement = await one("INSERT INTO roles (role_name,display_name,data_scope,organization_id,customized_from_role_id) VALUES ('packing_parent_' || gen_random_uuid(),'Family role','linked',$1,$2) RETURNING id", [organizationId, parentRole]);
    const migration = require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/062_personal_camp_equipment.sql'), 'utf8');
    await pool.query(migration);
    expect(await one("SELECT COUNT(*)::int FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=$1 AND p.permission_key='personal_equipment.view'", [replacement])).toBe(1);
  });
  test('anonymous requests and malformed translation languages are rejected', async () => {
    expect((await request(app).get('/api/v1/personal-equipment/mine')).status).toBe(401);
    expect((await request(app).post(`/api/v1/personal-equipment/${meetingId}/translations`).set(auth()).send({ language: ['es'] })).status).toBe(400);
    expect((await request(app).get('/api/v1/personal-equipment/12abc')).status).toBe(401);
  });
});
