'use strict';

/**
 * Equipment loans in PostgreSQL: after a camp, leaders record who takes which
 * tents and tarps home, and the unit sees what has not come back.
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'equipment-loans-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SIMULTANEOUS_HANDOUTS = 6;
const TENTS = 6;
const TARPS = 4;

describe.skipIf(!DATABASE_URL)('Equipment loans', () => {
  let pool;
  let app;
  const ids = {};

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
  }

  function as(user, unitId = ids.unit) {
    const token = signJWTToken({ user_id: user, organizationId: unitId });
    return {
      get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
      post: (url, body, key) => {
        const call = request(app).post(url).set('Authorization', `Bearer ${token}`);
        return (key ? call.set('Idempotency-Key', key) : call).send(body);
      },
      patch: (url, body) => request(app).patch(url).set('Authorization', `Bearer ${token}`).send(body),
      delete: (url) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
    };
  }

  async function unit(name) {
    const client = await pool.connect();
    let id;
    try {
      await client.query('BEGIN');
      id = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await pool.query("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active')", [id]);
    return id;
  }

  async function role(permissions, scope = 'organization') {
    const id = await one('INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, $2) RETURNING id',
      [`loans_${randomUUID()}`, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])',
      [id, permissions]);
    return id;
  }

  async function member(unitId, roleId, fullName) {
    const id = await one("INSERT INTO users (email, password, full_name) VALUES ($1, 'x', $2) RETURNING id",
      [`${randomUUID()}@example.test`, fullName]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')",
      [id, unitId, JSON.stringify([roleId])]);
    return id;
  }

  async function youth(unitId, firstName) {
    const id = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Lovelace', '2015-01-01') RETURNING id", [firstName]);
    await pool.query('INSERT INTO participant_organizations (participant_id, organization_id) VALUES ($1, $2)', [id, unitId]);
    return id;
  }

  function item(unitId, name, quantity) {
    return one(`INSERT INTO equipment_items (organization_id, name, category, quantity_total, quantity_available, attributes)
                VALUES ($1, $2, 'camping', $3, $3, '{"share_with_local_group": false}'::jsonb) RETURNING id`,
    [unitId, name, quantity]);
  }

  const outstanding = (equipmentId) => one(
    'SELECT COALESCE(SUM(quantity - returned_quantity), 0)::int FROM equipment_loans WHERE equipment_id = $1 AND returned_at IS NULL',
    [equipmentId]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit('Loans unit');
    ids.otherUnit = await unit('Other loans unit');
    const lender = await role(['inventory.view', 'inventory.reserve', 'participants.view']);
    const viewer = await role(['inventory.view']);
    const parentRole = await role(['inventory.view'], 'linked');
    ids.leader = await member(ids.unit, lender, 'Léa Tremblay');
    ids.viewer = await member(ids.unit, viewer, 'Grace Hopper');
    ids.parent = await member(ids.unit, parentRole, 'Marie Curie');
    ids.otherLeader = await member(ids.otherUnit, lender, 'Alan Turing');
    ids.ada = await youth(ids.unit, 'Ada');
    ids.max = await youth(ids.unit, 'Max');
    ids.stranger = await youth(ids.otherUnit, 'Nadia');
    ids.tents = await item(ids.unit, 'Tente 4 places', TENTS);
    ids.tarps = await item(ids.unit, 'Bâche', TARPS);
    ids.otherTents = await item(ids.otherUnit, 'Tente', TENTS);
    ids.camp = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
        meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, 'Camp des Érables', CURRENT_DATE - 2, 'Local', '08:00', '08:15', CURRENT_DATE - 2, '08:00', CURRENT_DATE - 1, '16:00')
      RETURNING id`, [ids.unit, ids.leader]);
    await pool.query(`INSERT INTO equipment_reservations (organization_id, equipment_id, activity_id, meeting_date, date_from, date_to,
        reserved_quantity, reserved_for, status)
      VALUES ($1, $2, $3, CURRENT_DATE - 2, CURRENT_DATE - 2, CURRENT_DATE - 2, 5, 'Camp des Érables', 'expired'),
             ($1, $4, $3, CURRENT_DATE - 2, CURRENT_DATE - 2, CURRENT_DATE - 2, 2, 'Camp des Érables', 'confirmed')`,
    [ids.unit, ids.tents, ids.camp, ids.tarps]);

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/equipment-loans', require('../routes/equipmentLoans')(pool));
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    app.use('/api/v1/resources', require('../routes/resources')(pool, logger));
  });

  afterAll(async () => {
    await pool?.query('DELETE FROM equipment_loans WHERE organization_id = ANY($1::int[])', [[ids.unit, ids.otherUnit]]);
    await pool?.end();
  });

  test('after a camp, the handout offers what the camp reserved and the unit\'s youths and leaders', async () => {
    const response = await as(ids.leader).get(`/api/v1/equipment-loans/handout?activity_id=${ids.camp}`).expect(200);
    const { items, holders, activities } = response.body.data;

    expect(activities.map((activity) => activity.id)).toContain(ids.camp);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ equipment_id: ids.tents, reserved_quantity: 5, quantity_total: TENTS }),
      expect.objectContaining({ equipment_id: ids.tarps, reserved_quantity: 2 }),
    ]));
    expect(holders.participants.map((youthRow) => youthRow.id).sort()).toEqual([ids.ada, ids.max].sort());
    expect(holders.adults.map((adult) => adult.id)).toContain(ids.leader);
    expect(holders.participants.map((youthRow) => youthRow.id)).not.toContain(ids.stranger);
  });

  test('a youth and a leader take tents and tarps home, and the inventory shows them out', async () => {
    const response = await as(ids.leader).post('/api/v1/equipment-loans', {
      activity_id: ids.camp,
      reason: 'drying',
      loans: [
        { equipment_id: ids.tents, quantity: 2, participant_id: ids.ada },
        { equipment_id: ids.tarps, quantity: 1, user_id: ids.leader },
      ],
    }).expect(201);

    expect(response.body.data.loans).toEqual([
      expect.objectContaining({ holder_name: 'Ada Lovelace', holder_type: 'participant', equipment_name: 'Tente 4 places', outstanding_quantity: 2 }),
      expect.objectContaining({ holder_name: 'Léa Tremblay', holder_type: 'user', equipment_name: 'Bâche', outstanding_quantity: 1 }),
    ]);
    const inventory = await as(ids.leader).get('/api/v1/resources/equipment').expect(200);
    const tents = inventory.body.data.equipment.find((row) => row.id === ids.tents);
    expect(tents.loaned_quantity).toBe(2);

    const list = await as(ids.viewer).get('/api/v1/equipment-loans').expect(200);
    expect(list.body.data.loans.map((loan) => loan.holder_name)).toEqual(expect.arrayContaining(['Ada Lovelace', 'Léa Tremblay']));
  });

  test('a reservation cannot count on tents that are still drying at someone\'s home', async () => {
    const lent = await outstanding(ids.tents);
    const fits = TENTS - lent;
    const tooMany = await as(ids.leader).post('/api/v1/resources/equipment/reservations', {
      equipment_id: ids.tents, date_from: '2027-01-10', date_to: '2027-01-11', reserved_quantity: fits + 1, reserved_for: 'Sortie hiver',
    });
    expect(tooMany.status).toBe(400);
  });

  test('two devices lending the last tents at the same moment never lend more than the unit owns', async () => {
    const left = TENTS - await outstanding(ids.tents);
    const results = await Promise.all(Array.from({ length: SIMULTANEOUS_HANDOUTS }, () =>
      as(ids.leader).post('/api/v1/equipment-loans', { loans: [{ equipment_id: ids.tents, quantity: left, participant_id: ids.max }] })));

    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    results.filter((result) => result.status !== 201).forEach((result) => {
      expect(result.status).toBe(409);
      expect(result.body.message).toBe('equipment_loan_exceeds_stock');
    });
    expect(await outstanding(ids.tents)).toBe(TENTS);
  });

  test('a handout replayed from the offline outbox is recorded once', async () => {
    const body = { loans: [{ equipment_id: ids.tarps, quantity: 1, participant_id: ids.max }] };
    const first = await as(ids.leader).post('/api/v1/equipment-loans', body, 'camp-handout-1').expect(201);
    const replay = await as(ids.leader).post('/api/v1/equipment-loans', body, 'camp-handout-1').expect(201);

    expect(replay.body.data).toEqual(first.body.data);
    expect(await one('SELECT COUNT(*)::int FROM equipment_loans WHERE equipment_id = $1 AND holder_participant_id = $2',
      [ids.tarps, ids.max])).toBe(1);
    await as(ids.leader).post('/api/v1/equipment-loans', { loans: [{ ...body.loans[0], quantity: 2 }] }, 'camp-handout-1').expect(409);
  });

  test('equipment comes back in parts, and the loan closes when everything is back', async () => {
    const created = await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: ids.tarps, quantity: 1, participant_id: ids.ada }],
    }).expect(201);
    const tentLoan = (await as(ids.leader).get('/api/v1/equipment-loans').expect(200)).body.data.loans
      .find((loan) => loan.equipment_id === ids.tents && loan.holder_participant_id === ids.ada);

    const partial = await as(ids.leader).patch(`/api/v1/equipment-loans/${tentLoan.id}`, { returned_quantity: 1 }).expect(200);
    expect(partial.body.data.loan).toMatchObject({ outstanding_quantity: 1, returned_at: null });

    const full = await as(ids.leader).patch(`/api/v1/equipment-loans/${tentLoan.id}`, { returned_quantity: 2, return_note: 'Sèche, en bon état' }).expect(200);
    expect(full.body.data.loan.returned_at).not.toBeNull();
    expect(full.body.data.loan.return_note).toBe('Sèche, en bon état');
    // Sending the same return again changes nothing.
    await as(ids.leader).patch(`/api/v1/equipment-loans/${tentLoan.id}`, { returned_quantity: 2 }).expect(200);

    const open = (await as(ids.leader).get('/api/v1/equipment-loans').expect(200)).body.data.loans;
    expect(open.map((loan) => loan.id)).not.toContain(tentLoan.id);
    const returned = (await as(ids.leader).get('/api/v1/equipment-loans?status=returned').expect(200)).body.data.loans;
    expect(returned.map((loan) => loan.id)).toContain(tentLoan.id);

    await as(ids.leader).patch(`/api/v1/equipment-loans/${created.body.data.loans[0].id}`, { returned_quantity: 2 }).expect(400);
  });

  test('a returned loan cannot be reopened when its units were lent again since', async () => {
    const tentLoan = (await as(ids.leader).get('/api/v1/equipment-loans?status=returned').expect(200)).body.data.loans
      .find((loan) => loan.equipment_id === ids.tents);
    await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: ids.tents, quantity: TENTS - await outstanding(ids.tents), participant_id: ids.ada }],
    }).expect(201);

    const reopened = await as(ids.leader).patch(`/api/v1/equipment-loans/${tentLoan.id}`, { returned_quantity: 0 });
    expect(reopened.status).toBe(409);
  });

  test('a loan names only youths and members of the unit, and only its equipment', async () => {
    const stranger = await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: ids.tarps, quantity: 1, participant_id: ids.stranger }],
    });
    expect(stranger.status).toBe(400);
    expect(stranger.body.message).toBe('equipment_loan_holder_not_in_unit');

    const otherAdult = await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: ids.tarps, quantity: 1, user_id: ids.otherLeader }],
    });
    expect(otherAdult.status).toBe(400);

    await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: ids.otherTents, quantity: 1, participant_id: ids.ada }],
    }).expect(404);
  });

  test('another unit neither sees nor changes this unit\'s loans', async () => {
    const loanId = (await as(ids.leader).get('/api/v1/equipment-loans').expect(200)).body.data.loans[0].id;
    const theirs = await as(ids.otherLeader, ids.otherUnit).get('/api/v1/equipment-loans').expect(200);
    expect(theirs.body.data.loans).toEqual([]);
    await as(ids.otherLeader, ids.otherUnit).patch(`/api/v1/equipment-loans/${loanId}`, { returned_quantity: 1 }).expect(404);
    await as(ids.otherLeader, ids.otherUnit).delete(`/api/v1/equipment-loans/${loanId}`).expect(404);
  });

  test('someone who may only look at the inventory cannot lend, and a parent cannot read the loans', async () => {
    const refused = await as(ids.viewer).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: ids.tarps, quantity: 1, participant_id: ids.ada }],
    }).expect(403);
    expect(refused.body.missing).toEqual(['inventory.reserve']);

    const parent = await as(ids.parent).get('/api/v1/equipment-loans').expect(403);
    expect(parent.body.required).toEqual(['inventory.view']);
  });

  test('erasing a youth keeps the loan, without a holder, so the equipment is still known to be out', async () => {
    const nadia = await youth(ids.unit, 'Nadia');
    const created = await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: ids.tarps, quantity: 1, participant_id: nadia }],
    });
    expect(created.status).toBe(201);
    await pool.query('DELETE FROM participant_enrollments WHERE participant_id = $1', [nadia]);
    await pool.query('DELETE FROM participants WHERE id = $1', [nadia]);

    const loan = (await as(ids.leader).get('/api/v1/equipment-loans').expect(200)).body.data.loans
      .find((row) => row.id === created.body.data.loans[0].id);
    expect(loan).toMatchObject({ holder_name: null, holder_type: null, outstanding_quantity: 1 });
  });
});
