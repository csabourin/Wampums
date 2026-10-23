'use strict';

/**
 * Migration 043 gives the demo unit its cast, and never renames anyone an
 * ordinary unit also knows. Runs against a real database (TEST_DATABASE_URL).
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'migrations', '043_demo_saint_bivouac_cast.sql'), 'utf8');

describe.skipIf(!DATABASE_URL)('The Saint-Bivouac cast', () => {
  let pool;
  let client;
  const ids = {};

  async function one(sql, params = []) {
    const result = await client.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
  }

  async function unit(label) {
    const id = await one('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [label]);
    await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
    await client.query(`INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
      VALUES ($1, 'Cast year', CURRENT_DATE - 100, CURRENT_DATE + 200, 'active')`, [id]);
    return id;
  }

  async function child(firstName, ...units) {
    const id = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Placeholder', '2016-01-01') RETURNING id", [firstName]);
    for (const organizationId of units) {
      // eslint-disable-next-line no-await-in-loop -- one or two units
      await client.query(`INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id)
        SELECT $1, $2, id FROM scout_years WHERE organization_id = $2`, [id, organizationId]);
    }
    return id;
  }

  async function account(roleName, ...units) {
    const roleId = await one('SELECT id FROM roles WHERE role_name = $1', [roleName])
      || await one("INSERT INTO roles (role_name, display_name, data_scope, is_system_role) VALUES ($1, $1, 'organization', TRUE) RETURNING id", [roleName]);
    const id = await one("INSERT INTO users (email, password, full_name) VALUES (gen_random_uuid() || '@example.test', 'x', 'Demo Placeholder') RETURNING id");
    for (const organizationId of units) {
      // eslint-disable-next-line no-await-in-loop -- one or two units
      await client.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')",
        [id, organizationId, JSON.stringify([roleId])]);
    }
    return id;
  }

  const name = (id) => one("SELECT first_name || ' ' || last_name FROM participants WHERE id = $1", [id]);
  const fullName = (id) => one('SELECT full_name FROM users WHERE id = $1', [id]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    client = await pool.connect();
    await client.query('BEGIN');
    // Only this test's demo unit may be one while the migration runs.
    await client.query("DELETE FROM organization_settings WHERE setting_key = 'demo_sign_in'");
    ids.demo = await unit('Meute 6Z');
    ids.real = await unit('Real unit');
    await client.query("INSERT INTO organization_settings (organization_id, setting_key, setting_value) VALUES ($1, 'demo_sign_in', 'true'::jsonb)", [ids.demo]);
    ids.first = await child('Placeholder one', ids.demo);
    ids.second = await child('Placeholder two', ids.demo);
    ids.shared = await child('Léa', ids.demo, ids.real);
    ids.realChild = await child('Ada', ids.real);
    ids.demoGroup = await one("INSERT INTO groups (name, organization_id) VALUES ('Sizaine A', $1) RETURNING id", [ids.demo]);
    ids.realGroup = await one("INSERT INTO groups (name, organization_id) VALUES ('Real group', $1) RETURNING id", [ids.real]);
    ids.leader = await account('demoadmin', ids.demo);
    ids.parent = await account('demoparent', ids.demo);
    ids.realDemo = await account('demoadmin', ids.real);
    ids.guardian = await one("INSERT INTO parents_guardians (nom, prenom, user_uuid) VALUES ('Placeholder', 'Parent', $1) RETURNING id", [ids.parent]);
    await client.query('INSERT INTO participant_guardians (participant_id, guardian_id) VALUES ($1, $2)', [ids.second, ids.guardian]);
    ids.sharedGuardian = await one("INSERT INTO parents_guardians (nom, prenom) VALUES ('Lovelace', 'Ada') RETURNING id");
    await client.query('INSERT INTO participant_guardians (participant_id, guardian_id) VALUES ($1, $2), ($3, $2)', [ids.first, ids.sharedGuardian, ids.realChild]);

    await client.query(MIGRATION);
  });

  afterAll(async () => {
    await client?.query('ROLLBACK');
    client?.release();
    await pool?.end();
  });

  test('the demo youth take the cast names, in id order', async () => {
    expect(await name(ids.first)).toBe('Annie Versaire');
    expect(await name(ids.second)).toBe('Paul Ochon');
  });

  test('a child also enrolled in an ordinary unit keeps their name', async () => {
    expect(await name(ids.shared)).toBe('Léa Placeholder');
    expect(await name(ids.realChild)).toBe('Ada Placeholder');
  });

  test('the demo groups are renamed, and only them', async () => {
    expect(await one('SELECT name FROM groups WHERE id = $1', [ids.demoGroup])).toBe('Chinchillas');
    expect(await one('SELECT name FROM groups WHERE id = $1', [ids.realGroup])).toBe('Real group');
  });

  test('Akela leads, and the demo parent signs in under their guardian name', async () => {
    expect(await fullName(ids.leader)).toBe('Akela');
    const guardian = await one("SELECT prenom || ' ' || nom FROM parents_guardians WHERE id = $1", [ids.guardian]);
    expect(guardian).toBe('Rémi Ochon');
    expect(await fullName(ids.parent)).toBe('Rémi Ochon');
  });

  test('a guardian or a demo account an ordinary unit also knows is left alone', async () => {
    expect(await one("SELECT prenom || ' ' || nom FROM parents_guardians WHERE id = $1", [ids.sharedGuardian])).toBe('Ada Lovelace');
    expect(await fullName(ids.realDemo)).toBe('Demo Placeholder');
  });

  test('running it again changes nothing', async () => {
    await client.query(MIGRATION);

    expect(await name(ids.first)).toBe('Annie Versaire');
    expect(await fullName(ids.parent)).toBe('Rémi Ochon');
  });
});
