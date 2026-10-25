'use strict';

/**
 * What the assistant is shown for an equipment suggestion, against
 * PostgreSQL: only the unit's own equipment, with what is free for the dates,
 * and nothing about youths. The AI call itself is simulated.
 */

const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');

jest.mock('../services/aiText', () => ({ generateText: jest.fn() }));
const { generateText } = require('../services/aiText');
const { suggestEquipment } = require('../services/equipmentSuggestions');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Equipment suggestions', () => {
  let pool;
  const ids = {};

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
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
    return id;
  }

  const item = (unitId, name, category, quantity) => one(
    `INSERT INTO equipment_items (organization_id, name, category, quantity_total, attributes)
     VALUES ($1, $2, $3, $4, '{"share_with_local_group": false}'::jsonb) RETURNING id`,
    [unitId, name, category, quantity]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit(`Suggestions ${randomUUID()}`);
    ids.otherUnit = await unit(`Other ${randomUUID()}`);
    ids.tents = await item(ids.unit, 'Tente 4 places', 'camping', 6);
    ids.stoves = await item(ids.unit, 'Réchaud', 'kitchen', 2);
    ids.foreign = await item(ids.otherUnit, 'Canot', 'water', 4);
    await pool.query(`INSERT INTO equipment_reservations (organization_id, equipment_id, meeting_date, date_from, date_to,
        reserved_quantity, reserved_for, status)
      VALUES ($1, $2, '2099-01-10', '2099-01-10', '2099-01-12', 2, 'Autre sortie', 'reserved'),
             ($1, $3, '2099-01-10', '2099-01-10', '2099-01-12', 4, 'Autre sortie', 'reserved')`,
    [ids.unit, ids.stoves, ids.tents]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(() => generateText.mockReset());

  const ask = () => suggestEquipment(pool, {
    organizationId: ids.unit, userId: randomUUID(), description: 'Camp d\'hiver', dateFrom: '2099-01-10', dateTo: '2099-01-12', locale: 'fr',
  });

  test('the assistant sees the unit\'s free equipment only, never another unit\'s', async () => {
    generateText.mockResolvedValue({ data: { items: [] }, usage: {} });
    await ask();

    const [mode, payload] = generateText.mock.calls[0];
    expect(mode).toBe('equipment_suggest');
    expect(payload.equipment).toEqual([
      { id: ids.tents, name: 'Tente 4 places', category: 'camping', available: 2 },
    ]);
    expect(JSON.stringify(payload)).not.toContain('Canot');
    expect(payload).toMatchObject({ activity: 'Camp d\'hiver', locale: 'fr', dates: { from: '2099-01-10', to: '2099-01-12' } });
  });

  test('a suggestion naming equipment it was not shown, or too many, is corrected', async () => {
    generateText.mockResolvedValue({
      data: { items: [{ id: ids.tents, quantity: 5, reason: 'Pour dormir' }, { id: ids.foreign, quantity: 1 }, { id: ids.stoves, quantity: 1 }] },
      usage: {},
    });
    const result = await ask();
    expect(result.items).toEqual([{ equipment_id: ids.tents, quantity: 2, reason: 'Pour dormir' }]);
  });

  test('with nothing free, no call is made and nothing is spent', async () => {
    await pool.query(`INSERT INTO equipment_reservations (organization_id, equipment_id, meeting_date, date_from, date_to,
        reserved_quantity, reserved_for, status)
      VALUES ($1, $2, '2099-01-10', '2099-01-10', '2099-01-12', 2, 'Encore une', 'reserved')`, [ids.unit, ids.tents]);
    const result = await ask();
    expect(result.items).toEqual([]);
    expect(generateText).not.toHaveBeenCalled();
  });
});
