/**
 * Google Chat Routes
 *
 * Provides endpoints to configure Google Chat integration and send messages to Google Chat Spaces.
 * All endpoints in this module are prefixed with /api
 *
 * SETUP INSTRUCTIONS:
 * 1. Create a Google Cloud Project at https://console.cloud.google.com
 * 2. Enable the Google Chat API
 * 3. Create a Service Account and download the JSON key file
 * 4. Configure your Google Chat bot in the Chat API configuration
 * 5. Create a Google Chat Space and add your bot to it
 * 6. Optionally: Create a Google Group for all members and add it to the Space
 *
 * @module routes/google-chat
 */

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');

// Import utilities
const {
  verifyJWT,
  getCurrentOrganizationId,
  verifyOrganizationMembership,
  handleOrganizationResolutionError
} = require('../utils/api-helpers');
const { checkValidation } = require('../middleware/validation');
const GoogleChatService = require('../services/google-chat');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with Google Chat routes
 */
module.exports = (pool, logger) => {
  // Initialize Google Chat service
  const googleChatService = new GoogleChatService(pool);

  /**
   * @swagger
   * /api/google-chat/config:
   *   post:
   *     summary: Configure Google Chat integration
   *     description: Upload service account credentials and configure Google Chat for the organization (admin only)
   *     tags: [GoogleChat]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - credentials
   *             properties:
   *               credentials:
   *                 type: object
   *                 description: Service account JSON credentials
   *     responses:
   *       200:
   *         description: Configuration saved successfully
   *       403:
   *         description: Admin access required
   *       500:
   *         description: Configuration failed
   */
  router.post('/google-chat/config',
    check('credentials').isObject().withMessage('Service account credentials are required'),
    check('credentials.type').equals('service_account').withMessage('Invalid credentials format'),
    check('credentials.project_id').notEmpty().withMessage('Project ID is required'),
    check('credentials.private_key').notEmpty().withMessage('Private key is required'),
    check('credentials.client_email').isEmail().withMessage('Valid service account email is required'),
    checkValidation,
    async (req, res) => {
      try {
        const token = req.headers.authorization?.split(' ')[1];
        const payload = verifyJWT(token);

        if (!payload || !payload.user_id) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const organizationId = await getCurrentOrganizationId(req, pool, logger);

        // Only admins can configure Google Chat
        const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId, ['admin']);
        if (!membership.authorized) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const { credentials } = req.body;

        // Deactivate any existing configurations
        await pool.query(
          `UPDATE google_chat_config SET is_active = FALSE WHERE organization_id = $1`,
          [organizationId]
        );

        // Insert new configuration
        const result = await pool.query(
          `INSERT INTO google_chat_config
           (organization_id, service_account_email, credentials_json, project_id, is_active)
           VALUES ($1, $2, $3, $4, TRUE)
           RETURNING id, service_account_email, project_id`,
          [organizationId, credentials.client_email, credentials, credentials.project_id]
        );

        // Clear cached client to force re-authentication with new credentials
        googleChatService.clearClient(organizationId);

        logger.info(`Google Chat configured for organization ${organizationId} with service account ${credentials.client_email}`);

        res.json({
          success: true,
          message: 'Google Chat configuration saved successfully',
          data: result.rows[0]
        });
      } catch (error) {
        if (handleOrganizationResolutionError(res, error, logger)) {
          return;
        }
        logger.error('Error configuring Google Chat:', error);
        res.status(500).json({ error: error.message });
      }
    });

  /**
   * @swagger
   * /api/google-chat/config:
   *   get:
   *     summary: Get Google Chat configuration status
   *     description: Check if Google Chat is configured for the organization
   *     tags: [GoogleChat]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Configuration status retrieved
   *       401:
   *         description: Unauthorized
   */
  router.get('/google-chat/config', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const payload = verifyJWT(token);

      if (!payload || !payload.user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId);
      if (!membership.authorized) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT id, service_account_email, project_id, is_active, created_at, updated_at
         FROM google_chat_config
         WHERE organization_id = $1 AND is_active = TRUE`,
        [organizationId]
      );

      if (result.rows.length === 0) {
        return res.json({
          success: true,
          configured: false,
          message: 'Google Chat is not configured for this organization'
        });
      }

      res.json({
        success: true,
        configured: true,
        data: result.rows[0]
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching Google Chat configuration:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /api/google-chat/spaces:
   *   post:
   *     summary: Register a Google Chat Space
   *     description: Register a Google Chat Space for the organization (admin only)
   *     tags: [GoogleChat]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - spaceId
   *             properties:
   *               spaceId:
   *                 type: string
   *                 description: Google Chat Space ID (format spaces/AAAAxxxxxxx)
   *               spaceName:
   *                 type: string
   *               isBroadcastSpace:
   *                 type: boolean
   *               description:
   *                 type: string
   *     responses:
   *       200:
   *         description: Space registered successfully
   *       403:
   *         description: Admin access required
   */
  router.post('/google-chat/spaces',
    check('spaceId').notEmpty().withMessage('Space ID is required').matches(/^spaces\//).withMessage('Space ID must start with "spaces/"'),
    check('spaceName').optional().isString(),
    check('isBroadcastSpace').optional().isBoolean(),
    check('description').optional().isString(),
    checkValidation,
    async (req, res) => {
      try {
        const token = req.headers.authorization?.split(' ')[1];
        const payload = verifyJWT(token);

        if (!payload || !payload.user_id) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const organizationId = await getCurrentOrganizationId(req, pool, logger);

        const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId, ['admin']);
        if (!membership.authorized) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const { spaceId, spaceName, isBroadcastSpace, description } = req.body;

        // If this is being set as broadcast space, unset any existing broadcast space
        if (isBroadcastSpace) {
          await pool.query(
            `UPDATE google_chat_spaces
             SET is_broadcast_space = FALSE
             WHERE organization_id = $1 AND is_broadcast_space = TRUE`,
            [organizationId]
          );
        }

        // Fetch space details from Google Chat API to verify it exists
        let spaceDetails = null;
        try {
          spaceDetails = await googleChatService.getSpace(organizationId, spaceId);
        } catch (error) {
          logger.warn(`Could not fetch space details for ${spaceId}:`, error.message);
        }

        // Insert or update space
        const result = await pool.query(
          `INSERT INTO google_chat_spaces
           (organization_id, space_id, space_name, is_broadcast_space, description, space_type)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (space_id)
           DO UPDATE SET
             space_name = EXCLUDED.space_name,
             is_broadcast_space = EXCLUDED.is_broadcast_space,
             description = EXCLUDED.description,
             is_active = TRUE,
             updated_at = NOW()
           RETURNING id, space_id, space_name, is_broadcast_space`,
          [
            organizationId,
            spaceId,
            spaceName || spaceDetails?.displayName || spaceId,
            isBroadcastSpace || false,
            description || null,
            spaceDetails?.spaceType || 'SPACE'
          ]
        );

        logger.info(`Space ${spaceId} registered for organization ${organizationId}, broadcast: ${isBroadcastSpace}`);

        res.json({
          success: true,
          message: 'Space registered successfully',
          data: result.rows[0]
        });
      } catch (error) {
        if (handleOrganizationResolutionError(res, error, logger)) {
          return;
        }
        logger.error('Error registering Google Chat space:', error);
        res.status(500).json({ error: error.message });
      }
    });

  /**
   * @swagger
   * /api/google-chat/spaces:
   *   get:
   *     summary: List registered Google Chat Spaces
   *     description: Get all registered Google Chat Spaces for the organization
   *     tags: [GoogleChat]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Spaces retrieved successfully
   */
  router.get('/google-chat/spaces', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const payload = verifyJWT(token);

      if (!payload || !payload.user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId);
      if (!membership.authorized) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT id, space_id, space_name, space_type, is_broadcast_space, is_active,
                member_count, description, created_at, updated_at
         FROM google_chat_spaces
         WHERE organization_id = $1 AND is_active = TRUE
         ORDER BY is_broadcast_space DESC, created_at DESC`,
        [organizationId]
      );

      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching Google Chat spaces:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /api/google-chat/send-message:
   *   post:
   *     summary: Send a message to a Google Chat Space
   *     description: Send a message to a specific Google Chat Space (admin only)
   *     tags: [GoogleChat]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - spaceId
   *               - message
   *             properties:
   *               spaceId:
   *                 type: string
   *               subject:
   *                 type: string
   *               message:
   *                 type: string
   *     responses:
   *       200:
   *         description: Message sent successfully
   *       403:
   *         description: Admin access required
   */
  router.post('/google-chat/send-message',
    check('spaceId').notEmpty().withMessage('Space ID is required'),
    check('message').notEmpty().withMessage('Message is required').isLength({ max: 4096 }).withMessage('Message must not exceed 4096 characters'),
    check('subject').optional().isString().isLength({ max: 500 }).withMessage('Subject must not exceed 500 characters'),
    checkValidation,
    async (req, res) => {
      try {
        const token = req.headers.authorization?.split(' ')[1];
        const payload = verifyJWT(token);

        if (!payload || !payload.user_id) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const organizationId = await getCurrentOrganizationId(req, pool, logger);

        const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId, ['admin']);
        if (!membership.authorized) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const { spaceId, subject, message } = req.body;

        // Send the message
        const fullMessage = subject ? `**${subject}**\n\n${message}` : message;
        const response = await googleChatService.sendMessageToSpace(
          organizationId,
          spaceId,
          fullMessage
        );

        // Log the message
        await pool.query(
          `INSERT INTO google_chat_messages
           (organization_id, space_id, message_id, subject, message_text, sent_by_user_id, delivery_status)
           VALUES ($1, $2, $3, $4, $5, $6, 'sent')`,
          [organizationId, spaceId, response.name, subject || null, message, payload.user_id]
        );

        logger.info(`Message sent to space ${spaceId} by user ${payload.user_id}`);

        res.json({
          success: true,
          message: 'Message sent successfully',
          data: {
            messageId: response.name,
            spaceId
          }
        });
      } catch (error) {
        if (handleOrganizationResolutionError(res, error, logger)) {
          return;
        }
        logger.error('Error sending Google Chat message:', error);

        // Log failed delivery
        try {
          await pool.query(
            `INSERT INTO google_chat_messages
             (organization_id, space_id, subject, message_text, sent_by_user_id, delivery_status, error_message)
             VALUES ($1, $2, $3, $4, $5, 'failed', $6)`,
            [
              await getCurrentOrganizationId(req, pool, logger),
              req.body.spaceId,
              req.body.subject || null,
              req.body.message,
              payload.user_id,
              error.message
            ]
          );
        } catch (logError) {
          logger.error('Error logging failed message:', logError);
        }

        res.status(500).json({ error: error.message });
      }
    });

  /**
   * @swagger
   * /api/google-chat/broadcast:
   *   post:
   *     summary: Broadcast message to default announcement space
   *     description: Send a broadcast message to the organization's default Google Chat Space (admin only)
   *     tags: [GoogleChat]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - subject
   *               - message
   *             properties:
   *               subject:
   *                 type: string
   *               message:
   *                 type: string
   *     responses:
   *       200:
   *         description: Broadcast sent successfully
   *       403:
   *         description: Admin access required
   *       404:
   *         description: No broadcast space configured
   */
  router.post('/google-chat/broadcast',
    check('subject').notEmpty().withMessage('Subject is required').isLength({ max: 500 }).withMessage('Subject must not exceed 500 characters'),
    check('message').notEmpty().withMessage('Message is required').isLength({ max: 4096 }).withMessage('Message must not exceed 4096 characters'),
    checkValidation,
    async (req, res) => {
      try {
        const token = req.headers.authorization?.split(' ')[1];
        const payload = verifyJWT(token);

        if (!payload || !payload.user_id) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const organizationId = await getCurrentOrganizationId(req, pool, logger);

        const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId, ['admin']);
        if (!membership.authorized) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const { subject, message } = req.body;

        const response = await googleChatService.sendBroadcast(organizationId, subject, message);

        logger.info(`Broadcast sent for organization ${organizationId} by user ${payload.user_id}`);

        res.json({
          success: true,
          message: 'Broadcast sent successfully',
          data: response
        });
      } catch (error) {
        if (handleOrganizationResolutionError(res, error, logger)) {
          return;
        }
        logger.error('Error sending Google Chat broadcast:', error);
        res.status(500).json({ error: error.message });
      }
    });

  /**
   * @swagger
   * /api/google-chat/messages:
   *   get:
   *     summary: Get message history
   *     description: Retrieve Google Chat message history for the organization
   *     tags: [GoogleChat]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 50
   *     responses:
   *       200:
   *         description: Message history retrieved
   */
  router.get('/google-chat/messages', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const payload = verifyJWT(token);

      if (!payload || !payload.user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId);
      if (!membership.authorized) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const limit = parseInt(req.query.limit) || 50;

      const result = await pool.query(
        `SELECT m.id, m.space_id, m.message_id, m.subject, m.message_text,
                m.sent_at, m.delivery_status, m.error_message,
                u.full_name as sent_by_name, u.email as sent_by_email,
                s.space_name
         FROM google_chat_messages m
         LEFT JOIN users u ON m.sent_by_user_id = u.id
         LEFT JOIN google_chat_spaces s ON m.space_id = s.space_id
         WHERE m.organization_id = $1
         ORDER BY m.sent_at DESC
         LIMIT $2`,
        [organizationId, limit]
      );

      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching Google Chat messages:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
