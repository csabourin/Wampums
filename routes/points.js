/**
 * Points Routes
 *
 * Handles point management, leaderboards, and reporting
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/points
 */

const express = require('express');
const router = express.Router();

// Import auth middleware
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/response');

// Import utilities and middleware
const { getCurrentOrganizationId, verifyJWT, verifyOrganizationMembership, handleOrganizationResolutionError } = require('../utils/api-helpers');
const { success, error: errorResponse } = require('../middleware/response');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with points routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/points-data:
   *   get:
   *     summary: Get points data for groups and participants
   *     description: Retrieve all groups and participants with their total points
   *     tags: [Points]
   *     responses:
   *       200:
   *         description: Points data retrieved
   */
  router.get('/points-data', authenticate, requirePermission('points.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    // Fetch all groups with total points
    const groupsResult = await pool.query(
      `SELECT g.id, g.name, COALESCE(SUM(p.value), 0) AS total_points
       FROM groups g
       LEFT JOIN points p ON g.id = p.group_id AND p.organization_id = $1
       WHERE g.organization_id = $1
       GROUP BY g.id, g.name
       ORDER BY g.name`,
      [organizationId]
    );

    // Fetch all participants with their associated group and total points
    const participantsResult = await pool.query(
      `SELECT part.id, part.first_name, part.last_name, pg.group_id, COALESCE(SUM(p.value), 0) AS total_points
       FROM participants part
       JOIN participant_organizations po ON part.id = po.participant_id
       LEFT JOIN participant_groups pg ON part.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN points p ON part.id = p.participant_id AND p.organization_id = $1
       WHERE po.organization_id = $1
       GROUP BY part.id, part.first_name, part.last_name, pg.group_id
       ORDER BY part.first_name`,
      [organizationId]
    );

    res.json({
      success: true,
      groups: groupsResult.rows,
      participants: participantsResult.rows
    });
  }));

  /**
   * @swagger
   * /api/update-points:
   *   post:
   *     summary: Update points for groups or participants
   *     description: Add points to groups or individual participants. Group points are distributed to all members.
   *     tags: [Points]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: array
   *             items:
   *               type: object
   *               required:
   *                 - type
   *                 - id
   *                 - points
   *               properties:
   *                 type:
   *                   type: string
   *                   enum: [group, participant]
   *                 id:
   *                   type: integer
   *                 points:
   *                   type: integer
   *     responses:
   *       200:
   *         description: Points updated successfully
   */
  router.post('/update-points', authenticate, blockDemoRoles, requirePermission('points.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
      const updates = req.body;

      console.log('[update-points] Request body:', JSON.stringify(updates));
      console.log('[update-points] Organization ID:', organizationId);

      if (!Array.isArray(updates)) {
        return res.status(400).json({ success: false, message: 'Updates must be an array' });
      }

      const client = await pool.connect();
      const responseUpdates = [];

      try {
        await client.query('BEGIN');

        for (const update of updates) {
          // Frontend sends: {type, id, points, timestamp, date?}
          // We need to convert to: {participant_id, group_id, value}
          // date is optional - if provided, we filter by attendance (only present/late get points)
          const { type, id, points, date } = update;
          const value = points;

          if (type === 'group') {
            // For group points, add points to the group AND to each individual member
            // If date is provided, only award points to present/late participants
            const groupId = parseInt(id);

            // Get all participants in this group (using participant_groups table)
            const membersResult = await client.query(
              `SELECT p.id FROM participants p
               JOIN participant_groups pg ON p.id = pg.participant_id
               WHERE pg.organization_id = $1 AND pg.group_id = $2`,
              [organizationId, groupId]
            );

            let memberIds = membersResult.rows.map(r => r.id);
            let skippedCount = 0;
            let skippedParticipants = [];

            // If date is provided, filter by attendance (only present/late)
            // But only if attendance was actually taken for that date
            if (date && memberIds.length > 0) {
              // First check if ANY attendance was recorded for this date
              const anyAttendanceResult = await client.query(
                `SELECT COUNT(*) as count FROM attendance
                 WHERE organization_id = $1 AND date = $2::date`,
                [organizationId, date]
              );

              const attendanceWasTaken = parseInt(anyAttendanceResult.rows[0].count) > 0;

              if (attendanceWasTaken) {
                // Attendance was taken - only award to present/late participants
                const attendanceResult = await client.query(
                  `SELECT participant_id, status FROM attendance
                   WHERE organization_id = $1 AND date = $2::date
                   AND participant_id = ANY($3)
                   AND status IN ('present', 'late')`,
                  [organizationId, date, memberIds]
                );

                const eligibleIds = new Set(attendanceResult.rows.map(r => r.participant_id));
                skippedParticipants = memberIds.filter(id => !eligibleIds.has(id));
                skippedCount = skippedParticipants.length;
                memberIds = memberIds.filter(id => eligibleIds.has(id));

                console.log(`[update-points] Group ${groupId} on ${date}: ${memberIds.length} eligible, ${skippedCount} skipped (absent/excused)`);
              } else {
                // No attendance taken for this date - award to everyone
                console.log(`[update-points] Group ${groupId} on ${date}: No attendance recorded, awarding to all ${memberIds.length} members`);
              }
            }

            // Insert a point record for the group (group-level tracking)
            await client.query(
              `INSERT INTO points (participant_id, group_id, organization_id, value)
               VALUES (NULL, $1, $2, $3)`,
              [groupId, organizationId, value]
            );

            // PERFORMANCE FIX: Batch insert all member points and calculate totals in a single query
            // This eliminates N+1 query problem (was 2 queries per member)
            const memberTotals = [];
            if (memberIds.length > 0) {
              // Build VALUES clause for batch insert
              const valuesClauses = memberIds.map((_, idx) =>
                `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`
              ).join(', ');

              const insertValues = memberIds.flatMap(memberId =>
                [memberId, groupId, organizationId, value]
              );

              // Batch insert all points
              await client.query(
                `INSERT INTO points (participant_id, group_id, organization_id, value)
                 VALUES ${valuesClauses}`,
                insertValues
              );

              // Calculate totals for all members in one query using window aggregation
              const totalsResult = await client.query(
                `SELECT participant_id as id, COALESCE(SUM(value), 0) as total
                 FROM points
                 WHERE organization_id = $1 AND participant_id = ANY($2)
                 GROUP BY participant_id`,
                [organizationId, memberIds]
              );

              // Map results to expected format
              totalsResult.rows.forEach(row => {
                memberTotals.push({
                  id: row.id,
                  totalPoints: parseInt(row.total)
                });
              });
            }

            // Calculate new total for the group (group-level points only)
            const totalResult = await client.query(
              `SELECT COALESCE(SUM(value), 0) as total FROM points
               WHERE organization_id = $1 AND group_id = $2 AND participant_id IS NULL`,
              [organizationId, groupId]
            );

            responseUpdates.push({
              type: 'group',
              id: groupId,
              totalPoints: parseInt(totalResult.rows[0].total),
              memberIds: memberIds,
              memberTotals: memberTotals,
              skippedCount: skippedCount,
              skippedParticipants: skippedParticipants,
              date: date || null
            });
          } else {
            // For individual participant points
            const participantId = parseInt(id);

            // Get the participant's group_id and verify they belong to this organization
            const participantResult = await client.query(
              `SELECT pg.group_id
               FROM participants p
               JOIN participant_organizations po ON p.id = po.participant_id
               LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $2
               WHERE p.id = $1 AND po.organization_id = $2`,
              [participantId, organizationId]
            );

            if (participantResult.rows.length === 0) {
              throw new Error(`Participant ${participantId} not found in organization ${organizationId}`);
            }

            const groupId = participantResult.rows[0].group_id || null;

            await client.query(
              `INSERT INTO points (participant_id, group_id, organization_id, value)
               VALUES ($1, $2, $3, $4)`,
              [participantId, groupId, organizationId, value]
            );

            // Calculate new total for this participant
            const totalResult = await client.query(
              `SELECT COALESCE(SUM(value), 0) as total FROM points
               WHERE organization_id = $1 AND participant_id = $2`,
              [organizationId, participantId]
            );

            responseUpdates.push({
              type: 'participant',
              id: participantId,
              totalPoints: parseInt(totalResult.rows[0].total)
            });
          }
        }

        await client.query('COMMIT');
        console.log('[update-points] SUCCESS - Response:', JSON.stringify({ success: true, data: { updates: responseUpdates } }));
        return success(res, { updates: responseUpdates }, 'Points updated successfully');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
  }));

  /**
   * @swagger
   * /api/points-leaderboard:
   *   get:
   *     summary: Get points leaderboard
   *     description: Retrieve top-scoring groups or individuals
   *     tags: [Points]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [groups, individuals]
   *           default: individuals
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *     responses:
   *       200:
   *         description: Leaderboard retrieved
   */
  router.get('/points-leaderboard', authenticate, requirePermission('points.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { type, limit } = req.query;
    const resultLimit = parseInt(limit) || 10;

    if (type === 'groups') {
      // Group leaderboard
      const result = await pool.query(
        `SELECT g.id, g.name,
                COALESCE(SUM(pts.value), 0) as total_points,
                COUNT(DISTINCT pg.participant_id) as member_count
         FROM groups g
         LEFT JOIN participant_groups pg ON g.id = pg.group_id AND pg.organization_id = $1
         LEFT JOIN points pts ON pts.group_id = g.id AND pts.organization_id = $1
         WHERE g.organization_id = $1
         GROUP BY g.id, g.name
         ORDER BY total_points DESC
         LIMIT $2`,
        [organizationId, resultLimit]
      );

      res.json({ success: true, data: result.rows, type: 'groups' });
    } else {
      // Individual leaderboard (default)
      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name,
                g.name as group_name,
                COALESCE(SUM(pts.value), 0) as total_points
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN points pts ON pts.participant_id = p.id AND pts.organization_id = $1
         WHERE po.organization_id = $1
         GROUP BY p.id, p.first_name, p.last_name, g.name
         ORDER BY total_points DESC
         LIMIT $2`,
        [organizationId, resultLimit]
      );

      res.json({ success: true, data: result.rows, type: 'individuals' });
    }
  }));

  /**
   * @swagger
   * /api/points-report:
   *   get:
   *     summary: Get points report
   *     description: Comprehensive points report for all participants (admin/animation only)
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Points report
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/points-report', authenticate, requirePermission('reports.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
              COALESCE(SUM(pts.value), 0) as total_points,
              COUNT(DISTINCT h.id) as honors_count
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       LEFT JOIN points pts ON p.id = pts.participant_id AND pts.organization_id = $1
       LEFT JOIN honors h ON p.id = h.participant_id
       WHERE po.organization_id = $1
       GROUP BY p.id, p.first_name, p.last_name, g.name
       ORDER BY total_points DESC, p.first_name, p.last_name`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  }));

  return router;
};
