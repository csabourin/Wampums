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
 * Whether web-push refused the subscription itself before reaching any push
 * service: an endpoint or keys stored malformed ("The subscription p256dh
 * value should be 65 bytes long"). Such a device can never be reached.
 *
 * @param {Error & { statusCode?: number }} sendError
 * @returns {boolean}
 */
function isMalformedSubscriptionError(sendError) {
  return Boolean(sendError) && !sendError.statusCode && /subscription/i.test(sendError.message || '');
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
 * - A malformed endpoint or keys: web-push refuses it without sending.
 * - 401 / 403: the device subscribed with another public key than the
 *   server's. Removed only when another device accepted the same send, which
 *   proves the server's own key pair works; when every device refuses, the
 *   fault is more likely the server's keys, and deleting would unsubscribe
 *   the whole unit. The app subscribes again with the server's key the next
 *   time it opens.
 * - Anything else (429, 5xx, network): not proof on its own; the device is
 *   kept, and recordPushOutcomes deletes it after repeated failures.
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
    } else if (isGoneSubscriptionError(result.reason) || isMalformedSubscriptionError(result.reason)) {
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

/** Sends in a row a device may fail, while others receive, before it is deleted. */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Record how each device fared in one send and delete the ones that will not
 * receive again: those `sortPushResults` marks invalid, and those that have
 * now failed MAX_CONSECUTIVE_FAILURES sends in a row. A failure counts only
 * when the same send reached another device; when every device fails, the
 * server is the likelier cause. A delivery resets the count.
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Unit the subscriptions belong to
 * @param {PromiseSettledResult[]} results - One per subscriber, in the same order
 * @param {Array<{ endpoint: string }>} subscribers - The devices sent to
 * @returns {Promise<string[]>} Endpoints removed
 */
async function recordPushOutcomes(pool, organizationId, results, subscribers) {
  const { sent, invalidEndpoints } = sortPushResults(results, subscribers);
  const invalid = new Set(invalidEndpoints);
  const delivered = [];
  const failed = [];
  results.forEach((result, index) => {
    const { endpoint } = subscribers[index];
    if (result.status === 'fulfilled') {
      delivered.push(endpoint);
    } else if (!invalid.has(endpoint)) {
      failed.push(endpoint);
    }
  });

  if (delivered.length) {
    await pool.query(
      `UPDATE subscribers SET failure_count = 0, last_success_at = NOW()
        WHERE organization_id = $1 AND endpoint = ANY($2::text[])`,
      [organizationId, delivered]
    );
  }
  const counted = sent > 0 ? failed : [];
  if (counted.length) {
    await pool.query(
      `UPDATE subscribers SET failure_count = failure_count + 1, last_failure_at = NOW()
        WHERE organization_id = $1 AND endpoint = ANY($2::text[])`,
      [organizationId, counted]
    );
  }
  if (!invalidEndpoints.length && !counted.length) {
    return [];
  }
  const removed = await pool.query(
    `DELETE FROM subscribers
      WHERE organization_id = $1
        AND (endpoint = ANY($2::text[]) OR (endpoint = ANY($3::text[]) AND failure_count >= $4))
      RETURNING endpoint`,
    [organizationId, invalidEndpoints, counted, MAX_CONSECUTIVE_FAILURES]
  );
  return removed.rows.map((row) => row.endpoint);
}

/**
 * Why a push failed, for the delivery log: the HTTP status the push service
 * answered (410 gone, 403 other key, 429 throttled) or web-push's own message.
 *
 * @param {Error & { statusCode?: number }} sendError
 * @returns {string}
 */
function describePushFailure(sendError) {
  const message = sendError?.message || 'Push send failed';
  return sendError?.statusCode ? `HTTP ${sendError.statusCode}: ${message}` : message;
}

/**
 * The push service a device is registered with (fcm.googleapis.com,
 * web.push.apple.com, …), which says which kind of device it is.
 *
 * @param {string} endpoint
 * @returns {string|null}
 */
function pushServiceHost(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch (_error) {
    return null;
  }
}

module.exports = {
  getVapidKeys,
  isGoneSubscriptionError,
  isKeyMismatchError,
  isMalformedSubscriptionError,
  describePushFailure,
  pushServiceHost,
  recordPushOutcomes,
  sortPushResults,
  summarizePushFailures,
};
