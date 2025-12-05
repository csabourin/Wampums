/**
 * Honors Routes
 *
 * Handles honor awards, history, and reporting
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/honors
 */

const express = require('express');
const router = express.Router();

// Import utilities and middleware
const { getCurrentOrganizationId, verifyJWT, verifyOrganizationMembership, getPointSystemRules } = require('../utils/api-helpers');
const { success, error: errorResponse } = require('../middleware/response');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with honors routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/honors:
   *   get:
   *     summary: Get honors and participants
   *     description: Retrieve all honors and participants for management interface
   *     tags: [Honors]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: date
   *         schema:
   *           type: string
   *           format: date
   *     responses:
   *       200:
   *         description: Honors and participants retrieved
   */
  router.get('/honors', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const requestedDate = req.query.date;

      // Get participants
      const participantsResult = await pool.query(
        `SELECT p.id as participant_id, p.first_name, p.last_name,
                pg.group_id, g.name as group_name, pg.is_leader, pg.is_second_leader
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE po.organization_id = $1
         ORDER BY g.name, p.first_name`,
        [organizationId]
      );

      // Get honors
      const honorsResult = await pool.query(
        `SELECT h.id, h.participant_id, h.date::text as date, h.reason
         FROM honors h
         JOIN participants p ON h.participant_id = p.id
         JOIN participant_organizations po ON p.id = po.participant_id
         WHERE po.organization_id = $1
         ORDER BY h.date DESC`,
        [organizationId]
      );

      // Get available dates (dates with honors)
      const datesResult = await pool.query(
        `SELECT DISTINCT date::text as date FROM honors h
         JOIN participants p ON h.participant_id = p.id
         JOIN participant_organizations po ON p.id = po.participant_id
         WHERE po.organization_id = $1
         ORDER BY date DESC`,
        [organizationId]
      );

      return success(res, {
        participants: participantsResult.rows,
        honors: honorsResult.rows,
        availableDates: datesResult.rows.map(r => r.date)
      }, 'Honors retrieved successfully');
    } catch (error) {
      logger.error('Error fetching honors:', error);
      return errorResponse(res, error.message, 500);
    }
  });

  /**
   * @swagger
   * /api/award-honor:
   *   post:
   *     summary: Award honor to participant(s)
   *     description: Award honor and add points. Accepts single object or array of honors.
   *     tags: [Honors]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             oneOf:
   *               - type: object
   *                 required:
   *                   - participant_id
   *                   - date
   *                 properties:
   *                   participant_id:
   *                     type: integer
   *                   participantId:
   *                     type: integer
   *                   date:
   *                     type: string
   *                     format: date
   *               - type: array
   *                 items:
   *                   type: object
   *     responses:
   *       200:
   *         description: Honor(s) awarded successfully
   */
  router.post('/award-honor', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Handle both array and single object formats
      const honorsToProcess = Array.isArray(req.body) ? req.body : [req.body];

      const results = [];
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Get point system rules for this organization
        const pointRules = await getPointSystemRules(client, organizationId);
        const honorPoints = pointRules.honors?.award || 5;

        for (const honor of honorsToProcess) {
          // Accept both participantId (camelCase) and participant_id (snake_case)
          const participantId = honor.participantId || honor.participant_id;
          const honorDate = honor.date;
          const reason = honor.reason || '';

          if (!participantId || !honorDate) {
            results.push({ participantId, success: false, message: 'Participant ID and date are required' });
            continue;
          }

          // Check if honor already exists for this participant on this date
          const existingResult = await client.query(
            `SELECT id FROM honors WHERE participant_id = $1 AND date = $2 AND organization_id = $3`,
            [participantId, honorDate, organizationId]
          );

          if (existingResult.rows.length > 0) {
            // Honor already exists - skip (or could toggle off if needed)
            results.push({ participantId, success: true, action: 'already_awarded' });
          } else {
            // Add new honor with organization_id and reason
            await client.query(
              `INSERT INTO honors (participant_id, date, organization_id, reason) VALUES ($1, $2, $3, $4)`,
              [participantId, honorDate, organizationId, reason]
            );

            // Get participant's group for proper point tracking
            const groupResult = await client.query(
              `SELECT group_id FROM participant_groups
               WHERE participant_id = $1 AND organization_id = $2`,
              [participantId, organizationId]
            );
            const groupId = groupResult.rows.length > 0 ? groupResult.rows[0].group_id : null;

            // Add points for the honor based on organization rules
            await client.query(
              `INSERT INTO points (participant_id, group_id, value, created_at, organization_id)
               VALUES ($1, $2, $3, $4, $5)`,
              [participantId, groupId, honorPoints, honorDate, organizationId]
            );

            console.log(`[honor] Participant ${participantId} awarded honor on ${honorDate}, points: +${honorPoints}`);
            results.push({ participantId, success: true, action: 'awarded', points: honorPoints });
          }
        }

        await client.query('COMMIT');
        res.json({ success: true, status: 'success', results });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error awarding honor:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/honors-history:
   *   get:
   *     summary: Get honors history
   *     description: Retrieve honor awards history with optional filtering
   *     tags: [Honors]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: start_date
   *         schema:
   *           type: string
   *           format: date
   *       - in: query
   *         name: end_date
   *         schema:
   *           type: string
   *           format: date
   *       - in: query
   *         name: participant_id
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Honors history retrieved
   */
  router.get('/honors-history', async (req, res) => {
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

      const { start_date, end_date, participant_id } = req.query;

      let query = `
        SELECT h.id, h.date::text as date, h.reason,
               p.id as participant_id, p.first_name, p.last_name,
               g.name as group_name
        FROM honors h
        JOIN participants p ON h.participant_id = p.id
        LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
        LEFT JOIN groups g ON pg.group_id = g.id
        WHERE h.organization_id = $1
      `;

      const params = [organizationId];
      let paramIndex = 2;

      if (start_date) {
        query += ` AND h.date >= $${paramIndex}`;
        params.push(start_date);
        paramIndex++;
      }

      if (end_date) {
        query += ` AND h.date <= $${paramIndex}`;
        params.push(end_date);
        paramIndex++;
      }

      if (participant_id) {
        query += ` AND h.participant_id = $${paramIndex}`;
        params.push(participant_id);
        paramIndex++;
      }

      query += ` ORDER BY h.date DESC, p.last_name, p.first_name`;

      const result = await pool.query(query, params);

      // Also get summary by participant
      const summaryQuery = `
        SELECT p.id, p.first_name, p.last_name, COUNT(h.id) as honor_count
        FROM honors h
        JOIN participants p ON h.participant_id = p.id
        WHERE h.organization_id = $1
        GROUP BY p.id, p.first_name, p.last_name
        ORDER BY honor_count DESC
      `;

      const summaryResult = await pool.query(summaryQuery, [organizationId]);

      res.json({
        success: true,
        data: result.rows,
        summary: summaryResult.rows
      });
    } catch (error) {
      logger.error('Error fetching honors history:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/honors-report:
   *   get:
   *     summary: Get honors report by category
   *     description: Aggregate honors by name and category (admin/animation only)
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Honors report
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/honors-report', async (req, res) => {
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

      const result = await pool.query(
        `SELECT h.honor_name, h.category, COUNT(*) as count,
                array_agg(p.first_name || ' ' || p.last_name) as recipients
         FROM honors h
         JOIN participants p ON h.participant_id = p.id
         JOIN participant_organizations po ON p.id = po.participant_id
         WHERE po.organization_id = $1
         GROUP BY h.honor_name, h.category
         ORDER BY h.category, h.honor_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching honors report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/recent-honors:
   *   get:
   *     summary: Get recently awarded honors
   *     description: Retrieve most recent honor awards
   *     tags: [Honors]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *     responses:
   *       200:
   *         description: Recent honors
   */
  router.get('/recent-honors', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const limit = parseInt(req.query.limit) || 10;

      const result = await pool.query(
        `SELECT h.*, p.first_name, p.last_name, g.name as group_name
         FROM honors h
         JOIN participants p ON h.participant_id = p.id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE h.organization_id = $1
         ORDER BY h.date DESC
         LIMIT $2`,
        [organizationId, limit]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching recent honors:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
