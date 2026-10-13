/**
 * How many changes the server has counted for each unit.
 *
 * Each announced write bumps its unit's version. A session that reconnects
 * compares the version it last saw with the one sent on connection: when they
 * match, nothing was counted while it was away, and it keeps its cache and
 * the screen on display instead of rebuilding them.
 *
 * Several server instances serve the app at once, so the counts live in
 * PostgreSQL (migrations/028_live_sync_versions.sql) and every instance sees
 * the same ones. Row 0, `shared`, counts writes no unit could be named for
 * (public pages, webhooks): any of them makes every reconnecting session catch
 * up.
 */
const SHARED_ROW = 0;

/**
 * @param {import('pg').Pool} pool - Database pool
 * @param {number} organizationId - Row to count in
 * @returns {Promise<number>} The row's new version
 */
async function increment(pool, organizationId) {
  const result = await pool.query(
    `INSERT INTO live_sync_versions (organization_id, version, updated_at)
     VALUES ($1, 1, NOW())
     ON CONFLICT (organization_id) DO UPDATE
       SET version = live_sync_versions.version + 1, updated_at = NOW()
     RETURNING version`,
    [organizationId],
  );
  return Number(result.rows[0].version);
}

/**
 * Count one change for a unit.
 * @param {import('pg').Pool} pool - Database pool
 * @param {number|string} organizationId - Unit the change belongs to
 * @returns {Promise<number>} The unit's new version
 */
function recordChange(pool, organizationId) {
  return increment(pool, Number(organizationId));
}

/**
 * Count one change no unit could be named for.
 * @param {import('pg').Pool} pool - Database pool
 * @returns {Promise<number>} The new shared version
 */
function recordSharedChange(pool) {
  return increment(pool, SHARED_ROW);
}

/**
 * @param {import('pg').Pool} pool - Database pool
 * @param {number|string} organizationId - Unit
 * @returns {Promise<{ org: string, version: number, shared: number }>} What a
 *   session of that unit compares on reconnection
 */
async function syncStateFor(pool, organizationId) {
  const unit = Number(organizationId);
  const result = await pool.query(
    'SELECT organization_id, version FROM live_sync_versions WHERE organization_id = ANY($1::int[])',
    [[unit, SHARED_ROW]],
  );
  const versionOf = (id) => Number(result.rows.find((row) => Number(row.organization_id) === id)?.version || 0);
  return { org: String(unit), version: versionOf(unit), shared: versionOf(SHARED_ROW) };
}

module.exports = { recordChange, recordSharedChange, syncStateFor };
