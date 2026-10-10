/**
 * Notifications Routes
 *
 * Handles push notification sending via web-push
 * All endpoints in this module are prefixed with /api/v1/notifications
 *
 * @module routes/notifications
 */

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const { authenticate, getOrganizationId, requirePermission, blockDemoRoles } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');

// Import utilities
const { handleOrganizationResolutionError } = require('../utils/api-helpers');
const { checkValidation } = require('../middleware/validation');
const { getVapidKeys, isGoneSubscriptionError, removeGoneSubscriptions } = require('../utils/web-push');

const HTTP_ACCEPTED = 202;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_SERVICE_UNAVAILABLE = 503;
const TITLE_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 1000;

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with notification routes
 */
module.exports = (pool, logger) => {
  /**
   * GET /api/v1/notifications/vapid-public-key
   * The public key the browser must subscribe with. Serving it from the same
   * environment that signs the pushes keeps the two halves of the pair in step;
   * a subscription made with another key is refused by the push service.
   */
  router.get('/vapid-public-key', authenticate, requirePermission(), (req, res) => {
    const { publicKey } = getVapidKeys();
    if (!publicKey) {
      return error(res, 'Push notifications are not configured', HTTP_SERVICE_UNAVAILABLE);
    }
    return success(res, { publicKey });
  });

  /**
   * POST /api/v1/notifications/subscription
   * Register this browser for the signed-in member. A browser keeps one
   * endpoint; when another member signs in on it, the endpoint moves to them.
   */
  router.post('/subscription', authenticate, blockDemoRoles, requirePermission(), check('endpoint').notEmpty().withMessage('endpoint is required').isURL().withMessage('endpoint must be a valid URL'), check('keys.p256dh').notEmpty().withMessage('keys.p256dh is required'), check('keys.auth').notEmpty().withMessage('keys.auth is required'), checkValidation, asyncHandler(async (req, res) => {
    try {
      const organizationId = await getOrganizationId(req, pool);

      const { endpoint, expirationTime, keys = {} } = req.body;
      const { p256dh, auth } = keys;
      // Browsers give the expiry in epoch milliseconds; the column is a timestamp.
      const expiresAt = expirationTime === null || expirationTime === undefined || !Number.isFinite(Number(expirationTime))
        ? null
        : new Date(Number(expirationTime));

      // Perform the subscription write asynchronously so the response is non-blocking
      // and the service worker registration flow remains responsive.
      const upsertPromise = pool.query(
        `INSERT INTO subscribers (user_id, organization_id, endpoint, expiration_time, p256dh, auth)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             organization_id = EXCLUDED.organization_id,
             expiration_time = EXCLUDED.expiration_time,
             p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth`,
        [req.user.id, organizationId, endpoint, expiresAt, p256dh, auth]
      );

      // Respond immediately to keep the client flow fast while still persisting in the background.
      success(res, null, 'Subscription accepted', HTTP_ACCEPTED);

      upsertPromise.catch((saveError) => {
        logger.error('Error saving subscription asynchronously:', saveError);
      });
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error initiating subscription save:', err);
      error(res, 'Failed to save subscription', HTTP_INTERNAL_ERROR);
    }
  }));

  // Lightweight health check to prevent expensive 404 handling on accidental GET requests
  router.get('/subscription', (req, res) => {
    error(res, 'Method not allowed. Use POST to register push subscriptions.', HTTP_METHOD_NOT_ALLOWED);
  });

  /**
   * GET /api/v1/notifications/subscribers
   * Members who can receive push notifications: one row per person, however
   * many browsers or devices they registered.
   */
  router.get('/subscribers', authenticate, requirePermission(['communications.send']), asyncHandler(async (req, res) => {
    try {
      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT s.user_id, u.email, u.full_name, COUNT(*)::int AS device_count,
                MAX(s.created_at) AS last_subscribed_at
         FROM subscribers s
         JOIN users u ON s.user_id = u.id
         WHERE s.organization_id = $1
           AND EXISTS (SELECT 1 FROM user_organizations uo
                        WHERE uo.user_id = s.user_id AND uo.organization_id = s.organization_id
                          AND uo.status = 'active')
         GROUP BY s.user_id, u.email, u.full_name
         ORDER BY LOWER(COALESCE(NULLIF(u.full_name, ''), u.email))`,
        [organizationId]
      );

      return success(res, result.rows);
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return undefined;
      }
      logger.error('Error fetching push subscribers:', err);
      return error(res, 'internal_server_error', HTTP_INTERNAL_ERROR);
    }
  }));

  /**
   * POST /api/v1/notifications/send
   * Send a push notification to the selected members (`user_ids`), or to every
   * active subscriber of the unit when none are selected. Subscriptions the
   * push service reports as gone are deleted.
   */
  router.post('/send', authenticate, blockDemoRoles, requirePermission(['communications.send']),
    check('title').trim().notEmpty().withMessage('Title is required').isLength({ max: TITLE_MAX_LENGTH }).withMessage(`Title must not exceed ${TITLE_MAX_LENGTH} characters`),
    check('body').trim().notEmpty().withMessage('Body is required').isLength({ max: BODY_MAX_LENGTH }).withMessage(`Body must not exceed ${BODY_MAX_LENGTH} characters`),
    check('user_ids').optional().isArray().withMessage('user_ids must be an array'),
    check('user_ids.*').isUUID().withMessage('user_ids must contain user ids'),
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const { title, body } = req.body;
        const userIds = Array.isArray(req.body.user_ids) ? req.body.user_ids : [];

        let webpush;
        try {
          webpush = require('web-push');
        } catch (loadError) {
          if (loadError.code === 'MODULE_NOT_FOUND') {
            logger.warn('web-push not installed. Install with: npm install web-push');
            return error(res, 'Push notifications are not configured', HTTP_SERVICE_UNAVAILABLE);
          }
          throw loadError;
        }

        const { publicKey, privateKey } = getVapidKeys();
        if (!publicKey || !privateKey) {
          logger.error('Push notifications: VAPID keys are not configured (VAPID_PUBLIC / VAPID_PRIVATE)');
          return error(res, 'Push notifications are not configured', HTTP_SERVICE_UNAVAILABLE);
        }

        webpush.setVapidDetails('mailto:info@wampums.app', publicKey, privateKey);

        // A member whose membership is no longer active (left, or closed at the
        // year transition) stops receiving the unit's notifications.
        // Subscriptions recorded without an account cannot be checked and are
        // kept for unit-wide sends only.
        const subscribersResult = await pool.query(
          `SELECT s.endpoint, s.p256dh, s.auth FROM subscribers s
            WHERE s.organization_id = $1
              AND (cardinality($2::uuid[]) = 0 OR s.user_id = ANY($2::uuid[]))
              AND (s.user_id IS NULL OR EXISTS (
                    SELECT 1 FROM user_organizations uo
                     WHERE uo.user_id = s.user_id AND uo.organization_id = s.organization_id
                       AND uo.status = 'active'))`,
          [organizationId, userIds]
        );
        const subscribers = subscribersResult.rows;

        if (subscribers.length === 0) {
          return success(res, { sent: 0, failed: 0, removed: 0 }, 'No subscribers found');
        }

        const notificationPayload = JSON.stringify({
          title,
          body,
          tag: 'renotify',
          requireInteraction: true
        });

        const results = await Promise.allSettled(subscribers.map((subscriber) => webpush.sendNotification({
          endpoint: subscriber.endpoint,
          keys: { p256dh: subscriber.p256dh, auth: subscriber.auth }
        }, notificationPayload)));

        const goneEndpoints = [];
        let sent = 0;
        let failed = 0;
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            sent += 1;
            return;
          }
          failed += 1;
          if (isGoneSubscriptionError(result.reason)) {
            goneEndpoints.push(subscribers[index].endpoint);
          } else {
            logger.error(`Failed to send notification to ${subscribers[index].endpoint}:`, result.reason);
          }
        });
        const removed = await removeGoneSubscriptions(pool, organizationId, goneEndpoints);

        // Every attempt failed for a reason other than a vanished browser:
        // nothing was delivered and the sender must know it.
        if (sent === 0 && failed > goneEndpoints.length) {
          return error(res, 'failed_to_send_notification', HTTP_INTERNAL_ERROR);
        }
        return success(res, { sent, failed, removed }, 'Notification sent');
      } catch (err) {
        if (handleOrganizationResolutionError(res, err, logger)) {
          return undefined;
        }
        logger.error('Error sending notification:', err);
        return error(res, 'internal_server_error', HTTP_INTERNAL_ERROR);
      }
    }));

  return router;
};
