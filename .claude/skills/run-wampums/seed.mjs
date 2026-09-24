#!/usr/bin/env node
/**
 * Seed a disposable database with one unit you can sign in to.
 *
 *   admin@run.test   -- holds every permission in the unit
 *   parent@run.test  -- parent role, one child (Léa) enrolled this year
 *
 * Both use the password printed at the end. Two-factor sign-in is switched off
 * for this unit only, through the unit's own `security` setting, so the login
 * form lands straight on the dashboard instead of waiting for an emailed code.
 *
 * Writes $WAMPUMS_RUN_CACHE/seed.json, which start.sh reads for the unit id.
 *
 * Usage (from the repo root): node .claude/skills/run-wampums/seed.mjs
 */

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, 'package.json'));
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const CACHE = process.env.WAMPUMS_RUN_CACHE || path.join(homedir(), '.cache', 'wampums-run');
const DB = process.env.WAMPUMS_RUN_DB || 'wampums_run';
const PASSWORD = 'Wampums2026!';

const pool = new Pool({ connectionString: `postgresql:///${DB}?host=/var/run/postgresql` });
const one = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
};

try {
  // organizations and organization_program_sections reference each other; the
  // check is deferred to COMMIT, so both rows go in one transaction.
  const client = await pool.connect();
  let organizationId;
  try {
    await client.query('BEGIN');
    organizationId = (await client.query(
      "INSERT INTO organizations (name, default_language) VALUES ('6A Run Unit', 'fr') RETURNING id"
    )).rows[0].id;
    await client.query(
      "INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')",
      [organizationId]
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  const yearId = await one(
    `INSERT INTO scout_years (organization_id, label, start_date, end_date, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', 'active') RETURNING id`,
    [organizationId]
  );
  await pool.query(
    `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
     VALUES ($1, 'security', '{"two_factor_disabled": true}')`,
    [organizationId]
  );

  const adminRole = await one(
    `INSERT INTO roles (role_name, display_name, data_scope) VALUES ('run_admin', 'Run Admin', 'organization')
     ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
  );
  // 'linked' is what keeps a parent to their own children; the column defaults
  // to 'organization', which would show every child in the unit.
  const parentRole = await one(
    `INSERT INTO roles (role_name, display_name, data_scope) VALUES ('parent', 'Parent', 'linked')
     ON CONFLICT (role_name) DO UPDATE SET data_scope = 'linked' RETURNING id`
  );
  await pool.query(
    'INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions ON CONFLICT DO NOTHING',
    [adminRole]
  );
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions
      WHERE permission_key IN ('participants.view', 'participants.create', 'participants.create_own')
     ON CONFLICT DO NOTHING`,
    [parentRole]
  );

  const hash = await bcrypt.hash(PASSWORD, 10);
  const member = async (email, name, roleId) => {
    const userId = await one(
      `INSERT INTO users (email, password, full_name, is_verified) VALUES ($1, $2, $3, true)
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password RETURNING id`,
      [email, hash, name]
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3, 'active')
       ON CONFLICT (user_id, organization_id) DO UPDATE SET role_ids = EXCLUDED.role_ids, status = 'active'`,
      [userId, organizationId, JSON.stringify([roleId])]
    );
    return userId;
  };
  await member('admin@run.test', 'Akela Admin', adminRole);
  const parentId = await member('parent@run.test', 'Marie Parent', parentRole);

  await pool.query(
    `INSERT INTO parents_guardians (nom, prenom, courriel, user_uuid) VALUES ('Parent', 'Marie', 'parent@run.test', $1)
     ON CONFLICT (courriel) DO UPDATE SET user_uuid = EXCLUDED.user_uuid`,
    [parentId]
  );
  const childId = await one(
    "INSERT INTO participants (first_name, last_name, date_naissance) VALUES ('Léa', 'Parent', '2016-05-01') RETURNING id"
  );
  await pool.query(
    'INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id) VALUES ($1, $2, $3)',
    [childId, organizationId, yearId]
  );
  // Through the access service, as every link between an account and a child must be.
  const { grantParticipantAccess, ACCESS_SOURCE } = require(path.join(ROOT, 'services/participantAccess.js'));
  await grantParticipantAccess(pool, { participantId: childId, userId: parentId, sourceType: ACCESS_SOURCE.DIRECT });

  const seed = {
    organizationId,
    database: `postgresql:///${DB}?host=/var/run/postgresql`,
    accounts: { admin: 'admin@run.test', parent: 'parent@run.test' },
    password: PASSWORD,
  };
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path.join(CACHE, 'seed.json'), JSON.stringify(seed, null, 2));
  console.log(JSON.stringify(seed, null, 2));
} finally {
  await pool.end();
}
