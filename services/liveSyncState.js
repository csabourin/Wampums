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
 * `shared` counts writes no unit could be named for (public pages, webhooks):
 * any of them makes every reconnecting session catch up, as before.
 */
const crypto = require('crypto');

const SERVER_RUN_ID = crypto.randomUUID();
const versions = new Map();
let sharedVersion = 0;

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
 * Count one change no unit could be named for.
 * @returns {number} The new shared version
 */
function recordSharedChange() {
  sharedVersion += 1;
  return sharedVersion;
}

/**
 * @param {number|string} organizationId - Unit
 * @returns {{ run: string, org: string, version: number, shared: number }}
 *   What a session of that unit compares on reconnection
 */
function syncStateFor(organizationId) {
  const key = String(organizationId);
  return { run: SERVER_RUN_ID, org: key, version: versions.get(key) || 0, shared: sharedVersion };
}

module.exports = { recordChange, recordSharedChange, syncStateFor };
