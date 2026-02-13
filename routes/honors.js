/**
 * Honors Routes
 *
 * Handles honor awards, history, and reporting
 * Modern endpoints use /api/v1/ prefix with permission-based auth
 * Legacy endpoints remain for backward compatibility
 *
 * @module routes/honors
 */

const express = require('express');
const router = express.Router();

// Import utilities and middleware
const { getCurrentOrganizationId, verifyJWT, handleOrganizationResolutionError, verifyOrganizationMembership, getPointSystemRules } = require('../utils/api-helpers');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error: errorResponse, asyncHandler } = require('../middleware/response');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with honors routes
 */
module.exports = (pool, logger) => {
  // ==========================================
  // MODERN V1 ENDPOINTS (Permission-based)
  // ==========================================

  /**
   * @swagger
   * /api/v1/honors:
   *   get:
   *     summary: Get honors and participants (v1)
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
  router.get('/v1/honors',
    authenticate,
    requirePermission('honors.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const requestedDate = req.query.date;

      // Get participants
      const participantsResult = await pool.query(
        `SELECT p.id as participant_id, p.first_name, p.last_name,
                pg.group_id, g.name as group_name, pg.first_leader, pg.second_leader
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE po.organization_id = $1
         ORDER BY g.name, p.first_name`,
        [organizationId]
      );

      // Get honors with audit trail
      const honorsResult = await pool.query(
        `SELECT h.id, h.participant_id, h.date::text as date, h.reason,
                h.created_at, h.created_by, h.updated_at, h.updated_by
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
    })
  );

  /**
   * @swagger
   * /api/v1/honors:
   *   post:
   *     summary: Award honor to participant(s) (v1)
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
  router.post('/v1/honors',
    authenticate,
    blockDemoRoles,
    requirePermission('honors.create'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      // Handle both array and single object formats
      const honorsToProcess = Array.isArray(req.body) ? req.body : [req.body];

      const results = [];
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Get point system rules for this organization
        const pointRules = await getPointSystemRules(client, organizationId);
        const honorPoints = pointRules.honors?.award || 5;

        // Pre-fetch all participant groups and existing honors in batch
        const participantIds = honorsToProcess
          .map(h => h.participantId || h.participant_id)
          .filter(Boolean);
        
        const honorDates = honorsToProcess
          .map(h => h.date)
          .filter(Boolean);

        // Fetch existing honors in one query
        const existingHonorsResult = await client.query(
          `SELECT participant_id, date 
           FROM honors 
           WHERE organization_id = $1 
             AND participant_id = ANY($2::int[])
             AND date = ANY($3::date[])`,
          [organizationId, participantIds, honorDates]
        );
        
        const existingHonorsSet = new Set(
          existingHonorsResult.rows.map(row => `${row.participant_id}-${row.date}`)
        );

        // Fetch all participant groups in one query
        const groupsResult = await client.query(
          `SELECT participant_id, group_id 
           FROM participant_groups 
           WHERE organization_id = $1 
             AND participant_id = ANY($2::int[])`,
          [organizationId, participantIds]
        );
        
        const groupsMap = new Map(
          groupsResult.rows.map(row => [row.participant_id, row.group_id])
        );

        // Process honors and prepare batch inserts
        const newHonors = [];
        for (const honor of honorsToProcess) {
          const participantId = honor.participantId || honor.participant_id;
          const honorDate = honor.date;
          const reason = honor.reason || '';

          if (!participantId || !honorDate) {
            results.push({ participantId, success: false, message: 'Participant ID and date are required' });
            continue;
          }

          const honorKey = `${participantId}-${honorDate}`;
          if (existingHonorsSet.has(honorKey)) {
            results.push({ participantId, success: true, action: 'already_awarded' });
          } else {
            newHonors.push({ participantId, honorDate, reason });
          }
        }

        // Batch insert new honors
        if (newHonors.length > 0) {
          const honorValues = newHonors.map((_, idx) => {
            const base = idx * 4;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $5, NOW())`;
          }).join(', ');
          
          const honorParams = [
            ...newHonors.flatMap(h => [h.participantId, h.honorDate, organizationId, h.reason]),
            req.user.id
          ];

          const honorResult = await client.query(
            `INSERT INTO honors (participant_id, date, organization_id, reason, created_by, created_at)
             VALUES ${honorValues}
             RETURNING id, participant_id, date`,
            honorParams
          );

          // Batch insert points for all honors
          const pointValues = honorResult.rows.map((_, idx) => {
            const base = idx * 5;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $6)`;
          }).join(', ');
          
          const pointParams = [
            ...honorResult.rows.flatMap(row => [
              row.participant_id,
              groupsMap.get(row.participant_id) || null,
              honorPoints,
              row.date,
              organizationId
            ]),
            honorResult.rows[0].id // honor_id - using first honor's ID for batch
          ];

          // Note: We need to insert points with correct honor_id for each row
          // Let's do this in a better way using a CTE
          const pointInserts = honorResult.rows.map(row => ({
            participantId: row.participant_id,
            groupId: groupsMap.get(row.participant_id) || null,
            honorId: row.id,
            date: row.date
          }));

          for (const point of pointInserts) {
            await client.query(
              `INSERT INTO points (participant_id, group_id, value, created_at, organization_id, honor_id)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [point.participantId, point.groupId, honorPoints, point.date, organizationId, point.honorId]
            );
          }

          honorResult.rows.forEach(row => {
            logger.info(`[honor] Participant ${row.participant_id} awarded honor on ${row.date} by user ${req.user.id}, points: +${honorPoints}`);
            results.push({ 
              participantId: row.participant_id, 
              success: true, 
              action: 'awarded', 
              points: honorPoints,
              honorId: row.id
            });
          });
        }

        await client.query('COMMIT');
        return success(res, { results }, 'Honor(s) awarded successfully', 200);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })
  );

  /**
   * @swagger
   * /api/v1/honors/{id}:
   *   patch:
   *     summary: Update honor (v1)
   *     description: Update honor date or reason. Points date will be updated to match honor date.
   *     tags: [Honors]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               date:
   *                 type: string
   *                 format: date
   *               reason:
   *                 type: string
   *     responses:
   *       200:
   *         description: Honor updated successfully
   *       404:
   *         description: Honor not found
   */
  router.patch('/v1/honors/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('honors.create'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const honorId = parseInt(req.params.id);
      let { date, reason } = req.body;

      // Validation
      if (!date && reason === undefined) {
        return errorResponse(res, 'At least one field (date or reason) must be provided', 400);
      }

      if (date) {
        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date) || isNaN(new Date(date).getTime())) {
          return errorResponse(res, 'Invalid date format. Use YYYY-MM-DD', 400);
        }
      }

      if (reason !== undefined) {
        // Trim and validate reason length
        reason = String(reason).trim();
        if (reason.length > 1000) {
          return errorResponse(res, 'Reason must be 1000 characters or less', 400);
        }
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Verify honor exists and belongs to organization
        const checkResult = await client.query(
          `SELECT h.id, h.date, h.participant_id
           FROM honors h
           JOIN participants p ON h.participant_id = p.id
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE h.id = $1 AND po.organization_id = $2`,
          [honorId, organizationId]
        );

        if (checkResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return errorResponse(res, 'Honor not found', 404);
        }

        const currentHonor = checkResult.rows[0];

        // Update honor
        const updateFields = [];
        const updateParams = [honorId, organizationId, req.user.id];
        let paramIndex = 4;

        if (date) {
          updateFields.push(`date = $${paramIndex}`);
          updateParams.push(date);
          paramIndex++;
        }

        if (reason !== undefined) {
          updateFields.push(`reason = $${paramIndex}`);
          updateParams.push(reason);
          paramIndex++;
        }

        updateFields.push('updated_at = NOW()');
        updateFields.push('updated_by = $3');

        const updateQuery = `
          UPDATE honors
          SET ${updateFields.join(', ')}
          WHERE id = $1 AND organization_id = $2
          RETURNING *
        `;

        const updateResult = await client.query(updateQuery, updateParams);

        // If date was changed, update associated points date
        if (date && date !== currentHonor.date) {
          await client.query(
            `UPDATE points
             SET created_at = $1
             WHERE honor_id = $2 AND organization_id = $3`,
            [date, honorId, organizationId]
          );
          logger.info(`[honor] Updated honor ${honorId} date from ${currentHonor.date} to ${date}, points date synced`);
        }

        await client.query('COMMIT');

        return success(res, updateResult.rows[0], 'Honor updated successfully');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })
  );

  /**
   * @swagger
   * /api/v1/honors/{id}:
   *   delete:
   *     summary: Delete honor (v1)
   *     description: Delete honor and associated points (CASCADE)
   *     tags: [Honors]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Honor deleted successfully
   *       404:
   *         description: Honor not found
   */
  router.delete('/v1/honors/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('honors.create'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const honorId = parseInt(req.params.id);

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Verify honor exists and belongs to organization, get details for logging
        const checkResult = await client.query(
          `SELECT h.id, h.participant_id, h.date, h.reason,
                  p.first_name, p.last_name
           FROM honors h
           JOIN participants p ON h.participant_id = p.id
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE h.id = $1 AND po.organization_id = $2`,
          [honorId, organizationId]
        );

        if (checkResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return errorResponse(res, 'Honor not found', 404);
        }

        const honor = checkResult.rows[0];

        // Delete associated points first (if not using CASCADE)
        // Points will be deleted automatically via CASCADE if foreign key is set up correctly
        // But we'll be explicit for clarity and to get count
        const pointsResult = await client.query(
          `DELETE FROM points WHERE honor_id = $1 AND organization_id = $2 RETURNING id, value`,
          [honorId, organizationId]
        );

        // Delete the honor
        await client.query(
          `DELETE FROM honors WHERE id = $1 AND organization_id = $2`,
          [honorId, organizationId]
        );

        await client.query('COMMIT');

        logger.info(
          `[honor] Deleted honor ${honorId} for participant ${honor.participant_id} ` +
          `(${honor.first_name} ${honor.last_name}) on ${honor.date}. ` +
          `Removed ${pointsResult.rows.length} associated point(s). Deleted by user ${req.user.id}`
        );

        return success(res, {
          deleted: true,
          honorId,
          participantId: honor.participant_id,
          date: honor.date,
          pointsRemoved: pointsResult.rows.length
        }, 'Honor deleted successfully');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })
  );

  /**
   * @swagger
   * /api/v1/honors/history:
   *   get:
   *     summary: Get honors history (v1)
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
  router.get('/v1/honors/history',
    authenticate,
    requirePermission('honors.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { start_date, end_date, participant_id } = req.query;

      let query = `
        SELECT h.id, h.date::text as date, h.reason,
               h.created_at, h.created_by, h.updated_at, h.updated_by,
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

      return success(res, {
        honors: result.rows,
        summary: summaryResult.rows
      }, 'Honors history retrieved successfully');
    })
  );

  // ==========================================
  // LEGACY ENDPOINTS (for backward compatibility)
  // ==========================================

  /**
   * @swagger
   * /api/honors:
   *   get:
   *     summary: Get honors and participants (LEGACY)
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
   *     deprecated: true
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
                pg.group_id, g.name as group_name, pg.first_leader, pg.second_leader
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE po.organization_id = $1
         ORDER BY g.name, p.first_name`,
        [organizationId]
      );

      // Get honors with audit trail
      const honorsResult = await pool.query(
        `SELECT h.id, h.participant_id, h.date::text as date, h.reason,
                h.created_at, h.created_by, h.updated_at, h.updated_by
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
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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

            logger.info(`[honor] Participant ${participantId} awarded honor on ${honorDate}, points: +${honorPoints}`);
            results.push({ participantId, success: true, action: 'awarded', points: honorPoints });
          }
        }

        await client.query('COMMIT');
        res.json({ success: true, status: 'success', results });
      } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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
               h.created_at, h.created_by, h.updated_at, h.updated_by,
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
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching recent honors:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
