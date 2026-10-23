/**
 * Points Routes
 *
 * Handles point management, leaderboards, and reporting
 * Endpoints are mounted under /api/v1/points.
 *
 * @module routes/points
 */

const express = require('express');
const { eligibleActionParticipants } = require('../services/actionRoster');
const { createHash } = require('node:crypto');
const router = express.Router();

// Import auth middleware
const { authenticate, requirePermission, allowDemoSandbox, getOrganizationId, getScoutYear, rosterStatusesFor } = require('../middleware/auth');
const { DEMO_SANDBOX } = require('../middleware/demoSandbox');
const { asyncHandler } = require('../middleware/response');
const { ensureActiveScoutYear } = require('../services/scoutYear');

// Import utilities and middleware
const { handleOrganizationResolutionError } = require('../utils/api-helpers');
const { success, error: errorResponse } = require('../middleware/response');

const LEGACY_INDIVIDUAL_TYPE = 'participant';
const POINT_UPDATE_TYPES = new Set(['individual', 'group', LEGACY_INDIVIDUAL_TYPE]);
const POSTGRES_INTEGER_MIN = -2147483648;
const POSTGRES_INTEGER_MAX = 2147483647;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

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
   * /api/v1/points:
   *   get:
   *     summary: Get points data for groups and individuals
   *     description: Retrieve groups and enrolled individuals for the selected program year, defaulting to the active year.
   *     tags: [Points]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: scout_year_id
   *         description: Optional archived program year; defaults to the active year.
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Points data retrieved
   *       400:
   *         description: Unknown program year
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/', authenticate, requirePermission('points.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    // Totals are scoped to a scout year. Defaults to the active one; pass
    // ?scout_year_id= to consult an archived season.
    let scoutYear;
    try {
      scoutYear = await getScoutYear(req, pool);
    } catch (err) {
      return errorResponse(res, 'Unknown scout year for this organization', 400);
    }
    const rosterStatuses = rosterStatusesFor(scoutYear);

    // Fetch all groups with group-only points plus the sum of current member points.
    const groupsResult = await pool.query(
      `SELECT g.id,
              g.name,
              COALESCE(group_points.total_points, 0) AS total_points,
              COALESCE(member_points.total_points, 0) AS individual_total_points
       FROM groups g
       LEFT JOIN (
         SELECT group_id, SUM(value) AS total_points
         FROM points
         WHERE organization_id = $1 AND participant_id IS NULL AND scout_year_id = $2
         GROUP BY group_id
       ) group_points ON group_points.group_id = g.id
       LEFT JOIN (
         SELECT pg.group_id, SUM(COALESCE(participant_points.total_points, 0)) AS total_points
         FROM participant_group_assignments pg
         JOIN participant_enrollments pe ON pe.participant_id = pg.participant_id
          AND pe.organization_id = $1 AND pe.scout_year_id = $2
          AND pe.status = ANY($3::text[])
         LEFT JOIN (
           SELECT participant_id, SUM(value) AS total_points
           FROM points
           WHERE organization_id = $1 AND participant_id IS NOT NULL AND scout_year_id = $2
           GROUP BY participant_id
         ) participant_points ON participant_points.participant_id = pg.participant_id
         WHERE pg.organization_id = $1 AND pg.scout_year_id = $2
         GROUP BY pg.group_id
       ) member_points ON member_points.group_id = g.id
       WHERE g.organization_id = $1
       ORDER BY g.name`,
      [organizationId, scoutYear.id, rosterStatuses]
    );

    // Fetch the participants enrolled that year with their group and total points
    const participantsResult = await pool.query(
      `SELECT part.id, part.first_name, part.last_name, pg.group_id, COALESCE(SUM(p.value), 0) AS total_points
       FROM participants part
       JOIN participant_enrollments pe ON part.id = pe.participant_id
        AND pe.organization_id = $1 AND pe.scout_year_id = $2
        AND pe.status = ANY($3::text[])
       LEFT JOIN participant_group_assignments pg ON part.id = pg.participant_id
        AND pg.organization_id = $1 AND pg.scout_year_id = $2
       LEFT JOIN points p ON part.id = p.participant_id AND p.organization_id = $1
        AND p.scout_year_id = $2
       GROUP BY part.id, part.first_name, part.last_name, pg.group_id
       ORDER BY part.first_name`,
      [organizationId, scoutYear.id, rosterStatuses]
    );

    res.json({
      success: true,
      groups: groupsResult.rows,
      participants: participantsResult.rows,
      scout_year: {
        id: scoutYear.id,
        label: scoutYear.label,
        status: scoutYear.status,
        start_date: scoutYear.start_date,
        end_date: scoutYear.end_date
      }
    });
  }));

  /**
   * @swagger
   * /api/v1/points:
   *   post:
   *     summary: Update points for groups or individuals
   *     description: Add points to groups or individuals. Group points are distributed to all eligible members. The legacy type `participant` is accepted for installed mobile clients.
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
   *                   enum: [group, individual]
   *                 id:
   *                   type: integer
   *                 points:
   *                   type: integer
   *     responses:
   *       200:
   *         description: Points updated successfully
   *       400:
   *         description: Invalid update batch or entry
   *       404:
   *         description: Individual is not enrolled in the active program year
   *       403:
   *         description: Insufficient permissions
   */
  router.post('/', authenticate, allowDemoSandbox(DEMO_SANDBOX.points), requirePermission('points.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const updates = req.body;
    const idempotencyKey = req.get('Idempotency-Key');
    if (idempotencyKey && !/^[a-zA-Z0-9-]{1,128}$/.test(idempotencyKey)) {
      return errorResponse(res, 'Invalid idempotency key', HTTP_BAD_REQUEST);
    }

    logger.info('[update-points] Processing request', { 
      updateCount: Array.isArray(updates) ? updates.length : 0,
      organizationId 
    });

    if (!Array.isArray(updates)) {
      return errorResponse(res, 'Updates must be an array', HTTP_BAD_REQUEST);
    }

    const normalizedUpdates = updates.map((update) => {
      if (!update || typeof update !== 'object' || Array.isArray(update)) {
        return update;
      }
      return {
        ...update,
        id: typeof update.id === 'string' && /^\d+$/.test(update.id) ? Number(update.id) : update.id,
        type: update.type === LEGACY_INDIVIDUAL_TYPE ? 'individual' : update.type,
      };
    });

    for (const update of normalizedUpdates) {
      const validEntry = update && typeof update === 'object' && !Array.isArray(update);
      const validType = validEntry && POINT_UPDATE_TYPES.has(update.type);
      const validId = validEntry && Number.isSafeInteger(update.id) && update.id > 0;
      const validPoints = validEntry && Number.isInteger(update.points)
        && update.points >= POSTGRES_INTEGER_MIN && update.points <= POSTGRES_INTEGER_MAX;
      if (!validType || !validId || !validPoints) {
        return errorResponse(res, 'Each update needs a valid type, positive integer id, and integer points value', HTTP_BAD_REQUEST);
      }
    }

    const requestHash = createHash('sha256').update(JSON.stringify(updates)).digest('hex');

    // Totals returned to the client are the running totals of the active scout
    // year, not lifetime totals: opening a new year is what resets the score.
    const activeScoutYear = await ensureActiveScoutYear(pool, organizationId);

    const client = await pool.connect();
    const responseUpdates = [];

    try {
      await client.query('BEGIN');

      if (idempotencyKey) {
        // A unique row serializes concurrent retries. It commits with the points,
        // so a lost response can be retried without awarding the batch twice.
        const claim = await client.query(
          `INSERT INTO point_mutation_receipts (organization_id, user_id, mutation_key, request_hash)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (organization_id, user_id, mutation_key) DO NOTHING
           RETURNING mutation_key`,
          [organizationId, req.user.id, idempotencyKey, requestHash]
        );
        if (claim.rows.length === 0) {
          const existing = await client.query(
            `SELECT request_hash, response_data FROM point_mutation_receipts
             WHERE organization_id = $1 AND user_id = $2 AND mutation_key = $3`,
            [organizationId, req.user.id, idempotencyKey]
          );
          await client.query('ROLLBACK');
          if (existing.rows[0].request_hash !== requestHash) {
            return errorResponse(res, 'Idempotency key already used for another batch', HTTP_CONFLICT);
          }
          return success(res, existing.rows[0].response_data, 'Points updated successfully');
        }
      }

      for (const update of normalizedUpdates) {
        // Frontend sends: {type, id, points, timestamp, date?}
        // We need to convert to: {participant_id, group_id, value}
        // date is optional - if provided, we filter by attendance (only present/late get points)
        const { type, id, points, date } = update;
        const value = points;
        const hasRosterContext = Object.hasOwn(update, 'activity_id') || Object.hasOwn(update, 'include_all');
        // eslint-disable-next-line no-await-in-loop -- Keep each award and its roster check in the same transaction.
        const eligible = hasRosterContext ? await eligibleActionParticipants(client, organizationId, update) : null;

        if (type === 'group') {
          // For group points, add points to the group AND to each individual member
          // If date is provided, only award points to present/late participants
          const groupId = id;

          // Group members still enrolled this year. Joining the roster keeps
          // participants who left at the last transition from being awarded
          // points on a stale participant_groups row.
          const membersResult = await client.query(
            `SELECT p.id FROM participants p
               JOIN participant_group_assignments pg ON p.id = pg.participant_id
               JOIN participant_enrollments po ON po.participant_id = p.id
                AND po.organization_id = $1 AND po.scout_year_id = $3
                AND po.status = 'active'
               WHERE pg.organization_id = $1 AND pg.group_id = $2
                 AND pg.scout_year_id = $3`,
            [organizationId, groupId, activeScoutYear.id]
          );

          let memberIds = membersResult.rows.map(r => r.id);
          if (eligible !== null) { memberIds = memberIds.filter((memberId) => eligible.has(Number(memberId))); }
          if (hasRosterContext && memberIds.length === 0) {
            throw Object.assign(new Error('action_roster_no_participants'), { status: HTTP_CONFLICT });
          }
          let skippedCount = 0;
          let skippedParticipants = [];

          // If date is provided, filter by attendance (only present/late)
          // But only if attendance was actually taken for that date
          if (date && memberIds.length > 0 && !hasRosterContext) {
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
                   AND status IN ('present', 'late') AND is_on_site IS DISTINCT FROM FALSE`,
                [organizationId, date, memberIds]
              );

              const eligibleIds = new Set(attendanceResult.rows.map(r => r.participant_id));
              skippedParticipants = memberIds.filter(id => !eligibleIds.has(id));
              skippedCount = skippedParticipants.length;
              memberIds = memberIds.filter(id => eligibleIds.has(id));

              logger.info(`[update-points] Group ${groupId} on ${date}: ${memberIds.length} eligible, ${skippedCount} skipped (absent/excused)`);
            } else {
              // No attendance taken for this date - award to everyone
              logger.info(`[update-points] Group ${groupId} on ${date}: No attendance recorded, awarding to all ${memberIds.length} members`);
            }
          }

          // Insert a point record for the group (group-level tracking)
          await client.query(
            `INSERT INTO points (participant_id, group_id, organization_id, scout_year_id, value)
               VALUES (NULL, $1, $2, $3, $4)`,
            [groupId, organizationId, activeScoutYear.id, value]
          );

          // PERFORMANCE FIX: Batch insert all member points and calculate totals in a single query
          // This eliminates N+1 query problem (was 2 queries per member)
          const memberTotals = [];
          if (memberIds.length > 0) {
            // Build VALUES clause for batch insert
            const valuesClauses = memberIds.map((_, idx) =>
              `($${idx * 5 + 1}, $${idx * 5 + 2}, $${idx * 5 + 3}, $${idx * 5 + 4}, $${idx * 5 + 5})`
            ).join(', ');

            const insertValues = memberIds.flatMap(memberId =>
              [memberId, groupId, organizationId, activeScoutYear.id, value]
            );

            // Batch insert all points
            await client.query(
              `INSERT INTO points (participant_id, group_id, organization_id, scout_year_id, value)
                 VALUES ${valuesClauses}`,
              insertValues
            );

            // Calculate totals for all members in one query using window aggregation
            const totalsResult = await client.query(
              `SELECT participant_id as id, COALESCE(SUM(value), 0) as total
                 FROM points
                 WHERE organization_id = $1 AND participant_id = ANY($2)
                   AND scout_year_id = $3
                 GROUP BY participant_id`,
              [organizationId, memberIds, activeScoutYear.id]
            );

            // Map results to expected format
            totalsResult.rows.forEach(row => {
              memberTotals.push({
                id: row.id,
                totalPoints: parseInt(row.total)
              });
            });
          }

          // Include current (unchanged) totals for skipped participants
          // so the frontend can correct optimistic updates
          if (skippedParticipants.length > 0) {
            const skippedTotalsResult = await client.query(
              `SELECT participant_id as id, COALESCE(SUM(value), 0) as total
                 FROM points
                 WHERE organization_id = $1 AND participant_id = ANY($2)
                   AND scout_year_id = $3
                 GROUP BY participant_id`,
              [organizationId, skippedParticipants, activeScoutYear.id]
            );

            const skippedWithTotals = new Set();
            skippedTotalsResult.rows.forEach(row => {
              memberTotals.push({
                id: row.id,
                totalPoints: parseInt(row.total)
              });
              skippedWithTotals.add(row.id);
            });

            // Include members with zero points who were skipped
            skippedParticipants.forEach(id => {
              if (!skippedWithTotals.has(id)) {
                memberTotals.push({ id, totalPoints: 0 });
              }
            });
          }

          // Calculate new total for the group (group-level points only)
          const totalResult = await client.query(
            `SELECT COALESCE(SUM(value), 0) as total FROM points
               WHERE organization_id = $1 AND group_id = $2 AND participant_id IS NULL
                 AND scout_year_id = $3`,
            [organizationId, groupId, activeScoutYear.id]
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
          const participantId = id;
          if (eligible !== null && !eligible.has(Number(participantId))) {
            throw Object.assign(new Error('action_roster_participant_unavailable'), { status: HTTP_CONFLICT });
          }

          // Get the participant's group_id and verify they belong to this organization
          const participantResult = await client.query(
            `SELECT pg.group_id
               FROM participants p
               JOIN participant_enrollments po ON p.id = po.participant_id
                AND po.organization_id = $2 AND po.scout_year_id = $3 AND po.status = 'active'
               LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id
                AND pg.organization_id = $2 AND pg.scout_year_id = $3
               WHERE p.id = $1`,
            [participantId, organizationId, activeScoutYear.id]
          );

          if (participantResult.rows.length === 0) {
            const notFound = new Error('participant_not_found');
            notFound.code = 'POINT_INDIVIDUAL_NOT_FOUND';
            throw notFound;
          }

          const groupId = participantResult.rows[0].group_id || null;

          await client.query(
            `INSERT INTO points (participant_id, group_id, organization_id, scout_year_id, value)
               VALUES ($1, $2, $3, $4, $5)`,
            [participantId, groupId, organizationId, activeScoutYear.id, value]
          );

          // Calculate new total for this participant
          const totalResult = await client.query(
            `SELECT COALESCE(SUM(value), 0) as total FROM points
               WHERE organization_id = $1 AND participant_id = $2
                 AND scout_year_id = $3`,
            [organizationId, participantId, activeScoutYear.id]
          );

          responseUpdates.push({
            type: 'individual',
            id: participantId,
            totalPoints: parseInt(totalResult.rows[0].total)
          });
        }
      }

      if (idempotencyKey) {
        await client.query(
          `UPDATE point_mutation_receipts SET response_data = $4::jsonb
           WHERE organization_id = $1 AND user_id = $2 AND mutation_key = $3`,
          [organizationId, req.user.id, idempotencyKey, JSON.stringify({ updates: responseUpdates })]
        );
      }
      await client.query('COMMIT');
      logger.info('[update-points] Points update successful', { 
        updateCount: responseUpdates.length,
        organizationId 
      });
      return success(res, { updates: responseUpdates }, 'Points updated successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.status) { return errorResponse(res, error.message, error.status); }
      if (error.code === 'POINT_INDIVIDUAL_NOT_FOUND') {
        return errorResponse(res, 'participant_not_found', HTTP_NOT_FOUND);
      }
      throw error;
    } finally {
      client.release();
    }
  }));

  /**
   * @swagger
   * /api/v1/points/leaderboard:
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
  router.get('/leaderboard', authenticate, requirePermission('points.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const scoutYear = await getScoutYear(req, pool);
    const rosterStatuses = rosterStatusesFor(scoutYear);
    const { type, limit } = req.query;
    const resultLimit = parseInt(limit) || 10;

    if (type === 'groups') {
      // Group leaderboard uses only group-attributed point records.
      const result = await pool.query(
        `SELECT g.id, g.name,
                COALESCE(group_points.total_points, 0) as total_points,
                COALESCE(member_counts.member_count, 0) as member_count
         FROM groups g
         LEFT JOIN (
           SELECT group_id, SUM(value) AS total_points
           FROM points
           WHERE organization_id = $1 AND scout_year_id = $2 AND participant_id IS NULL
           GROUP BY group_id
         ) group_points ON group_points.group_id = g.id
         LEFT JOIN (
           SELECT pg.group_id, COUNT(DISTINCT pg.participant_id) AS member_count
           FROM participant_group_assignments pg
           JOIN participant_enrollments po ON po.participant_id = pg.participant_id
            AND po.organization_id = $1 AND po.scout_year_id = $2
            AND po.status = ANY($3::text[])
           WHERE pg.organization_id = $1 AND pg.scout_year_id = $2
           GROUP BY pg.group_id
         ) member_counts ON member_counts.group_id = g.id
         WHERE g.organization_id = $1
         ORDER BY total_points DESC
         LIMIT $4`,
        [organizationId, scoutYear.id, rosterStatuses, resultLimit]
      );

      res.json({ success: true, data: result.rows, type: 'groups' });
    } else {
      // Individual leaderboard (default)
      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name,
                g.name as group_name,
                COALESCE(SUM(pts.value), 0) as total_points
         FROM participants p
         JOIN participant_enrollments po ON p.id = po.participant_id
          AND po.organization_id = $1 AND po.scout_year_id = $2
          AND po.status = ANY($3::text[])
         LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id
          AND pg.organization_id = $1 AND pg.scout_year_id = $2
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN points pts ON pts.participant_id = p.id AND pts.organization_id = $1
          AND pts.scout_year_id = $2
         WHERE po.organization_id = $1
         GROUP BY p.id, p.first_name, p.last_name, g.name
         ORDER BY total_points DESC
         LIMIT $4`,
        [organizationId, scoutYear.id, rosterStatuses, resultLimit]
      );

      res.json({ success: true, data: result.rows, type: 'individuals' });
    }
  }));

  /**
   * @swagger
   * /api/v1/points/report:
   *   get:
   *     summary: Get points report
   *     description: Comprehensive points report for enrolled individuals. Requires reports.view.
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Points report
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/report', authenticate, requirePermission('reports.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const scoutYear = await getScoutYear(req, pool);
    const rosterStatuses = rosterStatusesFor(scoutYear);
    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
              COALESCE(point_totals.total_points, 0) as total_points,
              COALESCE(honor_counts.honors_count, 0) as honors_count
       FROM participants p
       JOIN participant_enrollments po ON p.id = po.participant_id
        AND po.organization_id = $1 AND po.scout_year_id = $2
        AND po.status = ANY($3::text[])
       LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id
        AND pg.organization_id = $1 AND pg.scout_year_id = $2
       LEFT JOIN groups g ON pg.group_id = g.id
       LEFT JOIN (
         SELECT participant_id, SUM(value) AS total_points
         FROM points
         WHERE organization_id = $1 AND scout_year_id = $2 AND participant_id IS NOT NULL
         GROUP BY participant_id
       ) point_totals ON point_totals.participant_id = p.id
       LEFT JOIN (
         SELECT participant_id, COUNT(DISTINCT id) AS honors_count
         FROM honors
         WHERE organization_id = $1 AND date BETWEEN $4::date AND $5::date
         GROUP BY participant_id
       ) honor_counts ON honor_counts.participant_id = p.id
       WHERE po.organization_id = $1
       GROUP BY p.id, p.first_name, p.last_name, g.name, point_totals.total_points, honor_counts.honors_count
       ORDER BY total_points DESC, p.first_name, p.last_name`,
      [organizationId, scoutYear.id, rosterStatuses, scoutYear.start_date, scoutYear.end_date]
    );

    res.json({ success: true, data: result.rows });
  }));

  return router;
};
