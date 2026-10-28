/* eslint-disable no-await-in-loop -- Each fictional unit is created with its dependent role and member before recording cleanup IDs. */
/** True Scout group ownership shares one physical stock, without guessing legacy ownership. */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
const { isEquipmentAccessible } = require('../services/equipmentAccess');
require('./jest-conditional-helpers');
const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY = 'fictional-material-ownership-integration';

describe.skipIf(!DATABASE_URL)('Material ownership', () => {
  let pool; let app; const units = []; const users = []; const groups = []; const people = [];
  let legacy; let article; let equipment;
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0])[0];
  const auth = (index = 0) => ({ Authorization: `Bearer ${jwt.sign({ user_id: people[index], organizationId: units[index] }, process.env.JWT_SECRET_KEY)}` });
  const call = (method, path, index = 0) => request(app)[method](`/api/v1/${path}`).set(auth(index));
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    for (let index = 0; index < 3; index++) {
      const db = await pool.connect();
      let id;
      try {
        await db.query('BEGIN');
        id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Material Unit') RETURNING id")).rows[0].id;
        await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
        await db.query('COMMIT');
      } catch (err) { await db.query('ROLLBACK'); throw err; } finally { db.release(); }
      units.push(id);
      const role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('material_' || gen_random_uuid(), 'Fictional equipment helper', 'organization', $1) RETURNING id", [id]);
      await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [role, ['inventory.view', 'inventory.manage', 'equipment_catalog.manage', 'activities.view']]);
      const user = await one("INSERT INTO users (email, password, full_name) VALUES ('material-' || gen_random_uuid() || '@example.test', 'x', 'Fictional Helper') RETURNING id");
      users.push(user); people.push(user);
      await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [id, user, JSON.stringify([role])]);
    }
    for (let index = 0; index < 2; index++) {
      groups.push(await one("INSERT INTO local_groups (name, slug) VALUES ('Fictional Scout Group', $1) RETURNING id", [`material-${randomUUID()}`]));
    }
    // The record's managing unit is in both groups. Ownership selects exactly one.
    await pool.query('INSERT INTO organization_local_groups (organization_id, local_group_id) VALUES ($1,$4),($1,$5),($2,$4),($3,$5)', [...units, ...groups]);
    legacy = await one("INSERT INTO equipment_items (organization_id, name, category, quantity_total, quantity_available, attributes) VALUES ($1, 'Historic group stove', 'kitchen', 7, 7, '{\"share_with_local_group\":false}') RETURNING id", [units[0]]);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/resources', require('../routes/resources')(pool));
    app.use('/api/v1/equipment-catalog', require('../routes/equipmentCatalog')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: err.message }));
  });
  afterAll(async () => {
    if (!pool) { return; }
    await pool.query('DELETE FROM equipment_items WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM scout_years WHERE organization_id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM local_groups WHERE id = ANY($1::int[])', [groups]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await pool.end();
  });
  test('legacy ownership stays unspecified and can be corrected without duplicating stock', async () => {
    const before = await call('get', 'resources/equipment');
    expect(before.status).toBe(200);
    expect(before.body.data.equipment.find((row) => row.id === legacy)).toMatchObject({ owner_type: null, quantity_total: 7 });
    const saved = await call('put', `resources/equipment/${legacy}`).send({ owner_type: 'group', owner_local_group_id: groups[0] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.equipment).toMatchObject({ id: legacy, owner_type: 'group', owner_local_group_id: groups[0], quantity_total: 7 });
    expect(Number(await one('SELECT COUNT(*) FROM equipment_items WHERE organization_id = $1', [units[0]]))).toBe(1);
  });
  test('group members see the same item and other groups cannot use a stale explicit share', async () => {
    await pool.query("UPDATE equipment_items SET owner_type='group', owner_local_group_id=$2 WHERE id=$1", [legacy, groups[0]]);
    await pool.query('INSERT INTO equipment_item_organizations (equipment_id, organization_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [legacy, units[2]]);
    expect(await isEquipmentAccessible(pool, units[1], legacy)).toBe(true);
    expect(await isEquipmentAccessible(pool, units[2], legacy)).toBe(false);
    const member = await call('get', 'resources/equipment', 1);
    expect(member.status).toBe(200);
    expect(member.body.data.equipment.filter((row) => row.id === legacy)).toHaveLength(1);
    expect(member.body.data.equipment[0].shared_organizations).toHaveLength(2);
    expect((await call('get', 'resources/equipment/reservations', 1)).status).toBe(200);
    expect((await call('get', 'resources/status/dashboard', 1)).status).toBe(200);
    const outsider = await call('get', 'resources/equipment', 2);
    expect(outsider.body.data.equipment.some((row) => row.id === legacy)).toBe(false);
  });
  test('ownership choices only list groups of the current unit and another unit cannot transfer ownership', async () => {
    const choices = await call('get', 'resources/equipment/owners', 1);
    expect(choices.status).toBe(200);
    expect(choices.body.data.map((row) => row.id)).toEqual([groups[0]]);
    expect((await call('put', `resources/equipment/${legacy}`, 1).send({ owner_type: 'unit', owner_local_group_id: null })).status).toBe(404);
    expect((await call('post', 'resources/equipment', 1).send({ name: 'Invalid owner', quantity_total: 1, owner_type: 'group', owner_local_group_id: groups[1] })).status).toBe(400);
  });
  test('one article can create group stock atomically including zero quantity', async () => {
    const saved = await call('post', 'equipment-catalog').send({ name: 'Group cooking pot', category: 'kitchen', unit_of_measure: 'each', stock: { quantity_total: 0, owner_type: 'group', owner_local_group_id: groups[0] } });
    expect(saved.status).toBe(201); article = saved.body.data.id; equipment = saved.body.data.equipment_item_id;
    expect((await pool.query('SELECT * FROM equipment_items WHERE id=$1', [equipment])).rows[0]).toMatchObject({ owner_type: 'group', owner_local_group_id: groups[0], quantity_total: 0 });
    const renamed = await call('patch', `equipment-catalog/${article}`).send({ name: 'Renamed group pot', sync_stock: true });
    expect(renamed.status).toBe(200);
    expect(await one('SELECT name FROM equipment_items WHERE id=$1', [equipment])).toBe('Renamed group pot');
  });
  test('duplicate names and invalid group ownership roll back the article and never overwrite stock', async () => {
    const duplicate = await call('post', 'equipment-catalog').send({ name: 'Historic group stove', stock: { quantity_total: 99, owner_type: 'unit' } });
    expect(duplicate.status).toBe(409);
    expect(await one('SELECT quantity_total FROM equipment_items WHERE id=$1', [legacy])).toBe(7);
    const badOwner = await call('post', 'equipment-catalog', 1).send({ name: 'Rolled back', stock: { quantity_total: 1, owner_type: 'group', owner_local_group_id: groups[1] } });
    expect(badOwner.status).toBe(400);
    expect(Number(await one("SELECT COUNT(*) FROM equipment_catalog_items WHERE organization_id=$1 AND name='Rolled back'", [units[1]]))).toBe(0);
    expect((await call('post', 'resources/equipment').send({ name: 'Historic group stove', quantity_total: 99, owner_type: 'unit' })).status).toBe(409);
    expect(await one('SELECT quantity_total FROM equipment_items WHERE id=$1', [legacy])).toBe(7);
  });
});
