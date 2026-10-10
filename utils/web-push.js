/**
 * Web push helpers shared by every sender (notifications, announcements,
 * medication reminders).
 *
 * @module utils/web-push
 */

const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;

/**
 * Read the VAPID key pair from the environment.
 *
 * Both spellings are accepted: `VAPID_PUBLIC` / `VAPID_PRIVATE` are the names
 * documented in `.env.example`, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` the
 * names the senders originally read.
 *
 * @returns {{ publicKey: string|null, privateKey: string|null }}
 */
function getVapidKeys() {
  return {
    publicKey: process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC || null,
    privateKey: process.env.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE || null,
  };
}

/**
 * Whether a web-push error means the subscription no longer exists at the
 * push service (the browser unsubscribed, the app was reinstalled, or the
 * subscription expired). Such subscriptions never deliver again.
 *
 * @param {Error & { statusCode?: number }} sendError
 * @returns {boolean}
 */
function isGoneSubscriptionError(sendError) {
  return sendError?.statusCode === HTTP_GONE || sendError?.statusCode === HTTP_NOT_FOUND;
}

/**
 * Delete subscriptions the push service reported as gone.
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Unit the subscriptions belong to
 * @param {string[]} endpoints - Endpoints that answered 404 or 410
 * @returns {Promise<number>} Number of subscriptions removed
 */
async function removeGoneSubscriptions(pool, organizationId, endpoints) {
  if (!endpoints.length) {
    return 0;
  }
  const result = await pool.query(
    'DELETE FROM subscribers WHERE organization_id = $1 AND endpoint = ANY($2::text[])',
    [organizationId, endpoints]
  );
  return result.rowCount;
}

module.exports = {
  getVapidKeys,
  isGoneSubscriptionError,
  removeGoneSubscriptions,
};
