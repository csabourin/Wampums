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

  test('equipment reserved for an outing to come is not lent past that outing', async () => {
    const stoves = await item(ids.unit, 'Réchaud', 2);
    await as(ids.leader).post('/api/v1/resources/equipment/reservations', {
      equipment_id: stoves, date_from: '2099-05-01', date_to: '2099-05-02', reserved_quantity: 2, reserved_for: 'Sortie printemps',
    }).expect(201);

    const openEnded = await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: stoves, quantity: 1, participant_id: ids.ada }],
    });
    expect(openEnded.status).toBe(409);
    expect(openEnded.body.errors).toEqual([{ equipment_id: stoves, available: 0, requested: 1 }]);

    // Due back before the outing, the stove can go.
    await as(ids.leader).post('/api/v1/equipment-loans', {
      due_date: '2099-04-30', loans: [{ equipment_id: stoves, quantity: 1, participant_id: ids.ada }],
    }).expect(201);
  });

  test('two separate weekends of three tents each leave three free, not none', async () => {
    const tents = await item(ids.unit, 'Tente 2 places', 6);
    const reserve = (from, to) => as(ids.leader).post('/api/v1/resources/equipment/reservations', {
      equipment_id: tents, date_from: from, date_to: to, reserved_quantity: 3, reserved_for: `Sortie ${from}`,
    }).expect(201);
    await reserve('2099-06-05', '2099-06-07');
    await reserve('2099-06-12', '2099-06-14');

    await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: tents, quantity: 3, participant_id: ids.ada }],
    }).expect(201);
    await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: tents, quantity: 1, participant_id: ids.max }],
    }).expect(409);
  });

  test('loans due back before a reservation leave its units free for it, and for a loan after', async () => {
    const tents = await item(ids.unit, 'Tente 3 places', 6);
    await as(ids.leader).post('/api/v1/equipment-loans', {
      due_date: '2099-08-01', loans: [{ equipment_id: tents, quantity: 3, participant_id: ids.ada }],
    }).expect(201);
    await as(ids.leader).post('/api/v1/resources/equipment/reservations', {
      equipment_id: tents, date_from: '2099-08-07', date_to: '2099-08-09', reserved_quantity: 3, reserved_for: 'Sortie août',
    }).expect(201);

    // Three out until the 1st, three reserved the 7th: never more than six at once.
    await as(ids.leader).post('/api/v1/equipment-loans', {
      due_date: '2099-08-20', loans: [{ equipment_id: tents, quantity: 3, participant_id: ids.max }],
    }).expect(201);
    await as(ids.leader).post('/api/v1/equipment-loans', {
      due_date: '2099-07-15', loans: [{ equipment_id: tents, quantity: 1, participant_id: ids.max }],
    }).expect(409);
  });

  test('a camp under way whose tents went home counts them once, as loans', async () => {
    const tents = await item(ids.unit, 'Tente prospecteur', 6);
    const campId = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
        meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, 'Camp en cours', CURRENT_DATE - 1, 'Local', '08:00', '08:15', CURRENT_DATE - 1, '08:00', CURRENT_DATE + 1, '16:00')
      RETURNING id`, [ids.unit, ids.leader]);
    await pool.query(`INSERT INTO equipment_reservations (organization_id, equipment_id, activity_id, meeting_date, date_from, date_to,
        reserved_quantity, reserved_for, status)
      VALUES ($1, $2, $3, CURRENT_DATE - 1, CURRENT_DATE - 1, CURRENT_DATE + 1, 3, 'Camp en cours', 'confirmed')`,
    [ids.unit, tents, campId]);
    await as(ids.leader).post('/api/v1/equipment-loans', {
      activity_id: campId, loans: [{ equipment_id: tents, quantity: 3, participant_id: ids.ada }],
    }).expect(201);

    await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: tents, quantity: 3, participant_id: ids.max }],
    }).expect(201);
  });

  function activity(name, startOffset, endOffset) {
    return one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
        meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, $3, CURRENT_DATE + $4::int, 'Local', '08:00', '08:15', CURRENT_DATE + $4::int, '08:00', CURRENT_DATE + $5::int, '16:00')
      RETURNING id`, [ids.unit, ids.leader, name, startOffset, endOffset]);
  }

  function reserveFor(activityId, equipmentId, quantity, startOffset, endOffset, status = 'reserved') {
    return one(`INSERT INTO equipment_reservations (organization_id, equipment_id, activity_id, meeting_date, date_from, date_to,
        reserved_quantity, reserved_for, status)
      VALUES ($1, $2, $3, CURRENT_DATE + $5::int, CURRENT_DATE + $5::int, CURRENT_DATE + $6::int, $4, 'Sortie', $7) RETURNING id`,
    [ids.unit, equipmentId, activityId, quantity, startOffset, endOffset, status]);
  }

  test('tents lent for an outing and due back before it are reserved for it again on the day', async () => {
    const tents = await item(ids.unit, 'Tente montagne', 6);
    const outing = await activity('Sortie de la semaine prochaine', 7, 9);
    await reserveFor(outing, tents, 6, 7, 9);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await as(ids.leader).post('/api/v1/equipment-loans', {
      activity_id: outing, due_date: tomorrow, loans: [{ equipment_id: tents, quantity: 3, participant_id: ids.ada }],
    }).expect(201);

    // All six are the outing's next weekend, whoever dries three of them now.
    await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: tents, quantity: 3, participant_id: ids.max }],
    }).expect(409);
  });

  test('picking up a camp reservation whose tents were handed out is not refused for lack of stock', async () => {
    const tents = await item(ids.unit, 'Tente dôme', 6);
    const camp = await activity('Camp du moment', -1, 1);
    const reservationId = await reserveFor(camp, tents, 6, -1, 1);
    await as(ids.leader).post('/api/v1/equipment-loans', {
      activity_id: camp, loans: [{ equipment_id: tents, quantity: 6, participant_id: ids.ada }],
    }).expect(201);

    await as(ids.leader).patch(`/api/v1/resources/equipment/reservations/${reservationId}`, { status: 'confirmed' }).expect(200);
  });

  test('another outing can reserve the tents a camp under way did not take, its handed-out tents counted once', async () => {
    const tents = await item(ids.unit, 'Tente familiale', 6);
    const camp = await activity('Camp A', -1, 2);
    await reserveFor(camp, tents, 3, -1, 2, 'confirmed');
    await as(ids.leader).post('/api/v1/equipment-loans', {
      activity_id: camp, loans: [{ equipment_id: tents, quantity: 3, participant_id: ids.ada }],
    }).expect(201);
    const outing = await activity('Sortie B', 1, 2);

    await as(ids.leader).post('/api/v1/resources/equipment/reservations/bulk', {
      activity_id: outing, reserved_for: 'Sortie B', items: [{ equipment_id: tents, quantity: 3 }],
    }).expect(201);
    // Tomorrow: three at the camp (reserved and handed out), three for the outing.
    const tomorrow = await one('SELECT (CURRENT_DATE + 1)::text');
    const tooMany = await as(ids.leader).post('/api/v1/resources/equipment/reservations', {
      equipment_id: tents, date_from: tomorrow, date_to: tomorrow, reserved_quantity: 1, reserved_for: 'De trop',
    });
    expect(tooMany.status).toBe(400);
  });

  test('reopening an overdue loan whose tents were lent again since is refused', async () => {
    const tents = await item(ids.unit, 'Tente ultra-légère', 2);
    const created = await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: tents, quantity: 2, participant_id: ids.ada }],
    }).expect(201);
    const loanId = created.body.data.loans[0].id;
    await pool.query('UPDATE equipment_loans SET loaned_on = CURRENT_DATE - 10, due_date = CURRENT_DATE - 3 WHERE id = $1', [loanId]);
    await as(ids.leader).patch(`/api/v1/equipment-loans/${loanId}`, { returned_quantity: 2 }).expect(200);
    await as(ids.leader).post('/api/v1/equipment-loans', {
      loans: [{ equipment_id: tents, quantity: 2, participant_id: ids.max }],
    }).expect(201);

    await as(ids.leader).patch(`/api/v1/equipment-loans/${loanId}`, { returned_quantity: 0 }).expect(409);
  });

  test('keeping a loan out past a reservation is refused, and bringing the date back is not', async () => {
    const tarps = await item(ids.unit, 'Bâche 2 x 3 m', 2);
    const created = await as(ids.leader).post('/api/v1/equipment-loans', {
      due_date: '2099-07-01', loans: [{ equipment_id: tarps, quantity: 2, participant_id: ids.ada }],
    }).expect(201);
    await as(ids.leader).post('/api/v1/resources/equipment/reservations', {
      equipment_id: tarps, date_from: '2099-07-04', date_to: '2099-07-05', reserved_quantity: 2, reserved_for: 'Sortie juillet',
    }).expect(201);
    const loanId = created.body.data.loans[0].id;

    await as(ids.leader).patch(`/api/v1/equipment-loans/${loanId}`, { due_date: '2099-07-10' }).expect(409);
    await as(ids.leader).patch(`/api/v1/equipment-loans/${loanId}`, { due_date: null }).expect(409);
    await as(ids.leader).patch(`/api/v1/equipment-loans/${loanId}`, { due_date: '2099-06-30' }).expect(200);
  });

  test('moving a due date into the past keeps the loan out with no end, so it is checked again', async () => {
    const tarps = await item(ids.unit, 'Bâche 4 x 5 m', 2);
    const created = await as(ids.leader).post('/api/v1/equipment-loans', {
      due_date: '2099-09-01', loans: [{ equipment_id: tarps, quantity: 2, participant_id: ids.ada }],
    }).expect(201);
    const loanId = created.body.data.loans[0].id;
    await pool.query('UPDATE equipment_loans SET loaned_on = CURRENT_DATE - 10 WHERE id = $1', [loanId]);
    await as(ids.leader).post('/api/v1/resources/equipment/reservations', {
      equipment_id: tarps, date_from: '2099-09-10', date_to: '2099-09-11', reserved_quantity: 2, reserved_for: 'Sortie septembre',
    }).expect(201);
    const yesterday = await one('SELECT (CURRENT_DATE - 1)::text');

    await as(ids.leader).patch(`/api/v1/equipment-loans/${loanId}`, { due_date: yesterday }).expect(409);
  });

  test('a handout replayed from the offline outbox is recorded once', async () => {
    const body = { loans: [{ equipment_id: ids.tarps, quantity: 1, participant_id: ids.max }] };
    const first = await as(ids.leader).post('/api/v1/equipment-loans', body, 'camp-handout-1').expect(201);
    const replay = await as(ids.leader).post('/api/v1/equipment-loans', body, 'camp-handout-1').expect(201);

    expect(replay.body.data).toEqual(first.body.data);
    // The receipt names no one: only the loans it recorded.
    const receipt = await one('SELECT response_data FROM equipment_loan_receipts WHERE user_id = $1 AND mutation_key = $2',
      [ids.leader, 'camp-handout-1']);
    expect(receipt).toEqual({ loan_ids: first.body.data.loans.map((loan) => loan.id) });
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
