/**
 * Badge Routes
 *
 * Handles badge system management, progress tracking, approvals, and reporting
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/badges
 */

const express = require('express');
const router = express.Router();

// Import utilities
const { getCurrentOrganizationId, verifyJWT, verifyOrganizationMembership, getPointSystemRules } = require('../utils/api-helpers');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with badge routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/badge-progress:
   *   get:
   *     summary: Get badge progress for a participant
   *     description: Retrieve all badge progress records for a specific participant
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Participant ID
   *     responses:
   *       200:
   *         description: Badge progress retrieved successfully
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   */
  router.get('/badge-progress', async (req, res) => {
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

      const participantId = req.query.participant_id;

      if (!participantId) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      const result = await pool.query(
        `SELECT * FROM badge_progress
         WHERE participant_id = $1 AND organization_id = $2
         ORDER BY date_obtention DESC`,
        [participantId, organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching badge progress:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/pending-badges:
   *   get:
   *     summary: Get pending badges for approval
   *     description: Retrieve all badges awaiting approval (requires admin or leader role)
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Pending badges retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/pending-badges', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization with admin or leader role
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, ['admin', 'leader']);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const result = await pool.query(
        `SELECT bp.*, p.first_name, p.last_name
         FROM badge_progress bp
         JOIN participants p ON bp.participant_id = p.id
         WHERE bp.organization_id = $1 AND bp.status = 'pending'
         ORDER BY bp.created_at DESC`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching pending badges:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/save-badge-progress:
   *   post:
   *     summary: Save badge progress (submit for approval)
   *     description: Submit a new badge progress entry for admin approval
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - participant_id
   *               - territoire_chasse
   *             properties:
   *               participant_id:
   *                 type: integer
   *               territoire_chasse:
   *                 type: string
   *               objectif:
   *                 type: string
   *               description:
   *                 type: string
   *               fierte:
   *                 type: boolean
   *               raison:
   *                 type: string
   *               date_obtention:
   *                 type: string
   *                 format: date
   *               etoiles:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Badge progress submitted successfully
   *       400:
   *         description: Missing required fields
   *       401:
   *         description: Unauthorized
   */
  router.post('/save-badge-progress', async (req, res) => {
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

      const { participant_id, territoire_chasse, objectif, description, fierte, raison, date_obtention, etoiles } = req.body;

      if (!participant_id || !territoire_chasse) {
        return res.status(400).json({ success: false, message: 'Participant ID and territoire_chasse are required' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const result = await client.query(
          `INSERT INTO badge_progress
           (participant_id, organization_id, territoire_chasse, objectif, description, fierte, raison, date_obtention, etoiles, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
           RETURNING *`,
          [participant_id, organizationId, territoire_chasse, objectif, description, fierte || false, raison, date_obtention, etoiles || 1]
        );

        await client.query('COMMIT');
        console.log(`[badge] Badge progress submitted for participant ${participant_id}: ${territoire_chasse}, ${etoiles} stars`);
        res.json({ success: true, data: result.rows[0], message: 'Badge progress submitted for approval' });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error saving badge progress:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/approve-badge:
   *   post:
   *     summary: Approve badge
   *     description: Approve a badge and award points (requires admin or leader role)
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - badge_id
   *             properties:
   *               badge_id:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Badge approved successfully
   *       400:
   *         description: Badge ID is required
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   *       404:
   *         description: Badge not found
   */
  router.post('/approve-badge', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization with admin or leader role
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, ['admin', 'leader']);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { badge_id } = req.body;

      if (!badge_id) {
        return res.status(400).json({ success: false, message: 'Badge ID is required' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get the badge details
        const badgeResult = await client.query(
          `SELECT * FROM badge_progress WHERE id = $1 AND organization_id = $2`,
          [badge_id, organizationId]
        );

        if (badgeResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, message: 'Badge not found' });
        }

        const badge = badgeResult.rows[0];

        // Update badge status to approved
        await client.query(
          `UPDATE badge_progress
           SET status = 'approved', approved_by = $1, approval_date = NOW()
           WHERE id = $2`,
          [decoded.user_id, badge_id]
        );

        // Get point system rules for badge earn points
        const pointRules = await getPointSystemRules(client, organizationId);
        const badgeEarnPoints = pointRules.badges?.earn || 5;

        // Get participant's group for proper point tracking
        const groupResult = await client.query(
          `SELECT group_id FROM participant_groups
           WHERE participant_id = $1 AND organization_id = $2`,
          [badge.participant_id, organizationId]
        );
        const groupId = groupResult.rows.length > 0 ? groupResult.rows[0].group_id : null;

        // Award points for earning the badge
        await client.query(
          `INSERT INTO points (participant_id, group_id, organization_id, value, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [badge.participant_id, groupId, organizationId, badgeEarnPoints]
        );

        await client.query('COMMIT');
        console.log(`[badge] Badge ${badge_id} approved for participant ${badge.participant_id}, points: +${badgeEarnPoints}`);
        res.json({ success: true, message: 'Badge approved', points: badgeEarnPoints });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error approving badge:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/reject-badge:
   *   post:
   *     summary: Reject badge
   *     description: Reject a badge submission (requires admin or leader role)
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - badge_id
   *             properties:
   *               badge_id:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Badge rejected successfully
   *       400:
   *         description: Badge ID is required
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   *       404:
   *         description: Badge not found
   */
  router.post('/reject-badge', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization with admin or leader role
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, ['admin', 'leader']);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { badge_id } = req.body;

      if (!badge_id) {
        return res.status(400).json({ success: false, message: 'Badge ID is required' });
      }

      const result = await pool.query(
        `UPDATE badge_progress
         SET status = 'rejected', approved_by = $1, approval_date = NOW()
         WHERE id = $2 AND organization_id = $3
         RETURNING *`,
        [decoded.user_id, badge_id, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Badge not found' });
      }

      console.log(`[badge] Badge ${badge_id} rejected`);
      res.json({ success: true, message: 'Badge rejected' });
    } catch (error) {
      logger.error('Error rejecting badge:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/badge-summary:
   *   get:
   *     summary: Get badge summary
   *     description: Retrieve all badges for organization with participant details
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Badge summary retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/badge-summary', async (req, res) => {
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

      const result = await pool.query(
        `SELECT bp.*, p.first_name, p.last_name
         FROM badge_progress bp
         JOIN participants p ON bp.participant_id = p.id
         WHERE bp.organization_id = $1
         ORDER BY bp.date_obtention DESC`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching badge summary:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/badge-history:
   *   get:
   *     summary: Get badge history for a participant
   *     description: Retrieve approved badge history for a specific participant
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Participant ID
   *     responses:
   *       200:
   *         description: Badge history retrieved successfully
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   */
  router.get('/badge-history', async (req, res) => {
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

      const participantId = req.query.participant_id;

      if (!participantId) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      const result = await pool.query(
        `SELECT * FROM badge_progress
         WHERE participant_id = $1 AND organization_id = $2 AND status = 'approved'
         ORDER BY date_obtention DESC`,
        [participantId, organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching badge history:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/current-stars:
   *   get:
   *     summary: Get current stars for a participant
   *     description: Calculate total approved stars for a specific participant
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Participant ID
   *     responses:
   *       200:
   *         description: Total stars retrieved successfully
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   */
  router.get('/current-stars', async (req, res) => {
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

      const participantId = req.query.participant_id;

      if (!participantId) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      const result = await pool.query(
        `SELECT COALESCE(SUM(etoiles), 0) as total_stars
         FROM badge_progress
         WHERE participant_id = $1 AND organization_id = $2 AND status = 'approved'`,
        [participantId, organizationId]
      );

      res.json({ success: true, data: { total_stars: parseInt(result.rows[0].total_stars) } });
    } catch (error) {
      logger.error('Error fetching current stars:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/badge-system-settings:
   *   get:
   *     summary: Get badge system settings
   *     description: Retrieve badge system configuration including territoires and structure
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Badge system settings retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/badge-system-settings', async (req, res) => {
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

      const result = await pool.query(
        `SELECT setting_value FROM organization_settings
         WHERE organization_id = $1 AND setting_key = 'badge_system'`,
        [organizationId]
      );

      if (result.rows.length > 0) {
        try {
          const badgeSystem = JSON.parse(result.rows[0].setting_value);
          res.json({ success: true, data: badgeSystem });
        } catch (e) {
          res.json({ success: true, data: result.rows[0].setting_value });
        }
      } else {
        res.json({ success: true, data: null, message: 'No badge system settings found' });
      }
    } catch (error) {
      logger.error('Error fetching badge system settings:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/badge-progress/{id}:
   *   put:
   *     summary: Update badge progress status
   *     description: Update badge status with reviewer comments (requires admin or leader role)
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Badge progress ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - status
   *             properties:
   *               status:
   *                 type: string
   *                 enum: [approved, rejected, pending]
   *               reviewer_comments:
   *                 type: string
   *     responses:
   *       200:
   *         description: Badge status updated successfully
   *       400:
   *         description: Missing required fields or invalid status
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Badge progress not found
   */
  router.put('/badge-progress/:id', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const badgeId = parseInt(req.params.id);
      const {
        status,
        reviewer_comments,
        etoiles,
        objectif,
        description,
        date_obtention,
        territoire_chasse,
        fierte,
        raison
      } = req.body;

      if (!badgeId) {
        return res.status(400).json({ success: false, message: 'Badge ID is required' });
      }

      if (
        status === undefined &&
        reviewer_comments === undefined &&
        etoiles === undefined &&
        objectif === undefined &&
        description === undefined &&
        date_obtention === undefined &&
        territoire_chasse === undefined &&
        fierte === undefined &&
        raison === undefined
      ) {
        return res.status(400).json({ success: false, message: 'No update fields provided' });
      }

      if (status && !['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status value' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization with admin or leader role
      const authCheck = await verifyOrganizationMembership(
        pool,
        decoded.userId,
        organizationId,
        ['admin', 'leader', 'animation']
      );
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const updateFields = [];
        const values = [];
        let valueIndex = 1;

        if (status) {
          updateFields.push(`status = $${valueIndex++}`);
          values.push(status);

          if (status === 'approved') {
            updateFields.push('approval_date = NOW()');
            updateFields.push(`approved_by = $${valueIndex++}`);
            values.push(decoded.userId);
          } else {
            updateFields.push('approval_date = NULL');
            updateFields.push('approved_by = NULL');
          }
        }

        if (reviewer_comments !== undefined) {
          updateFields.push(`reviewer_comments = $${valueIndex++}`);
          values.push(reviewer_comments || null);
        }

        if (etoiles !== undefined) {
          updateFields.push(`etoiles = $${valueIndex++}`);
          values.push(parseInt(etoiles, 10) || 0);
        }

        if (objectif !== undefined) {
          updateFields.push(`objectif = $${valueIndex++}`);
          values.push(objectif || null);
        }

        if (description !== undefined) {
          updateFields.push(`description = $${valueIndex++}`);
          values.push(description || null);
        }

        if (date_obtention !== undefined) {
          updateFields.push(`date_obtention = $${valueIndex++}`);
          values.push(date_obtention || null);
        }

        if (territoire_chasse !== undefined) {
          updateFields.push(`territoire_chasse = $${valueIndex++}`);
          values.push(territoire_chasse || null);
        }

        if (fierte !== undefined) {
          updateFields.push(`fierte = $${valueIndex++}`);
          values.push(!!fierte);
        }

        if (raison !== undefined) {
          updateFields.push(`raison = $${valueIndex++}`);
          values.push(raison || null);
        }

        updateFields.push('updated_at = NOW()');

        const updateResult = await client.query(
          `UPDATE badge_progress
           SET ${updateFields.join(', ')}
           WHERE id = $${valueIndex++} AND organization_id = $${valueIndex}
           RETURNING *`,
          [...values, badgeId, organizationId]
        );

        if (updateResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, message: 'Badge progress not found' });
        }

        const badge = updateResult.rows[0];

        // If approved, award points
        if (status === 'approved') {
          const pointRules = await getPointSystemRules(client, organizationId);
          const badgeEarnPoints = pointRules.badges?.earn || 5;

          // Get participant's group for proper point tracking
          const groupResult = await client.query(
            `SELECT group_id FROM participant_groups
             WHERE participant_id = $1 AND organization_id = $2`,
            [badge.participant_id, organizationId]
          );
          const groupId = groupResult.rows.length > 0 ? groupResult.rows[0].group_id : null;

          // Award points for earning the badge
          await client.query(
            `INSERT INTO points (participant_id, group_id, organization_id, value, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [badge.participant_id, groupId, organizationId, badgeEarnPoints]
          );

          console.log(`[badge] Badge ${badgeId} approved for participant ${badge.participant_id}, points: +${badgeEarnPoints}`);
        }

        await client.query('COMMIT');
        const message = status ? `Badge ${status} successfully` : 'Badge updated';
        res.json({
          success: true,
          data: badge,
          message
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error updating badge progress:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
