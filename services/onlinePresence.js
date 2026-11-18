/**
 * Which accounts of each unit are connected right now, for the count shown to
 * administrators (users.view_online, migration 092).
 *
 * An account counts once however many tabs or devices it has open. The count
 * is held in this process: it covers the connections this server instance
 * holds, which is every connection while the app runs as one instance.
 *
 * @module services/onlinePresence
 */

/** Unit id → (user id → number of open connections). */
const connectionsByUnit = new Map();

/**
 * @param {number|string} organizationId - Unit
 * @returns {number} Distinct accounts of the unit connected now
 */
function onlineCount(organizationId) {
  return connectionsByUnit.get(String(organizationId))?.size || 0;
}

/**
 * Record a new connection.
 * @param {number|string} organizationId - Unit
 * @param {string} userId - Account
 * @returns {boolean} True when the account was not already counted
 */
function addConnection(organizationId, userId) {
  const unit = String(organizationId);
  if (!connectionsByUnit.has(unit)) {
    connectionsByUnit.set(unit, new Map());
  }
  const users = connectionsByUnit.get(unit);
  const open = users.get(userId) || 0;
  users.set(userId, open + 1);
  return open === 0;
}

/**
 * Record a closed connection.
 * @param {number|string} organizationId - Unit
 * @param {string} userId - Account
 * @returns {boolean} True when the account has no connection left
 */
function removeConnection(organizationId, userId) {
  const unit = String(organizationId);
  const users = connectionsByUnit.get(unit);
  const open = users?.get(userId) || 0;
  if (open === 0) {
    return false;
  }
  if (open > 1) {
    users.set(userId, open - 1);
    return false;
  }
  users.delete(userId);
  if (users.size === 0) {
    connectionsByUnit.delete(unit);
  }
  return true;
}

/** Forget every connection (tests). */
function reset() {
  connectionsByUnit.clear();
}

module.exports = { onlineCount, addConnection, removeConnection, reset };
