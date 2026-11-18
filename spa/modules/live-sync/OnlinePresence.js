/**
 * How many accounts of the unit are online, as the server last said.
 *
 * The server sends the count (`online-count`) only to connections allowed to
 * see it (users.view_online), when they connect and each time an account comes
 * or goes. LiveDataSync passes it here; screens listen for changes.
 *
 * @module spa/modules/live-sync/OnlinePresence
 */

/** @type {?number} Last count received, null while unknown (disconnected, or not allowed) */
let latestCount = null;
const listeners = new Set();

/**
 * @returns {?number} Accounts online now, or null when unknown
 */
export function getOnlineCount() {
  return latestCount;
}

/**
 * Record the count the server sent, or null when it is no longer known.
 * @param {*} count - Count from the server
 * @returns {void}
 */
export function setOnlineCount(count) {
  const next = Number.isInteger(count) && count >= 0 ? count : null;
  if (next === latestCount) {
    return;
  }
  latestCount = next;
  listeners.forEach((listener) => listener(latestCount));
}

/**
 * @param {function(?number): void} listener - Called with each new count
 * @returns {function(): void} Stops listening
 */
export function onOnlineCountChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
