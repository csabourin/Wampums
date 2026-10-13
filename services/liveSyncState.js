/**
 * How many changes this server has announced to each unit.
 *
 * Each announced write bumps its unit's version. A session that reconnects
 * compares the version it last saw with the one sent on connection: when they
 * match, nothing was announced while it was away, and it keeps its cache and
 * the screen on display instead of rebuilding them.
 *
 * Versions live in memory, as the Socket.IO rooms do. `run` names this server
 * process, so a session that reconnects to a restarted server always catches up.
 */
const crypto = require('crypto');

const SERVER_RUN_ID = crypto.randomUUID();
const versions = new Map();

/**
 * Count one announced change for a unit.
 * @param {number|string} organizationId - Unit the change belongs to
 * @returns {number} The unit's new version
 */
function recordChange(organizationId) {
  const key = String(organizationId);
  const version = (versions.get(key) || 0) + 1;
  versions.set(key, version);
  return version;
}

/**
 * @param {number|string} organizationId - Unit
 * @returns {{ run: string, org: string, version: number }} What a session of
 *   that unit compares on reconnection
 */
function syncStateFor(organizationId) {
  const key = String(organizationId);
  return { run: SERVER_RUN_ID, org: key, version: versions.get(key) || 0 };
}

module.exports = { recordChange, syncStateFor };
