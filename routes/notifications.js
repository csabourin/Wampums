/**
 * Notifications Routes
 *
 * Handles push notification sending via web-push
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/notifications
 */

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');

// Import utilities
const { verifyJWT, getCurrentOrganizationId, verifyOrganizationMembership, handleOrganizationResolutionError } = require('../utils/api-helpers');
const { checkValidation } = require('../middleware/validation');

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
   * @swagger
   * /api/push-subscription:
   *   post:
   *     summary: Subscribe to push notifications
   *     description: Save push subscription for a user
   *     tags: [Notifications]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - endpoint
   *               - keys
   *             properties:
   *               endpoint:
   *                 type: string
   *               expirationTime:
   *                 type: string
   *               keys:
   *                 type: object
   *                 properties:
   *                   p256dh:
   *                     type: string
   *                   auth:
   *                     type: string
   *     responses:
   *       202:
   *         description: Subscription accepted for saving
   *       400:
   *         description: Missing subscription data
   *       401:
   *         description: Unauthorized
   */
  // Accept both legacy and versioned paths to avoid 404s during rollout
  router.post(['/push-subscription', '/v1/push-subscription'],
    check('endpoint').notEmpty().withMessage('endpoint is required').isURL().withMessage('endpoint must be a valid URL'),
    check('keys.p256dh').notEmpty().withMessage('keys.p256dh is required'),
    check('keys.auth').notEmpty().withMessage('keys.auth is required'),
    checkValidation,
    async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const payload = verifyJWT(token);

      if (!payload || !payload.user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId);
      if (!membership.authorized) {
        return res.status(403).json({ success: false, message: membership.message || 'Insufficient permissions' });
      }

      const { endpoint, expirationTime, keys } = req.body;
      const { p256dh, auth } = keys;

      // Perform the subscription write asynchronously so the response is non-blocking
      // and the service worker registration flow remains responsive.
      const upsertPromise = pool.query(
        `INSERT INTO subscribers (user_id, organization_id, endpoint, expiration_time, p256dh, auth)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (endpoint) DO UPDATE
         SET organization_id = EXCLUDED.organization_id,
             expiration_time = EXCLUDED.expiration_time,
             p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth`,
        [payload.user_id, organizationId, endpoint, expirationTime, p256dh, auth]
      );

      // Respond immediately to keep the client flow fast while still persisting in the background.
      res.status(202).json({ success: true, message: 'Subscription accepted' });

      upsertPromise.catch((error) => {
        logger.error('Error saving subscription asynchronously:', error);
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error initiating subscription save:', error);
      res.status(500).json({ error: 'Failed to save subscription' });
    }
  });

  // Lightweight health check to prevent expensive 404 handling on accidental GET requests
  router.get(['/push-subscription', '/v1/push-subscription'], (req, res) => {
    res.status(405).json({ success: false, message: 'Method not allowed. Use POST to register push subscriptions.' });
  });

  /**
   * @swagger
   * /api/push-subscribers:
   *   get:
   *     summary: Get all push notification subscribers
   *     description: Retrieve list of all push notification subscribers (admin only)
   *     tags: [Notifications]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Subscribers retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/push-subscribers', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized || authCheck.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT s.*, u.email, u.full_name
         FROM subscribers s
         JOIN users u ON s.user_id = u.id
         WHERE s.organization_id = $1
         ORDER BY s.created_at DESC NULLS LAST`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching push subscribers:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/send-notification:
   *   post:
   *     summary: Send push notification to all subscribers
   *     description: Send web push notification (admin only)
   *     tags: [Notifications]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - title
   *               - body
   *             properties:
   *               title:
   *                 type: string
   *               body:
   *                 type: string
   *     responses:
   *       200:
   *         description: Notification sent successfully
   *       400:
   *         description: Title and body are required
   *       403:
   *         description: Admin access required
   *       500:
   *         description: VAPID private key not set or other error
   */
  router.post('/send-notification',
    check('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }).withMessage('Title must not exceed 200 characters'),
    check('body').trim().notEmpty().withMessage('Body is required').isLength({ max: 1000 }).withMessage('Body must not exceed 1000 characters'),
    checkValidation,
    async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const payload = verifyJWT(token);

      // Only admin can send notifications
      if (!payload || payload.user_role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admin access required' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId, ['admin']);
      if (!membership.authorized) {
        return res.status(403).json({ error: membership.message || 'Forbidden: Admin access required' });
      }

      const { title, body } = req.body;

      // Note: Web-push functionality requires additional npm package
      // For now, just save to database or return success
      // Install with: npm install web-push

      try {
        const webpush = require('web-push');

        // VAPID keys - load from environment variables
        const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
        const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE;

        if (!vapidPublicKey) {
          return res.status(500).json({ error: 'VAPID public key is not configured' });
        }

        if (!vapidPrivateKey) {
          return res.status(500).json({ error: 'VAPID private key is not configured' });
        }

        webpush.setVapidDetails(
          'mailto:info@christiansabourin.com',
          vapidPublicKey,
          vapidPrivateKey
        );

        // Fetch subscribers for the admin's organization only
        const subscribersResult = await pool.query(
          `SELECT * FROM subscribers WHERE organization_id = $1`,
          [organizationId]
        );
        const subscribers = subscribersResult.rows;

        if (subscribers.length === 0) {
          return res.json({ success: true, message: 'No subscribers found' });
        }

        const notificationPayload = JSON.stringify({
          title,
          body,
          options: {
            body,
            tag: 'renotify',
            renotify: true,
            requireInteraction: true
          }
        });

        // Send notifications to all subscribers
        const promises = subscribers.map(subscriber => {
          const pushSubscription = {
            endpoint: subscriber.endpoint,
            keys: {
              p256dh: subscriber.p256dh,
              auth: subscriber.auth
            }
          };

          return webpush.sendNotification(pushSubscription, notificationPayload)
            .catch(error => {
              logger.error(`Failed to send notification to ${subscriber.endpoint}:`, error);
            });
        });

        await Promise.all(promises);

        res.json({ success: true });
      } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
        if (error.code === 'MODULE_NOT_FOUND') {
          logger.warn('web-push not installed. Install with: npm install web-push');
          res.json({ success: false, message: 'Web push not configured. Install web-push package.' });
        } else {
          throw error;
        }
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error sending notification:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
