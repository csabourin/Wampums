/**
 * User Management Routes
 *
 * Handles user operations, role management, participant linking, and permissions
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/users
 */

const express = require('express');
const router = express.Router();

// Import utilities
const { getCurrentOrganizationId, verifyJWT, verifyOrganizationMembership } = require('../utils/api-helpers');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with user management routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/users:
   *   get:
   *     summary: Get all users in organization
   *     description: Retrieve list of all users belonging to current organization (admin only)
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: organization_id
   *         schema:
   *           type: integer
   *         description: Optional organization ID override
   *     responses:
   *       200:
   *         description: List of users
   *       401:
   *         description: Unauthorized
   */
  router.get('/users', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = req.query.organization_id || await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        `SELECT u.id, u.email, u.full_name, u.is_verified, uo.role, uo.approved
         FROM users u
         JOIN user_organizations uo ON u.id = uo.user_id
         WHERE uo.organization_id = $1
         ORDER BY u.full_name`,
        [organizationId]
      );

      res.json({
        success: true,
        users: result.rows
      });
    } catch (error) {
      logger.error('Error fetching users:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/pending-users:
   *   get:
   *     summary: Get pending users awaiting approval
   *     description: Retrieve list of unverified users (admin only)
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of pending users
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/pending-users', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user has admin role in this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, ['admin']);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const result = await pool.query(
        `SELECT u.id, u.email, u.full_name, u.is_verified, u.created_at, uo.role
         FROM users u
         JOIN user_organizations uo ON u.id = uo.user_id
         WHERE uo.organization_id = $1 AND u.is_verified = false
         ORDER BY u.created_at DESC`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching pending users:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/animateurs:
   *   get:
   *     summary: Get list of animators
   *     description: Retrieve users with admin or animation roles
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of animators
   */
  router.get('/animateurs', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        `SELECT u.id, u.full_name
         FROM users u
         JOIN user_organizations uo ON u.id = uo.user_id
         WHERE uo.organization_id = $1 AND uo.role IN ('admin', 'animation')
         ORDER BY u.full_name`,
        [organizationId]
      );

      res.json({
        success: true,
        animateurs: result.rows
      });
    } catch (error) {
      logger.error('Error fetching animateurs:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/parent-users:
   *   get:
   *     summary: Get list of parent users
   *     description: Retrieve users with parent role
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of parent users
   */
  router.get('/parent-users', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        `SELECT u.id, u.email, u.full_name
         FROM users u
         JOIN user_organizations uo ON u.id = uo.user_id
         WHERE uo.organization_id = $1 AND uo.role = 'parent'
         ORDER BY u.full_name`,
        [organizationId]
      );

      res.json({
        success: true,
        users: result.rows
      });
    } catch (error) {
      logger.error('Error fetching parent users:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/user-children:
   *   get:
   *     summary: Get current user's children
   *     description: Retrieve participants linked to the authenticated user
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: User's children
   */
  router.get('/user-children', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
                g.name as group_name, pg.group_id
         FROM participants p
         JOIN user_participants up ON p.id = up.participant_id
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE up.user_id = $2 AND po.organization_id = $1
         ORDER BY p.first_name, p.last_name`,
        [organizationId, decoded.user_id]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching user children:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/approve-user:
   *   post:
   *     summary: Approve a pending user
   *     description: Verify and approve a user account (admin only)
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - user_id
   *             properties:
   *               user_id:
   *                 type: integer
   *     responses:
   *       200:
   *         description: User approved successfully
   *       403:
   *         description: Insufficient permissions
   */
  router.post('/approve-user', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user has admin role in this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, ['admin']);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { user_id } = req.body;

      if (!user_id) {
        return res.status(400).json({ success: false, message: 'User ID is required' });
      }

      // Verify target user exists and belongs to this organization
      const userCheck = await pool.query(
        `SELECT u.id, u.email, uo.role FROM users u
         JOIN user_organizations uo ON u.id = uo.user_id
         WHERE u.id = $1 AND uo.organization_id = $2`,
        [user_id, organizationId]
      );

      if (userCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found in this organization' });
      }

      // Update user verification status
      await pool.query(
        `UPDATE users SET is_verified = true WHERE id = $1`,
        [user_id]
      );

      console.log(`[user] User ${user_id} approved by admin ${decoded.user_id}`);
      res.json({ success: true, message: 'User approved successfully' });
    } catch (error) {
      logger.error('Error approving user:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/update-user-role:
   *   post:
   *     summary: Update user role in organization
   *     description: Change a user's role (admin only)
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - user_id
   *               - role
   *             properties:
   *               user_id:
   *                 type: integer
   *               role:
   *                 type: string
   *                 enum: [admin, animation, parent, leader]
   *     responses:
   *       200:
   *         description: Role updated successfully
   *       400:
   *         description: Invalid role or cannot change own role
   */
  router.post('/update-user-role', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user has admin role in this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, ['admin']);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { user_id, role } = req.body;

      if (!user_id || !role) {
        return res.status(400).json({ success: false, message: 'User ID and role are required' });
      }

      const validRoles = ['admin', 'animation', 'parent', 'leader'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ success: false, message: `Invalid role. Valid roles: ${validRoles.join(', ')}` });
      }

      // Prevent admin from changing their own role
      if (user_id === decoded.user_id) {
        return res.status(400).json({ success: false, message: 'Cannot change your own role' });
      }

      // Verify target user belongs to this organization
      const userCheck = await pool.query(
        `SELECT id FROM user_organizations WHERE user_id = $1 AND organization_id = $2`,
        [user_id, organizationId]
      );

      if (userCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found in this organization' });
      }

      // Update user role in organization
      await pool.query(
        `UPDATE user_organizations SET role = $1 WHERE user_id = $2 AND organization_id = $3`,
        [role, user_id, organizationId]
      );

      console.log(`[user] User ${user_id} role updated to ${role} by admin ${decoded.user_id}`);
      res.json({ success: true, message: 'User role updated successfully' });
    } catch (error) {
      logger.error('Error updating user role:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/link-user-participants:
   *   post:
   *     summary: Link user to participants
   *     description: Associate user with multiple participants (children). Admins can link any user, regular users can only link themselves.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - participant_ids
   *             properties:
   *               user_id:
   *                 type: integer
   *                 description: User ID (optional, defaults to current user)
   *               participant_ids:
   *                 type: array
   *                 items:
   *                   type: integer
   *               replace_all:
   *                 type: boolean
   *                 description: If true, replace all existing links (admin only)
   *     responses:
   *       200:
   *         description: User linked successfully
   */
  router.post('/link-user-participants', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      let { user_id, participant_ids } = req.body;

      // If no user_id provided, use the current user (self-linking)
      if (!user_id) {
        user_id = decoded.user_id;
      }

      // If user is trying to link someone else, they need admin role
      if (user_id !== decoded.user_id) {
        const adminCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, ['admin']);
        if (!adminCheck.authorized) {
          return res.status(403).json({ success: false, message: 'Only admins can link participants to other users' });
        }
      }

      if (!participant_ids || !Array.isArray(participant_ids)) {
        return res.status(400).json({ success: false, message: 'participant_ids array is required' });
      }

      // Verify target user belongs to this organization
      const userCheck = await pool.query(
        `SELECT id FROM user_organizations WHERE user_id = $1 AND organization_id = $2`,
        [user_id, organizationId]
      );

      if (userCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found in this organization' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Only remove existing links if replace_all is true (admin replacing all links)
        // For self-linking (adding children), we just add to existing links
        const replaceAll = req.body.replace_all === true;
        if (replaceAll && user_id !== decoded.user_id) {
          await client.query(
            `DELETE FROM user_participants WHERE user_id = $1`,
            [user_id]
          );
        }

        // Add new links for each participant (verify they belong to org)
        for (const participantId of participant_ids) {
          // Verify participant belongs to this organization
          const participantCheck = await client.query(
            `SELECT id FROM participants p
             JOIN participant_organizations po ON p.id = po.participant_id
             WHERE p.id = $1 AND po.organization_id = $2`,
            [participantId, organizationId]
          );

          if (participantCheck.rows.length > 0) {
            await client.query(
              `INSERT INTO user_participants (user_id, participant_id)
               VALUES ($1, $2)
               ON CONFLICT (user_id, participant_id) DO NOTHING`,
              [user_id, participantId]
            );
          }
        }

        await client.query('COMMIT');
        console.log(`[user] User ${user_id} linked to ${participant_ids.length} participants`);
        res.json({ success: true, message: 'User linked to participants successfully' });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error linking user to participants:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/associate-user-participant:
   *   post:
   *     summary: Associate user with single participant
   *     description: Link a user to one participant (admin/animation only)
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - user_id
   *               - participant_id
   *             properties:
   *               user_id:
   *                 type: integer
   *               participant_id:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Association created
   */
  router.post('/associate-user-participant', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const { user_id, participant_id } = req.body;

      if (!user_id || !participant_id) {
        return res.status(400).json({
          success: false,
          message: 'User ID and participant ID are required'
        });
      }

      await pool.query(
        `INSERT INTO user_participants (user_id, participant_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, participant_id) DO NOTHING`,
        [user_id, participant_id]
      );

      res.json({ success: true, message: 'User associated with participant successfully' });
    } catch (error) {
      logger.error('Error associating user with participant:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/permissions/check:
   *   post:
   *     summary: Check if user has permission for a specific operation
   *     description: Verify user permissions based on role and operation
   *     tags: [Authorization]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - operation
   *             properties:
   *               operation:
   *                 type: string
   *     responses:
   *       200:
   *         description: Permission check result
   */
  router.post('/permissions/check', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.userId) {
        return res.json({ hasPermission: false });
      }

      const { operation } = req.body;

      if (!operation) {
        return res.json({ hasPermission: false });
      }

      const userId = decoded.userId;

      // Check user's permission for the specific operation
      const result = await pool.query(
        `SELECT u.id, p.allowed
         FROM users u
         LEFT JOIN user_organizations uo ON u.id = uo.user_id
         LEFT JOIN permissions p ON uo.role = p.role
         WHERE u.id = $1 AND p.operation = $2`,
        [userId, operation]
      );

      const hasPermission = result.rows.length > 0 && result.rows[0].allowed;

      res.json({ hasPermission });
    } catch (error) {
      logger.error('Error checking permission:', error);
      res.json({ hasPermission: false });
    }
  });

  return router;
};
