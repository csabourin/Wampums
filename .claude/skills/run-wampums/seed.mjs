#!/usr/bin/env node
/**
 * Seed a disposable database with one unit you can sign in to.
 *
 *   admin@run.test   -- holds every permission in the unit
 *   leader@run.test  -- leader: participants, attendance, points, walk-ins
 *   parent@run.test  -- parent role (its real permissions), guardian of one
 *                       child (Léa) enrolled this year; standard forms installed
 *   demo.leader@run.test / demo.parent@run.test -- the demo unit's read-only
 *                       accounts (demoadmin, demoparent); the parent sees Léa
 *
 * The unit also receives the default starter activities a new unit gets
 * (services/activityLibraryStarter.js).
 *
 * All of them use the password printed at the end. Two-factor sign-in is switched off
 * for this unit only, through the unit's own `security` setting, so the login
 * form lands straight on the dashboard instead of waiting for an emailed code.
 *
 * Writes $WAMPUMS_RUN_CACHE/seed.json, which start.sh reads for the unit id.
 *
 * Usage (from the repo root): node .claude/skills/run-wampums/seed.mjs
 */

import { randomUUID } from 'node:crypto';
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

  const materialGroupId = await one("INSERT INTO local_groups (name, slug) VALUES ('Groupe scout fictif', 'run-material-group') RETURNING id");
  await pool.query('INSERT INTO organization_local_groups (organization_id, local_group_id) VALUES ($1, $2)', [organizationId, materialGroupId]);

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
  const leaderRole = await one(
    `INSERT INTO roles (role_name, display_name, data_scope) VALUES ('run_leader', 'Run Leader', 'organization')
     ON CONFLICT (role_name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`
  );
  // What a leader holds: no users.invite, so the walk-in screen is their only
  // way to invite a parent.
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions
      WHERE permission_key IN ('participants.view', 'participants.create', 'participants.edit', 'participants.walk_in',
                               'attendance.view', 'attendance.manage', 'points.view', 'points.manage', 'activities.view',
                               'groups.view', 'badges.view', 'badges.manage', 'meetings.view')
     ON CONFLICT DO NOTHING`,
    [leaderRole]
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
  // Exactly the parent bundle in config/roles.js (and the migrations), so a
  // save that would be refused to a real parent is refused here too.
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions
      WHERE permission_key IN ('participants.view', 'participants.create_own', 'permission_slips.sign',
                               'activities.view', 'carpools.view')
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
  const adminId = await member('admin@run.test', 'Akela Admin', adminRole);
  await member('leader@run.test', 'Baloo Leader', leaderRole);
  const parentId = await member('parent@run.test', 'Marie Parent', parentRole);

  // The demo unit's two read-only accounts (demoadmin, demoparent), signed in
  // with a password here: blockDemoRoles refuses their writes, as on demo.wampums.app.
  const demoLeaderRole = await one(
    `INSERT INTO roles (role_name, display_name, data_scope, is_system_role) VALUES ('demoadmin', 'Demo Admin', 'organization', TRUE)
     ON CONFLICT (role_name) DO UPDATE SET data_scope = 'organization' RETURNING id`
  );
  const demoParentRole = await one(
    `INSERT INTO roles (role_name, display_name, data_scope, is_system_role) VALUES ('demoparent', 'Demo Parent', 'linked', TRUE)
     ON CONFLICT (role_name) DO UPDATE SET data_scope = 'linked' RETURNING id`
  );
  await pool.query(
    'INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions ON CONFLICT DO NOTHING',
    [demoLeaderRole]
  );
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions
      WHERE permission_key IN ('participants.view', 'participants.create_own', 'permission_slips.sign',
                               'activities.view', 'carpools.view')
     ON CONFLICT DO NOTHING`,
    [demoParentRole]
  );
  await member('demo.leader@run.test', 'Demo Leader', demoLeaderRole);
  const demoParentId = await member('demo.parent@run.test', 'Demo Parent', demoParentRole);

  const guardianId = await one(
    `INSERT INTO parents_guardians (nom, prenom, courriel, user_uuid) VALUES ('Parent', 'Marie', 'parent@run.test', $1)
     ON CONFLICT (courriel) DO UPDATE SET user_uuid = EXCLUDED.user_uuid RETURNING id`,
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
  await grantParticipantAccess(pool, { participantId: childId, userId: demoParentId, sourceType: ACCESS_SOURCE.DIRECT });
  // Marie is Léa's guardian: medication authorizations are signed by a named guardian.
  await pool.query(
    'INSERT INTO participant_guardians (participant_id, guardian_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [childId, guardianId]
  );

  // An outing a month away, with a slip waiting for Marie's signature, so the
  // activity, carpool and permission-slip screens have something to show.
  const outingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const activityId = await one(
    `INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
                             meeting_time_going, departure_time_going, activity_start_date, activity_start_time,
                             activity_end_date, activity_end_time)
     VALUES ($1, $2, 'Sortie canot', $3, 'Local scout', '08:30', '09:00', $3, '09:00', $3, '16:00')
     RETURNING id`,
    [organizationId, adminId, outingDate]
  );
  await pool.query(
    `INSERT INTO permission_slips (organization_id, participant_id, guardian_id, meeting_date, activity_id, activity_title)
     VALUES ($1, $2, $3, $4, $5, 'Sortie canot')`,
    [organizationId, childId, guardianId, outingDate, activityId]
  );

  // Tomorrow's meeting, with a timed programme, for the leaders' "now / next"
  // bar: a browser check sets the page clock inside it. Tomorrow, so the bar
  // never shows in checks that run on the real clock today.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const programmeDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const meetingId = await one(
    `INSERT INTO year_plan_meetings (organization_id, meeting_date, meeting_kind, theme)
     VALUES ($1, $2, 'regular', 'La jungle') RETURNING id`,
    [organizationId, programmeDate]
  );
  await pool.query(
    `INSERT INTO year_plan_meeting_activities
       (organization_id, meeting_id, name, start_time, duration_minutes, responsable, material, sort_order)
     VALUES ($1, $2, 'Accueil et grand hurlement', '18:45', 15, 'Bagheera', NULL, 1),
            ($1, $2, 'Jeu de la tanière', '19:00', 25, 'Baloo', 'Foulards, 4 cônes', 2),
            ($1, $2, 'Histoire de la jungle', '19:25', 20, 'Akela', 'Livre', 3)`,
    [organizationId, meetingId]
  );

  // The standard forms (health, risk acceptance, registration...) with the
  // per-role rights a new unit receives, so the parent dashboard lists them.
  const { installDefaultFormFormats } = require(path.join(ROOT, 'services/defaultFormFormats.js'));
  const formsClient = await pool.connect();
  try {
    await installDefaultFormFormats(formsClient, organizationId);
  } finally {
    formsClient.release();
  }

  // The starter activities a new unit receives, through the same service as
  // unit creation, so the planner and meeting preparation have a repertoire.
  const { installDefaultStarterActivities } = require(path.join(ROOT, 'services/activityLibraryStarter.js'));
  const starterClient = await pool.connect();
  try {
    await starterClient.query('BEGIN');
    await installDefaultStarterActivities(starterClient, organizationId, adminId);
    await starterClient.query('COMMIT');
  } catch (error) {
    await starterClient.query('ROLLBACK');
    throw error;
  } finally {
    starterClient.release();
  }

  // One of each record a detail screen opens, so the browser checks see each
  // screen with content rather than its "not found" state.
  const fundraiserId = await one(
    `INSERT INTO fundraisers (name, start_date, end_date, organization, campaign_type, unit_price, unit_label)
     VALUES ('Vente de calendriers', '2026-11-01', '2026-12-15', $1, 'fixed_price_sale', 15, 'calendrier')
     RETURNING id`,
    [organizationId]
  );
  const yearPlanId = await one(
    `INSERT INTO year_plans (organization_id, title, start_date, end_date, created_by)
     VALUES ($1, 'Année 2026-2027', '2026-09-01', '2027-06-30', $2) RETURNING id`,
    [organizationId, adminId]
  );
  const messageId = await one(
    `INSERT INTO user_messages (organization_id, user_id, title, body)
     VALUES ($1, $2, 'Sortie canot', 'Apportez un lunch et des vêtements de rechange.') RETURNING id`,
    [organizationId, parentId]
  );
  const incidentId = await one(
    `INSERT INTO incident_reports (organization_id, status, victim_type, victim_participant_id, victim_name,
                                   activity_id, incident_date, incident_location, created_by)
     VALUES ($1, 'draft', 'participant', $2, 'Léa Parent', $3, $4, 'Local scout', $5) RETURNING id`,
    [organizationId, childId, activityId, programmeDate, adminId]
  );
  // A weekend camp that ended yesterday, with tents and tarps reserved for it
  // and one tarp still drying at Léa's, now overdue, for the equipment loans
  // screen: what is left to hand out, and what has not come back.
  const campId = await one(
    `INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
                             meeting_time_going, departure_time_going, activity_start_date, activity_start_time,
                             activity_end_date, activity_end_time)
     VALUES ($1, $2, 'Camp d''automne', CURRENT_DATE - 3, 'Local scout', '17:30', '18:00',
             CURRENT_DATE - 3, '18:00', CURRENT_DATE - 1, '15:00')
     RETURNING id`,
    [organizationId, adminId]
  );
  const tentsId = await one(
    `INSERT INTO equipment_items (organization_id, name, category, quantity_total, quantity_available)
     VALUES ($1, 'Tente 4 places', 'camping', 6, 6) RETURNING id`,
    [organizationId]
  );
  const tarpsId = await one(
    `INSERT INTO equipment_items (organization_id, name, category, quantity_total, quantity_available)
     VALUES ($1, 'Bâche 3 x 4 m', 'camping', 4, 4) RETURNING id`,
    [organizationId]
  );
  await pool.query(
    `INSERT INTO equipment_reservations (organization_id, equipment_id, activity_id, meeting_date, date_from, date_to,
                                         reserved_quantity, reserved_for, status, created_by)
     VALUES ($1, $2, $4, CURRENT_DATE - 3, CURRENT_DATE - 3, CURRENT_DATE - 1, 5, 'Camp d''automne', 'confirmed', $5),
            ($1, $3, $4, CURRENT_DATE - 3, CURRENT_DATE - 3, CURRENT_DATE - 1, 3, 'Camp d''automne', 'confirmed', $5)`,
    [organizationId, tentsId, tarpsId, campId, adminId]
  );
  await pool.query(
    `INSERT INTO equipment_loans (organization_id, equipment_id, activity_id, holder_participant_id, quantity,
                                  reason, loaned_on, due_date, created_by)
     VALUES ($1, $2, $3, $4, 1, 'drying', CURRENT_DATE - 2, CURRENT_DATE - 1, $5)`,
    [organizationId, tarpsId, campId, childId, adminId]
  );

  const slipToken = await one(
    'SELECT access_token AS id FROM permission_slips WHERE organization_id = $1 AND activity_id = $2',
    [organizationId, activityId]
  );

  const { createCatalogItem } = require(path.join(ROOT, 'services/equipmentCatalog.js'));
  const tentArticle = await createCatalogItem(pool, organizationId, adminId, {
    name: 'Tente 4 places', category: 'camping', unit_of_measure: 'each', equipment_item_id: tentsId,
  });

  // The weekend camp in the planner, with articles on two activities and
  // free-text material, for the camp material list: the tents add up across
  // activities and are compared with the reservations above.
  const campMeetingId = await one(
    `INSERT INTO year_plan_meetings (organization_id, meeting_date, meeting_kind, theme, activity_id)
     VALUES ($1, CURRENT_DATE - 3, 'camp', 'Camp d''automne', $2) RETURNING id`,
    [organizationId, campId]
  );
  const setupLineId = await one(
    `INSERT INTO year_plan_meeting_activities (organization_id, meeting_id, name, start_time, day_offset, material, sort_order)
     VALUES ($1, $2, 'Montage du camp', '18:30', 0, 'Maillets, piquets de rechange', 1) RETURNING id`,
    [organizationId, campMeetingId]
  );
  const nightLineId = await one(
    `INSERT INTO year_plan_meeting_activities (organization_id, meeting_id, name, start_time, day_offset, sort_order)
     VALUES ($1, $2, 'Nuit en forêt', '20:00', 1, 1) RETURNING id`,
    [organizationId, campMeetingId]
  );
  await pool.query(
    `INSERT INTO meeting_activity_equipment (organization_id, meeting_activity_id, catalog_item_id, equipment_item_id, quantity)
     VALUES ($1, $2, $4, NULL, 4), ($1, $3, $4, NULL, 2), ($1, $3, NULL, $5, 2)`,
    [organizationId, setupLineId, nightLineId, tentArticle.id, tarpsId]
  );

  const { saveLot } = require(path.join(ROOT, 'services/campEquipmentLots.js'));
  const campLot = await saveLot(pool, organizationId, adminId, campMeetingId, {
    name: 'Tentes du camp', creation_key: randomUUID(), items: [{ catalog_item_id: tentArticle.id, quantity: 2 }],
    roles: [{ role: 'prepare', user_id: adminId }],
  });

  const { saveTask } = require(path.join(ROOT, 'services/activityTasks.js'));
  await saveTask(pool, organizationId, adminId, {
    title: 'Vérifier les pagaies', assignee_id: adminId, due_date: programmeDate,
    activity_id: activityId, meeting_id: null,
  });

  const seed = {
    organizationId,
    database: `postgresql:///${DB}?host=/var/run/postgresql`,
    accounts: { admin: 'admin@run.test', leader: 'leader@run.test', parent: 'parent@run.test', demoLeader: 'demo.leader@run.test', demoParent: 'demo.parent@run.test' },
    activityId,
    participantId: childId,
    programmeDate,
    fundraiserId,
    yearPlanId,
    campMeetingId,
    campLotId: campLot.id,
    campLotArticleId: tentArticle.id,
    adminId,
    messageId,
    incidentId,
    slipToken,
    password: PASSWORD,
  };
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path.join(CACHE, 'seed.json'), JSON.stringify(seed, null, 2));
  console.log(JSON.stringify(seed, null, 2));
} finally {
  await pool.end();
}
