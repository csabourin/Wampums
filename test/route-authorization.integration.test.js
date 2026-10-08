'use strict';

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('./jest-conditional-helpers');
process.env.JWT_SECRET_KEY ||= 'route-authorization-integration-secret';

const { signJWTToken } = require('../utils/jwt-config');
const { grantParticipantAccess, revokeAllAccessForPair, ACCESS_SOURCE } = require('../services/participantAccess');
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const ALL_KEYS = ['participants.view', 'participants.create', 'participants.edit', 'participants.erase',
  'users.assign_roles', 'finance.view', 'finance.manage', 'forms.view', 'forms.submit', 'forms.manage',
  'medication.view', 'medication.manage', 'communications.send', 'org.edit', 'groups.view',
  'groups.create', 'groups.edit', 'groups.delete', 'alumni.manage'];
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

describe.skipIf(!DATABASE_URL)('Shared route authorization', () => {
  let pool;
  let app;
  const ids = {};
  const whatsapp = {
    isConnected: jest.fn(() => Promise.resolve(false)),
    initializeConnection: jest.fn(() => Promise.resolve()),
    disconnect: jest.fn(() => Promise.resolve()),
    getConnectionInfo: jest.fn(() => Promise.resolve({ isConnected: false })),
    sendMessage: jest.fn(() => Promise.resolve({ success: true })),
  };

  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return Object.values(result.rows[0] || {})[0];
  }

  async function unit(label) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const made = await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [label]);
      const id = made.rows[0].id;
      await client.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await client.query('COMMIT');
      await pool.query("INSERT INTO scout_years (organization_id, label, start_date, end_date, status) VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active')", [id]);
      return id;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function role(keys = [], scope = 'organization', name = `authorization_${randomUUID()}`) {
    const id = await one('INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, $2) RETURNING id', [name, scope]);
    if (keys.length) {
      await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [id, keys]);
    }
    return id;
  }

  async function member(roleId, organizationId = ids.unit) {
    const id = await one("INSERT INTO users (email, password, full_name) VALUES ($1, 'x', 'Authorization Test') RETURNING id", [`${randomUUID()}@example.test`]);
    await pool.query("INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3::jsonb, 'active')", [id, organizationId, JSON.stringify([roleId])]);
    return id;
  }

  function token(userId = ids.denied, organizationId = ids.unit) {
    // Deliberately lie in every JWT: only the database may grant these keys.
    return signJWTToken({ user_id: userId, organizationId, roleNames: ['district'], permissions: ALL_KEYS });
  }

  function call(method, path, userId = ids.denied, body = {}) {
    const route = path.replace(':child', String(ids.child)).replace(':submission', String(ids.submission));
    return request(app)[method](route).set('Authorization', `Bearer ${token(userId)}`).send({
      form_type: 'fiche_sante', participant_id: ids.child, submission_id: ids.submission,
      subject: 'Test', message: 'Test', recipient_roles: ['parent'], ...body,
    });
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit('Authorization unit A');
    ids.otherUnit = await unit('Authorization unit B');
    ids.fullRole = await role(ALL_KEYS);
    ids.emptyRole = await role();
    ids.familyRole = await role(['participants.view', 'medication.view', 'forms.view'], 'linked');
    ids.denied = await member(ids.emptyRole);
    ids.full = await member(ids.fullRole);
    ids.family = await member(ids.familyRole);
    ids.other = await member(ids.fullRole, ids.otherUnit);
    const demoRole = await one("SELECT id FROM roles WHERE role_name = 'demoadmin'") || await role([], 'organization', 'demoadmin');
    ids.demo = await member(demoRole);
    ids.child = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ('Own', 'Child', '2016-01-01') RETURNING id");
    ids.foreignChild = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ('Foreign', 'Child', '2016-01-01') RETURNING id");
    await pool.query(`INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id)
      SELECT $1, $2, id FROM scout_years WHERE organization_id = $2 AND status = 'active'`, [ids.child, ids.unit]);
    await pool.query(`INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id)
      SELECT $1, $2, id FROM scout_years WHERE organization_id = $2 AND status = 'active'`, [ids.foreignChild, ids.otherUnit]);
    await grantParticipantAccess(pool, { participantId: ids.child, userId: ids.family, sourceType: ACCESS_SOURCE.DIRECT });
    ids.guardian = await one("INSERT INTO parents_guardians (nom, prenom, courriel, user_uuid) VALUES ('Test', 'Guardian', $1, $2) RETURNING id", [`${randomUUID()}@example.test`, ids.family]);
    await pool.query('INSERT INTO participant_guardians (participant_id, guardian_id) VALUES ($1, $2)', [ids.child, ids.guardian]);
    await pool.query('INSERT INTO guardian_users (guardian_id, user_id) VALUES ($1, $2)', [ids.guardian, ids.family]);
    ids.submission = await one("INSERT INTO form_submissions (participant_id, organization_id, form_type, submission_data, user_id, status) VALUES ($1, $2, 'fiche_sante', '{}', $3, 'submitted') RETURNING id", [ids.child, ids.unit, ids.family]);
    await pool.query("INSERT INTO medication_requirements (organization_id, participant_id, medication_name) VALUES ($1, $3, 'Unit A medicine'), ($2, $4, 'Unit B medicine')", [ids.unit, ids.otherUnit, ids.child, ids.foreignChild]);

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/forms', require('../routes/forms')(pool, logger));
    app.use('/api', require('../routes/medication')(pool, logger));
    app.use('/api', require('../routes/external-revenue')(pool, logger));
    app.use('/api', require('../routes/announcements')(pool, logger));
    app.use('/api', require('../routes/whatsapp-baileys')(pool, logger, whatsapp));
    app.use('/api/v1/participants', require('../routes/participants')(pool));
    app.use('/api/v1/notifications', require('../routes/notifications')(pool, logger));
    app.use('/api/v1/dashboards', require('../routes/dashboards')(pool, logger));
    app.use('/api/v1/import', require('../routes/import')(pool, logger));
    app.use('/api/v1/groups', require('../routes/groups')(pool));
  });

  afterAll(async () => { if (pool) {await pool.end();} });

  const protectedRoutes = [
    ['get', '/api/v1/medication/requirements'], ['post', '/api/v1/medication/requirements'],
    ['put', '/api/v1/medication/requirements/1'], ['get', '/api/v1/medication/fiche-medications'],
    ['get', '/api/v1/medication/participant-medications'], ['get', '/api/v1/medication/distributions'],
    ['post', '/api/v1/medication/distributions'], ['patch', '/api/v1/medication/distributions/1'],
    ['get', '/api/v1/medication/receptions'], ['post', '/api/v1/medication/receptions'],
    ['patch', '/api/v1/medication/receptions/1'], ['delete', '/api/v1/medication/receptions/1'],
    ['get', '/api/v1/medication/first-aid-supplies'], ['get', '/api/v1/medication/authorizations/:child'],
    ['post', '/api/v1/medication/authorizations/treatment'], ['post', '/api/v1/medication/authorizations/administration'],
    ['get', '/api/v1/revenue/external'], ['post', '/api/v1/revenue/external'],
    ['put', '/api/v1/revenue/external/1'], ['delete', '/api/v1/revenue/external/1'],
    ['get', '/api/v1/revenue/external/summary'], ['post', '/api/v1/participants/save'],
    ['patch', '/api/v1/participants/:child/group-membership'], ['post', '/api/v1/participants/group-membership'],
    ['post', '/api/v1/participants/link-users'], ['delete', '/api/v1/participants/:child/erasure'],
    ['get', '/api/v1/notifications/subscribers'], ['post', '/api/v1/notifications/send'],
    ['get', '/api/v1/announcements'], ['post', '/api/v1/announcements'],
    ['get', '/api/v1/dashboards/parent'], ['post', '/api/v1/whatsapp/baileys/connect'],
    ['post', '/api/v1/whatsapp/baileys/disconnect'], ['post', '/api/v1/whatsapp/baileys/test'],
    ['post', '/api/v1/import/sisc'], ['get', '/api/v1/groups'],
    ['post', '/api/v1/groups'], ['put', '/api/v1/groups/1'], ['delete', '/api/v1/groups/1'],
    ['get', '/api/v1/forms/submissions?form_type=fiche_sante'], ['post', '/api/v1/forms/submissions'],
    ['delete', '/api/v1/forms/submissions?form_type=fiche_sante'],
    ['get', '/api/v1/forms/submissions/list?form_type=fiche_sante'],
    ['post', '/api/v1/forms/submissions/:submission/confirm-review'],
    ['get', '/api/v1/forms/form-submission-history/:submission'], ['put', '/api/v1/forms/form-submission-status'],
    ['get', '/api/v1/forms/form-permissions'], ['put', '/api/v1/forms/form-permissions'],
    ['put', '/api/v1/forms/form-display-context'], ['get', '/api/v1/forms/form-versions/fiche_sante'],
    ['get', '/api/v1/forms/structure/fiche_sante'],
  ];

  test.each(protectedRoutes)('%s %s ignores forged JWT permissions and returns a standard 403', async (method, path) => {
    const response = await call(method, path);
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(Array.isArray(response.body.required)).toBe(true);
    expect(Array.isArray(response.body.missing)).toBe(true);
  });

  test.each(protectedRoutes)('%s %s requires authentication before processing the payload', async (method, path) => {
    const response = await request(app)[method](path.replace(':child', String(ids.child)).replace(':submission', String(ids.submission))).send({});
    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/authentication required/i);
  });

  test.each([...protectedRoutes.filter(([method]) => method !== 'get'), ['post', '/api/v1/notifications/subscription']])(
    '%s %s blocks demo writes before validation or business work', async (method, path) => {
      const response = await call(method, path, ids.demo);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ isDemo: true, required: [], missing: [] });
    }
  );

  test('custom role permissions work without relying on a built-in role name', async () => {
    const response = await call('get', '/api/v1/medication/requirements', ids.full);
    expect(response.status).toBe(200);
    expect(response.body.data.requirements.map((row) => row.medication_name)).toEqual(['Unit A medicine']);
  });

  test('revoking a permission takes effect on the next request even with the same JWT', async () => {
    const roleId = await role(['communications.send']);
    const userId = await member(roleId);
    const signed = token(userId);
    expect((await request(app).get('/api/v1/announcements').set('Authorization', `Bearer ${signed}`)).status).toBe(200);
    await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    const denied = await request(app).get('/api/v1/announcements').set('Authorization', `Bearer ${signed}`);
    expect(denied.status).toBe(403);
    expect(denied.body.missing).toEqual(['communications.send']);
  });

  test('a token from another unit cannot select this unit through a header or body', async () => {
    const response = await request(app).get('/api/v1/medication/requirements')
      .set('Authorization', `Bearer ${token(ids.other, ids.otherUnit)}`)
      .set('x-organization-id', String(ids.unit)).query({ organization_id: ids.unit });
    expect(response.status).toBe(200);
    expect(response.body.data.requirements.map((row) => row.medication_name)).toEqual(['Unit B medicine']);
    const foreign = await call('get', `/api/v1/medication/authorizations/${ids.foreignChild}`, ids.full);
    expect(foreign.status).toBe(403);
  });

  test('linked medication permissions cannot expose another child’s authorizations', async () => {
    expect((await call('get', '/api/v1/medication/authorizations/:child', ids.family)).status).toBe(200);
    const unlinked = await member(ids.familyRole);
    expect((await call('get', '/api/v1/medication/authorizations/:child', unlinked)).status).toBe(403);
  });

  test('a family reads the medications of its own child, and only that child', async () => {
    const sibling = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ('Unlinked', 'Child', '2016-01-01') RETURNING id");
    await pool.query(`INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id)
      SELECT $1, $2, id FROM scout_years WHERE organization_id = $2 AND status = 'active'`, [sibling, ids.unit]);
    await pool.query("INSERT INTO medication_requirements (organization_id, participant_id, medication_name) VALUES ($1, $2, 'Sibling medicine')", [ids.unit, sibling]);
    // A parent role without any medication key still reads its own child.
    const parentRole = await role(['participants.view'], 'linked');
    const parent = await member(parentRole);
    await grantParticipantAccess(pool, { participantId: ids.child, userId: parent, sourceType: ACCESS_SOURCE.DIRECT });

    const unitWide = ['/api/v1/medication/requirements', '/api/v1/medication/participant-medications',
      '/api/v1/medication/receptions', '/api/v1/medication/fiche-declarations', '/api/v1/medication/fiche-medications'];
    const ownChild = ['/api/v1/medication/participant-medications', '/api/v1/medication/receptions',
      '/api/v1/medication/fiche-declarations', '/api/v1/medication/first-aid-supplies'];
    const checks = [ids.family, parent].flatMap((userId) => [
      call('get', `/api/v1/medication/requirements?participant_id=${ids.child}`, userId).then((own) => {
        expect(own.status).toBe(200);
        expect(own.body.data.requirements.map((row) => row.medication_name)).toEqual(['Unit A medicine']);
      }),
      ...unitWide.flatMap((path) => [path, `${path}?participant_id=${sibling}`]).map((path) =>
        call('get', path, userId).then((response) => expect([path, response.status]).toEqual([path, 403]))),
      ...ownChild.map((path) => `${path}?participant_id=${ids.child}`).map((path) =>
        call('get', path, userId).then((response) => expect([path, response.status]).toEqual([path, 200]))),
    ]);
    await Promise.all(checks);

    const staff = await call('get', '/api/v1/medication/requirements', ids.full);
    expect(staff.body.data.requirements.map((row) => row.medication_name).sort())
      .toEqual(['Sibling medicine', 'Unit A medicine']);
    const foreign = await call('get', `/api/v1/medication/requirements?participant_id=${ids.foreignChild}`, ids.full);
    expect(foreign.status).toBe(403);
  });

  test('read-only medication access cannot schedule a distribution', async () => {
    expect((await call('post', '/api/v1/medication/distributions', ids.family)).status).toBe(403);
  });

  test('a family can sign only for its own named guardian', async () => {
    const own = await call('post', '/api/v1/medication/authorizations/treatment', ids.family, { guardian_id: ids.guardian });
    expect(own.status).toBe(201);
    const denied = await call('post', '/api/v1/medication/authorizations/treatment', ids.denied, { guardian_id: ids.guardian });
    expect(denied.status).toBe(403);
  });

  test('alumni mail requires its additional permission before creating a message', async () => {
    const roleId = await role(['communications.send']);
    const sender = await member(roleId);
    const response = await call('post', '/api/v1/announcements', sender, { audience: 'alumni' });
    expect(response.status).toBe(403);
    expect(response.body.missing).toEqual(['alumni.manage']);
    expect(await one('SELECT count(*)::int FROM announcements WHERE organization_id = $1', [ids.unit])).toBe(0);
  });

  test('linking another account requires the extra key while self-linking does not', async () => {
    const roleId = await role(['participants.edit']);
    const editor = await member(roleId);
    const denied = await call('post', '/api/v1/participants/link-users', editor, { user_id: ids.family, participant_ids: [ids.child] });
    expect(denied.status).toBe(403);
    expect(denied.body.missing).toEqual(['users.assign_roles']);
    expect((await call('post', '/api/v1/participants/link-users', editor, { participant_ids: [ids.child] })).status).toBe(200);
  });

  test('inactive membership denials include the standard authorization fields', async () => {
    const inactive = await member(ids.fullRole);
    await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE user_id = $1 AND organization_id = $2", [inactive, ids.unit]);
    const response = await call('get', '/api/v1/notifications/subscribers', inactive);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ required: [], missing: [], membershipStatus: 'inactive_or_missing' });
  });

  test('revoked child access cannot survive through a retained guardian contact', async () => {
    const signer = await member(ids.familyRole);
    const guardian = await one("INSERT INTO parents_guardians (nom, prenom, courriel, user_uuid) VALUES ('Test', 'Revoked', $1, $2) RETURNING id", [`${randomUUID()}@example.test`, signer]);
    await pool.query('INSERT INTO participant_guardians (participant_id, guardian_id) VALUES ($1, $2)', [ids.child, guardian]);
    await grantParticipantAccess(pool, { participantId: ids.child, userId: signer, sourceType: ACCESS_SOURCE.GUARDIAN, sourceId: guardian });
    expect((await call('get', '/api/v1/medication/authorizations/:child', signer)).status).toBe(200);
    await revokeAllAccessForPair(pool, { participantId: ids.child, userId: signer });
    expect((await call('get', '/api/v1/medication/authorizations/:child', signer)).status).toBe(403);
    expect((await call('post', '/api/v1/medication/authorizations/treatment', signer, { guardian_id: guardian })).status).toBe(403);
  });
});
