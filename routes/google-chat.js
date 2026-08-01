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
const { asyncHandler, success, error: errorResponse } = require('../middleware/response');
const { check } = require('express-validator');

const {
  authenticate,
  blockDemoRoles,
  requirePermission,
  getOrganizationId,
} = require('../middleware/auth');
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
  const router = express.Router();
  // Initialize Google Chat service
  const googleChatService = new GoogleChatService(pool);

  /**
   * @swagger
   * /api/v1/google-chat/config:
   *   post:
   *     summary: Configure Google Chat integration
   *     description: Upload service account credentials and configure Google Chat for the organization (admin only)
   *     tags: [GoogleChat]
   *     x-permission: org.edit
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
  router.post('/config',
    authenticate,
    blockDemoRoles,
    requirePermission('org.edit'),
    check('credentials').isObject().withMessage('Service account credentials are required'),
    check('credentials.type').equals('service_account').withMessage('Invalid credentials format'),
    check('credentials.project_id').notEmpty().withMessage('Project ID is required'),
    check('credentials.private_key').notEmpty().withMessage('Private key is required'),
    check('credentials.client_email').isEmail().withMessage('Valid service account email is required'),
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);

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

        return success(res, result.rows[0], 'Google Chat configuration saved successfully');
      } catch (routeError) {
        logger.error('Error configuring Google Chat:', routeError);
        return errorResponse(res, 'internal_server_error', 500);
      }
    }));

  /**
   * @swagger
   * /api/v1/google-chat/config:
   *   get:
   *     summary: Get Google Chat configuration status
   *     description: Check if Google Chat is configured for the organization
   *     tags: [GoogleChat]
   *     x-permission: org.view
    *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Configuration status retrieved
   *       401:
   *         description: Unauthorized
   */
  router.get('/config', authenticate, requirePermission('org.view'), asyncHandler(async (req, res) => {
    try {
      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT id, service_account_email, project_id, is_active, created_at, updated_at
         FROM google_chat_config
         WHERE organization_id = $1 AND is_active = TRUE`,
        [organizationId]
      );

      if (result.rows.length === 0) {
        return success(
          res,
          { configured: false, config: null },
          'Google Chat is not configured for this organization'
        );
      }

      return success(res, { configured: true, config: result.rows[0] });
    } catch (routeError) {
      logger.error('Error fetching Google Chat configuration:', routeError);
      return errorResponse(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/v1/google-chat/spaces:
   *   post:
   *     summary: Register a Google Chat Space
   *     description: Register a Google Chat Space for the organization (admin only)
   *     tags: [GoogleChat]
   *     x-permission: org.edit
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
  router.post('/spaces',
    authenticate,
    blockDemoRoles,
    requirePermission('org.edit'),
    check('spaceId').notEmpty().withMessage('Space ID is required').matches(/^spaces\//).withMessage('Space ID must start with "spaces/"'),
    check('spaceName').optional().isString(),
    check('isBroadcastSpace').optional().isBoolean(),
    check('description').optional().isString(),
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);

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

        return success(res, result.rows[0], 'Space registered successfully');
      } catch (routeError) {
        logger.error('Error registering Google Chat space:', routeError);
        return errorResponse(res, 'internal_server_error', 500);
      }
    }));

  /**
   * @swagger
   * /api/v1/google-chat/spaces:
   *   get:
   *     summary: List registered Google Chat Spaces
   *     description: Get all registered Google Chat Spaces for the organization
   *     tags: [GoogleChat]
   *     x-permission: communications.send
    *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Spaces retrieved successfully
   */
  router.get('/spaces', authenticate, requirePermission('communications.send'), asyncHandler(async (req, res) => {
    try {
      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT id, space_id, space_name, space_type, is_broadcast_space, is_active,
                member_count, description, created_at, updated_at
         FROM google_chat_spaces
         WHERE organization_id = $1 AND is_active = TRUE
         ORDER BY is_broadcast_space DESC, created_at DESC`,
        [organizationId]
      );

      return success(res, result.rows);
    } catch (routeError) {
      logger.error('Error fetching Google Chat spaces:', routeError);
      return errorResponse(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/v1/google-chat/send-message:
   *   post:
   *     summary: Send a message to a Google Chat Space
   *     description: Send a message to a specific Google Chat Space (admin only)
   *     tags: [GoogleChat]
   *     x-permission: communications.send
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
  router.post('/send-message',
    authenticate,
    blockDemoRoles,
    requirePermission('communications.send'),
    check('spaceId').notEmpty().withMessage('Space ID is required'),
    check('message').notEmpty().withMessage('Message is required').isLength({ max: 4096 }).withMessage('Message must not exceed 4096 characters'),
    check('subject').optional().isString().isLength({ max: 500 }).withMessage('Subject must not exceed 500 characters'),
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);

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
          [organizationId, spaceId, response.name, subject || null, message, req.user.id]
        );

        logger.info(`Message sent to space ${spaceId} by user ${req.user.id}`);

        return success(
          res,
          {
            messageId: response.name,
            spaceId
          },
          'Message sent successfully'
        );
      } catch (routeError) {
        logger.error('Error sending Google Chat message:', routeError);

        // Log failed delivery
        try {
          await pool.query(
            `INSERT INTO google_chat_messages
             (organization_id, space_id, subject, message_text, sent_by_user_id, delivery_status, error_message)
             VALUES ($1, $2, $3, $4, $5, 'failed', $6)`,
            [
              await getOrganizationId(req, pool),
              req.body.spaceId,
              req.body.subject || null,
              req.body.message,
              req.user.id,
              routeError.message
            ]
          );
        } catch (logError) {
          logger.error('Error logging failed message:', logError);
        }

        return errorResponse(res, 'internal_server_error', 500);
      }
    }));

  /**
   * @swagger
   * /api/v1/google-chat/broadcast:
   *   post:
   *     summary: Broadcast message to default announcement space
   *     description: Send a broadcast message to the organization's default Google Chat Space (admin only)
   *     tags: [GoogleChat]
   *     x-permission: communications.send
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
  router.post('/broadcast',
    authenticate,
    blockDemoRoles,
    requirePermission('communications.send'),
    check('subject').notEmpty().withMessage('Subject is required').isLength({ max: 500 }).withMessage('Subject must not exceed 500 characters'),
    check('message').notEmpty().withMessage('Message is required').isLength({ max: 4096 }).withMessage('Message must not exceed 4096 characters'),
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);

        const { subject, message } = req.body;

        const response = await googleChatService.sendBroadcast(organizationId, subject, message);

        logger.info(`Broadcast sent for organization ${organizationId} by user ${req.user.id}`);

        return success(res, response, 'Broadcast sent successfully');
      } catch (routeError) {
        logger.error('Error sending Google Chat broadcast:', routeError);
        return errorResponse(res, 'internal_server_error', 500);
      }
    }));

  /**
   * @swagger
   * /api/v1/google-chat/messages:
   *   get:
   *     summary: Get message history
   *     description: Retrieve Google Chat message history for the organization
   *     tags: [GoogleChat]
   *     x-permission: communications.send
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
  router.get('/messages', authenticate, requirePermission('communications.send'), asyncHandler(async (req, res) => {
    try {
      const organizationId = await getOrganizationId(req, pool);

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

      return success(res, result.rows);
    } catch (routeError) {
      logger.error('Error fetching Google Chat messages:', routeError);
      return errorResponse(res, 'internal_server_error', 500);
    }
  }));

  return router;
};
