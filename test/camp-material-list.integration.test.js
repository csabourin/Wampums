/**
 * The collective material list of a camp on a disposable database: articles
 * added up across lines, free-text material kept apart, the inventory and
 * reservations over the camp's dates, and the unit of the token only.
 *
 * @module test/camp-material-list.integration
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY = 'camp-material-list-integration-secret';

describe.skipIf(!DATABASE_URL)('Camp material list', () => {
  let pool;
  let app;
  const units = [];
  const users = [];
  let quartermaster;
  let planner;
  let outsider;
  let camp;
  let outing;
  let otherCamp;
  let tent;
  let stove;
  let rope;
  let tentsInStock;
  let lanterns;
  let canoes;

  async function one(sql, params = []) {
    return Object.values((await pool.query(sql, params)).rows[0])[0];
  }
  /** A unit and its program section, which the unit's constraint requires in the same transaction. */
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Camp Unit') RETURNING id")).rows[0].id;
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
  async function role(organizationId, keys) {
    const id = await one(`INSERT INTO roles (role_name, display_name, data_scope, organization_id)
      VALUES ('camp_list_' || gen_random_uuid(), 'Camp helper', 'organization', $1) RETURNING id`, [organizationId]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [id, keys]);
    return id;
  }
  async function member(organizationId, roleId) {
    const id = await one("INSERT INTO users (email, password, full_name) VALUES ('camp-list-' || gen_random_uuid() || '@example.test', 'x', 'Léa Tremblay') RETURNING id");
    users.push(id);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [organizationId, id, JSON.stringify([roleId])]);
    return id;
  }
  /** A camp of three days: a year-plan meeting linked to an outing. */
  async function threeDayCamp(organizationId, start, end) {
    const activityId = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, 'Fictional camp', $3, 'Local', '09:00', '09:00', $3, '09:00', $4, '16:00') RETURNING id`,
    [organizationId, quartermaster, start, end]);
    const meetingId = await one(`INSERT INTO year_plan_meetings (organization_id, meeting_date, theme, meeting_kind, activity_id)
      VALUES ($1, $2, 'Camp d''automne', 'camp', $3) RETURNING id`, [organizationId, start, activityId]);
    return { meetingId, activityId };
  }
  function equipment(organizationId, name, total) {
    return one(`INSERT INTO equipment_items (organization_id, name, category, quantity_total, quantity_available)
      VALUES ($1, $2, 'camping', $3, $3) RETURNING id`, [organizationId, name, total]);
  }
  function article(organizationId, name, category, unitOfMeasure, equipmentItemId = null) {
    return one(`INSERT INTO equipment_catalog_items (organization_id, name, category, unit_of_measure, equipment_item_id)
      VALUES ($1, $2, $3, $4, $5) RETURNING id`, [organizationId, name, category, unitOfMeasure, equipmentItemId]);
  }
  function line(organizationId, meetingId, name, dayOffset, material = null) {
    return one(`INSERT INTO year_plan_meeting_activities (organization_id, meeting_id, name, day_offset, material)
      VALUES ($1, $2, $3, $4, $5) RETURNING id`, [organizationId, meetingId, name, dayOffset, material]);
  }
  async function needs(organizationId, lineId, { catalogItemId = null, equipmentItemId = null }, quantity) {
    await pool.query(`INSERT INTO meeting_activity_equipment (organization_id, meeting_activity_id, catalog_item_id, equipment_item_id, quantity)
      VALUES ($1, $2, $3, $4, $5)`, [organizationId, lineId, catalogItemId, equipmentItemId, quantity]);
  }
  async function reserve(organizationId, equipmentItemId, quantity, { meetingId = null, activityId = null, from, to }) {
    await pool.query(`INSERT INTO equipment_reservations
      (organization_id, equipment_id, meeting_id, activity_id, meeting_date, date_from, date_to, reserved_quantity, reserved_for, status)
      VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'Fictional', 'reserved')`,
    [organizationId, equipmentItemId, meetingId, activityId, from, to, quantity]);
  }
  function as(userId, organizationId = units[0]) {
    return { Authorization: `Bearer ${jwt.sign({ user_id: userId, organizationId }, process.env.JWT_SECRET_KEY)}` };
  }
  function list(meetingId, userId = quartermaster, organizationId = units[0]) {
    return request(app).get(`/api/v1/yearly-planner/meetings/${meetingId}/material-list`).set(as(userId, organizationId));
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const first = await unit();
    const second = await unit();
    quartermaster = await member(first, await role(first, ['meetings.view', 'inventory.view']));
    planner = await member(first, await role(first, ['meetings.view']));
    outsider = await member(second, await role(second, ['meetings.view', 'inventory.view']));
    ({ meetingId: camp, activityId: outing } = await threeDayCamp(first, '2026-11-13', '2026-11-15'));
    ({ meetingId: otherCamp } = await threeDayCamp(second, '2026-11-14', '2026-11-16'));

    tentsInStock = await equipment(first, 'Tentes du local', 6);
    lanterns = await equipment(first, 'Lanternes', 4);
    canoes = await equipment(second, 'Canots', 3);
    tent = await article(first, 'Tente 4 places', 'camping', 'each', tentsInStock);
    stove = await article(first, 'Réchaud', 'kitchen', 'each');
    rope = await article(first, 'Corde', 'tools', 'm');

    const setup = await line(first, camp, 'Montage du camp', 0, 'Maillets, piquets de rechange');
    const night = await line(first, camp, 'Veillée', 1, '   ');
    const meal = await line(first, camp, 'Repas', 1);
    const knots = await line(first, camp, 'Nœuds', 2, 'Cordes de couleur');
    await needs(first, setup, { catalogItemId: tent }, 3);
    await needs(first, setup, { equipmentItemId: lanterns }, 2);
    await needs(first, night, { equipmentItemId: lanterns }, 3);
    await needs(first, night, { equipmentItemId: tentsInStock }, 1);
    await needs(first, meal, { catalogItemId: stove }, 2);
    await needs(first, knots, { catalogItemId: rope }, 12.5);
    await needs(first, knots, { catalogItemId: stove }, 1);

    // Two tents reserved for this camp; another booking takes four over the same dates.
    await reserve(first, tentsInStock, 2, { activityId: outing, from: '2026-11-13', to: '2026-11-15' });
    await reserve(first, tentsInStock, 4, { from: '2026-11-14', to: '2026-11-14' });
    // A lantern reserved by the meeting itself, and one held by an outing the week after.
    await reserve(first, lanterns, 1, { meetingId: camp, from: '2026-11-13', to: '2026-11-15' });
    await reserve(first, lanterns, 4, { from: '2026-11-20', to: '2026-11-21' });

    const theirLine = await line(second, otherCamp, 'Leur canot', 0, 'Pagaies');
    await needs(second, theirLine, { equipmentItemId: canoes }, 3);
    await reserve(second, canoes, 3, { meetingId: otherCamp, from: '2026-11-14', to: '2026-11-16' });

    app = express();
    app.locals.pool = pool;
    app.use(express.json());
    app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, { error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
      await pool.end();
    }
  });

  test('an article asked for by two activities appears once, with the total quantity', async () => {
    const res = await list(camp);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.items.map((item) => [item.name, item]));
    expect(byName['Réchaud'].quantity).toBe(3);
    expect(byName['Réchaud'].uses.map((use) => [use.name, use.quantity])).toEqual([['Repas', 2], ['Nœuds', 1]]);
    expect(byName.Lanternes.quantity).toBe(5);
    expect(byName.Corde).toMatchObject({ quantity: 12.5, unit_of_measure: 'm' });
  });

  test('an inventory item listed directly joins the article that stands for it', async () => {
    const { items } = (await list(camp)).body.data;
    const tents = items.filter((item) => item.equipment_item_id === tentsInStock);
    expect(tents).toEqual([expect.objectContaining({ name: 'Tente 4 places', catalog_item_id: tent, quantity: 4 })]);
  });

  test('entries are sorted by category, then by name', async () => {
    const { items } = (await list(camp)).body.data;
    expect(items.map((item) => item.name)).toEqual(['Lanternes', 'Tente 4 places', 'Réchaud', 'Corde']);
  });

  test('free-text material is listed apart, line by line, blank material left out', async () => {
    const { free_text: freeText } = (await list(camp)).body.data;
    expect(freeText.map((entry) => [entry.name, entry.day_offset, entry.material])).toEqual([
      ['Montage du camp', 0, 'Maillets, piquets de rechange'],
      ['Nœuds', 2, 'Cordes de couleur'],
    ]);
  });

  test('each inventory entry says what is reserved, still free over the camp dates, or missing', async () => {
    const { data } = (await list(camp)).body;
    expect(data.inventory_compared).toBe(true);
    expect(data.camp).toMatchObject({ date_from: '2026-11-13', date_to: '2026-11-15' });
    const byName = Object.fromEntries(data.items.map((item) => [item.name, item.inventory]));
    // Six tents: two reserved for this camp, four taken by another booking; four needed.
    expect(byName['Tente 4 places']).toEqual({ status: 'missing', reserved: 2, free: 0, missing: 2 });
    // Four lanterns: one reserved here, the week-after booking does not overlap; five needed.
    expect(byName.Lanternes).toEqual({ status: 'missing', reserved: 1, free: 3, missing: 1 });
    expect(byName['Réchaud']).toEqual({ status: 'not_in_inventory' });
  });

  test('an entry fully reserved, or within what is free, reads as such', async () => {
    await pool.query('UPDATE equipment_items SET quantity_total = 10 WHERE id = $1', [lanterns]);
    await pool.query('UPDATE equipment_reservations SET reserved_quantity = 1 WHERE equipment_id = $1 AND activity_id IS NULL', [tentsInStock]);
    try {
      const byName = Object.fromEntries((await list(camp)).body.data.items.map((item) => [item.name, item.inventory]));
      expect(byName.Lanternes).toMatchObject({ status: 'available', reserved: 1, missing: 0 });
      expect(byName['Tente 4 places']).toMatchObject({ status: 'available', reserved: 2, free: 3 });
      await pool.query('UPDATE equipment_reservations SET reserved_quantity = 4 WHERE equipment_id = $1 AND activity_id = $2', [tentsInStock, outing]);
      const again = Object.fromEntries((await list(camp)).body.data.items.map((item) => [item.name, item.inventory]));
      expect(again['Tente 4 places']).toMatchObject({ status: 'reserved', reserved: 4, missing: 0 });
    } finally {
      await pool.query('UPDATE equipment_items SET quantity_total = 4 WHERE id = $1', [lanterns]);
      await pool.query('UPDATE equipment_reservations SET reserved_quantity = 4 WHERE equipment_id = $1 AND activity_id IS NULL', [tentsInStock]);
      await pool.query('UPDATE equipment_reservations SET reserved_quantity = 2 WHERE equipment_id = $1 AND activity_id = $2', [tentsInStock, outing]);
    }
  });

  test('equipment reserved for the camp that no line lists is pointed out', async () => {
    const extra = await equipment(units[0], 'Bâche', 2);
    await reserve(units[0], extra, 1, { activityId: outing, from: '2026-11-13', to: '2026-11-15' });
    const { unlisted_reservations: unlisted } = (await list(camp)).body.data;
    expect(unlisted).toEqual([{ equipment_item_id: extra, name: 'Bâche', category: 'camping', reserved: 1 }]);
  });

  test('without the inventory right, the list is shown without the comparison', async () => {
    const res = await list(camp, planner);
    expect(res.status).toBe(200);
    expect(res.body.data.inventory_compared).toBe(false);
    expect(res.body.data.unlisted_reservations).toBeNull();
    expect(res.body.data.items.every((item) => item.inventory === undefined)).toBe(true);
  });

  test('another unit\'s camp is not found, and its equipment never shows here', async () => {
    expect((await list(otherCamp)).status).toBe(404);
    expect((await list(camp, outsider, units[1])).status).toBe(404);
    const theirs = (await list(otherCamp, outsider, units[1])).body.data;
    expect(theirs.items.map((item) => item.name)).toEqual(['Canots']);
    const { items } = (await list(camp)).body.data;
    expect(items.map((item) => item.name)).not.toContain('Canots');
  });

  test('equipment the unit may no longer use reads as unavailable, not as free', async () => {
    const borrowed = await equipment(units[1], 'Canot emprunté', 2);
    await pool.query('INSERT INTO equipment_item_organizations (equipment_id, organization_id) VALUES ($1, $2)', [borrowed, units[0]]);
    const paddle = await line(units[0], camp, 'Canot', 2);
    await needs(units[0], paddle, { equipmentItemId: borrowed }, 1);
    const shared = (await list(camp)).body.data.items.find((item) => item.name === 'Canot emprunté');
    expect(shared.inventory).toMatchObject({ status: 'available', free: 2 });

    await pool.query('DELETE FROM equipment_item_organizations WHERE equipment_id = $1', [borrowed]);
    const revoked = (await list(camp)).body.data.items.find((item) => item.name === 'Canot emprunté');
    expect(revoked.inventory).toEqual({ status: 'unavailable', reserved: 0, free: 0, missing: 1 });
  });

  test('a malformed camp id is refused', async () => {
    expect((await list('12abc')).status).toBe(400);
  });
});
