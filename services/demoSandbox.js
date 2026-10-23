'use strict';

/**
 * The demo unit's night reset.
 *
 * Visitors to the demo unit may award points, take attendance and award
 * honors (`middleware/demoSandbox.js`). Those three tables are the whole of
 * what they can change, so a baseline of them, taken once while the unit is
 * as it should look, is enough to put it back: `restoreBaseline` deletes the
 * unit's rows and inserts the baseline's again, with their original ids.
 *
 * Only a unit whose `demo_sign_in` setting is on is ever captured or restored.
 *
 * @module services/demoSandbox
 */

/** Serializes resets and captures, so two cron runs cannot interleave. */
const RESET_LOCK_KEY = 'wampums_demo_sandbox_reset';

/**
 * @param {Object} client - Database client
 * @returns {Promise<number[]>} Ids of the units open as the public demo
 */
async function listDemoUnits(client) {
  const result = await client.query(
    `SELECT organization_id
       FROM organization_settings
      WHERE setting_key = 'demo_sign_in'
        AND setting_value IN ('true'::jsonb, '"true"'::jsonb)
      ORDER BY organization_id`
  );
  return result.rows.map((row) => row.organization_id);
}

/**
 * @param {Object} client - Database client
 * @param {number} organizationId - Unit to check
 * @returns {Promise<boolean>} Whether the unit is open as the public demo
 */
async function isDemoUnit(client, organizationId) {
  return (await listDemoUnits(client)).includes(organizationId);
}

/**
 * Record the unit's points, attendance and honors as the state to return to.
 *
 * @param {Object} client - Database client, inside a transaction
 * @param {number} organizationId - Demo unit
 * @param {Object} [options]
 * @param {boolean} [options.replace=false] - Overwrite an existing baseline
 * @returns {Promise<boolean>} True when a baseline was written
 */
async function captureBaseline(client, organizationId, { replace = false } = {}) {
  if (!await isDemoUnit(client, organizationId)) {
    throw new Error(`Unit ${organizationId} is not the demo unit; refusing to capture it`);
  }
  const result = await client.query(
    `INSERT INTO demo_sandbox_baselines (organization_id, points, attendance, honors, captured_at)
     SELECT $1,
            COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM points t WHERE t.organization_id = $1), '[]'::jsonb),
            COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM attendance t WHERE t.organization_id = $1), '[]'::jsonb),
            COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM honors t WHERE t.organization_id = $1), '[]'::jsonb),
            NOW()
     ON CONFLICT (organization_id) DO UPDATE
        SET points = EXCLUDED.points,
            attendance = EXCLUDED.attendance,
            honors = EXCLUDED.honors,
            captured_at = EXCLUDED.captured_at
      WHERE $2::boolean
     RETURNING organization_id`,
    [organizationId, replace]
  );
  return result.rowCount > 0;
}

/**
 * Put the unit's points, attendance and honors back to the baseline.
 *
 * Rows whose child (or group) has since left the database are skipped rather
 * than failing the whole reset.
 *
 * @param {Object} client - Database client, inside a transaction
 * @param {number} organizationId - Demo unit
 * @returns {Promise<Object|null>} Rows restored per table, or null without a baseline
 */
async function restoreBaseline(client, organizationId) {
  if (!await isDemoUnit(client, organizationId)) {
    throw new Error(`Unit ${organizationId} is not the demo unit; refusing to reset it`);
  }
  const baseline = await client.query(
    'SELECT points, attendance, honors FROM demo_sandbox_baselines WHERE organization_id = $1 FOR UPDATE',
    [organizationId]
  );
  if (!baseline.rows.length) {
    return null;
  }
  const { points, attendance, honors } = baseline.rows[0];

  // points.honor_id cascades from honors; points go first all the same.
  await client.query('DELETE FROM points WHERE organization_id = $1', [organizationId]);
  await client.query('DELETE FROM honors WHERE organization_id = $1', [organizationId]);
  await client.query('DELETE FROM attendance WHERE organization_id = $1', [organizationId]);

  const restoredHonors = await client.query(
    `INSERT INTO honors
     SELECT r.* FROM jsonb_populate_recordset(NULL::honors, $1::jsonb) r
      WHERE r.organization_id = $2
        AND EXISTS (SELECT 1 FROM participants p WHERE p.id = r.participant_id)`,
    [JSON.stringify(honors), organizationId]
  );
  const restoredAttendance = await client.query(
    `INSERT INTO attendance
     SELECT r.* FROM jsonb_populate_recordset(NULL::attendance, $1::jsonb) r
      WHERE r.organization_id = $2
        AND EXISTS (SELECT 1 FROM participants p WHERE p.id = r.participant_id)`,
    [JSON.stringify(attendance), organizationId]
  );
  const restoredPoints = await client.query(
    `INSERT INTO points
     SELECT r.* FROM jsonb_populate_recordset(NULL::points, $1::jsonb) r
      WHERE r.organization_id = $2
        AND (r.participant_id IS NULL OR EXISTS (SELECT 1 FROM participants p WHERE p.id = r.participant_id))
        AND (r.group_id IS NULL OR EXISTS (SELECT 1 FROM groups g WHERE g.id = r.group_id))
        AND (r.honor_id IS NULL OR EXISTS (SELECT 1 FROM honors h WHERE h.id = r.honor_id))`,
    [JSON.stringify(points), organizationId]
  );

  return {
    points: restoredPoints.rowCount,
    attendance: restoredAttendance.rowCount,
    honors: restoredHonors.rowCount,
  };
}

/**
 * Take a lock that keeps other resets and captures out until the transaction ends.
 *
 * @param {Object} client - Database client, inside a transaction
 * @returns {Promise<void>}
 */
async function lockSandbox(client) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [RESET_LOCK_KEY]);
}

module.exports = {
  listDemoUnits,
  captureBaseline,
  restoreBaseline,
  lockSandbox,
};
