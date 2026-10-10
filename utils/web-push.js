/**
 * Web push helpers shared by every sender (notifications, announcements,
 * medication reminders).
 *
 * @module utils/web-push
 */

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;
const ERROR_BODY_SAMPLE_LENGTH = 300;

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
 * Whether a web-push error means the push service refused our VAPID signature:
 * the browser subscribed with another public key than the one paired with the
 * private key signing the push, or the key pair is invalid.
 *
 * @param {Error & { statusCode?: number }} sendError
 * @returns {boolean}
 */
function isKeyMismatchError(sendError) {
  return sendError?.statusCode === HTTP_UNAUTHORIZED || sendError?.statusCode === HTTP_FORBIDDEN;
}

/**
 * Condense failed sends for one log line: how many failed per HTTP status
 * (or error message when the push service was never reached), and the first
 * answer body, which names the push service's reason.
 *
 * @param {Array<Error & { statusCode?: number, body?: string }>} sendErrors
 * @returns {{ byStatus: Object<string, number>, sample: string|null }}
 */
function summarizePushFailures(sendErrors) {
  const byStatus = {};
  sendErrors.forEach((sendError) => {
    const key = sendError?.statusCode ? String(sendError.statusCode) : (sendError?.code || sendError?.message || 'unknown');
    byStatus[key] = (byStatus[key] || 0) + 1;
  });
  const first = sendErrors[0];
  const sample = first ? String(first.body || first.message || '').slice(0, ERROR_BODY_SAMPLE_LENGTH) : null;
  return { byStatus, sample };
}

/**
 * Sort the outcome of one send across several devices, and pick the devices
 * that can never receive again so they are deleted rather than accumulate.
 *
 * - 404 / 410: the subscription no longer exists at the push service.
 * - 401 / 403: the device subscribed with another public key than the
 *   server's. Removed only when another device accepted the same send, which
 *   proves the server's own key pair works; when every device refuses, the
 *   fault is more likely the server's keys, and deleting would unsubscribe
 *   the whole unit. The app subscribes again with the server's key the next
 *   time it opens.
 * - Anything else (429, 5xx, network): a passing failure of the push
 *   service, not of the device. The subscription is kept.
 *
 * @param {PromiseSettledResult[]} results - One per subscriber, in the same order
 * @param {Array<{ endpoint: string }>} subscribers - The devices sent to
 * @returns {{ sent: number, refusals: Error[], invalidEndpoints: string[] }}
 *   `refusals` holds every failure other than a gone subscription.
 */
function sortPushResults(results, subscribers) {
  const goneEndpoints = [];
  const keyMismatchEndpoints = [];
  const refusals = [];
  let sent = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      sent += 1;
    } else if (isGoneSubscriptionError(result.reason)) {
      goneEndpoints.push(subscribers[index].endpoint);
    } else {
      refusals.push(result.reason);
      if (isKeyMismatchError(result.reason)) {
        keyMismatchEndpoints.push(subscribers[index].endpoint);
      }
    }
  });
  const invalidEndpoints = sent > 0 ? [...goneEndpoints, ...keyMismatchEndpoints] : goneEndpoints;
  return { sent, refusals, invalidEndpoints };
}

/**
 * Delete subscriptions that can never receive again (see `sortPushResults`).
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Unit the subscriptions belong to
 * @param {string[]} endpoints - Endpoints to forget
 * @returns {Promise<number>} Number of subscriptions removed
 */
async function removeInvalidSubscriptions(pool, organizationId, endpoints) {
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
  isKeyMismatchError,
  removeInvalidSubscriptions,
  sortPushResults,
  summarizePushFailures,
};
